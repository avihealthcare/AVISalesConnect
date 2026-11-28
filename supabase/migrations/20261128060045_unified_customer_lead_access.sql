alter table public.leads
  add column customer_site_id uuid,
  add column customer_contact_id uuid,
  add column inquiry_context text check (inquiry_context in ('Direct Hospital Requirement','Dealer / Stocking / Tender Inquiry')),
  add foreign key (organization_id,customer_site_id) references private.sales_field_records(organization_id,id),
  add foreign key (organization_id,customer_contact_id) references private.sales_field_records(organization_id,id);
create index leads_customer_created on public.leads(organization_id,account_id,created_by) where account_id is not null;

create or replace function private.lead_visible(p_org uuid,p_actor uuid,p_id uuid) returns boolean
language sql stable security invoker set search_path=pg_catalog as $$
  select p_actor is not null and exists(select 1 from public.resources r
    left join public.leads l on (l.organization_id,l.id)=(r.organization_id,r.id)
    where (r.organization_id,r.id)=(p_org,p_id) and r.resource_type='lead' and r.archived_at is null
      and (p_actor in (r.owner_membership_id,l.created_by) or private.intake_actor_can(p_org,p_actor,'lead.manage')))
$$;

create function private.session_can_read_lead(p_org uuid,p_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
  select coalesce(private.lead_visible(p_org,private.staff_admin_actor(p_org,'lead.read'),p_id),false)
$$;
-- A missing staff actor must never inherit a manager predicate.
revoke all on function private.session_can_read_lead(uuid,uuid) from public,anon,authenticated;
grant execute on function private.session_can_read_lead(uuid,uuid) to authenticated;
create policy restrict_lead_resource_visibility on public.resources as restrictive for select to authenticated
  using (resource_type<>'lead' or private.session_can_read_lead(organization_id,id));
create policy permit_lead_creator_visibility on public.resources for select to authenticated
  using (resource_type='lead' and private.session_can_read_lead(organization_id,id));

insert into private.lead_defaults values ('source','customer_assignment','Customer assignment',170,null);

create function private.assign_customer_leads(p_org uuid,p_key uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  actor uuid := private.staff_admin_actor(p_org,'lead.create');
  requested_membership uuid := nullif(p_input->>'owner','')::uuid;
  manager boolean;
  selected_site uuid := nullif(p_input->>'site','')::uuid;
  selected_contact uuid := nullif(p_input->>'contact','')::uuid;
  selected_account uuid;
  current_account public.accounts%rowtype;
  headquarters jsonb;
  person private.sales_field_records%rowtype;
  current_site private.sales_field_records%rowtype;
  inputs jsonb;
  child_key uuid;
  result jsonb;
  response jsonb := '[]'::jsonb;
  receipt private.operation_receipts%rowtype;
  digest text;
begin
  if actor is null or not private.intake_actor_can(p_org,actor,'lead.read') then
    raise exception 'Lead creation is unavailable' using errcode='42501';
  end if;
  manager:=private.intake_actor_can(p_org,actor,'lead.manage');
  requested_membership:=coalesce(requested_membership,actor);
  if requested_membership<>actor and not manager then
    raise exception 'You may only assign leads to yourself' using errcode='42501';
  end if;
  if p_key is null or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>25000
    or jsonb_typeof(p_input->'customers') is distinct from 'array'
    or jsonb_array_length(p_input->'customers') not between 1 and 25
    or (p_input->>'context') not in ('Direct Hospital Requirement','Dealer / Stocking / Tender Inquiry')
    or nullif(p_input->>'context','') is null
    or ((selected_site is not null or selected_contact is not null) and jsonb_array_length(p_input->'customers')<>1)
    or (select count(distinct value) from jsonb_array_elements_text(p_input->'customers'))<>jsonb_array_length(p_input->'customers')
  then raise exception 'Review the selected customers and inquiry context' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_key::text,0));
  digest:=encode(sha256(convert_to(p_input::text,'UTF8')),'hex');
  select * into receipt from private.operation_receipts where (organization_id,actor_membership_id,operation_key)=(p_org,actor,p_key);
  if found then
    if receipt.command_type<>'customer.assign_leads' or receipt.request_hash<>digest then
      raise sqlstate 'PT409' using message='Request key already used';
    end if;
    return receipt.response_snapshot;
  end if;
  for selected_account in select value::uuid from jsonb_array_elements_text(p_input->'customers') order by value loop
    if not private.customer_visible(p_org,actor,selected_account) then
      raise sqlstate 'PT404' using message='Customer unavailable';
    end if;
    select * into strict current_account from public.accounts where (organization_id,id)=(p_org,selected_account);
    select details into headquarters from private.customer_master where (organization_id,account_id)=(p_org,selected_account);
    if selected_site is not null then
      select f.* into current_site from private.sales_field_records f join public.resources r using (organization_id,id)
        where (f.organization_id,f.id,f.parent_id)=(p_org,selected_site,selected_account) and f.kind='site' and r.archived_at is null
          and private.intake_actor_can(p_org,actor,'site.read');
      if not found then raise sqlstate 'PT404' using message='Choose a site for this customer'; end if;
    end if;
    if selected_contact is not null then
      select f.* into person from private.sales_field_records f where (f.organization_id,f.id)=(p_org,selected_contact)
        and (f.parent_id=selected_account or exists(select 1 from private.contact_affiliations a
          where (a.organization_id,a.contact_id,a.account_id)=(p_org,selected_contact,selected_account) and a.active));
      if not found or not private.contact_visible(p_org,actor,selected_contact) then
        raise sqlstate 'PT404' using message='Choose a contact for this customer';
      end if;
    end if;
    child_key:=md5(p_key::text||':customer-lead:'||selected_account::text)::uuid;
    inputs:=jsonb_build_object('customer',current_account.name,'source','customer_assignment',
      'routing',case when requested_membership=actor then 'self' else 'manual' end,'owner',requested_membership::text,
      'contact',person.title,'mobile',person.details->>'phone','email',person.details->>'email',
      'designation',person.details->>'designation','city',coalesce(nullif(current_site.details->>'city',''),headquarters->>'city'),
      'state',coalesce(nullif(current_site.details->>'state',''),headquarters->>'state'),
      'missing_contact_reason',case when nullif(person.details->>'phone','') is null and nullif(person.details->>'email','') is null
        then 'Outreach contact to be confirmed' end,'value',p_input->>'value','priority',p_input->>'priority',
      'description',p_input->>'notes','next_action',case when nullif(p_input->>'follow_up','') is not null then 'Contact this customer' end,
      'follow_up',p_input->>'follow_up');
    result:=private.command_lead_management(p_org,'create',child_key,jsonb_build_object(
      'fields',inputs,'products',coalesce(p_input->'products','[]'::jsonb),'customer_assignment',selected_account));
    update public.leads set account_id=selected_account,customer_site_id=selected_site,
      customer_contact_id=selected_contact,inquiry_context=p_input->>'context'
      where (organization_id,id)=(p_org,(result->>'id')::uuid);
    response:=response||jsonb_build_array(result);
  end loop;
  insert into private.operation_receipts(organization_id,actor_membership_id,operation_key,command_type,request_hash,response_snapshot)
    values(p_org,actor,p_key,'customer.assign_leads',digest,response);
  return response;
