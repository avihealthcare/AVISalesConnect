alter table public.accounts add column display_number bigint generated always as identity unique,
 add column master_version integer not null default 1 check(master_version>0);

create table private.customer_groups (
 organization_id uuid not null references public.organizations(id),
 id uuid not null default gen_random_uuid(),
 name text not null check(length(btrim(name)) between 1 and 200),
 normalized_name text generated always as (lower(regexp_replace(btrim(name),'[[:space:]]+',' ','g'))) stored,
 primary key(organization_id,id), unique(organization_id,normalized_name)
);
create table private.customer_master (
 organization_id uuid not null,
 account_id uuid not null,
 group_id uuid,
 category text not null check(category in ('Private Hospital','Government Hospital','Medical College','Nursing Home',
 'Children''s Hospital','Neonatal Centre','Maternity Hospital','Clinic','Distributor','Government Department','Procurement Agency','Other')),
 normalized_name text not null,
 location_key text,
 zoho_id text,
 details jsonb not null check(jsonb_typeof(details)='object' and octet_length(details::text)<=20000),
 primary key(organization_id,account_id),
 foreign key(organization_id,account_id) references public.accounts(organization_id,id),
 foreign key(organization_id,group_id) references private.customer_groups(organization_id,id)
);
create unique index customer_master_zoho on private.customer_master(organization_id,zoho_id) where zoho_id is not null;
create unique index customer_master_location on private.customer_master(organization_id,normalized_name,location_key) where location_key is not null;
create index customer_master_group on private.customer_master(organization_id,group_id) where group_id is not null;
create table private.customer_departments (
 organization_id uuid not null,
 account_id uuid not null,
 name text not null check(length(btrim(name)) between 1 and 120),
 normalized_name text generated always as (lower(regexp_replace(btrim(name),'[[:space:]]+',' ','g'))) stored,
 primary key(organization_id,account_id,normalized_name),
 foreign key(organization_id,account_id) references public.accounts(organization_id,id)
);
create table private.contact_affiliations (
 organization_id uuid not null,
 contact_id uuid not null,
 account_id uuid not null,
 department_key text,
 active boolean not null default true,
 primary key(organization_id,contact_id,account_id),
 foreign key(organization_id,contact_id) references private.sales_field_records(organization_id,id),
 foreign key(organization_id,account_id) references public.accounts(organization_id,id),
 foreign key(organization_id,account_id,department_key) references private.customer_departments(organization_id,account_id,normalized_name)
);
create index contact_affiliations_account on private.contact_affiliations(organization_id,account_id,contact_id) where active;
alter table private.customer_groups enable row level security;
alter table private.customer_master enable row level security;
alter table private.customer_departments enable row level security;
alter table private.contact_affiliations enable row level security;
revoke all on private.customer_groups,private.customer_master,private.customer_departments,private.contact_affiliations from public,anon,authenticated;

insert into public.permissions(code,description) values('account.manage','Edit and allocate customers throughout the organization');
create function private.install_customer_manager() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 insert into public.role_permissions(organization_id,role_id,permission_code)
 values(new.organization_id,new.id,'account.manage') on conflict do nothing;
 return new;
end
$$;
revoke all on function private.install_customer_manager() from public,anon,authenticated;
create trigger install_customer_manager after insert on public.roles for each row when (new.code='super_admin')
execute function private.install_customer_manager();
insert into public.role_permissions(organization_id,role_id,permission_code)
select organization_id,id,'account.manage' from public.roles where code='super_admin' on conflict do nothing;
create policy resources_customer_management on public.resources for select to authenticated using (
 resource_type='account' and archived_at is null and private.has_permission(organization_id,'account.read')
 and private.has_permission(organization_id,'account.manage')
);

create function private.customer_visible(p_org uuid,p_actor uuid,p_id uuid) returns boolean
language sql stable security invoker set search_path=pg_catalog as $$
 select private.intake_actor_can(p_org,p_actor,'account.read') and exists(
  select 1 from public.resources r where (r.organization_id,r.id)=(p_org,p_id) and r.resource_type='account' and r.archived_at is null
    and (r.owner_membership_id=p_actor or private.intake_actor_can(p_org,p_actor,'account.manage')
      or private.crm_read_scope(p_org,r.owner_membership_id,r.territory_id,'account')
      or private.has_crm_record_share(p_org,r.id,r.owner_membership_id))
 )
