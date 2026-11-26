insert into public.permissions (code, description, requires_mfa)
values ('file.download', 'Download a scanned file within its current parent scope', true);

create table private.file_upload_objects (
  stage_id uuid primary key references private.file_upload_stages(id) on delete restrict,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  stored_at timestamptz,
  scan_lease uuid,
  scan_lease_until timestamptz,
  verdict text check (verdict in ('clean', 'rejected')),
  scanner_version text check (char_length(scanner_version) between 1 and 80),
  scanned_at timestamptz,
  check ((scan_lease is null) = (scan_lease_until is null)),
  check (scan_lease is null or (stored_at is not null and verdict is null)),
  check ((verdict is null) = (scanned_at is null)),
  check ((verdict is null) = (scanner_version is null)),
  check (verdict is null or (stored_at is not null and scanned_at >= stored_at))
);
alter table private.file_upload_objects enable row level security;
revoke all on private.file_upload_objects from public, anon, authenticated, service_role;

-- The Edge handler verifies the access token before passing its user and session claims.
create function private.file_worker_stage(p_user uuid, p_session uuid, p_stage uuid, p_download boolean)
returns private.file_upload_stages
language plpgsql security invoker set search_path = pg_catalog as $$
declare
  stage private.file_upload_stages%rowtype;
  actor uuid;
  parent_type text;
  file_permission text := case when p_download then 'file.download' else 'file.stage' end;
begin
  if p_user is null or p_session is null or p_stage is null or p_download is null then
    raise exception 'File unavailable' using errcode = '42501';
  end if;
  select * into stage from private.file_upload_stages where id = p_stage for update;
  if not found or (not p_download and stage.expires_at <= now()) then
    raise exception 'File unavailable' using errcode = '42501';
  end if;

  perform 1 from auth.sessions
  where id = p_session and user_id = p_user and aal::text = 'aal2'
    and (not_after is null or not_after > now())
  for share;
  if not found then raise exception 'File unavailable' using errcode = '42501'; end if;

  select m.id into actor from public.memberships m
  where m.organization_id = stage.organization_id and m.user_id = p_user and m.status = 'Active'
  for share;
  if actor is null or (not p_download and actor <> stage.uploader_membership_id) then
    raise exception 'File unavailable' using errcode = '42501';
  end if;

  select r.resource_type into parent_type from public.resources r
  where r.id = stage.parent_resource_id and r.organization_id = stage.organization_id
    and r.owner_membership_id = actor and r.archived_at is null
  for share;
  if parent_type is null or (select count(distinct rp.permission_code)
    from public.member_roles mr
    join public.role_permissions rp on (rp.organization_id, rp.role_id) = (mr.organization_id, mr.role_id)
    where mr.organization_id = stage.organization_id and mr.membership_id = actor
      and mr.effective_from <= now() and (mr.effective_to is null or mr.effective_to > now())
      and rp.permission_code in (file_permission, parent_type || '.read')) <> 2 then
    raise exception 'File unavailable' using errcode = '42501';
  end if;
  return stage;
end
$$;
revoke all on function private.file_worker_stage(uuid, uuid, uuid, boolean) from public, anon, authenticated, service_role;

create function private.file_worker_lookup(p_user uuid, p_session uuid, p_stage uuid, p_download boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  stage private.file_upload_stages%rowtype := private.file_worker_stage(p_user, p_session, p_stage, p_download);
  object private.file_upload_objects%rowtype;
begin
  select * into object from private.file_upload_objects where stage_id = stage.id;
  if p_download and object.verdict is distinct from 'clean' then
    raise exception 'File unavailable' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'path', stage.organization_id::text || '/' || stage.object_token::text,
    'name', stage.original_name, 'purpose', stage.purpose, 'mime', stage.declared_mime,
    'size', stage.declared_size_bytes, 'sha256', object.sha256
  );
