-- Read-only identity foundation. Administrative provisioning is deliberately not exposed.
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 200),
  timezone text not null check (char_length(timezone) between 1 and 100),
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  financial_year_start_month smallint not null check (financial_year_start_month between 1 and 12),
  created_at timestamptz not null default now()
);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (char_length(trim(display_name)) between 1 and 200),
  phone text check (phone is null or char_length(phone) <= 40)
);
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  status text not null check (status in ('Active', 'Inactive')),
  employee_code text check (employee_code is null or char_length(trim(employee_code)) between 1 and 100),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, user_id),
  unique (organization_id, employee_code)
);
create table public.resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  resource_type text not null check (resource_type in ('account','site','contact','product','document','lead','opportunity','activity','task','quotation','booking','financial_reference','visit_plan','attendance_session','visit','tender','tender_security','tender_award','travel_request','expense_claim','travel_advance','reimbursement','approval_request')),
  owner_membership_id uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, owner_membership_id) references public.memberships(organization_id, id) on delete restrict
);
create index memberships_user_active_idx on public.memberships (user_id, organization_id) where status = 'Active';
create index resources_owner_idx on public.resources (organization_id, owner_membership_id);

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.resources enable row level security;
revoke all on public.organizations, public.profiles, public.memberships, public.resources from public, anon, authenticated;
grant select on public.organizations, public.profiles, public.memberships, public.resources to authenticated;

create policy membership_self_active on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) and status = 'Active');
create policy organization_active_member on public.organizations for select to authenticated
  using (exists (select 1 from public.memberships m where m.organization_id = organizations.id and m.user_id = (select auth.uid()) and m.status = 'Active'));
create policy profile_self_active on public.profiles for select to authenticated
  using (id = (select auth.uid()) and exists (select 1 from public.memberships m where m.user_id = profiles.id and m.status = 'Active'));
create policy resource_owner_active on public.resources for select to authenticated
  using (exists (select 1 from public.memberships m where m.organization_id = resources.organization_id and m.id = resources.owner_membership_id and m.user_id = (select auth.uid()) and m.status = 'Active'));
