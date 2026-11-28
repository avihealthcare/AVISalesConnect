alter table private.sales_field_records
  add column account_id uuid,
  add column plan_id uuid,
  add column automation_key text,
  add foreign key (organization_id,account_id) references public.accounts(organization_id,id),
  add foreign key (organization_id,plan_id) references private.sales_field_records(organization_id,id);
create unique index field_unique_plan_checkin on private.sales_field_records(organization_id,plan_id)
  where kind='visit' and plan_id is not null;
create unique index field_unique_automatic_task on private.sales_field_records(organization_id,automation_key)
  where automation_key is not null;
create index field_daily_records on private.sales_field_records(organization_id,kind,owner_id,planned_at);
create index field_customer_history on private.sales_field_records(organization_id,account_id,planned_at desc) where account_id is not null;

create table private.field_settings (
  organization_id uuid primary key references public.organizations(id),
  max_checkin_radius_meters integer not null default 500 check (max_checkin_radius_meters between 25 and 10000),
  automation jsonb not null default '{"assignment":true,"visit":true,"demo":true,"tender":true,"payment":true}',
  version int not null default 1
);
create table private.field_attendance_corrections (
  organization_id uuid not null,
  id uuid not null default gen_random_uuid(),
  member_id uuid not null,
  day date not null,
  requested_status text check(requested_status in ('Present','Absent','Leave','Holiday','Half Day','Work From Home','On Tour')),
  start_at timestamptz,
  end_at timestamptz,
  justification text not null check(length(btrim(justification)) between 3 and 1000),
  status text not null default 'Pending' check(status in ('Pending','Approved','Rejected')),
  reviewer_id uuid,
  review text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  primary key(organization_id,id),
  foreign key(organization_id,member_id) references public.memberships(organization_id,id),
  foreign key(organization_id,reviewer_id) references public.memberships(organization_id,id),
  check(start_at is null or end_at is null or end_at>start_at),
  check(requested_status is not null or start_at is not null or end_at is not null)
);
create unique index field_one_pending_correction on private.field_attendance_corrections(organization_id,member_id,day) where status='Pending';
create table private.field_visit_leads (
  organization_id uuid not null,
  visit_id uuid not null,
  lead_id uuid not null,
  primary key(organization_id,visit_id,lead_id),
  foreign key(organization_id,visit_id) references private.sales_field_records(organization_id,id),
  foreign key(organization_id,lead_id) references public.leads(organization_id,id)
);
create index field_lead_visits_lookup on private.field_visit_leads(organization_id,lead_id);
create table private.field_report_acknowledgements (
  organization_id uuid not null,
  member_id uuid not null,
  day date not null,
  reviewer_id uuid not null,
  feedback text not null check(length(feedback)<=1000),
  acknowledged_at timestamptz not null default now(),
  primary key(organization_id,member_id,day),
  foreign key(organization_id,member_id) references public.memberships(organization_id,id),
  foreign key(organization_id,reviewer_id) references public.memberships(organization_id,id),
  check(member_id<>reviewer_id)
);
alter table private.field_settings enable row level security;
alter table private.field_attendance_corrections enable row level security;
alter table private.field_visit_leads enable row level security;
alter table private.field_report_acknowledgements enable row level security;
revoke all on private.field_settings,private.field_attendance_corrections,private.field_visit_leads,private.field_report_acknowledgements from public,anon,authenticated;

create function private.field_actor(p_org uuid,p_permission text) returns uuid
language sql stable set search_path=pg_catalog as $$
  select private.staff_admin_actor(p_org,p_permission) where exists(
    select 1 from auth.sessions s where s.id=nullif(auth.jwt()->>'session_id','')::uuid and s.user_id=auth.uid()
      and (s.not_after is null or s.not_after>now()))
$$;

create function private.field_team(p_org uuid,p_actor uuid,p_member uuid) returns boolean
language sql stable set search_path=pg_catalog as $$
 select p_actor is not null and p_member is not null and (
    p_member=p_actor or private.workspace_is_admin(p_org,p_actor) or
    exists(select 1 from private.lead_team(p_org,p_actor) t where t.member_id=p_member))
$$;

create function private.field_radius(p_org uuid) returns integer
language sql stable set search_path=pg_catalog as $$
 select coalesce((select max_checkin_radius_meters from private.field_settings where organization_id=p_org),500)
$$;
create function private.field_enabled(p_org uuid,p_trigger text) returns boolean
language sql stable set search_path=pg_catalog as $$
 select coalesce((select (automation->>p_trigger)::boolean from private.field_settings where organization_id=p_org),true)
$$;

create function private.field_evidence(p_org uuid,p_site uuid,p_body jsonb,p_visit boolean) returns jsonb
language plpgsql stable set search_path=pg_catalog as $$
declare
  point jsonb:=p_body->'gps';
  reason text:=nullif(btrim(p_body->>'exception'),'');
  captured timestamptz;
  site jsonb;
  distance double precision;
  accuracy numeric;
  radius integer:=private.field_radius(p_org);
  verdict text;
begin
  if reason is not null and length(reason) not between 3 and 500 then
    raise exception 'Enter a location exception reason of 3 to 500 characters' using errcode='22023';
  end if;
  if point is not null and point<>'null'::jsonb then
    if jsonb_typeof(point) is distinct from 'object' or jsonb_typeof(point->'lat') is distinct from 'number'
      or jsonb_typeof(point->'lon') is distinct from 'number' or jsonb_typeof(point->'accuracy') is distinct from 'number'
      or (point->>'lat')::numeric not between -90 and 90 or (point->>'lon')::numeric not between -180 and 180
      or (point->>'accuracy')::numeric not between 0.01 and 100000 then
      raise exception 'Invalid location reading' using errcode='22023';
    end if;
    captured:=nullif(point->>'captured_at','')::timestamptz;
    accuracy:=(point->>'accuracy')::numeric;
    select f.details into site from private.sales_field_records f where (f.organization_id,f.id)=(p_org,p_site) and f.kind='site';
    if nullif(site->>'latitude','') is not null and nullif(site->>'longitude','') is not null then
      distance:=12742000 * asin(least(1,sqrt(power(sin(radians(((point->>'lat')::float8-(site->>'latitude')::float8)/2)),2)
        +cos(radians((site->>'latitude')::float8))*cos(radians((point->>'lat')::float8))
          *power(sin(radians(((point->>'lon')::float8-(site->>'longitude')::float8)/2)),2))));
    end if;
  end if;
  verdict:=case when accuracy is null then 'GPS unavailable'
    when captured is null or not isfinite(captured) or captured not between now()-interval '3 minutes' and now()+interval '15 seconds' then 'Stale GPS'
    when accuracy>100 then 'Poor GPS accuracy'
    when p_visit and distance is null then 'Site coordinates unavailable'
    when p_visit and distance>radius then 'Outside check-in radius'
    when p_visit then 'Verified On-Site' else 'GPS captured' end;
  if verdict not in ('Verified On-Site','GPS captured') and reason is null then
    raise exception '% — enter a location exception reason',verdict using errcode='22023';
  end if;
  return jsonb_build_object('verdict',case when reason is not null then 'Location Exception' else verdict end,
    'condition',verdict,'accuracy_meters',accuracy,'distance_meters',round(distance::numeric,1),'radius_meters',radius,
    'permission',case when accuracy is not null then 'granted' when p_body->>'permission' in ('denied','unavailable','skipped') then p_body->>'permission' else 'unavailable' end,
    'received_at',now(),'captured_at',captured,'exception',reason,'raw',case when accuracy is not null then point end);
end
$$;

create function private.field_insert(p_org uuid,p_actor uuid,p_kind text,p_owner uuid,p_parent uuid,p_account uuid,p_plan uuid,
  p_title text,p_status text,p_start timestamptz,p_end timestamptz,p_details jsonb,p_auto text default null) returns uuid
