insert into public.permissions (code, description, requires_mfa)
values ('staff.scope.manage', 'Configure reporting lines and CRM territories', true),
       ('account.read.team', 'View customer records within the reporting hierarchy', true),
       ('account.read.territory', 'View customer records in assigned territories', true),
       ('account.read.organization', 'View customer records throughout the organization', true),
       ('lead.read.team', 'View leads within the reporting hierarchy', true),
       ('lead.read.territory', 'View leads in assigned territories', true),
       ('lead.read.organization', 'View leads throughout the organization', true);

create table private.reporting_lines (
  organization_id uuid not null,
  member_id uuid not null,
  manager_id uuid not null,
  primary key (organization_id, member_id),
  check (member_id <> manager_id),
  foreign key (organization_id, member_id) references public.memberships(organization_id,id),
  foreign key (organization_id, manager_id) references public.memberships(organization_id,id)
);
create index reporting_lines_manager_idx on private.reporting_lines(organization_id, manager_id);

create table private.territories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null check (name = trim(name) and char_length(name) between 1 and 120),
  unique (organization_id, id)
);
create unique index territories_unique_name_idx on private.territories(organization_id, lower(name));

create table private.territory_memberships (
  organization_id uuid not null,
  membership_id uuid not null,
  territory_id uuid not null,
  primary key (organization_id, membership_id, territory_id),
  foreign key (organization_id, membership_id) references public.memberships(organization_id,id),
  foreign key (organization_id, territory_id) references private.territories(organization_id,id)
);
create index territory_memberships_territory_idx on private.territory_memberships(organization_id, territory_id);

alter table private.reporting_lines enable row level security;
alter table private.territories enable row level security;
alter table private.territory_memberships enable row level security;
revoke all on private.reporting_lines, private.territories, private.territory_memberships from public, anon, authenticated;

alter table public.resources
  add column territory_id uuid,
  add foreign key (organization_id, territory_id) references private.territories(organization_id,id);
create index resources_territory_idx on public.resources (organization_id, territory_id)
  where territory_id is not null;

create function private.crm_read_scope(p_org uuid, p_owner uuid, p_territory uuid, p_kind text)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
  with recursive actor as (
    select m.id from public.memberships m
    where m.organization_id = p_org and m.user_id = auth.uid()
      and m.status = 'Active' and auth.jwt()->>'aal' = 'aal2'
  ), scopes as (
    select distinct split_part(rp.permission_code, '.', 3) as name
    from actor
    join public.member_roles mr on mr.organization_id = p_org and mr.membership_id = actor.id
    join public.role_permissions rp on (rp.organization_id,rp.role_id) = (mr.organization_id,mr.role_id)
    where p_kind in ('account','lead') and mr.effective_from <= now()
      and (mr.effective_to is null or mr.effective_to > now())
      and rp.permission_code in (p_kind || '.read.team', p_kind || '.read.territory', p_kind || '.read.organization')
  ), managers(id) as (
    select rl.manager_id
    from private.reporting_lines rl
    join public.memberships owner on (owner.organization_id,owner.id) = (rl.organization_id,rl.member_id)
    join public.memberships manager on (manager.organization_id,manager.id) = (rl.organization_id,rl.manager_id)
    where rl.organization_id = p_org and rl.member_id = p_owner
      and owner.status = 'Active' and manager.status = 'Active'
      and exists (select 1 from scopes where name = 'team')
    union
    select rl.manager_id
    from managers
    join private.reporting_lines rl on rl.organization_id = p_org and rl.member_id = managers.id
    join public.memberships manager on (manager.organization_id,manager.id) = (rl.organization_id,rl.manager_id)
    where manager.status = 'Active'
  )
  select exists (
    select 1 from actor where
      exists (select 1 from scopes where name = 'organization')
      or exists (select 1 from managers where managers.id = actor.id)
      or (exists (select 1 from scopes where name = 'territory') and exists (
        select 1 from private.territory_memberships tm
        where tm.organization_id = p_org and tm.membership_id = actor.id and tm.territory_id = p_territory
      ))
  )
