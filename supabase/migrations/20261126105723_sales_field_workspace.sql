insert into public.permissions (code, description)
select kind || '.' || operation, initcap(operation) || ' ' || replace(kind, '_', ' ') || ' records'
from unnest(array['site','contact','product','task','visit_plan','attendance_session','visit','equipment','quotation','financial_reference','demo','target']) kind
cross join unnest(array['read','create','update']) operation
on conflict (code) do nothing;

-- Existing intake roles have an exact provisioning contract. Grant these capabilities
-- to the pilot administrator; new staff can receive them through delegated bundles.
create function private.install_sales_field_roles(p_org uuid, p_admin uuid) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  insert into public.role_permissions (organization_id,role_id,permission_code)
  select p_org,p_admin,p.code from public.permissions p
  where (split_part(p.code,'.',1) in ('site','contact','product','task','visit_plan','attendance_session','visit',
      'equipment','quotation','financial_reference','demo','target') and split_part(p.code,'.',2) in ('read','create','update'))
  on conflict do nothing;

  insert into public.roles (organization_id,code,name,delegable)
  values(p_org,'field_sales','Field Sales',true) on conflict do nothing;
  insert into public.role_permissions (organization_id,role_id,permission_code)
  select r.organization_id,r.id,p.code from public.roles r cross join public.permissions p
  where r.code='field_sales' and r.organization_id=p_org and (
    split_part(p.code,'.',1) in ('site','contact','task','visit_plan','attendance_session','visit','equipment')
      and split_part(p.code,'.',2) in ('read','create','update')
    or p.code in ('account.read','lead.read','opportunity.read','product.read')
  ) on conflict do nothing;
end
$$;
revoke all on function private.install_sales_field_roles(uuid,uuid) from public, anon, authenticated;

select private.install_sales_field_roles(r.organization_id,r.id)
from public.roles r where r.code='super_admin';

create function private.sales_field_roles_after_insert() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  perform private.install_sales_field_roles(new.organization_id,new.id);
  return new;
end
$$;
revoke all on function private.sales_field_roles_after_insert() from public, anon, authenticated;
create trigger sales_field_roles_after_insert after insert on public.roles
  for each row when (new.code='super_admin') execute function private.sales_field_roles_after_insert();

alter table public.resources drop constraint resources_resource_type_check;
alter table public.resources add constraint resources_resource_type_check check(resource_type in (
 'account','site','contact','product','document','lead','opportunity','activity','task','quotation','booking','financial_reference',
 'visit_plan','attendance_session','visit','tender','tender_security','tender_award','travel_request','expense_claim','travel_advance',
 'reimbursement','approval_request','equipment','demo','target'));

create table private.sales_field_records (
  organization_id uuid not null,
  id uuid not null,
  kind text not null check(kind in ('site','contact','product','task','visit_plan','attendance_session','visit','equipment','quotation','financial_reference','demo','target')),
  owner_id uuid not null,
  parent_id uuid,
  title text not null check(length(btrim(title)) between 1 and 200),
  status text not null,
  planned_at timestamptz,
  ended_at timestamptz,
  details jsonb not null check(jsonb_typeof(details)='object' and octet_length(details::text)<=16000),
  version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(),
  primary key(organization_id,id),
  foreign key (organization_id,id) references public.resources(organization_id,id),
  foreign key (organization_id,owner_id) references public.memberships(organization_id,id),
  foreign key (organization_id,parent_id) references public.resources(organization_id,id)
);
create index sales_field_listing on private.sales_field_records(organization_id,kind,owner_id,created_at desc,id);
create unique index sales_field_product_code on private.sales_field_records(organization_id,lower(btrim(details->>'code')))
  where kind='product';
create unique index sales_field_quote_revision on private.sales_field_records(organization_id,parent_id,lower(btrim(details->>'number')),((details->>'revision')::integer))
  where kind='quotation';
create unique index sales_field_source_reference on private.sales_field_records(organization_id,
  lower(btrim(details->>'source')),lower(btrim(details->>'type')),lower(btrim(details->>'number')))
  where kind='financial_reference';