language plpgsql set search_path=pg_catalog as $$
declare target uuid;
begin
  if p_auto is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_org::text||':field-task:'||p_auto,0));
    select id into target from private.sales_field_records where organization_id=p_org and automation_key=p_auto;
    if found then return target; end if;
  end if;
  insert into public.resources(organization_id,resource_type,owner_membership_id)
    values(p_org,p_kind,p_owner) returning id into target;
  insert into private.sales_field_records(organization_id,id,kind,owner_id,parent_id,account_id,plan_id,title,status,planned_at,ended_at,details,automation_key)
    values(p_org,target,p_kind,p_owner,p_parent,p_account,p_plan,p_title,p_status,p_start,p_end,p_details,p_auto);
  insert into private.sales_field_events(organization_id,record_id,version,actor_id,event_type,details)
    values(p_org,target,1,p_actor,'create',case when p_kind in ('visit','attendance_session') then private.field_public_details(p_details) else p_details end);
  return target;
end
$$;

create function private.field_task_auto(p_org uuid,p_owner uuid,p_source uuid,p_channel text,p_due timestamptz,p_title text,p_type text,p_account uuid default null)
returns void language plpgsql set search_path=pg_catalog as $$
declare fingerprint text;
begin
  if p_owner is null or p_due is null or not isfinite(p_due) or not private.field_enabled(p_org,p_channel) or not exists(
    select 1 from public.memberships where (organization_id,id)=(p_org,p_owner) and status='Active') then return; end if;
  fingerprint:='auto:'||p_channel||':'||p_source::text||':'||p_owner::text||':'||extract(epoch from p_due)::text;
  perform private.field_insert(p_org,p_owner,'task',p_owner,p_source,p_account,null,left(p_title,200),'Pending',p_due,null,
    jsonb_build_object('task_type',p_type,'priority','Medium','automation',p_channel),fingerprint);
end
$$;

create function private.field_lead_task_trigger() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare owner uuid; parent_account uuid; occurred timestamptz;
begin
  if tg_table_name='leads' then
    select owner_membership_id into owner from public.resources where (organization_id,id)=(new.organization_id,new.id);
    occurred:=coalesce(new.ingested_at,now());
    parent_account:=new.account_id;
  else
    if new.owner_membership_id is not distinct from old.owner_membership_id then return new; end if;
    select l.account_id into parent_account from public.leads l where (l.organization_id,l.id)=(new.organization_id,new.id);
    if not found then return new; end if;
    owner:=new.owner_membership_id;
    occurred:=now();
  end if;
  perform private.field_task_auto(new.organization_id,owner,new.id,'assignment',occurred+interval '24 hours',
    'Contact the newly assigned lead','Customer Call',parent_account);
  return new;
end
$$;
create trigger field_lead_insert_task after insert on public.leads for each row execute function private.field_lead_task_trigger();
create trigger field_lead_allocation_task after update of owner_membership_id on public.resources
  for each row when(new.resource_type='lead') execute function private.field_lead_task_trigger();

create function private.field_milestone_task_trigger() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare due timestamptz; owner uuid; parent_account uuid;
begin
  if tg_table_name='tenders' then
    if tg_op='UPDATE' and old.deadline is not distinct from new.deadline then return new; end if;
    select owner_membership_id into owner from public.resources where (organization_id,id)=(new.organization_id,new.id);
    perform private.field_task_auto(new.organization_id,owner,new.id,'tender',new.deadline-interval '1 day','Prepare tender submission','Tender Submission');
  elsif new.kind='demo' and nullif(new.details->>'return_on','') is not null then
    due:=((new.details->>'return_on')::date-2+time '09:00') at time zone 'Asia/Kolkata';
    perform private.field_task_auto(new.organization_id,new.owner_id,new.id,'demo',due,'Collect or review demonstration equipment','Product Demonstration',new.account_id);
  elsif new.kind='financial_reference' and new.details->>'type' in ('Invoice','Order') and nullif(new.details->>'due_on','') is not null then
    due:=((new.details->>'due_on')::date-1+time '09:00') at time zone 'Asia/Kolkata';
    select o.account_id into parent_account from public.opportunities o where (o.organization_id,o.id)=(new.organization_id,new.parent_id);
    perform private.field_task_auto(new.organization_id,new.owner_id,new.id,'payment',due,'Follow up on payment milestone','Payment Follow-up',parent_account);
  end if;
  return new;
end
$$;
create trigger field_tender_deadline_task after insert or update of deadline on private.tenders
  for each row execute function private.field_milestone_task_trigger();
create trigger field_sales_milestone_task after insert or update of details on private.sales_field_records
  for each row when(new.kind in ('demo','financial_reference')) execute function private.field_milestone_task_trigger();

create function private.field_link_allowed(p_org uuid,p_actor uuid,p_parent uuid) returns boolean
language sql stable set search_path=pg_catalog as $$
  select exists(select 1 from public.resources r where (r.organization_id,r.id)=(p_org,p_parent) and r.archived_at is null
    and case r.resource_type when 'account' then private.customer_visible(p_org,p_actor,p_parent)
      when 'lead' then private.intake_actor_can(p_org,p_actor,'lead.read') and private.lead_visible(p_org,p_actor,p_parent)
      when 'tender' then private.tender_actor(p_org)=p_actor and private.tender_can_view(p_org,p_parent,p_actor)
      else r.resource_type in ('opportunity','visit','demo','quotation','financial_reference')
        and private.intake_actor_can(p_org,p_actor,r.resource_type||'.read')
        and (r.owner_membership_id=p_actor or private.field_team(p_org,p_actor,r.owner_membership_id)) end)
$$;

create function private.field_reference_data(p_org uuid,p_mode text,p_account uuid,p_search text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=private.field_actor(p_org,p_mode||'.read');
begin
  if actor is null or p_mode not in ('visit','visit_plan','task') then raise exception 'Field access denied' using errcode='42501'; end if;
  if p_account is not null and not private.customer_visible(p_org,actor,p_account) then
    raise sqlstate 'PT404' using message='Customer unavailable';
  end if;
  return jsonb_build_object(
    'accounts',coalesce((select jsonb_agg(to_jsonb(a) order by a.name) from (
      select a.id,a.name,m.details->>'city' city from public.accounts a left join private.customer_master m
        on (m.organization_id,m.account_id)=(a.organization_id,a.id)
      where a.organization_id=p_org and private.customer_visible(p_org,actor,a.id)
        and (coalesce(p_search,'')='' or strpos(lower(concat_ws(' ',a.name,m.details->>'city',m.details->>'state')),lower(left(p_search,120)))>0
          or a.id=p_account)
      order by (a.id=p_account) desc nulls last,a.name,a.id limit 75) a),'[]'::jsonb),
    'sites',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.title,'lat',nullif(f.details->>'latitude','')::numeric,
      'lon',nullif(f.details->>'longitude','')::numeric) order by (f.details->>'is_primary'='true') desc nulls last,f.title)
      from private.sales_field_records f join public.resources r using(organization_id,id)
      where (f.organization_id,f.parent_id)=(p_org,p_account) and f.kind='site' and r.archived_at is null
        and private.intake_actor_can(p_org,actor,'site.read')),'[]'::jsonb),
    'contacts',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.title) order by f.title) from private.sales_field_records f
      where f.organization_id=p_org and p_account is not null and f.kind='contact' and private.contact_visible(p_org,actor,f.id)
        and (f.parent_id=p_account or exists(select 1 from private.contact_affiliations a
          where (a.organization_id,a.contact_id,a.account_id)=(p_org,f.id,p_account) and a.active))),'[]'::jsonb),
    'leads',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'name',private.lead_number(l.display_number,l.ingested_at)||' · '||l.prospect_name) order by l.received_at desc)
      from public.leads l where l.organization_id=p_org and l.merged_into is null and l.lifecycle not in ('Disqualified','Converted')
        and l.sales_stage not in ('won','lost','not_qualified') and (p_account is null and p_mode='task' or l.account_id=p_account)
        and private.intake_actor_can(p_org,actor,'lead.read') and private.lead_visible(p_org,actor,l.id)),'[]'::jsonb),
    'products',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.title) order by f.title) from (
      select f.id,f.title from private.sales_field_records f join public.resources r using(organization_id,id)
      where f.organization_id=p_org and f.kind='product' and r.archived_at is null
        and private.intake_actor_can(p_org,actor,'product.read') order by f.title,f.id limit 250) f),'[]'::jsonb),
    'commercial',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.title,'kind',f.kind) order by f.title,f.id)
      from private.sales_field_records f join public.opportunities o on (o.organization_id,o.id)=(f.organization_id,f.parent_id)
      where (o.organization_id,o.account_id)=(p_org,p_account) and p_mode='visit'
        and (f.kind='quotation' or f.kind='financial_reference' and f.details->>'type'='Order')
        and private.field_link_allowed(p_org,actor,f.id)),'[]'::jsonb),
    'related',coalesce((select jsonb_agg(to_jsonb(item) order by item.kind,item.name) from (
      select r.id,r.resource_type kind,coalesce(f.title,a.name,t.reference,l.prospect_name,'Opportunity '||left(r.id::text,8)) name
      from public.resources r left join private.sales_field_records f using(organization_id,id)
      left join public.accounts a using(organization_id,id) left join public.leads l using(organization_id,id)
      left join private.tenders t using(organization_id,id)
      where r.organization_id=p_org and p_mode='task' and private.field_link_allowed(p_org,actor,r.id)
      order by 2,3,r.id limit 250) item),'[]'::jsonb)
  );
