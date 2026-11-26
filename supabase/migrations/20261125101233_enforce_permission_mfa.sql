alter table public.permissions add column requires_mfa boolean not null default true;
create or replace function private.has_permission(p_organization_id uuid, p_permission_code text)
returns boolean language sql stable security invoker set search_path=pg_catalog as $$
 select exists (
  select 1 from public.member_roles mr
  join public.roles r on r.organization_id=mr.organization_id and r.id=mr.role_id
  join public.role_permissions rp on rp.organization_id=r.organization_id and rp.role_id=r.id
  join public.permissions p on p.code=rp.permission_code
  where mr.organization_id=p_organization_id and rp.permission_code=p_permission_code
   and (not (r.requires_mfa or p.requires_mfa) or (select auth.jwt()->>'aal')='aal2')
 );
$$;
revoke all on function private.has_permission(uuid,text) from public, anon, authenticated;
grant execute on function private.has_permission(uuid,text) to authenticated;
