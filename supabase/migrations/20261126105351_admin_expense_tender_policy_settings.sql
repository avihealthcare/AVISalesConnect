create table private.operating_policy_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  section text not null check (section in ('expense','tender')),
  revision integer not null check (revision > 0),
  effective_on date not null check (isfinite(effective_on)),
  settings jsonb not null check (jsonb_typeof(settings) = 'object'),
  published_by uuid not null,
  published_at timestamptz not null default now(),
  unique (organization_id, section, revision),
  unique (organization_id, id),
  foreign key (organization_id,published_by) references public.memberships(organization_id,id)
);
create index operating_policy_effective_idx on private.operating_policy_versions
  (organization_id,section,effective_on desc,revision desc);
alter table private.operating_policy_versions enable row level security;
revoke all on private.operating_policy_versions from public, anon, authenticated;
create trigger operating_policy_append_only before update or delete or truncate on private.operating_policy_versions
  for each statement execute function private.reject_mutation();

create function private.policy_settings_actor(p_org uuid) returns uuid
language sql stable security invoker set search_path=pg_catalog as $$
  select m.id from public.memberships m
  join auth.sessions s on s.user_id=m.user_id and s.id=nullif(auth.jwt()->>'session_id','')::uuid
  where m.organization_id=p_org and m.user_id=auth.uid() and m.status='Active'
    and auth.jwt()->>'aal'='aal2' and s.aal::text='aal2' and (s.not_after is null or s.not_after>now())
    and exists (
      select 1 from public.member_roles mr join public.roles r
        on (r.organization_id,r.id)=(mr.organization_id,mr.role_id)
      where mr.organization_id=p_org and mr.membership_id=m.id and r.code='super_admin'
        and mr.effective_from<=now() and (mr.effective_to is null or mr.effective_to>now())
    )
$$;
revoke all on function private.policy_settings_actor(uuid) from public, anon, authenticated;