$$;
revoke all on function private.crm_read_scope(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function private.crm_read_scope(uuid,uuid,uuid,text) to authenticated;

create policy resources_staff_read_scope on public.resources for select to authenticated using (
  archived_at is null and resource_type in ('account','lead')
  and (select auth.jwt()->>'aal') = 'aal2'
  and private.has_permission(organization_id, resource_type || '.read')
  and private.crm_read_scope(organization_id, owner_membership_id, territory_id, resource_type)
);

create function private.change_staff_scope(
  p_org uuid, p_action text, p_subject uuid, p_target uuid, p_key uuid
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare
  actor uuid;
  payload_hash text;
  previous_target uuid;
  record_kind text;
  record_owner uuid;
  prior private.operation_receipts%rowtype;
begin
  if p_org is null or p_subject is null or p_key is null or p_action is null
     or p_action not in ('set_manager','grant_territory','revoke_territory','set_record_territory')
     or (p_action in ('grant_territory','revoke_territory') and p_target is null) then
    raise exception 'Invalid staff scope request' using errcode='22023';
  end if;

  actor := private.staff_admin_actor(p_org, 'staff.scope.manage');
  if actor is null or (p_action = 'grant_territory' and p_subject = actor)
     or (p_action = 'set_manager' and p_target = actor) then
    raise exception 'Staff scope access denied' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('avi-staff-scope'), hashtext(p_org::text));
  if private.staff_admin_actor(p_org, 'staff.scope.manage') is distinct from actor then
    raise exception 'Staff scope access denied' using errcode='42501';
  end if;
  perform 1 from public.memberships where organization_id = p_org and id = actor and status = 'Active' for share;
  if not found then raise exception 'Staff scope access denied' using errcode='42501'; end if;

  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':' || p_key::text,0));
  payload_hash := encode(sha256(convert_to(jsonb_build_array(p_action,p_subject,p_target)::text,'UTF8')),'hex');
  select * into prior from private.operation_receipts
  where organization_id = p_org and actor_membership_id = actor and operation_key = p_key;
  if found then
    if prior.command_type <> 'staff.scope' or prior.request_hash <> payload_hash then
      raise sqlstate 'PT409' using message = 'Operation key is already in use';
    end if;
    return p_subject;
  end if;

  if p_action <> 'set_record_territory' then
    perform 1 from public.memberships
    where organization_id = p_org and id = p_subject
      and (status = 'Active' or p_action = 'revoke_territory' or (p_action = 'set_manager' and p_target is null))
    for share;
    if not found then raise exception 'Staff scope access denied' using errcode='42501'; end if;
  end if;
  if p_action <> 'set_manager' and p_target is not null then
    perform 1 from private.territories where organization_id = p_org and id = p_target for share;
    if not found then raise exception 'Territory unavailable' using errcode='42501'; end if;
  end if;

  case p_action
    when 'set_manager' then
      select manager_id into previous_target from private.reporting_lines
      where organization_id = p_org and member_id = p_subject;
      if p_target is null then
        delete from private.reporting_lines where organization_id = p_org and member_id = p_subject;
      else
        perform 1 from public.memberships where organization_id = p_org and id = p_target and status = 'Active' for share;
        if not found then raise exception 'Staff scope access denied' using errcode='42501'; end if;
        if exists (
          with recursive ancestors(id) as (
            select p_target
            union
            select rl.manager_id from ancestors
            join private.reporting_lines rl on rl.organization_id = p_org and rl.member_id = ancestors.id
          )
          select 1 from ancestors where id = p_subject
        ) then raise sqlstate 'PT409' using message = 'Reporting line would create a cycle'; end if;
        insert into private.reporting_lines (organization_id,member_id,manager_id) values (p_org,p_subject,p_target)
        on conflict (organization_id,member_id) do update set manager_id = excluded.manager_id;
      end if;
    when 'grant_territory' then
      insert into private.territory_memberships (organization_id,membership_id,territory_id)
      values (p_org,p_subject,p_target) on conflict do nothing;
    when 'revoke_territory' then
      delete from private.territory_memberships
      where organization_id = p_org and membership_id = p_subject and territory_id = p_target;
    when 'set_record_territory' then
      select territory_id, resource_type, owner_membership_id into previous_target, record_kind, record_owner
      from public.resources
      where organization_id = p_org and id = p_subject and resource_type in ('account','lead')
        and archived_at is null for update;
      if not found or private.staff_admin_actor(p_org, record_kind || '.read') is null
         or (record_owner is distinct from actor
             and private.staff_admin_actor(p_org, record_kind || '.read.organization') is null) then
        raise exception 'CRM record unavailable' using errcode='42501';
      end if;
      update public.resources set territory_id = p_target where organization_id = p_org and id = p_subject;
  end case;

  insert into private.audit_events (organization_id,actor_membership_id,resource_id,action,request_id,redacted_details)
  values (p_org,actor,case when p_action = 'set_record_territory' then p_subject end,
    'staff.scope.' || p_action,p_key,
    jsonb_build_object('subject_id',p_subject,'target_id',p_target,'previous_target_id',previous_target));
  insert into private.operation_receipts (organization_id,actor_membership_id,operation_key,command_type,request_hash,response_snapshot)
  values (p_org,actor,p_key,'staff.scope',payload_hash,jsonb_build_object('id',p_subject));
  return p_subject;
end
$$;
revoke all on function private.change_staff_scope(uuid,text,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function private.change_staff_scope(uuid,text,uuid,uuid,uuid) to authenticated;

create function public.change_staff_scope(
  p_org uuid, p_action text, p_subject uuid, p_target uuid, p_key uuid
) returns uuid language sql security invoker set search_path=pg_catalog as $$
  select private.change_staff_scope(p_org,p_action,p_subject,p_target,p_key)
$$;
revoke all on function public.change_staff_scope(uuid,text,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.change_staff_scope(uuid,text,uuid,uuid,uuid) to authenticated;
