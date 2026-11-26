-- Email/password authentication is sufficient for assigned permissions.
-- Keep former MFA flags as compatibility metadata for existing integrations.
alter table public.permissions alter column requires_mfa set default false;
update public.permissions set requires_mfa=false where requires_mfa;
update public.roles set requires_mfa=false where requires_mfa;

comment on column public.permissions.requires_mfa is
  'Legacy compatibility metadata. Authorization does not use this field.';
comment on column public.roles.requires_mfa is
  'Legacy compatibility metadata. Authorization does not use this field.';


create or replace function private.has_permission(p_organization_id uuid, p_permission_code text)
returns boolean language sql stable security invoker set search_path=pg_catalog as $$
 select exists (
  select 1 from public.member_roles mr
  join public.roles r on r.organization_id=mr.organization_id and r.id=mr.role_id
  join public.role_permissions rp on rp.organization_id=r.organization_id and rp.role_id=r.id
  join public.permissions p on p.code=rp.permission_code
  where mr.organization_id=p_organization_id and rp.permission_code=p_permission_code
 );
$$;

create or replace function private.create_intake_record(p_org uuid,p_key uuid,p_kind text,p_input jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare
 actor uuid;
 record_id uuid;
 account_link uuid;
 input_hash text;
 prior private.operation_receipts%rowtype;
 allowed_keys text[];
 receipt_time timestamptz;
begin
 if p_org is null or p_key is null or p_kind is null or p_kind not in ('lead','account')
    or jsonb_typeof(p_input) is distinct from 'object' then
  raise exception 'Invalid intake request' using errcode='22023';
 end if;
 allowed_keys := case p_kind
  when 'account' then array['name','account_type']
  else array['prospect_name','source','received_at','contact_route','missing_contact_reason','requirement_text','account_id']
 end;
 if exists (select 1 from jsonb_each(p_input) j where not(j.key=any(allowed_keys)) or jsonb_typeof(j.value) not in ('string','null')) then
  raise exception 'Invalid intake fields' using errcode='22023';
 end if;
 select m.id into actor from public.memberships m
 where m.organization_id=p_org and m.user_id=auth.uid() and m.status='Active'
 for share;
 if actor is null or not exists (
  select 1 from public.member_roles mr
  join public.roles r on (r.organization_id,r.id)=(mr.organization_id,mr.role_id)
  join public.role_permissions rp on (rp.organization_id,rp.role_id)=(r.organization_id,r.id)
  join public.permissions p on p.code=rp.permission_code
  where mr.organization_id=p_org and mr.membership_id=actor
    and rp.permission_code=p_kind||'.create'
    and mr.effective_from<=now() and (mr.effective_to is null or mr.effective_to>now())
 ) then
  raise exception 'Intake access denied' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_key::text,0));
 input_hash := encode(sha256(convert_to(p_input::text,'UTF8')),'hex');
 select * into prior from private.operation_receipts
 where organization_id=p_org and actor_membership_id=actor and operation_key=p_key;
 if found then
  if prior.command_type<>p_kind||'.create' or prior.request_hash<>input_hash then
   raise sqlstate 'PT409' using message='Operation key is already in use';
  end if;
  return (prior.response_snapshot->>'id')::uuid;
 end if;
 if p_kind='lead' then
  if coalesce(p_input->>'source','') not in ('Telephone','Email','WhatsApp','Website','Referral','Event','Other','CSV')
    or coalesce(p_input->>'received_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
   raise exception 'Manual or CSV source and a timestamp with offset are required' using errcode='22023';
  end if;
  receipt_time := (p_input->>'received_at')::timestamptz;
  if receipt_time>now() then raise exception 'Lead receipt cannot be in the future' using errcode='22023'; end if;
  account_link := (p_input->>'account_id')::uuid;
  if account_link is not null and not exists (
    select 1 from public.accounts a
    join public.resources ar on (ar.organization_id,ar.id)=(a.organization_id,a.id)
    join public.member_roles mr on mr.organization_id=ar.organization_id and mr.membership_id=actor
    join public.roles r on (r.organization_id,r.id)=(mr.organization_id,mr.role_id)
    join public.role_permissions rp on (rp.organization_id,rp.role_id)=(r.organization_id,r.id)
    join public.permissions p on p.code=rp.permission_code
    where a.organization_id=p_org and a.id=account_link and ar.owner_membership_id=actor and ar.archived_at is null
     and p.code='account.read' and mr.effective_from<=now() and (mr.effective_to is null or mr.effective_to>now())
  ) then raise exception 'Account unavailable' using errcode='42501'; end if;
 end if;
 insert into public.resources(organization_id,resource_type,owner_membership_id)
 values(p_org,p_kind,actor) returning id into record_id;
 if p_kind='account' then
  insert into public.accounts(id,organization_id,name,account_type)
  values(record_id,p_org,trim(p_input->>'name'),p_input->>'account_type');
 else
  insert into public.leads(id,organization_id,source,received_at,prospect_name,contact_route,missing_contact_reason,requirement_text,account_id)
  values(record_id,p_org,p_input->>'source',receipt_time,trim(p_input->>'prospect_name'),
   nullif(trim(p_input->>'contact_route'),''),nullif(trim(p_input->>'missing_contact_reason'),''),
   p_input->>'requirement_text',account_link);
 end if;
 insert into private.audit_events(organization_id,actor_membership_id,resource_id,action,request_id)
 values(p_org,actor,record_id,p_kind||'.create',p_key);
 insert into private.operation_receipts(organization_id,actor_membership_id,operation_key,command_type,request_hash,response_snapshot)
 values(p_org,actor,p_key,p_kind||'.create',input_hash,jsonb_build_object('id',record_id));
 return record_id;
end
$$;

create or replace function private.intake_actor_can(p_org uuid,p_actor uuid,p_code text)
returns boolean language sql stable security invoker set search_path=pg_catalog as $$
 select exists (
  select 1 from public.member_roles mr
  join public.roles r on (r.organization_id,r.id)=(mr.organization_id,mr.role_id)
  join public.role_permissions rp on (rp.organization_id,rp.role_id)=(r.organization_id,r.id)
  join public.permissions p on p.code=rp.permission_code
  where mr.organization_id=p_org and mr.membership_id=p_actor and p.code=p_code
    and mr.effective_from<=now() and (mr.effective_to is null or mr.effective_to>now())
 )
$$;

create or replace function private.provision_intake_staff(
 p_org uuid, p_user uuid, p_display_name text, p_employee_code text, p_request_id uuid
)
returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
declare
 staff_role uuid;
 new_member uuid;
 allowed_codes constant text[] := array[
  'account.create','account.read','lead.create','lead.read','lead.contact',
  'lead.qualify','lead.disqualify','lead.convert','opportunity.read','opportunity.edit_pipeline'
 ];
begin
 if p_org is null or p_user is null or p_request_id is null
    or coalesce(length(trim(p_display_name)),0) not between 1 and 200 then
  raise exception 'Organization, Auth identity, name, and request ID are required' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('provision-intake:'||p_org::text,0));
 if not exists(select 1 from auth.users where id=p_user) then
  raise exception 'Create the identity in Supabase Auth first' using errcode='22023';
 end if;
 if exists (select 1 from public.memberships where organization_id=p_org and user_id=p_user) then
  raise exception 'This identity already has a membership in the organization' using errcode='23505';
 end if;
 insert into public.roles (organization_id,code,name)
 values(p_org,'intake_staff','Intake Staff')
 on conflict (organization_id,code) do nothing returning id into staff_role;
 if staff_role is not null then
  insert into public.role_permissions(organization_id,role_id,permission_code)
  select p_org,staff_role,code from public.permissions where code=any(allowed_codes);
 else
  select id into staff_role from public.roles
   where organization_id=p_org and code='intake_staff' for update;
 end if;
 if staff_role is null or (
   select array_agg(permission_code order by permission_code)
   from public.role_permissions where organization_id=p_org and role_id=staff_role
  ) is distinct from (select array_agg(code order by code) from unnest(allowed_codes) as codes(code)) then
  raise exception 'The intake role permission bundle differs from the expected bundle' using errcode='22023';
 end if;
 insert into public.profiles (id,display_name) values(p_user,trim(p_display_name))
 on conflict (id) do nothing;
 insert into public.memberships(organization_id,user_id,status,employee_code)
 values(p_org,p_user,'Active',nullif(trim(p_employee_code),'')) returning id into new_member;
 insert into public.member_roles(organization_id,membership_id,role_id,effective_from)
 values(p_org,new_member,staff_role,now());
 insert into private.audit_events(organization_id,action,request_id,redacted_details)
 values(p_org,'staff.provision',p_request_id,jsonb_build_object('membership_id',new_member,'role','intake_staff'));
 return new_member;
