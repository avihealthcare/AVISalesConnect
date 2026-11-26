-- All financial state is private. The workspace and command wrappers are the API.
create table private.expense_staff_grades (
  organization_id uuid not null,
  membership_id uuid not null,
  grade text not null check (grade ~ '^[A-Z][A-Z0-9_-]{0,30}$'),
  primary key (organization_id,membership_id),
  foreign key (organization_id,membership_id) references public.memberships(organization_id,id)
);
create table private.expense_records (
  organization_id uuid not null,
  id uuid not null,
  owner_id uuid not null,
  kind text not null check (kind in ('travel','claim')),
  status text not null default 'Draft' check (status in (
    'Draft','Pending Routing','Submitted','Approved','Returned','Rejected','Cancelled','Closed',
    'Manager Approved','Finance Review','Approved for Payment','Partly Reimbursed','Reimbursed')),
  revision integer not null default 1 check (revision>0),
  version integer not null default 0 check (version>=0),
  draft jsonb not null check (jsonb_typeof(draft)='object'),
  approver_id uuid,
  manager_id uuid,
  finance_id uuid,
  route_policy_id uuid,
  routing_stage text check (routing_stage in ('travel','manager','finance')),
  claimed numeric(20,2) not null default 0 check (claimed>=0),
  allowed numeric(20,2) not null default 0 check (allowed between 0 and claimed),
  updated_at timestamptz not null default now(),
  primary key (organization_id,id),
  foreign key (organization_id,id) references public.resources(organization_id,id),
  foreign key (organization_id,owner_id) references public.memberships(organization_id,id),
  foreign key (organization_id,approver_id) references public.memberships(organization_id,id),
  foreign key (organization_id,manager_id) references public.memberships(organization_id,id),
  foreign key (organization_id,finance_id) references public.memberships(organization_id,id),
  foreign key (organization_id,route_policy_id) references private.operating_policy_versions(organization_id,id),
  check (owner_id is distinct from approver_id and owner_id is distinct from manager_id and owner_id is distinct from finance_id),
  check (manager_id is null or finance_id is null or manager_id<>finance_id)
);
create index expense_records_owner_idx on private.expense_records(organization_id,owner_id,updated_at desc);
create index expense_records_approver_idx on private.expense_records(organization_id,approver_id,updated_at desc) where approver_id is not null;
create index expense_records_finance_idx on private.expense_records(organization_id,finance_id,updated_at desc) where finance_id is not null;
create table private.expense_versions (
  organization_id uuid not null,
  record_id uuid not null,
  version integer not null check (version>0),
  route_policy_id uuid,
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object'),
  submitted_at timestamptz not null default now(),
  snapshot_hash text not null check (snapshot_hash ~ '^[a-f0-9]{64}$'),
  primary key (organization_id,record_id,version),
  foreign key (organization_id,record_id) references private.expense_records(organization_id,id),
  foreign key (organization_id,route_policy_id) references private.operating_policy_versions(organization_id,id)
);
create table private.expense_submitted_lines (
  organization_id uuid not null,
  record_id uuid not null,
  version integer not null,
  line_id uuid not null,
  line_number integer not null check (line_number>0),
  policy_id uuid not null,
  category text not null,
  service_on date not null,
  purpose text,
  vendor text,
  reference text,
  cost_center text,
  mileage numeric(12,3),
  rate numeric(18,2),
  claimed numeric(18,2) not null check (claimed>=0),
  allowance numeric(18,2) not null check (allowance between 0 and claimed),
  receipt_id uuid references private.file_upload_stages(id),
  possible_duplicate boolean not null,
  primary key (organization_id,record_id,version,line_id),
  unique (organization_id,record_id,version,line_number),
  foreign key (organization_id,record_id,version)
    references private.expense_versions(organization_id,record_id,version),
  foreign key (organization_id,policy_id) references private.operating_policy_versions(organization_id,id)
);
create table private.expense_finance_lines (
  organization_id uuid not null,
  record_id uuid not null,
  version integer not null,
  line_id uuid not null,
  amount numeric(18,2) not null check (amount>=0),
  actor_id uuid not null,
  decided_at timestamptz not null default now(),
  primary key (organization_id,record_id,version,line_id),
  foreign key (organization_id,record_id,version,line_id)
    references private.expense_submitted_lines(organization_id,record_id,version,line_id),
  foreign key (organization_id,actor_id) references public.memberships(organization_id,id)
);
create table private.expense_movements (
  organization_id uuid not null,
  record_id uuid not null,
  id uuid not null default gen_random_uuid(),
  actor_id uuid not null,
  kind text not null check (kind in ('advance','advance_issue','advance_return','reimbursement','reversal')),
  amount numeric(20,2) not null check (amount>0),
  payment_date date not null check (isfinite(payment_date)),
  reference text not null check (char_length(reference) between 1 and 120),
  evidence_id uuid not null references private.file_upload_stages(id),
  reason text check (char_length(reason) between 1 and 500),
  reverses_id uuid,
  travel_id uuid,
  version integer not null check (version>0),
  created_at timestamptz not null default now(),
  primary key (organization_id,record_id,id),
  unique (organization_id,reverses_id),
  foreign key (organization_id,record_id,version) references private.expense_versions(organization_id,record_id,version),
  foreign key (organization_id,travel_id) references private.expense_records(organization_id,id),
  foreign key (organization_id,actor_id) references public.memberships(organization_id,id),
  foreign key (organization_id,record_id,reverses_id) references private.expense_movements(organization_id,record_id,id),
  check ((kind='reversal')=(reverses_id is not null)),
  check (kind<>'reversal' or reason is not null),
  check (kind not in ('advance','advance_issue','advance_return') or travel_id is not null)
);
create index expense_movement_trip_idx on private.expense_movements(organization_id,travel_id) where travel_id is not null;
create unique index expense_movement_reference_idx on private.expense_movements(organization_id,lower(reference));
alter table private.expense_staff_grades enable row level security;
alter table private.expense_records enable row level security;
alter table private.expense_versions enable row level security;
alter table private.expense_movements enable row level security;
alter table private.expense_submitted_lines enable row level security;
alter table private.expense_finance_lines enable row level security;
revoke all on private.expense_staff_grades,private.expense_records,private.expense_versions,private.expense_movements,
  private.expense_submitted_lines,private.expense_finance_lines from public,anon,authenticated;
