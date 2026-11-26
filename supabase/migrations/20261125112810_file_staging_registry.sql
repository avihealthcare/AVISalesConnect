-- Fail-closed metadata foundation. No Storage bucket, object policy or upload API is created.
create table private.file_upload_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  parent_resource_id uuid not null,
  uploader_membership_id uuid not null,
  object_token uuid not null default gen_random_uuid() unique,
  original_name text not null check (original_name = trim(original_name) and char_length(original_name) between 1 and 255),
  purpose text not null check (purpose in ('receipt', 'business_document')),
  declared_mime text not null check (declared_mime in ('application/pdf', 'image/png', 'image/jpeg')),
  declared_size_bytes bigint not null check (declared_size_bytes > 0 and declared_size_bytes <= case when purpose = 'receipt' then 10485760 else 26214400 end),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '24 hours'),
  foreign key (organization_id, parent_resource_id) references public.resources(organization_id, id) on delete restrict,
  foreign key (organization_id, uploader_membership_id) references public.memberships(organization_id, id) on delete restrict
);
create index file_upload_stages_expiry_idx on private.file_upload_stages(expires_at);
alter table private.file_upload_stages enable row level security;
revoke all on private.file_upload_stages from public, anon, authenticated;
create trigger file_upload_stages_append_only before update or delete or truncate on private.file_upload_stages
  for each statement execute function private.reject_mutation();
