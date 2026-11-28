create table private.workspace_staff_profiles (
  organization_id uuid not null,
  membership_id uuid not null,
  designation text check(length(designation)<=120),
  territory_region text check(length(territory_region)<=120),
  allowed_modules text[] not null,
  reset_key uuid,
  resetting_at timestamptz,
  password_state text not null default 'ready' check(password_state in ('ready','required','resetting')),
  primary key(organization_id,membership_id),
  foreign key(organization_id,membership_id) references public.memberships(organization_id,id)
);
alter table private.workspace_staff_profiles enable row level security;
revoke all on private.workspace_staff_profiles from public,anon,authenticated;

create function private.workspace_module_map()
returns table(slug text,prefix text)
language sql immutable set search_path=pg_catalog as $$
 values ('dashboard',''),('leads','lead'),('customers','account'),('customers','site'),('customers','contact'),
 ('opportunities','opportunity'),('attendance','attendance_session'),('field_visits','visit'),('visit_planner','visit_plan'),
 ('follow_ups','task'),('products','product'),('equipment','equipment'),('demonstrations','demo'),('quotations','quotation'),
 ('orders','financial_reference'),('tenders','tender'),('expenses','expense'),('targets','target'),('reports','')
$$;

create function private.workspace_is_admin(p_org uuid,p_member uuid) returns boolean
language sql stable set search_path=pg_catalog as $$
  select exists(select 1 from public.member_roles mr join public.roles r on (r.organization_id,r.id)=(mr.organization_id,mr.role_id)
    where (mr.organization_id,mr.membership_id)=(p_org,p_member) and r.code='super_admin'
      and mr.effective_from<=now() and (mr.effective_to is null or mr.effective_to>now()))
$$;
create function private.workspace_modules(p_org uuid,p_member uuid) returns text[]
language sql stable set search_path=pg_catalog as $$
  select case when private.workspace_is_admin(p_org,p_member)
    then array(select distinct slug from private.workspace_module_map() order by slug)
    else coalesce((select sp.allowed_modules from private.workspace_staff_profiles sp
      where (sp.organization_id,sp.membership_id)=(p_org,p_member)),
      array(select distinct slug from private.workspace_module_map() map
        where slug in ('dashboard','tenders','expenses') or exists (
          select 1 from public.member_roles mr join public.role_permissions rp using(organization_id,role_id)
          where (mr.organization_id,mr.membership_id)=(p_org,p_member)
            and mr.effective_from<=now() and (mr.effective_to is null or mr.effective_to>now())
            and (rp.permission_code=map.prefix||'.read' or (map.slug='reports' and rp.permission_code='lead.read'))
        ) order by slug)) end