create trigger expense_versions_append_only before update or delete or truncate on private.expense_versions
  for each statement execute function private.reject_mutation();
create trigger expense_submitted_lines_append_only before update or delete or truncate on private.expense_submitted_lines
  for each statement execute function private.reject_mutation();
create trigger expense_finance_lines_append_only before update or delete or truncate on private.expense_finance_lines
  for each statement execute function private.reject_mutation();
create trigger expense_movements_append_only before update or delete or truncate on private.expense_movements
  for each statement execute function private.reject_mutation();

create function private.expense_actor(p_org uuid) returns uuid
language sql stable set search_path=pg_catalog as $$
  select m.id
  from public.memberships m
  join auth.sessions s on s.user_id=m.user_id and s.id=nullif(auth.jwt()->>'session_id','')::uuid
  where m.organization_id=p_org and m.user_id=auth.uid() and m.status='Active'
    and (s.not_after is null or s.not_after>now())
$$;

create function private.expense_policy(p_org uuid,p_day date) returns private.operating_policy_versions
language sql stable set search_path=pg_catalog as $$
  select v.* from private.operating_policy_versions v
  where v.organization_id=p_org and v.section='expense' and v.effective_on<=p_day
  order by v.effective_on desc,v.revision desc limit 1
$$;

create function private.expense_route(p_org uuid,p_policy uuid,p_process text,p_owner uuid,p_exclude uuid,p_amount numeric)
returns uuid language sql stable set search_path=pg_catalog as $$
  select m.id
  from private.operating_policy_versions v
  cross join lateral (
    select rule
    from jsonb_array_elements(v.settings->'routes') as rules(rule)
    where rule->>'process'=p_process and (rule->>'subject' is null or (rule->>'subject')::uuid=p_owner)
    order by (rule->>'subject' is not null) desc limit 1
  ) chosen
  cross join lateral (values (1,(chosen.rule->>'primary')::uuid),(2,(chosen.rule->>'alternate')::uuid)) candidate(priority,id)
  join public.memberships m on m.organization_id=p_org and m.id=candidate.id and m.status='Active'
  where v.organization_id=p_org and v.id=p_policy and v.section='expense'
    and m.id<>p_owner and m.id is distinct from p_exclude
    and (chosen.rule->>'limit' is null or p_amount<=(chosen.rule->>'limit')::numeric)
  order by candidate.priority limit 1
$$;

create function private.expense_money(p_value text,p_label text) returns numeric
language plpgsql immutable set search_path=pg_catalog as $$
begin
  if p_value is null or p_value !~ '^(0|[1-9][0-9]{0,13})([.][0-9]{1,2})?$' then
    raise exception 'Enter a valid % with up to two decimal places',p_label using errcode='22023';
  end if;
  return p_value::numeric;
end
$$;

create function private.expense_document(p_org uuid,p_record uuid,p_stage uuid) returns text
language sql stable set search_path=pg_catalog as $$
  select f.sha256 from private.file_upload_stages s join private.file_upload_objects f on f.stage_id=s.id
  where s.organization_id=p_org and s.parent_resource_id=p_record and s.id=p_stage
    and s.purpose in ('receipt','business_document') and f.verdict='clean'
$$;

create function private.expense_travel_draft(p_data jsonb) returns jsonb
language plpgsql immutable set search_path=pg_catalog as $$
declare
  starts date := (p_data->>'starts')::date;
  ends date := (p_data->>'ends')::date;
  title text := btrim(p_data->>'title');
  geography text := upper(btrim(p_data->>'geography'));
  travel_type text := upper(btrim(p_data->>'travel_type'));
  purpose text := btrim(p_data->>'purpose');
  estimated numeric := private.expense_money(p_data->>'estimated','travel estimate');
  requested_advance numeric := private.expense_money(coalesce(nullif(p_data->>'requested_advance',''),'0'),'requested advance');
begin
  if starts is null or ends is null or not isfinite(starts) or not isfinite(ends) or ends<starts
    or coalesce(length(title),0) not between 1 and 120 or coalesce(length(purpose),0) not between 1 and 500
    or coalesce(geography,'') !~ '^[A-Z][A-Z0-9_-]{0,30}$'
    or coalesce(travel_type,'') !~ '^[A-Z][A-Z0-9_-]{0,30}$'
    or length(coalesce(p_data->>'retrospective_reason',''))>500 or requested_advance>estimated then
    raise exception 'Enter travel dates, purpose, geography and travel type' using errcode='22023';
  end if;
  return jsonb_build_object('title',title,'starts',starts,'ends',ends,'purpose',purpose,
    'geography',geography,'travel_type',travel_type,'estimated',estimated,'requested_advance',requested_advance,
    'retrospective_reason',nullif(btrim(p_data->>'retrospective_reason'),''));
end
$$;

create function private.expense_claim_draft(p_data jsonb,p_previous jsonb) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare
  line jsonb;
  lines jsonb := '[]'::jsonb;
  title text := btrim(p_data->>'title');
  line_id uuid;
begin
  if coalesce(length(title),0) not between 1 and 120 or jsonb_typeof(p_data->'lines') is distinct from 'array'
     or jsonb_array_length(p_data->'lines')>100 then
    raise exception 'Enter a claim title and up to 100 expense lines' using errcode='22023';
  end if;
  for line in select value from jsonb_array_elements(p_data->'lines') loop
    if jsonb_typeof(line) <> 'object' then raise exception 'Invalid expense line' using errcode='22023'; end if;
    line_id := nullif(line->>'id','')::uuid;
    if line_id is null then
      line_id := gen_random_uuid();
    elsif not exists (select 1 from jsonb_array_elements(p_previous->'lines') where value->>'id'=line_id::text) then
      raise exception 'Invalid expense line identity' using errcode='22023';
    end if;
    if exists (select 1 from jsonb_array_elements(lines) where value->>'id'=line_id::text) then
      raise exception 'Expense lines must be distinct' using errcode='22023';
    end if;
    lines := lines || jsonb_build_array(jsonb_build_object(
      'id',line_id,'category',upper(btrim(line->>'category')),'service_on',line->>'service_on','vendor',btrim(line->>'vendor'),
      'purpose',btrim(line->>'purpose'),'reference',btrim(line->>'reference'),'cost_center',upper(btrim(line->>'cost_center')),
      'amount',line->>'amount','mileage',nullif(line->>'mileage',''),'days',nullif(line->>'days',''),
      'geography',upper(btrim(line->>'geography')),'travel_type',upper(btrim(line->>'travel_type')),
      'receipt_id',nullif(line->>'receipt_id','')::uuid,'exception_reason',nullif(btrim(line->>'exception_reason'),'')
    ));
  end loop;
  return jsonb_build_object('title',title,'travel_id',nullif(p_data->>'travel_id','')::uuid,'lines',lines);