end
$$;

create or replace function private.reserve_file_stage(
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

create or replace function private.has_crm_record_share(p_org uuid,p_resource uuid,p_owner uuid)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select auth.uid() is not null and exists (
  select 1 from private.crm_record_shares s
  join public.memberships recipient on (recipient.organization_id,recipient.id)=(s.organization_id,s.recipient_membership_id)
  join public.memberships owner on (owner.organization_id,owner.id)=(s.organization_id,s.owner_membership_id)
  where s.organization_id=p_org and s.resource_id=p_resource and s.owner_membership_id=p_owner
   and recipient.user_id=auth.uid() and recipient.status='Active' and owner.status='Active'
   and s.revoked_at is null and s.expires_at>now()
 )
$$;

create or replace function private.change_crm_record_share(
 p_org uuid,p_resource uuid,p_recipient uuid,p_key uuid,p_action text,p_expires_at timestamptz
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare
 actor uuid;
 kind text;
 payload_hash text;
 prior private.operation_receipts%rowtype;
 share_id uuid;
begin
 if p_org is null or p_resource is null or p_recipient is null or p_key is null
    or p_action is null or p_action not in ('grant','revoke')
    or (p_action='grant' and (p_expires_at is null or not isfinite(p_expires_at)))
    or (p_action='revoke' and p_expires_at is not null) then
  raise exception 'Invalid share request' using errcode='22023';
 end if;

 select id into actor from public.memberships
 where organization_id=p_org and user_id=auth.uid() and status='Active' for share;
 if actor is null or actor=p_recipient then
  raise exception 'Share access denied' using errcode='42501';
 end if;
 select resource_type into kind from public.resources
 where organization_id=p_org and id=p_resource and owner_membership_id=actor and archived_at is null
  and resource_type in ('account','lead') for update;
 if kind is null or (select count(distinct rp.permission_code) from public.member_roles mr
    join public.role_permissions rp on (rp.organization_id,rp.role_id)=(mr.organization_id,mr.role_id)
    where mr.organization_id=p_org and mr.membership_id=actor and mr.effective_from<=now()
     and (mr.effective_to is null or mr.effective_to>now())
     and rp.permission_code in (kind||'.read',kind||'.share'))<>2 then
  raise exception 'Share access denied' using errcode='42501';
 end if;
 perform 1 from public.memberships
 where organization_id=p_org and id=p_recipient and (p_action='revoke' or status='Active') for share;
 if not found then raise exception 'Share access denied' using errcode='42501'; end if;

 perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_key::text,0));
 payload_hash := encode(sha256(convert_to(jsonb_build_array(
  p_resource,p_recipient,p_action,extract(epoch from p_expires_at)
 )::text,'UTF8')),'hex');
 select * into prior from private.operation_receipts
 where organization_id=p_org and actor_membership_id=actor and operation_key=p_key;
 if found then
  if prior.command_type<>'crm.share' or prior.request_hash<>payload_hash then
   raise sqlstate 'PT409' using message='Operation key is already in use';
  end if;
  return (prior.response_snapshot->>'id')::uuid;
 end if;

 if p_action='grant' then
  if p_expires_at<=now() then raise exception 'Share expiry must be in the future' using errcode='22023'; end if;
  if exists (select 1 from private.crm_record_shares where organization_id=p_org and resource_id=p_resource
     and owner_membership_id=actor and recipient_membership_id=p_recipient
     and revoked_at is null and expires_at>now()) then
   raise sqlstate 'PT409' using message='An active share already exists';
  end if;
  insert into private.crm_record_shares (
    organization_id,resource_id,resource_type,owner_membership_id,recipient_membership_id,expires_at
  ) values (p_org,p_resource,kind,actor,p_recipient,p_expires_at) returning id into share_id;
 else
  update private.crm_record_shares set revoked_at=now()
  where organization_id=p_org and resource_id=p_resource and owner_membership_id=actor
   and recipient_membership_id=p_recipient and revoked_at is null and expires_at>now()
  returning id into share_id;
  if not found then raise sqlstate 'PT409' using message='No active share exists'; end if;
 end if;

 insert into private.audit_events (organization_id,actor_membership_id,resource_id,action,request_id,redacted_details)
 values (p_org,actor,p_resource,'crm.share.'||p_action,p_key,
  jsonb_build_object('share_id',share_id,'recipient_membership_id',p_recipient));
 insert into private.operation_receipts (organization_id,actor_membership_id,operation_key,command_type,request_hash,response_snapshot)
 values (p_org,actor,p_key,'crm.share',payload_hash,jsonb_build_object('id',share_id));
 return share_id;