$$;
create function private.workspace_access(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid;
begin
  select m.id into actor from public.memberships m where m.organization_id=p_org and m.user_id=auth.uid() and m.status='Active';
  if actor is null then raise exception 'Access denied' using errcode='42501'; end if;
  return jsonb_build_object('admin',private.workspace_is_admin(p_org,actor),'modules',private.workspace_modules(p_org,actor),
    'permissions',array(select distinct rp.permission_code from public.member_roles mr join public.role_permissions rp using(organization_id,role_id)
      where (mr.organization_id,mr.membership_id)=(p_org,actor)
        and mr.effective_from<=now() and (mr.effective_to is null or mr.effective_to>now()) order by rp.permission_code));
end
$$;
create function private.workspace_password_required() returns boolean
language sql stable security definer set search_path=pg_catalog as $$
  select exists(select 1 from public.memberships m join private.workspace_staff_profiles p
    on (p.organization_id,p.membership_id)=(m.organization_id,m.id)
    where m.user_id=auth.uid() and p.password_state in ('required','resetting'))
$$;
create function public.workspace_access(p_org uuid) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$ select private.workspace_access(p_org) $$;
create function public.workspace_password_required() returns boolean
language sql stable security invoker set search_path=pg_catalog as $$ select private.workspace_password_required() $$;

create function private.complete_workspace_password() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if nullif(new.encrypted_password,'') is distinct from nullif(old.encrypted_password,'') and nullif(new.encrypted_password,'') is not null then
    with released as (
      update private.workspace_staff_profiles p set password_state='ready' from public.memberships m
      where (p.organization_id,p.membership_id)=(m.organization_id,m.id) and m.user_id=new.id and p.password_state='required'
      returning p.organization_id,p.membership_id
    )
    update public.memberships m set status='Active' from released r where (m.organization_id,m.id)=(r.organization_id,r.membership_id);
  end if;
  return new;
end
$$;
create trigger complete_workspace_password after update of encrypted_password on auth.users
  for each row when (old.encrypted_password is distinct from new.encrypted_password) execute function private.complete_workspace_password();

create function private.workspace_user_directory(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=private.staff_admin_actor(p_org,'staff.directory.read');
begin
  if actor is null or not private.workspace_is_admin(p_org,actor) then raise exception 'Administrator access required' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',p.display_name,'email',to_jsonb(u)->>'email',
    'designation',x.designation,'region',x.territory_region,'admin',private.workspace_is_admin(p_org,m.id),
    'modules',private.workspace_modules(p_org,m.id),'active',m.status='Active',
    'password_pending',coalesce(x.password_state<>'ready',false),'self',m.id=actor,
    'last_login',to_jsonb(u)->>'last_sign_in_at') order by p.display_name,m.id)
    from public.memberships m join public.profiles p on p.id=m.user_id join auth.users u on u.id=m.user_id
    left join private.workspace_staff_profiles x on (x.organization_id,x.membership_id)=(m.organization_id,m.id)
    where m.organization_id=p_org),'[]'::jsonb);
end
$$;
create function public.workspace_user_directory(p_org uuid) returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$ select private.workspace_user_directory(p_org) $$;