end
$$;

create function private.expense_calculate(p_record private.expense_records,p_today date) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare
  v_grade text;
  v_line jsonb;
  v_line_no int := 0;
  v_policy private.operating_policy_versions;
  v_travel private.expense_records;
  v_rule jsonb;
  v_day date;
  v_claimed numeric;
  v_allowed numeric;
  v_units numeric;
  v_receipt_hash text;
  v_dupe bool;
  v_total_claimed numeric := 0;
  v_total_allowed numeric := 0;
  v_result jsonb := '[]'::jsonb;
begin
  select grade into v_grade from private.expense_staff_grades
    where organization_id=p_record.organization_id and membership_id=p_record.owner_id;
  if p_record.draft->>'travel_id' is not null then
    select * into v_travel from private.expense_records
    where organization_id=p_record.organization_id and id=(p_record.draft->>'travel_id')::uuid
      and owner_id=p_record.owner_id and kind='travel' and status in ('Approved','Closed')
    for share;
    if not found then raise exception 'Choose approved travel for this claim' using errcode='22023'; end if;
  end if;
  if jsonb_array_length(p_record.draft->'lines')=0 then
    raise exception 'Add at least one expense line' using errcode='22023';
  end if;
  for v_line in select value from jsonb_array_elements(p_record.draft->'lines') loop
    v_line_no := v_line_no+1;
    v_day := (v_line->>'service_on')::date;
    if v_day is null or not isfinite(v_day)
       or coalesce(v_line->>'category','') !~ '^[A-Z][A-Z0-9_-]{0,30}$'
       or coalesce(v_line->>'geography','') !~ '^[A-Z][A-Z0-9_-]{0,30}$'
       or coalesce(v_line->>'travel_type','') !~ '^[A-Z][A-Z0-9_-]{0,30}$'
       or coalesce(length(v_line->>'vendor'),0)>120 or coalesce(length(v_line->>'exception_reason'),0)>500
       or coalesce(length(v_line->>'purpose'),0)>300 or coalesce(length(v_line->>'reference'),0)>120
       or coalesce(length(v_line->>'cost_center'),0)>60 then
      raise exception 'Line % needs a service date, category, geography and travel type',v_line_no using errcode='22023';
    end if;
    if v_travel.id is not null and (
      v_day not between (v_travel.draft->>'starts')::date and (v_travel.draft->>'ends')::date
      or v_line->>'geography'<>v_travel.draft->>'geography'
      or v_line->>'travel_type'<>v_travel.draft->>'travel_type') then
      raise exception 'Line % falls outside the approved travel dates or scope',v_line_no using errcode='22023';
    end if;
    v_policy := private.expense_policy(p_record.organization_id,v_day);
    select elem into v_rule from jsonb_array_elements(v_policy.settings->'rules') as rules(elem)
    where elem->>'category'=v_line->>'category'
      and (elem->>'grade'='*' or elem->>'grade'=v_grade)
      and (elem->>'geography'='*' or elem->>'geography'=v_line->>'geography')
      and (elem->>'travel_type'='*' or elem->>'travel_type'=v_line->>'travel_type')
    order by ((elem->>'grade'<>'*')::int+(elem->>'geography'<>'*')::int+(elem->>'travel_type'<>'*')::int) desc
    limit 1;
    if v_rule is null then raise exception 'No effective policy matches expense line %',v_line_no using errcode='22023'; end if;
    if v_day>p_today and not (v_rule->>'prepayment_allowed')::bool then
      raise exception 'Policy does not allow prepayment for line %',v_line_no using errcode='22023';
    end if;
    if v_travel.id is null and (v_rule->>'travel_approval_required')::bool then
      raise exception 'Policy requires approved travel for line %',v_line_no using errcode='22023';
    end if;
    if v_rule->>'calculation'='actual' then
      v_claimed := private.expense_money(v_line->>'amount','actual amount');
    elsif v_rule->>'calculation'='mileage' then
      if coalesce(v_line->>'mileage','') !~ '^(0|[1-9][0-9]{0,8})([.][0-9]{1,3})?$'
        or (v_line->>'mileage')::numeric<=0 then
        raise exception 'Enter positive kilometres with up to three decimal places for line %',v_line_no using errcode='22023';
      end if;
      v_units := (v_line->>'mileage')::numeric;
      v_claimed := round(v_units*(v_rule->>'rate')::numeric,2);
    else
      v_units := private.expense_money(v_line->>'days','day fraction');
      if v_units<>1 and not (v_units=0.5 and v_rule->>'partial_day'='half') then
        raise exception 'Enter a day fraction covered by the policy for line %',v_line_no using errcode='22023';
      end if;
      v_claimed := round(v_units*(v_rule->>'rate')::numeric,2);
    end if;
    if v_claimed>=100000000000000 then raise exception 'Line % exceeds the supported amount',v_line_no using errcode='22023'; end if;
    v_allowed := least(v_claimed,(v_rule->>'cap')::numeric);
    v_receipt_hash := private.expense_document(p_record.organization_id,p_record.id,(v_line->>'receipt_id')::uuid);
    if v_line->>'receipt_id' is not null and v_receipt_hash is null then
      raise exception 'Line % needs a clean scanned receipt from this claim',v_line_no using errcode='22023';
    end if;
    if v_receipt_hash is null and v_claimed>=(v_rule->>'receipt_threshold')::numeric
      and not ((v_rule->>'exception_allowed')::bool and v_line->>'exception_reason' is not null) then
      raise exception 'Policy requires a receipt for line %',v_line_no using errcode='22023';
    end if;
    select exists (
      select 1 from (
        select previous.value as prior from jsonb_array_elements(v_result) previous(value)
        union all
        select previous.value from private.expense_records r
          join private.expense_versions s on (s.organization_id,s.record_id,s.version)=(r.organization_id,r.id,r.version)
          cross join lateral jsonb_array_elements(s.snapshot->'lines') previous(value)
        where r.organization_id=p_record.organization_id and r.owner_id=p_record.owner_id and r.id<>p_record.id
          and r.kind='claim' and r.status not in ('Rejected','Cancelled')
      ) visible
      where prior->>'receipt_hash'=v_receipt_hash
        or (coalesce(v_line->>'reference','')<>'' and lower(prior->>'reference')=lower(v_line->>'reference')
            and lower(prior->>'vendor')=lower(v_line->>'vendor'))
        or (coalesce(v_line->>'vendor','')<>'' and lower(prior->>'vendor')=lower(v_line->>'vendor')
        and prior->>'service_on'=v_line->>'service_on' and (prior->>'claimed')::numeric=v_claimed)
    ) into v_dupe;
    v_total_claimed := v_total_claimed+v_claimed;
    v_total_allowed := v_total_allowed+v_allowed;
    v_result := v_result || jsonb_build_array(v_line || jsonb_build_object(
      'number',v_line_no,'policy_id',v_policy.id,'rule',v_rule,'claimed',v_claimed,'allowed',v_allowed,
      'receipt_hash',v_receipt_hash,'possible_duplicate',v_dupe,'exception_requested',v_receipt_hash is null
        and coalesce(v_claimed>=(v_rule->>'receipt_threshold')::numeric,false)));
  end loop;
  return (p_record.draft - 'lines') || jsonb_build_object(
    'lines',v_result,'claimed',v_total_claimed,'allowed',v_total_allowed,'grade',v_grade,
    'travel_version',v_travel.version);
