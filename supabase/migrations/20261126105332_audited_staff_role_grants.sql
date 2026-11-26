alter table public.roles add column delegable boolean not null default false;
insert into public.permissions (code, description, requires_mfa)
values ('staff.role.manage', 'Grant or revoke explicitly delegable staff roles', true);

create function private.change_staff_role(
 p_org uuid, p_member uuid, p_role uuid, p_action text, p_key uuid
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare
 actor uuid := private.staff_admin_actor(p_org,'staff.role.manage');
 grant_id uuid;
 prior private.operation_receipts%rowtype;
 payload_hash text;
begin
 if actor is null or p_member is null or actor = p_member then
  raise exception 'Staff role access denied' using errcode='42501';
 end if;
 if p_key is null or p_role is null or p_action is null or p_action not in ('grant','revoke') then
  raise exception 'Invalid staff role request' using errcode='22023';
 end if;
 perform 1 from public.memberships where organization_id = p_org and id = actor and status = 'Active' for share;
 if not found then raise exception 'Staff role access denied' using errcode='42501'; end if;
 perform 1 from public.roles
 where organization_id = p_org and id = p_role and delegable and code <> 'super_admin'
 for share;
 if not found or exists (
  select 1 from public.role_permissions where organization_id = p_org and role_id = p_role
    and starts_with(permission_code,'staff.')
 ) then raise exception 'Staff role access denied' using errcode='42501'; end if;

 perform 1 from public.memberships where organization_id = p_org and id = p_member and status = 'Active' for update;
 if not found or exists (
   select 1 from public.member_roles mr join public.roles r
    on (r.organization_id,r.id) = (mr.organization_id,mr.role_id)
   where mr.organization_id = p_org and mr.membership_id = p_member and r.code = 'super_admin'
    and mr.effective_from <= now() and (mr.effective_to is null or mr.effective_to > now())
 ) then raise exception 'Staff role access denied' using errcode='42501'; end if;

 perform pg_advisory_xact_lock(hashtextextended(actor::text || ':' || p_key::text,0));
 payload_hash := encode(sha256(convert_to(jsonb_build_array(p_member,p_role,p_action)::text,'UTF8')),'hex');
 select * into prior from private.operation_receipts
 where organization_id = p_org and actor_membership_id = actor and operation_key = p_key;
 if found then
   if prior.command_type <> 'staff.role' or prior.request_hash <> payload_hash then
    raise sqlstate 'PT409' using message='Operation key is already in use';
   end if;
   return (prior.response_snapshot->>'id')::uuid;
 end if;

 if p_action = 'grant' then
  if exists (select 1 from public.member_roles
     where organization_id = p_org and membership_id = p_member and role_id = p_role
       and (effective_to is null or effective_to > now())) then
    raise sqlstate 'PT409' using message='Role grant already exists';
  end if;
  insert into public.member_roles (organization_id,membership_id,role_id,effective_from)
  values (p_org,p_member,p_role,now()) returning id into grant_id;
 else
  update public.member_roles set effective_to = clock_timestamp()
  where organization_id = p_org and membership_id = p_member and role_id = p_role
    and effective_from <= now() and (effective_to is null or effective_to > now())
  returning id into grant_id;
  if not found then raise sqlstate 'PT409' using message='Active role grant unavailable'; end if;
 end if;
 insert into private.audit_events (organization_id,actor_membership_id,action,request_id,redacted_details)
 values (p_org,actor,'staff.role.' || p_action,p_key,jsonb_build_object('membership_id',p_member,'role_id',p_role,'grant_id',grant_id));
 insert into private.operation_receipts (organization_id,actor_membership_id,operation_key,command_type,request_hash,response_snapshot)
 values (p_org,actor,p_key,'staff.role',payload_hash,jsonb_build_object('id',grant_id));
 return grant_id;
end
$$;
revoke all on function private.change_staff_role(uuid,uuid,uuid,text,uuid) from public, anon, authenticated;
grant execute on function private.change_staff_role(uuid,uuid,uuid,text,uuid) to authenticated;

create function public.change_staff_role(p_org uuid, p_member uuid, p_role uuid, p_action text, p_key uuid)
returns uuid language sql security invoker set search_path=pg_catalog as $$
 select private.change_staff_role(p_org,p_member,p_role,p_action,p_key)
$$;
revoke all on function public.change_staff_role(uuid,uuid,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.change_staff_role(uuid,uuid,uuid,text,uuid) to authenticated;
