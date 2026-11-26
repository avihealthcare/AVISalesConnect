-- Database operator command for identities already created in Supabase Auth.
create function private.provision_intake_staff(
 p_org uuid, p_user uuid, p_display_name text, p_employee_code text, p_request_id uuid
)
returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
declare
 staff_role uuid;
 new_member uuid;
 allowed_codes constant text[] := array[
  'account.create','account.read','lead.create','lead.read','lead.contact',
  'lead.qualify','lead.disqualify','lead.convert','opportunity.read'
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
revoke all on function private.provision_intake_staff(uuid,uuid,text,text,uuid) from public, anon, authenticated;