end
$$;

create function private.expense_paid(p_org uuid,p_record uuid) returns numeric
language sql stable set search_path=pg_catalog as $$
  select coalesce(sum(case when kind='reversal' then -amount else amount end),0)
  from private.expense_movements where organization_id=p_org and record_id=p_record
    and kind in ('advance','reimbursement','reversal')
$$;

create function private.expense_advance_totals(p_org uuid,p_travel uuid)
returns table(issued numeric,unused numeric) language sql stable set search_path=pg_catalog as $$
  select coalesce(sum(case when m.kind='advance_issue' then m.amount
    when m.kind='advance_return' then -m.amount else 0 end),0),
    coalesce(sum(case when m.kind in ('advance_issue','reversal') then m.amount else -m.amount end),0)
  from private.expense_movements m where m.organization_id=p_org and m.travel_id=p_travel
    and m.kind in ('advance_issue','advance','advance_return','reversal')
$$;

create function private.expense_attachment_allowed(p_org uuid,p_record uuid,p_actor uuid,p_write boolean) returns boolean
language sql stable set search_path=pg_catalog as $$
  select exists (
    select 1 from private.expense_records r
    where r.organization_id=p_org and r.id=p_record and (
      case when p_write then
        (r.owner_id=p_actor and r.status in ('Draft','Returned'))
        or (r.finance_id=p_actor and (
          (r.kind='claim' and r.status in ('Approved for Payment','Partly Reimbursed','Reimbursed'))
          or (r.kind='travel' and r.status in ('Approved','Closed'))
        ))
      else p_actor in (r.owner_id,r.approver_id,r.manager_id,r.finance_id)
      end
    )
  )
$$;

create function private.read_expense_workspace(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid := private.expense_actor(p_org);
begin
  if actor is null then raise exception 'Expense workspace access denied' using errcode='42501'; end if;
  return (
    select jsonb_build_object(
      'today',(now() at time zone o.timezone)::date,'currency',o.base_currency,
      'grade_directory',case when private.policy_settings_actor(p_org)=actor then coalesce((
        select jsonb_agg(jsonb_build_object('id',m.id,'name',p.display_name,'grade',g.grade) order by p.display_name,m.id)
          from public.memberships m join public.profiles p on p.id=m.user_id
          left join private.expense_staff_grades g on (g.organization_id,g.membership_id)=(m.organization_id,m.id)
          where m.organization_id=p_org and m.status='Active'
      ),'[]'::jsonb) end,
      'records',coalesce((select jsonb_agg(to_jsonb(record) order by record.updated_at desc,record.id)
        from (
          select r.id,r.kind,r.status,r.revision,r.version,r.owner_id,r.approver_id,r.manager_id,r.finance_id,
            r.routing_stage,r.draft,r.claimed,r.allowed,r.updated_at,p.display_name as owner_name,
            (select unused from private.expense_advance_totals(r.organization_id,case when r.kind='travel' then r.id
              else (r.draft->>'travel_id')::uuid end)) as unused_advance,
            paid.total as paid,case when r.status in ('Approved for Payment','Partly Reimbursed','Reimbursed') then
              r.allowed-paid.total else 0 end as outstanding,
            coalesce((select jsonb_agg(to_jsonb(s)-'organization_id' order by s.version desc)
              from private.expense_versions s where (s.organization_id,s.record_id)=(r.organization_id,r.id)), '[]'::jsonb) as versions,
            coalesce((select jsonb_agg(jsonb_build_object('id',l.line_id,'amount',l.amount) order by l.line_id)
              from private.expense_finance_lines l
              where (l.organization_id,l.record_id,l.version)=(r.organization_id,r.id,r.version)), '[]'::jsonb) as final_allowances,
            coalesce((select jsonb_agg(jsonb_build_object('action',a.action,'at',a.occurred_at,'version',a.redacted_details->'version',
                'reason',a.redacted_details->'reason') order by a.occurred_at desc)
              from private.audit_events a where (a.organization_id,a.resource_id)=(r.organization_id,r.id)
                and a.action in ('expense.approve','expense.return','expense.reject','expense.finance_approve',
                  'expense.submit','expense.reroute','expense.cancel','expense.advance','expense.reimburse','expense.reverse')), '[]'::jsonb) as decisions,
            coalesce((select jsonb_agg(to_jsonb(m)-'organization_id' order by m.created_at desc,m.id)
              from private.expense_movements m where (m.organization_id,m.record_id)=(r.organization_id,r.id)), '[]'::jsonb) as movements,
            coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.original_name,'purpose',f.purpose,
              'status',case when obj.verdict='clean' then 'Available' when obj.verdict='rejected' then 'Rejected'
                when obj.stored_at is not null then 'Awaiting scan' else 'Pending upload' end) order by f.created_at desc)
               from private.file_upload_stages f left join private.file_upload_objects obj on obj.stage_id=f.id
               where (f.organization_id,f.parent_resource_id)=(r.organization_id,r.id)), '[]'::jsonb) as files
          from private.expense_records r join public.memberships m on (m.organization_id,m.id)=(r.organization_id,r.owner_id)
          left join public.profiles p on p.id=m.user_id
          cross join lateral (select private.expense_paid(r.organization_id,r.id) as total) paid
          where r.organization_id=p_org and actor in (r.owner_id,r.approver_id,r.manager_id,r.finance_id)
          order by r.updated_at desc,r.id limit 100
        ) record),'[]'::jsonb)
    ) from public.organizations o where o.id=p_org
  );
