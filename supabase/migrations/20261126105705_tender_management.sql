-- Additive tender register and command boundary. Existing CRM records are untouched.
-- Recover by deploying a forward correction and retaining the append-only history.
insert into public.permissions (code,description,requires_mfa) values
  ('tender.read','Read assigned tender records',false),
  ('tender.edit','Register and manage owned tenders',false),
  ('tender.read_all','Read all tenders in the organization',false);

create table private.tenders (
  id uuid primary key,
  organization_id uuid not null,
  authority text not null check (length(authority) between 1 and 250),
  portal text not null check (length(portal) between 1 and 120),
  reference text not null check (length(reference) between 1 and 160),
  portal_url text check (length(portal_url)<=2000 and portal_url ~ '^https://[A-Za-z0-9][A-Za-z0-9.:-]*([/?#][^[:space:]\\]*)?$'),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  estimate numeric(18,2) check (estimate>=0),
  fees numeric(18,2) check (fees>=0),
  geography text check (length(geography)<=150),
  procurement_sites text check (length(procurement_sites)<=1000),
  bid_decision text not null default 'Pending' check (bid_decision in ('Pending','Go','No Go')),
  lifecycle text not null default 'Identified' check (lifecycle in ('Identified','Preparing','Submitted','Under Evaluation','Closed','Cancelled')),
  deadline timestamptz not null check (isfinite(deadline)),
  source_timezone text not null check (length(source_timezone) between 1 and 100),
  version integer not null default 1 check (version>0),
  bid_term_revision integer not null default 1 check (bid_term_revision>0),
  bid_approval_version uuid,
  created_at timestamptz not null default now(),
  unique (organization_id,id),
  foreign key (organization_id,id) references public.resources(organization_id,id),
  foreign key (organization_id,bid_approval_version) references private.operating_policy_versions(organization_id,id)
);
create unique index tender_portal_reference_key on private.tenders(organization_id,lower(portal),lower(reference));
create index tender_register_deadline_idx on private.tenders(organization_id,deadline,id);

create table private.tender_lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tender_id uuid not null,
  lot_number text not null check (length(lot_number) between 1 and 80),
  description text not null check (length(description) between 1 and 500),
  offered_model text check (length(offered_model)<=160),
  offered_quantity numeric(18,3) check (offered_quantity>0),
  evaluation text not null default 'Not Assessed' check (evaluation in (
    'Not Assessed','Technical Pending','Technical Qualified','Technical Rejected','Financial Opened','Awarded','Lost'
  )),
  observed_rank integer check (observed_rank>0),
  unique (organization_id,tender_id,id),
  foreign key (organization_id,tender_id) references private.tenders(organization_id,id)
);
create unique index tender_lot_number_key on private.tender_lots(tender_id,lower(lot_number));

create table private.tender_checklist (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tender_id uuid not null,
  lot_id uuid,
  title text not null check(length(title) between 1 and 300),
  kind text not null check (kind in ('document','compliance')),
  mandatory boolean not null,
  nonwaivable boolean not null check (not nonwaivable or mandatory),
  evidence_id uuid references private.file_upload_stages(id),
  valid_until date check (isfinite(valid_until)),
  deviation text check(length(deviation)<=2000),
  prepared_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  waiver_policy uuid,
  waiver_reason text check(length(waiver_reason)<=1000),
  foreign key (organization_id,tender_id) references private.tenders(organization_id,id),
  foreign key (organization_id,tender_id,lot_id) references private.tender_lots(organization_id,tender_id,id),
  foreign key (organization_id,prepared_by) references public.memberships(organization_id,id),
  foreign key (organization_id,reviewed_by) references public.memberships(organization_id,id),
  foreign key (organization_id,waiver_policy) references private.operating_policy_versions(organization_id,id),
  check (kind<>'compliance' or (lot_id is not null and mandatory and nonwaivable)),
  check ((reviewed_by is null)=(reviewed_at is null)),
  check (reviewed_by is null or reviewed_by<>prepared_by),
  check ((waiver_policy is null)=(waiver_reason is null)),
  check (waiver_policy is null or (not nonwaivable and reviewed_by is not null))
);
create index tender_checklist_parent_idx on private.tender_checklist(organization_id,tender_id);

create table private.tender_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tender_id uuid not null,
  tender_version integer not null check(tender_version>0),
  kind text not null check(length(kind) between 1 and 60),
  actor uuid not null,
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  recorded_at timestamptz not null default now(),
  unique (organization_id,tender_id,tender_version),
  foreign key (organization_id,tender_id) references private.tenders(organization_id,id),
  foreign key (organization_id,actor) references public.memberships(organization_id,id)
);
create unique index tender_one_submission on private.tender_events(organization_id,tender_id) where kind='record_submission';

create table private.tender_reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tender_id uuid not null,
  term_revision integer not null,
  days_before smallint not null check (days_before in (7,3,1)),
  due_at timestamptz not null,
  cancelled_at timestamptz,
  unique (organization_id,tender_id,term_revision,days_before),
  foreign key (organization_id,tender_id) references private.tenders(organization_id,id)
);
create index tender_reminders_due_idx on private.tender_reminders(organization_id,due_at) where cancelled_at is null;

do $$
declare table_name text;
begin
  foreach table_name in array array['tenders','tender_lots','tender_checklist','tender_events','tender_reminders'] loop
    execute format('alter table private.%I enable row level security',table_name);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',table_name);
  end loop;
end
$$;
create trigger tender_events_append_only before update or delete or truncate on private.tender_events
  for each statement execute function private.reject_mutation();

