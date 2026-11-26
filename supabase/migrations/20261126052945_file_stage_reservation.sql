insert into public.permissions (code, description, requires_mfa)
values ('file.stage', 'Reserve private file staging metadata', true);

create index file_upload_stages_actor_time_idx
  on private.file_upload_stages (organization_id, uploader_membership_id, created_at desc);

create function private.reserve_file_stage(
  p_org uuid, p_parent uuid, p_key uuid, p_name text,
  p_purpose text, p_mime text, p_size bigint
) returns uuid language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor uuid;
  parent_type text;
  display_name text := trim(p_name);
  request_hash text;
  prior private.operation_receipts%rowtype;
  stage_id uuid;
begin
  if p_org is null or p_parent is null or p_key is null
    or display_name is null or char_length(display_name) not between 1 and 255
    or display_name in ('.', '..') or display_name ~ '[[:cntrl:]/]'
    or strpos(display_name, chr(92)) > 0
    or p_purpose is null or p_purpose not in ('receipt', 'business_document')
    or p_mime is null or p_mime not in ('application/pdf', 'image/jpeg', 'image/png')
    or p_size is null or p_size not between 1 and
      (case when p_purpose = 'receipt' then 10485760 else 26214400 end)
  then
    raise exception 'Invalid file reservation' using errcode = '22023';
  end if;

  select id into actor from public.memberships
  where organization_id = p_org and user_id = auth.uid() and status = 'Active'
  for share;

  select resource_type into parent_type from public.resources
  where organization_id = p_org and id = p_parent and owner_membership_id = actor and archived_at is null
  for share;

  if parent_type is null
    or (p_purpose = 'receipt' and parent_type <> 'expense_claim')
    or (p_purpose = 'business_document' and parent_type not in ('account', 'lead', 'opportunity'))
    or (select count(distinct p.code)
        from public.member_roles mr
        join public.roles r on (r.organization_id, r.id) = (mr.organization_id, mr.role_id)
        join public.role_permissions rp on (rp.organization_id, rp.role_id) = (r.organization_id, r.id)
        join public.permissions p on p.code = rp.permission_code
        where mr.organization_id = p_org and mr.membership_id = actor
          and mr.effective_from <= now() and (mr.effective_to is null or mr.effective_to > now())
          and (not (r.requires_mfa or p.requires_mfa) or auth.jwt()->>'aal' = 'aal2')
          and p.code in ('file.stage', parent_type || '.read')) <> 2
  then
    raise exception 'File reservation access denied' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':' || p_key::text, 0));
  request_hash := encode(sha256(convert_to(
    jsonb_build_array(p_parent, display_name, p_purpose, p_mime, p_size)::text, 'UTF8'
  )), 'hex');

  select r.* into prior from private.operation_receipts r
  where r.organization_id = p_org and r.actor_membership_id = actor and r.operation_key = p_key;
  if found then
    if prior.command_type <> 'file.stage' or prior.request_hash <> request_hash then
      raise sqlstate 'PT409' using message = 'Operation key is already in use';
    end if;
    return (prior.response_snapshot->>'id')::uuid;
  end if;

  -- Serialize distinct operation keys for the same membership before checking its quota.
  perform pg_advisory_xact_lock(hashtext('avi-file-stage-quota'), hashtext(actor::text));
  if (select count(*) from private.file_upload_stages
      where organization_id = p_org and uploader_membership_id = actor
        and created_at > now() - interval '1 hour') >= 20 then
    raise sqlstate 'PT429' using message = 'File reservation limit reached';
  end if;

  insert into private.file_upload_stages (
    organization_id, parent_resource_id, uploader_membership_id,
    original_name, purpose, declared_mime, declared_size_bytes, expires_at
  ) values (
    p_org, p_parent, actor, display_name, p_purpose, p_mime, p_size, now() + interval '1 hour'
  ) returning id into stage_id;

  insert into private.audit_events (organization_id, actor_membership_id, resource_id, action, request_id)
  values (p_org, actor, p_parent, 'file.stage', p_key);
  insert into private.operation_receipts (
    organization_id, actor_membership_id, operation_key, command_type, request_hash, response_snapshot
  ) values (p_org, actor, p_key, 'file.stage', request_hash, jsonb_build_object('id', stage_id));

  return stage_id;
end
$$;
revoke all on function private.reserve_file_stage(uuid, uuid, uuid, text, text, text, bigint) from public, anon, authenticated;
grant execute on function private.reserve_file_stage(uuid, uuid, uuid, text, text, text, bigint) to authenticated;

create function public.reserve_file_stage(
  p_org uuid, p_parent uuid, p_key uuid, p_name text,
  p_purpose text, p_mime text, p_size bigint
) returns uuid language sql security invoker set search_path = pg_catalog as $$
  select private.reserve_file_stage(p_org, p_parent, p_key, p_name, p_purpose, p_mime, p_size)
$$;
revoke all on function public.reserve_file_stage(uuid, uuid, uuid, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.reserve_file_stage(uuid, uuid, uuid, text, text, text, bigint) to authenticated;