end
$$;

create function private.run_expense_command(p_org uuid,p_action text,p_key uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  actor uuid := private.expense_actor(p_org);
  record private.expense_records;
  travel private.expense_records;
  original private.expense_movements;
  prior private.operation_receipts;
  policy private.operating_policy_versions;
  frozen jsonb;
  review_line jsonb;
  settlements jsonb;
  amount numeric;
  paid numeric;
  previously_issued numeric;
  available_advance numeric;
  movement_travel_id uuid;
  stage_id uuid;
  payment_date date;
  reference text;
  action_reason text;
  payload_hash text;
  result jsonb;
  resource_id_out uuid;
  day_today date;
  v_grade text;
  subject_id uuid;
  line_no integer;
  line_amount numeric;
begin
  if actor is null then raise exception 'Expense command access denied' using errcode='42501'; end if;
  if p_key is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>65536
    or p_action is null or p_action not in (
      'export_csv','create_travel','create_claim','set_grade','edit','revise_travel','submit','reroute','approve','return','reject','cancel','close','start_finance',
      'finance_approve','issue_advance','return_advance','advance','reimburse','reverse') then
    raise exception 'Invalid expense command' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || actor::text || p_key::text,0));
  payload_hash := encode(sha256(convert_to(jsonb_build_array(p_action,p_payload)::text,'UTF8')),'hex');
  select * into prior from private.operation_receipts
    where organization_id=p_org and actor_membership_id=actor and operation_key=p_key;
  if found then
    if prior.command_type<>'expense.' || p_action or prior.request_hash<>payload_hash then
      raise exception 'This request key is already in use' using errcode='23505';
    end if;
    if p_action<>'export_csv' then return prior.response_snapshot; end if;
  end if;
  select (now() at time zone timezone)::date into day_today from public.organizations where id=p_org;
  action_reason := nullif(btrim(p_payload->>'reason'),'');
  if char_length(action_reason)>500 then raise exception 'Keep the reason within 500 characters' using errcode='22023'; end if;

  if p_action='export_csv' then
    if not exists (select 1 from private.expense_records where organization_id=p_org and finance_id=actor and kind='claim') then
      raise exception 'Finance export access denied' using errcode='42501';
    end if;
    select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(export) order by export.claim,export.line_number),'[]'::jsonb)) into result
    from (
      select r.id as claim,r.version,l.line_id,l.line_number,l.category,l.cost_center,l.reference as line_reference,
        l.service_on,o.base_currency as currency,l.claimed,fl.amount as allowed,
        r.status,p.display_name as employee,r.draft->>'title' as title,ledger.advance_applied,ledger.reimbursed,
        r.allowed-ledger.advance_applied-ledger.reimbursed as outstanding,ledger.payment_references
      from private.expense_records r
      join private.expense_submitted_lines l on (l.organization_id,l.record_id,l.version)=(r.organization_id,r.id,r.version)
      join private.expense_finance_lines fl on (fl.organization_id,fl.record_id,fl.version,fl.line_id)=(l.organization_id,l.record_id,l.version,l.line_id)
      join public.organizations o on o.id=r.organization_id
      join public.memberships m on (m.organization_id,m.id)=(r.organization_id,r.owner_id)
      left join public.profiles p on p.id=m.user_id
      cross join lateral (
        select coalesce(sum(mv.amount) filter(where mv.kind='advance'),0) as advance_applied,
          coalesce(sum(mv.amount) filter(where mv.kind='reimbursement'),0) as reimbursed,
          coalesce(string_agg(mv.reference,', ' order by mv.created_at),'') as payment_references
        from private.expense_movements mv
        where (mv.organization_id,mv.record_id)=(r.organization_id,r.id) and mv.kind in ('advance','reimbursement')
          and not exists (select 1 from private.expense_movements rev where rev.organization_id=p_org and rev.reverses_id=mv.id)
      ) ledger
      where r.organization_id=p_org and r.finance_id=actor and r.kind='claim'
      order by r.id,l.line_number limit 10000
    ) export;
    if prior.id is null then
      insert into private.audit_events(organization_id,actor_membership_id,action,request_id,redacted_details)
        values(p_org,actor,'expense.export_csv',p_key,jsonb_build_object('line_count',jsonb_array_length(result->'rows')));
      insert into private.operation_receipts(organization_id,actor_membership_id,operation_key,command_type,request_hash,response_snapshot)
        values(p_org,actor,p_key,'expense.export_csv',payload_hash,'{}'::jsonb);
    end if;
    return result;
  elsif p_action='set_grade' then
    if private.policy_settings_actor(p_org) is distinct from actor then
      raise exception 'Grade administration access denied' using errcode='42501';
    end if;
    subject_id := (p_payload->>'membership')::uuid;
    v_grade := nullif(upper(btrim(p_payload->>'grade')),'');
    if not exists (select 1 from public.memberships where organization_id=p_org and id=subject_id and status='Active')
       or (v_grade is not null and v_grade !~ '^[A-Z][A-Z0-9_-]{0,30}$') then
      raise exception 'Choose an active staff member and a valid grade' using errcode='22023';
    end if;
    if v_grade is null then
      delete from private.expense_staff_grades where organization_id=p_org and membership_id=subject_id;
    else
      insert into private.expense_staff_grades values(p_org,subject_id,v_grade)
      on conflict (organization_id,membership_id) do update set grade=excluded.grade;
    end if;
    result := jsonb_build_object('membership',subject_id,'grade',v_grade);
  elsif p_action in ('create_travel','create_claim') then
    insert into public.resources(organization_id,resource_type,owner_membership_id)
      values(p_org,case when p_action='create_travel' then 'travel_request' else 'expense_claim' end,actor)
      returning id into resource_id_out;
    insert into private.expense_records(organization_id,id,owner_id,kind,draft)
      values(p_org,resource_id_out,actor,case when p_action='create_travel' then 'travel' else 'claim' end,
      case when p_action='create_travel' then private.expense_travel_draft(p_payload) else private.expense_claim_draft(p_payload,null) end)
      returning * into record;
  else
    select * into record from private.expense_records
      where organization_id=p_org and id=(p_payload->>'record')::uuid
        and actor in (owner_id,approver_id,manager_id,finance_id) for update;
    if not found then raise exception 'Expense record unavailable' using errcode='42501'; end if;
    if (p_payload->>'revision')::int is distinct from record.revision then
      raise exception 'This expense record changed. Reload and try again.' using errcode='40001';
    end if;
    resource_id_out := record.id;
    policy := private.expense_policy(p_org,day_today);
    if p_action in ('edit','revise_travel','submit','reroute','cancel','close') and record.owner_id<>actor then
      raise exception 'Only the requester can take this action' using errcode='42501';
    end if;

    case p_action
    when 'edit','revise_travel' then
      if (p_action='edit' and (record.status not in ('Draft','Returned','Pending Routing') or
        (record.status='Pending Routing' and record.routing_stage='finance')))
        or (p_action='revise_travel' and (record.kind<>'travel' or record.status<>'Approved' or action_reason is null)) then
        raise exception 'Only a draft or returned record can be edited' using errcode='22023';
      end if;
      record.status := 'Draft';
      record.approver_id := null;
      record.manager_id := null;
      record.finance_id := null;
      record.route_policy_id := null;
      record.routing_stage := null;
      record.claimed := 0;
      record.allowed := 0;
      record.draft := case when record.kind='travel' then private.expense_travel_draft(p_payload) else private.expense_claim_draft(p_payload,record.draft) end;
      if record.kind='travel' and (select issued from private.expense_advance_totals(p_org,record.id))>(record.draft->>'requested_advance')::numeric then
        raise exception 'Return unused travel funds before lowering the approved advance ceiling' using errcode='22023';
      end if;
    when 'submit' then
      if record.status not in ('Draft','Returned') then
        raise exception 'Only a draft or returned record can be submitted' using errcode='22023';
      end if;
      if record.kind='travel' then
        if (record.draft->>'starts')::date<day_today and record.draft->>'retrospective_reason' is null then
          raise exception 'Enter an emergency reason for travel that already started' using errcode='22023';
        end if;
        amount := (record.draft->>'estimated')::numeric;
        frozen := record.draft || jsonb_build_object('claimed',amount,'allowed',amount);
        record.routing_stage := 'travel';
      else
        frozen := private.expense_calculate(record,day_today);
        record.routing_stage := 'manager';
      end if;
      record.claimed := (frozen->>'claimed')::numeric;
      record.allowed := (frozen->>'allowed')::numeric;
      record.version := record.version+1;
      record.manager_id := null;
      record.finance_id := null;
      record.route_policy_id := policy.id;
      record.approver_id := private.expense_route(p_org,policy.id,record.routing_stage,record.owner_id,null,record.claimed);
      record.status := case when record.approver_id is null then 'Pending Routing' else 'Submitted' end;
      insert into private.expense_versions(organization_id,record_id,version,route_policy_id,snapshot,snapshot_hash)
        values(p_org,record.id,record.version,policy.id,frozen,encode(sha256(convert_to(frozen::text,'UTF8')),'hex'));
      if record.kind='claim' then
        insert into private.expense_submitted_lines(organization_id,record_id,version,line_id,line_number,policy_id,
          category,service_on,purpose,vendor,reference,cost_center,mileage,rate,claimed,allowance,receipt_id,possible_duplicate)
        select p_org,record.id,record.version,(line->>'id')::uuid,(line->>'number')::int,(line->>'policy_id')::uuid,
          line->>'category',(line->>'service_on')::date,line->>'purpose',line->>'vendor',line->>'reference',line->>'cost_center',
          case when line->'rule'->>'calculation'='mileage' then (line->>'mileage')::numeric else null end,
          (line->'rule'->>'rate')::numeric,(line->>'claimed')::numeric,(line->>'allowed')::numeric,
          (line->>'receipt_id')::uuid,(line->>'possible_duplicate')::bool
        from jsonb_array_elements(frozen->'lines') as lines(line);
      end if;
    when 'reroute' then
      if record.kind='travel' and record.status in ('Approved','Closed') and not exists (
        select 1 from public.memberships where organization_id=p_org and id=record.finance_id and status='Active'
      ) then
        record.finance_id := private.expense_route(p_org,policy.id,'finance',record.owner_id,record.approver_id,
          (record.draft->>'requested_advance')::numeric);
        record.route_policy_id := policy.id;
      else
      if record.status not in ('Pending Routing','Submitted','Manager Approved','Finance Review')
        or (record.status<>'Pending Routing' and exists(
          select 1 from public.memberships where organization_id=p_org and id=record.approver_id and status='Active'
        )) then raise exception 'Rerouting is available when an approver is missing or inactive' using errcode='22023'; end if;
      record.route_policy_id := policy.id;
      record.approver_id := private.expense_route(p_org,policy.id,record.routing_stage,record.owner_id,record.manager_id,
        case when record.routing_stage='finance' then record.allowed else record.claimed end);
      if record.routing_stage='finance' then record.finance_id := record.approver_id; end if;
      record.status := case when record.approver_id is null then 'Pending Routing'
        when record.routing_stage='finance' then 'Manager Approved' else 'Submitted' end;
      end if;
    when 'approve' then
      if record.status<>'Submitted' or record.approver_id is distinct from actor or actor=record.owner_id then
        raise exception 'Only the assigned independent approver can approve this request' using errcode='42501';
      end if;
      if record.kind='travel' then
        record.status := 'Approved';
        record.approver_id := actor;
        record.finance_id := private.expense_route(p_org,policy.id,'finance',record.owner_id,actor,
          (record.draft->>'requested_advance')::numeric);
      else
        select snapshot into frozen from private.expense_versions
          where organization_id=p_org and record_id=record.id and version=record.version;
        if exists (select 1 from jsonb_array_elements(frozen->'lines') l(value) where (value->>'exception_requested')::bool)
          and (p_payload->>'confirm_exceptions') is distinct from 'true' then
          raise exception 'Review and explicitly confirm receipt exceptions before approval' using errcode='22023';
        end if;
        record.manager_id := actor;
        record.routing_stage := 'finance';
        record.route_policy_id := policy.id;
        record.finance_id := private.expense_route(p_org,policy.id,'finance',record.owner_id,actor,record.allowed);
        record.approver_id := record.finance_id;
        record.status := case when record.finance_id is null then 'Pending Routing' else 'Manager Approved' end;
      end if;
    when 'start_finance' then
      if record.status<>'Manager Approved' or record.finance_id is distinct from actor
        or actor in (record.owner_id,record.manager_id) then
        raise exception 'Only the assigned independent finance reviewer can begin review' using errcode='42501';
      end if;
      record.status := 'Finance Review';
    when 'finance_approve' then
      if record.status<>'Finance Review' or record.finance_id is distinct from actor
        or actor in (record.owner_id,record.manager_id) then
        raise exception 'Only the assigned independent finance reviewer can approve payment' using errcode='42501';
      end if;
      select snapshot into frozen from private.expense_versions
        where organization_id=p_org and record_id=record.id and version=record.version;
      settlements := p_payload->'allowances';
      if jsonb_typeof(settlements) is distinct from 'array' or jsonb_array_length(settlements)<>jsonb_array_length(frozen->'lines') then
        raise exception 'Review the allowed amount for each expense line' using errcode='22023';
      end if;
      amount := 0;
      line_no := 0;
      for review_line in select value from jsonb_array_elements(frozen->'lines') loop
        line_amount := private.expense_money(settlements->>line_no,'line allowance');
        if line_amount>(review_line->>'allowed')::numeric then
          raise exception 'Line allowances cannot exceed the reviewed policy amount' using errcode='22023';
        end if;
        insert into private.expense_finance_lines(organization_id,record_id,version,line_id,amount,actor_id)
          values(p_org,record.id,record.version,(review_line->>'id')::uuid,line_amount,actor);
        amount := amount+line_amount;
        line_no := line_no+1;
      end loop;
      if amount<record.allowed and action_reason is null then
        raise exception 'Enter a reason for reducing the approved allowance' using errcode='22023';
      end if;
      record.allowed := amount;
      record.status := case when amount>0 then 'Approved for Payment' else 'Closed' end;
    when 'return','reject' then
      if record.status not in ('Submitted','Manager Approved','Finance Review') or record.approver_id is distinct from actor
        or actor=record.owner_id or (record.routing_stage='finance' and actor=record.manager_id) then
        raise exception 'Only the assigned independent reviewer can take this action' using errcode='42501';
      end if;
      if action_reason is null then raise exception 'Enter a reason for returning or rejecting this record' using errcode='22023'; end if;
      record.status := case when p_action='return' then 'Returned' else 'Rejected' end;
    when 'cancel' then
      if record.status not in ('Draft','Returned','Submitted','Pending Routing','Approved') or action_reason is null
        or (record.kind='travel' and (select issued from private.expense_advance_totals(p_org,record.id))>0)
        or (record.kind='travel' and exists (select 1 from private.expense_records c
          where c.organization_id=p_org and c.kind='claim' and c.draft->>'travel_id'=record.id::text
            and c.status not in ('Draft','Returned','Rejected','Cancelled'))) then
        raise exception 'This record cannot be cancelled. A cancellation reason is required.' using errcode='22023';
      end if;
      record.status := 'Cancelled';
    when 'close' then
      if record.kind<>'travel' or record.status<>'Approved' or (record.draft->>'ends')::date>day_today then
        raise exception 'Only completed approved travel can be closed' using errcode='22023';
      end if;
      record.status := 'Closed';
    when 'issue_advance','return_advance' then
      if record.kind<>'travel' or (record.status<>'Approved' and (record.status<>'Closed' or p_action='issue_advance'))
        or record.finance_id is distinct from actor or actor in (record.owner_id,record.approver_id) then
        raise exception 'Only assigned independent finance can manage this travel advance' using errcode='42501';
      end if;
      stage_id := (p_payload->>'evidence')::uuid;
      payment_date := (p_payload->>'payment_date')::date;
      reference := btrim(p_payload->>'reference');
      amount := private.expense_money(p_payload->>'amount','advance amount');
      if payment_date is null or not isfinite(payment_date) or payment_date>day_today
        or coalesce(length(reference),0) not between 1 and 120 or amount<=0
        or private.expense_document(p_org,record.id,stage_id) is null then
        raise exception 'Enter an advance amount, date, reference and clean scanned evidence from this trip' using errcode='22023';
      end if;
      select issued,unused into previously_issued,available_advance from private.expense_advance_totals(p_org,record.id);
      if (p_action='issue_advance' and (
        amount+previously_issued>(record.draft->>'requested_advance')::numeric or payment_date>(record.draft->>'ends')::date))
        or (p_action='return_advance' and amount>available_advance) then
        raise exception 'Advance is outside the permitted travel dates or remaining balance' using errcode='22023';
      end if;
      insert into private.expense_movements(organization_id,record_id,version,actor_id,kind,amount,payment_date,reference,evidence_id,reason,travel_id)
        values(p_org,record.id,record.version,actor,case when p_action='issue_advance' then 'advance_issue' else 'advance_return' end,
          amount,payment_date,reference,stage_id,action_reason,record.id);
    when 'advance','reimburse','reverse' then
      if record.kind<>'claim' or record.status not in ('Approved for Payment','Partly Reimbursed','Reimbursed')
        or record.finance_id is distinct from actor or actor in (record.owner_id,record.manager_id) then
        raise exception 'Only the assigned independent finance reviewer can post a payment' using errcode='42501';
      end if;
      stage_id := (p_payload->>'evidence')::uuid;
      payment_date := (p_payload->>'payment_date')::date;
      reference := btrim(p_payload->>'reference');
      if payment_date is null or not isfinite(payment_date) or payment_date>day_today or coalesce(length(reference),0) not between 1 and 120
        or private.expense_document(p_org,record.id,stage_id) is null then
        raise exception 'Enter a payment date, reference and a clean scanned proof from this claim' using errcode='22023';
      end if;
      paid := private.expense_paid(p_org,record.id);
      if p_action='reverse' then
        select * into original from private.expense_movements
          where organization_id=p_org and record_id=record.id and id=(p_payload->>'movement')::uuid and kind<>'reversal';
        if not found or payment_date<original.payment_date or action_reason is null or exists (
          select 1 from private.expense_movements where organization_id=p_org and reverses_id=original.id) then
          raise exception 'Choose an unreversed payment and enter a reversal reason' using errcode='22023';
        end if;
        amount := original.amount;
        paid := paid-amount;
        if original.travel_id is not null then
          perform 1 from private.expense_records where organization_id=p_org and id=original.travel_id for update;
          movement_travel_id := original.travel_id;
        end if;
      else
        amount := private.expense_money(p_payload->>'amount','payment amount');
        if amount<=0 or amount>record.allowed-paid then
          raise exception 'Payment must be positive and no more than the outstanding balance' using errcode='22023';
        end if;
        if p_action='advance' then
          select * into travel from private.expense_records
            where organization_id=p_org and id=(record.draft->>'travel_id')::uuid
              and owner_id=record.owner_id and kind='travel' and status in ('Approved','Closed') for update;
          if not found then raise exception 'Apply an advance from the approved trip' using errcode='22023'; end if;
          select unused into available_advance from private.expense_advance_totals(p_org,travel.id);
          if amount>available_advance then
            raise exception 'Applied advance exceeds the unused trip advance balance' using errcode='22023';
          end if;
          movement_travel_id := travel.id;
        end if;
        paid := paid+amount;
      end if;
      insert into private.expense_movements(organization_id,record_id,version,actor_id,kind,amount,payment_date,reference,evidence_id,reason,reverses_id,travel_id)
        values(p_org,record.id,record.version,actor,case when p_action='reverse' then 'reversal' when p_action='advance' then 'advance' else 'reimbursement' end,
          amount,payment_date,reference,stage_id,action_reason,original.id,movement_travel_id);
      record.status := case when paid=0 then 'Approved for Payment' when paid<record.allowed then 'Partly Reimbursed' else 'Reimbursed' end;
    end case;

    update private.expense_records r set status=record.status,revision=record.revision+1,version=record.version,draft=record.draft,
      approver_id=record.approver_id,manager_id=record.manager_id,finance_id=record.finance_id,route_policy_id=record.route_policy_id,
      routing_stage=record.routing_stage,claimed=record.claimed,allowed=record.allowed,updated_at=now()
      where r.organization_id=p_org and r.id=record.id returning r.* into record;
  end if;
  result := coalesce(result,jsonb_build_object('id',record.id,'status',record.status,'revision',record.revision,'version',record.version));
  insert into private.audit_events(organization_id,actor_membership_id,resource_id,action,request_id,redacted_details)
    values(p_org,actor,resource_id_out,'expense.' || p_action,p_key,jsonb_strip_nulls(jsonb_build_object(
      'status',record.status,'version',record.version,'subject_id',subject_id,'grade',v_grade,
      'snapshot_hash',(select snapshot_hash from private.expense_versions s where
        (s.organization_id,s.record_id,s.version)=(p_org,record.id,record.version)),
      'route_policy_id',record.route_policy_id,'approver_id',record.approver_id,
      'line_allowances',case when p_action='finance_approve' then settlements else null end,
      'confirmed_exceptions',case when p_action='approve' then (p_payload->>'confirm_exceptions')::boolean else null end,
      'reason',action_reason)));
  insert into private.operation_receipts(organization_id,actor_membership_id,operation_key,command_type,request_hash,response_snapshot)
    values(p_org,actor,p_key,'expense.' || p_action,payload_hash,result);
  return result;