create function private.tender_actor(p_org uuid) returns uuid
language sql stable security invoker set search_path=pg_catalog as $$
  select m.id from public.memberships m
  join auth.sessions s on s.id=nullif(auth.jwt()->>'session_id','')::uuid and s.user_id=m.user_id
  where m.organization_id=p_org and m.user_id=auth.uid() and m.status='Active'
    and (s.not_after is null or s.not_after>now())
    and exists (select 1 from auth.users u where u.id=m.user_id and to_jsonb(u)->>'email_confirmed_at' is not null)
$$;

create function private.tender_has_access(p_org uuid,p_actor uuid,p_permission text) returns boolean
language sql stable security invoker set search_path=pg_catalog as $$
  select exists (
    select 1 from public.member_roles mr
    join public.roles r on (r.organization_id,r.id)=(mr.organization_id,mr.role_id)
    left join public.role_permissions rp on (rp.organization_id,rp.role_id)=(mr.organization_id,mr.role_id)
    where mr.organization_id=p_org and mr.membership_id=p_actor
      and mr.effective_from<=now() and (mr.effective_to is null or mr.effective_to>now())
      and (rp.permission_code=p_permission or r.code='super_admin')
  )
$$;

create function private.tender_policy(p_org uuid,p_owner uuid,p_actor uuid,p_process text,p_estimate numeric)
returns uuid language sql stable security invoker set search_path=pg_catalog as $$
  with effective as (
    select v.id,v.settings from private.operating_policy_versions v
    join public.organizations org on org.id=v.organization_id
    where v.organization_id=p_org and v.section='tender' and v.effective_on<=(now() at time zone org.timezone)::date
    order by v.effective_on desc,v.revision desc limit 1
  ), candidate as (
    select e.id,route from effective e cross join lateral jsonb_array_elements(e.settings->'routes') route
    where route->>'process'=p_process and (route->>'subject' is null or route->>'subject'=p_owner::text)
    order by (route->>'subject' is null) limit 1
  )
  select id from candidate
  where p_actor<>p_owner and (route->>'limit' is null or p_estimate<=(route->>'limit')::numeric)
    and p_actor::text in (route->>'primary',route->>'alternate')
$$;

create function private.tender_text(p_value text,p_max integer,p_required boolean default true) returns text
language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare answer text := nullif(trim(p_value),'');
begin
  if (answer is null and p_required) or length(answer)>p_max or answer ~ '[[:cntrl:]]' then
    raise exception 'Enter the required text within the stated length' using errcode='22023';
  end if;
  return answer;
end
$$;

create function private.tender_time(p_value text) returns timestamptz
language plpgsql stable security invoker set search_path=pg_catalog as $$
begin
  if p_value is null or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    raise exception 'Enter a full date and time with a UTC offset' using errcode='22023';
  end if;
  return p_value::timestamptz;
end
$$;

create function private.tender_amount(p_value text,p_decimal_places integer) returns numeric
language plpgsql immutable security invoker set search_path=pg_catalog as $$
begin
  if p_value is not null and p_value !~ ('^(0|[1-9][0-9]{0,14})([.][0-9]{1,'||p_decimal_places||'})?$') then
    raise exception 'Enter a nonnegative quantity or amount to the allowed precision' using errcode='22023';
  end if;
  return p_value::numeric;
end
$$;

create function private.tender_evidence(p_org uuid,p_id uuid,p_stage uuid) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog as $$
declare evidence jsonb;
begin
  select jsonb_build_object('id',s.id,'sha256',f.sha256,'file_name',s.original_name) into evidence
  from private.file_upload_stages s join private.file_upload_objects f on f.stage_id=s.id
  where s.id=p_stage and s.organization_id=p_org and s.parent_resource_id=p_id
    and s.purpose='business_document' and f.verdict='clean';
  if evidence is null then
    raise exception 'Choose a scanned attachment from this tender' using errcode='22023';
  end if;
  return evidence;
end
$$;

create function private.tender_readiness(p_org uuid,p_id uuid,p_day date) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
  select coalesce(jsonb_agg(to_jsonb(blockers) order by blockers.reason),'[]'::jsonb)
  from (
    select null::uuid as id,'Record a Go decision and reapprove it after any corrigendum' as reason
    from private.tenders t where t.organization_id=p_org and t.id=p_id and t.bid_decision<>'Go'
    union all
    select null,'Add at least one lot' where not exists (
      select 1 from private.tender_lots l where l.organization_id=p_org and l.tender_id=p_id
    )
    union all
    select l.id,'Enter an offered model, quantity and reviewed compliance for lot '||l.lot_number
    from private.tender_lots l
    where l.organization_id=p_org and l.tender_id=p_id
      and (l.offered_model is null or l.offered_quantity is null or not exists (
        select 1 from private.tender_checklist c where c.organization_id=p_org and c.tender_id=p_id and c.lot_id=l.id and c.kind='compliance'
      ))
    union all
    select c.id,case when c.valid_until<p_day then 'Evidence expired for ' else 'Review required for ' end||c.title
    from private.tender_checklist c
    left join private.file_upload_objects f on f.stage_id=c.evidence_id
    where c.organization_id=p_org and c.tender_id=p_id and c.mandatory
      and (c.reviewed_by is null or (c.waiver_policy is null and (
        f.verdict is distinct from 'clean' or c.valid_until<p_day
      )))
  ) blockers
$$;