create unique index sales_field_one_open_session on private.sales_field_records(organization_id,owner_id,kind)
  where kind in ('attendance_session','visit') and status='Open';
alter table private.sales_field_records enable row level security;
revoke all on private.sales_field_records from public, anon, authenticated;

create table private.sales_field_events (
  organization_id uuid not null,
  record_id uuid not null,
  version integer not null,
  actor_id uuid not null,
  event_type text not null,
  recorded_at timestamptz not null default now(),
  details jsonb not null,
  primary key(organization_id,record_id,version),
  foreign key(organization_id,record_id) references private.sales_field_records(organization_id,id),
  foreign key(organization_id,actor_id) references public.memberships(organization_id,id)
);
alter table private.sales_field_events enable row level security;
revoke all on private.sales_field_events from public, anon, authenticated;
create trigger sales_field_events_immutable before update or delete or truncate on private.sales_field_events
  for each statement execute function private.reject_mutation();

create function private.sales_field_visible_parent(p_org uuid,p_parent uuid,p_actor uuid,p_expected text[])
returns boolean language sql stable security invoker set search_path=pg_catalog as $$
  select exists (
    select 1 from public.resources r
    where (r.organization_id,r.id)=(p_org,p_parent) and r.archived_at is null
      and r.resource_type=any(p_expected)
      and private.staff_admin_actor(p_org,r.resource_type || '.read')=p_actor
      and (r.owner_membership_id=p_actor
        or private.crm_read_scope(p_org,r.owner_membership_id,r.territory_id,r.resource_type)
        or (r.resource_type in ('account','lead') and private.has_crm_record_share(p_org,r.id,r.owner_membership_id)))
      and (r.resource_type <> 'site' or exists (
        select 1 from private.sales_field_records site join public.resources a
          on (a.organization_id,a.id)=(site.organization_id,site.parent_id)
        where (site.organization_id,site.id)=(p_org,p_parent) and a.resource_type='account'
          and a.archived_at is null and private.staff_admin_actor(p_org,'account.read')=p_actor
          and (a.owner_membership_id=p_actor or private.crm_read_scope(p_org,a.owner_membership_id,a.territory_id,'account')
            or private.has_crm_record_share(p_org,a.id,a.owner_membership_id))
      ))
  )
$$;
revoke all on function private.sales_field_visible_parent(uuid,uuid,uuid,text[]) from public, anon, authenticated;

create function private.read_sales_field(p_org uuid,p_kind text,p_offset int) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare
  actor uuid := private.staff_admin_actor(p_org,p_kind || '.read');
  allowed_parents text[];
begin
  if actor is null or p_kind not in ('site','contact','product','task','visit_plan','attendance_session','visit','equipment','quotation','financial_reference','demo','target')
    or coalesce(p_offset,-1) not between 0 and 100000 then
    raise exception 'Sales workspace access denied' using errcode='42501';
  end if;
  allowed_parents := case p_kind when 'site' then array['account']
    when 'contact' then array['account']
    when 'equipment' then array['site']
    when 'quotation' then array['opportunity']
    when 'financial_reference' then array['opportunity']
    when 'demo' then array['opportunity','account']
    when 'task' then array['lead','account','opportunity']
    when 'visit' then array['site']
    when 'visit_plan' then array['site'] else array[]::text[] end;
  return jsonb_build_object(
    'can_create', private.staff_admin_actor(p_org,p_kind || '.create')=actor,
    'can_update', private.staff_admin_actor(p_org,p_kind || '.update')=actor,
    'rows', coalesce((select jsonb_agg(row_data) from (
      select jsonb_build_object('id',f.id,'title',f.title,'status',f.status,'details',f.details,
        'planned_at',f.planned_at,'ended_at',f.ended_at,'parent_id',f.parent_id,'version',f.version,'created_at',f.created_at,'owned',f.owner_id=actor) row_data
      from private.sales_field_records f join public.resources r
        on (r.organization_id,r.id)=(f.organization_id,f.id)
      where f.organization_id=p_org and f.kind=p_kind and r.archived_at is null
        and (p_kind='product' or f.owner_id=actor or
          (p_kind in ('site','contact') and private.sales_field_visible_parent(p_org,f.parent_id,actor,allowed_parents)))
        and (f.parent_id is null or private.sales_field_visible_parent(p_org,f.parent_id,actor,allowed_parents))
      order by (f.status='Open') desc, f.created_at desc, f.id offset p_offset limit 26
    ) page),'[]'::jsonb),
    'parents', coalesce((select jsonb_agg(to_jsonb(parent)) from (
      select r.id, r.resource_type kind, coalesce(a.name,l.prospect_name,f.title,o.requirement_text, 'Opportunity ' || left(o.id::text,8)) title
      from public.resources r
      left join public.accounts a on (a.organization_id,a.id)=(r.organization_id,r.id)
      left join public.leads l on (l.organization_id,l.id)=(r.organization_id,r.id)
      left join public.opportunities o on (o.organization_id,o.id)=(r.organization_id,r.id)
      left join private.sales_field_records f on (f.organization_id,f.id)=(r.organization_id,r.id)
      where r.organization_id=p_org and r.resource_type=any(allowed_parents)
        and private.sales_field_visible_parent(p_org,r.id,actor,allowed_parents)
      order by 3, r.id limit 250
    ) parent),'[]'::jsonb)
  );
