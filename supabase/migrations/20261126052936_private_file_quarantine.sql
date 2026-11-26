insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avi-file-quarantine', 'avi-file-quarantine', false, 26214400,
  array['application/pdf', 'image/jpeg', 'image/png']
);

-- A broad permissive policy for another workflow must never expose pending bytes.
create policy avi_quarantine_blocks_application_roles
  on storage.objects as restrictive for all to anon, authenticated
  using (bucket_id <> 'avi-file-quarantine')
  with check (bucket_id <> 'avi-file-quarantine');