create function private.read_operating_policy_settings(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
  if private.policy_settings_actor(p_org) is null then
    raise exception 'Policy settings access denied' using errcode='42501';
  end if;
  return (
    select jsonb_build_object(
      'currency', o.base_currency, 'today', (now() at time zone o.timezone)::date,
      'expense', (select to_jsonb(v) - array['organization_id','published_by','section']
        from private.operating_policy_versions v
        where v.organization_id=p_org and v.section='expense' order by revision desc limit 1),
      'tender', (select to_jsonb(v) - array['organization_id','published_by','section']
        from private.operating_policy_versions v
        where v.organization_id=p_org and v.section='tender' order by revision desc limit 1)
    ) from public.organizations o where o.id=p_org
  );
end
$$;
revoke all on function private.read_operating_policy_settings(uuid) from public, anon, authenticated;
grant execute on function private.read_operating_policy_settings(uuid) to authenticated;

create function private.validate_operating_policy(p_org uuid,p_section text,p_settings jsonb) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
declare
  item jsonb;
  field text;
  value text;
  primary_member uuid;
  alternate_member uuid;
  subject_member uuid;
  decimal_pattern constant text := '^(0|[1-9][0-9]{0,15})([.][0-9]{1,2})?$';
  scope_pattern constant text := '^([A-Z][A-Z0-9_-]{0,30}|[*])$';
begin
  if jsonb_typeof(p_settings) is distinct from 'object' or octet_length(p_settings::text)>65536
     or p_settings - array['rules','routes'] <> '{}'::jsonb
     or jsonb_typeof(p_settings->'routes') is distinct from 'array'
     or jsonb_typeof(p_settings->'rules') is distinct from 'array' then
    raise exception 'Invalid policy settings' using errcode='22023';
  end if;
  if jsonb_array_length(p_settings->'routes')>100 or jsonb_array_length(p_settings->'rules')>200
     or (p_section='tender' and jsonb_array_length(p_settings->'rules')<>0) then
    raise exception 'Invalid number of policy rows' using errcode='22023';
  end if;

  for item in select elem from jsonb_array_elements(p_settings->'rules') as rules(elem) loop
    if jsonb_typeof(item) is distinct from 'object' or item - array[
      'category','grade','geography','travel_type','calculation','rate','cap','receipt_threshold',
      'tax_included','prepayment_allowed','exception_allowed','travel_approval_required','partial_day'
    ] <> '{}'::jsonb then
      raise exception 'Invalid expense policy row' using errcode='22023';
    end if;
    foreach field in array array['category','grade','geography','travel_type'] loop
      value := item->>field;
      if jsonb_typeof(item->field) is distinct from 'string' or value !~ scope_pattern
         or (field='category' and value='*') then
        raise exception 'Use a valid expense category and scope' using errcode='22023';
      end if;
    end loop;
    if coalesce(item->>'calculation','') not in ('actual','mileage','daily')
       or coalesce(item->>'partial_day','') not in ('none','half') then
      raise exception 'Invalid expense calculation' using errcode='22023';
    end if;
    foreach field in array array['rate','cap','receipt_threshold'] loop
      if item->>field is not null and (jsonb_typeof(item->field) <> 'string' or item->>field !~ decimal_pattern) then
        raise exception 'Enter a nonnegative amount with up to two decimal places' using errcode='22023';
      end if;
    end loop;
    if (item->>'calculation'='actual') <> (item->>'rate' is null)
       or (item->>'calculation'<>'daily' and item->>'partial_day'<>'none') then
      raise exception 'Rate and partial-day rule must match the calculation' using errcode='22023';
    end if;
    foreach field in array array['tax_included','prepayment_allowed','exception_allowed','travel_approval_required'] loop
      if jsonb_typeof(item->field) is distinct from 'boolean' then
        raise exception 'Invalid expense policy option' using errcode='22023';
      end if;
    end loop;
  end loop;

  if exists (
    select 1 from jsonb_array_elements(p_settings->'rules') as rules(elem)
    group by elem->>'category',elem->>'grade',elem->>'geography',elem->>'travel_type' having count(*)>1
  ) then raise exception 'Duplicate expense policy scope' using errcode='22023'; end if;

  if exists (
    with candidates as (
      select position, elem->>'category' as category, elem->>'grade' as grade,
        elem->>'geography' as geography, elem->>'travel_type' as travel,
        ((elem->>'grade'<>'*')::int + (elem->>'geography'<>'*')::int + (elem->>'travel_type'<>'*')::int) as specificity
      from jsonb_array_elements(p_settings->'rules') with ordinality as rules(elem,position)
    )
    select 1 from candidates a join candidates b on a.position < b.position
      and a.category=b.category and a.specificity=b.specificity
      and (a.grade=b.grade or '*' in (a.grade,b.grade))
      and (a.geography=b.geography or '*' in (a.geography,b.geography))
      and (a.travel=b.travel or '*' in (a.travel,b.travel))
  ) then raise exception 'Expense rules overlap at the same scope priority' using errcode='22023'; end if;

  for item in select elem from jsonb_array_elements(p_settings->'routes') as routes(elem) loop
    if jsonb_typeof(item) is distinct from 'object'
       or item - array['process','subject','primary','alternate','limit'] <> '{}'::jsonb
       or (p_section='tender' and coalesce(item->>'process','') not in ('bid','submission','waiver'))
       or (p_section='expense' and coalesce(item->>'process','') not in ('travel','manager','finance')) then
      raise exception 'Invalid approval route' using errcode='22023';
    end if;
    primary_member := nullif(item->>'primary','')::uuid;
    alternate_member := nullif(item->>'alternate','')::uuid;
    subject_member := nullif(item->>'subject','')::uuid;
    if primary_member is null or primary_member=alternate_member
       or subject_member=primary_member or subject_member=alternate_member
       or not exists (select 1 from public.memberships m where m.organization_id=p_org and m.id=primary_member and m.status='Active')
       or (alternate_member is not null and not exists (
         select 1 from public.memberships m where m.organization_id=p_org and m.id=alternate_member and m.status='Active'))
       or (subject_member is not null and not exists (
         select 1 from public.memberships m where m.organization_id=p_org and m.id=subject_member and m.status='Active')) then
      raise exception 'Choose distinct active staff from this organization' using errcode='22023';
    end if;
    if item->>'limit' is not null and (jsonb_typeof(item->'limit') <> 'string' or item->>'limit' !~ decimal_pattern) then
      raise exception 'Invalid approval amount limit' using errcode='22023';
    end if;
  end loop;
  if exists (
    select 1 from jsonb_array_elements(p_settings->'routes') as routes(elem)
    group by elem->>'process',nullif(elem->>'subject','')::uuid having count(*)>1
  ) then raise exception 'Duplicate approval route' using errcode='22023'; end if;
end
$$;
revoke all on function private.validate_operating_policy(uuid,text,jsonb) from public, anon, authenticated;

create function private.publish_operating_policy_settings(
  p_org uuid,p_section text,p_expected uuid,p_effective_on date,p_settings jsonb,p_key uuid
) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare
  actor uuid := private.policy_settings_actor(p_org);
  previous private.operating_policy_versions%rowtype;
  receipt private.operation_receipts%rowtype;
  payload_hash text;
  saved_id uuid;
  business_date date;
begin
  if actor is null then raise exception 'Policy settings access denied' using errcode='42501'; end if;
  if p_key is null or p_section is null or p_section not in ('expense','tender')
     or p_effective_on is null or not isfinite(p_effective_on) then
    raise exception 'Invalid policy revision' using errcode='22023';
  end if;
  perform 1 from public.memberships where organization_id=p_org and id=actor and status='Active' for share;
  if not found then raise exception 'Policy settings access denied' using errcode='42501'; end if;

  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':' || p_key::text,0));
  payload_hash := encode(sha256(convert_to(jsonb_build_array(
    p_section,p_expected,p_effective_on - date '2000-01-01',p_settings
  )::text,'UTF8')),'hex');
  select * into receipt from private.operation_receipts
  where organization_id=p_org and actor_membership_id=actor and operation_key=p_key;
  if found then
    if receipt.command_type<>'admin.policy.publish' or receipt.request_hash<>payload_hash then
      raise sqlstate 'PT409' using message='Operation key is already in use';
    end if;
    return (receipt.response_snapshot->>'id')::uuid;
  end if;
  perform pg_advisory_xact_lock(hashtext('avi-operating-policy:' || p_section),hashtext(p_org::text));
  if private.policy_settings_actor(p_org) is distinct from actor then
    raise exception 'Policy settings access denied' using errcode='42501';
  end if;
  select * into previous from private.operating_policy_versions
  where organization_id=p_org and section=p_section order by revision desc limit 1;
  if previous.id is distinct from p_expected then
    raise sqlstate 'PT409' using message='Policy changed. Reload and review the latest revision.';
  end if;
  select (now() at time zone timezone)::date into business_date from public.organizations where id=p_org;
  if p_effective_on<business_date then
    raise exception 'The effective date cannot be in the past' using errcode='22023';
  end if;
  perform private.validate_operating_policy(p_org,p_section,p_settings);
  insert into private.operating_policy_versions(organization_id,section,revision,effective_on,settings,published_by)
  values(p_org,p_section,coalesce(previous.revision,0)+1,p_effective_on,p_settings,actor)
  returning id into saved_id;
  insert into private.audit_events(organization_id,actor_membership_id,action,request_id,redacted_details)
  values(p_org,actor,'admin.policy.publish',p_key,jsonb_build_object('section',p_section,'version_id',saved_id,'previous_version_id',previous.id));
  insert into private.operation_receipts(organization_id,actor_membership_id,operation_key,command_type,request_hash,response_snapshot)
  values(p_org,actor,p_key,'admin.policy.publish',payload_hash,jsonb_build_object('id',saved_id));
  return saved_id;
end
$$;
revoke all on function private.publish_operating_policy_settings(uuid,text,uuid,date,jsonb,uuid) from public, anon, authenticated;
grant execute on function private.publish_operating_policy_settings(uuid,text,uuid,date,jsonb,uuid) to authenticated;

create function public.read_operating_policy_settings(p_org uuid) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
  select private.read_operating_policy_settings(p_org)
$$;
revoke all on function public.read_operating_policy_settings(uuid) from public, anon, authenticated;
grant execute on function public.read_operating_policy_settings(uuid) to authenticated;

create function public.publish_operating_policy_settings(
  p_org uuid,p_section text,p_expected uuid,p_effective_on date,p_settings jsonb,p_key uuid
) returns uuid
language sql security invoker set search_path=pg_catalog as $$
  select private.publish_operating_policy_settings(p_org,p_section,p_expected,p_effective_on,p_settings,p_key)
$$;
revoke all on function public.publish_operating_policy_settings(uuid,text,uuid,date,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.publish_operating_policy_settings(uuid,text,uuid,date,jsonb,uuid) to authenticated;