end
$$;
revoke all on function private.file_worker_lookup(uuid, uuid, uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function private.file_worker_lookup(uuid, uuid, uuid, boolean) to service_role;

create function private.file_worker_transition(
  p_user uuid, p_session uuid, p_stage uuid, p_hash text, p_action text,
  p_lease uuid, p_verdict text, p_scanner text
) returns text language plpgsql security definer set search_path = pg_catalog as $$
declare
  stage private.file_upload_stages%rowtype := private.file_worker_stage(p_user, p_session, p_stage, false);
  object private.file_upload_objects%rowtype;
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$'
     or p_action is null or p_action not in ('claim', 'stored', 'scan', 'verdict') then
    raise exception 'Invalid file operation' using errcode = '22023';
  end if;
  select * into object from private.file_upload_objects where stage_id = stage.id;
  if not found then
    if p_action <> 'claim' then raise sqlstate 'PT409' using message = 'File is not reserved for these bytes'; end if;
    insert into private.file_upload_objects(stage_id, sha256) values (stage.id, p_hash);
    return 'claimed';
  end if;
  if object.sha256 <> p_hash then raise sqlstate 'PT409' using message = 'File is not reserved for these bytes'; end if;
  if object.verdict is not null then return object.verdict; end if;

  case p_action
    when 'claim' then
      return case when object.stored_at is null then 'claimed' else 'stored' end;
    when 'stored' then
      if object.stored_at is null then
        if not exists (select 1 from storage.objects where bucket_id = 'avi-file-quarantine'
            and name = stage.organization_id::text || '/' || stage.object_token::text) then
          raise sqlstate 'PT409' using message = 'Quarantine object is unavailable';
        end if;
        update private.file_upload_objects set stored_at = now() where stage_id = stage.id;
        insert into private.audit_events (organization_id, actor_membership_id, resource_id, action, request_id)
        values (stage.organization_id, stage.uploader_membership_id, stage.parent_resource_id, 'file.stored', stage.id);
      end if;
      return 'stored';
    when 'scan' then
      if object.stored_at is null or p_lease is null then raise sqlstate 'PT409' using message = 'File is not ready to scan'; end if;
      if object.scan_lease_until > now() then return 'scanning'; end if;
      update private.file_upload_objects set scan_lease = p_lease, scan_lease_until = now() + interval '90 seconds'
      where stage_id = stage.id;
      return 'scan_acquired';
    when 'verdict' then
      if p_lease is null or object.scan_lease is distinct from p_lease or object.scan_lease_until <= now()
         or p_verdict is null or p_verdict not in ('clean', 'rejected')
         or coalesce(char_length(p_scanner), 0) not between 1 and 80 or p_scanner ~ '[[:cntrl:]]' then
        raise sqlstate 'PT409' using message = 'Scan verdict is unavailable';
      end if;
      update private.file_upload_objects
      set verdict = p_verdict, scanner_version = p_scanner, scanned_at = now(),
          scan_lease = null, scan_lease_until = null
      where stage_id = stage.id;
      insert into private.audit_events (organization_id, actor_membership_id, resource_id, action, request_id)
      values (stage.organization_id, stage.uploader_membership_id, stage.parent_resource_id, 'file.scan.' || p_verdict, stage.id);
      return p_verdict;
  end case;
end
$$;
revoke all on function private.file_worker_transition(uuid, uuid, uuid, text, text, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function private.file_worker_transition(uuid, uuid, uuid, text, text, uuid, text, text) to service_role;

grant usage on schema private to service_role;

create function public.file_worker_lookup(p_user uuid, p_session uuid, p_stage uuid, p_download boolean)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select private.file_worker_lookup(p_user, p_session, p_stage, p_download)
$$;
revoke all on function public.file_worker_lookup(uuid, uuid, uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.file_worker_lookup(uuid, uuid, uuid, boolean) to service_role;

create function public.file_worker_transition(
  p_user uuid, p_session uuid, p_stage uuid, p_hash text, p_action text,
  p_lease uuid, p_verdict text, p_scanner text
) returns text language sql security invoker set search_path = pg_catalog as $$
  select private.file_worker_transition(p_user, p_session, p_stage, p_hash, p_action, p_lease, p_verdict, p_scanner)
$$;
revoke all on function public.file_worker_transition(uuid, uuid, uuid, text, text, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.file_worker_transition(uuid, uuid, uuid, text, text, uuid, text, text) to service_role;