end
$$;

revoke all on function private.expense_actor(uuid),private.expense_policy(uuid,date),
  private.expense_route(uuid,uuid,text,uuid,uuid,numeric),private.expense_money(text,text),
  private.expense_document(uuid,uuid,uuid),private.expense_travel_draft(jsonb),private.expense_claim_draft(jsonb,jsonb),
  private.expense_calculate(private.expense_records,date),private.expense_paid(uuid,uuid),private.expense_advance_totals(uuid,uuid),
  private.expense_attachment_allowed(uuid,uuid,uuid,boolean),private.read_expense_workspace(uuid),
  private.run_expense_command(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.read_expense_workspace(uuid),private.run_expense_command(uuid,text,uuid,jsonb) to authenticated;

create function public.read_expense_workspace(p_org uuid) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
  select private.read_expense_workspace(p_org)
$$;
create function public.run_expense_command(p_org uuid,p_action text,p_key uuid,p_payload jsonb) returns jsonb
language sql security invoker set search_path=pg_catalog as $$
  select private.run_expense_command(p_org,p_action,p_key,p_payload)
$$;
revoke all on function public.read_expense_workspace(uuid),public.run_expense_command(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.read_expense_workspace(uuid),public.run_expense_command(uuid,text,uuid,jsonb) to authenticated;
