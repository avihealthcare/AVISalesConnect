-- Operational tender tracking leaves submitted terms and award evidence immutable.
-- If a transition needs correction, retain the original events and use a forward correction.
create table private.tender_securities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tender_id uuid not null,
  lot_id uuid,
  kind text not null check(kind in ('EMD','PBG')),
  instrument text not null check(length(instrument) between 1 and 120),
  amount numeric(18,2) not null check(amount>=0),
  issuer text not null check(length(issuer) between 1 and 250),
  reference text not null check(length(reference) between 1 and 250),
  issued_on date check(isfinite(issued_on)),
  expires_on date check(isfinite(expires_on)),
  next_follow_up date check(isfinite(next_follow_up)),
  exemption_evidence uuid references private.file_upload_stages(id),
  state text not null default 'Draft' check(state in ('Draft','Submitted','Active','Release Requested','Released','Forfeited','Cancelled')),
  unique(organization_id,tender_id,kind,reference),
  foreign key(organization_id,tender_id) references private.tenders(organization_id,id),
  foreign key(organization_id,tender_id,lot_id) references private.tender_lots(organization_id,tender_id,id),
  check(kind<>'PBG' or lot_id is not null),
  check((exemption_evidence is not null and amount=0) or (exemption_evidence is null and amount>0
    and issued_on is not null and expires_on is not null and expires_on>=issued_on))
);

create table private.tender_execution_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tender_id uuid not null,
  lot_id uuid not null,
  kind text not null check(kind in ('Dispatched','Installed','Accepted')),
  quantity numeric(18,3) not null check(quantity>0),
  happened_at timestamptz not null check(isfinite(happened_at)),
  reference text not null check(length(reference) between 1 and 250),
  evidence_id uuid not null references private.file_upload_stages(id),
  foreign key(organization_id,tender_id,lot_id) references private.tender_lots(organization_id,tender_id,id)
);
create index tender_execution_lot_idx on private.tender_execution_entries(organization_id,tender_id,lot_id);
create trigger tender_execution_append_only before update or delete or truncate on private.tender_execution_entries
for each statement execute function private.reject_mutation();

create table private.tender_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tender_id uuid not null,
  lot_id uuid not null,
  reference text not null check(length(reference) between 1 and 250),
  due_on date not null check(isfinite(due_on)),
  amount numeric(18,2) not null check(amount>0),
  paid numeric(18,2) not null default 0 check(paid>=0 and paid<=amount),
  next_follow_up date check(isfinite(next_follow_up)),
  foreign key(organization_id,tender_id,lot_id) references private.tender_lots(organization_id,tender_id,id)
);
create unique index tender_invoice_reference_key on private.tender_invoices(organization_id,tender_id,lower(reference));

create table private.tender_prebid (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tender_id uuid not null,
  issue text not null check(length(issue) between 1 and 1000),
  change_requested text not null check(length(change_requested) between 1 and 1000),
  responsible_person text not null check(length(responsible_person) between 1 and 250),
  submitted_at timestamptz check(isfinite(submitted_at)),
  submission_reference text,
  reply_at timestamptz check(isfinite(reply_at)),
  reply text,
  foreign key(organization_id,tender_id) references private.tenders(organization_id,id),
  check((submitted_at is null)=(submission_reference is null)),
  check((reply_at is null)=(reply is null)),
  check(reply_at is null or reply_at>=submitted_at and submitted_at is not null)
);
create index tender_prebid_record_idx on private.tender_prebid(organization_id,tender_id);

do $$
declare table_name text;
begin
  foreach table_name in array array['tender_securities','tender_execution_entries','tender_invoices','tender_prebid'] loop
    execute format('alter table private.%I enable row level security',table_name);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',table_name);
  end loop;
end
$$;

create function private.tender_date(p_value text,p_required boolean default true) returns date
language plpgsql immutable security invoker set search_path=pg_catalog as $$
begin
  if (p_value is null and p_required) or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Enter a valid calendar date' using errcode='22023';
  end if;
  return p_value::date;
end
$$;