end
$$;

create function private.field_command(p_org uuid,p_kind text,p_action text,p_key uuid,p_body jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  actor uuid:=private.field_actor(p_org,p_kind||'.read');
  target uuid:=nullif(p_body->>'id','')::uuid;
  account uuid:=nullif(p_body->>'account','')::uuid;
  site uuid:=nullif(p_body->>'site','')::uuid;
  plan uuid:=nullif(p_body->>'plan','')::uuid;
  related uuid:=nullif(p_body->>'related','')::uuid;
  owner uuid;
  record_row private.sales_field_records%rowtype;
  day_row private.field_attendance_corrections%rowtype;
  receipt private.operation_receipts%rowtype;
  digest text;
  command_name text:='field.'||p_kind||'.'||p_action;
  info jsonb;
  response jsonb;
  evidence jsonb;
  title text:=nullif(btrim(p_body->>'title'),'');
  reason text:=nullif(btrim(p_body->>'reason'),'');
  selected_day date;
  start_time timestamptz:=nullif(p_body->>'starts_at','')::timestamptz;
  end_time timestamptz:=nullif(p_body->>'ends_at','')::timestamptz;
  follow_time timestamptz:=nullif(p_body->>'follow_up','')::timestamptz;
  result_status text;
  start_verdict text;
  ids jsonb;
  item uuid;
  products jsonb:='[]'::jsonb;
  contact_person private.sales_field_records%rowtype;
  lead_result jsonb;
  day_today date:=(now() at time zone 'Asia/Kolkata')::date;
begin
  if p_kind is null or p_kind not in ('attendance_session','visit_plan','visit','task','settings') then raise exception 'Invalid field module' using errcode='22023'; end if;
  if p_kind='settings' then actor:=private.field_actor(p_org,'staff.directory.read'); end if;
  if actor is null then raise exception 'Field access denied' using errcode='42501'; end if;
  if p_key is null or p_action is null or jsonb_typeof(p_body) is distinct from 'object' or octet_length(p_body::text)>16000 then
    raise exception 'Review the field request' using errcode='22023';
  end if;
  if p_kind<>'settings' and p_action not in ('review','acknowledge') and
    not private.intake_actor_can(p_org,actor,p_kind||case when p_action in ('start','create','correction') then '.create' else '.update' end)
    then raise exception 'Field action denied' using errcode='42501'; end if;
  perform 1 from public.memberships where (organization_id,id)=(p_org,actor) and status='Active' for share;
  if not found then raise exception 'Field access denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_key::text,0));
  digest:=encode(sha256(convert_to(p_body::text,'UTF8')),'hex');
  select * into receipt from private.operation_receipts where (organization_id,actor_membership_id,operation_key)=(p_org,actor,p_key);
  if found then
    if receipt.command_type<>command_name or receipt.request_hash<>digest then raise sqlstate 'PT409' using message='Request key already used'; end if;
    return receipt.response_snapshot;
  end if;

  if p_kind='settings' and p_action='save' then
    if not private.workspace_is_admin(p_org,actor) then raise exception 'Administrator required' using errcode='42501'; end if;
    if (p_body->>'radius')::int not between 25 and 10000 or jsonb_typeof(p_body->'automation') is distinct from 'object'
      or (select count(*) from jsonb_each(p_body->'automation'))<>5 or exists(select 1 from jsonb_each(p_body->'automation') j
       where j.key not in ('assignment','visit','demo','tender','payment') or jsonb_typeof(j.value)<>'boolean') then
      raise exception 'Enter a radius of 25 to 10,000 metres and valid automation switches' using errcode='22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('field-settings:'||p_org::text,0));
    if coalesce((select version from private.field_settings where organization_id=p_org),0) is distinct from (p_body->>'version')::int then
      raise sqlstate 'PT409' using message='Field settings changed. Reload and try again';
    end if;
    insert into private.field_settings values(p_org,(p_body->>'radius')::int,p_body->'automation',1)
      on conflict(organization_id) do update set max_checkin_radius_meters=excluded.max_checkin_radius_meters,automation=excluded.automation,
        version=private.field_settings.version+1;
  elsif p_kind='attendance_session' and p_action='correction' then
    selected_day:=(p_body->>'day')::date;
    if selected_day is null or selected_day>day_today or selected_day<day_today-366 or reason is null
      or (nullif(p_body->>'status','') is null and start_time is null and end_time is null)
      or (start_time is not null and (start_time at time zone 'Asia/Kolkata')::date<>selected_day)
      or coalesce(end_time,now())>now() or coalesce(start_time,now())>now()
      or (end_time is not null and (end_time at time zone 'Asia/Kolkata')::date not between selected_day and selected_day+1) then
      raise exception 'Choose a past or current date, valid punch times, and a justification' using errcode='22023';
    end if;
    insert into private.field_attendance_corrections(organization_id,member_id,day,requested_status,start_at,end_at,justification)
      values(p_org,actor,selected_day,nullif(p_body->>'status',''),start_time,end_time,reason) returning id into target;
  elsif p_kind='attendance_session' and p_action='review' then
    select * into day_row from private.field_attendance_corrections where (organization_id,id)=(p_org,target) for update;
    if not found or day_row.member_id=actor or not private.field_team(p_org,actor,day_row.member_id) then
      raise exception 'Correction review denied' using errcode='42501'; end if;
    if day_row.status<>'Pending' or reason is null or length(reason) not between 3 and 1000
      or coalesce(p_body->>'status','') not in ('Approved','Rejected') then
      raise exception 'Select a pending correction and enter review comments' using errcode='22023'; end if;
    if p_body->>'status'='Approved' and (day_row.start_at is not null or day_row.end_at is not null) then
      select coalesce(day_row.start_at,(select c.start_at from private.field_attendance_corrections c
        where (c.organization_id,c.member_id,c.day)=(p_org,day_row.member_id,day_row.day) and c.status='Approved'
        and c.start_at is not null order by c.decided_at desc limit 1),p.planned_at),
        coalesce(day_row.end_at,(select c.end_at from private.field_attendance_corrections c
        where (c.organization_id,c.member_id,c.day)=(p_org,day_row.member_id,day_row.day) and c.status='Approved'
        and c.end_at is not null order by c.decided_at desc limit 1),p.ended_at)
        into start_time,end_time from (select 1) base left join lateral (
          select f.planned_at,f.ended_at from private.sales_field_records f where (f.organization_id,f.owner_id)=(p_org,day_row.member_id)
            and f.kind='attendance_session' and (f.planned_at at time zone 'Asia/Kolkata')::date=day_row.day
            order by f.planned_at limit 1) p on true;
      if end_time<=start_time then raise exception 'Corrected punch-out must follow punch-in' using errcode='22023'; end if;
    end if;
    update private.field_attendance_corrections set status=p_body->>'status',reviewer_id=actor,review=reason,decided_at=now()
      where (organization_id,id)=(p_org,target);
  elsif p_kind='visit' and p_action='acknowledge' then
    owner:=(p_body->>'owner')::uuid;
    selected_day:=(p_body->>'day')::date;
    if owner=actor or not private.field_team(p_org,actor,owner) or selected_day is null or selected_day>day_today then
      raise exception 'Report review denied' using errcode='42501'; end if;
    insert into private.field_report_acknowledgements(organization_id,member_id,day,reviewer_id,feedback)
      values(p_org,owner,selected_day,actor,coalesce(reason,''));
  elsif p_kind='visit' and p_action='verify_customer' then
    select r.owner_membership_id into owner from public.resources r join private.customer_master a
      on (a.organization_id,a.account_id)=(r.organization_id,r.id)
      where (r.organization_id,r.id)=(p_org,target) and r.archived_at is null and a.details->>'is_provisional'='true';
    if not found or not private.customer_visible(p_org,actor,target) or
      (not private.workspace_is_admin(p_org,actor) and (owner=actor or not private.field_team(p_org,actor,owner))) then
      raise exception 'Customer verification requires a manager or administrator' using errcode='42501';
    end if;
    update public.accounts set master_version=master_version+1 where (organization_id,id)=(p_org,target);
    update private.customer_master set details=details||jsonb_build_object('is_provisional','false')
      where (organization_id,account_id)=(p_org,target) and details->>'is_provisional'='true';
    if not found then raise sqlstate 'PT409' using message='Customer verification already changed'; end if;
  elsif p_action in ('create','start') then
    owner:=coalesce(nullif(p_body->>'owner','')::uuid,actor);
    if (p_kind<>'task' and owner<>actor) or not private.field_team(p_org,actor,owner) or not exists(
      select 1 from public.memberships where (organization_id,id)=(p_org,owner) and status='Active') then
      raise exception 'Choose an active team member' using errcode='42501'; end if;
    if p_kind in ('attendance_session','visit') then
      perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||actor::text||':'||p_kind,0));
      if exists(select 1 from private.sales_field_records f where f.organization_id=p_org and f.kind=p_kind and f.owner_id=actor
          and (f.status='Open' or p_kind='attendance_session' and (f.planned_at at time zone 'Asia/Kolkata')::date=day_today))
      then raise sqlstate 'PT409' using message='A session already exists. Refresh the workspace'; end if;
    end if;
    if plan is not null then
      select f.* into record_row from private.sales_field_records f join public.resources r using(organization_id,id)
        where (f.organization_id,f.id,f.owner_id)=(p_org,plan,actor) and f.kind='visit_plan' and r.archived_at is null
          and (f.planned_at at time zone 'Asia/Kolkata')::date=day_today and f.status='Planned'
          and private.intake_actor_can(p_org,actor,'visit_plan.read') for update of f;
      if p_kind<>'visit' or not found then raise sqlstate 'PT404' using message='Today’s visit plan is unavailable'; end if;
      site:=record_row.parent_id;
      account:=record_row.account_id;
      if account is null then select parent_id into account from private.sales_field_records where (organization_id,id)=(p_org,site); end if;
      title:=record_row.title;
    end if;
    if account is not null and not private.customer_visible(p_org,actor,account) then
      raise exception 'Customer unavailable' using errcode='42501'; end if;
    if site is not null and not exists(select 1 from private.sales_field_records s join public.resources r using(organization_id,id)
      where (s.organization_id,s.id,s.parent_id)=(p_org,site,account) and s.kind='site' and r.archived_at is null
        and private.intake_actor_can(p_org,actor,'site.read')) then raise exception 'Choose a site for this customer' using errcode='22023'; end if;

    if p_kind='attendance_session' and p_action='start' then
      if coalesce(p_body->>'work_mode','') not in ('Field Work','Work From Home','On Tour','Office') then
        raise exception 'Choose a work mode' using errcode='22023'; end if;
      evidence:=private.field_evidence(p_org,null,p_body,false);
      target:=private.field_insert(p_org,actor,p_kind,actor,null,null,null,'Working day','Open',now(),null,
        jsonb_build_object('work_mode',p_body->>'work_mode','start_evidence',evidence));
    elsif p_kind in ('visit','visit_plan') then
      if p_kind='visit' and p_action='start' and account is null and title is not null and p_body->>'provisional'='true' then
        insert into public.resources(organization_id,resource_type,owner_membership_id) values(p_org,'account',actor) returning id into account;
        insert into public.accounts(id,organization_id,name,account_type) values(account,p_org,title,'Other');
        insert into private.customer_master(organization_id,account_id,category,normalized_name,details)
          values(p_org,account,'Other',lower(regexp_replace(title,'[[:space:]]+',' ','g')),
            jsonb_build_object('status','Prospect','lifecycle','Prospect','is_provisional','true'));
        insert into private.audit_events(organization_id,actor_membership_id,resource_id,action,request_id)
          values(p_org,actor,account,'customer.provisional',p_key);
        title:=left('Visit · '||title,200);
      end if;
      if plan is null and (coalesce(p_body->>'purpose','') not in ('New Customer Introduction','Lead Follow-up','Product Demonstration',
        'Quotation Follow-up','Negotiation','Payment Collection','Distributor Meeting','Tender Follow-up','Relationship Development',
        'Installation Coordination','Service Coordination','Other') or coalesce(p_body->>'priority','Medium') not in ('High','Medium','Low')) then
        raise exception 'Choose a visit purpose and priority' using errcode='22023';
      end if;
      if account is null or title is null then raise exception 'Choose a customer and visit purpose' using errcode='22023'; end if;
      info:=case when plan is not null then record_row.details else jsonb_build_object('purpose',p_body->>'purpose',
        'notes',p_body->>'notes','priority',coalesce(p_body->>'priority','Medium')) end;
      if nullif(p_body->>'contact','') is not null then
        item:=(p_body->>'contact')::uuid;
        if not private.contact_visible(p_org,actor,item) or not exists(select 1 from private.sales_field_records c
          where (c.organization_id,c.id)=(p_org,item) and (c.parent_id=account or exists(select 1 from private.contact_affiliations a
            where (a.organization_id,a.contact_id,a.account_id)=(p_org,item,account) and a.active))) then
          raise exception 'Choose a contact for this customer' using errcode='22023'; end if;
        info:=info||jsonb_build_object('contact',item);
      end if;
      related:=coalesce(related,nullif(info->>'lead','')::uuid);
      if related is not null and (not private.field_link_allowed(p_org,actor,related) or not exists(
        select 1 from public.leads l where (l.organization_id,l.id,l.account_id)=(p_org,related,account)
          and (p_kind<>'visit_plan' or l.sales_stage not in ('won','lost','not_qualified')))) then
        raise exception 'Choose a lead for this customer' using errcode='22023'; end if;
      info:=info||jsonb_build_object('lead',related);
      if p_kind='visit_plan' and p_action='create' then
        if start_time is null or end_time is null or not isfinite(start_time) or not isfinite(end_time) or end_time<=start_time then
          raise exception 'Enter a valid date and schedule' using errcode='22023'; end if;
        target:=private.field_insert(p_org,actor,p_kind,actor,site,account,null,title,'Planned',start_time,end_time,info);
      elsif p_kind='visit' and p_action='start' then
        evidence:=private.field_evidence(p_org,site,p_body,true);
        target:=private.field_insert(p_org,actor,p_kind,actor,site,account,plan,left(title,200),'Open',now(),null,
          info||jsonb_build_object('start_evidence',evidence));
        if related is not null then insert into private.field_visit_leads values(p_org,target,related); end if;
        if plan is not null then
          update private.sales_field_records set status='Checked In',version=version+1 where (organization_id,id)=(p_org,plan);
          insert into private.sales_field_events(organization_id,record_id,version,actor_id,event_type,details)
            values(p_org,plan,record_row.version+1,actor,'check_in',jsonb_build_object('visit',target));
        end if;
      else raise exception 'Invalid visit action' using errcode='22023'; end if;
    elsif p_kind='task' and p_action='create' then
      if title is null or start_time is null or not isfinite(start_time) or (related is not null and not private.field_link_allowed(p_org,actor,related))
        or coalesce(p_body->>'task_type','') not in ('Customer Call','Hospital Visit','Send Quotation','Send Brochure','Product Demonstration',
          'Payment Follow-up','Tender Submission','Distributor Follow-up','Internal Approval','Other')
        or coalesce(p_body->>'priority','') not in ('High','Medium','Low') then raise exception 'Review the task fields and linked record' using errcode='22023'; end if;
      target:=private.field_insert(p_org,actor,p_kind,owner,related,account,null,title,'Pending',start_time,null,
        jsonb_build_object('task_type',p_body->>'task_type','priority',p_body->>'priority','description',p_body->>'notes','created_by',actor));
    else raise exception 'Invalid field action' using errcode='22023'; end if;
  else
    select f.* into record_row from private.sales_field_records f join public.resources r using(organization_id,id)
      where (f.organization_id,f.id,f.kind)=(p_org,target,p_kind) and r.archived_at is null for update of f;
    if not found or (record_row.owner_id<>actor and ((p_kind<>'task' and p_action<>'review_location')
      or not private.field_team(p_org,actor,record_row.owner_id))) then
      raise sqlstate 'PT404' using message='Field record unavailable'; end if;
    if record_row.version is distinct from (p_body->>'version')::int then raise sqlstate 'PT409' using message='Record changed. Reload and try again'; end if;
    info:='{}'::jsonb;
    if p_action='review_location' and p_kind in ('attendance_session','visit') and record_row.status='Pending Review' then
      if record_row.owner_id=actor then raise exception 'Location review requires an independent manager' using errcode='42501'; end if;
      if reason is null or length(reason) not between 3 and 1000 or coalesce(p_body->>'status','') not in ('Approved','Rejected') then
        raise exception 'Select a decision and enter review comments' using errcode='22023';
      end if;
      info:=jsonb_build_object('decision',p_body->>'status','reviewer',private.lead_member_name(p_org,actor),'reason',reason,'at',now());
      update private.sales_field_records set status=case when p_body->>'status'='Approved' then 'Completed' else 'Rejected' end,
        version=version+1,details=details||jsonb_build_object('location_review',info)
        where (organization_id,id)=(p_org,target) returning version into record_row.version;
    elsif p_action='finish' and p_kind in ('attendance_session','visit') and record_row.status='Open' then
      evidence:=private.field_evidence(p_org,record_row.parent_id,p_body,p_kind='visit');
      if now()<=record_row.planned_at then raise exception 'The end must follow the start' using errcode='22023'; end if;
      info:=jsonb_build_object('end_evidence',evidence,
        'overnight',(now() at time zone 'Asia/Kolkata')::date>(record_row.planned_at at time zone 'Asia/Kolkata')::date);
      if p_kind='visit' then info:=info||jsonb_build_object('duration_minutes',round(extract(epoch from now()-record_row.planned_at)/60,2)); end if;
      start_verdict:=private.field_public_details(record_row.details)#>>'{start_evidence,verdict}';
      result_status:=case when start_verdict in ('Verified On-Site','GPS captured') and evidence->>'verdict'<>'Location Exception'
        and (p_kind<>'attendance_session' or info->>'overnight'='false') then 'Completed' else 'Pending Review' end;
      if p_kind='visit' then
        account:=record_row.account_id;
        if account is null then select parent_id into account from private.sales_field_records where (organization_id,id)=(p_org,record_row.parent_id); end if;
        if coalesce(p_body->>'outcome','') not in ('Positive / Requirement Confirmed','Demo Requested','Quotation Requested','Under Evaluation','Price Negotiation','No Decision','Lost to Competitor')
          or ((nullif(btrim(p_body->>'next_action'),'') is null)<>(follow_time is null)) or (follow_time is not null and (not isfinite(follow_time) or follow_time<now())) then
          raise exception 'Select a meeting outcome and supply a future date for a next action' using errcode='22023'; end if;
        ids:=coalesce(p_body->'contacts','[]'::jsonb);
        if jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids)>30 then raise exception 'Choose up to 30 contacts' using errcode='22023'; end if;
        for item in select distinct value::uuid from jsonb_array_elements_text(ids) loop
          if not private.contact_visible(p_org,actor,item) or not exists(select 1 from private.sales_field_records c
            where (c.organization_id,c.id)=(p_org,item) and (c.parent_id=account or exists(select 1 from private.contact_affiliations a
              where (a.organization_id,a.contact_id,a.account_id)=(p_org,item,account) and a.active))) then
            raise exception 'Choose contacts for this customer' using errcode='22023'; end if;
        end loop;
        ids:=coalesce(p_body->'products','[]'::jsonb);
        if jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids)>30 then raise exception 'Choose up to 30 products' using errcode='22023'; end if;
        select coalesce(jsonb_agg(jsonb_build_object('model',f.title,'category',coalesce(nullif(f.details->>'category',''),'Other'),'quantity','1')),'[]'::jsonb)
          into products from private.sales_field_records f join public.resources r using(organization_id,id)
          where f.organization_id=p_org and f.kind='product' and r.archived_at is null and private.intake_actor_can(p_org,actor,'product.read')
            and f.id in(select value::uuid from jsonb_array_elements_text(ids));
        if jsonb_array_length(products)<>(select count(distinct value) from jsonb_array_elements_text(ids)) then
          raise exception 'Choose available products' using errcode='22023'; end if;
        ids:=coalesce(p_body->'leads','[]'::jsonb);
        if jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids)>30 then raise exception 'Choose up to 30 leads' using errcode='22023'; end if;
        for item in select distinct value::uuid from jsonb_array_elements_text(ids) loop
          if not private.field_link_allowed(p_org,actor,item) or not exists(select 1 from public.leads l
            where (l.organization_id,l.id,l.account_id)=(p_org,item,account)) then raise exception 'Choose leads for this customer' using errcode='22023'; end if;
          insert into private.field_visit_leads values(p_org,target,item) on conflict do nothing;
        end loop;
        ids:=coalesce(p_body->'commercial','[]'::jsonb);
        if jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids)>30 then
          raise exception 'Choose up to 30 commercial records' using errcode='22023';
        end if;
        for item in select distinct value::uuid from jsonb_array_elements_text(ids) loop
          if not private.field_link_allowed(p_org,actor,item) or not exists(
            select 1 from private.sales_field_records f join public.opportunities o
              on (o.organization_id,o.id)=(f.organization_id,f.parent_id)
            where (f.organization_id,f.id,o.account_id)=(p_org,item,account)
              and (f.kind='quotation' or f.kind='financial_reference' and f.details->>'type'='Order')) then
            raise exception 'Choose quotations and orders for this customer' using errcode='22023';
          end if;
        end loop;
        if p_body->>'new_lead'='true' then
          select f.* into contact_person from private.sales_field_records f
            where (f.organization_id,f.id)=(p_org,nullif(p_body->'contacts'->>0,'')::uuid);
          lead_result:=private.command_lead_management(p_org,'create',md5(p_key::text||':visit-lead')::uuid,
            jsonb_build_object('fields',jsonb_build_object('customer',(select a.name from public.accounts a where (a.organization_id,a.id)=(p_org,account)),
            'source','hospital_visit','routing','self','contact',contact_person.title,'mobile',contact_person.details->>'phone',
            'email',contact_person.details->>'email','missing_contact_reason','Contact details to be confirmed',
            'requirements',p_body->>'requirements','description',p_body->>'outcome'),'products',products));
          item:=(lead_result->>'id')::uuid;
          update public.leads set account_id=account,customer_site_id=record_row.parent_id,customer_contact_id=contact_person.id
            where (organization_id,id)=(p_org,item);
          insert into private.field_visit_leads values(p_org,target,item);
        end if;
        perform private.field_task_auto(p_org,actor,target,'visit',follow_time,p_body->>'next_action','Customer Call',account);
        info:=info||jsonb_build_object('contacts',p_body->'contacts','products',products,'commercial',ids,'outcome',p_body->>'outcome','requirements',p_body->>'requirements','competition',p_body->>'competition','next_action',p_body->>'next_action','follow_up',follow_time);
        if record_row.plan_id is not null then
          update private.sales_field_records set status='Completed',version=version+1
            where (organization_id,id)=(p_org,record_row.plan_id) returning version into record_row.version;
          insert into private.sales_field_events(organization_id,record_id,version,actor_id,event_type,details)
            values(p_org,record_row.plan_id,record_row.version,actor,'complete',jsonb_build_object('visit',target));
        end if;
      end if;
      update private.sales_field_records set status=result_status,ended_at=now(),version=version+1,details=details||info
        where (organization_id,id)=(p_org,target) returning version into record_row.version;
    elsif p_kind='task' and record_row.status not in ('Completed','Cancelled') and p_action in ('begin','complete','cancel','reschedule') then
      if p_action in ('complete','cancel','reschedule') and (reason is null or length(reason) not between 3 and 1000) then
        raise exception 'Enter completion notes or a reason' using errcode='22023'; end if;
      if p_action='reschedule' and (start_time is null or not isfinite(start_time) or start_time<=now() or start_time=record_row.planned_at) then
        raise exception 'Choose a different future due date' using errcode='22023'; end if;
      result_status:=case p_action when 'begin' then 'In Progress' when 'complete' then 'Completed' when 'cancel' then 'Cancelled' else 'Rescheduled' end;
      info:=jsonb_build_object('reason',reason,'previous_due_date',record_row.planned_at,'new_due_date',start_time);
      update private.sales_field_records set status=result_status,version=version+1,
        planned_at=case when p_action='reschedule' then start_time else planned_at end,ended_at=case when p_action in ('complete','cancel') then now() end,
        details=details||case when p_action='complete' then jsonb_build_object('completion_notes',reason) else '{}'::jsonb end
        where (organization_id,id)=(p_org,target) returning version into record_row.version;
    elsif p_kind='visit_plan' and p_action='reschedule' and record_row.status='Planned' then
      if start_time is null or end_time is null or not isfinite(start_time) or not isfinite(end_time) or end_time<=start_time or length(coalesce(reason,''))<3 then
        raise exception 'Provide a new visit schedule and reason' using errcode='22023'; end if;
      info:=jsonb_build_object('reason',reason,'previous_due_date',record_row.planned_at,'new_due_date',start_time);
      update private.sales_field_records set planned_at=start_time,ended_at=end_time,version=version+1
        where (organization_id,id)=(p_org,target) returning version into record_row.version;
    else raise exception 'This action is unavailable for the current record' using errcode='22023'; end if;
    insert into private.sales_field_events(organization_id,record_id,version,actor_id,event_type,details)
      values(p_org,target,record_row.version,actor,p_action,case when p_kind in ('visit','attendance_session') then private.field_public_details(info) else info end);
  end if;
  insert into private.audit_events(organization_id,actor_membership_id,resource_id,action,request_id,redacted_details)
    values(p_org,actor,case when p_action='verify_customer' then target end,command_name,p_key,
      jsonb_build_object('record_id',target,'subject',case when p_action='acknowledge' then owner end,
      'day',case when p_action='acknowledge' then selected_day end));
  response:=jsonb_build_object('id',target,'lead',lead_result);
  insert into private.operation_receipts(organization_id,actor_membership_id,operation_key,command_type,request_hash,response_snapshot)
    values(p_org,actor,p_key,command_name,digest,response);
  return response;
