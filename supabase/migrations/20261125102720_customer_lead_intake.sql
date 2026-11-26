alter table public.resources add unique (organization_id,id,resource_type);

create table public.accounts (
 id uuid primary key,
 organization_id uuid not null,
 resource_type text generated always as ('account') stored,
 name text not null check (char_length(trim(name)) between 1 and 200),
 account_type text not null check (account_type in ('Hospital','Institution','Distributor','Other')),
 created_at timestamptz not null default now(),
 unique (organization_id,id),
 foreign key (organization_id,id,resource_type) references public.resources(organization_id,id,resource_type)
);

create table public.leads (
 id uuid primary key,
 organization_id uuid not null,
 resource_type text generated always as ('lead') stored,
 display_number bigint generated always as identity,
 source text not null check (source in ('Telephone','Email','WhatsApp','Website','Referral','Event','Other','CSV','IndiaMART')),
 lifecycle text not null default 'New' check (lifecycle in ('New','Assigned','Contacted','Qualified','Disqualified','Converted')),
 received_at timestamptz not null check (isfinite(received_at)),
 ingested_at timestamptz not null default now(),
 prospect_name text not null check (char_length(trim(prospect_name)) between 1 and 200),
 contact_route text check (contact_route ~ '^([+]?[0-9]{7,15}|[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+)$' and char_length(contact_route)<=254),
 missing_contact_reason text check (char_length(trim(missing_contact_reason)) between 1 and 500),
 requirement_text text check (char_length(requirement_text)<=10000),
 account_id uuid,
 check (contact_route is not null or missing_contact_reason is not null),
 unique (organization_id,display_number),
 foreign key (organization_id,id,resource_type) references public.resources(organization_id,id,resource_type),
 foreign key (organization_id,account_id) references public.accounts(organization_id,id)
);

alter table public.accounts enable row level security;
alter table public.leads enable row level security;
revoke all on public.accounts, public.leads from public, anon, authenticated;
grant select on public.accounts, public.leads to authenticated;
create policy account_read on public.accounts for select to authenticated
 using (exists (select 1 from public.resources r where r.organization_id=accounts.organization_id and r.id=accounts.id));
create policy lead_read on public.leads for select to authenticated
 using (exists (select 1 from public.resources r where r.organization_id=leads.organization_id and r.id=leads.id));
create index leads_queue_idx on public.leads(organization_id,received_at desc,id);
create index accounts_name_idx on public.accounts(organization_id,name,id);

insert into public.permissions(code,description,requires_mfa) values
 ('account.create','Create an account owned by the actor',false),
 ('account.read','Read an account within allowed scope',false),
 ('lead.create','Capture a manual lead owned by the actor',false),
 ('lead.read','Read a lead within allowed scope',false)
 on conflict (code) do nothing;

-- Internal transaction. Authorization is explicit because this function owns the write.
create function private.create_intake_record(p_org uuid,p_key uuid,p_kind text,p_input jsonb)
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
    and (not (r.requires_mfa or p.requires_mfa) or auth.jwt()->>'aal'='aal2')
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
  if coalesce(p_input->>'source','') not in ('Telephone','Email','WhatsApp','Website','Referral','Event','Other')
    or coalesce(p_input->>'received_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
   raise exception 'Manual source and a timestamp with offset are required' using errcode='22023';
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
     and (not (r.requires_mfa or p.requires_mfa) or auth.jwt()->>'aal'='aal2')
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
revoke all on function private.create_intake_record(uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function private.create_intake_record(uuid,uuid,text,jsonb) to authenticated;

create function public.create_intake_record(p_org uuid,p_key uuid,p_kind text,p_input jsonb)
returns uuid language sql security invoker set search_path=pg_catalog as $$
 select private.create_intake_record(p_org,p_key,p_kind,p_input)
$$;
revoke all on function public.create_intake_record(uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_intake_record(uuid,uuid,text,jsonb) to authenticated;