end
$$;

create or replace function private.provision_pilot_super_admin(
 p_org uuid,p_user uuid,p_display_name text,p_key uuid
) returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
declare
 admin_role uuid;
 member_id uuid;
begin
 if p_org is null or p_user is null or p_key is null then
  raise exception 'Organization, Auth user and request ID are required' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('pilot-super-admin:'||p_org::text,0));
 if exists (select 1 from public.roles where organization_id=p_org and code='super_admin') then
  raise exception 'Pilot super administrator already provisioned' using errcode='PT409';
 end if;
 member_id := private.provision_intake_staff(p_org,p_user,p_display_name,null,p_key);
 insert into public.roles (organization_id,code,name)
 values (p_org,'super_admin','Super Administrator') returning id into admin_role;
 insert into public.role_permissions (organization_id,role_id,permission_code) values
 (p_org,admin_role,'staff.directory.read'),(p_org,admin_role,'staff.deactivate');
 insert into public.member_roles (organization_id,membership_id,role_id,effective_from)
 values (p_org,member_id,admin_role,now());
 insert into private.audit_events (organization_id,action,request_id,redacted_details)
 values (p_org,'staff.pilot_super_admin.provision',p_key,jsonb_build_object('membership_id',member_id));
 return member_id;
end
$$;