create function private.tender_can_view(p_org uuid,p_id uuid,p_actor uuid) returns boolean
language sql stable security invoker set search_path=pg_catalog as $$
  select exists (
    select 1 from private.tenders t join public.resources r on (r.organization_id,r.id)=(t.organization_id,t.id)
    where t.organization_id=p_org and t.id=p_id and r.archived_at is null and (
      (r.owner_membership_id=p_actor and private.tender_has_access(p_org,p_actor,'tender.read'))
      or private.tender_has_access(p_org,p_actor,'tender.read_all')
      or private.tender_policy(p_org,r.owner_membership_id,p_actor,'bid',t.estimate) is not null
      or private.tender_policy(p_org,r.owner_membership_id,p_actor,'submission',t.estimate) is not null
      or private.tender_policy(p_org,r.owner_membership_id,p_actor,'waiver',t.estimate) is not null
    )
  )
$$;

create function private.tender_reschedule(p_org uuid,p_id uuid,p_revision integer,p_deadline timestamptz)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
begin
  update private.tender_reminders set cancelled_at=now()
  where organization_id=p_org and tender_id=p_id and cancelled_at is null;
  if p_deadline is not null then
    insert into private.tender_reminders(organization_id,tender_id,term_revision,days_before,due_at)
    select p_org,p_id,p_revision,d,p_deadline-(d*interval '24 hours') from unnest(array[7,3,1]::smallint[]) d;
  end if;
end
$$;

