insert into private.lead_defaults values ('source','visiting_card','Visiting Card Scan',160,null);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('lead-cards','lead-cards',false,10485760,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']);
create policy deny_direct_lead_cards on storage.objects as restrictive
  for all to anon,authenticated using (bucket_id <> 'lead-cards') with check (bucket_id <> 'lead-cards');

create table private.lead_cards (
  organization_id uuid not null,
  lead_id uuid not null,
  uploader uuid not null,
  upload_key uuid not null,
  card_details jsonb not null,
  contact_id uuid,
  front_path text not null,
  back_path text,
  created_at timestamptz not null default now(),
  primary key (organization_id,lead_id),
  unique (organization_id,uploader,upload_key),
  foreign key (organization_id,lead_id) references public.leads(organization_id,id),
  foreign key (organization_id,contact_id) references private.sales_field_records(organization_id,id)
);
create table private.lead_card_usage (
  organization_id uuid not null,
  membership_id uuid not null,
  action text not null check (action in ('extract','upload')),
  requested_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id,membership_id) references public.memberships(organization_id,id)
);
create index lead_card_usage_actor on private.lead_card_usage(organization_id,membership_id,action,requested_at);
alter table private.lead_cards enable row level security;
alter table private.lead_card_usage enable row level security;
revoke all on private.lead_cards,private.lead_card_usage from public,anon,authenticated;

create function private.authorize_card_request(p_org uuid,p_action text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid := private.staff_admin_actor(p_org,'lead.create');
begin
  if actor is null or not private.intake_actor_can(p_org,actor,'lead.read') then
    raise exception 'Lead access denied' using errcode='42501';
  end if;
  if p_action not in ('extract','upload') or p_action is null then
    raise exception 'Invalid card action' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('lead-card:' || actor::text || ':' || p_action,0));
  delete from private.lead_card_usage
    where (organization_id,membership_id,action)=(p_org,actor,p_action)
      and requested_at<now()-interval '1 hour';
  if (select count(*) from private.lead_card_usage
      where (organization_id,membership_id,action)=(p_org,actor,p_action)) >= 40 then
    raise sqlstate 'PT429' using message='Card limit reached. Try again later.';
  end if;
  insert into private.lead_card_usage(organization_id,membership_id,action) values (p_org,actor,p_action);
end
$$;

create function private.card_phone(p_value text) returns text
language sql immutable security invoker set search_path=pg_catalog as $$
  select case
    when digits ~ '^0091[0-9]{10}$' or digits ~ '^91[0-9]{10}$' or digits ~ '^0[0-9]{10}$' then right(digits,10)
    when length(digits)>=7 then digits end
  from regexp_replace(coalesce(p_value,''),'[^0-9]','','g') as digits
$$;

