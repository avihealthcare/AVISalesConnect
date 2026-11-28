import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

test('expense workflow pins effective rules, separates approvals and reconciles manual payments', async () => {
  const db = new PGlite({ extensions: { btree_gist } });
  const org = randomUUID();
  const otherOrg = randomUUID();
  const users = Array.from({ length: 5 }, () => ({ user: randomUUID(), member: randomUUID(), session: randomUUID() }));
  const [owner, manager, finance, outsider, inactive] = users;
  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin;
      create schema auth;
      create table auth.users(id uuid primary key,encrypted_password text);
      create table auth.sessions(id uuid primary key, user_id uuid not null, aal text, not_after timestamptz);
      create function auth.uid() returns uuid language sql stable
        as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable
        as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
      grant usage on schema auth to authenticated,anon;
      grant execute on function auth.uid(), auth.jwt() to authenticated,anon;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(bucket_id text references storage.buckets(id),name text);
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon,authenticated;
      grant select,insert on storage.objects to anon,authenticated;
    `);
    for (const file of (await readdir('supabase/migrations')).filter(file => file.endsWith('.sql')).sort()) {
      await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
    }
    await db.query(`insert into public.organizations(id,name,timezone,base_currency,financial_year_start_month)
      values ($1,'Synthetic expenses','UTC','INR',4),($2,'Synthetic expenses external','UTC','INR',4)`, [org, otherOrg]);
    for (const [index, user] of users.entries()) {
      await db.query('insert into auth.users values ($1)', [user.user]);
      await db.query("insert into auth.sessions values ($1,$2,'aal1',null)", [user.session, user.user]);
      await db.query(`insert into public.memberships(id,organization_id,user_id,status)
        values ($1,$2,$3,$4)`, [user.member, user === outsider ? otherOrg : org, user.user, user === inactive ? 'Inactive' : 'Active']);
      await db.query('insert into public.profiles values ($1,$2,null)', [user.user, `Synthetic ${index}`]);
    }
    const businessDate = (await db.query("select ((now() at time zone 'UTC')::date-1)::text as day")).rows[0].day;
    const today = (await db.query("select ((now() at time zone 'UTC')::date)::text as day")).rows[0].day;
    const rule = { category: 'MEALS', grade: '*', geography: '*', travel_type: '*', calculation: 'actual', partial_day: 'none',
      rate: null, cap: '90.00', receipt_threshold: '1000', tax_included: true, prepayment_allowed: false,
      exception_allowed: false, travel_approval_required: true };
    const mileage = { ...rule, category: 'MILEAGE', calculation: 'mileage', rate: '14.25', cap: null };
    const daily = { ...rule, category: 'HOTEL', calculation: 'daily', rate: '50.00', partial_day: 'half', cap: null };
    const routes = [
      { process: 'travel', subject: null, primary: owner.member, alternate: manager.member, limit: '90' },
      { process: 'manager', subject: owner.member, primary: manager.member, alternate: null, limit: '200' },
      { process: 'finance', subject: null, primary: manager.member, alternate: finance.member, limit: '200' },
    ];
    const seedPolicy = async (settings, revision, effectiveOn) => (await db.query(`insert into private.operating_policy_versions
      (organization_id,section,revision,effective_on,settings,published_by) values ($1,'expense',$2,$3,$4,$5) returning id`,
      [org, revision, effectiveOn, settings, manager.member])).rows[0].id;
    const oldPolicy = await seedPolicy({ rules: [rule, mileage, daily], routes }, 1, businessDate);
    await seedPolicy({ rules: [{ ...rule, cap: '70.00' }, mileage, daily], routes }, 2, today);
    const as = async (user, requestedSession = user.session) => {
      await db.exec('reset role; set role authenticated');
      await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
        [user.user, JSON.stringify({ aal: 'aal1', session_id: requestedSession })]);
    };
    const cmd = async (action, payload, key = randomUUID(), tenant = org) => (await db.query(
      'select public.run_expense_command($1,$2,$3,$4) as result', [tenant, action, key, payload])).rows[0].result;
    const workspace = async (tenant = org) => (await db.query('select public.read_expense_workspace($1) as result', [tenant])).rows[0].result;
    const perform = (action, state, payload = {}, key) => cmd(action, { record: state.id, revision: state.revision, ...payload }, key);

    await as(owner, randomUUID());
    await assert.rejects(workspace(), /access denied/i, 'signed JWT claims without a live session cannot authorize access');
    await as(inactive);
    await assert.rejects(workspace(), /access denied/i);
    await as(owner);
    await assert.rejects(workspace(otherOrg), /access denied/i);
    await assert.rejects(db.exec('select * from private.expense_records'), /permission denied/i);
    const draft = { title: 'Synthetic trip', starts: businessDate, ends: today, geography: 'WEST', travel_type: 'FIELD',
      estimated: '80.00', requested_advance: '75.00', purpose: 'Synthetic client work' };
    let travel = await cmd('create_travel', draft);
    await assert.rejects(perform('submit', travel), /emergency reason/i);
    travel = await perform('edit', travel, { ...draft, retrospective_reason: 'Synthetic emergency' });
    travel = await perform('submit', travel);
    await assert.rejects(perform('approve', travel), /independent approver/i);
    await as(manager);
    travel = await perform('approve', travel);
    assert.equal(travel.status, 'Approved');
    assert.equal((await workspace()).records.find(row => row.id === travel.id).version, 1);
    await as(owner);
    const actual = { category: 'MEALS', service_on: businessDate, vendor: 'Synthetic hotel', amount: '100.50', geography: 'WEST', travel_type: 'FIELD' };
    const claimDraft = { title: 'Synthetic itemized claim', travel_id: travel.id, lines: [
      actual, { ...actual }, { ...actual, category: 'MILEAGE', mileage: '1.25' }, { ...actual, category: 'HOTEL', days: '0.5' },
    ] };
    const key = randomUUID();
    let claim = await cmd('create_claim', claimDraft, key);
    assert.equal((await cmd('create_claim', claimDraft, key)).id, claim.id);
    await assert.rejects(cmd('create_claim', { ...claimDraft, title: 'Changed request' }, key), /already in use/i);
    claim = await perform('submit', claim);
    assert.equal(claim.status, 'Pending Routing', 'published route limit is applied to full claimed amount');
    await db.exec('reset role');
    await seedPolicy({ rules: [{ ...rule, cap: '70.00' }, mileage, daily], routes: [
      ...routes.filter(route => route.process !== 'manager'),
      { process: 'manager', subject: owner.member, primary: inactive.member, alternate: manager.member, limit: '300' },
    ] }, 3, today);
    await as(owner);
    claim = await perform('reroute', claim);
    await assert.rejects(perform('approve', claim), /independent approver/i);
    const snapshot = (await workspace()).records.find(row => row.id === claim.id).versions[0].snapshot;
    const policyAmounts = snapshot.lines.map(line => line.allowed);
    assert.deepEqual(policyAmounts, [90, 90, 17.81, 25]);
    assert.equal(snapshot.lines[1].possible_duplicate, true);
    assert.equal(snapshot.lines[0].policy_id, oldPolicy, 'actual line uses service date even after a rule update');
    await as(outsider);
    assert.deepEqual((await workspace(otherOrg)).records, []);
    await assert.rejects(perform('approve', claim), /access denied/i);
    await as(manager);
    claim = await perform('return', claim, { reason: 'Check synthetic source' });
    await as(owner);
    claim = await perform('edit', claim, { ...claimDraft, lines: claimDraft.lines.slice(1) });
    claim = await perform('submit', claim);
    assert.equal((await workspace()).records.find(row => row.id === claim.id).versions.length, 2);
    await as(manager);
    claim = await perform('approve', claim);
    assert.equal(claim.status, 'Manager Approved');
    await assert.rejects(perform('start_finance', claim), /independent finance reviewer/i);
    await as(finance);
    claim = await perform('start_finance', claim);
    await assert.rejects(perform('finance_approve', claim, { allowances: ['100', '17.81', '25'] }), /cannot exceed/i);
    await assert.rejects(perform('finance_approve', claim, { allowances: ['80', '17.81', '25'] }), /reason/i);
    claim = await perform('finance_approve', claim, { allowances: ['80', '17.81', '25'], reason: 'Synthetic adjustment' });
    assert.equal(claim.status, 'Approved for Payment');

    const evidence = randomUUID();
    const secondEvidence = randomUUID();
    const travelEvidence = randomUUID();
    await db.exec('reset role');
    for (const [file, parent] of [[evidence, claim.id], [secondEvidence, claim.id], [travelEvidence, travel.id]]) {
      await db.query(`insert into private.file_upload_stages(id,organization_id,parent_resource_id,uploader_membership_id,
        original_name,purpose,declared_mime,declared_size_bytes,expires_at) values
        ($1,$2,$3,$4,'Synthetic proof.pdf','business_document','application/pdf',100,now()+interval '1 hour')`, [file, org, parent, finance.member]);
      await db.query(`insert into private.file_upload_objects(stage_id,sha256,stored_at,verdict,scanner_version,scanned_at)
        values ($1,repeat('a',64),now(),'clean','synthetic',now())`, [file]);
    }
    await as(finance);
    const payment = (amount, reference) => ({ amount, reference, payment_date: today, evidence });
    await assert.rejects(perform('advance', claim, payment('10', 'SYN-ADV')), /unused trip advance/i);
    const tripPayment = (amount, reference) => ({ ...payment(amount, reference), evidence: travelEvidence });
    await assert.rejects(perform('issue_advance', travel, tripPayment('76', 'SYN-ISSUE')), /remaining balance/i);
    travel = await perform('issue_advance', travel, tripPayment('60', 'SYN-ISSUE'));
    await assert.rejects(perform('advance', claim, payment('61', 'SYN-ADV')), /unused trip advance/i);
    await assert.rejects(perform('reimburse', claim, { ...payment('5', 'SYN-MISSING'), evidence: randomUUID() }), /clean scanned proof/i);
    claim = await perform('advance', claim, payment('50', 'SYN-ADV'));
    assert.equal(claim.status, 'Partly Reimbursed');
    const beforePayment = claim;
    const paymentKey = randomUUID();
    claim = await perform('reimburse', claim, payment('72.81', 'SYN-PAY'), paymentKey);
    assert.equal(claim.status, 'Reimbursed');
    assert.deepEqual(await perform('reimburse', beforePayment, payment('72.81', 'SYN-PAY'), paymentKey), claim);
    await assert.rejects(perform('reimburse', beforePayment, payment('1', 'SYN-OVER')), /changed/i);
    await assert.rejects(perform('reimburse', claim, payment('1', 'SYN-OVER')), /outstanding balance/i);
    const movement = (await workspace()).records.find(row => row.id === claim.id).movements.find(item => item.kind === 'reimbursement');
    const reversal = { reference: 'SYN-REVERSE', payment_date: today, evidence: secondEvidence, movement: movement.id, reason: 'Synthetic correction' };
    claim = await perform('reverse', claim, reversal);
    const settled = (await workspace()).records.find(row => row.id === claim.id);
    assert.equal(settled.status, 'Partly Reimbursed');
    assert.equal(settled.paid, 50);
    assert.equal(settled.outstanding, 72.81);
    assert.equal(settled.movements.length, 3);
    assert.equal(settled.unused_advance, 10);
    await assert.rejects(perform('return_advance', travel, tripPayment('11', 'SYN-RETURN')), /remaining balance/i);
    travel = await perform('return_advance', travel, tripPayment('10', 'SYN-RETURN'));
    const exportKey = randomUUID();
    const exportRows = (await cmd('export_csv', {}, exportKey)).rows;
    assert.deepEqual(exportRows.map(row => row.allowed), [80, 17.81, 25]);
    assert.equal(exportRows[0].advance_applied, 50);
    assert.ok(exportRows.every(row => row.outstanding === 72.81 && row.line_id));
    await cmd('export_csv', {}, exportKey);
    await as(manager);
    await assert.rejects(cmd('export_csv', {}), /finance export access denied/i);
    await as(finance);
    await assert.rejects(perform('reverse', claim, { ...reversal, reference: 'SYN-REVERSE-2' }), /unreversed payment/i);
    await db.exec('reset role');
    await assert.rejects(db.exec('delete from private.expense_movements'), /append-only/i);
    await assert.rejects(db.exec('delete from private.expense_versions'), /append-only/i);
    await assert.rejects(db.exec('delete from private.expense_submitted_lines'), /append-only/i);
    assert.equal((await db.query("select count(*) from private.audit_events where action='expense.export_csv'")).rows[0].count, 1);
    await db.exec('set role anon');
    await assert.rejects(workspace(), /permission denied/i);
  } finally {
    await db.close();
  }
});
