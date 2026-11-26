// Opt-in against an explicitly disposable local Supabase stack only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { createPrivateFileHandler } from '../../supabase/functions/_shared/private-files.js';

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
    const claims = await user.api.auth.getClaims();
    assert.ifError(claims.error);
    assert.equal(claims.data.claims.aal, 'aal1', 'staff uses an email/password session');
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
  // Test the Edge handler against real local Auth, PostgREST and Storage.
  // The scanner callbacks are controlled fixtures. They do not claim to detect malware.
  const allowedOrigin = 'http://127.0.0.1:5173';
  const handler = scan => createPrivateFileHandler({ client: admin, allowedOrigin, enabled: true, scan });
  const enabledFilePath = org + '/' + objectTokenForStage;
  const [{ data: ownerSession }, { data: peerSession }] = await Promise.all([
    users[0].api.auth.getSession(), users[1].api.auth.getSession(),
  ]);
  const expiredClient = client(anon);
  const { data: expiredLogin, error: expiredLoginError } = await expiredClient.auth.signInWithPassword({
    email: users[0].email, password,
  });
  assert.ifError(expiredLoginError);
  const expiredClaims = await expiredClient.auth.getClaims();
  assert.ifError(expiredClaims.error);
  const expiredId = expiredClaims.data.claims.session_id;
  assert.match(expiredId, /^[0-9a-f-]{36}$/);
  sql(`update auth.sessions set not_after=now() - interval '1 day' where id='${expiredId}';`);
  const callFile = (handle, {
    method = 'GET', stage = stageId, session = ownerSession.session, body = bytes, origin = allowedOrigin,
  } = {}) => handle(new Request(url + '/functions/v1/private-files?stage=' + stage, {
    method,
    headers: {
      ...(session ? { authorization: 'Bearer ' + session.access_token } : {}),
      ...(origin ? { origin } : {}),
      ...(method === 'POST' ? { 'content-type': 'application/pdf' } : {}),
    },
    ...(method === 'POST' ? { body } : {}),
  }));
  const cleanScanner = handler(async inspection => ({
    sha256: inspection.sha256, verdict: 'clean', version: 'synthetic-test',
  }));
  const quarantineOnly = handler();
  const badScanner = handler(async () => ({
    sha256: '0'.repeat(64), verdict: 'clean', version: 'synthetic-test',
  }));
  assert.equal((await callFile(quarantineOnly, { session: null })).status, 401);
  assert.equal((await callFile(quarantineOnly, { session: expiredLogin.session, method: 'POST' })).status, 404, 'expired sessions cannot upload');
  assert.equal((await callFile(quarantineOnly, { session: peerSession.session, method: 'POST' })).status, 404);
  assert.equal((await callFile(quarantineOnly, { origin: 'https://unrelated.example.invalid' })).status, 403);
  assert.equal((await callFile(quarantineOnly, { method: 'POST', body: bytes.subarray(0, -1) })).status, 422);
  const publicWorkerRead = await users[0].api.rpc('file_worker_lookup', {
    p_user: users[0].id, p_session: randomUUID(), p_stage: stageId, p_download: false,
  });
  assert.ok(publicWorkerRead.error, 'browser roles cannot call the trusted database broker');
  sql(`insert into public.role_permissions(organization_id,role_id,permission_code)
    select organization_id,id,'file.download' from public.roles where organization_id='${org}' and code='intake_staff';`);
  assert.equal((await callFile(quarantineOnly, { method: 'POST' })).status, 202);
  assert.equal((await callFile(quarantineOnly)).status, 404, 'no scanner means no release');
  assert.equal((await callFile(badScanner, { method: 'POST' })).status, 202);
  assert.equal((await callFile(cleanScanner)).status, 404, 'a mismatched digest cannot release bytes');
  sql(`update private.file_upload_objects set scan_lease_until=now()-interval '1 second' where stage_id='${stageId}';`);
  const updatedBytes = Buffer.from(bytes);
  updatedBytes[updatedBytes.length - 1] = 32;
  assert.equal((await callFile(cleanScanner, { method: 'POST', body: updatedBytes })).status, 409);
  assert.equal((await callFile(cleanScanner, { method: 'POST' })).status, 200);
  assert.equal((await callFile(cleanScanner, { method: 'POST' })).status, 200);
  const released = await callFile(cleanScanner);
  assert.equal(released.status, 200);
  assert.equal(released.headers.get('cache-control'), 'private, no-store');
  assert.match(released.headers.get('content-disposition'), /attachment.*Synthetic.pdf/);
  assert.deepEqual(Buffer.from(await released.arrayBuffer()), bytes);
  assert.equal((await callFile(cleanScanner, { session: peerSession.session })).status, 404);
  assert.ok((await ownerStorage.download(enabledFilePath)).error, 'clean bytes remain private in Storage');
  const listArgs = { p_org: org, p_resource: results[0].data, p_offset: 0 };
  const attachmentList = await users[0].api.rpc('crm_record_files', listArgs);
  assert.ifError(attachmentList.error);
  const attached = attachmentList.data.find(file => file.id === stageId);
  assert.equal(attached.status, 'Available');
  assert.equal(attached.file_name, 'Synthetic.pdf');
  assert.deepEqual(Object.keys(attached).sort(), ['created_at', 'file_name', 'id', 'status']);
  assert.equal((await users[1].api.rpc('crm_record_files', listArgs)).error?.code, '42501');
  assert.equal(sql(`select count(*) from private.audit_events where request_id='${stageId}'
    and action in ('file.stored','file.scan.clean');`).toString().trim(), '2');

  const rejectedStage = attempts.find(result => !result.error).data;
  const rejectedScanner = handler(async inspection => ({
    sha256: inspection.sha256, verdict: 'rejected', version: 'synthetic-test',
  }));
  const rejected = await callFile(rejectedScanner, { stage: rejectedStage, method: 'POST' });
  assert.deepEqual(await rejected.json(), { status: 'rejected' });
  assert.equal((await callFile(cleanScanner, { stage: rejectedStage })).status, 404);
  const rejectedToken = sql(`select object_token from private.file_upload_stages where id='${rejectedStage}';`).toString().trim();
  const workerPaths = [enabledFilePath, org + '/' + rejectedToken];
  if (process.env.TEST_LOCAL_FILE_EDGE === 'yes') {
    const runtimeStage = attempts.filter(result => !result.error)[1].data;
    const runtimeHandler = request => fetch(request);
    const pending = await callFile(runtimeHandler, { stage: runtimeStage, method: 'POST' });
    assert.equal(pending.status, 202);
    assert.deepEqual(await pending.json(), { status: 'awaiting_scan' });
    assert.equal((await callFile(runtimeHandler, { stage: runtimeStage })).status, 404);
    assert.equal((await callFile(runtimeHandler, { stage: runtimeStage, origin: 'https://unrelated.example.invalid' })).status, 403);
    const runtimeToken = sql(`select object_token from private.file_upload_stages where id='${runtimeStage}';`).toString().trim();
    workerPaths.push(org + '/' + runtimeToken);
  }

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
  assert.equal((await callFile(cleanScanner)).status, 404, 'deactivation denies downloads with an existing token');
  assert.equal((await users[0].api.rpc('crm_record_files', listArgs)).error?.code, '42501');
  assert.ifError((await storage.remove([path, ...workerPaths])).error);

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
  const pilotClaims = await pilotApi.auth.getClaims();
  assert.ifError(pilotClaims.error);
  assert.equal(pilotClaims.data.claims.aal, 'aal1', 'administration uses an email/password session');
  assert.equal((await directory(users[1].api)).error?.code, '42501', 'intake staff cannot read the directory');
  const readSettings = (api = pilotApi, organization = foreignOrg) =>
    api.rpc('read_operating_policy_settings', { p_org: organization });
  const initialSettings = await readSettings();
  assert.ifError(initialSettings.error);
  assert.equal(initialSettings.data.expense, null);
  assert.equal(initialSettings.data.tender, null);
  assert.equal((await readSettings(users[1].api)).error?.code, '42501');
  assert.equal((await readSettings(pilotApi, org)).error?.code, '42501');
  const expenseRule = { category: 'MILEAGE', grade: '*', geography: '*', travel_type: '*', calculation: 'mileage',
    rate: '12.50', cap: '200.00', receipt_threshold: null, partial_day: 'none', tax_included: false,
    prepayment_allowed: false, exception_allowed: false, travel_approval_required: true };
  const publish = overrides => pilotApi.rpc('publish_operating_policy_settings', {
    p_org: foreignOrg, p_section: 'expense', p_expected: null, p_effective_on: initialSettings.data.today,
    p_settings: { rules: [expenseRule], routes: [] }, p_key: randomUUID(), ...overrides,
  });
  assert.equal((await publish({ p_settings: { rules: [{ ...expenseRule, rate: '0.123' }], routes: [] } })).error?.code, '22023');
  assert.equal((await publish({ p_settings: { rules: [expenseRule, expenseRule], routes: [] } })).error?.code, '22023');
  const overlap = await publish({ p_settings: { rules: [
    { ...expenseRule, grade: 'FIELD' }, { ...expenseRule, geography: 'WEST' },
  ], routes: [] } });
  assert.equal(overlap.error?.code, '22023');
  const publishKey = randomUUID();
  const first = await publish({ p_key: publishKey });
  assert.ifError(first.error);
  assert.equal((await publish({ p_key: publishKey })).data, first.data);
  assert.equal((await publish({})).error?.code, 'PT409');
  const updated = await publish({ p_expected: first.data, p_settings: { rules: [{ ...expenseRule, rate: '14.00' }], routes: [] } });
  assert.ifError(updated.error);
  assert.notEqual(updated.data, first.data);
  assert.equal((await readSettings()).data.expense.settings.rules[0].rate, '14.00');
  assert.equal(sql(`select settings->'rules'->0->>'rate' from private.operating_policy_versions where id='${first.data}';`).toString().trim(), '12.50');
  const tenderRoute = { process: 'waiver', subject: null, primary: foreignMember, alternate: null, limit: '2000.00' };
  assert.equal((await publish({ p_section: 'tender', p_settings: { rules: [], routes: [{ ...tenderRoute, subject: foreignMember }] } })).error?.code, '22023');
  assert.equal((await publish({ p_section: 'tender', p_settings: { rules: [], routes: [{ ...tenderRoute, primary: recipient }] } })).error?.code, '22023');
  const tenderPolicy = await publish({ p_section: 'tender', p_settings: { rules: [], routes: [tenderRoute] } });
  assert.ifError(tenderPolicy.error);
  assert.equal((await readSettings()).data.tender.id, tenderPolicy.data);
  assert.equal(sql(`select count(*) from private.audit_events where request_id='${publishKey}' and action='admin.policy.publish';`).toString().trim(), '1');

  const staff = await directory(pilotApi);
  assert.ifError(staff.error);
  assert.ok(staff.data.some(row => row.membership_id === adminMember && !row.can_deactivate));
  assert.ok(staff.data.some(row => row.membership_id === foreignMember && row.can_deactivate));
  assert.equal((await pilotApi.rpc('staff_directory', { p_org: org })).error?.code, '42501');

  // A scoped reader, record owner and scope administrator are three separate memberships.
  const secondRep = sql(`select private.provision_intake_staff(
    '${foreignOrg}','${users[0].id}','Synthetic colleague',null,'${randomUUID()}'
  );`).toString().trim();
  const territory = randomUUID();
  const outsideTerritory = randomUUID();
  const scopedRole = randomUUID();
  sql(`insert into private.territories(id,organization_id,name)
    values ('${territory}','${foreignOrg}','Synthetic North'),('${outsideTerritory}','${org}','Synthetic Other');
    insert into public.roles(id,organization_id,code,name,requires_mfa)
    values ('${scopedRole}','${foreignOrg}','scope_fixture','Synthetic scoped reader',true);
    insert into public.member_roles(organization_id,membership_id,role_id,effective_from)
    values ('${foreignOrg}','${foreignMember}','${scopedRole}',now());
    insert into public.role_permissions(organization_id,role_id,permission_code)
    values ('${foreignOrg}','${scopedRole}','account.read.team'),('${foreignOrg}','${scopedRole}','account.read.territory');
  `);
  const changeScope = (action, subject, target, key = randomUUID(), api = pilotApi) =>
    api.rpc('change_staff_scope', { p_org: foreignOrg, p_action: action, p_subject: subject, p_target: target, p_key: key });
  assert.equal((await changeScope('set_manager', secondRep, foreignMember)).error?.code, '42501', 'pilot administrators have no automatic scope configuration grant');
  sql(`insert into public.role_permissions(organization_id,role_id,permission_code)
    select organization_id,id,'staff.scope.manage' from public.roles where organization_id='${foreignOrg}' and code='super_admin';`);
  assert.equal((await changeScope('set_manager', secondRep, foreignMember, randomUUID(), users[1].api)).error?.code, '42501');
  assert.equal((await changeScope('set_manager', secondRep, adminMember)).error?.code, '42501', 'admins cannot make themselves the recipient of a reporting change');
  assert.equal((await changeScope('grant_territory', adminMember, territory)).error?.code, '42501', 'admins cannot grant their own territory');
  assert.equal((await changeScope('grant_territory', foreignMember, outsideTerritory)).error?.code, '42501', 'territory cannot cross organizations');
  const secondAccount = await users[0].api.rpc('create_intake_record', { ...args, p_org: foreignOrg, p_key: randomUUID() });
  assert.ifError(secondAccount.error);
  const visibleAccount = async () => {
    const result = await users[1].api.from('accounts').select('id').eq('id', secondAccount.data);
    assert.ifError(result.error);
    return result.data.map(record => record.id);
  };
  assert.deepEqual(await visibleAccount(), [], 'scope role alone gives no access without an assignment');
  const managerKey = randomUUID();
  const managerResults = await Promise.all(Array.from({ length: 3 }, () =>
    changeScope('set_manager', secondRep, foreignMember, managerKey)));
  managerResults.forEach(result => assert.ifError(result.error));
  assert.equal(new Set(managerResults.map(result => result.data)).size, 1);
  assert.equal((await changeScope('set_manager', foreignMember, secondRep)).error?.code, 'PT409', 'cycles are rejected');
  assert.deepEqual(await visibleAccount(), [secondAccount.data]);
  assert.ok((await users[1].api.from('accounts').update({name:'Forbidden'}).eq('id', secondAccount.data)).error, 'team readers cannot edit');
  assert.ifError((await changeScope('set_manager', secondRep, null)).error);
  assert.deepEqual(await visibleAccount(), [], 'removing the reporting line invalidates team access');
  assert.equal((await changeScope('set_record_territory', secondAccount.data, territory)).error?.code, '42501', 'changing another owner record requires organization read scope');
  sql(`insert into public.role_permissions(organization_id,role_id,permission_code)
    select organization_id,id,'account.read.organization' from public.roles where organization_id='${foreignOrg}' and code='super_admin';`);
  assert.ifError((await changeScope('set_record_territory', secondAccount.data, territory)).error);
  assert.ifError((await changeScope('grant_territory', foreignMember, territory)).error);
  assert.deepEqual(await visibleAccount(), [secondAccount.data]);
  assert.ifError((await changeScope('revoke_territory', foreignMember, territory)).error);
  assert.deepEqual(await visibleAccount(), []);
  assert.equal(sql(`select count(*) from private.audit_events where request_id='${managerKey}' and action='staff.scope.set_manager';`).toString().trim(), '1');

  const delegatedRole = randomUUID();
  const restrictedRole = randomUUID();
  sql(`insert into public.roles(id,organization_id,code,name,requires_mfa,delegable)
    values ('${delegatedRole}','${foreignOrg}','delegable_fixture','Synthetic delegation',true,true),
           ('${restrictedRole}','${foreignOrg}','staff_fixture','Synthetic privileged role',true,true);
    insert into public.role_permissions(organization_id,role_id,permission_code)
    values ('${foreignOrg}','${delegatedRole}','lead.read.team'),
           ('${foreignOrg}','${restrictedRole}','staff.scope.manage');
  `);
  const changeRole = (action, memberId, roleId = delegatedRole, key = randomUUID(), api = pilotApi) =>
    api.rpc('change_staff_role', { p_org: foreignOrg, p_action: action, p_member: memberId, p_role: roleId, p_key: key });
  assert.equal((await changeRole('grant', foreignMember)).error?.code, '42501', 'no automatic role delegation grant');
  sql(`insert into public.role_permissions(organization_id,role_id,permission_code)
    select organization_id,id,'staff.role.manage' from public.roles where organization_id='${foreignOrg}' and code='super_admin';`);
  assert.equal((await changeRole('grant', adminMember)).error?.code, '42501', 'self grant denied');
  assert.equal((await changeRole('grant', foreignMember, restrictedRole)).error?.code, '42501', 'staff administration roles cannot be delegated');
  assert.equal((await changeRole('grant', foreignMember, scopedRole)).error?.code, '42501', 'operator must opt a role into delegation');
  assert.equal((await changeRole('grant', recipient)).error?.code, '42501', 'cross-organization role grants are denied');
  const grantKey = randomUUID();
  const roleGrants = await Promise.all(Array.from({ length: 3 }, () =>
    changeRole('grant', foreignMember, delegatedRole, grantKey)));
  roleGrants.forEach(result => assert.ifError(result.error));
  assert.equal(new Set(roleGrants.map(result => result.data)).size, 1);
  assert.equal((await changeRole('revoke', foreignMember, delegatedRole, grantKey)).error?.code, 'PT409');
  const inherited = () => users[1].api.from('member_roles').select('id').eq('id', roleGrants[0].data);
  assert.equal((await inherited()).data.length, 1);
  assert.ifError((await changeRole('revoke', foreignMember)).error);
  assert.deepEqual((await inherited()).data, [], 'the existing token loses a revoked role');
  assert.equal(sql(`select count(*) from private.audit_events where request_id='${grantKey}' and action='staff.role.grant';`).toString().trim(), '1');

  const deactivate = (target, key = randomUUID(), api = pilotApi) =>
    api.rpc('deactivate_staff', { p_org: foreignOrg, p_member: target, p_key: key });
  assert.equal((await deactivate(adminMember)).error?.code, '42501', 'administrator cannot deactivate own access');
  assert.equal((await deactivate(recipient)).error?.code, '42501', 'staff action cannot target another organization');
  assert.equal((await deactivate(foreignMember, randomUUID(), users[1].api)).error?.code, '42501', 'regular staff cannot deactivate');
  const owned = await users[1].api.rpc('create_intake_record', { ...args, p_org: foreignOrg, p_key: randomUUID() });
  assert.ifError(owned.error);
  assert.equal((await deactivate(foreignMember)).error?.code, 'PT409', 'open records must be reassigned');
  const handover = (successor = secondRep, key = randomUUID()) => pilotApi.rpc('offboard_staff', {
    p_org: foreignOrg, p_member: foreignMember, p_successor: successor, p_key: key,
  });
  assert.equal((await handover()).error?.code, '42501', 'handover requires a separate permission');
  sql(`insert into public.role_permissions(organization_id,role_id,permission_code)
    select organization_id,id,'staff.reassign' from public.roles where organization_id='${foreignOrg}' and code='super_admin';`);
  assert.equal((await handover(adminMember)).error?.code, '42501', 'administrator cannot transfer records to themselves');
  const handoverKey = randomUUID();
  const disabled = await handover(secondRep, handoverKey);
  assert.ifError(disabled.error);
  assert.equal((await handover(secondRep, handoverKey)).data, disabled.data);
  assert.equal((await users[1].api.from('memberships').select('id').eq('id', foreignMember)).data.length, 0, 'existing token loses access');
  assert.deepEqual((await users[0].api.from('accounts').select('id').eq('id', owned.data)).data, [{ id: owned.data }]);
  assert.equal(sql(`select count(*) from private.audit_events where request_id='${handoverKey}'
    and action in ('staff.offboard','resource.owner.transfer');`).toString().trim(), '2');
});
