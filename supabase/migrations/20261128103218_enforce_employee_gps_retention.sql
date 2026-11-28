-- Keep precise employee coordinates in an expiring store. Field records and
-- immutable history retain the event, evidence verdict, accuracy and review.
create table private.employee_gps_evidence (
  organization_id uuid not null,
  record_id uuid not null,
  event_kind text not null check (event_kind in ('start','end')),
  latitude numeric not null check (latitude between -90 and 90),
  longitude numeric not null check (longitude between -180 and 180),
  expires_at timestamptz not null,
  primary key (organization_id,record_id,event_kind),
  foreign key (organization_id,record_id) references private.sales_field_records(organization_id,id)
    deferrable initially deferred
);
alter table private.employee_gps_evidence enable row level security;
revoke all on private.employee_gps_evidence from public,anon,authenticated,service_role;
create index employee_gps_evidence_expiry on private.employee_gps_evidence(expires_at);

create function private.field_gps_summary(details jsonb) returns jsonb
language sql immutable set search_path=pg_catalog as $$
  select details #- '{location,lat}' #- '{location,lon}'
    #- '{completion,location,lat}' #- '{completion,location,lon}'
    #- '{start_evidence,raw}' #- '{end_evidence,raw}'
$$;

-- Copy only unexpired points using the authoritative server event timestamps.
insert into private.employee_gps_evidence(organization_id,record_id,event_kind,latitude,longitude,expires_at)
select r.organization_id,r.id,e.event_kind,(e.point->>'lat')::numeric,(e.point->>'lon')::numeric,
  e.received_at+interval '2160 hours'
from private.sales_field_records r cross join lateral (values
  ('start',coalesce(r.details#>'{start_evidence,raw}',r.details->'location'),r.planned_at),
  ('end',coalesce(r.details#>'{end_evidence,raw}',r.details#>'{completion,location}'),r.ended_at)
) e(event_kind,point,received_at)
where r.kind in ('attendance_session','visit') and e.received_at+interval '2160 hours'>now()
  and jsonb_typeof(e.point->'lat')='number' and jsonb_typeof(e.point->'lon')='number';

update private.sales_field_records
set details=private.field_gps_summary(details)
where kind in ('attendance_session','visit') and details is distinct from private.field_gps_summary(details);

-- Remove duplicate legacy coordinates only. The event rows, versions and all
-- other payload fields survive this one-time, transaction-scoped redaction.
alter table private.sales_field_events disable trigger sales_field_events_immutable;
update private.sales_field_events e
set details=private.field_gps_summary(e.details)
from private.sales_field_records r
where (r.organization_id,r.id)=(e.organization_id,e.record_id) and r.kind in ('attendance_session','visit')
  and e.details is distinct from private.field_gps_summary(e.details);
alter table private.sales_field_events enable trigger sales_field_events_immutable;

create function private.store_employee_gps() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare evidence record;
begin
  for evidence in select * from (values
    ('start',new.details#>'{start_evidence,raw}',new.planned_at),
    ('end',new.details#>'{end_evidence,raw}',new.ended_at)
  ) e(event_kind,point,received_at)
  where jsonb_typeof(e.point->'lat')='number' and jsonb_typeof(e.point->'lon')='number'
    and e.received_at+interval '2160 hours'>now()
  loop
    insert into private.employee_gps_evidence(organization_id,record_id,event_kind,latitude,longitude,expires_at)
    values(new.organization_id,new.id,evidence.event_kind,(evidence.point->>'lat')::numeric,
      (evidence.point->>'lon')::numeric,evidence.received_at+interval '2160 hours');
  end loop;
  new.details:=private.field_gps_summary(new.details);
  return new;
end
$$;
create trigger retain_employee_gps before insert or update of details on private.sales_field_records
  for each row when (new.kind in ('attendance_session','visit')) execute function private.store_employee_gps();

create function private.expire_employee_gps() returns bigint
language plpgsql set search_path=pg_catalog as $$
declare removed bigint;
begin
  delete from private.employee_gps_evidence where expires_at<=statement_timestamp();
  get diagnostics removed=row_count;
  return removed;
end
$$;
revoke all on function private.field_gps_summary(jsonb),private.store_employee_gps(),private.expire_employee_gps()
  from public,anon,authenticated,service_role;

-- The embedded unit-test database has no server extensions. Hosted and local
-- Supabase have pg_cron and must show an active job before releasing the UI.
do $$
begin
  if exists(select 1 from pg_available_extensions where name='pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('avi-employee-gps-expiry','* * * * *','select private.expire_employee_gps();');
  end if;
end
$$;