$$;
revoke all on function private.customer_visible(uuid,uuid,uuid) from public,anon,authenticated;
create function private.contact_visible(p_org uuid,p_actor uuid,p_id uuid) returns boolean
language sql stable security invoker set search_path=pg_catalog as $$
 select private.intake_actor_can(p_org,p_actor,'contact.read') and exists(
  select 1 from private.sales_field_records f join public.resources r on (r.organization_id,r.id)=(f.organization_id,f.id)
  where (f.organization_id,f.id)=(p_org,p_id) and f.kind='contact' and r.archived_at is null and (
   private.customer_visible(p_org,p_actor,f.parent_id) or exists(
    select 1 from private.contact_affiliations a where (a.organization_id,a.contact_id)=(p_org,p_id) and a.active
      and private.customer_visible(p_org,p_actor,a.account_id)
   ))
 )
$$;
revoke all on function private.contact_visible(uuid,uuid,uuid) from public,anon,authenticated;
create function private.customer_number(number bigint) returns text
language sql immutable security invoker set search_path=pg_catalog as $$
 select 'CUST-'||lpad(number::text,greatest(5,length(number::text)),'0')
$$;
revoke all on function private.customer_number(bigint) from public,anon,authenticated;

create function private.customer_row(p_org uuid,p_id uuid) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('id',a.id,'name',a.name,'number',private.customer_number(a.display_number),'version',a.master_version,
  'category',coalesce(m.category,case a.account_type when 'Distributor' then 'Distributor' else 'Other' end),
  'group',g.name,'city',m.details->>'city','state',m.details->>'state','status',coalesce(m.details->>'status','Active'),
  'owner',r.owner_membership_id,'owner_name',private.lead_member_name(p_org,r.owner_membership_id),'territory',r.territory_id,
  'territory_name',t.name,'details',coalesce(m.details,'{}'::jsonb),'zoho_id',m.zoho_id)
 from public.accounts a join public.resources r on (r.organization_id,r.id)=(a.organization_id,a.id)
 left join private.customer_master m on (m.organization_id,m.account_id)=(a.organization_id,a.id)
 left join private.customer_groups g on (g.organization_id,g.id)=(m.organization_id,m.group_id)
 left join private.territories t on (t.organization_id,t.id)=(r.organization_id,r.territory_id)
 where (a.organization_id,a.id)=(p_org,p_id)
$$;
revoke all on function private.customer_row(uuid,uuid) from public,anon,authenticated;

create function private.contact_row(p_org uuid,p_actor uuid,p_id uuid) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('id',f.id,'name',f.title,'version',f.version,'created_at',f.created_at,'details',f.details,
  'can_edit',private.intake_actor_can(p_org,p_actor,'contact.update') and (r.owner_membership_id=p_actor or private.intake_actor_can(p_org,p_actor,'account.manage'))
      and private.customer_visible(p_org,p_actor,f.parent_id),
  'can_attach',r.owner_membership_id=p_actor and private.intake_actor_can(p_org,p_actor,'file.stage'),
  'can_download',r.owner_membership_id=p_actor and private.intake_actor_can(p_org,p_actor,'file.download'),
  'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'primary',a.id=f.parent_id,
    'department',dept.name,'department_key',dept.normalized_name) order by (a.id=f.parent_id) desc,a.name) from public.accounts a
    left join private.contact_affiliations link on (link.organization_id,link.account_id,link.contact_id)=(a.organization_id,a.id,f.id) and link.active
    left join private.customer_departments dept on (dept.organization_id,dept.account_id,dept.normalized_name)=(link.organization_id,link.account_id,link.department_key)
    where a.organization_id=p_org and (a.id=f.parent_id or link.contact_id is not null) and private.customer_visible(p_org,p_actor,a.id)
  ),'[]'::jsonb))
 from private.sales_field_records f join public.resources r on (r.organization_id,r.id)=(f.organization_id,f.id)
 where (f.organization_id,f.id)=(p_org,p_id) and f.kind='contact'
$$;
revoke all on function private.contact_row(uuid,uuid,uuid) from public,anon,authenticated;

