create index lead_events_demo_latest on private.lead_events(organization_id,lead_id,event_id desc)
 where kind='Demo scheduled';

create function private.lead_demo_times(p_org uuid,p_lead uuid) returns timestamptz
language sql stable security invoker set search_path=pg_catalog as $$
 select (details->>'due_at')::timestamptz from private.lead_events
 where organization_id=p_org and lead_id=p_lead and kind='Demo scheduled'
 order by event_id desc limit 1
$$;
revoke all on function private.lead_demo_times(uuid,uuid) from public,anon,authenticated;

create function private.read_lead_console(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare
 actor uuid:=private.staff_admin_actor(p_org,'lead.read');
 zone text;
 month_anchor timestamp;
 week_anchor timestamp;
begin
 if actor is null then raise exception 'Lead access denied' using errcode='42501'; end if;
 select timezone into zone from public.organizations where id=p_org;
 zone:=coalesce(zone,'Asia/Kolkata');
 month_anchor:=date_trunc('month',now() at time zone zone);
 week_anchor:=date_trunc('week',now() at time zone zone);
 return (
   with visible as materialized (
     select l.id,l.product_revision,
       coalesce(l.city,case when private.customer_visible(p_org,actor,l.account_id) then customer.details->>'city' end) city,l.received_at,l.expected_value,l.next_action_due_at,
       coalesce(stage.behavior,'new') not in ('won','lost','closed') active
     from public.leads l left join private.customer_master customer
       on (customer.organization_id,customer.account_id)=(l.organization_id,l.account_id)
     left join private.lead_catalog(p_org) stage on stage.kind='stage' and stage.code=l.sales_stage
     where l.organization_id=p_org and l.merged_into is null and private.lead_visible(p_org,actor,l.id)
   )
   select jsonb_build_object(
      'active',count(*) filter(where active),
      'unread',(select count(*) from private.lead_notifications where organization_id=p_org and recipient_id=actor and read_at is null),
      'pipeline',(sum(expected_value) filter(where active))::text,
      'current_month',count(*) filter(where active and received_at>=month_anchor at time zone zone),
      'previous_month',count(*) filter(where active and received_at>=(month_anchor-interval '1 month') at time zone zone
        and received_at<month_anchor at time zone zone),
      'week_demos',count(*) filter(where active and private.lead_demo_times(p_org,id)>=week_anchor at time zone zone
        and private.lead_demo_times(p_org,id)<(week_anchor+interval '7 days') at time zone zone),
      'overdue',count(*) filter(where active and next_action_due_at<now()),
      'categories',coalesce((select jsonb_agg(category order by category) from (
        select distinct p.category from visible v join private.lead_products p
          on (p.organization_id,p.lead_id,p.revision)=(p_org,v.id,v.product_revision)
        order by p.category limit 200
      ) choices),'[]'::jsonb),
      'cities',coalesce((select jsonb_agg(city order by city) from (
        select distinct city from visible where nullif(btrim(city),'') is not null order by city limit 200
      ) choices),'[]'::jsonb)
   ) from visible
 );
end
$$;
revoke all on function private.read_lead_console(uuid) from public,anon,authenticated;
grant execute on function private.read_lead_console(uuid) to authenticated;
create function public.read_lead_console(p_org uuid) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
 select private.read_lead_console(p_org)
$$;
revoke all on function public.read_lead_console(uuid) from public,anon,authenticated;
grant execute on function public.read_lead_console(uuid) to authenticated;

create function private.schedule_lead_demo(p_org uuid,p_id uuid,p_key uuid,p_version integer,p_due timestamptz,p_note text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
 actor uuid:=private.staff_admin_actor(p_org,'lead.read');
 row_data public.leads%rowtype;
 prior private.operation_receipts%rowtype;
 digest text;
 saved jsonb;
 label_text text:=nullif(btrim(p_note),'');
begin
 if actor is null then raise exception 'Lead access denied' using errcode='42501'; end if;
 if p_id is null or p_key is null or p_version is null or p_due is null or not isfinite(p_due)
    or coalesce(length(label_text),0)>500 then raise exception 'Enter a valid demo date and time' using errcode='22023'; end if;
 perform 1 from public.memberships where (organization_id,id)=(p_org,actor) and status='Active' for share;
 if not found then raise exception 'Lead access denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_key::text,0));
 digest:=encode(sha256(convert_to(jsonb_build_array(p_id,p_version,p_due,label_text)::text,'UTF8')),'hex');
 select * into prior from private.operation_receipts where (organization_id,actor_membership_id,operation_key)=(p_org,actor,p_key);
 if found then
  if prior.command_type<>'lead.schedule_demo' or prior.request_hash<>digest then
   raise sqlstate 'PT409' using message='Request key already used';
  end if;
  return prior.response_snapshot;
 end if;
 select l.* into row_data from public.leads l join public.resources r on (r.organization_id,r.id)=(l.organization_id,l.id)
 where (l.organization_id,l.id)=(p_org,p_id) and l.merged_into is null and r.archived_at is null
  and (private.intake_actor_can(p_org,actor,'lead.manage') or
    (r.owner_membership_id=actor and private.intake_actor_can(p_org,actor,'lead.contact')))
 for update of l,r;
 if not found then raise sqlstate 'PT404' using message='Lead unavailable'; end if;
 if row_data.row_version<>p_version then raise sqlstate 'PT409' using message='Lead changed. Refresh and try again'; end if;
 if p_due<=now() or exists(select 1 from private.lead_catalog(p_org) where kind='stage' and code=row_data.sales_stage
                          and behavior in ('won','lost','closed')) then
  raise exception 'Choose a future date for an active lead' using errcode='22023';
 end if;
 perform private.lead_event(p_org,p_id,actor,'Demo scheduled',jsonb_build_object('summary',coalesce(label_text,'Product demo or trial'),'due_at',p_due));
 update public.leads set row_version=row_version+1,updated_at=now(),updated_by=actor
   where (organization_id,id)=(p_org,p_id);
 insert into private.audit_events(organization_id,actor_membership_id,resource_id,action,request_id)
  values(p_org,actor,p_id,'lead.schedule_demo',p_key);
 saved:=jsonb_build_object('id',p_id,'version',p_version+1);
 insert into private.operation_receipts(organization_id,actor_membership_id,operation_key,command_type,request_hash,response_snapshot)
  values(p_org,actor,p_key,'lead.schedule_demo',digest,saved);
 return saved;
end
$$;
revoke all on function private.schedule_lead_demo(uuid,uuid,uuid,integer,timestamptz,text) from public,anon,authenticated;
grant execute on function private.schedule_lead_demo(uuid,uuid,uuid,integer,timestamptz,text) to authenticated;

create function public.schedule_lead_demo(p_org uuid,p_id uuid,p_key uuid,p_version integer,p_due timestamptz,p_note text default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
 select private.schedule_lead_demo(p_org,p_id,p_key,p_version,p_due,p_note)
$$;
revoke all on function public.schedule_lead_demo(uuid,uuid,uuid,integer,timestamptz,text) from public,anon,authenticated;
grant execute on function public.schedule_lead_demo(uuid,uuid,uuid,integer,timestamptz,text) to authenticated;

create or replace function private.lead_list(
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
      coalesce(l.city,case when private.customer_visible(p_org,p_actor,l.account_id) then customer.details->>'city' end) display_city,
      case when private.customer_visible(p_org,p_actor,l.account_id) and customer.details->>'classification' ~* '^tier([[:space:]-]|[0-9])' then customer.details->>'classification' end city_tier,
      l.first_attempt_at is null and now() >= l.received_at + make_interval(hours=>rules.response_hours)
        and coalesce(c.behavior,'new') not in ('won','lost','closed','hold') sla_due,
      count(*) over() total
    from public.leads l join public.resources r on (r.organization_id,r.id)=(l.organization_id,l.id)
    left join private.territories t on (t.organization_id,t.id)=(r.organization_id,r.territory_id)
    left join private.customer_master customer on (customer.organization_id,customer.account_id)=(l.organization_id,l.account_id)
    left join catalog c on c.kind='stage' and c.code=l.sales_stage
    join public.organizations org on org.id=l.organization_id
    cross join rules
    where l.organization_id=p_org and l.merged_into is null and r.archived_at is null
      and private.lead_visible(p_org,p_actor,l.id)
      and (coalesce(p_query->>'search','')='' or
        strpos(lower(concat_ws(' ',l.prospect_name,l.contact_person,l.email,l.mobile,l.alternate_mobile,l.contact_route,l.city,l.state,
            l.external_reference,l.requirement_text,private.lead_number(l.display_number,l.ingested_at))),lower(p_query->>'search'))>0
        or exists(select 1 from private.lead_products p where (p.organization_id,p.lead_id,p.revision)=(l.organization_id,l.id,l.product_revision)
          and strpos(lower(p.model || ' ' || p.category || ' ' || coalesce(p.requirements,'')),lower(p_query->>'search'))>0))
      and (coalesce(p_query->>'city','')='' or coalesce(l.city,case when private.customer_visible(p_org,p_actor,l.account_id) then customer.details->>'city' end)=p_query->>'city')
      and (coalesce(p_query->>'product_category','')='' or exists(
        select 1 from private.lead_products p where (p.organization_id,p.lead_id,p.revision)=(l.organization_id,l.id,l.product_revision)
          and p.category=p_query->>'product_category'))
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
        when 'hot_tenders' then l.priority='Hot' and l.source_key='government'
          and coalesce(c.behavior,'new') not in ('won','lost','closed')
        when 'demo_week' then coalesce(c.behavior,'new') not in ('won','lost','closed')
          and private.lead_demo_times(p_org,l.id) >= date_trunc('week',now() at time zone org.timezone) at time zone org.timezone
          and private.lead_demo_times(p_org,l.id) < (date_trunc('week',now() at time zone org.timezone)+interval '7 days') at time zone org.timezone
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
      'city',p.display_city,'state',p.state,'city_tier',p.city_tier,'demo_at',private.lead_demo_times(p_org,p.id),'source',p.source_key,'stage',p.sales_stage,'behavior',p.behavior,'priority',p.priority,
      'owner',p.owner,'owner_name',private.lead_member_name(p_org,p.owner),'territory_name',p.territory_name,
      'value',p.expected_value::text,'received_at',p.received_at,'updated_at',p.modified,'follow_up',p.next_action_due_at,
      'first_response_overdue',p.sla_due,'lifecycle',p.lifecycle,
      'products',coalesce((select string_agg(lp.model || ' × ' || lp.quantity::text,', ' order by lp.line_no)
        from private.lead_products lp where (lp.organization_id,lp.lead_id,lp.revision)=(p.organization_id,p.id,p.product_revision) and lp.line_no<=3),left(p.requirement_text,150))
    )) from page p
  ),'[]'::jsonb))
$$;
revoke all on function private.lead_list(uuid,uuid,jsonb,integer,integer) from public, anon, authenticated;
