alter table public.leads
  add column source_key text,
  add column external_reference text,
  add column customer_type text,
  add column contact_person text,
  add column designation text,
  add column mobile text,
  add column alternate_mobile text,
  add column email text,
  add column city text,
  add column state text,
  add column country text,
  add column priority text not null default 'Unqualified' check(priority in ('Hot','Warm','Cold','Unqualified')),
  add column sales_stage text not null default 'new',
  add column probability smallint check(probability between 0 and 100),
  add column budget numeric(18,2) check(budget>=0),
  add column expected_value numeric(18,2) check(expected_value>=0),
  add column expected_purchase_on date,
  add column description text,
  add column loss_reason text,
  add column competitor text,
  add column updated_at timestamptz,
  add column created_by uuid,
  add column updated_by uuid,
  add column merged_into uuid,
  add column product_revision integer not null default 1 check(product_revision>0),
  add foreign key (organization_id,created_by) references public.memberships(organization_id,id),
  add foreign key (organization_id,updated_by) references public.memberships(organization_id,id),
  add foreign key (organization_id,merged_into) references public.leads(organization_id,id),
  add check (merged_into is distinct from id);
create unique index lead_external_reference_unique on public.leads(organization_id,source_key,lower(external_reference))
  where external_reference is not null;
create index lead_mobile_lookup on public.leads(organization_id,mobile) where mobile is not null and merged_into is null;
create index lead_email_lookup on public.leads(organization_id,lower(email)) where email is not null and merged_into is null;
create index lead_stage_lookup on public.leads(organization_id,sales_stage,received_at desc,id) where merged_into is null;
create index lead_merge_lookup on public.leads(organization_id,merged_into) where merged_into is not null;

create table private.lead_defaults (
  kind text not null check(kind in ('source','stage','loss')),
  code text not null,
  label text not null,
  sort_order integer not null,
  behavior text,
  primary key(kind,code)
);
insert into private.lead_defaults values
 ('source','indiamart','IndiaMART',10,null),('source','website','Company website',20,null),
 ('source','telephone','Telephone inquiry',30,null),('source','whatsapp','WhatsApp',40,null),('source','email','Email',50,null),
 ('source','hospital_visit','Hospital visit',60,null),('source','exhibition','Exhibition',70,null),('source','distributor','Distributor',80,null),
 ('source','customer_referral','Customer referral',90,null),('source','doctor_referral','Doctor referral',100,null),
 ('source','government','Government inquiry',110,null),('source','social','Social media',120,null),
 ('source','existing_customer','Existing customer',130,null),('source','other','Other',140,null),('source','csv','CSV import',150,null),
 ('stage','new','New Inquiry',10,'new'),('stage','contact_pending','Contact Pending',20,'new'),('stage','contacted','Contacted',30,'active'),
 ('stage','understanding','Requirement Understanding',40,'active'),('stage','qualified','Qualified',50,'qualified'),
 ('stage','quote_requested','Quotation Requested',60,'qualified'),('stage','quote_submitted','Quotation Submitted',70,'qualified'),
 ('stage','demo_requested','Demonstration Requested',80,'qualified'),('stage','demo_completed','Demonstration Completed',90,'qualified'),
 ('stage','negotiation','Negotiation',100,'qualified'),('stage','purchase_approval','Purchase Approval Pending',110,'qualified'),
 ('stage','order_confirmed','Order Confirmed',120,'qualified'),('stage','won','Won',130,'won'),('stage','lost','Lost',140,'lost'),
 ('stage','hold','On Hold',150,'hold'),('stage','not_qualified','Closed – Not Qualified',160,'closed'),
 ('loss','price','Price too high',10,null),('loss','competitor','Competitor selected',20,null),
 ('loss','specification','Technical specification mismatch',30,null),('loss','budget','Budget unavailable',40,null),
 ('loss','postponed','Purchase postponed',50,null),('loss','product','Product unavailable',60,null),
 ('loss','certification','Certification requirement',70,null),('loss','no_response','Customer not responding',80,null),
 ('loss','distributor','Distributor-related issue',90,null),('loss','tender','Tender unsuccessful',100,null),('loss','other','Other',110,null);

create table private.lead_options (
  organization_id uuid not null references public.organizations(id),
  kind text not null check(kind in ('source','stage','loss')),
  code text not null check(code ~ '^[a-z][a-z0-9_]{0,59}$'),
  label text not null check(length(btrim(label)) between 1 and 120),
  sort_order integer not null check(sort_order between 1 and 9999),
  behavior text,
  active boolean not null default true,
  primary key(organization_id,kind,code),
  check ((kind='stage' and behavior in ('new','active','qualified','hold','won','lost','closed')) or (kind<>'stage' and behavior is null))
);
create table private.lead_rules (
  organization_id uuid primary key references public.organizations(id),
  response_hours integer not null default 24 check(response_hours between 1 and 720),
  inactive_days integer not null default 7 check(inactive_days between 1 and 365)
);
create table private.lead_territory_routes (
  organization_id uuid not null,
  territory_id uuid not null,
  member_id uuid,
  primary key(organization_id,territory_id),
  foreign key(organization_id,territory_id) references private.territories(organization_id,id),
  foreign key(organization_id,member_id) references public.memberships(organization_id,id)
);
create table private.lead_products (
  organization_id uuid not null,
  lead_id uuid not null,
  line_no integer not null check(line_no between 1 and 100),
  revision integer not null check(revision>0),
  category text not null check(length(btrim(category)) between 1 and 150),
  model text not null check(length(btrim(model)) between 1 and 200),
  quantity integer not null check(quantity between 1 and 1000000),
  estimated_unit_price numeric(18,2) check(estimated_unit_price>=0),
  requirements text check(length(requirements)<=4000),
  primary key(organization_id,lead_id,revision,line_no),
  foreign key(organization_id,lead_id) references public.leads(organization_id,id)
);
create trigger lead_products_immutable before update or delete or truncate on private.lead_products
  for each statement execute function private.reject_mutation();
create table private.lead_events (
  event_id bigint generated always as identity primary key,
  organization_id uuid not null,
  lead_id uuid not null,
  actor_id uuid not null,
  kind text not null,
  occurred_at timestamptz not null default now(),
  details jsonb not null,
  foreign key(organization_id,lead_id) references public.leads(organization_id,id),
  foreign key(organization_id,actor_id) references public.memberships(organization_id,id)
);
create index lead_events_lookup on private.lead_events(organization_id,lead_id,occurred_at desc,event_id desc);
create trigger lead_events_immutable before update or delete or truncate on private.lead_events
  for each statement execute function private.reject_mutation();
create table private.lead_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  recipient_id uuid not null,
  lead_id uuid not null,
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  foreign key(organization_id,lead_id) references public.leads(organization_id,id),
  foreign key(organization_id,recipient_id) references public.memberships(organization_id,id)
);
create index lead_notifications_inbox on private.lead_notifications(organization_id,recipient_id,created_at desc);
do $$
declare relation text;
begin
  foreach relation in array array['lead_defaults','lead_options','lead_rules','lead_territory_routes','lead_products','lead_events','lead_notifications'] loop
    execute format('alter table private.%I enable row level security',relation);
    execute format('revoke all on table private.%I from public, anon, authenticated',relation);
  end loop;
end
$$;