create function private.customer_contact_choices(p_org uuid,p_actor uuid,p_search text) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'departments',(
   select coalesce(jsonb_agg(jsonb_build_object('key',d.normalized_name,'name',d.name) order by d.name),'[]'::jsonb)
   from private.customer_departments d where (d.organization_id,d.account_id)=(p_org,a.id)
 )) order by a.name,a.id),'[]'::jsonb)
 from (
   select a.id,a.name from public.accounts a left join private.customer_master m on (m.organization_id,m.account_id)=(a.organization_id,a.id)
   where a.organization_id=p_org and private.customer_visible(p_org,p_actor,a.id)
    and (p_search='' or strpos(lower(concat_ws(' ',a.name,m.details->>'city',m.details->>'state')),p_search)>0)
   order by a.name,a.id limit 100
 ) a
$$;
revoke all on function private.customer_contact_choices(uuid,uuid,text) from public,anon,authenticated;

create function private.read_customer_master(p_org uuid,p_query jsonb,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare
 actor uuid := private.staff_admin_actor(p_org,'account.read');
 is_contact boolean := p_query->>'kind'='contacts';
 contact_access boolean;
 manager boolean;
 needle text := lower(btrim(coalesce(p_query->>'search','')));
 start_at int := greatest(0,least(100000,coalesce((p_query->>'offset')::int,0)));
 row_data jsonb;
 opp_ids uuid[];
begin
 if actor is null then raise exception 'Customer access denied' using errcode='42501'; end if;
 if jsonb_typeof(p_query) is distinct from 'object' or octet_length(p_query::text)>4000 then
   raise exception 'Invalid customer filters' using errcode='22023';
 end if;
 contact_access:=private.intake_actor_can(p_org,actor,'contact.read');
 manager:=private.intake_actor_can(p_org,actor,'account.manage');
 if (is_contact or p_query->>'kind'='contact_choices') and not contact_access then
   raise exception 'Contact access denied' using errcode='42501';
 end if;
 if p_query->>'kind'='contact_choices' then return private.customer_contact_choices(p_org,actor,needle); end if;
 if p_id is null then
   if is_contact then
     select coalesce(jsonb_agg(private.contact_row(p_org,actor,contacts.id) order by contacts.title,contacts.id),'[]'::jsonb) into row_data
     from (select f.id,f.title from private.sales_field_records f
      where f.organization_id=p_org and f.kind='contact' and private.contact_visible(p_org,actor,f.id)
        and (needle='' or strpos(lower(concat_ws(' ',f.title,f.details->>'email',f.details->>'phone',f.details->>'designation',f.details->>'whatsapp')),needle)>0)
      order by f.title,f.id offset start_at limit 26) contacts;
   else
     select coalesce(jsonb_agg(private.customer_row(p_org,customers.id) order by customers.name,customers.id),'[]'::jsonb) into row_data
     from (select a.id,a.name from public.accounts a left join private.customer_master m on (m.organization_id,m.account_id)=(a.organization_id,a.id)
       left join private.customer_groups g on (g.organization_id,g.id)=(m.organization_id,m.group_id)
       where a.organization_id=p_org and private.customer_visible(p_org,actor,a.id)
         and (not coalesce((p_query->>'distributors')::boolean,false) or a.account_type='Distributor')
         and (coalesce(p_query->>'category','')='' or coalesce(m.category,case a.account_type when 'Distributor' then 'Distributor' else 'Other' end)=p_query->>'category')
         and (coalesce(p_query->>'status','')='' or coalesce(m.details->>'status','Active')=p_query->>'status')
         and (needle='' or strpos(lower(concat_ws(' ',a.name,private.customer_number(a.display_number),g.name,m.details->>'city',m.details->>'state',m.details->>'pin')),needle)>0)
       order by a.name,a.id offset start_at limit 26) customers;
   end if;
   return jsonb_build_object('rows',row_data,'can_create',private.intake_actor_can(p_org,actor,case when is_contact then 'contact.create' else 'account.create' end),
     'can_contact',contact_access and private.intake_actor_can(p_org,actor,'contact.create'),'manage',manager,
     'actor_name',private.lead_member_name(p_org,actor),
     'accounts',case when contact_access then private.customer_contact_choices(p_org,actor,'') else '[]'::jsonb end,
     'staff',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',p.display_name) order by p.display_name) from public.memberships m
       join public.profiles p on p.id=m.user_id where m.organization_id=p_org and m.status='Active' and manager
          and private.intake_actor_can(p_org,m.id,'account.read')),'[]'::jsonb),
     'territories',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by t.name)
       from private.territories t where t.organization_id=p_org and (manager or exists(select 1 from private.territory_memberships tm
         where (tm.organization_id,tm.territory_id,tm.membership_id)=(p_org,t.id,actor)))),'[]'::jsonb)
   );
 end if;
 if is_contact then
   if not private.contact_visible(p_org,actor,p_id) then raise sqlstate 'PT404' using message='Contact unavailable'; end if;
   return private.contact_row(p_org,actor,p_id);
 end if;
 if not private.customer_visible(p_org,actor,p_id) then raise sqlstate 'PT404' using message='Customer unavailable'; end if;
 select array(select o.id from public.opportunities o join public.resources r on (r.organization_id,r.id)=(o.organization_id,o.id)
  where o.organization_id=p_org and o.account_id=p_id and r.archived_at is null and r.owner_membership_id=actor
   and private.intake_actor_can(p_org,actor,'opportunity.read')) into opp_ids;
 select private.customer_row(p_org,p_id) || jsonb_build_object(
   'can_edit',manager or (private.intake_actor_can(p_org,actor,'account.create') and r.owner_membership_id=actor),
   'can_attach',r.owner_membership_id=actor and private.intake_actor_can(p_org,actor,'file.stage'),
   'can_download',r.owner_membership_id=actor and private.intake_actor_can(p_org,actor,'file.download'),
   'departments',coalesce((select jsonb_agg(jsonb_build_object('key',d.normalized_name,'name',d.name) order by d.name)
     from private.customer_departments d where (d.organization_id,d.account_id)=(p_org,p_id)),'[]'::jsonb),
   'branches',coalesce((select jsonb_agg(private.customer_row(p_org,b.account_id) order by b.account_id) from (
     select peer.account_id from private.customer_master m join private.customer_master peer
       on (peer.organization_id,peer.group_id)=(m.organization_id,m.group_id)
     where (m.organization_id,m.account_id)=(p_org,p_id) and peer.account_id<>p_id
      and private.customer_visible(p_org,actor,peer.account_id) order by peer.account_id limit 100
   ) b),'[]'::jsonb),
   'contacts',coalesce((select jsonb_agg(private.contact_row(p_org,actor,c.id) order by c.title,c.id) from (
     select f.id,f.title from private.sales_field_records f where f.organization_id=p_org and f.kind='contact' and contact_access
       and (f.parent_id=p_id or exists(select 1 from private.contact_affiliations link
        where (link.organization_id,link.contact_id,link.account_id)=(p_org,f.id,p_id) and link.active))
       and private.contact_visible(p_org,actor,f.id) order by f.title,f.id limit 100
   ) c),'[]'::jsonb),
   'leads',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc) from (
     select l.id,private.lead_number(l.display_number,l.ingested_at) reference,l.prospect_name title,
       coalesce(stage.label,l.sales_stage) status,l.received_at created_at
     from public.leads l left join private.lead_catalog(p_org) stage on stage.kind='stage' and stage.code=l.sales_stage
     where l.organization_id=p_org and l.merged_into is null and l.account_id=p_id
       and private.intake_actor_can(p_org,actor,'lead.read') and private.lead_visible(p_org,actor,l.id)
     order by l.received_at desc limit 100
   ) l),'[]'::jsonb),
   'related',coalesce((select jsonb_agg(to_jsonb(item) order by item.created_at desc) from (
     select f.id,f.kind,f.title,f.status,f.created_at,f.planned_at,f.ended_at,
       case when f.kind='financial_reference' then f.details->>'type' else f.kind end subtype,
       f.details->>'number' reference,
       f.details->>'amount' amount,
       case when f.kind='equipment' then f.details end equipment
     from private.sales_field_records f join public.resources fr on (fr.organization_id,fr.id)=(f.organization_id,f.id)
     left join private.sales_field_records site on (site.organization_id,site.id)=(f.organization_id,f.parent_id) and site.kind='site'
     left join public.resources sr on (sr.organization_id,sr.id)=(site.organization_id,site.id)
     where f.organization_id=p_org and fr.archived_at is null and private.intake_actor_can(p_org,actor,f.kind||'.read')
       and (
         (f.kind='site' and f.parent_id=p_id)
         or (f.kind in ('equipment','visit') and sr.archived_at is null and site.parent_id=p_id
           and private.intake_actor_can(p_org,actor,'site.read') and fr.owner_membership_id=actor)
         or (f.kind in ('quotation','financial_reference','demo') and fr.owner_membership_id=actor
           and (f.parent_id=any(opp_ids) or (f.kind='demo' and f.parent_id=p_id)))
       ) order by f.created_at desc,f.id limit 250
   ) item),'[]'::jsonb),
   'timeline',coalesce((select jsonb_agg(to_jsonb(event) order by event.created_at desc) from (
     select a.action title,a.occurred_at created_at,private.lead_member_name(p_org,a.actor_membership_id) actor
     from private.audit_events a where a.organization_id=p_org and a.resource_id=p_id
       and a.action in ('account.create','customer.create','customer.edit','customer.department','resource.owner.transfer')
     order by a.occurred_at desc limit 100
   ) event),'[]'::jsonb)
 ) into row_data from public.resources r where (r.organization_id,r.id)=(p_org,p_id);
 return row_data;