create function public.admin_workspace_staff(p_org uuid,p_actor_user uuid,p_action text,p_member uuid,p_user uuid,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  return private.admin_workspace_staff(p_org,p_actor_user,p_action,p_member,p_user,p_input);
end
$$;

create function private.admin_workspace_staff(p_org uuid,p_actor_user uuid,p_action text,p_member uuid,p_user uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare
  actor uuid;
  target public.memberships%rowtype;
  module_list text[];
  admin_role uuid;
  profile_name text:=nullif(btrim(p_input->>'name'),'');
  administrator boolean:=coalesce((p_input->>'admin')::boolean,false);
  previous_state text;
  request_id uuid:=gen_random_uuid();
  reset_key_value uuid:=nullif(p_input->>'reset_key','')::uuid;
begin
  select m.id into actor from public.memberships m where (m.organization_id,m.user_id)=(p_org,p_actor_user) and m.status='Active';
  if actor is null or not private.workspace_is_admin(p_org,actor) then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_action='authorize' then return jsonb_build_object('ok',true); end if;
  perform pg_advisory_xact_lock(hashtextextended('workspace-staff:'||p_org::text,0));
  if not exists(select 1 from public.memberships m where (m.organization_id,m.id)=(p_org,actor) and m.status='Active')
    or not private.workspace_is_admin(p_org,actor) then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_action<>'create' then
    select * into target from public.memberships where (organization_id,id)=(p_org,p_member) for update;
    if not found then raise sqlstate 'PT404' using message='User unavailable'; end if;
    select password_state into previous_state from private.workspace_staff_profiles
      where (organization_id,membership_id)=(p_org,target.id);
  end if;
  if p_action in ('create','update') then
    if profile_name is null or length(profile_name)>200 or length(coalesce(p_input->>'designation',''))>120
      or length(coalesce(p_input->>'region',''))>120 or jsonb_typeof(p_input->'modules') is distinct from 'array'
      or jsonb_array_length(p_input->'modules')>30 then raise exception 'Review the user details' using errcode='22023'; end if;
    module_list:=array(select distinct value from jsonb_array_elements_text(p_input->'modules') order by value);
    if exists(select from unnest(module_list) picked where not exists(select from private.workspace_module_map() map where map.slug=picked)) then
      raise exception 'Choose valid modules' using errcode='22023'; end if;
    if p_action='create' then
      if not exists(select 1 from auth.users u where u.id=p_user) or exists(select 1 from public.memberships where user_id=p_user) then
        raise exception 'User setup is unavailable' using errcode='42501';
      end if;
      insert into public.profiles(id,display_name) values(p_user,profile_name);
      insert into public.memberships(organization_id,user_id,status) values(p_org,p_user,'Inactive') returning * into target;
    else
      if target.id=actor and not administrator then raise exception 'You cannot remove your own administrator role' using errcode='42501'; end if;
      if exists(select 1 from public.memberships m where m.user_id=target.user_id and m.organization_id<>p_org)
        and exists(select 1 from public.profiles p where p.id=target.user_id and p.display_name<>profile_name) then
        raise exception 'This user belongs to multiple organizations' using errcode='42501';
      end if;
      update public.profiles set display_name=profile_name where id=target.user_id;
    end if;
    insert into private.workspace_staff_profiles(organization_id,membership_id,designation,territory_region,allowed_modules,password_state)
      values(p_org,target.id,nullif(btrim(p_input->>'designation'),''),nullif(btrim(p_input->>'region'),''),module_list,
        case when p_action='create' then 'required' else 'ready' end)
    on conflict (organization_id,membership_id) do update set
      designation=excluded.designation,territory_region=excluded.territory_region,allowed_modules=excluded.allowed_modules;
    update public.member_roles set effective_to=clock_timestamp()
      where (organization_id,membership_id)=(p_org,target.id)
        and effective_from<=now() and (effective_to is null or effective_to>now());
    if administrator then
      select id into strict admin_role from public.roles where organization_id=p_org and code='super_admin';
    else
      insert into public.roles(organization_id,code,name) values(p_org,'workspace_'||request_id::text,'User module access') returning id into admin_role;
      insert into public.role_permissions(organization_id,role_id,permission_code)
      select distinct p_org,admin_role,perm.code from public.permissions perm join private.workspace_module_map() map
        on map.prefix<>'' and split_part(perm.code,'.',1)=map.prefix
      where map.slug=any(module_list) and (
        split_part(perm.code,'.',2) in ('read','create','update','contact','qualify','disqualify','convert','edit_pipeline')
        and split_part(perm.code,'.',3)='' or perm.code='tender.edit');
    end if;
    insert into public.member_roles(organization_id,membership_id,role_id,effective_from)
      values(p_org,target.id,admin_role,clock_timestamp());
  elsif p_action in ('deactivate','activate') then
    if target.id=actor then raise exception 'You cannot change your own account status' using errcode='42501'; end if;
    if coalesce(previous_state,'ready')<>'ready' then raise exception 'Complete the password setup first' using errcode='22023'; end if;
    update public.memberships set status=case when p_action='activate' then 'Active' else 'Inactive' end
      where (organization_id,id)=(p_org,target.id);
    if p_action='deactivate' and not exists(select 1 from public.memberships m where m.user_id=target.user_id and m.status='Active') then
      delete from auth.sessions where user_id=target.user_id;
    end if;
  elsif p_action in ('prepare_reset','finish_reset') then
    if reset_key_value is null or target.id=actor or exists(select 1 from public.memberships m where m.user_id=target.user_id and m.organization_id<>p_org) then
      raise exception 'Password reset is unavailable for this user' using errcode='42501';
    end if;
    if p_action='prepare_reset' then
      if previous_state='resetting' and exists(select 1 from private.workspace_staff_profiles x
        where (x.organization_id,x.membership_id)=(p_org,target.id) and x.resetting_at>now()-interval '3 minutes')
      then raise sqlstate 'PT409' using message='A password reset is in progress. Try again in three minutes'; end if;
      if target.status<>'Active' and coalesce(previous_state,'ready') not in ('resetting','required') then
        raise exception 'Activate the user before resetting their password' using errcode='22023';
      end if;
      insert into private.workspace_staff_profiles(organization_id,membership_id,allowed_modules,password_state,reset_key,resetting_at)
        values(p_org,target.id,private.workspace_modules(p_org,target.id),'resetting',reset_key_value,now())
        on conflict (organization_id,membership_id) do update set password_state='resetting',reset_key=excluded.reset_key,resetting_at=excluded.resetting_at;
      update public.memberships set status='Inactive' where (organization_id,id)=(p_org,target.id);
      delete from auth.sessions where user_id=target.user_id;
    elsif previous_state='resetting' then
      update private.workspace_staff_profiles set password_state='required',reset_key=null,resetting_at=null
        where (organization_id,membership_id,reset_key)=(p_org,target.id,reset_key_value);
      if not found then raise exception 'Password reset is unavailable' using errcode='42501'; end if;
    else raise exception 'Password reset is unavailable' using errcode='42501';
    end if;
  else raise exception 'Invalid user action' using errcode='22023';
  end if;
  insert into private.audit_events(organization_id,actor_membership_id,action,request_id,redacted_details)
    values(p_org,actor,'workspace.staff.'||p_action,request_id,jsonb_build_object('membership',target.id));
  return jsonb_build_object('id',target.id,'auth_user',target.user_id);
end
$$;

-- The supplier workflows also have membership-based entry points.
create or replace function private.expense_actor(p_org uuid) returns uuid
language sql stable set search_path=pg_catalog as $$
  select m.id from public.memberships m
  join auth.sessions s on s.user_id=m.user_id and s.id=nullif(auth.jwt()->>'session_id','')::uuid
  where m.organization_id=p_org and m.user_id=auth.uid() and m.status='Active'
    and (s.not_after is null or s.not_after>now()) and 'expenses'=any(private.workspace_modules(p_org,m.id))
$$;

revoke all on function private.workspace_module_map(),private.workspace_is_admin(uuid,uuid),private.workspace_modules(uuid,uuid),
 private.workspace_access(uuid),private.workspace_password_required(),private.workspace_user_directory(uuid),private.complete_workspace_password(),
 public.workspace_access(uuid),public.workspace_password_required(),public.workspace_user_directory(uuid),
 private.admin_workspace_staff(uuid,uuid,text,uuid,uuid,jsonb),public.admin_workspace_staff(uuid,uuid,text,uuid,uuid,jsonb)
 from public,anon,authenticated;
grant execute on function private.workspace_access(uuid),private.workspace_password_required(),private.workspace_user_directory(uuid),
 public.workspace_access(uuid),public.workspace_password_required(),public.workspace_user_directory(uuid) to authenticated;
grant usage on schema private to service_role;
grant execute on function private.admin_workspace_staff(uuid,uuid,text,uuid,uuid,jsonb),
 public.admin_workspace_staff(uuid,uuid,text,uuid,uuid,jsonb) to service_role;

create function private.install_workspace_admin_core() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  insert into public.role_permissions(organization_id,role_id,permission_code)
    select new.organization_id,new.id,code from public.permissions where code in
      ('account.create','account.read','lead.create','lead.read','lead.contact','lead.qualify','lead.disqualify','lead.convert',
       'opportunity.read','opportunity.edit_pipeline') on conflict do nothing;
  return new;
end
$$;
revoke all on function private.install_workspace_admin_core() from public,anon,authenticated;
create trigger install_workspace_admin_core after insert on public.roles
  for each row when(new.code='super_admin') execute function private.install_workspace_admin_core();
insert into public.role_permissions(organization_id,role_id,permission_code)
  select r.organization_id,r.id,p.code from public.roles r cross join public.permissions p where r.code='super_admin'
    and p.code in ('account.create','account.read','lead.create','lead.read','lead.contact','lead.qualify','lead.disqualify','lead.convert',
      'opportunity.read','opportunity.edit_pipeline') on conflict do nothing;

create or replace function private.tender_actor(p_org uuid) returns uuid
language sql stable security invoker set search_path=pg_catalog as $$
  select m.id from public.memberships m
  join auth.sessions s on s.id=nullif(auth.jwt()->>'session_id','')::uuid and s.user_id=m.user_id
  where m.organization_id=p_org and m.user_id=auth.uid() and m.status='Active'
    and (s.not_after is null or s.not_after>now()) and 'tenders'=any(private.workspace_modules(p_org,m.id))
    and exists(select 1 from auth.users u where u.id=m.user_id and to_jsonb(u)->>'email_confirmed_at' is not null)
$$;