create function private.execute_tender_command(
  p_organization_id uuid,p_action text,p_payload jsonb,p_request_key uuid,p_tender_id uuid,p_expected_version integer
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  org uuid := p_organization_id;
  actor uuid := private.tender_actor(org);
  target uuid := p_tender_id;
  tender private.tenders%rowtype;
  lot private.tender_lots%rowtype;
  item private.tender_checklist%rowtype;
  receipt private.operation_receipts%rowtype;
  owner uuid;
  input_hash text;
  output jsonb;
  event_payload jsonb;
  policy uuid;
  stage uuid;
  selected_lot uuid;
  term_zone text;
  deadline_at timestamptz;
  actual_at timestamptz;
  reason text;
  decision text;
  amount numeric;
  quantity numeric;
  rank integer;
  local_day date;
  config_timezone text;
  milestone_kind text;
  evidence jsonb;
  can_edit boolean;
  allowed_keys text[];
begin
  if actor is null then raise exception 'Tender access denied' using errcode='42501'; end if;
  -- Serialize against session removal and membership deactivation as well as concurrent tender commands.
  perform 1 from auth.sessions s where s.id=nullif(auth.jwt()->>'session_id','')::uuid and s.user_id=auth.uid()
    and (s.not_after is null or s.not_after>now()) for share;
  if not found then raise exception 'Tender access denied' using errcode='42501'; end if;
  perform 1 from public.memberships m where m.organization_id=org and m.id=actor and m.status='Active' for share;
  if not found then raise exception 'Tender access denied' using errcode='42501'; end if;

  allowed_keys := case p_action
    when 'register' then array['authority','portal','reference','portal_url','estimate','fees','geography','procurement_sites','deadline','timezone','published_at','owner']
    when 'add_lot' then array['number','description']
    when 'offer_lot' then array['lot','model','quantity']
    when 'add_checklist' then array['lot','title','kind','mandatory','nonwaivable']
    when 'attach_checklist' then array['item','file','valid_until','deviation']
    when 'review_checklist' then array['item','reason']
    when 'waive_checklist' then array['item','reason']
    when 'bid_decision' then array['decision','reason']
    when 'corrigendum' then array['deadline','timezone','reason','file']
    when 'milestone' then array['kind','instant','reason','file']
    when 'record_submission' then array['submitted_at','submitted_by','acknowledgement','file','late_reason']
    when 'submission_addendum' then array['reason','file']
    when 'evaluate_lot' then array['lot','state','rank','reason']
    when 'award_lot' then array['lot','contract','customer','quantity','value','awarded_at','file']
    when 'cancel' then array['reason','file']
    when 'security_add' then array['kind','lot','instrument','amount','issuer','reference','issued_on','expires_on','follow_up','file']
    when 'security_step' then array['security','state','occurred_on','reference','reason','file','follow_up']
    when 'security_extend' then array['security','expires_on','reason','file']
    when 'execution_entry' then array['lot','kind','quantity','happened_at','reference','file']
    when 'invoice_add' then array['lot','reference','due_on','amount','follow_up','file']
    when 'invoice_follow_up' then array['invoice','received','happened_at','reference','reason','follow_up','file']
    when 'prebid_add' then array['issue','change','responsible']
    when 'prebid_submit' then array['query','happened_at','reference','file']
    when 'prebid_reply' then array['query','happened_at','response','file']
    when 'observe_competitor' then array['competitor','observation','source','observed_on','confidence']
    when 'close' then array['reason']
    when 'reopen' then array['reason']
  end;
  if allowed_keys is null or p_request_key is null or jsonb_typeof(p_payload) is distinct from 'object'
    or octet_length(p_payload::text)>32000 or p_payload-allowed_keys<>'{}'::jsonb then
    raise exception 'Invalid tender command or inputs' using errcode='22023';
  end if;

  if p_action='register' then
    if p_tender_id is not null or p_expected_version is not null or not private.tender_has_access(org,actor,'tender.edit') then
      raise exception 'Tender registration access denied' using errcode='42501';
    end if;
  else
    if p_expected_version is null or not private.tender_can_view(org,target,actor) then
      raise exception 'Tender access denied' using errcode='42501';
    end if;
    select * into tender from private.tenders t where t.organization_id=org and t.id=target for update;
    select r.owner_membership_id into owner from public.resources r where r.organization_id=org and r.id=target and r.archived_at is null;
    if owner is null or not private.tender_can_view(org,target,actor) then raise exception 'Tender access denied' using errcode='42501'; end if;
    can_edit := owner=actor and private.tender_has_access(org,actor,'tender.edit');
    if p_action in ('bid_decision','review_checklist','waive_checklist','record_submission','reopen') then
      policy := private.tender_policy(org,owner,actor,case p_action when 'waive_checklist' then 'waiver'
        when 'record_submission' then 'submission' else 'bid' end,tender.estimate);
      if policy is null then
        raise exception 'An independent reviewer with a current tender approval route and sufficient authority is required' using errcode='42501';
      end if;
    elsif not can_edit then
      raise exception 'Only the tender owner with editing access may perform this action' using errcode='42501';
    end if;
  end if;

  input_hash := encode(sha256(convert_to(jsonb_build_array(p_action,p_tender_id,p_expected_version,p_payload)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('tender-operation:'||org::text||':'||actor::text||':'||p_request_key::text,0));
  select * into receipt from private.operation_receipts r where r.organization_id=org
    and r.actor_membership_id=actor and r.operation_key=p_request_key;
  if found then
    if receipt.command_type<>'tender.'||p_action or receipt.request_hash<>input_hash then
      raise sqlstate 'PT409' using message='Request key was already used for a different operation';
    end if;
    return receipt.response_snapshot;
  end if;
  if p_action<>'register' and tender.version<>p_expected_version then
    raise sqlstate 'PT409' using message='Tender changed. Reload it and review your action.';
  end if;

  select o.timezone into config_timezone from public.organizations o where o.id=org;
  if p_action in ('register','corrigendum') then
    term_zone := private.tender_text(p_payload->>'timezone',100);
    if not exists (select 1 from pg_timezone_names where name=term_zone) then
      raise exception 'Choose a valid named timezone' using errcode='22023';
    end if;
    deadline_at := private.tender_time(p_payload->>'deadline');
    if left(p_payload->>'deadline',16) <> to_char(deadline_at at time zone term_zone,'YYYY-MM-DD"T"HH24:MI') then
      raise exception 'Deadline offset does not match the named timezone' using errcode='22023';
    end if;
  end if;
  if p_action in ('add_lot','offer_lot','add_checklist','attach_checklist','review_checklist','waive_checklist','corrigendum','milestone','bid_decision')
    and tender.lifecycle not in ('Identified','Preparing') then
    raise exception 'The tender preparation record is locked in its current stage' using errcode='22023';
  end if;
  if p_action in ('offer_lot','attach_checklist','review_checklist','waive_checklist')
    and tender.lifecycle is distinct from 'Preparing' then
    raise exception 'Record a Go decision before preparing the bid' using errcode='22023';
  end if;

  case p_action
  when 'register' then
    target := gen_random_uuid();
    owner := coalesce(nullif(p_payload->>'owner','')::uuid,actor);
    if owner<>actor and not private.tender_has_access(org,actor,'tender.read_all') then
      raise exception 'Tender owner assignment denied' using errcode='42501';
    end if;
    if not exists (select 1 from public.memberships m where m.organization_id=org and m.id=owner
      and m.status='Active' and private.tender_has_access(org,owner,'tender.edit') and private.tender_has_access(org,owner,'tender.read')) then
      raise exception 'Choose an active owner with tender access' using errcode='22023';
    end if;
    if p_payload->>'published_at' is not null then
      actual_at := private.tender_time(p_payload->>'published_at');
      if actual_at>deadline_at then raise exception 'Publication must precede the tender deadline' using errcode='22023'; end if;
    end if;
    insert into public.resources(id,organization_id,resource_type,owner_membership_id) values(target,org,'tender',owner);
    insert into private.tenders(id,organization_id,authority,portal,reference,portal_url,currency,estimate,fees,geography,procurement_sites,deadline,source_timezone)
    select target,org,private.tender_text(p_payload->>'authority',250),private.tender_text(p_payload->>'portal',120),
      private.tender_text(p_payload->>'reference',160),private.tender_text(p_payload->>'portal_url',2000,false),
      o.base_currency,private.tender_amount(p_payload->>'estimate',2),private.tender_amount(p_payload->>'fees',2),
      private.tender_text(p_payload->>'geography',150,false),private.tender_text(p_payload->>'procurement_sites',1000,false),deadline_at,term_zone
    from public.organizations o where o.id=org returning * into tender;
    perform private.tender_reschedule(org,target,tender.bid_term_revision,deadline_at);
    event_payload := jsonb_build_object('deadline',deadline_at,'timezone',term_zone,'published_at',actual_at,'owner',owner);
  when 'add_lot' then
    if tender.lifecycle='Preparing' then raise exception 'Record the lot before the Go decision, or request an authorized reopening' using errcode='22023'; end if;
    insert into private.tender_lots(organization_id,tender_id,lot_number,description)
    values (org,target,private.tender_text(p_payload->>'number',80),private.tender_text(p_payload->>'description',500))
    returning * into lot;
    event_payload := to_jsonb(lot) - array['organization_id','tender_id'];
  when 'offer_lot' then
    selected_lot := (p_payload->>'lot')::uuid;
    quantity := private.tender_amount(p_payload->>'quantity',3);
    if quantity is null or quantity<=0 then raise exception 'Enter a positive offered quantity' using errcode='22023'; end if;
    update private.tender_lots set offered_model=private.tender_text(p_payload->>'model',160),offered_quantity=quantity
    where organization_id=org and tender_id=target and id=selected_lot returning * into lot;
    if not found then raise exception 'Lot unavailable' using errcode='22023'; end if;
    update private.tender_checklist set reviewed_by=null,reviewed_at=null,waiver_policy=null,waiver_reason=null
    where organization_id=org and tender_id=target and lot_id=selected_lot;
    event_payload := to_jsonb(lot) - array['organization_id','tender_id'];
  when 'add_checklist' then
    selected_lot := nullif(p_payload->>'lot','')::uuid;
    if jsonb_typeof(p_payload->'mandatory') is distinct from 'boolean'
      or jsonb_typeof(p_payload->'nonwaivable') is distinct from 'boolean' then
      raise exception 'Mark whether this checklist item is mandatory and waivable' using errcode='22023';
    end if;
    insert into private.tender_checklist(organization_id,tender_id,lot_id,title,kind,mandatory,nonwaivable)
    values(org,target,selected_lot,private.tender_text(p_payload->>'title',300),p_payload->>'kind',
      (p_payload->>'mandatory')::boolean,(p_payload->>'nonwaivable')::boolean) returning * into item;
    event_payload := to_jsonb(item) - array['organization_id','tender_id'];
  when 'attach_checklist' then
    stage := (p_payload->>'file')::uuid;
    evidence := private.tender_evidence(org,target,stage);
    if p_payload->>'valid_until' is not null and p_payload->>'valid_until' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Enter a valid expiry date' using errcode='22023';
    end if;
    update private.tender_checklist set evidence_id=stage,valid_until=(p_payload->>'valid_until')::date,
      deviation=private.tender_text(p_payload->>'deviation',2000,false),prepared_by=actor,
      reviewed_by=null,reviewed_at=null,waiver_policy=null,waiver_reason=null
    where organization_id=org and tender_id=target and id=(p_payload->>'item')::uuid returning * into item;
    if not found then raise exception 'Checklist item unavailable' using errcode='22023'; end if;
    event_payload := (to_jsonb(item) - array['organization_id','tender_id']) || jsonb_build_object('evidence',evidence);
  when 'review_checklist','waive_checklist' then
    select * into item from private.tender_checklist where organization_id=org and tender_id=target and id=(p_payload->>'item')::uuid;
    if not found or item.prepared_by=actor then raise exception 'Checklist item unavailable for independent review' using errcode='42501'; end if;
    reason := private.tender_text(p_payload->>'reason',1000,p_action='waive_checklist' or item.deviation is not null);
    if p_action='review_checklist' then
      evidence := private.tender_evidence(org,target,item.evidence_id);
      if item.valid_until < (now() at time zone tender.source_timezone)::date then
        raise exception 'Replace the expired evidence before review' using errcode='22023';
      end if;
      if item.kind='compliance' and not exists (select 1 from private.tender_lots l where l.id=item.lot_id and l.offered_model is not null) then
        raise exception 'Record the offered model before reviewing compliance' using errcode='22023';
      end if;
    elsif item.nonwaivable then
      raise exception 'This requirement is non-waivable' using errcode='22023';
    end if;
    update private.tender_checklist set reviewed_by=actor,reviewed_at=now(),
      waiver_policy=case when p_action='waive_checklist' then policy end,
      waiver_reason=case when p_action='waive_checklist' then reason end
    where id=item.id;
    event_payload := jsonb_build_object('item',item.id,'policy',policy,'reason',reason,'evidence',evidence);
  when 'bid_decision' then
    decision := p_payload->>'decision';
    reason := private.tender_text(p_payload->>'reason',1000);
    if decision is null or decision not in ('Go','No Go') then raise exception 'Choose Go or No Go' using errcode='22023'; end if;
    if tender.bid_decision <> 'Pending' then raise exception 'Reopen the decision before reviewing it again' using errcode='22023'; end if;
    if decision='Go' and not exists(select 1 from private.tender_lots l where l.organization_id=org and l.tender_id=target) then
      raise exception 'Record the bidding lots before the Go decision' using errcode='22023';
    end if;
    update private.tenders set bid_decision=decision,bid_approval_version=policy,lifecycle=case when decision='Go' then 'Preparing' else 'Identified' end
    where id=target;
    if decision='No Go' then perform private.tender_reschedule(org,target,tender.bid_term_revision,null); end if;
    event_payload := jsonb_build_object('decision',decision,'reason',reason,'policy',policy,'term_revision',tender.bid_term_revision,
      'reviewed_plan_sha256',encode(sha256(convert_to(jsonb_build_array(tender.authority,tender.portal,tender.reference,tender.estimate,tender.deadline,
        (select jsonb_agg(jsonb_build_array(l.lot_number,l.description) order by l.id) from private.tender_lots l where l.tender_id=target))::text,'UTF8')),'hex'));
  when 'corrigendum' then
    reason := private.tender_text(p_payload->>'reason',1000);
    evidence := private.tender_evidence(org,target,(p_payload->>'file')::uuid);
    update private.tenders set deadline=deadline_at,source_timezone=term_zone,bid_decision='Pending',
      lifecycle='Identified',bid_approval_version=null,bid_term_revision=bid_term_revision+1 where id=target;
    update private.tender_checklist set reviewed_by=null,reviewed_at=null,waiver_policy=null,waiver_reason=null
    where organization_id=org and tender_id=target;
    perform private.tender_reschedule(org,target,tender.bid_term_revision+1,deadline_at);
    event_payload := jsonb_build_object('from_deadline',tender.deadline,'from_timezone',tender.source_timezone,'deadline',deadline_at,
      'timezone',term_zone,'reason',reason,'evidence',evidence,'term_revision',tender.bid_term_revision+1);
  when 'milestone' then
    milestone_kind := p_payload->>'kind';
    if milestone_kind is null or milestone_kind not in ('Publication','Pre-bid','Clarification','Opening') then
      raise exception 'Choose a tender milestone' using errcode='22023';
    end if;
    actual_at := private.tender_time(p_payload->>'instant');
    reason := private.tender_text(p_payload->>'reason',1000,true);
    if exists(select 1 from private.tender_events e where e.organization_id=org and e.tender_id=target
      and (e.kind='milestone' and e.payload->>'kind'=milestone_kind
        or e.kind='register' and milestone_kind='Publication' and e.payload->>'published_at' is not null))
      or p_payload->>'file' is not null then
      evidence := private.tender_evidence(org,target,(p_payload->>'file')::uuid);
      update private.tenders set bid_decision='Pending',lifecycle='Identified',bid_approval_version=null,
        bid_term_revision=bid_term_revision+1 where id=target;
      update private.tender_checklist set reviewed_by=null,reviewed_at=null,waiver_policy=null,waiver_reason=null
      where organization_id=org and tender_id=target;
      perform private.tender_reschedule(org,target,tender.bid_term_revision+1,tender.deadline);
    end if;
    if milestone_kind='Opening' and actual_at<tender.deadline or milestone_kind<>'Opening' and actual_at>tender.deadline then
      raise exception 'Milestone date is incompatible with the deadline' using errcode='22023';
    end if;
    event_payload := jsonb_build_object('kind',milestone_kind,'instant',actual_at,'timezone',tender.source_timezone,'reason',reason,'evidence',evidence);
  when 'record_submission' then
    actual_at := private.tender_time(p_payload->>'submitted_at');
    local_day := (greatest(now(),actual_at) at time zone tender.source_timezone)::date;
    if tender.lifecycle <> 'Preparing' or tender.bid_decision <> 'Go'
      or actual_at>now() or actual_at<tender.created_at
      or private.tender_readiness(org,target,local_day)<>'[]'::jsonb then
      raise exception 'Submission requires Go, current reviewed evidence and a valid actual submission time' using errcode='22023';
    end if;
    reason := private.tender_text(p_payload->>'late_reason',1000,actual_at>tender.deadline);
    decision := private.tender_text(p_payload->>'acknowledgement',250,p_payload->>'file' is null);
    if actual_at>tender.deadline or p_payload->>'file' is not null then
      evidence := private.tender_evidence(org,target,(p_payload->>'file')::uuid);
    end if;
    event_payload := jsonb_build_object('submitted_at',actual_at,'submitted_by',private.tender_text(p_payload->>'submitted_by',250),'recorded_by',actor,
      'policy',policy,'bid_policy',tender.bid_approval_version,'deadline',tender.deadline,'timezone',tender.source_timezone,
      'term_revision',tender.bid_term_revision,'acknowledgement',decision,'evidence',evidence,'late',actual_at>tender.deadline,'late_reason',reason,
      'lots',(select jsonb_agg(to_jsonb(l)-array['organization_id','tender_id'] order by l.id)
        from private.tender_lots l where l.organization_id=org and l.tender_id=target),
      'checklist',(select coalesce(jsonb_agg((to_jsonb(c)-array['organization_id','tender_id'])||jsonb_build_object('sha256',f.sha256)
        order by c.id),'[]'::jsonb) from private.tender_checklist c
        left join private.file_upload_objects f on f.stage_id=c.evidence_id and f.verdict='clean'
        where c.organization_id=org and c.tender_id=target));
    event_payload := event_payload||jsonb_build_object('snapshot_sha256',encode(sha256(convert_to(event_payload::text,'UTF8')),'hex'));
    update private.tenders set lifecycle='Submitted' where id=target;
    perform private.tender_reschedule(org,target,tender.bid_term_revision,null);
  when 'submission_addendum' then
    if not exists(select 1 from private.tender_events e where e.tender_id=target and e.kind='record_submission') then
      raise exception 'A recorded submission is required before an addendum' using errcode='22023';
    end if;
    evidence := private.tender_evidence(org,target,(p_payload->>'file')::uuid);
    event_payload := jsonb_build_object('reason',private.tender_text(p_payload->>'reason',1000),'evidence',evidence);
  when 'evaluate_lot','award_lot' then
    if tender.lifecycle not in ('Submitted','Under Evaluation') then
      raise exception 'Record the submission before assessing lots' using errcode='22023';
    end if;
    select * into lot from private.tender_lots l where l.organization_id=org and l.tender_id=target and l.id=(p_payload->>'lot')::uuid;
    if not found or lot.evaluation in ('Awarded','Lost','Technical Rejected') then
      raise exception 'This lot has no open evaluation' using errcode='22023';
    end if;
    if p_action='evaluate_lot' then
      decision := p_payload->>'state';
      rank := (p_payload->>'rank')::integer;
      if decision is null or decision not in ('Technical Pending','Technical Qualified','Technical Rejected','Financial Opened','Lost')
        or (decision='Financial Opened' and lot.evaluation not in ('Technical Qualified','Financial Opened'))
        or (lot.evaluation='Financial Opened' and decision not in ('Financial Opened','Lost'))
        or (lot.evaluation='Technical Qualified' and decision='Technical Pending')
        or (rank is not null and decision<>'Financial Opened') then
        raise exception 'Choose a valid lot evaluation transition' using errcode='22023';
      end if;
      event_payload := jsonb_build_object('lot',lot.id,'from',lot.evaluation,'state',decision,'rank',rank,
        'reason',private.tender_text(p_payload->>'reason',1000,true));
      update private.tender_lots set evaluation=decision,observed_rank=coalesce(rank,observed_rank) where id=lot.id;
    else
      quantity := private.tender_amount(p_payload->>'quantity',3);
      amount := private.tender_amount(p_payload->>'value',2);
      actual_at := private.tender_time(p_payload->>'awarded_at');
      if lot.evaluation<>'Financial Opened' or quantity is null or quantity<=0 or quantity>lot.offered_quantity
        or amount is null or actual_at>now() or actual_at<(select (e.payload->>'submitted_at')::timestamptz
          from private.tender_events e where e.tender_id=target and e.kind='record_submission') then
        raise exception 'Open financial evaluation and enter an evidenced award within the offered quantity' using errcode='22023';
      end if;
      evidence := private.tender_evidence(org,target,(p_payload->>'file')::uuid);
      event_payload := jsonb_build_object('lot',lot.id,'customer',private.tender_text(p_payload->>'customer',250),
        'contract',private.tender_text(p_payload->>'contract',250),'quantity',quantity::text,'value',amount::text,
        'currency',tender.currency,'awarded_at',actual_at,'evidence',evidence);
      update private.tender_lots set evaluation='Awarded' where id=lot.id;
    end if;
    update private.tenders set lifecycle='Under Evaluation' where id=target;
  when 'cancel','close','reopen' then
    reason := private.tender_text(p_payload->>'reason',1000);
    if p_action='cancel' and tender.lifecycle in ('Identified','Preparing') then
      if p_payload->>'file' is not null then evidence := private.tender_evidence(org,target,(p_payload->>'file')::uuid); end if;
      decision := 'Cancelled';
    elsif p_action='close' and tender.lifecycle in ('Submitted','Under Evaluation') and not exists (
      select 1 from private.tender_lots l where l.tender_id=target and l.evaluation not in ('Awarded','Lost','Technical Rejected')
    ) then
      decision := 'Closed';
    elsif p_action='reopen' and (tender.lifecycle='Cancelled' or tender.lifecycle='Preparing'
      or (tender.lifecycle='Identified' and tender.bid_decision='No Go')) then
      decision := 'Identified';
      update private.tenders set bid_decision='Pending',bid_approval_version=null,bid_term_revision=bid_term_revision+1 where id=target;
      update private.tender_checklist set reviewed_by=null,reviewed_at=null,waiver_policy=null,waiver_reason=null
      where organization_id=org and tender_id=target;
    else
      raise exception 'Choose an available lifecycle action. Resolve every lot before closure.' using errcode='22023';
    end if;
    update private.tenders set lifecycle=decision where id=target;
    perform private.tender_reschedule(org,target,tender.bid_term_revision+case when p_action='reopen' then 1 else 0 end,
      case when p_action='reopen' then tender.deadline end);
    event_payload := jsonb_build_object('from',tender.lifecycle,'state',decision,'reason',reason,'policy',policy,'evidence',evidence);
  else
    event_payload := private.tender_execution_command(org,target,p_action,p_payload);
  end case;

  if p_action<>'register' then update private.tenders set version=version+1 where id=target returning * into tender; end if;
  insert into private.tender_events(organization_id,tender_id,tender_version,kind,actor,payload)
  values(org,target,tender.version,p_action,actor,event_payload);
  output := jsonb_build_object('id',target,'version',tender.version);
  insert into private.audit_events(organization_id,actor_membership_id,resource_id,action,request_id,redacted_details)
  values(org,actor,target,'tender.'||p_action,p_request_key,jsonb_build_object('version',tender.version,'policy_id',policy));
  insert into private.operation_receipts(organization_id,actor_membership_id,operation_key,command_type,request_hash,response_snapshot)
  values(org,actor,p_request_key,'tender.'||p_action,input_hash,output);
  return output;
end
$$;

create function private.tender_workspace(p_organization_id uuid,p_tender_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare
  org uuid := p_organization_id;
  actor uuid := private.tender_actor(org);
  target uuid := p_tender_id;
  tender private.tenders%rowtype;
  owner uuid;
  can_register boolean;
  can_assign boolean;
begin
  if actor is null then raise exception 'Tender access denied' using errcode='42501'; end if;
  can_register := private.tender_has_access(org,actor,'tender.edit');
  can_assign := can_register and private.tender_has_access(org,actor,'tender.read_all');
  if target is null then
    return jsonb_build_object(
      'can_register',can_register,
      'owners',case when can_assign then (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',p.display_name) order by p.display_name,m.id),'[]'::jsonb)
        from public.memberships m join public.profiles p on p.id=m.user_id
        where m.organization_id=org and m.status='Active' and private.tender_has_access(org,m.id,'tender.edit') and private.tender_has_access(org,m.id,'tender.read'))
        else '[]'::jsonb end,
      'records', (select coalesce(jsonb_agg(to_jsonb(registry) order by registry.deadline,registry.id),'[]'::jsonb)
        from (select t.id,t.authority,t.portal,t.reference,t.lifecycle,t.bid_decision,t.deadline,t.source_timezone,t.geography,
          t.estimate::text,t.currency,profile.display_name as owner_name,
          (select count(*) from private.tender_checklist c where c.organization_id=org and c.tender_id=t.id and c.mandatory) as required_items,
          (select count(*) from private.tender_checklist c where c.organization_id=org and c.tender_id=t.id and c.mandatory
            and c.reviewed_by is not null and (c.valid_until is null or c.valid_until>=(now() at time zone t.source_timezone)::date or c.waiver_policy is not null)) as reviewed_items
          from private.tenders t join public.resources r on (r.organization_id,r.id)=(t.organization_id,t.id)
          join public.memberships m on (m.organization_id,m.id)=(r.organization_id,r.owner_membership_id)
          join public.profiles profile on profile.id=m.user_id
          where t.organization_id=org and private.tender_can_view(org,t.id,actor)) registry)
    );
  end if;
  if not private.tender_can_view(org,target,actor) then raise exception 'Tender access denied' using errcode='42501'; end if;
  select * into tender from private.tenders t where t.organization_id=org and t.id=target;
  select r.owner_membership_id into owner from public.resources r where r.organization_id=org and r.id=target;
  return jsonb_build_object(
    'record', (to_jsonb(tender)-array['organization_id','bid_approval_version'])||jsonb_build_object(
      'estimate',tender.estimate::text,'fees',tender.fees::text,'owner',owner,
      'owner_name',(select p.display_name from public.memberships m join public.profiles p on p.id=m.user_id where m.id=owner and m.organization_id=org)),
    'can_edit',owner=actor and can_register,
    'can_review',private.tender_policy(org,owner,actor,'bid',tender.estimate) is not null,
    'can_waive',private.tender_policy(org,owner,actor,'waiver',tender.estimate) is not null,
    'can_submit',private.tender_policy(org,owner,actor,'submission',tender.estimate) is not null,
    'lots',(select coalesce(jsonb_agg((to_jsonb(l)-array['organization_id','tender_id'])||jsonb_build_object('offered_quantity',l.offered_quantity::text)
      order by l.lot_number),'[]'::jsonb) from private.tender_lots l where l.organization_id=org and l.tender_id=target),
    'checklist',(select coalesce(jsonb_agg(to_jsonb(c)-array['organization_id','tender_id'] order by c.title,c.id),'[]'::jsonb)
      from private.tender_checklist c where c.organization_id=org and c.tender_id=target),
    'events',(select coalesce(jsonb_agg(history.item order by history.version desc),'[]'::jsonb)
      from (select (to_jsonb(e)-array['organization_id','tender_id','actor'])||jsonb_build_object('actor_name',p.display_name) as item,
        e.tender_version as version from private.tender_events e join public.memberships m on (m.organization_id,m.id)=(e.organization_id,e.actor)
        join public.profiles p on p.id=m.user_id where e.organization_id=org and e.tender_id=target
        order by e.tender_version desc) history),
    'reminders',(select coalesce(jsonb_agg(jsonb_build_object('days_before',r.days_before,'due_at',r.due_at) order by r.due_at),'[]'::jsonb)
      from private.tender_reminders r where r.organization_id=org and r.tender_id=target and r.cancelled_at is null),
    'readiness',private.tender_readiness(org,target,(now() at time zone tender.source_timezone)::date),
    'tracking',private.tender_execution_workspace(org,target,(now() at time zone tender.source_timezone)::date),
    'files',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.original_name,'status',case
      when f.verdict='clean' then 'Available' when f.verdict='rejected' then 'Rejected'
      when s.expires_at<=now() then 'Expired' when f.stored_at is not null then 'Awaiting scan' else 'Pending upload' end)
      order by s.created_at desc,s.id),'[]'::jsonb)
      from private.file_upload_stages s left join private.file_upload_objects f on f.stage_id=s.id
      where s.organization_id=org and s.parent_resource_id=target and s.purpose='business_document'
        and (f.verdict='clean' or s.uploader_membership_id=actor))
  );
