alter table public.leads
 add column first_attempt_at timestamptz,
 add column first_successful_contact_at timestamptz,
 add column next_action text,
 add column next_action_due_at timestamptz,
 add column disqualification_reason text,
 add column row_version integer not null default 1 check (row_version>0),
 add unique (organization_id,id);

create table public.lead_contact_attempts (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 lead_id uuid not null,
 actor_membership_id uuid not null,
 attempted_at timestamptz not null default now(),
 outcome text not null check (outcome in ('Reached','No answer','Invalid contact')),
 notes text check (char_length(notes)<=2000),
 foreign key (organization_id,lead_id) references public.leads(organization_id,id),
 foreign key (organization_id,actor_membership_id) references public.memberships(organization_id,id)
);
create index lead_attempts_history on public.lead_contact_attempts(organization_id,lead_id,attempted_at desc);
create trigger lead_attempts_append_only before update or delete or truncate on public.lead_contact_attempts
 for each statement execute function private.reject_mutation();

create table public.opportunities (
 id uuid primary key,
 organization_id uuid not null,
 resource_type text generated always as ('opportunity') stored,
 origin_lead_id uuid not null,
 account_id uuid not null,
 requirement_text text not null,
 stage text not null default 'Qualified' check (stage in ('Qualified','Requirement Confirmed','Proposal','Negotiation','Won','Lost')),
 created_at timestamptz not null default now(),
 unique (organization_id,origin_lead_id),
 foreign key (organization_id,id,resource_type) references public.resources(organization_id,id,resource_type),
 foreign key (organization_id,origin_lead_id) references public.leads(organization_id,id),
 foreign key (organization_id,account_id) references public.accounts(organization_id,id)
);
create index opportunities_recent on public.opportunities(organization_id,created_at desc,id);
alter table public.lead_contact_attempts enable row level security;
alter table public.opportunities enable row level security;
revoke all on public.lead_contact_attempts, public.opportunities from public, anon, authenticated;
grant select on public.lead_contact_attempts, public.opportunities to authenticated;
create policy contact_attempt_read on public.lead_contact_attempts for select to authenticated
 using (exists (select 1 from public.leads l where l.organization_id=lead_contact_attempts.organization_id and l.id=lead_contact_attempts.lead_id));
create policy opportunity_read on public.opportunities for select to authenticated
 using (exists (select 1 from public.resources r where r.organization_id=opportunities.organization_id and r.id=opportunities.id));

insert into public.permissions(code,description,requires_mfa) values
 ('lead.contact','Log a contact attempt for an owned lead',false),
 ('lead.qualify','Qualify an owned lead',false),
 ('lead.disqualify','Disqualify an owned lead',false),
 ('lead.convert','Convert an owned lead to an opportunity',false),
 ('opportunity.read','Read an opportunity within allowed scope',false);

-- This internal lookup takes the already verified actor, and is not callable by clients.
create function private.intake_actor_can(p_org uuid,p_actor uuid,p_code text)
returns boolean language sql stable security invoker set search_path=pg_catalog as $$
 select exists (
  select 1 from public.member_roles mr
  join public.roles r on (r.organization_id,r.id)=(mr.organization_id,mr.role_id)
  join public.role_permissions rp on (rp.organization_id,rp.role_id)=(r.organization_id,r.id)
  join public.permissions p on p.code=rp.permission_code
  where mr.organization_id=p_org and mr.membership_id=p_actor and p.code=p_code
    and mr.effective_from<=now() and (mr.effective_to is null or mr.effective_to>now())
    and (not (r.requires_mfa or p.requires_mfa) or auth.jwt()->>'aal'='aal2')
 )
$$;
revoke all on function private.intake_actor_can(uuid,uuid,text) from public, anon, authenticated;

