insert into public.permissions (code, description, requires_mfa)
values ('staff.reassign', 'Transfer open CRM records during staff offboarding', true);

create function private.offboard_staff(
 p_org uuid, p_member uuid, p_successor uuid, p_key uuid
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare
 actor uuid := private.staff_admin_actor(p_org,'staff.reassign');
 payload_hash text;
 prior private.operation_receipts%rowtype;
 moved_count integer;
begin
 if actor is null or actor is distinct from private.staff_admin_actor(p_org,'staff.deactivate')
    or p_member is null or p_successor is null or p_key is null
    or actor in (p_member,p_successor) or p_member = p_successor then
  raise exception 'Staff handover access denied' using errcode='42501';
 end if;
 perform 1 from public.memberships
 where organization_id = p_org and id in (actor,p_member,p_successor) order by id for update;
 if private.staff_admin_actor(p_org,'staff.reassign') is distinct from actor
    or private.staff_admin_actor(p_org,'staff.deactivate') is distinct from actor
    or not exists (select 1 from public.memberships
     where organization_id = p_org and id = p_successor and status = 'Active') then
  raise exception 'Staff handover access denied' using errcode='42501';
 end if;

 perform pg_advisory_xact_lock(hashtextextended(actor::text || ':' || p_key::text,0));
 payload_hash := encode(sha256(convert_to(jsonb_build_array(p_member,p_successor)::text,'UTF8')),'hex');
 select * into prior from private.operation_receipts
 where organization_id = p_org and actor_membership_id = actor and operation_key = p_key;
 if found then
  if prior.command_type <> 'staff.offboard' or prior.request_hash <> payload_hash then
   raise sqlstate 'PT409' using message='Operation key is already in use';
  end if;
  return (prior.response_snapshot->>'id')::uuid;
 end if;

 if not exists (select 1 from public.memberships
    where organization_id = p_org and id = p_member and status = 'Active') then
  raise exception 'Staff handover access denied' using errcode='42501';
 end if;

 if exists (
  select 1 from public.resources resource
  where resource.organization_id = p_org and resource.owner_membership_id = p_member and resource.archived_at is null
  and (resource.resource_type not in ('account','lead','opportunity') or not exists (
   select 1 from public.member_roles mr
   join public.role_permissions rp on (rp.organization_id,rp.role_id) = (mr.organization_id,mr.role_id)
   where mr.organization_id = p_org and mr.membership_id = p_successor and mr.effective_from <= now()
    and (mr.effective_to is null or mr.effective_to > now())
    and rp.permission_code = resource.resource_type || '.read'
  ))
 ) then raise sqlstate 'PT409' using message='A successor needs access to every open record'; end if;

 with transferred as (
  update public.resources set owner_membership_id = p_successor
  where organization_id = p_org and owner_membership_id = p_member and archived_at is null
  returning id
 )
 insert into private.audit_events (organization_id,actor_membership_id,resource_id,action,request_id,redacted_details)
 select p_org,actor,id,'resource.owner.transfer',p_key,
  jsonb_build_object('previous_owner_id',p_member,'owner_id',p_successor)
 from transferred;
 get diagnostics moved_count = row_count;

 perform private.deactivate_staff(p_org,p_member,gen_random_uuid());
 insert into private.audit_events (organization_id,actor_membership_id,action,request_id,redacted_details)
 values (p_org,actor,'staff.offboard',p_key,
  jsonb_build_object('membership_id',p_member,'successor_id',p_successor,'records_transferred',moved_count));
 insert into private.operation_receipts (organization_id,actor_membership_id,operation_key,command_type,request_hash,response_snapshot)
 values (p_org,actor,p_key,'staff.offboard',payload_hash,jsonb_build_object('id',p_member));
 return p_member;
end
$$;
revoke all on function private.offboard_staff(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function private.offboard_staff(uuid,uuid,uuid,uuid) to authenticated;

create function public.offboard_staff(p_org uuid,p_member uuid,p_successor uuid,p_key uuid)
returns uuid language sql security invoker set search_path=pg_catalog as $$
 select private.offboard_staff(p_org,p_member,p_successor,p_key)
$$;
revoke all on function public.offboard_staff(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.offboard_staff(uuid,uuid,uuid,uuid) to authenticated;
