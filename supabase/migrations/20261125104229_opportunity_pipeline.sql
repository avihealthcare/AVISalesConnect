alter table public.opportunities
 add column row_version integer not null default 1 check (row_version > 0),
 add column estimated_net_inr numeric(18,2) check (estimated_net_inr >= 0),
 add column probability_percent integer check (probability_percent between 0 and 100),
 add column estimate_reason text check (char_length(trim(estimate_reason)) between 1 and 500),
 add constraint opportunity_estimate_complete check (
   num_nonnulls(estimated_net_inr,probability_percent,estimate_reason) in (0,3)
 ),
 add column weighted_net_inr numeric(18,2) generated always as (
   case when stage not in ('Won','Lost') then round(estimated_net_inr * probability_percent / 100,2) end
 ) stored;

insert into public.permissions(code,description,requires_mfa) values
 ('opportunity.edit_pipeline','Edit the open pipeline for an owned opportunity',false);

create function private.update_opportunity_pipeline(
 p_org uuid,p_id uuid,p_key uuid,p_version integer,p_stage text,p_amount text,p_probability integer,p_reason text
)
returns integer language plpgsql security definer set search_path=pg_catalog as $$
declare
 actor uuid;
 current_row public.opportunities%rowtype;
 prior private.operation_receipts%rowtype;
 input_hash text;
 updated_version integer;
begin
 if p_org is null or p_id is null or p_key is null or p_version is null or p_version < 1
   or p_stage is null or p_stage not in ('Qualified','Requirement Confirmed','Proposal','Negotiation')
   or coalesce(length(trim(p_reason)),0) not between 1 and 500
   or num_nonnulls(p_amount,p_probability) not in (0,2)
   or (p_amount is not null and p_amount !~ '^[0-9]{1,16}([.][0-9]{1,2})?$')
   or (p_probability is not null and p_probability not between 0 and 100) then
  raise exception 'Invalid pipeline update' using errcode='22023';
 end if;
 select id into actor from public.memberships
 where organization_id=p_org and user_id=auth.uid() and status='Active' for share;
 if actor is null or not private.intake_actor_can(p_org,actor,'opportunity.read')
  or not private.intake_actor_can(p_org,actor,'opportunity.edit_pipeline') then
  raise exception 'Opportunity access denied' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_key::text,0));
 select o.* into current_row from public.opportunities o
 join public.resources r on (r.organization_id,r.id)=(o.organization_id,o.id)
 where o.organization_id=p_org and o.id=p_id and r.owner_membership_id=actor and r.archived_at is null
 for update of o,r;
 if not found then raise sqlstate 'PT404' using message='Opportunity unavailable'; end if;
 input_hash := encode(sha256(convert_to(jsonb_build_array(p_id,p_version,p_stage,p_amount,p_probability,p_reason)::text,'UTF8')),'hex');
 select * into prior from private.operation_receipts
 where organization_id=p_org and actor_membership_id=actor and operation_key=p_key;
 if found then
  if prior.command_type <> 'opportunity.edit_pipeline' or prior.request_hash <> input_hash then
   raise sqlstate 'PT409' using message='Operation key is already in use';
  end if;
  return (prior.response_snapshot->>'version')::integer;
 end if;
 if current_row.row_version<>p_version then raise sqlstate 'PT409' using message='Opportunity has changed'; end if;
 if current_row.stage in ('Won','Lost') then raise sqlstate 'PT422' using message='Closed opportunity'; end if;
 update public.opportunities set
  stage=p_stage, estimated_net_inr=p_amount::numeric, probability_percent=p_probability,
  estimate_reason=case when p_amount is not null then trim(p_reason) end,
  row_version=row_version+1
 where id=p_id returning row_version into updated_version;
 insert into private.audit_events(organization_id,actor_membership_id,resource_id,action,request_id,redacted_details)
 values(p_org,actor,p_id,'opportunity.edit_pipeline',p_key,jsonb_build_object('previous_stage',current_row.stage,'stage',p_stage,'reason',trim(p_reason)));
 insert into private.operation_receipts(organization_id,actor_membership_id,operation_key,command_type,request_hash,response_snapshot)
 values(p_org,actor,p_key,'opportunity.edit_pipeline',input_hash,jsonb_build_object('version',updated_version));
 return updated_version;