insert into public.permissions(code,description) values
 ('lead.manage','Manage organization lead allocation and duplicate review'),
 ('lead.reopen','Reopen closed leads within authorized write scope'),
 ('lead.settings','Configure organization lead sources, stages, reasons and routing'),
 ('lead.export','Export leads within the actor’s read scope');
create function private.install_lead_admin_permissions() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  insert into public.role_permissions(organization_id,role_id,permission_code)
  select new.organization_id,new.id,code from public.permissions where code in ('lead.manage','lead.reopen','lead.settings','lead.export')
  on conflict do nothing;
  return new;
end
$$;
revoke all on function private.install_lead_admin_permissions() from public, anon, authenticated;
create trigger install_lead_admin_permissions after insert on public.roles for each row when (new.code='super_admin')
execute function private.install_lead_admin_permissions();
insert into public.role_permissions(organization_id,role_id,permission_code)
select r.organization_id,r.id,p.code from public.roles r cross join public.permissions p
where r.code='super_admin' and p.code in ('lead.manage','lead.reopen','lead.settings','lead.export') on conflict do nothing;
create policy resources_lead_management on public.resources for select to authenticated using(
  resource_type='lead' and archived_at is null
  and private.has_permission(organization_id,'lead.read') and private.has_permission(organization_id,'lead.manage')
);

create function private.lead_catalog(p_org uuid)
returns table(kind text,code text,label text,sort_order integer,behavior text,active boolean)
language sql stable security invoker set search_path=pg_catalog as $$
  select coalesce(o.kind,d.kind),coalesce(o.code,d.code),coalesce(o.label,d.label),
    coalesce(o.sort_order,d.sort_order),coalesce(o.behavior,d.behavior),coalesce(o.active,true)
  from private.lead_defaults d full join
    (select * from private.lead_options where organization_id=p_org) o using(kind,code)
$$;
revoke all on function private.lead_catalog(uuid) from public, anon, authenticated;

create function private.legacy_lead_source(value text) returns text
language sql immutable security invoker set search_path=pg_catalog as $$
 select case value when 'IndiaMART' then 'indiamart' when 'Website' then 'website' when 'Telephone' then 'telephone'
   when 'WhatsApp' then 'whatsapp' when 'Email' then 'email' when 'Referral' then 'customer_referral'
   when 'Event' then 'exhibition' when 'CSV' then 'csv' else 'other' end
$$;
revoke all on function private.legacy_lead_source(text) from public, anon, authenticated;

create function private.sync_lead_lifecycle() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if tg_op='INSERT' then
    new.source_key := coalesce(new.source_key,private.legacy_lead_source(new.source));
    if not exists(select 1 from private.lead_catalog(new.organization_id) c where c.kind='source' and c.code=new.source_key and c.active) then
      raise exception 'Choose an available inquiry source' using errcode='22023';
    end if;
    new.created_by := coalesce(new.created_by,private.staff_admin_actor(new.organization_id,'lead.create'));
    new.updated_by := coalesce(new.updated_by,new.created_by);
    new.mobile := coalesce(new.mobile,case when new.contact_route ~ '^[+]?[0-9]{7,15}$' then new.contact_route end);
    new.email := coalesce(new.email,case when strpos(new.contact_route,'@')>0 then lower(new.contact_route) end);
    new.updated_at := coalesce(new.updated_at,new.ingested_at);
  elsif new.lifecycle<>old.lifecycle and new.sales_stage=old.sales_stage then
    new.sales_stage := case new.lifecycle when 'Contacted' then 'contacted' when 'Qualified' then 'qualified'
      when 'Disqualified' then 'not_qualified' else old.sales_stage end;
    new.updated_at := now();
  end if;
  return new;
end
$$;
revoke all on function private.sync_lead_lifecycle() from public, anon, authenticated;
create trigger sync_lead_lifecycle before insert or update on public.leads for each row execute function private.sync_lead_lifecycle();
update public.leads l set source_key=private.legacy_lead_source(source), updated_at=coalesce(first_attempt_at,ingested_at),
  mobile=case when contact_route ~ '^[+]?[0-9]{7,15}$' then contact_route end,
  email=case when strpos(contact_route,'@')>0 then lower(contact_route) end,
  sales_stage=case lifecycle when 'Contacted' then 'contacted' when 'Qualified' then 'qualified'
      when 'Converted' then 'qualified' when 'Disqualified' then 'not_qualified' else 'new' end,
  created_by=(select a.actor_membership_id from private.audit_events a where a.organization_id=l.organization_id
    and a.resource_id=l.id and a.action='lead.create' order by a.occurred_at limit 1);
alter table public.leads alter column source_key set not null;

create function private.lead_team(p_org uuid,p_actor uuid) returns table(member_id uuid)
language sql stable security invoker set search_path=pg_catalog as $$
  with recursive reports(id) as (
    select p_actor
    union
    select r.member_id from reports x join private.reporting_lines r on r.organization_id=p_org and r.manager_id=x.id
    join public.memberships m on (m.organization_id,m.id)=(r.organization_id,r.member_id) and m.status='Active'
  ) select id from reports where id<>p_actor
$$;
revoke all on function private.lead_team(uuid,uuid) from public, anon, authenticated;

create function private.lead_visible(p_org uuid,p_actor uuid,p_id uuid) returns boolean
language sql stable security invoker set search_path=pg_catalog as $$
  select exists(select 1 from public.resources r where r.organization_id=p_org and r.id=p_id
    and r.resource_type='lead' and r.archived_at is null and (
      r.owner_membership_id=p_actor or private.intake_actor_can(p_org,p_actor,'lead.manage')
      or private.crm_read_scope(p_org,r.owner_membership_id,r.territory_id,'lead')
      or private.has_crm_record_share(p_org,r.id,r.owner_membership_id)
    ))
$$;
revoke all on function private.lead_visible(uuid,uuid,uuid) from public, anon, authenticated;

create function private.lead_member_name(p_org uuid,p_member uuid) returns text
language sql stable security invoker set search_path=pg_catalog as $$
  select p.display_name from public.memberships m join public.profiles p on p.id=m.user_id
  where (m.organization_id,m.id)=(p_org,p_member)
$$;
revoke all on function private.lead_member_name(uuid,uuid) from public, anon, authenticated;

create function private.lead_number(value bigint,created timestamptz) returns text
language sql stable security invoker set search_path=pg_catalog as $$
  select 'LD-' || to_char(created at time zone 'Asia/Kolkata','YYYY') || '-' || lpad(value::text,greatest(3,length(value::text)),'0')
$$;
revoke all on function private.lead_number(bigint,timestamptz) from public, anon, authenticated;