end
$$;

revoke all on function
  private.tender_actor(uuid),
  private.tender_has_access(uuid,uuid,text),
  private.tender_policy(uuid,uuid,uuid,text,numeric),
  private.tender_text(text,integer,boolean),
  private.tender_time(text),
  private.tender_amount(text,integer),
  private.tender_evidence(uuid,uuid,uuid),
  private.tender_readiness(uuid,uuid,date),
  private.tender_can_view(uuid,uuid,uuid),
  private.tender_reschedule(uuid,uuid,integer,timestamptz),
  private.execute_tender_command(uuid,text,jsonb,uuid,uuid,integer),
  private.tender_workspace(uuid,uuid)
from public,anon,authenticated,service_role;

grant execute on function private.execute_tender_command(uuid,text,jsonb,uuid,uuid,integer),
  private.tender_workspace(uuid,uuid) to authenticated;

create function public.execute_tender_command(
  p_organization_id uuid,p_action text,p_payload jsonb,p_request_key uuid,p_tender_id uuid default null,p_expected_version integer default null
) returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select private.execute_tender_command(p_organization_id,p_action,p_payload,p_request_key,p_tender_id,p_expected_version)
$$;
create function public.tender_workspace(p_organization_id uuid,p_tender_id uuid default null)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select private.tender_workspace(p_organization_id,p_tender_id)
$$;
revoke all on function public.execute_tender_command(uuid,text,jsonb,uuid,uuid,integer),
  public.tender_workspace(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.execute_tender_command(uuid,text,jsonb,uuid,uuid,integer),
  public.tender_workspace(uuid,uuid) to authenticated;