end
$$;
revoke all on function private.read_sales_field(uuid,text,int) from public, anon, authenticated;
grant execute on function private.read_sales_field(uuid,text,int) to authenticated;

create function public.read_sales_field(p_org uuid,p_kind text,p_offset int default 0) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
  select private.read_sales_field(p_org,p_kind,p_offset)
$$;
revoke all on function public.read_sales_field(uuid,text,int) from public, anon, authenticated;
grant execute on function public.read_sales_field(uuid,text,int) to authenticated;

create function private.run_sales_field(p_org uuid,p_kind text,p_action text,p_key uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  actor uuid;
  result jsonb;
  prior private.operation_receipts%rowtype;
  existing private.sales_field_records%rowtype;
  digest text;
  command text := 'sales_field.' || p_kind || '.' || p_action;
  item_id uuid;
  parent uuid;
  record_title text := nullif(btrim(p_data->>'title'),'');
  planned timestamptz;
  ending timestamptz;
  info jsonb := coalesce(p_data->'details','{}'::jsonb);
  start_status text;
  end_status text;
  allowed_parents text[];
  point jsonb := info->'location';
  coordinates jsonb;
  distance_metres double precision;
  geofence text;
begin
  if p_kind is null or p_kind not in ('site','contact','product','task','visit_plan','attendance_session','visit','equipment','quotation','financial_reference','demo','target')
    or p_action is null or p_action not in ('create','complete','reschedule','edit')
    or p_key is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>16000 then
    raise exception 'Invalid sales workspace command' using errcode='22023';
  end if;
  actor := private.staff_admin_actor(p_org,p_kind || case when p_action='create' then '.create' else '.update' end);
  if actor is null or private.staff_admin_actor(p_org,p_kind || '.read') is distinct from actor then
    raise exception 'Sales workspace access denied' using errcode='42501';
  end if;
  perform 1 from public.memberships where organization_id=p_org and id=actor and status='Active' for share;
  if not found then raise exception 'Sales workspace access denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || actor::text || ':' || p_key::text,0));
  digest := encode(sha256(convert_to(p_data::text,'UTF8')),'hex');
  select * into prior from private.operation_receipts
    where (organization_id,actor_membership_id,operation_key)=(p_org,actor,p_key);
  if found then
    if prior.command_type<>command or prior.request_hash<>digest then
      raise exception 'Request already used for another change' using errcode='22023';
    end if;
    return prior.response_snapshot;
  end if;
  allowed_parents := case p_kind when 'site' then array['account']
    when 'contact' then array['account']
    when 'equipment' then array['site']
    when 'quotation' then array['opportunity']
    when 'financial_reference' then array['opportunity']
    when 'demo' then array['opportunity','account']
    when 'task' then array['lead','account','opportunity']
    when 'visit' then array['site']
    when 'visit_plan' then array['site'] else array[]::text[] end;
  if jsonb_typeof(info) is distinct from 'object' then
    raise exception 'Record details must be an object' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_each(info) where key<>'location' and jsonb_typeof(value)<>'string') then
    raise exception 'Record fields must contain text values' using errcode='22023';
  end if;
  if nullif(info->>'next_due_at','') is not null and (
    info->>'next_due_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
    or not isfinite((info->>'next_due_at')::timestamptz)) then
    raise exception 'Provide a valid follow-up time' using errcode='22023';
  end if;
  if p_kind in ('attendance_session','visit') and p_action in ('create','complete') then
    if point is null then
      if coalesce(length(btrim(info->>'exception')),0) not between 3 and 500 then
        raise exception 'Capture GPS or enter an exception reason' using errcode='22023';
      end if;
    elsif jsonb_typeof(point) <> 'object'
      or jsonb_typeof(point->'lat') is distinct from 'number'
      or jsonb_typeof(point->'lon') is distinct from 'number'
      or jsonb_typeof(point->'accuracy') is distinct from 'number'
      or (point->>'lat')::numeric not between -90 and 90
      or (point->>'lon')::numeric not between -180 and 180
      or (point->>'accuracy')::numeric not between 0 and 100000 then
      raise exception 'Invalid location evidence' using errcode='22023';
    end if;
  end if;
  if p_action in ('create','edit') then
    if p_kind='product' and (coalesce(length(btrim(info->>'code')),0) not between 1 and 80
      or coalesce(length(btrim(info->>'category')),0) not between 1 and 120) then
      raise exception 'Provide a product code and category' using errcode='22023';
    elsif p_kind='site' and coalesce(length(btrim(info->>'address')),0) not between 1 and 500 then
      raise exception 'Provide the site address' using errcode='22023';
    elsif p_kind='site' and (nullif(info->>'latitude','') is not null or nullif(info->>'longitude','') is not null)
      and (coalesce(info->>'latitude','') !~ '^-?[0-9]{1,3}([.][0-9]{1,8})?$'
        or coalesce(info->>'longitude','') !~ '^-?[0-9]{1,3}([.][0-9]{1,8})?$'
        or (info->>'latitude')::numeric not between -90 and 90
        or (info->>'longitude')::numeric not between -180 and 180) then
      raise exception 'Provide valid latitude and longitude together' using errcode='22023';
    elsif p_kind='equipment' and (coalesce(length(btrim(info->>'manufacturer')),0) not between 1 and 120
      or coalesce(info->>'quantity','') !~ '^[1-9][0-9]{0,5}$') then
      raise exception 'Provide the manufacturer and quantity' using errcode='22023';
    elsif p_kind='quotation' and (coalesce(length(btrim(info->>'number')),0) not between 1 and 120
      or coalesce(info->>'revision','') !~ '^[1-9][0-9]{0,5}$'
      or coalesce(info->>'amount','') !~ '^(0|[1-9][0-9]{0,13})([.][0-9]{1,2})?$'
      or coalesce(length(btrim(info->>'source')),0) not between 1 and 120
      or nullif(info->>'valid_until','')::date is null or nullif(info->>'issued_on','')::date is null
      or (info->>'valid_until')::date < (info->>'issued_on')::date) then
      raise exception 'Provide the external quote number, revision, source, amount in INR and dates' using errcode='22023';
    elsif p_kind='financial_reference' and (coalesce(info->>'type','') not in ('Order','Invoice','Receipt')
      or coalesce(length(btrim(info->>'number')),0) not between 1 and 120
      or coalesce(length(btrim(info->>'source')),0) not between 1 and 120
      or coalesce(info->>'amount','') !~ '^(0|[1-9][0-9]{0,13})([.][0-9]{1,2})?$'
      or nullif(info->>'document_on','')::date is null) then
      raise exception 'Provide the type, external number, source, document date and amount in INR' using errcode='22023';
    elsif p_kind='target' and (coalesce(info->>'amount','') !~ '^(0|[1-9][0-9]{0,13})([.][0-9]{1,2})?$'
      or nullif(info->>'from_date','')::date is null or nullif(info->>'through_date','')::date is null
      or (info->>'through_date')::date < (info->>'from_date')::date) then
      raise exception 'Provide the target amount in INR and date range' using errcode='22023';
    end if;
  end if;
  if p_kind='visit' and p_action in ('create','complete') then
    select site.details into coordinates from private.sales_field_records site
    left join private.sales_field_records visit on visit.organization_id=site.organization_id and visit.parent_id=site.id
    where site.organization_id=p_org and site.kind='site'
      and (p_action='create' and site.id=nullif(p_data->>'parent_id','')::uuid
        or p_action='complete' and visit.id=nullif(p_data->>'id','')::uuid and visit.owner_id=actor);
    if point is not null and nullif(coordinates->>'latitude','') is not null and nullif(coordinates->>'longitude','') is not null then
      distance_metres := 12742000 * asin(least(1, sqrt(
        power(sin(radians(((point->>'lat')::double precision - (coordinates->>'latitude')::double precision)/2)),2)
          + cos(radians((coordinates->>'latitude')::double precision)) * cos(radians((point->>'lat')::double precision))
            * power(sin(radians(((point->>'lon')::double precision - (coordinates->>'longitude')::double precision)/2)),2)
      )));
    end if;
    geofence := case when point is null or coalesce((point->>'accuracy')::numeric,101)>100 then 'Unverified'
      when distance_metres is null then 'Site not geocoded'
      when distance_metres>200 then 'Outside site range' else 'Within site range' end;
    info := info || jsonb_build_object('site_distance_metres', round(distance_metres::numeric,1),'geofence',geofence);
  end if;
  if p_action='create' then
    parent := nullif(p_data->>'parent_id','')::uuid;
    if p_kind in ('site','contact','task','visit_plan','visit','equipment','quotation','financial_reference','demo') and parent is null then
      raise exception 'Select a related record' using errcode='22023';
    end if;
    if parent is not null and not private.sales_field_visible_parent(p_org,parent,actor,allowed_parents) then
      raise exception 'Related record unavailable' using errcode='42501';
    end if;
    planned := case when p_kind in ('attendance_session','visit') then now() else nullif(p_data->>'planned_at','')::timestamptz end;
    ending := case when p_kind='visit_plan' then nullif(p_data->>'ended_at','')::timestamptz end;
    if (p_kind in ('task','visit_plan') and (planned is null or not isfinite(planned)))
      or (p_kind='visit_plan' and (ending is null or not isfinite(ending) or ending<=planned))
      or record_title is null then
      raise exception 'Provide a title and valid schedule' using errcode='22023';
    end if;
    if p_kind='contact' and coalesce(nullif(btrim(info->>'phone'),''),nullif(btrim(info->>'email'),'')) is null then
      raise exception 'Provide phone or email' using errcode='22023';
    end if;
    start_status := case when p_kind in ('attendance_session','visit','task') then 'Open'
      when p_kind='visit_plan' then 'Planned'
      when p_kind in ('quotation','financial_reference') then 'Recorded'
      when p_kind='demo' then 'Logged' else 'Active' end;
    insert into public.resources(organization_id,resource_type,owner_membership_id)
      values(p_org,p_kind,actor) returning id into item_id;
    insert into private.sales_field_records(organization_id,id,kind,owner_id,parent_id,title,status,planned_at,ended_at,details)
      values(p_org,item_id,p_kind,actor,parent,record_title,start_status,planned,ending,info) returning * into existing;
  else
    item_id := (p_data->>'id')::uuid;
    select * into existing from private.sales_field_records where organization_id=p_org and id=item_id
      and kind=p_kind and owner_id=actor for update;
    if not found or not exists(select 1 from public.resources r where (r.organization_id,r.id)=(p_org,item_id) and r.archived_at is null)
      or (existing.parent_id is not null and not private.sales_field_visible_parent(p_org,existing.parent_id,actor,allowed_parents)) then
      raise exception 'Record unavailable' using errcode='42501';
    end if;
    if existing.version is distinct from (p_data->>'version')::int then
      raise exception 'Record has changed. Refresh to continue.' using errcode='40001';
    end if;
    if p_action='edit' and existing.status='Active' and p_kind in ('site','contact','product','equipment','target') then
      if record_title is null or (p_kind='contact' and coalesce(nullif(btrim(info->>'phone'),''),nullif(btrim(info->>'email'),'')) is null) then
        raise exception 'Provide the name and contact details' using errcode='22023';
      end if;
      update private.sales_field_records set title=record_title, details=info, version=version+1
        where organization_id=p_org and id=item_id returning * into existing;
    elsif p_action='reschedule' and existing.status in ('Open','Planned') and p_kind in ('task','visit_plan') then
      planned := (p_data->>'planned_at')::timestamptz;
      ending := case when p_kind='visit_plan' then (p_data->>'ended_at')::timestamptz end;
      if planned is null or not isfinite(planned) or coalesce(length(btrim(info->>'reason')),0) not between 3 and 500
        or (p_kind='visit_plan' and (ending is null or not isfinite(ending) or ending<=planned)) then
        raise exception 'Provide a new schedule and rescheduling reason' using errcode='22023';
      end if;
      info := info || jsonb_build_object('previous_planned_at',existing.planned_at,'previous_ended_at',existing.ended_at,
        'planned_at',planned,'ended_at',ending);
      update private.sales_field_records set planned_at=planned, ended_at=ending, version=version+1
        where organization_id=p_org and id=item_id returning * into existing;
    elsif p_action='complete' and existing.status in ('Open','Planned') then
      if p_kind in ('task','visit') and (coalesce(length(btrim(info->>'outcome')),0) not between 3 and 2000
        or coalesce(nullif(btrim(info->>'next_action'),''),nullif(btrim(info->>'no_action_reason'),'')) is null
        or (nullif(btrim(info->>'next_action'),'') is not null and nullif(info->>'next_due_at','') is null)) then
        raise exception 'Provide an outcome and a dated next action or reason' using errcode='22023';
      end if;
      end_status := case when p_kind in ('attendance_session','visit') and
        (nullif(existing.details->>'exception','') is not null or nullif(info->>'exception','') is not null
          or coalesce((existing.details->'location'->>'accuracy')::numeric,101)>100
          or coalesce((point->>'accuracy')::numeric,101)>100
          or (p_kind='visit' and (existing.details->>'geofence' is distinct from 'Within site range'
            or geofence is distinct from 'Within site range'))) then 'Pending Review' else 'Completed' end;
      update private.sales_field_records set status=end_status,
        ended_at=case when p_kind='visit_plan' then ended_at else now() end,
        details=details || jsonb_build_object('completion',info),version=version+1
        where organization_id=p_org and id=item_id returning * into existing;
    else
      raise exception 'This action is unavailable for the current record' using errcode='22023';
    end if;
  end if;
  insert into private.sales_field_events(organization_id,record_id,version,actor_id,event_type,details)
    values(p_org,item_id,existing.version,actor,p_action,info);
  insert into private.audit_events(organization_id,actor_membership_id,resource_id,action,request_id,redacted_details)
    values(p_org,actor,item_id,command,p_key,jsonb_build_object('version',existing.version,'status',existing.status));
  result := jsonb_build_object('id',item_id,'version',existing.version);
  insert into private.operation_receipts(organization_id,actor_membership_id,operation_key,command_type,request_hash,response_snapshot)
    values(p_org,actor,p_key,command,digest,result);
  return result;
end
$$;
revoke all on function private.run_sales_field(uuid,text,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function private.run_sales_field(uuid,text,text,uuid,jsonb) to authenticated;
create function public.run_sales_field(p_org uuid,p_kind text,p_action text,p_key uuid,p_data jsonb) returns jsonb
language sql security invoker set search_path=pg_catalog as $$
  select private.run_sales_field(p_org,p_kind,p_action,p_key,p_data)
$$;
revoke all on function public.run_sales_field(uuid,text,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.run_sales_field(uuid,text,text,uuid,jsonb) to authenticated;
