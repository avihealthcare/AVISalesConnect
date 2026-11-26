drop policy resource_owner_active on public.resources;
create policy resource_owner_active on public.resources for select to authenticated
 using (
  exists (select 1 from public.memberships m
   where m.organization_id=resources.organization_id
    and m.id=resources.owner_membership_id
    and m.user_id=(select auth.uid()) and m.status='Active')
  and private.has_permission(organization_id, resource_type || '.read')
 );