create function private.lead_list(
  p_org uuid,p_actor uuid,p_query jsonb,p_limit integer,p_offset integer
) returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  with rules as (
    select coalesce(max(r.response_hours),24) response_hours,coalesce(max(r.inactive_days),7) inactive_days
    from private.lead_rules r where r.organization_id=p_org
  ), catalog as materialized (select * from private.lead_catalog(p_org)),
  team as materialized (select member_id from private.lead_team(p_org,p_actor)),
  scope as (
    select l.*,r.owner_membership_id owner,r.territory_id,t.name territory_name,coalesce(c.behavior,'new') behavior,
      coalesce(l.updated_at,l.ingested_at) modified,
      l.first_attempt_at is null and now() >= l.received_at + make_interval(hours=>rules.response_hours)
        and coalesce(c.behavior,'new') not in ('won','lost','closed','hold') sla_due,
      count(*) over() total
    from public.leads l join public.resources r on (r.organization_id,r.id)=(l.organization_id,l.id)
    left join private.territories t on (t.organization_id,t.id)=(r.organization_id,r.territory_id)
    left join catalog c on c.kind='stage' and c.code=l.sales_stage
    cross join rules
    where l.organization_id=p_org and l.merged_into is null and r.archived_at is null
      and private.lead_visible(p_org,p_actor,l.id)
      and (coalesce(p_query->>'search','')='' or
        strpos(lower(concat_ws(' ',l.prospect_name,l.contact_person,l.email,l.mobile,l.alternate_mobile,l.contact_route,l.city,l.state,
            l.external_reference,l.requirement_text,private.lead_number(l.display_number,l.ingested_at))),lower(p_query->>'search'))>0
        or exists(select 1 from private.lead_products p where (p.organization_id,p.lead_id,p.revision)=(l.organization_id,l.id,l.product_revision)
          and strpos(lower(p.model || ' ' || p.category || ' ' || coalesce(p.requirements,'')),lower(p_query->>'search'))>0))
      and (coalesce(p_query->>'source','')='' or l.source_key=p_query->>'source')
      and (coalesce(p_query->>'stage','')='' or l.sales_stage=p_query->>'stage')
      and (coalesce(p_query->>'priority','')='' or l.priority=p_query->>'priority')
      and (coalesce(p_query->>'territory','')='' or r.territory_id::text=p_query->>'territory')
      and (coalesce(p_query->>'owner','')='' or r.owner_membership_id::text=p_query->>'owner')
      and case p_query->>'view'
        when 'mine' then r.owner_membership_id=p_actor
        when 'team' then r.owner_membership_id in (select member_id from team)
        when 'unassigned' then r.owner_membership_id is null
        when 'new' then coalesce(c.behavior,'new')='new'
        when 'hot' then l.priority='Hot'
        when 'overdue' then l.next_action_due_at<now() and coalesce(c.behavior,'new') not in ('won','lost','closed')
        when 'inactive' then coalesce(l.updated_at,l.ingested_at)<now()-make_interval(days=>rules.inactive_days)
          and coalesce(c.behavior,'new') not in ('won','lost','closed')
        when 'won' then c.behavior='won'
        when 'lost' then c.behavior='lost'
        when 'active' then coalesce(c.behavior,'new') not in ('won','lost','closed')
        when 'escalated' then l.first_attempt_at is null and now()>=l.received_at+make_interval(hours=>rules.response_hours)
          and coalesce(c.behavior,'new') not in ('won','lost','closed','hold')
        else true end
  ), page as (
    select s.* from scope s order by
      case when p_query->>'sort'='oldest' then received_at end,
      case when p_query->>'sort'='customer' then lower(prospect_name) end,
      case when p_query->>'sort'='value' then expected_value end desc nulls last,
      case when p_query->>'sort'='followup' then next_action_due_at end nulls last,
      received_at desc,id offset p_offset limit p_limit
  )
  select jsonb_build_object('total',coalesce((select max(total) from scope),0),'rows',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',p.id,'version',p.row_version,'number',private.lead_number(p.display_number,p.ingested_at),
      'customer',p.prospect_name,'contact',p.contact_person,'designation',p.designation,'email',p.email,'mobile',p.mobile,
      'city',p.city,'state',p.state,'source',p.source_key,'stage',p.sales_stage,'behavior',p.behavior,'priority',p.priority,
      'owner',p.owner,'owner_name',private.lead_member_name(p_org,p.owner),'territory_name',p.territory_name,
      'value',p.expected_value::text,'received_at',p.received_at,'updated_at',p.modified,'follow_up',p.next_action_due_at,
      'first_response_overdue',p.sla_due,'lifecycle',p.lifecycle,
      'products',coalesce((select string_agg(lp.model || ' × ' || lp.quantity::text,', ' order by lp.line_no)
        from private.lead_products lp where (lp.organization_id,lp.lead_id,lp.revision)=(p.organization_id,p.id,p.product_revision) and lp.line_no<=3),left(p.requirement_text,150))
    )) from page p
  ),'[]'::jsonb))
$$;
revoke all on function private.lead_list(uuid,uuid,jsonb,integer,integer) from public, anon, authenticated;

