-- Reuse the quarantine and clean-file pipeline with workflow-specific scope.
-- CRM remains owner-scoped and requires its existing file and parent action permissions.
create function private.file_parent_allowed(
  p_org uuid,p_parent uuid,p_type text,p_owner uuid,p_actor uuid,p_purpose text,p_download boolean
) returns boolean language sql stable security invoker set search_path=pg_catalog as $$
  select case
    when p_actor is null or p_type is null then false
    when p_type='tender' then p_purpose='business_document' and case
      when p_download then private.tender_can_view(p_org,p_parent,p_actor)
      else p_owner=p_actor and private.tender_has_access(p_org,p_actor,'tender.edit')
        and private.tender_has_access(p_org,p_actor,'tender.read')
      end
    when p_type='travel_request' then p_purpose='business_document'
      and private.expense_attachment_allowed(p_org,p_parent,p_actor,not p_download)
    when p_type='expense_claim' then p_purpose in ('receipt','business_document')
      and private.expense_attachment_allowed(p_org,p_parent,p_actor,not p_download)
    when p_type in ('account','lead','opportunity') then p_purpose='business_document' and p_owner=p_actor
      and (select count(distinct rp.permission_code) from public.member_roles mr
        join public.role_permissions rp on (rp.organization_id,rp.role_id)=(mr.organization_id,mr.role_id)
        where mr.organization_id=p_org and mr.membership_id=p_actor
          and mr.effective_from<=now() and (mr.effective_to is null or mr.effective_to>now())
          and rp.permission_code in (case when p_download then 'file.download' else 'file.stage' end,p_type||'.read'))=2
    else false end
$$;
revoke all on function private.file_parent_allowed(uuid,uuid,text,uuid,uuid,text,boolean)
from public,anon,authenticated,service_role;

create or replace function private.reserve_file_stage(
  p_org uuid, p_parent uuid, p_key uuid, p_name text,
  p_purpose text, p_mime text, p_size bigint
) returns uuid language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor uuid;
  parent_type text;
  parent_owner uuid;
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

  select r.resource_type,r.owner_membership_id into parent_type,parent_owner from public.resources r
  where r.organization_id=p_org and r.id=p_parent and r.archived_at is null
  for share;

  if not private.file_parent_allowed(p_org,p_parent,parent_type,parent_owner,actor,p_purpose,false)
    or (parent_type in ('tender','travel_request','expense_claim') and not exists (
      select 1 from auth.sessions s
      where s.user_id=auth.uid() and s.id=nullif(auth.jwt()->>'session_id','')::uuid
        and (s.not_after is null or s.not_after>now())
    )) then
    raise exception 'File reservation access denied' using errcode='42501';
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

create or replace function private.file_worker_stage(p_user uuid, p_session uuid, p_stage uuid, p_download boolean)
returns private.file_upload_stages
language plpgsql security invoker set search_path = pg_catalog as $$
declare
  stage private.file_upload_stages%rowtype;
  actor uuid;
  parent_type text;
  parent_owner uuid;
begin
  if p_user is null or p_session is null or p_stage is null or p_download is null then
    raise exception 'File unavailable' using errcode = '42501';
  end if;
  select * into stage from private.file_upload_stages where id = p_stage for update;
  if not found or (not p_download and stage.expires_at <= now()) then
    raise exception 'File unavailable' using errcode = '42501';
  end if;

  perform 1 from auth.sessions
  where id = p_session and user_id = p_user
    and (not_after is null or not_after > now())
  for share;
  if not found then raise exception 'File unavailable' using errcode = '42501'; end if;

  select m.id into actor from public.memberships m
  where m.organization_id = stage.organization_id and m.user_id = p_user and m.status = 'Active'
  for share;
  if actor is null or (not p_download and actor <> stage.uploader_membership_id) then
    raise exception 'File unavailable' using errcode = '42501';
  end if;

  select r.resource_type,r.owner_membership_id into parent_type,parent_owner from public.resources r
  where r.id=stage.parent_resource_id and r.organization_id=stage.organization_id and r.archived_at is null
  for share;
  if not private.file_parent_allowed(stage.organization_id,stage.parent_resource_id,parent_type,parent_owner,actor,stage.purpose,p_download)
  then raise exception 'File unavailable' using errcode='42501'; end if;
  return stage;
end
$$;
