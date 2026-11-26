create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
set local search_path = public, extensions, pg_catalog;
alter table public.member_roles drop constraint member_roles_organization_id_membership_id_role_id_key;
alter table public.member_roles add constraint member_roles_no_overlapping_grants
 exclude using gist (
  organization_id with =,
  membership_id with =,
  role_id with =,
  tstzrange(effective_from,effective_to,'[)') with &&
 );
