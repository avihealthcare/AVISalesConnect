create index file_upload_stages_parent_idx on private.file_upload_stages
 (organization_id, parent_resource_id, created_at desc, id desc);

create function private.crm_record_files(p_org uuid,p_resource uuid,p_offset integer)
returns table (id uuid, file_name text, created_at timestamptz, status text)
language plpgsql stable security definer set search_path=pg_catalog as $$
declare
 stage_actor uuid := private.staff_admin_actor(p_org,'file.stage');
 download_actor uuid := private.staff_admin_actor(p_org,'file.download');
 actor uuid := coalesce(stage_actor,download_actor);
 kind text;
begin
 if actor is null or p_offset is null or p_offset < 0 or not exists (
    select 1 from auth.sessions s where s.id = nullif(auth.jwt()->>'session_id','')::uuid
     and s.user_id = auth.uid() and s.aal::text = 'aal2' and (s.not_after is null or s.not_after > now())
 ) then raise exception 'File list unavailable' using errcode='42501'; end if;
 select r.resource_type into kind from public.resources r
 where r.organization_id = p_org and r.id = p_resource and r.owner_membership_id = actor
   and r.archived_at is null and r.resource_type in ('account','lead');
 if kind is null or private.staff_admin_actor(p_org,kind || '.read') is distinct from actor then
  raise exception 'File list unavailable' using errcode='42501';
 end if;

 return query
 select stage.id, stage.original_name, stage.created_at, case
  when uploaded.verdict = 'clean' then 'Available'
  when uploaded.verdict = 'rejected' then 'Rejected'
  when stage.expires_at <= now() then 'Expired'
  when uploaded.stored_at is not null then 'Awaiting scan'
  else 'Pending upload'
 end
 from private.file_upload_stages stage
 left join private.file_upload_objects uploaded on uploaded.stage_id = stage.id
 where stage.organization_id = p_org and stage.parent_resource_id = p_resource and stage.purpose = 'business_document'
 and ((uploaded.verdict = 'clean' and download_actor is not null)
      or (uploaded.verdict is distinct from 'clean' and stage_actor = stage.uploader_membership_id))
 order by stage.created_at desc, stage.id desc limit 26 offset p_offset;
end
$$;
revoke all on function private.crm_record_files(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function private.crm_record_files(uuid,uuid,integer) to authenticated;

create function public.crm_record_files(p_org uuid,p_resource uuid,p_offset integer)
returns table (id uuid,file_name text,created_at timestamptz,status text)
language sql stable security invoker set search_path=pg_catalog as $$
 select * from private.crm_record_files(p_org,p_resource,p_offset)
$$;
revoke all on function public.crm_record_files(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.crm_record_files(uuid,uuid,integer) to authenticated;