end
$$;

create function public.assign_customer_leads(p_org uuid,p_key uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path=pg_catalog as $$ select private.assign_customer_leads(p_org,p_key,p_input) $$;
revoke all on function private.assign_customer_leads(uuid,uuid,jsonb),public.assign_customer_leads(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.assign_customer_leads(uuid,uuid,jsonb),public.assign_customer_leads(uuid,uuid,jsonb) to authenticated;

alter function private.command_lead_management(uuid,text,uuid,jsonb) rename to run_lead_command;
revoke all on function private.run_lead_command(uuid,text,uuid,jsonb) from public,anon,authenticated;
create function private.command_lead_management(p_org uuid,p_action text,p_key uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  actor uuid:=private.staff_admin_actor(p_org,'lead.read');
  target uuid:=nullif(p_input->>'id','')::uuid;
  stored private.operation_receipts%rowtype;
  digest text;
begin
  if actor is null then raise exception 'Lead access denied' using errcode='42501'; end if;
  if p_action='create' and coalesce(nullif(p_input#>>'{fields,routing}',''),'self')<>'self'
    and not private.intake_actor_can(p_org,actor,'lead.manage') then
    raise exception 'You may only assign leads to yourself' using errcode='42501';
  end if;
  if p_action='archive' then
    if not private.intake_actor_can(p_org,actor,'lead.manage') then raise exception 'Lead access denied' using errcode='42501'; end if;
    if p_key is null or target is null or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>1000 then
      raise exception 'Invalid archive request' using errcode='22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_key::text,0));
    digest:=encode(sha256(convert_to(p_input::text,'UTF8')),'hex');
    select * into stored from private.operation_receipts where (organization_id,actor_membership_id,operation_key)=(p_org,actor,p_key);
    if found then
      if stored.command_type<>'leads.archive' or stored.request_hash<>digest then raise sqlstate 'PT409' using message='Request key already used'; end if;
      return stored.response_snapshot;
    end if;
    update public.resources set archived_at=now() where (organization_id,id)=(p_org,target)
      and resource_type='lead' and archived_at is null;
    if not found then raise sqlstate 'PT404' using message='Lead unavailable'; end if;
    insert into private.audit_events(organization_id,actor_membership_id,resource_id,action,request_id)
      values(p_org,actor,target,'leads.archive',p_key);
    insert into private.operation_receipts(organization_id,actor_membership_id,operation_key,command_type,request_hash,response_snapshot)
      values(p_org,actor,p_key,'leads.archive',digest,jsonb_build_object('id',target));
    return jsonb_build_object('id',target);
  end if;
  return private.run_lead_command(p_org,p_action,p_key,p_input);
end
$$;
revoke all on function private.command_lead_management(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.command_lead_management(uuid,text,uuid,jsonb) to authenticated;

alter table private.customer_master add constraint enterprise_customer_details check (
  coalesce(details->>'segment','') in ('','Healthcare Institution','Dealer / Distributor','Government / Tender Body')
  and coalesce(details->>'lifecycle','') in ('','Prospect','Active Account','Key Partner / Account','Inactive')
  and coalesce(details->>'tier','') in ('','Tier 1','Tier 2','Tier 3','Platinum Partner','Gold Partner','Silver Partner')
  and coalesce(details->>'gstin','') ~ '^([0-9A-Z]{15})?$'
  and length(coalesce(details->>'drug_license_no',''))<=100
);

create function private.enterprise_customer_directory(p_org uuid,p_query jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare
  actor uuid:=private.staff_admin_actor(p_org,'account.read');
  needle text:=lower(btrim(coalesce(p_query->>'search','')));
  skip_count int:=greatest(0,least(100000,coalesce((p_query->>'offset')::int,0)));
  baseline jsonb;
  results jsonb;
begin
  if actor is null then raise exception 'Customer access denied' using errcode='42501'; end if;
  if jsonb_typeof(p_query) is distinct from 'object' or octet_length(p_query::text)>4000 then raise exception 'Invalid filters' using errcode='22023'; end if;
  baseline:=private.read_customer_master(p_org,'{}'::jsonb,null)-'rows';
  with visible as materialized (
    select a.id,a.name,m.details,a.display_number,m.category,r.owner_membership_id,
      coalesce(nullif(m.details->>'segment',''),case when a.account_type='Distributor' then 'Dealer / Distributor'
        when m.category in ('Government Department','Procurement Agency') then 'Government / Tender Body' else 'Healthcare Institution' end) segment,
      coalesce(nullif(m.details->>'lifecycle',''),case m.details->>'status' when 'Inactive' then 'Inactive'
        when 'Prospect' then 'Prospect' when 'On Hold' then 'Prospect' else 'Active Account' end) lifecycle,
      coalesce(nullif(m.details->>'sub_type',''),m.category,a.account_type) subtype
    from public.accounts a join public.resources r using(organization_id,id)
    left join private.customer_master m on (m.organization_id,m.account_id)=(a.organization_id,a.id)
    where a.organization_id=p_org and private.customer_visible(p_org,actor,a.id)
  ), page as (
    select v.* from visible v where
      (needle='' or strpos(lower(concat_ws(' ',v.name,v.details->>'city',v.details->>'state',v.details->>'gstin',
        private.customer_number(v.display_number))),needle)>0 or exists(
        select 1 from private.sales_field_records f where f.organization_id=p_org and f.kind='contact'
          and (f.parent_id=v.id or exists(select 1 from private.contact_affiliations a
            where (a.organization_id,a.contact_id,a.account_id)=(p_org,f.id,v.id) and a.active))
          and strpos(lower(concat_ws(' ',f.title,f.details->>'phone')),needle)>0 and private.contact_visible(p_org,actor,f.id)))
      and (coalesce(p_query->>'segment','')='' or v.segment=p_query->>'segment')
      and (coalesce(p_query->>'subtype','')='' or v.subtype=p_query->>'subtype')
      and (coalesce(p_query->>'lifecycle','')='' or v.lifecycle=p_query->>'lifecycle')
      and (coalesce(p_query->>'state','')='' or v.details->>'state'=p_query->>'state')
      and (coalesce(p_query->>'owner','')='' or v.owner_membership_id::text=p_query->>'owner')
      order by v.name,v.id offset skip_count limit 26
  )
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(private.customer_row(p_org,v.id)||jsonb_build_object(
      'segment',v.segment,'subtype',v.subtype,'lifecycle',v.lifecycle,
      'site_count',(select count(*) from private.sales_field_records f join public.resources r using(organization_id,id)
        where (f.organization_id,f.parent_id)=(p_org,v.id) and f.kind='site' and r.archived_at is null
          and private.intake_actor_can(p_org,actor,'site.read')),
      'active_count',(select count(*) from public.leads l join public.resources r using(organization_id,id)
        where (l.organization_id,l.account_id)=(p_org,v.id) and r.archived_at is null and l.merged_into is null
          and l.lifecycle not in ('Disqualified','Converted') and l.sales_stage<>'won'
          and private.intake_actor_can(p_org,actor,'lead.read') and private.lead_visible(p_org,actor,l.id))
        +(select count(*) from public.opportunities o join public.resources r using(organization_id,id)
          where (o.organization_id,o.account_id)=(p_org,v.id) and r.owner_membership_id=actor and r.archived_at is null
            and o.stage not in ('Closed Won','Closed Lost') and private.intake_actor_can(p_org,actor,'opportunity.read')),
      'primary_contact',(select jsonb_build_object('name',f.title,'designation',f.details->>'designation','phone',f.details->>'phone')
        from private.sales_field_records f where (f.organization_id,f.parent_id)=(p_org,v.id) and f.kind='contact'
          and private.contact_visible(p_org,actor,f.id) order by (f.details->>'primary_contact'='true') desc nulls last,f.created_at,f.id limit 1)
    ) order by v.name,v.id) from page v),'[]'::jsonb),
    'summary',(select jsonb_build_object('total',count(*),'healthcare',count(*) filter(where segment='Healthcare Institution'),
      'partners',count(*) filter(where segment='Dealer / Distributor'),'active',count(*) filter(where lifecycle in ('Active Account','Key Partner / Account')))
      from visible),
    'subtypes',coalesce((select jsonb_agg(distinct subtype order by subtype) from visible where subtype is not null),'[]'::jsonb),
    'states',coalesce((select jsonb_agg(distinct details->>'state' order by details->>'state') from visible where nullif(details->>'state','') is not null),'[]'::jsonb)
  ) into results;
  return baseline||results;
end
$$;
create function public.enterprise_customer_directory(p_org uuid,p_query jsonb default '{}'::jsonb) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$ select private.enterprise_customer_directory(p_org,p_query) $$;
revoke all on function private.enterprise_customer_directory(uuid,jsonb),public.enterprise_customer_directory(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.enterprise_customer_directory(uuid,jsonb),public.enterprise_customer_directory(uuid,jsonb) to authenticated;

alter table private.sales_field_records add column associated_site_id uuid,
  add foreign key (organization_id,associated_site_id) references private.sales_field_records(organization_id,id);
create index customer_contacts_by_site on private.sales_field_records(organization_id,associated_site_id)
  where associated_site_id is not null;
create unique index primary_site_per_customer on private.sales_field_records(organization_id,parent_id)
  where kind='site' and details->>'is_primary'='true';
create unique index primary_contact_per_customer on private.sales_field_records(organization_id,parent_id)
  where kind='contact' and details->>'primary_contact'='true';

create function private.validate_enterprise_site_and_contact() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if new.kind='contact' then
    new.associated_site_id:=nullif(new.details->>'site_id','')::uuid;
    if new.associated_site_id is not null and not exists(select 1 from private.sales_field_records f join public.resources r using(organization_id,id)
      where (f.organization_id,f.id,f.parent_id)=(new.organization_id,new.associated_site_id,new.parent_id)
        and f.kind='site' and r.archived_at is null) then raise exception 'Choose a site for this customer' using errcode='22023'; end if;
    if coalesce(new.details->>'salutation','') not in ('','Dr.','Prof.','Mr.','Ms.')
      or coalesce(new.details->>'stakeholder_role','') not in ('','Decision Maker','Influencer','Technical Evaluator','Gatekeeper','Channel Partner',
        'End User','Purchase Authority','Financial Approver') then
      raise exception 'Choose a valid salutation and decision role' using errcode='22023';
    end if;
  elsif new.kind='site' and (coalesce(new.details->>'site_type','') not in ('','Hospital Campus','Clinic Branch','Registered Office','Warehouse / Godown','Service Center')
     or coalesce(new.details->>'beds','') !~ '^([0-9]{1,6})?$') then
    raise exception 'Choose a site type and a whole-number bed capacity' using errcode='22023';
  end if;
  return new;
end
$$;
revoke all on function private.validate_enterprise_site_and_contact() from public,anon,authenticated;
create trigger validate_enterprise_site_and_contact before insert or update of details,parent_id on private.sales_field_records
  for each row when (new.kind in ('site','contact')) execute function private.validate_enterprise_site_and_contact();

alter function private.read_customer_master(uuid,jsonb,uuid) rename to read_customer_master_base;
revoke all on function private.read_customer_master_base(uuid,jsonb,uuid) from public,anon,authenticated;
create function private.read_customer_master(p_org uuid,p_query jsonb,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare
  result jsonb:=private.read_customer_master_base(p_org,p_query,p_id);
  actor uuid:=private.staff_admin_actor(p_org,'account.read');
  sites jsonb;
  opportunities jsonb;
begin
  if p_id is null or p_query->>'kind'='contacts' or p_query->>'kind'='contact_choices' then return result; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'title',f.title,'type',f.details->>'site_type',
    'city',f.details->>'city','pin',f.details->>'pin','primary',f.details->>'is_primary'='true') order by f.title,f.id),'[]'::jsonb)
    into sites from private.sales_field_records f join public.resources r using(organization_id,id)
    where (f.organization_id,f.parent_id)=(p_org,p_id) and f.kind='site' and r.archived_at is null
      and private.intake_actor_can(p_org,actor,'site.read');
  select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc),'[]'::jsonb)
    into opportunities from (
      select o.id,o.requirement_text title,o.stage status,r.created_at from public.opportunities o join public.resources r using(organization_id,id)
      where (o.organization_id,o.account_id)=(p_org,p_id) and r.archived_at is null and private.intake_actor_can(p_org,actor,'opportunity.read')
        and (r.owner_membership_id=actor or private.crm_read_scope(p_org,r.owner_membership_id,r.territory_id,'opportunity'))
      order by r.created_at desc,o.id limit 100
    ) item;
  return result||jsonb_build_object('sites',sites,'opportunities',opportunities);
end
$$;
revoke all on function private.read_customer_master(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function private.read_customer_master(uuid,jsonb,uuid) to authenticated;

create table private.customer_activity (
  organization_id uuid not null,
  account_id uuid not null,
  actor_id uuid not null,
  id uuid not null,
  kind text not null check(kind in ('Call','Meeting','Note')),
  summary text not null check(length(btrim(summary)) between 1 and 1000),
  recorded_at timestamptz not null default now(),
  primary key(organization_id,id),
  foreign key(organization_id,account_id) references public.accounts(organization_id,id),
  foreign key(organization_id,actor_id) references public.memberships(organization_id,id)
);
alter table private.customer_activity enable row level security;
revoke all on private.customer_activity from public,anon,authenticated;
create index customer_activity_by_account on private.customer_activity(organization_id,account_id,recorded_at desc);

create function private.customer_activities(p_org uuid,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=private.staff_admin_actor(p_org,'account.read');
begin
  if actor is null or not private.customer_visible(p_org,actor,p_id) then raise sqlstate 'PT404' using message='Customer unavailable'; end if;
  return coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from (
    select kind title,summary,recorded_at created_at from private.customer_activity
      where (organization_id,account_id)=(p_org,p_id) order by recorded_at desc limit 100
  ) a),'[]'::jsonb);
end
$$;
create function private.log_customer_activity(p_org uuid,p_id uuid,p_key uuid,p_kind text,p_summary text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=private.staff_admin_actor(p_org,'account.read');
begin
  if actor is null or not private.customer_visible(p_org,actor,p_id)
    or not (private.intake_actor_can(p_org,actor,'account.create') or private.intake_actor_can(p_org,actor,'account.manage'))
    then raise exception 'Customer activity access denied' using errcode='42501'; end if;
  insert into private.customer_activity(organization_id,account_id,actor_id,id,kind,summary)
    values(p_org,p_id,actor,p_key,p_kind,btrim(p_summary)) on conflict(organization_id,id) do nothing;
  if not found then
    if not exists(select 1 from private.customer_activity a where (a.organization_id,a.account_id,a.actor_id,a.id,a.kind,a.summary)
      =(p_org,p_id,actor,p_key,p_kind,btrim(p_summary))) then raise sqlstate 'PT409' using message='Request key already used'; end if;
    return;
  end if;
  insert into private.audit_events(organization_id,actor_membership_id,resource_id,action,request_id)
    values(p_org,actor,p_id,'customer.activity',p_key);
end
$$;
create function public.customer_activities(p_org uuid,p_id uuid) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$ select private.customer_activities(p_org,p_id) $$;
create function public.log_customer_activity(p_org uuid,p_id uuid,p_key uuid,p_kind text,p_summary text) returns void
language sql security invoker set search_path=pg_catalog as $$ select private.log_customer_activity(p_org,p_id,p_key,p_kind,p_summary) $$;
revoke all on function private.customer_activities(uuid,uuid),private.log_customer_activity(uuid,uuid,uuid,text,text),
 public.customer_activities(uuid,uuid),public.log_customer_activity(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function private.customer_activities(uuid,uuid),private.log_customer_activity(uuid,uuid,uuid,text,text),
 public.customer_activities(uuid,uuid),public.log_customer_activity(uuid,uuid,uuid,text,text) to authenticated;