end
$$;
revoke all on function private.read_customer_master(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function private.read_customer_master(uuid,jsonb,uuid) to authenticated;
create function public.read_customer_master(p_org uuid,p_query jsonb default '{}'::jsonb,p_id uuid default null) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
 select private.read_customer_master(p_org,p_query,p_id)
$$;
revoke all on function public.read_customer_master(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.read_customer_master(uuid,jsonb,uuid) to authenticated;

create function private.command_customer_master(p_org uuid,p_action text,p_key uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
 actor uuid:=private.staff_admin_actor(p_org,'account.read');
 target uuid:=nullif(p_input->>'id','')::uuid;
 current_owner uuid;
 selected_owner uuid;
 selected_territory uuid;
 current_territory uuid;
 version_now integer;
 fields jsonb:=p_input->'fields';
 links jsonb:=coalesce(p_input->'links','[]'::jsonb);
 item jsonb;
 selected_account uuid;
 primary_account uuid;
 selected_department text;
 name_value text;
 category_value text;
 group_value text;
 group_key uuid;
 zoho_value text;
 name_key text;
 location text;

 prop text;
 phone text;
 result jsonb;
 receipt private.operation_receipts%rowtype;
 digest text;
 task text:='customer.'||p_action;
 can_manage boolean;
 is_contact boolean:=p_action in ('contact_create','contact_edit');
begin
 if actor is null then raise exception 'Customer access denied' using errcode='42501'; end if;
 if p_key is null or p_action is null or p_action not in ('create','edit','department','contact_create','contact_edit')
   or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>35000
   or jsonb_typeof(fields) is distinct from 'object' then raise exception 'Invalid customer request' using errcode='22023'; end if;
 if exists(select 1 from jsonb_each(fields) entry where jsonb_typeof(entry.value) not in ('string','null')
   or length(entry.value #>> '{}')>case when entry.key='notes' then 5000 else 1000 end)
   then raise exception 'Review the field lengths' using errcode='22023'; end if;
 can_manage:=private.intake_actor_can(p_org,actor,'account.manage');
 if (p_action='create' and not private.intake_actor_can(p_org,actor,'account.create')) or
   (is_contact and not (private.intake_actor_can(p_org,actor,'contact.read')
     and private.intake_actor_can(p_org,actor,case when p_action='contact_create' then 'contact.create' else 'contact.update' end)))
   then raise exception 'Customer action denied' using errcode='42501'; end if;
 perform 1 from public.memberships where (organization_id,id)=(p_org,actor) and status='Active' for share;
 if not found then raise exception 'Customer action denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_key::text,0));
 digest:=encode(sha256(convert_to(p_input::text,'UTF8')),'hex');
 select * into receipt from private.operation_receipts where (organization_id,actor_membership_id,operation_key)=(p_org,actor,p_key);
 if found then
   if receipt.command_type<>task or receipt.request_hash<>digest then raise sqlstate 'PT409' using message='Request key already used'; end if;
   return receipt.response_snapshot;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('customer-master:'||p_org::text,0));

 if p_action in ('edit','department') then
   select a.master_version,r.owner_membership_id,r.territory_id into version_now,current_owner,current_territory
   from public.accounts a join public.resources r on (r.organization_id,r.id)=(a.organization_id,a.id)
   where (a.organization_id,a.id)=(p_org,target) and r.archived_at is null for update of a,r;
   if not found or not (can_manage or (current_owner is not distinct from actor and private.intake_actor_can(p_org,actor,'account.create'))) then
     raise sqlstate 'PT404' using message='Customer unavailable';
   end if;
   if version_now is distinct from (p_input->>'version')::int then raise sqlstate 'PT409' using message='Customer changed. Refresh and try again'; end if;
 end if;
 name_value:=nullif(btrim(fields->>'name'),'');
 if name_value is null or length(name_value)>200 then raise exception 'Enter a name' using errcode='22023'; end if;

 if p_action='department' then
   if length(name_value)>120 then raise exception 'Enter a shorter department name' using errcode='22023'; end if;
   insert into private.customer_departments(organization_id,account_id,name) values(p_org,target,name_value)
    on conflict do nothing;
   update public.accounts set master_version=master_version+1 where (organization_id,id)=(p_org,target);
 elsif is_contact then
   if p_action='contact_edit' then
     select f.version,r.owner_membership_id,f.parent_id into version_now,current_owner,primary_account
     from private.sales_field_records f join public.resources r on (r.organization_id,r.id)=(f.organization_id,f.id)
     where (f.organization_id,f.id)=(p_org,target) and f.kind='contact' and r.archived_at is null for update of f,r;
     if not found or not (current_owner is not distinct from actor or can_manage) or not private.customer_visible(p_org,actor,primary_account) then
       raise sqlstate 'PT404' using message='Contact unavailable';
     end if;
     if version_now is distinct from (p_input->>'version')::int then raise sqlstate 'PT409' using message='Contact changed. Refresh and try again'; end if;
   end if;
   primary_account:=nullif(fields->>'account','')::uuid;
   if primary_account is null or not private.customer_visible(p_org,actor,primary_account) then raise sqlstate 'PT404' using message='Select a visible customer'; end if;
   foreach prop in array array['phone','whatsapp','office_phone'] loop
     phone:=nullif(regexp_replace(coalesce(fields->>prop,''),'[ .()-]','','g'),'');
     if phone is not null and phone !~ '^[+]?[0-9]{7,15}$' then raise exception 'Review the contact telephone numbers' using errcode='22023'; end if;
     fields:=jsonb_set(fields,array[prop],coalesce(to_jsonb(phone),'null'::jsonb));
   end loop;
   if nullif(fields->>'email','') is not null and (length(fields->>'email')>254
      or fields->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') then
     raise exception 'Review the contact email address' using errcode='22023';
   end if;
   if coalesce(fields->>'decision_role','') not in ('','Decision Maker','Technical Evaluator','Influencer','End User','Purchase Authority','Financial Approver')
     then raise exception 'Select a decision-making role' using errcode='22023'; end if;
   if jsonb_typeof(links) is distinct from 'array' or jsonb_array_length(links) not between 1 and 40 or not exists(
     select 1 from jsonb_array_elements(links) s where s->>'account'=primary_account::text
   ) then raise exception 'Select the primary customer and its affiliation' using errcode='22023'; end if;
   foreach prop in array array['designation','email','category','decision_role','preference'] loop
     if length(fields->>prop)>254 then raise exception 'Review the contact field lengths' using errcode='22023'; end if;
   end loop;
   if p_action='contact_create' then
     insert into public.resources(organization_id,resource_type,owner_membership_id) values(p_org,'contact',actor) returning id into target;
     insert into private.sales_field_records(organization_id,id,kind,owner_id,parent_id,title,status,details)
       values(p_org,target,'contact',actor,primary_account,name_value,'Active',fields-array['name','account']) returning version into version_now;
   else
     update private.sales_field_records set parent_id=primary_account,title=name_value,details=details||(fields-array['name','account']),version=version+1
       where (organization_id,id)=(p_org,target) returning version into version_now;
     update private.contact_affiliations link set active=false where (link.organization_id,link.contact_id)=(p_org,target)
       and private.customer_visible(p_org,actor,link.account_id)
       and not exists(select 1 from jsonb_array_elements(links) val where val->>'account'=link.account_id::text);
   end if;
   for item in select value from jsonb_array_elements(links) loop
     selected_account:=(item->>'account')::uuid;
     selected_department:=nullif(item->>'department','');
     if selected_account is null or not private.customer_visible(p_org,actor,selected_account) then
       raise sqlstate 'PT404' using message='An affiliated customer is unavailable';
     end if;
     if selected_department is not null and not exists(select 1 from private.customer_departments d
       where (d.organization_id,d.account_id,d.normalized_name)=(p_org,selected_account,selected_department)) then
       raise exception 'Choose a department from the affiliated customer' using errcode='22023';
     end if;
     insert into private.contact_affiliations values(p_org,target,selected_account,selected_department,true)
       on conflict (organization_id,contact_id,account_id) do update set department_key=excluded.department_key,active=true;
   end loop;
 else
   category_value:=fields->>'category';
   name_key:=lower(regexp_replace(name_value,'[[:space:]]+',' ','g'));
   group_value:=nullif(btrim(fields->>'group'),'');
   zoho_value:=nullif(btrim(fields->>'zoho_id'),'');
   if length(group_value)>200 or length(zoho_value)>120 then raise exception 'Review the group name and Zoho reference' using errcode='22023'; end if;
   if coalesce(fields->>'status','') not in ('Active','Prospect','Inactive','On Hold') then raise exception 'Select a customer status' using errcode='22023'; end if;
   if nullif(fields->>'website','') is not null and fields->>'website' !~* '^https?://[a-z0-9][a-z0-9.:-]*([/?#][^[:space:]<>]*)?$' then
     raise exception 'Enter a complete HTTP or HTTPS website address' using errcode='22023';
   end if;
   phone:=nullif(regexp_replace(coalesce(fields->>'phone',''),'[ .()-]','','g'),'');
   if phone is not null and phone !~ '^[+]?[0-9]{7,15}$' then raise exception 'Review the main telephone number' using errcode='22023'; end if;
   fields:=jsonb_set(fields,array['phone'],coalesce(to_jsonb(phone),'null'::jsonb));
   foreach prop in array array['beds','nicu','picu','icu','theatres'] loop
     if nullif(fields->>prop,'') is not null and fields->>prop !~ '^[0-9]{1,6}$'
       then raise exception 'Enter whole, nonnegative capacities' using errcode='22023'; end if;
   end loop;
   if (nullif(fields->>'latitude','') is null)<>(nullif(fields->>'longitude','') is null) then
     raise exception 'Supply both coordinates or leave both blank' using errcode='22023';
   end if;
   if nullif(fields->>'latitude','') is not null and (
      fields->>'latitude' !~ '^-?[0-9]{1,3}([.][0-9]{1,8})?$' or fields->>'longitude' !~ '^-?[0-9]{1,3}([.][0-9]{1,8})?$'
      or (fields->>'latitude')::numeric not between -90 and 90 or (fields->>'longitude')::numeric not between -180 and 180
   ) then raise exception 'Review latitude and longitude' using errcode='22023'; end if;
   location:=nullif(lower(regexp_replace(btrim(coalesce(nullif(fields->>'address',''),nullif(fields->>'pin',''),
      concat_ws(' ',nullif(fields->>'city',''),nullif(fields->>'state','')))),'[[:space:][:punct:]]+','','g')),'');
   if exists(select 1 from public.accounts a join public.resources r on (r.organization_id,r.id)=(a.organization_id,a.id)
     left join private.customer_master m on (m.organization_id,m.account_id)=(a.organization_id,a.id)
     where a.organization_id=p_org and a.id is distinct from target and r.archived_at is null
       and coalesce(m.normalized_name,lower(regexp_replace(btrim(a.name),'[[:space:]]+',' ','g')))=name_key
       and (m.location_key is not distinct from location
          or (m.location_key is null and location is null)
          or ((nullif(fields->>'address','') is null or nullif(m.details->>'address','') is null)
            and nullif(lower(btrim(fields->>'city')),'')=nullif(lower(btrim(m.details->>'city')),'')
            and (nullif(fields->>'pin','') is null or nullif(m.details->>'pin','') is null
                 or lower(fields->>'pin')=lower(m.details->>'pin'))))
   ) then raise sqlstate 'PT409' using message='A matching customer already exists. Search the directory before adding it'; end if;

   selected_owner:=case when p_action='create' then actor else current_owner end;
   if can_manage and fields ? 'owner' and nullif(fields->>'owner','') is not null then
     selected_owner:=(fields->>'owner')::uuid;
     if not exists(select 1 from public.memberships m where (m.organization_id,m.id)=(p_org,selected_owner) and m.status='Active')
       or not private.intake_actor_can(p_org,selected_owner,'account.read') then
       raise exception 'Choose an active salesperson with customer access' using errcode='22023';
     end if;
   end if;
   selected_territory:=case when fields ? 'territory' then nullif(fields->>'territory','')::uuid else current_territory end;
   if selected_territory is not null and selected_territory is distinct from current_territory and
     (not exists(select 1 from private.territories t where (t.organization_id,t.id)=(p_org,selected_territory))
      or (not can_manage and not exists(select 1 from private.territory_memberships t
        where (t.organization_id,t.territory_id,t.membership_id)=(p_org,selected_territory,actor)))) then
     raise sqlstate 'PT404' using message='Territory unavailable';
   end if;
   if group_value is not null then
     insert into private.customer_groups(organization_id,name) values(p_org,group_value)
       on conflict(organization_id,normalized_name) do nothing;
     select id into group_key from private.customer_groups where organization_id=p_org
       and normalized_name=lower(regexp_replace(btrim(group_value),'[[:space:]]+',' ','g'));
   end if;
   if p_action='create' then
     insert into public.resources(organization_id,resource_type,owner_membership_id,territory_id)
       values(p_org,'account',selected_owner,selected_territory) returning id into target;
     insert into public.accounts(id,organization_id,name,account_type) values(target,p_org,name_value,
       case category_value when 'Distributor' then 'Distributor' when 'Government Department' then 'Institution'
         when 'Procurement Agency' then 'Institution' when 'Medical College' then 'Institution' when 'Other' then 'Other' else 'Hospital' end);
   else
     update public.resources set owner_membership_id=selected_owner,territory_id=selected_territory where (organization_id,id)=(p_org,target);
     update public.accounts set name=name_value,master_version=master_version+1,account_type=
       case category_value when 'Distributor' then 'Distributor' when 'Government Department' then 'Institution'
         when 'Procurement Agency' then 'Institution' when 'Medical College' then 'Institution' when 'Other' then 'Other' else 'Hospital' end
       where (organization_id,id)=(p_org,target);
   end if;
   insert into private.customer_master values(p_org,target,group_key,category_value,name_key,location,zoho_value,
      fields-array['name','category','group','zoho_id','owner','territory'])
     on conflict (organization_id,account_id) do update set group_id=excluded.group_id,category=excluded.category,
       normalized_name=excluded.normalized_name,location_key=excluded.location_key,zoho_id=excluded.zoho_id,details=excluded.details;
 end if;
 insert into private.audit_events(organization_id,actor_membership_id,resource_id,action,request_id,redacted_details)
  values(p_org,actor,target,task,p_key,jsonb_build_object('ownership_changed',selected_owner is distinct from current_owner));
 if is_contact then
   insert into private.sales_field_events(organization_id,record_id,version,actor_id,event_type,details)
     values(p_org,target,version_now,actor,p_action,jsonb_build_object('affiliate_count',jsonb_array_length(links)));
 end if;
 result:=jsonb_build_object('id',target,'visible',case when is_contact then private.contact_visible(p_org,actor,target) else private.customer_visible(p_org,actor,target) end);
 insert into private.operation_receipts(organization_id,actor_membership_id,operation_key,command_type,request_hash,response_snapshot)
  values(p_org,actor,p_key,task,digest,result);
 return result;
end
$$;
revoke all on function private.command_customer_master(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.command_customer_master(uuid,text,uuid,jsonb) to authenticated;
create function public.command_customer_master(p_org uuid,p_action text,p_key uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path=pg_catalog as $$
 select private.command_customer_master(p_org,p_action,p_key,p_input)
$$;
revoke all on function public.command_customer_master(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.command_customer_master(uuid,text,uuid,jsonb) to authenticated;

create or replace function private.file_parent_allowed(
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
    when p_type='contact' then p_purpose='business_document' and p_owner=p_actor
      and private.contact_visible(p_org,p_actor,p_parent)
      and private.intake_actor_can(p_org,p_actor,case when p_download then 'file.download' else 'file.stage' end)
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
   and r.archived_at is null and r.resource_type in ('account','lead','contact');
 if kind is null or private.staff_admin_actor(p_org,kind || '.read') is distinct from actor
    or (kind='contact' and not private.contact_visible(p_org,actor,p_resource)) then
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
    or (parent_type in ('tender','travel_request','expense_claim','contact') and not exists (
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
