create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.roles (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 code text not null check (char_length(trim(code)) between 1 and 80),
 name text not null check (char_length(trim(name)) between 1 and 200),
 requires_mfa boolean not null default false,
 unique (organization_id,id), unique (organization_id,code)
);
create table public.permissions (
 code text primary key check (char_length(trim(code)) between 1 and 100),
 description text not null check (char_length(trim(description)) between 1 and 500)
);
create table public.role_permissions (
 organization_id uuid not null,
 role_id uuid not null,
 permission_code text not null references public.permissions(code) on delete restrict,
 primary key (organization_id,role_id,permission_code),
 foreign key (organization_id,role_id) references public.roles(organization_id,id) on delete restrict
);
create table public.member_roles (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 membership_id uuid not null,
 role_id uuid not null,
 effective_from timestamptz not null,
 effective_to timestamptz,
 check (effective_to is null or effective_to > effective_from),
 unique (organization_id,membership_id,role_id),
 foreign key (organization_id,membership_id) references public.memberships(organization_id,id) on delete restrict,
 foreign key (organization_id,role_id) references public.roles(organization_id,id) on delete restrict
);
create index member_roles_member_idx on public.member_roles(organization_id,membership_id,effective_from,effective_to);
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.member_roles enable row level security;
revoke all on public.roles, public.permissions, public.role_permissions, public.member_roles from public, anon, authenticated;
grant select on public.roles, public.permissions, public.role_permissions, public.member_roles to authenticated;
create policy member_roles_self on public.member_roles for select to authenticated using (
 effective_from <= now() and (effective_to is null or effective_to > now()) and exists (
  select 1 from public.memberships m where m.organization_id=member_roles.organization_id and m.id=member_roles.membership_id and m.user_id=(select auth.uid()) and m.status='Active'
 )
);
create policy roles_assigned on public.roles for select to authenticated using (
 exists (select 1 from public.member_roles mr where mr.organization_id=roles.organization_id and mr.role_id=roles.id)
);
create policy role_permissions_assigned on public.role_permissions for select to authenticated using (
 exists (select 1 from public.member_roles mr where mr.organization_id=role_permissions.organization_id and mr.role_id=role_permissions.role_id)
);
create policy permissions_assigned on public.permissions for select to authenticated using (
 exists (select 1 from public.role_permissions rp where rp.permission_code=permissions.code)
);
grant update (display_name,phone) on public.profiles to authenticated;
create policy profile_update_self_active on public.profiles for update to authenticated
 using (id=(select auth.uid()) and exists(select 1 from public.memberships m where m.user_id=profiles.id and m.status='Active'))
 with check (id=(select auth.uid()) and exists(select 1 from public.memberships m where m.user_id=profiles.id and m.status='Active'));

create table private.audit_events (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 actor_membership_id uuid,
 resource_id uuid,
 action text not null check (char_length(trim(action)) between 1 and 100),
 request_id uuid not null,
 occurred_at timestamptz not null default now(),
 redacted_details jsonb not null default '{}'::jsonb,
 foreign key (organization_id,actor_membership_id) references public.memberships(organization_id,id) on delete restrict,
 foreign key (organization_id,resource_id) references public.resources(organization_id,id) on delete restrict
);
create index audit_events_org_time_idx on private.audit_events(organization_id,occurred_at desc);
create table private.operation_receipts (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 actor_membership_id uuid not null,
 operation_key uuid not null,
 command_type text not null check (char_length(trim(command_type)) between 1 and 100),
 request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
 response_snapshot jsonb not null,
 completed_at timestamptz not null default now(),
 unique (organization_id,actor_membership_id,operation_key),
 foreign key (organization_id,actor_membership_id) references public.memberships(organization_id,id) on delete restrict
);
revoke all on private.audit_events, private.operation_receipts from public, anon, authenticated;