create or replace function private.staff_admin_actor(p_org uuid,p_permission text) returns uuid
language sql stable security invoker set search_path=pg_catalog as $$
 select m.id from public.memberships m
 where m.organization_id=p_org
  and m.user_id=auth.uid() and m.status='Active'
  and exists (
   select 1 from public.member_roles mr join public.role_permissions rp
    on (mr.organization_id,mr.role_id)=(rp.organization_id,rp.role_id)
   where mr.organization_id=p_org and mr.membership_id=m.id and rp.permission_code=p_permission
    and mr.effective_from<=now() and (mr.effective_to is null or mr.effective_to>now())
  )
$$;

create or replace function private.file_worker_stage(p_user uuid, p_session uuid, p_stage uuid, p_download boolean)
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

create or replace function private.crm_read_scope(p_org uuid, p_owner uuid, p_territory uuid, p_kind text)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
  with recursive actor as (
    select m.id from public.memberships m
    where m.organization_id = p_org and m.user_id = auth.uid()
      and m.status = 'Active'
  ), scopes as (
    select distinct split_part(rp.permission_code, '.', 3) as name
    from actor
    join public.member_roles mr on mr.organization_id = p_org and mr.membership_id = actor.id
    join public.role_permissions rp on (rp.organization_id,rp.role_id) = (mr.organization_id,mr.role_id)
    where p_kind in ('account','lead') and mr.effective_from <= now()
      and (mr.effective_to is null or mr.effective_to > now())
      and rp.permission_code in (p_kind || '.read.team', p_kind || '.read.territory', p_kind || '.read.organization')
  ), managers(id) as (
    select rl.manager_id
    from private.reporting_lines rl
    join public.memberships owner on (owner.organization_id,owner.id) = (rl.organization_id,rl.member_id)
    join public.memberships manager on (manager.organization_id,manager.id) = (rl.organization_id,rl.manager_id)
    where rl.organization_id = p_org and rl.member_id = p_owner
      and owner.status = 'Active' and manager.status = 'Active'
      and exists (select 1 from scopes where name = 'team')
    union
    select rl.manager_id
    from managers
    join private.reporting_lines rl on rl.organization_id = p_org and rl.member_id = managers.id
    join public.memberships manager on (manager.organization_id,manager.id) = (rl.organization_id,rl.manager_id)
    where manager.status = 'Active'
  )
  select exists (
    select 1 from actor where
      exists (select 1 from scopes where name = 'organization')
      or exists (select 1 from managers where managers.id = actor.id)
      or (exists (select 1 from scopes where name = 'territory') and exists (
        select 1 from private.territory_memberships tm
        where tm.organization_id = p_org and tm.membership_id = actor.id and tm.territory_id = p_territory
      ))
  )
