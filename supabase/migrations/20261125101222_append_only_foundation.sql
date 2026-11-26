create function private.reject_mutation() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 raise exception 'append-only record cannot be modified' using errcode='55000';
end;
$$;
revoke all on function private.reject_mutation() from public, anon, authenticated;
create trigger audit_append_only before update or delete or truncate on private.audit_events
 for each statement execute function private.reject_mutation();
create trigger receipts_append_only before update or delete or truncate on private.operation_receipts
 for each statement execute function private.reject_mutation();