create function private.find_card_matches(p_org uuid,p_hospital text,p_phone text,p_secondary text,p_email text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare
  actor uuid := private.staff_admin_actor(p_org,'lead.create');
  hospital text := regexp_replace(lower(left(coalesce(p_hospital,''),200)),'[^[:alnum:]]','','g');
  phone text := private.card_phone(left(p_phone,30));
  secondary text := private.card_phone(left(p_secondary,30));
  email text := nullif(lower(btrim(left(p_email,254))),'');
begin
  if actor is null or not private.intake_actor_can(p_org,actor,'lead.read') then
    raise exception 'Lead access denied' using errcode='42501';
  end if;
  return jsonb_build_object(
    'customers',coalesce((select jsonb_agg(to_jsonb(match)) from (
      select a.id,a.name,m.details->>'city' as city,(r.owner_membership_id=actor) as can_link
      from public.accounts a join public.resources r using (organization_id,id)
      left join private.customer_master m on (m.organization_id,m.account_id)=(a.organization_id,a.id)
      where a.organization_id=p_org and private.customer_visible(p_org,actor,a.id)
        and ((length(hospital)>=4 and regexp_replace(lower(a.name),'[^[:alnum:]]','','g')=hospital)
          or private.card_phone(m.details->>'phone') in (phone,secondary))
      order by a.name,a.id limit 5
    ) match),'[]'::jsonb),
    'contacts',coalesce((select jsonb_agg(to_jsonb(match)) from (
      select f.id,f.title as name,private.contact_row(p_org,actor,f.id)->'accounts' as accounts
      from private.sales_field_records f
      where f.organization_id=p_org and f.kind='contact'
        and (nullif(lower(btrim(f.details->>'email')),'')=email
          or private.card_phone(f.details->>'phone') in (phone,secondary)
          or private.card_phone(f.details->>'office_phone') in (phone,secondary)
          or private.card_phone(f.details->>'whatsapp') in (phone,secondary))
        and private.contact_visible(p_org,actor,f.id)
      order by f.title,f.id limit 5
    ) match),'[]'::jsonb)
  );
end
$$;

create function private.create_card_lead(p_org uuid,p_key uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  actor uuid := private.staff_admin_actor(p_org,'lead.create');
  uploader_id uuid := auth.uid();
  upload_id uuid := (p_input->>'upload_key')::uuid;
  selected_contact uuid := nullif(p_input#>>'{fields,linked_contact_id}','')::uuid;
  selected_account uuid := nullif(p_input#>>'{fields,account}','')::uuid;
  front_suffix text := p_input->>'front';
  back_suffix text := p_input->>'back';
  folder text := p_org::text || '/' || uploader_id::text || '/' || upload_id::text || '/';
  card jsonb;
  result jsonb;
  target uuid;
begin
  if actor is null or uploader_id is null or not private.intake_actor_can(p_org,actor,'lead.read') then
    raise exception 'Lead access denied' using errcode='42501';
  end if;
  if upload_id is null or front_suffix is null or front_suffix not in ('jpg','png','webp','heic','heif')
    or (back_suffix is not null and back_suffix not in ('jpg','png','webp','heic','heif')) then
    raise exception 'Invalid card upload' using errcode='22023';
  end if;
  result := private.command_lead_management(p_org,'create',p_key,p_input);
  target := (result->>'id')::uuid;
  if exists (select 1 from private.lead_cards where (organization_id,lead_id)=(p_org,target)) then
    return result;
  end if;
  if selected_contact is not null and (not private.contact_visible(p_org,actor,selected_contact)
    or (selected_account is not null and not exists (
      select 1 from private.sales_field_records f where (f.organization_id,f.id)=(p_org,selected_contact) and
       (f.parent_id=selected_account or exists (
        select 1 from private.contact_affiliations a
        where (a.organization_id,a.contact_id,a.account_id)=(p_org,selected_contact,selected_account) and a.active
       ))
    ))) then
    raise sqlstate 'PT404' using message='Contact is unavailable for this customer';
  end if;
  if not exists (select 1 from storage.objects where bucket_id='lead-cards' and name=folder || 'front.' || front_suffix)
    or (back_suffix is not null and not exists (
      select 1 from storage.objects where bucket_id='lead-cards' and name=folder || 'back.' || back_suffix
    )) then
    raise exception 'Card upload is incomplete' using errcode='22023';
  end if;
  select coalesce(jsonb_object_agg(key,nullif(btrim(value),'')),'{}'::jsonb) into card
    from jsonb_each_text(p_input->'fields')
    where key in ('salutation','department','qualifications','website','hospital_address','pincode');
  insert into private.lead_cards(organization_id,lead_id,uploader,upload_key,card_details,contact_id,front_path,back_path)
    values (p_org,target,uploader_id,upload_id,card,selected_contact,
      folder || 'front.' || front_suffix,folder || 'back.' || back_suffix);
  perform private.lead_event(p_org,target,actor,'Visiting card attached',
    jsonb_build_object('summary',case when back_suffix is null then 'Front side retained' else 'Front and back retained' end));
  return result;
end
$$;

create function private.read_lead_cards(p_org uuid,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid := private.staff_admin_actor(p_org,'lead.read');
begin
  if actor is null or not private.lead_visible(p_org,actor,p_id) then
    raise sqlstate 'PT404' using message='Lead unavailable';
  end if;
  return coalesce((with recursive family(id) as (
    select p_id union select l.id from family f join public.leads l on l.organization_id=p_org and l.merged_into=f.id
  )
  select jsonb_agg(jsonb_build_object('lead_id',c.lead_id,'details',c.card_details,'has_back',c.back_path is not null,
    'contact',case when private.contact_visible(p_org,actor,c.contact_id) then (
      select f.title from private.sales_field_records f where (f.organization_id,f.id)=(p_org,c.contact_id)
    ) end,'created_at',c.created_at) order by c.created_at)
  from private.lead_cards c join family f on f.id=c.lead_id
  where c.organization_id=p_org and private.lead_visible(p_org,actor,c.lead_id)),'[]'::jsonb);
end
$$;

create function public.authorize_card_request(p_org uuid,p_action text) returns void
language sql security invoker set search_path=pg_catalog as $$ select private.authorize_card_request(p_org,p_action) $$;
create function public.find_card_matches(p_org uuid,p_hospital text,p_phone text,p_secondary text,p_email text) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$ select private.find_card_matches(p_org,p_hospital,p_phone,p_secondary,p_email) $$;
create function public.create_card_lead(p_org uuid,p_key uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path=pg_catalog as $$ select private.create_card_lead(p_org,p_key,p_input) $$;
create function public.read_lead_cards(p_org uuid,p_id uuid) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$ select private.read_lead_cards(p_org,p_id) $$;

revoke all on function private.card_phone(text) from public,anon,authenticated;
revoke all on function private.authorize_card_request(uuid,text),private.find_card_matches(uuid,text,text,text,text),
  private.create_card_lead(uuid,uuid,jsonb),private.read_lead_cards(uuid,uuid),public.authorize_card_request(uuid,text),
  public.find_card_matches(uuid,text,text,text,text),public.create_card_lead(uuid,uuid,jsonb),public.read_lead_cards(uuid,uuid)
  from public,anon,authenticated;
grant execute on function private.authorize_card_request(uuid,text),private.find_card_matches(uuid,text,text,text,text),
  private.create_card_lead(uuid,uuid,jsonb),private.read_lead_cards(uuid,uuid),public.authorize_card_request(uuid,text),
  public.find_card_matches(uuid,text,text,text,text),public.create_card_lead(uuid,uuid,jsonb),public.read_lead_cards(uuid,uuid)
  to authenticated;