$$;

create or replace function private.crm_record_files(p_org uuid,p_resource uuid,p_offset integer)
returns table (id uuid, file_name text, created_at timestamptz, status text)
language plpgsql stable security definer set search_path=pg_catalog as $$
declare
 stage_actor uuid := private.staff_admin_actor(p_org,'file.stage');
 download_actor uuid := private.staff_admin_actor(p_org,'file.download');
 actor uuid := coalesce(stage_actor,download_actor);
 kind text;
begin
 if actor is null or p_offset is null or p_offset < 0 or not exists (
    select 1 from auth.sessions s where s.id = nullif(auth.jwt()->>'session_id','')::uuid
     and s.user_id = auth.uid() and (s.not_after is null or s.not_after > now())
 ) then raise exception 'File list unavailable' using errcode='42501'; end if;
 select r.resource_type into kind from public.resources r
 where r.organization_id = p_org and r.id = p_resource and r.owner_membership_id = actor
   and r.archived_at is null and r.resource_type in ('account','lead');
 if kind is null or private.staff_admin_actor(p_org,kind || '.read') is distinct from actor then
  raise exception 'File list unavailable' using errcode='42501';
 end if;

 return query
 select stage.id, stage.original_name, stage.created_at, case
  when uploaded.verdict = 'clean' then 'Available'
  when uploaded.verdict = 'rejected' then 'Rejected'
  when stage.expires_at <= now() then 'Expired'
  when uploaded.stored_at is not null then 'Awaiting scan'
  else 'Pending upload'
 end
 from private.file_upload_stages stage
 left join private.file_upload_objects uploaded on uploaded.stage_id = stage.id
 where stage.organization_id = p_org and stage.parent_resource_id = p_resource and stage.purpose = 'business_document'
 and ((uploaded.verdict = 'clean' and download_actor is not null)
      or (uploaded.verdict is distinct from 'clean' and stage_actor = stage.uploader_membership_id))
 order by stage.created_at desc, stage.id desc limit 26 offset p_offset;
end
$$;

create or replace function private.policy_settings_actor(p_org uuid) returns uuid
language sql stable security invoker set search_path=pg_catalog as $$
  select m.id from public.memberships m
  join auth.sessions s on s.user_id=m.user_id and s.id=nullif(auth.jwt()->>'session_id','')::uuid
  where m.organization_id=p_org and m.user_id=auth.uid() and m.status='Active'
    and (s.not_after is null or s.not_after>now())
    and exists (
      select 1 from public.member_roles mr join public.roles r
        on (r.organization_id,r.id)=(mr.organization_id,mr.role_id)
      where mr.organization_id=p_org and mr.membership_id=m.id and r.code='super_admin'
        and mr.effective_from<=now() and (mr.effective_to is null or mr.effective_to>now())
    )
$$;

alter policy resources_staff_read_scope on public.resources using (
  archived_at is null and resource_type in ('account','lead')
  and private.has_permission(organization_id, resource_type || '.read')
  and private.crm_read_scope(organization_id, owner_membership_id, territory_id, resource_type)
);