create function private.progress_lead(p_org uuid,p_id uuid,p_key uuid,p_version integer,p_action text,p_input jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare
 actor uuid;
 lead public.leads%rowtype;
 prior private.operation_receipts%rowtype;
 input_hash text;
 action_code text;
 result_id uuid;
 details text;
 due_at timestamptz;
 outcome text;
begin
 if p_org is null or p_id is null or p_key is null or p_version is null or p_version<1
    or p_action is null or p_action not in ('contact','qualify','disqualify','convert')
    or jsonb_typeof(p_input) is distinct from 'object' then
  raise exception 'Invalid lead request' using errcode='22023';
 end if;
 action_code := 'lead.'||p_action;
 select m.id into actor from public.memberships m
 where m.organization_id=p_org and m.user_id=auth.uid() and m.status='Active' for share;
 if actor is null or not private.intake_actor_can(p_org,actor,'lead.read')
    or not private.intake_actor_can(p_org,actor,action_code) then
  raise exception 'Lead access denied' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_key::text,0));
 select l.* into lead from public.leads l join public.resources r on (r.organization_id,r.id)=(l.organization_id,l.id)
 where l.organization_id=p_org and l.id=p_id and r.owner_membership_id=actor and r.archived_at is null for update of l,r;
 if not found then raise sqlstate 'PT404' using message='Lead unavailable'; end if;
 input_hash := encode(sha256(convert_to(jsonb_build_array(p_id,p_version,p_input)::text,'UTF8')),'hex');
 select * into prior from private.operation_receipts
 where organization_id=p_org and actor_membership_id=actor and operation_key=p_key;
 if found then
  if prior.command_type<>action_code or prior.request_hash<>input_hash then
   raise sqlstate 'PT409' using message='Operation key is already in use';
  end if;
  return (prior.response_snapshot->>'id')::uuid;
 end if;
 if lead.row_version<>p_version then raise sqlstate 'PT409' using message='Lead has changed'; end if;
 if lead.lifecycle in ('Disqualified','Converted') then raise sqlstate 'PT422' using message='Lead is closed'; end if;
 result_id := p_id;
 case p_action
 when 'contact' then
  outcome := p_input->>'outcome';
  if outcome is null or outcome not in ('Reached','No answer','Invalid contact') then
   raise exception 'Select a contact outcome' using errcode='22023';
  end if;
  insert into public.lead_contact_attempts(organization_id,lead_id,actor_membership_id,outcome,notes)
  values(p_org,p_id,actor,outcome,nullif(trim(p_input->>'notes'),''));
  update public.leads set lifecycle=case when lifecycle in ('New','Assigned') then 'Contacted' else lifecycle end,
   first_attempt_at=coalesce(first_attempt_at,now()),
   first_successful_contact_at=case when outcome='Reached' then coalesce(first_successful_contact_at,now()) else first_successful_contact_at end
  where id=p_id;
 when 'qualify' then
  details := nullif(trim(p_input->>'requirement'),'');
  due_at := (p_input->>'due_at')::timestamptz;
  if details is null or length(details)>10000 or coalesce(length(trim(p_input->>'next_action')),0) not between 1 and 500
     or due_at is null or not isfinite(due_at) or due_at<=now() then
   raise exception 'Requirement and future next action are required' using errcode='22023';
  end if;
  update public.leads set lifecycle='Qualified', requirement_text=details,
   next_action=trim(p_input->>'next_action'), next_action_due_at=due_at where id=p_id;
 when 'disqualify' then
  details := nullif(trim(p_input->>'reason'),'');
  if details is null or length(details)>1000 then raise exception 'A reason is required' using errcode='22023'; end if;
  update public.leads set lifecycle='Disqualified',disqualification_reason=details where id=p_id;
 when 'convert' then
  if lead.lifecycle<>'Qualified' or lead.account_id is null then
   raise sqlstate 'PT422' using message='Qualify the lead and link a customer before converting';
  end if;
  if not private.intake_actor_can(p_org,actor,'account.read') or not exists (
   select 1 from public.resources where organization_id=p_org and id=lead.account_id
     and owner_membership_id=actor and archived_at is null
  ) then raise sqlstate 'PT404' using message='Customer unavailable'; end if;
  insert into public.resources(organization_id,resource_type,owner_membership_id)
   values(p_org,'opportunity',actor) returning id into result_id;
  insert into public.opportunities(id,organization_id,origin_lead_id,account_id,requirement_text)
   values(result_id,p_org,p_id,lead.account_id,lead.requirement_text);
  update public.leads set lifecycle='Converted' where id=p_id;
 end case;
 update public.leads set row_version=row_version+1 where id=p_id;
 insert into private.audit_events(organization_id,actor_membership_id,resource_id,action,request_id)
  values(p_org,actor,p_id,action_code,p_key);
 insert into private.operation_receipts(organization_id,actor_membership_id,operation_key,command_type,request_hash,response_snapshot)
  values(p_org,actor,p_key,action_code,input_hash,jsonb_build_object('id',result_id));
 return result_id;
end
$$;
revoke all on function private.progress_lead(uuid,uuid,uuid,integer,text,jsonb) from public, anon, authenticated;
grant execute on function private.progress_lead(uuid,uuid,uuid,integer,text,jsonb) to authenticated;
create function public.progress_lead(p_org uuid,p_id uuid,p_key uuid,p_version integer,p_action text,p_input jsonb)
returns uuid language sql security invoker set search_path=pg_catalog as $$
 select private.progress_lead(p_org,p_id,p_key,p_version,p_action,p_input)
$$;
revoke all on function public.progress_lead(uuid,uuid,uuid,integer,text,jsonb) from public, anon, authenticated;
grant execute on function public.progress_lead(uuid,uuid,uuid,integer,text,jsonb) to authenticated;
