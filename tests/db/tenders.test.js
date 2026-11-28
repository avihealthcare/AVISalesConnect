import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

test('tender command flow isolates records, pins decisions and freezes a two-lot bid', async () => {
  const db = new PGlite({ extensions: { btree_gist } });
  const org = randomUUID();
  const externalOrg = randomUUID();
  const [owner, reviewer, outsider, unverified] = Array.from({ length: 4 }, () => ({
    user: randomUUID(), member: randomUUID(), session: randomUUID(),
  }));
  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin;
      create schema auth;
      create table auth.users(id uuid primary key,email_confirmed_at timestamptz,encrypted_password text);
      create table auth.sessions(id uuid primary key,user_id uuid not null,aal text,not_after timestamptz);
      create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable
      as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
      grant usage on schema auth to authenticated,anon;
      grant execute on function auth.uid(),auth.jwt() to authenticated,anon;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(bucket_id text references storage.buckets(id),name text);
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated,anon;
      grant select,insert on storage.objects to authenticated,anon;
    `);
    for (const file of (await readdir('supabase/migrations')).filter(file => file.endsWith('.sql')).sort()) {
      await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
    }
    await db.query(`insert into public.organizations (id,name,timezone,base_currency,financial_year_start_month)
      values ($1,'Synthetic tenders','UTC','INR',4),($2,'Synthetic external','UTC','INR',4)`, [org, externalOrg]);
    for (const [index, actor] of [owner, reviewer, outsider, unverified].entries()) {
      await db.query('insert into auth.users values ($1,case when $2::boolean then now() end)', [actor.user, actor !== unverified]);
      await db.query("insert into auth.sessions values ($1,$2,'aal1',null)", [actor.session, actor.user]);
      await db.query(`insert into public.memberships (id,organization_id,user_id,status)
        values ($1,$2,$3,'Active')`, [actor.member, actor === outsider ? externalOrg : org, actor.user]);
      await db.query('insert into public.profiles (id,display_name) values ($1,$2)', [actor.user, `Synthetic tester ${index}`]);
    }
    const role = randomUUID();
    await db.query("insert into public.roles (id,organization_id,code,name) values ($1,$2,'tender_test','Synthetic tender owner')", [role, org]);
    await db.query("insert into public.role_permissions values ($1,$2,'tender.edit'),($1,$2,'tender.read')", [org, role]);
    await db.query("insert into public.member_roles (organization_id,membership_id,role_id,effective_from) values ($1,$2,$3,now())", [org, owner.member, role]);

    async function as(actor) {
      await db.exec('set role authenticated');
      await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [
        actor.user, JSON.stringify({ aal: 'aal1', session_id: actor.session }),
      ]);
    }
    const command = async (action, payload, id = null, version = null, key = randomUUID()) =>
      (await db.query('select public.execute_tender_command($1,$2,$3,$4,$5,$6) result', [org, action, payload, key, id, version])).rows[0].result;
    const workspace = async id => (await db.query('select public.tender_workspace($1,$2) result', [org, id ?? null])).rows[0].result;
    const deadline = ahead => new Date(Date.now() + ahead * 86400000).toISOString();

    await as(unverified);
    await assert.rejects(workspace(), /Tender access denied/i);
    await as(owner);
    const register = { authority: 'Synthetic Authority', portal: 'Synthetic Portal', reference: 'T-001',
      deadline: deadline(30), timezone: 'UTC', estimate: '2000.00' };
    const key = randomUUID();
    const registration = await command('register', register, null, null, key);
    const { id } = registration;
    let version = registration.version;
    assert.deepEqual(await command('register', register, null, null, key), registration);
    await assert.rejects(command('register', { ...register, reference: 'DIFFERENT' }, null, null, key), /already used/i);
    await assert.rejects(command('register', { ...register, portal: 'synthetic portal', reference: 't-001' }), /duplicate key/i);
    await assert.rejects(command('register', { ...register, deadline: '2030-01-01T20:00+05:30', reference: 'T-002' }), /offset does not match/i);
    await assert.rejects(command('register', { ...register, portal_url: 'javascript:alert(1)', reference: 'T-003' }), /check constraint/i);
    const advance = async (action, payload) => { version = (await command(action, payload, id, version)).version; };
    await advance('add_lot', { number: 'Lot 1', description: 'Synthetic first lot' });
    await assert.rejects(command('add_lot', { number: 'Lot 2', description: 'Synthetic second lot' }, id, 1), /Tender changed/i);
    await advance('add_lot', { number: 'Lot 2', description: 'Synthetic second lot' });
    const lots = (await workspace(id)).lots;
    await advance('prebid_add', { issue: 'Synthetic specification gap', change: 'Synthetic change proposal',
      responsible: 'Synthetic owner' });
    const prebid = (await workspace(id)).tracking.prebid[0].id;
    await advance('prebid_submit', { query: prebid, happened_at: new Date().toISOString(), reference: 'SYNTH-QUERY' });
    await advance('prebid_reply', { query: prebid, happened_at: new Date().toISOString(), response: 'Synthetic clarification response' });
    await advance('observe_competitor', { competitor: 'Synthetic competitor', observation: 'Synthetic public observation',
      source: 'Synthetic public resource', observed_on: new Date().toISOString().slice(0, 10), confidence: 'Low' });
    const decision = { decision: 'Go', reason: 'Independent approval for synthetic terms' };
    await assert.rejects(command('bid_decision', decision, id, version), /independent reviewer/i);
    await as(reviewer);
    assert.deepEqual((await workspace()).records, []);
    await assert.rejects(command('bid_decision', decision, id, version), /Tender access denied/i);

    await db.exec('reset role');
    const routes = ['bid', 'submission', 'waiver'].map(process => ({
      process, subject: owner.member, primary: reviewer.member, alternate: null, limit: '3000.00',
    }));
    await db.query(`insert into private.operating_policy_versions (organization_id,section,revision,effective_on,settings,published_by)
      values ($1,'tender',1,current_date,$2,$3)`, [org, { rules: [], routes }, owner.member]);
    await as(outsider);
    await assert.rejects(workspace(id), /Tender access denied/i);
    await as(reviewer);
    assert.equal((await workspace(id)).can_review, true);
    await advance('bid_decision', decision);

    await as(owner);
    const fileId = (await db.query(`select public.reserve_file_stage($1,$2,$3,'Synthetic.pdf','business_document','application/pdf',42) id`,
      [org, id, randomUUID()])).rows[0].id;
    assert.equal((await workspace(id)).files[0].status, 'Pending upload');
    for (const lot of lots) {
      await advance('offer_lot', { lot: lot.id, model: 'Synthetic Model', quantity: '10' });
      await advance('add_checklist', { lot: lot.id, title: 'Synthetic compliance', kind: 'compliance', mandatory: true, nonwaivable: true });
    }
    const items = (await workspace(id)).checklist;
    await assert.rejects(command('attach_checklist', { item: items[0].id, file: fileId }, id, version), /scanned attachment/i);

    const hash = '0'.repeat(64);
    const lease = randomUUID();
    await db.exec('reset role; set role service_role');
    const lookup = async (actor, download) => (await db.query('select public.file_worker_lookup($1,$2,$3,$4) result',
      [actor.user, actor.session, fileId, download])).rows[0].result;
    const worker = async (action, verdict = null) => (await db.query('select public.file_worker_transition($1,$2,$3,$4,$5,$6,$7,$8) result',
      [owner.user, owner.session, fileId, hash, action, lease, verdict, verdict ? 'Synthetic scanner fixture' : null])).rows[0].result;
    const metadata = await lookup(owner, false);
    assert.equal(await worker('claim'), 'claimed');
    await assert.rejects(lookup(reviewer, true), /File unavailable/i);
    await db.exec('reset role');
    await db.query("insert into storage.objects values ('avi-file-quarantine',$1)", [metadata.path]);
    await db.exec('set role service_role');
    assert.equal(await worker('stored'), 'stored');
    assert.equal(await worker('scan'), 'scan_acquired');
    assert.equal(await worker('verdict', 'clean'), 'clean');
    assert.equal((await lookup(reviewer, true)).sha256, hash);
    await assert.rejects(lookup(outsider, true), /File unavailable/i);
    await db.exec('reset role');

    await as(owner);
    await advance('corrigendum', { deadline: deadline(35), timezone: 'UTC', reason: 'Authority extended deadline', file: fileId });
    assert.equal((await workspace(id)).record.bid_decision, 'Pending');
    await as(reviewer);
    await advance('bid_decision', decision);
    await as(owner);
    for (const item of items) await advance('attach_checklist', { item: item.id, file: fileId });
    await as(reviewer);
    await assert.rejects(command('waive_checklist', { item: items[0].id, reason: 'Synthetic waiver' }, id, version), /non-waivable/i);
    const submit = { submitted_at: new Date().toISOString(), submitted_by: 'Synthetic uploader', acknowledgement: 'PORTAL-RECEIPT-1' };
    await assert.rejects(command('record_submission', submit, id, version), /current reviewed evidence/i);
    for (const item of items) await advance('review_checklist', { item: item.id });
    assert.deepEqual((await workspace(id)).readiness, []);
    await advance('record_submission', submit);
    const submission = (await workspace(id)).events.find(event => event.kind === 'record_submission').payload;
    assert.equal(submission.lots.length, 2);
    assert.equal(submission.checklist[0].sha256, hash);
    assert.match(submission.snapshot_sha256, /^[a-f0-9]{64}$/);

    await as(owner);
    await advance('submission_addendum', { reason: 'Synthetic correction', file: fileId });
    await advance('evaluate_lot', { lot: lots[0].id, state: 'Technical Qualified', reason: 'Synthetic technical result' });
    await advance('evaluate_lot', { lot: lots[0].id, state: 'Financial Opened', rank: '1', reason: 'Synthetic result' });
    const lotResult = (await workspace(id)).lots[0];
    assert.equal(lotResult.observed_rank, 1);
    assert.equal(lotResult.evaluation, 'Financial Opened');
    await assert.rejects(command('close', { reason: 'Synthetic closure' }, id, version), /Resolve every lot/i);
    const award = { lot: lots[0].id, quantity: '4', value: '400.00', customer: 'Synthetic buyer',
      contract: 'SYNTH-CONTRACT', awarded_at: new Date().toISOString(), file: fileId };
    await assert.rejects(command('award_lot', { ...award, quantity: '11' }, id, version), /offered quantity/i);
    await advance('award_lot', award);
    await advance('evaluate_lot', { lot: lots[1].id, state: 'Lost', reason: 'Synthetic award to another bidder' });
    await advance('close', { reason: 'Lot decisions resolved' });
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = deadline(1).slice(0, 10);
    await advance('security_add', { kind: 'PBG', lot: lots[0].id, instrument: 'Guarantee', issuer: 'Synthetic issuer',
      reference: 'SYNTH-PBG', amount: '100.00', issued_on: today, expires_on: tomorrow });
    const security = (await workspace(id)).tracking.securities[0].id;
    const securityAction = { security, occurred_on: today, reason: 'Synthetic security update' };
    await assert.rejects(command('security_step', { ...securityAction, state: 'Released' }, id, version), /available security transition/i);
    await advance('security_step', { ...securityAction, state: 'Submitted', file: fileId });
    await advance('security_step', { ...securityAction, state: 'Active' });
    await advance('security_extend', { security, expires_on: deadline(2).slice(0, 10), reason: 'Synthetic extension', file: fileId });
    await advance('security_step', { ...securityAction, state: 'Release Requested', follow_up: today });
    await assert.rejects(command('security_step', { ...securityAction, state: 'Released', reference: 'RELEASE-REF' }, id, version), /scanned attachment/i);
    const execution = { lot: lots[0].id, happened_at: new Date().toISOString(), reference: 'EXTERNAL-EXEC', file: fileId };
    await advance('execution_entry', { ...execution, kind: 'Dispatched', quantity: '3' });
    await assert.rejects(command('execution_entry', { ...execution, kind: 'Installed', quantity: '4' }, id, version), /exceeds/i);
    await advance('execution_entry', { ...execution, kind: 'Installed', quantity: '2' });
    await advance('execution_entry', { ...execution, kind: 'Accepted', quantity: '2' });
    await advance('invoice_add', { lot: lots[0].id, reference: 'SYNTH-INVOICE', due_on: deadline(-1).slice(0, 10), amount: '300.00', file: fileId });
    const invoice = (await workspace(id)).tracking.invoices[0].id;
    const payment = { invoice, happened_at: new Date().toISOString(), reason: 'Synthetic receipt', reference: 'BANK-RECEIPT-TEST', file: fileId };
    await assert.rejects(command('invoice_follow_up', { ...payment, received: '301.00' }, id, version), /cannot exceed/i);
    await advance('invoice_follow_up', { ...payment, received: '25.00' });
    const closed = await workspace(id);
    assert.equal(closed.tracking.securities[0].follow_up_due, true);
    assert.equal(closed.tracking.invoices[0].overdue, true);
    assert.equal(closed.tracking.invoices[0].outstanding, '275.00');
    assert.equal(closed.tracking.execution.length, 3);
    assert.equal(closed.record.lifecycle, 'Closed');
    assert.deepEqual(closed.events.find(event => event.kind === 'record_submission').payload, submission);
    assert.deepEqual(closed.lots.map(lot => lot.evaluation), ['Awarded', 'Lost']);
    assert.equal(closed.reminders.length, 0);
    await assert.rejects(db.exec('select * from private.tender_events'), /permission denied/i);
    await db.exec('reset role');
    await assert.rejects(db.exec('update private.tender_events set payload = \'{}\''), /append-only/i);
  } finally {
    await db.close();
  }
});