create function private.read_lead_management(p_org uuid,p_query jsonb,p_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare
  actor uuid := private.staff_admin_actor(p_org,'lead.read');
  can_manage boolean;
  can_settings boolean;
  listing jsonb;
  detail jsonb;
  lead public.leads%rowtype;
  related_ids uuid[];
  prospect_team uuid[];
  linked_opportunities uuid[];
  sla_hours int;
  inactivity int;
begin
  if actor is null then raise exception 'Lead access denied' using errcode='42501'; end if;
  if jsonb_typeof(p_query) is distinct from 'object' or octet_length(p_query::text)>4000 then
    raise exception 'Invalid lead filters' using errcode='22023';
  end if;
  can_manage := private.intake_actor_can(p_org,actor,'lead.manage');
  can_settings := private.intake_actor_can(p_org,actor,'lead.settings');
  if p_query->>'summary'='sources' then
    return coalesce((select jsonb_agg(to_jsonb(counts) order by counts.sort_order,counts.label) from (
      select c.label,c.sort_order,count(l.id) total from private.lead_catalog(p_org) c
      left join public.leads l on l.organization_id=p_org and l.source_key=c.code and l.merged_into is null
        and (nullif(p_query->>'from','') is null or l.received_at >= (p_query->>'from')::timestamptz)
        and (nullif(p_query->>'through','') is null or l.received_at <= (p_query->>'through')::timestamptz)
        and private.lead_visible(p_org,actor,l.id)
      where c.kind='source' group by c.code,c.label,c.sort_order
    ) counts),'[]'::jsonb);
  elsif p_query->>'summary'='dashboard' then
    return jsonb_build_object('active',private.lead_list(p_org,actor,'{"view":"active"}'::jsonb,0,0)->'total',
      'overdue',private.lead_list(p_org,actor,'{"view":"overdue"}'::jsonb,0,0)->'total');
  end if;
  if p_id is null then
    listing := private.lead_list(p_org,actor,p_query,case when p_query->>'mode'='kanban' then 100 else 25 end,
      greatest(0,least(100000,coalesce((p_query->>'offset')::int,0))));
    prospect_team := array(select member_id from private.lead_team(p_org,actor));
    select coalesce(max(response_hours),24),coalesce(max(inactive_days),7) into sla_hours,inactivity
      from private.lead_rules where organization_id=p_org;
    return listing || jsonb_build_object(
      'catalog',coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order,c.code) from private.lead_catalog(p_org) c),'[]'::jsonb),
      'can_create',private.intake_actor_can(p_org,actor,'lead.create'),
      'can_manage',can_manage,'can_settings',can_settings,'can_export',private.intake_actor_can(p_org,actor,'lead.export'),
      'rules',jsonb_build_object('response_hours',sla_hours,'inactive_days',inactivity),
      'staff',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',p.display_name) order by p.display_name,m.id)
        from public.memberships m join public.profiles p on p.id=m.user_id where m.organization_id=p_org and m.status='Active'
          and (can_manage or can_settings or m.id=actor or m.id=any(prospect_team))
          and private.intake_actor_can(p_org,m.id,'lead.read')),'[]'::jsonb),
      'territories',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'owner',case when can_settings then route.member_id end) order by t.name)
        from private.territories t left join private.lead_territory_routes route
          on (route.organization_id,route.territory_id)=(t.organization_id,t.id)
        where t.organization_id=p_org
        and (can_manage or can_settings or exists(select 1 from private.territory_memberships tm
          where (tm.organization_id,tm.territory_id,tm.membership_id)=(p_org,t.id,actor)))),'[]'::jsonb),
      'accounts',coalesce((select jsonb_agg(to_jsonb(a) order by a.name) from (
        select a.id,a.name from public.accounts a join public.resources r on (r.organization_id,r.id)=(a.organization_id,a.id)
        where a.organization_id=p_org and r.owner_membership_id=actor and r.archived_at is null
          and private.intake_actor_can(p_org,actor,'account.read') order by a.name limit 250
      ) a),'[]'::jsonb),
      'notifications',coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc) from (
        select id,lead_id,message,created_at,read_at from private.lead_notifications
        where organization_id=p_org and recipient_id=actor order by created_at desc limit 30
      ) n),'[]'::jsonb),
      'escalations',(private.lead_list(p_org,actor,jsonb_build_object('view','escalated'),5,0)->'total')
    );
  end if;
  if not private.lead_visible(p_org,actor,p_id) then raise sqlstate 'PT404' using message='Lead unavailable'; end if;
  select * into strict lead from public.leads where (organization_id,id)=(p_org,p_id);
  with recursive family(id) as (
    select p_id union select l.id from family f join public.leads l on l.organization_id=p_org and l.merged_into=f.id
  ) select array_agg(id) into related_ids from family;
  select coalesce(array_agg(o.id),'{}'::uuid[]) into linked_opportunities from public.opportunities o
    join public.resources r on (r.organization_id,r.id)=(o.organization_id,o.id)
    where o.organization_id=p_org and o.origin_lead_id=any(related_ids) and r.archived_at is null
    and r.owner_membership_id=actor and private.intake_actor_can(p_org,actor,'opportunity.read');
  select jsonb_build_object(
    'number',private.lead_number(lead.display_number,lead.ingested_at),'data',to_jsonb(lead) || jsonb_build_object('budget',lead.budget::text,'expected_value',lead.expected_value::text),
    'owner',r.owner_membership_id,'owner_name',private.lead_member_name(p_org,r.owner_membership_id),'territory',r.territory_id,
    'created_name',private.lead_member_name(p_org,lead.created_by),'updated_name',private.lead_member_name(p_org,lead.updated_by),
    'can_edit',(r.owner_membership_id=actor and private.intake_actor_can(p_org,actor,'lead.contact')) or can_manage,
    'can_reopen',private.intake_actor_can(p_org,actor,'lead.reopen') and (r.owner_membership_id=actor or can_manage),
    'can_attach',r.owner_membership_id=actor and private.intake_actor_can(p_org,actor,'file.stage'),
    'can_download',r.owner_membership_id=actor and private.intake_actor_can(p_org,actor,'file.download'),
    'products',coalesce((select jsonb_agg(to_jsonb(p)-array['organization_id','lead_id','revision'] order by line_no)
      from private.lead_products p where (p.organization_id,p.lead_id,p.revision)=(p_org,p_id,lead.product_revision)),'[]'::jsonb)
  ) into detail from public.resources r where (r.organization_id,r.id)=(p_org,p_id);
  return detail || jsonb_build_object(
    'inquiries',coalesce((select jsonb_agg(jsonb_build_object('number',private.lead_number(l.display_number,l.ingested_at),
      'customer',l.prospect_name,'source',l.source_key,'external_reference',l.external_reference,
      'received_at',l.received_at,'description',l.description,'requirements',l.requirement_text,
      'products',coalesce((select jsonb_agg(to_jsonb(p)-array['organization_id','lead_id','revision'] order by line_no)
        from private.lead_products p where (p.organization_id,p.lead_id,p.revision)=(p_org,l.id,l.product_revision)),'[]'::jsonb)) order by l.received_at)
      from public.leads l where l.organization_id=p_org and l.id=any(related_ids) and l.id<>p_id),'[]'::jsonb),
    'timeline',coalesce((select jsonb_agg(to_jsonb(e) order by e.occurred_at desc) from (
      select * from (
        select event.kind,event.occurred_at,private.lead_member_name(p_org,event.actor_id) actor,event.details
        from private.lead_events event where event.organization_id=p_org and event.lead_id=any(related_ids)
        union all
        select 'Call',a.attempted_at,private.lead_member_name(p_org,a.actor_membership_id),jsonb_build_object('summary',a.outcome,'notes',a.notes)
        from public.lead_contact_attempts a where a.organization_id=p_org and a.lead_id=any(related_ids)
        union all
        select case a.action when 'lead.create' then 'Inquiry created' when 'lead.qualify' then 'Stage change'
          when 'lead.disqualify' then 'Stage change' when 'lead.convert' then 'Lead converted' else 'Staff handover' end,
          a.occurred_at,private.lead_member_name(p_org,a.actor_membership_id),case a.action
            when 'lead.qualify' then jsonb_build_object('stage','qualified') when 'lead.disqualify' then jsonb_build_object('stage','not_qualified')
            when 'lead.create' then jsonb_build_object('summary','Inquiry recorded')
            when 'lead.convert' then jsonb_build_object('summary','Qualified inquiry converted to an opportunity')
            else jsonb_build_object('summary','Ownership changed during staff handover',
              'previous_owner',private.lead_member_name(p_org,(a.redacted_details->>'previous_owner_id')::uuid),
              'new_owner',private.lead_member_name(p_org,(a.redacted_details->>'owner_id')::uuid)) end
        from private.audit_events a where a.organization_id=p_org and a.resource_id=any(related_ids)
          and a.action in ('lead.create','lead.qualify','lead.disqualify','lead.convert','resource.owner.transfer')
      ) events order by occurred_at desc limit 200
    ) e),'[]'::jsonb),
    'related',coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at desc) from (
      select f.id,f.kind,f.title,f.status,f.created_at,f.planned_at,
        case when f.kind='quotation' then f.details->>'number' when f.kind='financial_reference' then f.details->>'number' end reference
      from private.sales_field_records f join public.resources sr on (sr.organization_id,sr.id)=(f.organization_id,f.id)
      where f.organization_id=p_org and f.kind in ('task','visit','quotation','demo','financial_reference')
        and (f.parent_id=any(related_ids) or f.parent_id=any(linked_opportunities) or (
          f.kind='visit' and lead.account_id is not null and exists(
            select 1 from private.sales_field_records site where (site.organization_id,site.id)=(f.organization_id,f.parent_id)
              and site.kind='site' and site.parent_id=lead.account_id
              and private.sales_field_visible_parent(p_org,site.id,actor,array['site'])
          )
        ))
        and (f.kind<>'financial_reference' or f.details->>'type'='Order')
        and sr.archived_at is null and sr.owner_membership_id=actor and private.intake_actor_can(p_org,actor,f.kind || '.read')
      order by f.created_at desc limit 200
    ) f),'[]'::jsonb),
    'duplicates',coalesce((select jsonb_agg(to_jsonb(d)) from (
      select l.id,l.row_version version,private.lead_number(l.display_number,l.ingested_at) number,l.prospect_name customer,
        l.contact_person contact,l.city,l.source_key source,l.requirement_text requirements,l.mobile,l.email,
        case when (l.mobile in (lead.mobile,lead.alternate_mobile) or l.alternate_mobile in (lead.mobile,lead.alternate_mobile)) then 'Mobile number'
          when l.email is not null and l.email=lead.email then 'Email address' else 'Hospital and equipment requirement' end match
      from public.leads l where l.organization_id=p_org and l.id<>p_id and l.merged_into is null
        and private.lead_visible(p_org,actor,l.id)
        and ((l.mobile in (lead.mobile,lead.alternate_mobile) or l.alternate_mobile in (lead.mobile,lead.alternate_mobile))
          or l.email=lead.email or (lower(btrim(l.prospect_name))=lower(btrim(lead.prospect_name)) and (
            nullif(lower(btrim(l.requirement_text)),'')=nullif(lower(btrim(lead.requirement_text)),'')
            or exists(select 1 from private.lead_products a join private.lead_products b
              on b.organization_id=a.organization_id and lower(b.model)=lower(a.model)
              where a.organization_id=p_org and a.lead_id=p_id and a.revision=lead.product_revision
                and b.lead_id=l.id and b.revision=l.product_revision))))
      order by l.received_at desc limit 20
    ) d),'[]'::jsonb)
  );
