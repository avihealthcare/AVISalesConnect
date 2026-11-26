insert into public.permissions (code, description, requires_mfa) values
 ('account.share', 'Manage temporary read sharing for an owned account', true),
 ('lead.share', 'Manage temporary read sharing for an owned lead', true);

create table private.crm_record_shares (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 resource_id uuid not null,
 resource_type text not null check (resource_type in ('account','lead')),
 owner_membership_id uuid not null,
 recipient_membership_id uuid not null,
 granted_at timestamptz not null default now(),
 expires_at timestamptz not null check (isfinite(expires_at) and expires_at > granted_at),
 revoked_at timestamptz check (isfinite(revoked_at) and revoked_at >= granted_at),
 check (owner_membership_id <> recipient_membership_id),
 foreign key (organization_id,resource_id,resource_type) references public.resources(organization_id,id,resource_type),
 foreign key (organization_id,owner_membership_id) references public.memberships(organization_id,id),
 foreign key (organization_id,recipient_membership_id) references public.memberships(organization_id,id)
);
create index crm_record_shares_active_idx on private.crm_record_shares
 (organization_id,resource_id,owner_membership_id,recipient_membership_id,expires_at) where revoked_at is null;
alter table private.crm_record_shares enable row level security;
revoke all on private.crm_record_shares from public, anon, authenticated;

create function private.has_crm_record_share(p_org uuid,p_resource uuid,p_owner uuid)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select auth.uid() is not null and coalesce(auth.jwt()->>'aal'='aal2',false) and exists (
  select 1 from private.crm_record_shares s
  join public.memberships recipient on (recipient.organization_id,recipient.id)=(s.organization_id,s.recipient_membership_id)
  join public.memberships owner on (owner.organization_id,owner.id)=(s.organization_id,s.owner_membership_id)
  where s.organization_id=p_org and s.resource_id=p_resource and s.owner_membership_id=p_owner
   and recipient.user_id=auth.uid() and recipient.status='Active' and owner.status='Active'
   and s.revoked_at is null and s.expires_at>now()
 )
$$;
revoke all on function private.has_crm_record_share(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function private.has_crm_record_share(uuid,uuid,uuid) to authenticated;

create policy resources_crm_read_share on public.resources for select to authenticated using (
 resource_type in ('account','lead') and archived_at is null
 and private.has_permission(organization_id,resource_type||'.read')
 and private.has_crm_record_share(organization_id,id,owner_membership_id)
);

create function private.change_crm_record_share(
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
 if actor is null or actor=p_recipient or auth.jwt()->>'aal' is distinct from 'aal2' then
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
revoke all on function private.change_crm_record_share(uuid,uuid,uuid,uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function private.change_crm_record_share(uuid,uuid,uuid,uuid,text,timestamptz) to authenticated;

create function public.change_crm_record_share(
 p_org uuid,p_resource uuid,p_recipient uuid,p_key uuid,p_action text,p_expires_at timestamptz
) returns uuid language sql security invoker set search_path=pg_catalog as $$
 select private.change_crm_record_share(p_org,p_resource,p_recipient,p_key,p_action,p_expires_at)
$$;
revoke all on function public.change_crm_record_share(uuid,uuid,uuid,uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function public.change_crm_record_share(uuid,uuid,uuid,uuid,text,timestamptz) to authenticated;