end
$$;

create function private.field_public_details(info jsonb) returns jsonb
language sql immutable set search_path=pg_catalog as $$
  select info-array['location','start_evidence','end_evidence','completion']
    ||jsonb_build_object('start_evidence',coalesce((info->'start_evidence')-'raw',
        case when info ? 'location' or info ? 'exception' then jsonb_build_object(
          'verdict',case when nullif(info->>'exception','') is not null then 'Location Exception'
            when info->>'geofence'='Within site range' then 'Verified On-Site'
            when info ? 'geofence' then 'Location Exception'
            when info#>>'{location,accuracy}' is not null then 'GPS captured' else 'Location Exception' end,
          'condition',info->>'geofence','exception',info->>'exception',
          'accuracy_meters',info#>'{location,accuracy}','distance_meters',info->'site_distance_metres') end),
      'end_evidence',coalesce((info->'end_evidence')-'raw',
        case when info#>'{completion,location}' is not null or info#>'{completion,exception}' is not null then jsonb_build_object(
          'verdict',case when nullif(info#>>'{completion,exception}','') is not null then 'Location Exception'
            when info#>>'{completion,geofence}'='Within site range' then 'Verified On-Site'
            when info#>>'{completion,geofence}' is not null then 'Location Exception' else 'GPS captured' end,
          'condition',info#>>'{completion,geofence}','exception',info#>>'{completion,exception}',
          'accuracy_meters',info#>'{completion,location,accuracy}','distance_meters',info#>'{completion,site_distance_metres}') end),
      'completion',(info->'completion')-'location')
    ||case when not info ? 'outcome' and info#>>'{completion,outcome}' is not null then
      jsonb_build_object('outcome',info#>>'{completion,outcome}','next_action',info#>>'{completion,next_action}',
        'follow_up',info#>>'{completion,next_due_at}') else '{}'::jsonb end

$$;

create function private.field_workspace(p_org uuid,p_kind text,p_query jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare
  actor uuid:=private.field_actor(p_org,p_kind||'.read');
  subject uuid:=nullif(p_query->>'owner','')::uuid;
  first_day date:=coalesce(nullif(p_query->>'from','')::date,(now() at time zone 'Asia/Kolkata')::date-30);
  last_day date:=coalesce(nullif(p_query->>'through','')::date,(now() at time zone 'Asia/Kolkata')::date+60);
  account uuid:=nullif(p_query->>'account','')::uuid;
  lead uuid:=nullif(p_query->>'lead','')::uuid;
  after_at timestamptz;
  before_at timestamptz;
  rows jsonb;
begin
  if p_kind='settings' then
    actor:=private.field_actor(p_org,'staff.directory.read');
    if actor is null or not private.workspace_is_admin(p_org,actor) then raise exception 'Administrator required' using errcode='42501'; end if;
    return jsonb_build_object('radius',private.field_radius(p_org),'version',coalesce((select version from private.field_settings where organization_id=p_org),0),
      'automation',coalesce((select automation from private.field_settings where organization_id=p_org),
      '{"assignment":true,"visit":true,"demo":true,"tender":true,"payment":true}'::jsonb));
  end if;
  if actor is null or p_kind not in ('attendance_session','visit_plan','visit','task') then raise exception 'Field access denied' using errcode='42501'; end if;
  if last_day<first_day or last_day-first_day>100 or (subject is not null and not private.field_team(p_org,actor,subject))
    or (account is not null and not private.customer_visible(p_org,actor,account))
    or (lead is not null and (not private.intake_actor_can(p_org,actor,'lead.read') or not private.lead_visible(p_org,actor,lead))) then
    raise exception 'Field filters unavailable' using errcode='42501';
  end if;
  after_at:=first_day::timestamp at time zone 'Asia/Kolkata';
  before_at:=(last_day+1)::timestamp at time zone 'Asia/Kolkata';
  select coalesce(jsonb_agg(to_jsonb(x) order by (x.status='Open') desc,x.planned_at desc,x.id),'[]'::jsonb) into rows from (
    select f.id,f.title,f.status,f.created_at,f.planned_at,f.ended_at,f.version,f.owner_id,
      private.lead_member_name(p_org,f.owner_id) owner_name,
      a.id account_id,a.name account_name,
      case when p_kind='task' and private.field_link_allowed(p_org,actor,f.parent_id) then f.parent_id
        when p_kind in ('visit','visit_plan') and a.id is not null and private.intake_actor_can(p_org,actor,'site.read') then f.parent_id end parent_id,
      case when a.id is not null and private.intake_actor_can(p_org,actor,'site.read') then site.title end site_name,f.plan_id,
      private.field_public_details(f.details) details,
      (select coalesce(jsonb_agg(v.lead_id),'[]'::jsonb) from private.field_visit_leads v
        where (v.organization_id,v.visit_id)=(p_org,f.id) and private.intake_actor_can(p_org,actor,'lead.read')
          and private.lead_visible(p_org,actor,v.lead_id)) lead_ids,
      case when p_kind='task' then (select coalesce(jsonb_agg(jsonb_build_object('when',e.recorded_at,'details',e.details,'actor',private.lead_member_name(p_org,e.actor_id)) order by e.recorded_at desc),'[]')
        from private.sales_field_events e where (e.organization_id,e.record_id)=(p_org,f.id) and e.event_type='reschedule') end history
    from private.sales_field_records f join public.resources r using(organization_id,id)
    left join private.sales_field_records site on (site.organization_id,site.id)=(f.organization_id,f.parent_id) and site.kind='site'
    left join public.accounts a on (a.organization_id,a.id)=(f.organization_id,coalesce(f.account_id,site.parent_id))
      and private.customer_visible(p_org,actor,a.id)
    where f.organization_id=p_org and f.kind=p_kind and r.archived_at is null
      and private.field_team(p_org,actor,f.owner_id)
      and (subject is null or f.owner_id=subject)
      and ((f.planned_at>=after_at and f.planned_at<before_at) or (p_kind in ('attendance_session','visit') and f.status='Open')
        or (p_kind='attendance_session' and f.owner_id=actor
          and (f.planned_at at time zone 'Asia/Kolkata')::date=(now() at time zone 'Asia/Kolkata')::date)
        or (p_kind='task' and f.planned_at<after_at and f.status not in ('Completed','Cancelled'))
        or (p_kind='task' and f.ended_at>=after_at and f.ended_at<before_at))
      and (account is null or coalesce(f.account_id,site.parent_id)=account
        or p_kind='task' and (f.parent_id=account or exists(select 1 from public.leads l where (l.organization_id,l.id,l.account_id)=(p_org,f.parent_id,account)
          and private.intake_actor_can(p_org,actor,'lead.read') and private.lead_visible(p_org,actor,l.id))))
      and (lead is null or p_kind='task' and f.parent_id=lead or p_kind in ('visit','task') and exists(
        select 1 from private.field_visit_leads v where (v.organization_id,v.visit_id,v.lead_id)=
          (p_org,case when p_kind='visit' then f.id else f.parent_id end,lead)))
    order by (f.status='Open') desc,f.planned_at desc,f.id limit 400
  ) x;
  return jsonb_build_object('actor',actor,'radius',private.field_radius(p_org),
    'can_create',private.intake_actor_can(p_org,actor,p_kind||'.create'),
    'can_start_visit',private.intake_actor_can(p_org,actor,'visit.read') and private.intake_actor_can(p_org,actor,'visit.create'),
    'can_update',private.intake_actor_can(p_org,actor,p_kind||'.update'),
    'can_lead',private.intake_actor_can(p_org,actor,'lead.create') and private.intake_actor_can(p_org,actor,'lead.read'),
    'can_contact',private.intake_actor_can(p_org,actor,'contact.create') and private.intake_actor_can(p_org,actor,'contact.read')
      and private.intake_actor_can(p_org,actor,'account.read'),
    'can_attach',private.intake_actor_can(p_org,actor,'file.stage'),'can_download',private.intake_actor_can(p_org,actor,'file.download'),
    'team',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',p.display_name) order by p.display_name,m.id)
      from public.memberships m join public.profiles p on p.id=m.user_id where m.organization_id=p_org and m.status='Active'
        and m.id<>actor and private.field_team(p_org,actor,m.id)), '[]'::jsonb),
    'rows',rows,
    'attendance_since',(select (min(f.planned_at) at time zone 'Asia/Kolkata')::date from private.sales_field_records f
      where (f.organization_id,f.kind,f.owner_id)=(p_org,'attendance_session',actor) and p_kind='attendance_session'),
    'can_verify_customer',private.intake_actor_can(p_org,actor,'visit.update') and account is not null and exists(
      select 1 from public.resources r where (r.organization_id,r.id)=(p_org,account)
        and (private.workspace_is_admin(p_org,actor) or (r.owner_membership_id<>actor and private.field_team(p_org,actor,r.owner_membership_id)))),
    'corrections',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('member_name',private.lead_member_name(p_org,c.member_id)) order by c.created_at desc)
      from private.field_attendance_corrections c where p_kind='attendance_session' and c.organization_id=p_org and c.day between first_day and last_day
       and private.field_team(p_org,actor,c.member_id)), '[]'::jsonb));
end
$$;

create function private.field_report(p_org uuid,p_member uuid,p_day date) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare
  actor uuid:=private.field_actor(p_org,'visit.read');
  subject uuid:=coalesce(p_member,actor);
  day_start timestamptz:=p_day::timestamp at time zone 'Asia/Kolkata';
  day_end timestamptz:=(p_day+1)::timestamp at time zone 'Asia/Kolkata';
  tomorrow_end timestamptz:=(p_day+2)::timestamp at time zone 'Asia/Kolkata';
  result jsonb;
begin
  if actor is null or p_day is null or not private.field_team(p_org,actor,subject) then raise exception 'Report access denied' using errcode='42501'; end if;
  with personal as materialized (
    select f.* from private.sales_field_records f join public.resources r using(organization_id,id)
    where (f.organization_id,f.owner_id)=(p_org,subject) and r.archived_at is null and (
      (f.planned_at>=day_start and f.planned_at<tomorrow_end) or (f.ended_at>=day_start and f.ended_at<day_end) or
      (f.created_at>=day_start and f.created_at<day_end))
  ), visits as (
    select v.*,private.field_public_details(v.details) evidence from personal v
      where kind='visit' and planned_at>=day_start and planned_at<day_end
  ), commercial as (
    select f.id,f.kind from visits v
    cross join lateral jsonb_array_elements_text(coalesce(v.details->'commercial','[]')) picked(record_id)
    join private.sales_field_records f on (f.organization_id,f.id)=(p_org,picked.record_id::uuid)
    where v.ended_at is not null and private.field_link_allowed(p_org,actor,f.id)
  ), attendance as (
    select coalesce(c.start_at,f.planned_at) starts,coalesce(c.end_at,f.ended_at) ends
    from (select 1) base
    left join lateral (select p.planned_at,p.ended_at from personal p where p.kind='attendance_session' and p.planned_at>=day_start
      and p.planned_at<day_end order by p.planned_at limit 1) f on true
    left join lateral (
      select (array_agg(p.start_at order by p.decided_at desc) filter(where p.start_at is not null))[1] start_at,
        (array_agg(p.end_at order by p.decided_at desc) filter(where p.end_at is not null))[1] end_at
      from private.field_attendance_corrections p where (p.organization_id,p.member_id,p.day)=(p_org,subject,p_day)
        and p.status='Approved') c on true
    where private.intake_actor_can(p_org,actor,'attendance_session.read')
  )
  select jsonb_build_object(
    'attendance',(select to_jsonb(a)||jsonb_build_object('minutes',round(extract(epoch from (a.ends-a.starts))/60)) from attendance a),
    'visits',(select count(*) from visits),'completed',(select count(*) from visits where status<>'Open'),
    'verified',(select count(*) from visits where evidence#>>'{start_evidence,verdict}'='Verified On-Site'
      and evidence#>>'{end_evidence,verdict}' is distinct from 'Location Exception'),
    'exceptions',(select count(*) from visits where evidence#>>'{start_evidence,verdict}' is distinct from 'Verified On-Site'
      or evidence#>>'{end_evidence,verdict}'='Location Exception'),
    'planned',(select count(*) from personal where kind='visit_plan' and planned_at>=day_start and planned_at<day_end
      and private.intake_actor_can(p_org,actor,'visit_plan.read')),
    'plans_completed',(select count(*) from personal where kind='visit_plan' and planned_at>=day_start and planned_at<day_end and status='Completed'
      and private.intake_actor_can(p_org,actor,'visit_plan.read')),
    'visit_minutes',(select coalesce(round(sum(extract(epoch from (ended_at-planned_at)))/60),0) from visits),
    'contacts',(select coalesce(sum(case when jsonb_typeof(details->'contacts')='array' then jsonb_array_length(details->'contacts') else 0 end),0) from visits),
    'customers',(select coalesce(jsonb_agg(distinct a.name),'[]') from visits v join public.accounts a on a.organization_id=v.organization_id and a.id=coalesce(v.account_id,
        (select site.parent_id from private.sales_field_records site where (site.organization_id,site.id)=(v.organization_id,v.parent_id) and site.kind='site'))
      where private.customer_visible(p_org,actor,a.id)),
    'leads',(select count(*) from public.leads l join public.resources r using(organization_id,id)
      where l.organization_id=p_org and l.created_by=subject and l.ingested_at>=day_start and l.ingested_at<day_end and r.archived_at is null
        and private.intake_actor_can(p_org,actor,'lead.read') and private.lead_visible(p_org,actor,l.id)),
    'followups',(select count(*) from personal where kind='task' and status='Completed' and ended_at>=day_start and ended_at<day_end
      and private.intake_actor_can(p_org,actor,'task.read')),
    'quotations',(select count(distinct id) from commercial where kind='quotation'),
    'orders',(select count(distinct id) from commercial where kind='financial_reference'),
    'can_read_expenses','expenses'=any(private.workspace_modules(p_org,actor)),
    'tomorrow',(select coalesce(jsonb_agg(jsonb_build_object('title',title,'starts',planned_at) order by planned_at),'[]') from personal
      where kind='visit_plan' and planned_at>=day_end and planned_at<tomorrow_end and private.intake_actor_can(p_org,actor,'visit_plan.read')),
    'review',(select jsonb_build_object('feedback',a.feedback,'at',a.acknowledged_at,'reviewer',private.lead_member_name(p_org,a.reviewer_id))
      from private.field_report_acknowledgements a where (a.organization_id,a.member_id,a.day)=(p_org,subject,p_day)),
    'can_review',subject<>actor
  ) into result;
  return result;
end
$$;

create function public.field_workspace(p_org uuid,p_kind text,p_query jsonb default '{}') returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$select private.field_workspace(p_org,p_kind,p_query)$$;
create function public.field_reference_data(p_org uuid,p_mode text,p_account uuid default null,p_search text default '') returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$select private.field_reference_data(p_org,p_mode,p_account,p_search)$$;
create function public.field_command(p_org uuid,p_kind text,p_action text,p_key uuid,p_body jsonb) returns jsonb
language sql security invoker set search_path=pg_catalog as $$select private.field_command(p_org,p_kind,p_action,p_key,p_body)$$;
create function public.field_report(p_org uuid,p_member uuid,p_day date) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$select private.field_report(p_org,p_member,p_day)$$;

revoke all on function private.field_actor(uuid,text),private.field_team(uuid,uuid,uuid),private.field_radius(uuid),private.field_enabled(uuid,text),
  private.field_evidence(uuid,uuid,jsonb,boolean),private.field_insert(uuid,uuid,text,uuid,uuid,uuid,uuid,text,text,timestamptz,timestamptz,jsonb,text),
  private.field_task_auto(uuid,uuid,uuid,text,timestamptz,text,text,uuid),private.field_lead_task_trigger(),private.field_milestone_task_trigger(),
  private.field_public_details(jsonb),private.field_link_allowed(uuid,uuid,uuid),
  private.field_workspace(uuid,text,jsonb),private.field_reference_data(uuid,text,uuid,text),private.field_command(uuid,text,text,uuid,jsonb),
  private.field_report(uuid,uuid,date),public.field_workspace(uuid,text,jsonb),public.field_reference_data(uuid,text,uuid,text),
  public.field_command(uuid,text,text,uuid,jsonb),public.field_report(uuid,uuid,date) from public,anon,authenticated;
grant execute on function private.field_workspace(uuid,text,jsonb),private.field_reference_data(uuid,text,uuid,text),
  private.field_command(uuid,text,text,uuid,jsonb),private.field_report(uuid,uuid,date),public.field_workspace(uuid,text,jsonb),
  public.field_reference_data(uuid,text,uuid,text),public.field_command(uuid,text,text,uuid,jsonb),public.field_report(uuid,uuid,date) to authenticated;

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
    when p_type in ('account','lead','opportunity','visit') then p_purpose='business_document' and p_owner=p_actor
      and (select count(distinct rp.permission_code) from public.member_roles mr
        join public.role_permissions rp on (rp.organization_id,rp.role_id)=(mr.organization_id,mr.role_id)
        where mr.organization_id=p_org and mr.membership_id=p_actor
          and mr.effective_from<=now() and (mr.effective_to is null or mr.effective_to>now())
          and rp.permission_code in (case when p_download then 'file.download' else 'file.stage' end,p_type||'.read'))=2
    else false end
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
   and r.archived_at is null and r.resource_type in ('account','lead','contact','visit');
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

-- Route location-sensitive actions through the evidence checks, including direct RPC calls.
alter function private.run_sales_field(uuid,text,text,uuid,jsonb) rename to run_sales_field_legacy;
revoke all on function private.run_sales_field_legacy(uuid,text,text,uuid,jsonb) from public,anon,authenticated;
create function private.run_sales_field(p_org uuid,p_kind text,p_action text,p_key uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if p_kind in ('visit','attendance_session','visit_plan','task') then
    raise exception 'Open the Field Operations workspace for this action' using errcode='22023';
  end if;
  return private.run_sales_field_legacy(p_org,p_kind,p_action,p_key,p_data);
end
$$;
revoke all on function private.run_sales_field(uuid,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.run_sales_field(uuid,text,text,uuid,jsonb) to authenticated;

-- Keep verification controlled even when an account is edited through older screens.
create function private.field_preserve_provisional() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare actor uuid; owner uuid;
begin
  if old.details->>'is_provisional'='false' then
    new.details:=new.details||jsonb_build_object('is_provisional','false');
  elsif old.details->>'is_provisional'='true' then
    if new.details->>'is_provisional'='false' then
      actor:=private.field_actor(old.organization_id,'visit.update');
      select r.owner_membership_id into owner from public.resources r where (r.organization_id,r.id)=(old.organization_id,old.account_id);
      if actor is null or (not private.workspace_is_admin(old.organization_id,actor) and
        (owner=actor or not private.field_team(old.organization_id,actor,owner))) then
        raise exception 'Customer verification requires a manager or administrator' using errcode='42501';
      end if;
    else
      new.details:=new.details||jsonb_build_object('is_provisional','true');
    end if;
  end if;
  return new;
end
$$;
create trigger field_preserve_provisional before update of details on private.customer_master
  for each row execute function private.field_preserve_provisional();
revoke all on function private.field_preserve_provisional() from public,anon,authenticated;

alter function private.command_lead_management(uuid,text,uuid,jsonb) rename to field_lead_command_base;
revoke all on function private.field_lead_command_base(uuid,text,uuid,jsonb) from public,anon,authenticated;
create function private.command_lead_management(p_org uuid,p_action text,p_key uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  actor uuid;
  target uuid:=nullif(p_input->>'id','')::uuid;
  previous_due timestamptz;
  current_due timestamptz;
  reason text:=nullif(btrim(coalesce(p_input->>'reschedule_reason',p_input#>>'{fields,reschedule_reason}')),'');
  result jsonb;
begin
  if p_action not in ('stage','edit','reopen') or target is null or p_key is null then
    return private.field_lead_command_base(p_org,p_action,p_key,p_input);
  end if;
  actor:=private.staff_admin_actor(p_org,'lead.read');
  if actor is null then raise exception 'Lead access denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_key::text,0));
  if exists(select 1 from private.operation_receipts where (organization_id,actor_membership_id,operation_key)=(p_org,actor,p_key)) then
    return private.field_lead_command_base(p_org,p_action,p_key,p_input);
  end if;
  select l.next_action_due_at into previous_due from public.leads l where (l.organization_id,l.id)=(p_org,target)
    and private.lead_visible(p_org,actor,l.id);
  result:=private.field_lead_command_base(p_org,p_action,p_key,p_input);
  select l.next_action_due_at into current_due from public.leads l where (l.organization_id,l.id)=(p_org,target);
  if previous_due is not null and current_due is not null and previous_due<>current_due then
    if reason is null or length(reason) not between 3 and 1000 then
      raise exception 'Enter a reschedule reason of 3 to 1,000 characters' using errcode='22023';
    end if;
    perform private.lead_event(p_org,target,actor,'Follow-up scheduled',
      jsonb_build_object('summary',reason,'previous_due_date',previous_due,'new_due_date',current_due));
  end if;
  return result;
end
$$;
revoke all on function private.command_lead_management(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.command_lead_management(uuid,text,uuid,jsonb) to authenticated;

alter function private.read_sales_field(uuid,text,int) rename to read_sales_field_legacy;
revoke all on function private.read_sales_field_legacy(uuid,text,int) from public,anon,authenticated;
create function private.read_sales_field(p_org uuid,p_kind text,p_offset int) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb:=private.read_sales_field_legacy(p_org,p_kind,p_offset);
begin
  if p_kind in ('visit','attendance_session') then
    result:=result||jsonb_build_object('rows',(select coalesce(jsonb_agg(row_data||jsonb_build_object(
      'details',private.field_public_details(row_data->'details')) order by ordinal),'[]')
      from jsonb_array_elements(result->'rows') with ordinality as entries(row_data,ordinal)));
  end if;
  return result;
end
$$;
revoke all on function private.read_sales_field(uuid,text,int) from public,anon,authenticated;
grant execute on function private.read_sales_field(uuid,text,int) to authenticated;
