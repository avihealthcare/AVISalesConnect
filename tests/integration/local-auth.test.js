// Opt-in against an explicitly disposable local Supabase stack only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { totp } from '../support/totp.js';

const url = process.env.LOCAL_SUPABASE_URL;
const anon = process.env.LOCAL_SUPABASE_ANON_KEY;
const service = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const container = process.env.LOCAL_SUPABASE_DB_CONTAINER;
assert.equal(process.env.CONFIRM_DISPOSABLE_LOCAL_SUPABASE, 'yes', 'Use only a disposable local stack');
assert.ok(url && ['127.0.0.1', 'localhost'].includes(new URL(url).hostname) && new URL(url).protocol === 'http:', 'Only a local HTTP endpoint is permitted');
assert.ok(anon && service && /^supabase_db_[a-zA-Z0-9_-]+$/.test(container || ''), 'Local credentials and database container are required');
const client = key => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const admin = client(service);
const sql = text => execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-qAt'], { input: text, stdio: ['pipe', 'pipe', 'pipe'] });

test('real local Auth, API and Storage enforce record scope, quarantine and deactivation', async () => {
  const org = randomUUID(), run = randomUUID(), password = `Synthetic-${randomUUID()}aA1!`;
  const users = [];
  for (const label of ['a', 'b']) {
    const email = `${label}-${run}@example.invalid`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(created.error); users.push({ email, id: created.data.user.id, api: client(anon) });
  }
  sql(`insert into public.organizations(id,name,timezone,base_currency,financial_year_start_month) values ('${org}','Synthetic test','Asia/Kolkata','INR',4);\n` +
      users.map(u => `select private.provision_intake_staff('${org}','${u.id}','Synthetic user',null,'${randomUUID()}');`).join('\n'));
  for (const user of users) {
    const signed = await user.api.auth.signInWithPassword({ email: user.email, password }); assert.ifError(signed.error);
    const denied = await user.api.rpc('create_intake_record', { p_org: org, p_key: randomUUID(), p_kind: 'account', p_input: {name:'Synthetic Hospital',account_type:'Hospital'} });
    assert.ok(denied.error, 'MFA-required command must deny AAL1');
    const enrolled = await user.api.auth.mfa.enroll({ factorType: 'totp' }); assert.ifError(enrolled.error);
    const challenge = await user.api.auth.mfa.challenge({ factorId: enrolled.data.id }); assert.ifError(challenge.error);
    const verified = await user.api.auth.mfa.verify({ factorId: enrolled.data.id, challengeId: challenge.data.id, code: totp(enrolled.data.totp.secret) }); assert.ifError(verified.error);
  }
  const foreignOrg = randomUUID();
  sql(`insert into public.organizations(id,name,timezone,base_currency,financial_year_start_month) values ('${foreignOrg}','Synthetic other organization','Asia/Kolkata','INR',4);`);
  const crossOrg = await users[0].api.rpc('create_intake_record', {p_org: foreignOrg,p_key: randomUUID(),p_kind:'account',p_input:{name:'Synthetic Hospital',account_type:'Hospital'}});
  assert.ok(crossOrg.error, 'a user cannot act in an organization without membership');
  const args = { p_org: org, p_key: randomUUID(), p_kind: 'account', p_input: {name:'Synthetic Hospital',account_type:'Hospital'} };
  const results = await Promise.all(Array.from({length: 3}, () => users[0].api.rpc('create_intake_record', args)));
  for (const result of results) assert.ifError(result.error);
  assert.equal(new Set(results.map(r => r.data)).size, 1, 'concurrent retries return one record');
  const changed = await users[0].api.rpc('create_intake_record', {...args, p_input: {...args.p_input, name:'Changed'}});
  assert.ok(changed.error, 'changed payload must not reuse a key');
  const raceKey = randomUUID();
  const raced = await Promise.all(['Race A', 'Race B'].map(name => users[0].api.rpc('create_intake_record', {
    ...args, p_key: raceKey, p_input: {...args.p_input, name}
  })));
  assert.equal(raced.filter(r => !r.error).length, 1, 'only one conflicting concurrent request may commit');
  assert.equal(raced.filter(r => r.error).length, 1, 'the other conflicting request must fail');
  const audit = await users[0].api.schema('private').from('audit_events').select('id');
  assert.ok(audit.error, 'application users cannot read private audit tables directly');
  const receipts = sql(`select count(*) from private.operation_receipts where organization_id='${org}' and operation_key='${args.p_key}';`).toString().trim();
  assert.equal(Number(receipts), 1, 'concurrent retries create one receipt');
  const member = sql(`select id from public.memberships where organization_id='${org}' and user_id='${users[0].id}';`).toString().trim();
  const bytes = Buffer.from('%PDF-1.4\n% synthetic storage fixture\n');
  const reservation = {
    p_org: org, p_parent: results[0].data, p_key: randomUUID(), p_name: 'Synthetic.pdf',
    p_purpose: 'business_document', p_mime: 'application/pdf', p_size: bytes.length
  };
  const reserve = (api = users[0].api, overrides = {}) =>
    api.rpc('reserve_file_stage', { ...reservation, ...overrides });
  assert.equal((await reserve()).error?.code, '42501', 'parent read permission alone cannot reserve');
  sql(`insert into public.role_permissions(organization_id,role_id,permission_code)
    select organization_id,id,'file.stage' from public.roles where organization_id='${org}' and code='intake_staff';`);
  const passwordOnly = client(anon);
  assert.ifError((await passwordOnly.auth.signInWithPassword({ email: users[0].email, password })).error);
  assert.equal((await reserve(passwordOnly)).error?.code, '42501', 'MFA is required');
  assert.equal((await reserve(users[1].api)).error?.code, '42501', 'a different owner cannot reserve');
  assert.equal((await reserve(users[0].api, { p_org: foreignOrg })).error?.code, '42501');
  assert.equal((await reserve(users[0].api, { p_purpose: 'receipt' })).error?.code, '42501');
  assert.equal((await reserve(users[0].api, { p_name: '../Synthetic.pdf' })).error?.code, '22023');
  assert.equal((await reserve(users[0].api, { p_size: 26214401 })).error?.code, '22023');
  const reserved = await Promise.all([reserve(), reserve(), reserve()]);
  reserved.forEach(result => assert.ifError(result.error));
  const stageId = reserved[0].data;
  assert.match(stageId, /^[0-9a-f-]{36}$/);
  assert.equal(new Set(reserved.map(result => result.data)).size, 1);
  assert.equal((await reserve(users[0].api, { p_name: 'Changed.pdf' })).error?.code, 'PT409');
  assert.equal((await reserve(users[0].api, { p_key: args.p_key })).error?.code, 'PT409');
  assert.equal(sql(`select count(*) from private.file_upload_stages where organization_id='${org}';`).toString().trim(), '1');
  assert.equal(sql(`select count(*) from private.audit_events where request_id='${reservation.p_key}'
    and action='file.stage' and redacted_details='{}'::jsonb;`).toString().trim(), '1');
  assert.equal(sql(`select count(*) from private.operation_receipts where organization_id='${org}' and operation_key='${reservation.p_key}'
    and response_snapshot=jsonb_build_object('id','${stageId}');`).toString().trim(), '1');
  const objectTokenForStage = sql(`select object_token from private.file_upload_stages where id='${stageId}';`).toString().trim();
  assert.notEqual(stageId, objectTokenForStage, 'the API returns no Storage object token');
  const attempts = await Promise.all(Array.from({ length: 21 }, () =>
    reserve(users[0].api, { p_key: randomUUID() })));
  assert.equal(attempts.filter(result => !result.error).length, 19);
  assert.equal(attempts.filter(result => result.error?.code === 'PT429').length, 2);
  assert.equal((await reserve()).data, stageId, 'existing retry succeeds at quota');
  sql(`update public.resources set archived_at=now() where id='${reservation.p_parent}';`);
  assert.equal((await reserve()).error?.code, '42501', 'archival also denies an existing reservation retry');
  sql(`update public.resources set archived_at=null where id='${reservation.p_parent}';`);
  const insertStage = size => sql(`insert into private.file_upload_stages(organization_id,parent_resource_id,uploader_membership_id,original_name,purpose,declared_mime,declared_size_bytes,expires_at) values ('${org}','${results[0].data}','${member}','Synthetic.pdf','receipt','application/pdf',${size},now() + interval '1 hour') returning object_token;`);
  const objectToken = insertStage(bytes.length).toString().trim();
  assert.match(objectToken, /^[0-9a-f-]{36}$/);
  assert.throws(() => insertStage(10485761), 'oversized receipt must be rejected');
  assert.throws(() => sql(`delete from private.file_upload_stages where organization_id='${org}';`), 'staging metadata must be append-only');
  const staged = await users[0].api.schema('private').from('file_upload_stages').select('id');
  assert.ok(staged.error, 'staging metadata must not be exposed through the API');
  const quarantine = 'avi-file-quarantine';
  const bucket = await admin.storage.getBucket(quarantine);
  assert.ifError(bucket.error);
  assert.equal(bucket.data.public, false);
  assert.equal(Number(bucket.data.file_size_limit), 26214400);
  assert.deepEqual([...bucket.data.allowed_mime_types].sort(), ['application/pdf', 'image/jpeg', 'image/png']);
  const path = `${org}/${objectToken}`;
  const storage = admin.storage.from(quarantine);
  const ownerStorage = users[0].api.storage.from(quarantine);
  const contentType = 'application/pdf';
  assert.ok((await ownerStorage.upload(path, bytes, { contentType })).error, 'owner cannot upload to a valid stage directly');
  assert.ok((await ownerStorage.createSignedUploadUrl(path)).error, 'owner cannot mint an upload link for a valid stage');
  assert.ok((await storage.upload(`${org}/${randomUUID()}`, bytes, { contentType: 'text/plain' })).error, 'bucket rejects disallowed content types even for the operator');
  const uploaded = await storage.upload(path, bytes, { contentType });
  assert.ifError(uploaded.error);
  const publicUrl = storage.getPublicUrl(path).data.publicUrl;
  assert.equal((await fetch(publicUrl)).ok, false, 'public route must not serve quarantined bytes');
  for (const api of [client(anon), ...users.map(user => user.api)]) {
    const objects = api.storage.from(quarantine);
    const listed = await objects.list(org);
    assert.ok(listed.error || listed.data.length === 0, 'quarantined object must be invisible to listing');
    assert.ok((await objects.download(path)).error, 'quarantined bytes must be private');
    assert.ok((await objects.createSignedUrl(path, 60)).error, 'quarantined bytes must not be signed by app sessions');
  }
  assert.ok((await ownerStorage.update(path, bytes, { contentType })).error, 'owner cannot overwrite bytes');
  const removed = await ownerStorage.remove([path]);
  assert.ok(removed.error || removed.data.length === 0, 'owner cannot remove bytes');
  const retained = await storage.download(path);
  assert.ifError(retained.error);
  assert.deepEqual(Buffer.from(await retained.data.arrayBuffer()), bytes, 'denied operations leave quarantined bytes intact');
  const other = await users[1].api.from('accounts').select('id').eq('id', results[0].data);
  assert.ifError(other.error); assert.deepEqual(other.data, [], 'another user must not see the record');
  const recipient = sql(`select id from public.memberships where organization_id='${org}' and user_id='${users[1].id}';`).toString().trim();
  const share = {
    p_org: org, p_resource: results[0].data, p_recipient: recipient, p_key: randomUUID(),
    p_action: 'grant', p_expires_at: new Date(Date.now() + 3600_000).toISOString(),
  };
  const changeShare = (api = users[0].api, overrides = {}) =>
    api.rpc('change_crm_record_share', { ...share, ...overrides });
  const readShared = api => api.from('accounts').select('id').eq('id', share.p_resource);
  assert.equal((await changeShare()).error?.code, '42501', 'sharing requires a separate permission');
  sql(`insert into public.role_permissions(organization_id,role_id,permission_code)
    select organization_id,id,'account.share' from public.roles where organization_id='${org}' and code='intake_staff';`);
  assert.equal((await changeShare(passwordOnly)).error?.code, '42501', 'sharing requires current MFA');
  assert.equal((await changeShare(users[1].api, { p_recipient: member })).error?.code, '42501', 'a nonowner cannot share');
  const foreignMember = sql(`select private.provision_intake_staff('${foreignOrg}','${users[1].id}','Synthetic user',null,'${randomUUID()}');`).toString().trim();
  assert.equal((await changeShare(users[0].api, { p_recipient: foreignMember })).error?.code, '42501', 'sharing cannot cross organizations');
  const shareResults = await Promise.all([changeShare(), changeShare(), changeShare()]);
  shareResults.forEach(result => assert.ifError(result.error));
  assert.equal(new Set(shareResults.map(result => result.data)).size, 1, 'concurrent grant retries share one period');
  assert.equal((await changeShare(users[0].api, { p_key: randomUUID() })).error?.code, 'PT409');
  assert.equal((await changeShare(users[0].api, { p_expires_at: new Date(Date.now() + 7200_000).toISOString() })).error?.code, 'PT409');
  const visibleShare = await readShared(users[1].api);
  assert.ifError(visibleShare.error);
  assert.deepEqual(visibleShare.data, [{ id: share.p_resource }]);
  const recipientAal1 = client(anon);
  assert.ifError((await recipientAal1.auth.signInWithPassword({ email: users[1].email, password })).error);
  assert.deepEqual((await readShared(recipientAal1)).data, [], 'shared records require recipient MFA');
  const otherAccount = raced.find(result => !result.error).data;
  assert.deepEqual((await users[1].api.from('accounts').select('id').eq('id', otherAccount)).data, []);
  assert.ok((await users[1].api.from('accounts').update({name:'Forbidden'}).eq('id', share.p_resource)).error);
  sql(`update private.crm_record_shares set granted_at=now() - interval '2 hours',expires_at=now() - interval '1 hour'
     where id='${shareResults[0].data}';`);
  assert.deepEqual((await readShared(users[1].api)).data, [], 'expired shares do not allow reads');
  assert.ifError((await changeShare(users[0].api, { p_key: randomUUID() })).error);
  const revoke = { p_key: randomUUID(), p_action: 'revoke', p_expires_at: null };
  const revoked = await changeShare(users[0].api, revoke);
  assert.ifError(revoked.error);
  assert.equal((await changeShare(users[0].api, revoke)).data, revoked.data, 'revocation retry is idempotent');
  assert.deepEqual((await readShared(users[1].api)).data, [], 'revocation removes access with an existing token');
  assert.equal(sql(`select count(*) from private.audit_events where resource_id='${share.p_resource}' and action like 'crm.share.%';`).toString().trim(), '3');
  assert.ifError((await changeShare(users[0].api, { p_key: randomUUID() })).error);
  const direct = await users[0].api.from('accounts').update({name:'Unauthorized'}).eq('id', results[0].data);
  assert.ok(direct.error, 'direct table mutation must be denied');
  sql(`update public.memberships set status='Inactive' where organization_id='${org}' and user_id='${users[0].id}';`);
  const stale = await users[0].api.from('accounts').select('id').eq('id', results[0].data);
  assert.ifError(stale.error); assert.deepEqual(stale.data, [], 'inactive membership must lose access with an existing token');
  const denied = await users[0].api.rpc('create_intake_record', {...args,p_key:randomUUID()});
  assert.ok(denied.error, 'inactive membership must not execute commands');
  assert.deepEqual((await readShared(users[1].api)).data, [], 'deactivating the owner invalidates the share');
  assert.equal((await reserve()).error?.code, '42501', 'inactive membership cannot replay a reservation');
  assert.ok((await ownerStorage.download(path)).error, 'inactive membership cannot download quarantined bytes using an existing token');
  assert.ifError((await storage.remove([path])).error);

  const administratorEmail = `admin-${run}@example.invalid`;
  const administratorAuth = await admin.auth.admin.createUser({
    email: administratorEmail, password, email_confirm: true,
  });
  assert.ifError(administratorAuth.error);
  const administratorId = administratorAuth.data.user.id;
  const adminMember = sql(`select private.provision_pilot_super_admin(
    '${foreignOrg}','${administratorId}','Synthetic administrator','${randomUUID()}'
  );`).toString().trim();
  assert.throws(() => sql(`select private.provision_pilot_super_admin(
    '${foreignOrg}','${administratorId}','Synthetic administrator','${randomUUID()}'
  );`), 'a second pilot administrator bootstrap is denied');

  const pilotApi = client(anon);
  assert.ifError((await pilotApi.auth.signInWithPassword({ email: administratorEmail, password })).error);
  const directory = api => api.rpc('staff_directory', { p_org: foreignOrg });
  assert.equal((await directory(pilotApi)).error?.code, '42501', 'administrator needs MFA');
  assert.equal((await directory(users[1].api)).error?.code, '42501', 'intake staff cannot read the directory');
  const factor = await pilotApi.auth.mfa.enroll({ factorType: 'totp' });
  assert.ifError(factor.error);
  const verify = await pilotApi.auth.mfa.challengeAndVerify({
    factorId: factor.data.id, code: totp(factor.data.totp.secret),
  });
  assert.ifError(verify.error);
  const staff = await directory(pilotApi);
  assert.ifError(staff.error);
  assert.ok(staff.data.some(row => row.membership_id === adminMember && !row.can_deactivate));
  assert.ok(staff.data.some(row => row.membership_id === foreignMember && row.can_deactivate));
  assert.equal((await pilotApi.rpc('staff_directory', { p_org: org })).error?.code, '42501');

  const deactivate = (target, key = randomUUID(), api = pilotApi) =>
    api.rpc('deactivate_staff', { p_org: foreignOrg, p_member: target, p_key: key });
  assert.equal((await deactivate(adminMember)).error?.code, '42501', 'administrator cannot deactivate own access');
  assert.equal((await deactivate(recipient)).error?.code, '42501', 'staff action cannot target another organization');
  assert.equal((await deactivate(foreignMember, randomUUID(), users[1].api)).error?.code, '42501', 'regular staff cannot deactivate');
  const owned = await users[1].api.rpc('create_intake_record', { ...args, p_org: foreignOrg, p_key: randomUUID() });
  assert.ifError(owned.error);
  assert.equal((await deactivate(foreignMember)).error?.code, 'PT409', 'open records must be reassigned');
  sql(`update public.resources set archived_at=now() where id='${owned.data}';`);
  const deactivateKey = randomUUID();
  const disabled = await deactivate(foreignMember, deactivateKey);
  assert.ifError(disabled.error);
  assert.equal((await deactivate(foreignMember, deactivateKey)).data, disabled.data);
  assert.equal((await users[1].api.from('memberships').select('id').eq('id', foreignMember)).data.length, 0, 'existing token loses access');
  assert.equal(sql(`select count(*) from private.audit_events where request_id='${deactivateKey}' and action='staff.deactivate';`).toString().trim(), '1');
});
