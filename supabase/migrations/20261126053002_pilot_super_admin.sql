insert into public.permissions (code,description,requires_mfa) values
 ('staff.directory.read','Read the organization staff directory',true),
 ('staff.deactivate','Deactivate eligible organization staff',true);

create function private.provision_pilot_super_admin(
 p_org uuid,p_user uuid,p_display_name text,p_key uuid
) returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
declare
 admin_role uuid;
 member_id uuid;
begin
 if p_org is null or p_user is null or p_key is null then
  raise exception 'Organization, Auth user and request ID are required' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('pilot-super-admin:'||p_org::text,0));
 if exists (select 1 from public.roles where organization_id=p_org and code='super_admin') then
  raise exception 'Pilot super administrator already provisioned' using errcode='PT409';
 end if;
 member_id := private.provision_intake_staff(p_org,p_user,p_display_name,null,p_key);
 insert into public.roles (organization_id,code,name,requires_mfa)
 values (p_org,'super_admin','Super Administrator',true) returning id into admin_role;
 insert into public.role_permissions (organization_id,role_id,permission_code) values
 (p_org,admin_role,'staff.directory.read'),(p_org,admin_role,'staff.deactivate');
 insert into public.member_roles (organization_id,membership_id,role_id,effective_from)
 values (p_org,member_id,admin_role,now());
 insert into private.audit_events (organization_id,action,request_id,redacted_details)
 values (p_org,'staff.pilot_super_admin.provision',p_key,jsonb_build_object('membership_id',member_id));
 return member_id;
end
$$;
revoke all on function private.provision_pilot_super_admin(uuid,uuid,text,uuid) from public, anon, authenticated;

create function private.staff_admin_actor(p_org uuid,p_permission text) returns uuid
language sql stable security invoker set search_path=pg_catalog as $$
 select m.id from public.memberships m
 where auth.jwt()->>'aal'='aal2' and m.organization_id=p_org
  and m.user_id=auth.uid() and m.status='Active'
  and exists (
   select 1 from public.member_roles mr join public.role_permissions rp
    on (mr.organization_id,mr.role_id)=(rp.organization_id,rp.role_id)
   where mr.organization_id=p_org and mr.membership_id=m.id and rp.permission_code=p_permission
    and mr.effective_from<=now() and (mr.effective_to is null or mr.effective_to>now())
  )
$$;
revoke all on function private.staff_admin_actor(uuid,text) from public, anon, authenticated;

create function private.staff_directory(p_org uuid)
returns table (membership_id uuid,display_name text,status text,can_deactivate boolean)
language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid := private.staff_admin_actor(p_org,'staff.directory.read');
begin
 if actor is null then raise exception 'Staff directory access denied' using errcode='42501'; end if;
 return query
 select m.id,p.display_name,m.status,
  m.status='Active' and m.id<>actor and private.staff_admin_actor(p_org,'staff.deactivate') is not null
  and not exists (
   select 1 from public.member_roles mr join public.roles r
    on (mr.organization_id,mr.role_id)=(r.organization_id,r.id)
   where mr.organization_id=p_org and mr.membership_id=m.id and r.code='super_admin'
    and mr.effective_from<=now() and (mr.effective_to is null or mr.effective_to>now())
  )
 from public.memberships m join public.profiles p on p.id=m.user_id
 where m.organization_id=p_org order by p.display_name,m.id;
end
$$;
revoke all on function private.staff_directory(uuid) from public, anon, authenticated;
grant execute on function private.staff_directory(uuid) to authenticated;

create function private.deactivate_staff(p_org uuid,p_member uuid,p_key uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare
 actor uuid := private.staff_admin_actor(p_org,'staff.deactivate');
 status_before text;
 prior private.operation_receipts%rowtype;
 payload_hash text;
begin
 if actor is null or actor=p_member or p_member is null or p_key is null then
  raise exception 'Staff deactivation access denied' using errcode='42501';
 end if;
 perform 1 from public.memberships where organization_id=p_org and id=actor and status='Active' for share;
 if not found then raise exception 'Staff deactivation access denied' using errcode='42501'; end if;
 select status into status_before from public.memberships where organization_id=p_org and id=p_member for update;
 if status_before is null or exists (
   select 1 from public.member_roles mr join public.roles r
    on (mr.organization_id,mr.role_id)=(r.organization_id,r.id)
   where mr.organization_id=p_org and mr.membership_id=p_member and r.code='super_admin'
    and mr.effective_from<=now() and (mr.effective_to is null or mr.effective_to>now())
 ) then raise exception 'Staff deactivation access denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_key::text,0));
 payload_hash := encode(sha256(convert_to(p_member::text,'UTF8')),'hex');
 select * into prior from private.operation_receipts
 where organization_id=p_org and actor_membership_id=actor and operation_key=p_key;
 if found then
  if prior.command_type<>'staff.deactivate' or prior.request_hash<>payload_hash then
   raise sqlstate 'PT409' using message='Operation key is already in use';
  end if;
  return (prior.response_snapshot->>'id')::uuid;
 end if;
 if status_before<>'Active' then raise sqlstate 'PT409' using message='Staff member is already inactive'; end if;
 if exists (select 1 from public.resources where organization_id=p_org and owner_membership_id=p_member and archived_at is null)
 then raise sqlstate 'PT409' using message='Reassign open records before deactivating this member'; end if;
 update public.memberships set status='Inactive' where organization_id=p_org and id=p_member;
 insert into private.audit_events (organization_id,actor_membership_id,action,request_id,redacted_details)
 values (p_org,actor,'staff.deactivate',p_key,jsonb_build_object('membership_id',p_member,'previous_status',status_before,'status','Inactive'));
 insert into private.operation_receipts (organization_id,actor_membership_id,operation_key,command_type,request_hash,response_snapshot)
 values (p_org,actor,p_key,'staff.deactivate',payload_hash,jsonb_build_object('id',p_member));
 return p_member;
end
$$;
revoke all on function private.deactivate_staff(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function private.deactivate_staff(uuid,uuid,uuid) to authenticated;

create function public.staff_directory(p_org uuid)
returns table (membership_id uuid,display_name text,status text,can_deactivate boolean)
language sql stable security invoker set search_path=pg_catalog as $$
 select * from private.staff_directory(p_org)
$$;
revoke all on function public.staff_directory(uuid) from public, anon, authenticated;
grant execute on function public.staff_directory(uuid) to authenticated;

create function public.deactivate_staff(p_org uuid,p_member uuid,p_key uuid) returns uuid
language sql security invoker set search_path=pg_catalog as $$
 select private.deactivate_staff(p_org,p_member,p_key)
$$;
revoke all on function public.deactivate_staff(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.deactivate_staff(uuid,uuid,uuid) to authenticated;