create function private.tender_execution_command(p_org uuid,p_id uuid,p_action text,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare
  t private.tenders%rowtype;
  s private.tender_securities%rowtype;
  i private.tender_invoices%rowtype;
  q private.tender_prebid%rowtype;
  e private.tender_execution_entries%rowtype;
  target uuid;
  lot uuid := nullif(p_input->>'lot','')::uuid;
  award jsonb;
  proof jsonb;
  stage uuid := nullif(p_input->>'file','')::uuid;
  movement text;
  note text;
  reference_value text;
  quantity numeric;
  delta numeric;
  dispatched numeric;
  installed numeric;
  accepted numeric;
  when_at timestamptz;
  local_day date;
  next_day date;
  deadline_day date;
begin
  -- The caller serializes each tender and enforces current ownership, membership and action scope.
  select * into strict t from private.tenders where organization_id=p_org and id=p_id;
  local_day := (now() at time zone t.source_timezone)::date;
  if lot is not null then
    select payload into award from private.tender_events
    where organization_id=p_org and tender_id=p_id and kind='award_lot' and payload->>'lot'=lot::text;
    if award is null then raise exception 'Select an awarded lot for this action' using errcode='22023'; end if;
  end if;
  case p_action
  when 'security_add' then
    movement := p_input->>'kind';
    if movement is null or movement not in ('EMD','PBG') or (movement='PBG' and award is null) then
      raise exception 'Select an EMD or an awarded lot for PBG' using errcode='22023';
    end if;
    if stage is not null then proof := private.tender_evidence(p_org,p_id,stage); end if;
    delta := private.tender_amount(p_input->>'amount',2);
    insert into private.tender_securities(organization_id,tender_id,lot_id,kind,instrument,amount,issuer,reference,
      issued_on,expires_on,next_follow_up,exemption_evidence)
    values(p_org,p_id,lot,movement,private.tender_text(p_input->>'instrument',120),delta,private.tender_text(p_input->>'issuer',250),
      private.tender_text(p_input->>'reference',250),private.tender_date(p_input->>'issued_on',stage is null),
      private.tender_date(p_input->>'expires_on',stage is null),private.tender_date(p_input->>'follow_up',false),stage)
    returning * into s;
    return jsonb_build_object('security',s.id,'kind',movement,'state',s.state,'evidence',proof);
  when 'security_step','security_extend' then
    target := (p_input->>'security')::uuid;
    select * into s from private.tender_securities where id=target and organization_id=p_org and tender_id=p_id;
    if not found then raise exception 'Security record unavailable' using errcode='22023'; end if;
    note := private.tender_text(p_input->>'reason',1000);
    if p_action='security_extend' then
      deadline_day := private.tender_date(p_input->>'expires_on');
      if s.kind<>'PBG' or s.state not in ('Submitted','Active','Release Requested') or s.expires_on is null
        or deadline_day<=s.expires_on or deadline_day<=local_day then
        raise exception 'Choose a later expiry for an outstanding PBG' using errcode='22023';
      end if;
      proof := private.tender_evidence(p_org,p_id,stage);
      update private.tender_securities set expires_on=deadline_day where id=target;
      return jsonb_build_object('security',target,'previous_expiry',s.expires_on,'new_expiry',deadline_day,'reason',note,'evidence',proof);
    end if;
    movement := p_input->>'state';
    if movement is null or not (
      (s.state='Draft' and movement in ('Submitted','Cancelled'))
      or (s.state='Submitted' and movement in ('Active','Forfeited'))
      or (s.state='Active' and movement in ('Release Requested','Forfeited'))
      or (s.state='Release Requested' and movement in ('Released','Forfeited'))
    ) then raise exception 'Choose an available security transition' using errcode='22023'; end if;
    if s.issued_on>local_day and movement='Submitted' then
      raise exception 'Issue date must have occurred before submission' using errcode='22023';
    end if;
    next_day := private.tender_date(p_input->>'follow_up',movement='Release Requested');
    deadline_day := private.tender_date(p_input->>'occurred_on');
    if deadline_day>local_day or (movement<>'Cancelled' and deadline_day<s.issued_on) then
      raise exception 'Enter a valid historical security action date' using errcode='22023';
    end if;
    reference_value := private.tender_text(p_input->>'reference',250,movement in ('Released','Forfeited'));
    if stage is not null or (movement='Submitted' and s.exemption_evidence is null) or movement in ('Released','Forfeited') then
      proof := private.tender_evidence(p_org,p_id,stage);
    end if;
    update private.tender_securities set state=movement,next_follow_up=case when movement not in ('Released','Forfeited','Cancelled')
      then coalesce(next_day,next_follow_up) end where id=target;
    return jsonb_build_object('security',target,'previous_state',s.state,'state',movement,'occurred_on',deadline_day,
      'reason',note,'reference',reference_value,'evidence',proof,'follow_up',next_day);
  when 'execution_entry' then
    movement := p_input->>'kind';
    quantity := private.tender_amount(p_input->>'quantity',3);
    when_at := private.tender_time(p_input->>'happened_at');
    if award is null or movement is null or movement not in ('Dispatched','Installed','Accepted') or quantity is null or quantity<=0
      or when_at>now() or when_at<(award->>'awarded_at')::timestamptz then
      raise exception 'Select an awarded lot, positive quantity and historical execution time' using errcode='22023';
    end if;
    select coalesce(sum(ent.quantity) filter(where ent.kind='Dispatched'),0),
      coalesce(sum(ent.quantity) filter(where ent.kind='Installed'),0),coalesce(sum(ent.quantity) filter(where ent.kind='Accepted'),0)
    into dispatched,installed,accepted from private.tender_execution_entries ent
    where ent.organization_id=p_org and ent.tender_id=p_id and ent.lot_id=lot;
    if (movement='Dispatched' and dispatched+quantity>(award->>'quantity')::numeric)
      or (movement='Installed' and installed+quantity>dispatched)
      or (movement='Accepted' and accepted+quantity>installed) then
      raise exception 'Quantity exceeds the awarded, dispatched or installed balance' using errcode='22023';
    end if;
    proof := private.tender_evidence(p_org,p_id,stage);
    insert into private.tender_execution_entries(organization_id,tender_id,lot_id,kind,quantity,happened_at,reference,evidence_id)
    values(p_org,p_id,lot,movement,quantity,when_at,private.tender_text(p_input->>'reference',250),stage)
    returning * into e;
    return jsonb_build_object('entry',e.id,'lot',lot,'kind',movement,'quantity',quantity::text,
      'happened_at',when_at,'reference',e.reference,'evidence',proof);
  when 'invoice_add' then
    delta := private.tender_amount(p_input->>'amount',2);
    deadline_day := private.tender_date(p_input->>'due_on');
    if award is null or delta is null or delta<=0 then
      raise exception 'Select an awarded lot and enter a positive invoiced amount' using errcode='22023';
    end if;
    proof := private.tender_evidence(p_org,p_id,stage);
    insert into private.tender_invoices(organization_id,tender_id,lot_id,reference,due_on,amount,next_follow_up)
    values(p_org,p_id,lot,private.tender_text(p_input->>'reference',250),deadline_day,delta,
      private.tender_date(p_input->>'follow_up',false)) returning * into i;
    return jsonb_build_object('invoice',i.id,'lot',lot,'reference',i.reference,'amount',delta::text,'due_on',deadline_day,'evidence',proof);
  when 'invoice_follow_up' then
    target := (p_input->>'invoice')::uuid;
    select * into i from private.tender_invoices where id=target and organization_id=p_org and tender_id=p_id;
    if not found or i.paid=i.amount then raise exception 'Choose an outstanding invoice' using errcode='22023'; end if;
    delta := coalesce(private.tender_amount(p_input->>'received',2),0);
    when_at := private.tender_time(p_input->>'happened_at');
    next_day := private.tender_date(p_input->>'follow_up',delta=0);
    if when_at>now() or i.paid+delta>i.amount then
      raise exception 'Recorded receipts cannot exceed the invoice balance or be dated in the future' using errcode='22023';
    end if;
    if delta>0 or stage is not null then proof := private.tender_evidence(p_org,p_id,stage); end if;
    reference_value := private.tender_text(p_input->>'reference',250,delta>0);
    update private.tender_invoices set paid=paid+delta,next_follow_up=case when paid+delta<private.tender_invoices.amount
      then coalesce(next_day,next_follow_up) end where id=target;
    return jsonb_build_object('invoice',target,'received',delta::text,'happened_at',when_at,'reference',reference_value,
      'reason',private.tender_text(p_input->>'reason',1000),'follow_up',next_day,'evidence',proof);
  when 'prebid_add' then
    if t.lifecycle not in ('Identified','Preparing') then raise exception 'Pre-bid queries start before submission' using errcode='22023'; end if;
    insert into private.tender_prebid(organization_id,tender_id,issue,change_requested,responsible_person)
    values(p_org,p_id,private.tender_text(p_input->>'issue',1000),private.tender_text(p_input->>'change',1000),
      private.tender_text(p_input->>'responsible',250)) returning * into q;
    return jsonb_build_object('query',q.id,'issue',q.issue);
  when 'prebid_submit','prebid_reply' then
    target := (p_input->>'query')::uuid;
    select * into q from private.tender_prebid where id=target and organization_id=p_org and tender_id=p_id;
    if not found then raise exception 'Pre-bid query unavailable' using errcode='22023'; end if;
    when_at := private.tender_time(p_input->>'happened_at');
    if when_at>now() or (p_action='prebid_submit' and (q.submitted_at is not null or when_at>t.deadline))
      or (p_action='prebid_reply' and (q.submitted_at is null or q.reply_at is not null or when_at<q.submitted_at)) then
      raise exception 'Enter a valid query submission or reply after the preceding event' using errcode='22023';
    end if;
    if stage is not null then proof := private.tender_evidence(p_org,p_id,stage); end if;
    if p_action='prebid_submit' then
      note := private.tender_text(p_input->>'reference',250);
      update private.tender_prebid set submitted_at=when_at,submission_reference=note where id=target;
    else
      note := private.tender_text(p_input->>'response',2000);
      update private.tender_prebid set reply_at=when_at,reply=note where id=target;
    end if;
    return jsonb_build_object('query',target,'happened_at',when_at,'notes',note,'evidence',proof);
  when 'observe_competitor' then
    note := private.tender_text(p_input->>'confidence',10);
    deadline_day := private.tender_date(p_input->>'observed_on');
    if note not in ('Low','Medium','High') or deadline_day>local_day then
      raise exception 'Enter a historical observation date and confidence level' using errcode='22023';
    end if;
    return jsonb_build_object('competitor',private.tender_text(p_input->>'competitor',250),
      'observation',private.tender_text(p_input->>'observation',1500),'source',private.tender_text(p_input->>'source',500),
      'confidence',note,'observed_on',deadline_day);
  else
    raise exception 'Invalid tender tracking command' using errcode='22023';
  end case;
end
$$;

create function private.tender_execution_workspace(p_org uuid,p_id uuid,p_day date)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select jsonb_build_object(
    'securities',(select coalesce(jsonb_agg((to_jsonb(s)-array['organization_id','tender_id']) || jsonb_build_object(
      'amount',s.amount::text,'expired',s.expires_on<p_day and s.state not in ('Released','Forfeited','Cancelled'),
      'follow_up_due',s.state not in ('Released','Forfeited','Cancelled') and s.next_follow_up<=p_day)
      order by s.expires_on nulls last,s.id),'[]'::jsonb)
      from private.tender_securities s where s.organization_id=p_org and s.tender_id=p_id),
    'execution',(select coalesce(jsonb_agg((to_jsonb(e)-array['organization_id','tender_id']) || jsonb_build_object('quantity',e.quantity::text)
      order by e.happened_at desc,e.id),'[]'::jsonb) from private.tender_execution_entries e where e.organization_id=p_org and e.tender_id=p_id),
    'invoices',(select coalesce(jsonb_agg((to_jsonb(i)-array['organization_id','tender_id']) || jsonb_build_object(
      'amount',i.amount::text,'paid',i.paid::text,'outstanding',(i.amount-i.paid)::text,'overdue',i.paid<i.amount and i.due_on<p_day)
      order by i.due_on,i.id),'[]'::jsonb) from private.tender_invoices i where i.organization_id=p_org and i.tender_id=p_id),
    'prebid',(select coalesce(jsonb_agg(to_jsonb(q)-array['organization_id','tender_id'] order by q.id),'[]'::jsonb)
      from private.tender_prebid q where q.organization_id=p_org and q.tender_id=p_id)
  )
$$;
revoke all on function private.tender_date(text,boolean),private.tender_execution_command(uuid,uuid,text,jsonb),
  private.tender_execution_workspace(uuid,uuid,date) from public,anon,authenticated,service_role;