end
$$;
revoke all on function private.update_opportunity_pipeline(uuid,uuid,uuid,integer,text,text,integer,text) from public, anon, authenticated;
grant execute on function private.update_opportunity_pipeline(uuid,uuid,uuid,integer,text,text,integer,text) to authenticated;

create function public.update_opportunity_pipeline(
 p_org uuid,p_id uuid,p_key uuid,p_version integer,p_stage text,p_amount text,p_probability integer,p_reason text
)
returns integer language sql security invoker set search_path=pg_catalog as $$
 select private.update_opportunity_pipeline(p_org,p_id,p_key,p_version,p_stage,p_amount,p_probability,p_reason)
$$;
revoke all on function public.update_opportunity_pipeline(uuid,uuid,uuid,integer,text,text,integer,text) from public, anon, authenticated;
grant execute on function public.update_opportunity_pipeline(uuid,uuid,uuid,integer,text,text,integer,text) to authenticated;

-- Existing and future Intake Staff grants get the same own-scope sales action.
insert into public.role_permissions(organization_id,role_id,permission_code)
select organization_id,id,'opportunity.edit_pipeline' from public.roles where code='intake_staff' and requires_mfa;

-- Preserve the existing operator command with an updated, exact allowlist.
create or replace function private.provision_intake_staff(
 p_org uuid, p_user uuid, p_display_name text, p_employee_code text, p_request_id uuid
)
returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
declare
 staff_role uuid;
 new_member uuid;
 allowed_codes constant text[] := array[
  'account.create','account.read','lead.create','lead.read','lead.contact',
  'lead.qualify','lead.disqualify','lead.convert','opportunity.read','opportunity.edit_pipeline'
 ];
begin
 if p_org is null or p_user is null or p_request_id is null
    or coalesce(length(trim(p_display_name)),0) not between 1 and 200 then
  raise exception 'Organization, Auth identity, name, and request ID are required' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('provision-intake:'||p_org::text,0));
 if not exists(select 1 from auth.users where id=p_user) then
  raise exception 'Create the identity in Supabase Auth first' using errcode='22023';
 end if;
 if exists (select 1 from public.memberships where organization_id=p_org and user_id=p_user) then
  raise exception 'This identity already has a membership in the organization' using errcode='23505';
 end if;
 insert into public.roles (organization_id,code,name,requires_mfa)
 values(p_org,'intake_staff','Intake Staff',true)
 on conflict (organization_id,code) do nothing returning id into staff_role;
 if staff_role is not null then
  insert into public.role_permissions(organization_id,role_id,permission_code)
  select p_org,staff_role,code from public.permissions where code=any(allowed_codes);
 else
  select id into staff_role from public.roles
   where organization_id=p_org and code='intake_staff' and requires_mfa for update;
 end if;
 if staff_role is null or (
   select array_agg(permission_code order by permission_code)
   from public.role_permissions where organization_id=p_org and role_id=staff_role
  ) is distinct from (select array_agg(code order by code) from unnest(allowed_codes) as codes(code)) then
  raise exception 'The intake role permission bundle differs from the expected bundle' using errcode='22023';
 end if;
 insert into public.profiles (id,display_name) values(p_user,trim(p_display_name))
 on conflict (id) do nothing;
 insert into public.memberships(organization_id,user_id,status,employee_code)
 values(p_org,p_user,'Active',nullif(trim(p_employee_code),'')) returning id into new_member;
 insert into public.member_roles(organization_id,membership_id,role_id,effective_from)
 values(p_org,new_member,staff_role,now());
 insert into private.audit_events(organization_id,action,request_id,redacted_details)
 values(p_org,'staff.provision',p_request_id,jsonb_build_object('membership_id',new_member,'role','intake_staff'));
 return new_member;
end
$$;