end
$$;
revoke all on function private.read_lead_management(uuid,jsonb,uuid) from public, anon, authenticated;
grant execute on function private.read_lead_management(uuid,jsonb,uuid) to authenticated;
create function public.read_lead_management(p_org uuid,p_query jsonb default '{}'::jsonb,p_id uuid default null)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select private.read_lead_management(p_org,p_query,p_id)
$$;
revoke all on function public.read_lead_management(uuid,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.read_lead_management(uuid,jsonb,uuid) to authenticated;

create function private.lead_event(p_org uuid,p_id uuid,p_actor uuid,p_kind text,p_details jsonb) returns void
language sql security invoker set search_path=pg_catalog as $$
  insert into private.lead_events(organization_id,lead_id,actor_id,kind,details) values(p_org,p_id,p_actor,p_kind,p_details)
$$;
revoke all on function private.lead_event(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;

create function private.lead_apply_owner(p_org uuid,p_id uuid,p_actor uuid,p_owner uuid,p_reason text) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
declare previous uuid;
begin
  select owner_membership_id into previous from public.resources where (organization_id,id)=(p_org,p_id) for update;
  if previous is not distinct from p_owner then return; end if;
  if p_owner is not null and (not exists(select 1 from public.memberships where (organization_id,id)=(p_org,p_owner) and status='Active')
    or not private.intake_actor_can(p_org,p_owner,'lead.read')) then
    raise exception 'Choose an active salesperson with lead access' using errcode='22023';
  end if;
  update public.resources set owner_membership_id=p_owner where (organization_id,id)=(p_org,p_id);
  perform private.lead_event(p_org,p_id,p_actor,'Assignment',jsonb_build_object('reason',p_reason,'previous_owner',
    private.lead_member_name(p_org,previous),'new_owner',private.lead_member_name(p_org,p_owner)));
  insert into private.lead_notifications(organization_id,recipient_id,lead_id,message)
  select p_org,who,p_id,message from (values(p_owner,'A lead was allocated to you'),(previous,'A lead was reassigned from you')) v(who,message)
  where who is not null;
end
$$;
revoke all on function private.lead_apply_owner(uuid,uuid,uuid,uuid,text) from public, anon, authenticated;

create function private.lead_guard_opportunity() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
declare canonical uuid;
begin
  select coalesce(merged_into,id) into canonical from public.leads
    where (organization_id,id)=(new.organization_id,new.origin_lead_id) for update;
  if canonical<>new.origin_lead_id or exists(
    with recursive family(id) as (
      select canonical union select l.id from family f join public.leads l on l.organization_id=new.organization_id and l.merged_into=f.id
    ) select 1 from public.opportunities o where o.organization_id=new.organization_id and o.origin_lead_id in (select id from family)
  ) then
    raise sqlstate 'PT409' using message='An opportunity already exists for this inquiry group';
  end if;
  return new;
end
$$;
revoke all on function private.lead_guard_opportunity() from public, anon, authenticated;
create trigger lead_guard_opportunity before insert on public.opportunities
for each row execute function private.lead_guard_opportunity();

create function private.command_lead_management(p_org uuid,p_action text,p_key uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  actor uuid := private.staff_admin_actor(p_org,'lead.read');
  can_manage boolean;
  command text := 'leads.' || p_action;
  digest text;
  prior private.operation_receipts%rowtype;
  response jsonb;
  current_lead uuid := nullif(p_input->>'id','')::uuid;
  other_id uuid := nullif(p_input->>'other_id','')::uuid;
  owner_id uuid;
  selected_territory uuid;
  next_owner uuid;
  lead public.leads%rowtype;
  other public.leads%rowtype;
  option_row record;
  item jsonb;
  subject jsonb := coalesce(p_input->'fields','{}'::jsonb);
  products jsonb := coalesce(p_input->'products','[]'::jsonb);
  requested_stage text;
  requested_source text;
  legacy_source text;
  old_behavior text;
  stage_behavior text;
  legacy_lifecycle text;
  loss_code text;
  moment timestamptz;
  due timestamptz;
  reason text := nullif(btrim(p_input->>'reason'),'');
  text_value text;
  phone text;
  phone_alt text;
  email_value text;
  route text;
  config_kind text;
  config_code text;
  config_label text;
  config_behavior text;
  routing_mode text;
  duplicates integer;
  line_revision integer;
begin
  if actor is null then raise exception 'Lead access denied' using errcode='42501'; end if;
  if p_action is null or p_action not in ('create','edit','assign','stage','reopen','activity','merge','settings','read_notice','export')
    or p_key is null or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>120000
    or coalesce(length(reason),0)>1000 then raise exception 'Invalid lead request' using errcode='22023'; end if;
  can_manage := private.intake_actor_can(p_org,actor,'lead.manage');
  if (p_action='create' and not private.intake_actor_can(p_org,actor,'lead.create'))
    or (p_action in ('assign','merge') and not can_manage)
    or (p_action='settings' and not private.intake_actor_can(p_org,actor,'lead.settings'))
    or (p_action='export' and not private.intake_actor_can(p_org,actor,'lead.export'))
    or (p_action='reopen' and not private.intake_actor_can(p_org,actor,'lead.reopen'))
  then raise exception 'Lead action denied' using errcode='42501'; end if;
  perform 1 from public.memberships where (organization_id,id)=(p_org,actor) and status='Active' for share;
  if not found then raise exception 'Lead access denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':' || p_key::text,0));
  digest := encode(sha256(convert_to(p_input::text,'UTF8')),'hex');
  select * into prior from private.operation_receipts where (organization_id,actor_membership_id,operation_key)=(p_org,actor,p_key);
  if found then
    if prior.command_type<>command or prior.request_hash<>digest then raise sqlstate 'PT409' using message='Request key already used'; end if;
    if p_action<>'export' then return prior.response_snapshot; end if;
  end if;
  if p_action in ('assign','merge','edit','stage','reopen','activity','create','settings') then
    perform pg_advisory_xact_lock(hashtextextended('lead-workflow:' || p_org::text,0));
  end if;

  if p_action='settings' then
    config_kind:=p_input->>'kind';
    if config_kind='rules' then
      insert into private.lead_rules(organization_id,response_hours,inactive_days)
      values(p_org,(p_input->>'response_hours')::int,(p_input->>'inactive_days')::int)
      on conflict (organization_id) do update set response_hours=excluded.response_hours,inactive_days=excluded.inactive_days;
    elsif config_kind='territory_create' then
      config_label:=nullif(btrim(p_input->>'label'),'');
      if coalesce(length(config_label),0) not between 1 and 120 then
        raise exception 'Enter a territory name' using errcode='22023';
      end if;
      insert into private.territories(organization_id,name) values(p_org,config_label);
    elsif config_kind='territory' then
      selected_territory := (p_input->>'territory')::uuid;
      next_owner := nullif(p_input->>'member','')::uuid;
      if next_owner is not null and (not exists(select 1 from public.memberships m
        where (m.organization_id,m.id)=(p_org,next_owner) and m.status='Active')
        or not private.intake_actor_can(p_org,next_owner,'lead.read')) then
        raise exception 'Choose an active salesperson with lead access' using errcode='22023';
      end if;
      insert into private.lead_territory_routes values (p_org,selected_territory,next_owner)
      on conflict on constraint lead_territory_routes_pkey do update set member_id=excluded.member_id;
    elsif config_kind in ('source','stage','loss') then
      config_code:=p_input->>'code';
      config_label:=btrim(p_input->>'label');
      config_behavior:=p_input->>'behavior';
      select * into option_row from private.lead_catalog(p_org) where kind=config_kind and code=config_code;
      if config_kind='stage' and found and option_row.behavior is distinct from config_behavior and exists(
        select 1 from public.leads where organization_id=p_org and sales_stage=config_code
      ) then raise exception 'Add a new stage to change how existing leads are classified' using errcode='22023'; end if;
      if config_kind='stage' and config_code='new' and (config_behavior is distinct from 'new' or not (p_input->>'active')::boolean) then
        raise exception 'The default New Inquiry stage must remain available for imports' using errcode='22023';
      end if;
      if config_kind='stage' and (config_behavior is null or config_behavior not in ('new','active','qualified','hold','won','lost','closed')) then
        raise exception 'Select how the stage behaves' using errcode='22023';
      end if;
      insert into private.lead_options(organization_id,kind,code,label,sort_order,behavior,active)
      values(p_org,config_kind,config_code,config_label,(p_input->>'sort_order')::int,
        case when config_kind='stage' then config_behavior end,(p_input->>'active')::boolean)
      on conflict (organization_id,kind,code) do update set label=excluded.label,sort_order=excluded.sort_order,
        behavior=excluded.behavior,active=excluded.active;
    else raise exception 'Lead setting unavailable' using errcode='22023';
    end if;
    response := jsonb_build_object('saved',true);
  elsif p_action='read_notice' then
    update private.lead_notifications set read_at=coalesce(read_at,now())
      where organization_id=p_org and recipient_id=actor and id=current_lead;
    response:=jsonb_build_object('saved',found);
    current_lead:=null;
  elsif p_action='export' then
    if jsonb_typeof(p_input->'query') is distinct from 'object' or octet_length((p_input->'query')::text)>4000 then
      raise exception 'Invalid lead filters' using errcode='22023';
    end if;
    response:=private.lead_list(p_org,actor,p_input->'query',5000,greatest(0,least(100000,coalesce((p_input->>'offset')::int,0))));
    if prior.id is not null then return response; end if;
  elsif p_action='assign' then
    if jsonb_typeof(p_input->'rows') is distinct from 'array' or jsonb_array_length(p_input->'rows') not between 1 and 100 or reason is null then
      raise exception 'Select leads and enter an assignment reason' using errcode='22023';
    end if;
    for item in select value from jsonb_array_elements(p_input->'rows') order by value->>'id' loop
      current_lead:=(item->>'id')::uuid;
      select l.* into lead
      from public.leads l join public.resources r on (r.organization_id,r.id)=(l.organization_id,l.id)
      where (l.organization_id,l.id)=(p_org,current_lead) and l.merged_into is null and r.archived_at is null for update of l,r;
      if not found then raise sqlstate 'PT404' using message='Lead unavailable'; end if;
      select r.territory_id into selected_territory from public.resources r where (r.organization_id,r.id)=(p_org,current_lead);
      if lead.row_version is distinct from (item->>'version')::int then raise sqlstate 'PT409' using message='A selected lead changed. Refresh and try again'; end if;
      next_owner := nullif(p_input->>'member','')::uuid;
      if p_input->>'routing'='territory' then
        select t.member_id into next_owner from private.lead_territory_routes t join public.memberships m on (m.organization_id,m.id)=(t.organization_id,t.member_id) and m.status='Active'
          where (t.organization_id,t.territory_id)=(p_org,selected_territory);
        if next_owner is null then raise exception 'Configure an active territory owner for each selected lead' using errcode='22023'; end if;
      end if;
      perform private.lead_apply_owner(p_org,current_lead,actor,next_owner,reason);
      update public.leads set updated_by=actor,updated_at=now(),row_version=row_version+1 where (organization_id,id)=(p_org,current_lead);
      insert into private.audit_events(organization_id,actor_membership_id,resource_id,action,request_id)
        values(p_org,actor,current_lead,'lead.assignment',p_key);
    end loop;
    response:=jsonb_build_object('saved',true);
    current_lead:=null;
  else
    if p_action<>'create' then
      if p_action='merge' then
        perform 1 from public.leads where organization_id=p_org and id in (current_lead,other_id) order by id for update;
      end if;
      select l.* into lead
        from public.leads l join public.resources r on (r.organization_id,r.id)=(l.organization_id,l.id)
        where (l.organization_id,l.id)=(p_org,current_lead) and l.merged_into is null and r.archived_at is null for update of l,r;
      if not found then raise sqlstate 'PT404' using message='Lead unavailable'; end if;
      select r.owner_membership_id,r.territory_id into owner_id,selected_territory from public.resources r
        where (r.organization_id,r.id)=(p_org,current_lead);
      if not can_manage and (owner_id is distinct from actor or not private.intake_actor_can(p_org,actor,'lead.contact')) then raise sqlstate 'PT404' using message='Lead unavailable'; end if;
      if lead.row_version is distinct from (p_input->>'version')::int then raise sqlstate 'PT409' using message='Lead changed. Refresh and try again'; end if;
      select behavior into old_behavior from private.lead_catalog(p_org) where kind='stage' and code=lead.sales_stage;
    end if;

    if p_action='merge' then
      if other_id is null or other_id=current_lead or reason is null then raise exception 'Select a duplicate and enter a merge reason' using errcode='22023'; end if;
      select l.* into other from public.leads l join public.resources r on (r.organization_id,r.id)=(l.organization_id,l.id)
        where (l.organization_id,l.id)=(p_org,other_id) and l.merged_into is null and r.archived_at is null for update of l,r;
      if not found then raise sqlstate 'PT404' using message='Duplicate lead unavailable'; end if;
      if other.row_version is distinct from (p_input->>'other_version')::int then raise sqlstate 'PT409' using message='Duplicate lead changed'; end if;
      with recursive family(id) as (
        select unnest(array[current_lead,other_id]) union select l.id from family f join public.leads l
          on l.organization_id=p_org and l.merged_into=f.id
      )
      select count(*) into duplicates from public.opportunities where organization_id=p_org and origin_lead_id in(select id from family);
      if duplicates>1 then raise exception 'Both inquiries have opportunities. Resolve the commercial records before merging' using errcode='22023'; end if;
      update public.leads set merged_into=current_lead,updated_at=now(),updated_by=actor,row_version=row_version+1
        where (organization_id,id)=(p_org,other_id);
      update public.resources set archived_at=now() where (organization_id,id)=(p_org,other_id);
      perform private.lead_event(p_org,current_lead,actor,'Merge',jsonb_build_object('reason',reason,
        'inquiry',private.lead_number(other.display_number,other.ingested_at)));
    elsif p_action='activity' then
      text_value:=nullif(btrim(p_input->>'summary'),'');
      config_kind:=p_input->>'kind';
      if config_kind is null or config_kind not in ('Call','Meeting','Visit','Note','Quotation','Demonstration','Order','Follow-up')
        or text_value is null or length(text_value)>2000 then raise exception 'Select an activity and enter a summary' using errcode='22023'; end if;
      moment:=coalesce(nullif(p_input->>'occurred_at','')::timestamptz,now());
      if not isfinite(moment) or moment>now()+interval '2 minutes' then raise exception 'Enter a valid activity time' using errcode='22023'; end if;
      insert into private.lead_events(organization_id,lead_id,actor_id,kind,occurred_at,details)
      values(p_org,current_lead,actor,config_kind,moment,jsonb_build_object('summary',text_value));
      if config_kind in ('Call','Meeting','Visit') then
        update public.leads set first_attempt_at=least(first_attempt_at,moment) where (organization_id,id)=(p_org,current_lead);
      end if;
    else
      if p_action in ('create','edit') then
        if jsonb_typeof(subject) is distinct from 'object' or jsonb_typeof(products) is distinct from 'array'
          or jsonb_array_length(products)>100 then raise exception 'Invalid lead details or product rows' using errcode='22023'; end if;
        if exists(select 1 from jsonb_each(subject) field where jsonb_typeof(field.value) not in ('string','null')
          or length(field.value #>> '{}')>case when field.key in ('description','requirements') then 10000 else 500 end)
          then raise exception 'Shorten the lead details' using errcode='22023'; end if;
      end if;
      requested_stage:=coalesce(nullif(subject->>'stage',''),nullif(p_input->>'stage',''),lead.sales_stage,'new');
      select c.behavior into stage_behavior from private.lead_catalog(p_org) c where c.kind='stage' and c.code=requested_stage
        and (c.active or (p_action='edit' and requested_stage=lead.sales_stage));
      if stage_behavior is null then raise exception 'Choose an available lead stage' using errcode='22023'; end if;
      if p_action='reopen' then
        if old_behavior not in ('won','lost','closed')
          or stage_behavior in ('won','lost','closed') or reason is null then
          raise exception 'Choose an open stage and enter a reopening reason' using errcode='22023';
        end if;
      elsif p_action in ('stage','edit') and requested_stage<>lead.sales_stage
        and old_behavior in ('won','lost','closed') then
        raise exception 'Use Reopen lead to change a closed lead’s stage' using errcode='22023';
      end if;
      due:=case when p_action in ('create','edit') then nullif(subject->>'follow_up','')::timestamptz
        else coalesce(nullif(p_input->>'follow_up','')::timestamptz,lead.next_action_due_at) end;
      text_value:=case when p_action in ('create','edit') then nullif(btrim(subject->>'next_action'),'')
        else coalesce(nullif(btrim(p_input->>'next_action'),''),lead.next_action) end;
      if (due is not null and not isfinite(due)) or coalesce(length(text_value),0)>500 then raise exception 'Enter a valid next follow-up' using errcode='22023'; end if;
      if stage_behavior='qualified' and due is null and text_value is null then
        raise exception 'Qualified leads require a next action or follow-up date' using errcode='22023';
      end if;
      loss_code:=coalesce(nullif(subject->>'loss_reason',''),nullif(p_input->>'loss_reason',''),case when requested_stage=lead.sales_stage then lead.loss_reason end);
      if stage_behavior='lost' and not exists(select 1 from private.lead_catalog(p_org) where kind='loss' and code=loss_code
        and (active or loss_code=lead.loss_reason)) then raise exception 'Choose a reason for the lost lead' using errcode='22023'; end if;
      if stage_behavior<>'lost' then loss_code:=null; end if;
      legacy_lifecycle:=case
        when lead.lifecycle='Converted' then 'Converted'
        when stage_behavior in ('lost','closed') then 'Disqualified'
        when stage_behavior='qualified' then 'Qualified'
        when stage_behavior in ('active','hold','won') then 'Contacted'
        else 'New' end;
      if p_action in ('create','edit') then
        requested_source:=coalesce(nullif(subject->>'source',''),lead.source_key);
        if not exists(select 1 from private.lead_catalog(p_org) where kind='source' and code=requested_source
          and (active or (p_action='edit' and requested_source=lead.source_key))) then
          raise exception 'Choose an available inquiry source' using errcode='22023';
        end if;
        legacy_source:=case requested_source when 'indiamart' then 'IndiaMART' when 'website' then 'Website' when 'telephone' then 'Telephone'
          when 'whatsapp' then 'WhatsApp' when 'email' then 'Email' when 'customer_referral' then 'Referral'
          when 'exhibition' then 'Event' when 'csv' then 'CSV' else 'Other' end;
        phone:=nullif(regexp_replace(btrim(coalesce(subject->>'mobile','')),'[ .()-]','','g'),'');
        phone_alt:=nullif(regexp_replace(btrim(coalesce(subject->>'alternate_mobile','')),'[ .()-]','','g'),'');
        email_value:=nullif(lower(btrim(subject->>'email')),'');
        if (phone is not null and phone !~ '^[+]?[0-9]{7,15}$') or (phone_alt is not null and phone_alt !~ '^[+]?[0-9]{7,15}$')
          or (email_value is not null and (length(email_value)>254 or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'))
          then raise exception 'Review the mobile numbers and email address' using errcode='22023'; end if;
        route:=coalesce(phone,email_value,phone_alt);
        if route is null and nullif(btrim(subject->>'missing_contact_reason'),'') is null then
          raise exception 'Enter a contact route or explain why it is missing' using errcode='22023';
        end if;
        if nullif(btrim(subject->>'customer'),'') is null or length(btrim(subject->>'customer'))>200 then raise exception 'Enter a hospital or organization name' using errcode='22023'; end if;
        if nullif(subject->>'budget','') is not null and subject->>'budget' !~ '^(0|[1-9][0-9]{0,15})([.][0-9]{1,2})?$'
          or nullif(subject->>'value','') is not null and subject->>'value' !~ '^(0|[1-9][0-9]{0,15})([.][0-9]{1,2})?$'
          then raise exception 'Enter INR amounts with up to two decimal places' using errcode='22023'; end if;
        moment:=case when p_action='create' then coalesce(nullif(subject->>'received_at','')::timestamptz,now()) else lead.received_at end;
        if not isfinite(moment) or moment>now() then raise exception 'Inquiry receipt must be in the past' using errcode='22023'; end if;
        if p_action='create' or subject ? 'account' and nullif(subject->>'account','')::uuid is distinct from lead.account_id then
          if nullif(subject->>'account','') is not null and (
            not private.intake_actor_can(p_org,actor,'account.read') or not exists(
              select 1 from public.accounts a join public.resources r on (r.organization_id,r.id)=(a.organization_id,a.id)
              where a.organization_id=p_org and a.id=(subject->>'account')::uuid and r.owner_membership_id=actor and r.archived_at is null
          )) then raise sqlstate 'PT404' using message='Customer unavailable'; end if;
        end if;
        if p_action='create' or (subject ? 'territory' and nullif(subject->>'territory','')::uuid is distinct from selected_territory) then
          selected_territory:=nullif(subject->>'territory','')::uuid;
          if selected_territory is not null and (not exists(select 1 from private.territories t
            where (t.organization_id,t.id)=(p_org,selected_territory)) or (
            not can_manage and not exists(select 1 from private.territory_memberships tm
              where (tm.organization_id,tm.territory_id,tm.membership_id)=(p_org,selected_territory,actor))
          )) then raise sqlstate 'PT404' using message='Territory unavailable'; end if;
        end if;
        if p_action='create' then
          routing_mode:=coalesce(nullif(subject->>'routing',''),'self');
          if routing_mode not in ('self','territory','manual','unassigned') or (routing_mode in ('manual','unassigned') and not can_manage)
            then raise exception 'Assignment is unavailable' using errcode='42501'; end if;
          if routing_mode='territory' then
            select t.member_id into next_owner from private.lead_territory_routes t join public.memberships m on (m.organization_id,m.id)=(t.organization_id,t.member_id) and m.status='Active'
              where (t.organization_id,t.territory_id)=(p_org,selected_territory)
                and private.intake_actor_can(p_org,t.member_id,'lead.read');
            if next_owner is null and not can_manage then next_owner:=actor; end if;
          elsif routing_mode='manual' then next_owner:=nullif(subject->>'owner','')::uuid;
          elsif routing_mode='self' then next_owner:=actor;
          end if;
          insert into public.resources(organization_id,resource_type,territory_id) values(p_org,'lead',selected_territory) returning id into current_lead;
          insert into public.leads(id,organization_id,source,source_key,received_at,prospect_name,contact_route,missing_contact_reason,
            lifecycle,sales_stage,created_by)
          values(current_lead,p_org,legacy_source,requested_source,moment,btrim(subject->>'customer'),route,
            nullif(btrim(subject->>'missing_contact_reason'),''),legacy_lifecycle,requested_stage,actor);
          perform private.lead_event(p_org,current_lead,actor,'Inquiry created',jsonb_build_object('source',requested_source,'stage',requested_stage));
          perform private.lead_apply_owner(p_org,current_lead,actor,next_owner,case when routing_mode='territory' then 'Territory routing' else 'Initial allocation' end);
        elsif subject ? 'territory' then
          update public.resources set territory_id=selected_territory where (organization_id,id)=(p_org,current_lead);
        end if;
        update public.leads set source=legacy_source,source_key=requested_source,external_reference=nullif(btrim(subject->>'external_reference'),''),
          prospect_name=btrim(subject->>'customer'),customer_type=nullif(btrim(subject->>'customer_type'),''),
          contact_person=nullif(btrim(subject->>'contact'),''),
          designation=nullif(btrim(subject->>'designation'),''),mobile=phone,alternate_mobile=phone_alt,email=email_value,
          contact_route=route,missing_contact_reason=nullif(btrim(subject->>'missing_contact_reason'),''),
          city=nullif(btrim(subject->>'city'),''),state=nullif(btrim(subject->>'state'),''),country=nullif(btrim(subject->>'country'),''),
          priority=coalesce(nullif(subject->>'priority',''),'Unqualified'),probability=nullif(subject->>'probability','')::smallint,
          budget=nullif(subject->>'budget','')::numeric,expected_value=nullif(subject->>'value','')::numeric,
          expected_purchase_on=nullif(subject->>'purchase_on','')::date,description=nullif(btrim(subject->>'description'),''),
          requirement_text=nullif(btrim(subject->>'requirements'),''),competitor=nullif(btrim(subject->>'competitor'),''),
          account_id=case when subject ? 'account' then nullif(subject->>'account','')::uuid else account_id end
          where (organization_id,id)=(p_org,current_lead);
        if exists(select 1 from jsonb_array_elements(products) as entry(item)
          where jsonb_typeof(entry.item) is distinct from 'object'
            or nullif(entry.item->>'estimated_unit_price','') is not null
              and entry.item->>'estimated_unit_price' !~ '^(0|[1-9][0-9]{0,15})([.][0-9]{1,2})?$') then
          raise exception 'Enter unit prices in INR with up to two decimal places' using errcode='22023';
        end if;
        line_revision:=coalesce(lead.product_revision+1,1);
        insert into private.lead_products(organization_id,lead_id,line_no,revision,category,model,quantity,estimated_unit_price,requirements)
        select p_org,current_lead,n,line_revision,btrim(row_data->>'category'),btrim(row_data->>'model'),(row_data->>'quantity')::int,
          nullif(row_data->>'estimated_unit_price','')::numeric,nullif(btrim(row_data->>'requirements'),'')
        from jsonb_array_elements(products) with ordinality items(row_data,n);
        update public.leads set product_revision=line_revision where (organization_id,id)=(p_org,current_lead);
        if p_action='edit' then perform private.lead_event(p_org,current_lead,actor,'Lead updated',
          jsonb_build_object('product_count',jsonb_array_length(products))); end if;
      end if;
      update public.leads set sales_stage=requested_stage,lifecycle=legacy_lifecycle,loss_reason=loss_code,next_action=text_value,next_action_due_at=due,
        competitor=case when p_input ? 'competitor' then nullif(btrim(p_input->>'competitor'),'') else competitor end
        where (organization_id,id)=(p_org,current_lead);
      if p_action<>'create' and requested_stage<>lead.sales_stage then
        perform private.lead_event(p_org,current_lead,actor,case when p_action='reopen' then 'Reopened' else 'Stage change' end,
          jsonb_build_object('previous_stage',lead.sales_stage,'stage',requested_stage,'reason',reason,'loss_reason',loss_code));
      end if;
      if (due,text_value) is distinct from (lead.next_action_due_at,lead.next_action) then
        perform private.lead_event(p_org,current_lead,actor,'Follow-up scheduled',jsonb_build_object('summary',text_value,'due_at',due));
      end if;
    end if;
    update public.leads set updated_by=actor,updated_at=now(),row_version=row_version+case when p_action='create' then 0 else 1 end
      where (organization_id,id)=(p_org,current_lead)
      returning jsonb_build_object('id',id,'version',row_version,'number',private.lead_number(display_number,ingested_at)) into response;
  end if;
  if p_action<>'read_notice' then
    insert into private.audit_events(organization_id,actor_membership_id,resource_id,action,request_id,redacted_details)
      values(p_org,actor,current_lead,command,p_key,case when p_action='export' then jsonb_build_object('format',left(p_input->>'format',15),
        'row_count',jsonb_array_length(response->'rows')) else '{}'::jsonb end);
  end if;
  insert into private.operation_receipts(organization_id,actor_membership_id,operation_key,command_type,request_hash,response_snapshot)
    values(p_org,actor,p_key,command,digest,case when p_action='export' then '{}'::jsonb else response end);
  return response;
end
$$;
revoke all on function private.command_lead_management(uuid,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function private.command_lead_management(uuid,text,uuid,jsonb) to authenticated;
create function public.command_lead_management(p_org uuid,p_action text,p_key uuid,p_input jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select private.command_lead_management(p_org,p_action,p_key,p_input)
$$;
revoke all on function public.command_lead_management(uuid,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.command_lead_management(uuid,text,uuid,jsonb) to authenticated;
