// Explicitly opt in only against a disposable local Supabase stack.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const url = process.env.LOCAL_SUPABASE_URL;
const publicKey = process.env.LOCAL_SUPABASE_ANON_KEY;
const service = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const container = process.env.LOCAL_SUPABASE_DB_CONTAINER;
assert.equal(process.env.CONFIRM_DISPOSABLE_LOCAL_SUPABASE, 'yes', 'Use a disposable local stack');
assert.ok(url && ['127.0.0.1', 'localhost'].includes(new URL(url).hostname) && new URL(url).protocol === 'http:');
assert.ok(publicKey && service && /^supabase_db_[a-zA-Z0-9_-]+$/.test(container ?? ''));
const api = key => createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const sql = input => execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
  '-U', 'postgres', '-d', 'postgres', '-qAt'], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

test('concurrent local API reimbursements cannot exceed the remaining claim balance', async () => {
  const org = randomUUID();
  const trip = randomUUID();
  const claim = randomUUID();
  const travelProof = randomUUID();
  const advanceProof = randomUUID();
  const members = [randomUUID(), randomUUID(), randomUUID()];
  const [owner, manager, finance] = members;
  const admin = api(service);
  const password = `Synthetic-${randomUUID()}aA1!`;
  const users = [];
  for (const [index] of members.entries()) {
    const email = `synthetic-expense-${randomUUID()}@example.invalid`;
    const provisioned = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(provisioned.error);
    users.push({ id: provisioned.data.user.id, email, member: members[index] });
  }

  // The DB test exercises creation and approval commands. This fixture starts at the race boundary.
  sql(`insert into public.organizations(id,name,timezone,base_currency,financial_year_start_month)
    values ('${org}','Synthetic concurrent payments','UTC','INR',4);
    insert into public.memberships(id,organization_id,user_id,status) values
      ${users.map(user => `('${user.member}','${org}','${user.id}','Active')`).join(', ')};
    insert into public.profiles(id,display_name) values
      ${users.map((user, index) => `('${user.id}','Synthetic ${index}')`).join(', ')};
    insert into public.resources(id,organization_id,resource_type,owner_membership_id) values
      ('${trip}','${org}','travel_request','${owner}'),('${claim}','${org}','expense_claim','${owner}');
    insert into private.expense_records
      (organization_id,id,owner_id,kind,status,revision,version,draft,approver_id,manager_id,finance_id,claimed,allowed)
    values ('${org}','${trip}','${owner}','travel','Approved',3,1,
       jsonb_build_object('title','Synthetic trip','estimated',12000,'requested_advance',3000),
       '${manager}',null,'${finance}',12000,12000),
      ('${org}','${claim}','${owner}','claim','Partly Reimbursed',5,1,
       jsonb_build_object('title','Synthetic claim','travel_id','${trip}','lines','[]'::jsonb),
       '${finance}','${manager}','${finance}',10000,10000);
    insert into private.expense_versions(organization_id,record_id,version,snapshot,snapshot_hash)
    values ('${org}','${trip}',1,'{}'::jsonb,repeat('a',64)),('${org}','${claim}',1,'{}'::jsonb,repeat('b',64));
    insert into private.file_upload_stages
      (id,organization_id,parent_resource_id,uploader_membership_id,original_name,purpose,declared_mime,declared_size_bytes,expires_at)
    values ('${travelProof}','${org}','${trip}','${finance}','Synthetic travel proof.pdf','business_document','application/pdf',100,now()+interval '1 hour'),
      ('${advanceProof}','${org}','${claim}','${finance}','Synthetic application.pdf','business_document','application/pdf',100,now()+interval '1 hour');
    insert into private.file_upload_objects(stage_id,sha256,stored_at,verdict,scanner_version,scanned_at)
    values ('${travelProof}',repeat('c',64),now(),'clean','synthetic',now()),('${advanceProof}',repeat('d',64),now(),'clean','synthetic',now());
    insert into private.expense_movements(organization_id,record_id,version,actor_id,kind,amount,payment_date,reference,evidence_id,travel_id)
    values ('${org}','${trip}',1,'${finance}','advance_issue',3000,current_date,'Synthetic advance issued','${travelProof}','${trip}'),
      ('${org}','${claim}',1,'${finance}','advance',3000,current_date,'Synthetic advance applied','${advanceProof}','${trip}');
  `);
  const open = async user => {
    const connection = api(publicKey);
    const signed = await connection.auth.signInWithPassword({ email: user.email, password });
    assert.ifError(signed.error);
    return connection;
  };
  const [financeA, financeB, ownerSession] = await Promise.all([open(users[2]), open(users[2]), open(users[0])]);
  const reservation = { p_org: org, p_parent: claim, p_key: randomUUID(), p_name: 'Synthetic payment.pdf',
    p_purpose: 'business_document', p_mime: 'application/pdf', p_size: 100 };
  assert.equal((await ownerSession.rpc('reserve_file_stage', reservation)).error?.code, '42501');
  const reserved = await financeA.rpc('reserve_file_stage', reservation);
  assert.ifError(reserved.error);
  assert.match(reserved.data, /^[0-9a-f-]{36}$/);
  sql(`insert into private.file_upload_objects(stage_id,sha256,stored_at,verdict,scanner_version,scanned_at)
    values ('${reserved.data}',repeat('e',64),now(),'clean','synthetic',now());`);
  const workspace = await financeA.rpc('read_expense_workspace', { p_org: org });
  assert.ifError(workspace.error);
  const payable = workspace.data.records.find(row => row.id === claim);
  assert.equal(payable.outstanding, 7000);
  const args = attempt => ({ p_org: org, p_action: 'reimburse', p_key: randomUUID(), p_payload: {
    record: claim, revision: payable.revision, amount: '5000.00', reference: `Synthetic payment ${attempt}`,
    payment_date: workspace.data.today, evidence: reserved.data,
  } });
  const requests = [args('A'), args('B')];
  assert.equal((await ownerSession.rpc('run_expense_command', requests[0])).error?.code, '42501');
  const results = await Promise.all([financeA.rpc('run_expense_command', requests[0]), financeB.rpc('run_expense_command', requests[1])]);
  const winner = results.findIndex(result => !result.error);
  assert.ok(winner >= 0, results.map(result => result.error?.message).join(' | '));
  assert.equal(results[1-winner].error?.code, '40001');
  assert.deepEqual((await financeA.rpc('run_expense_command', requests[winner])).data, results[winner].data);
  const fresh = await financeB.rpc('read_expense_workspace', { p_org: org });
  assert.ifError(fresh.error);
  assert.equal(fresh.data.records.find(row => row.id === claim).outstanding, 2000);
  assert.equal(sql(`select count(*) from private.expense_movements where organization_id='${org}' and record_id='${claim}'
    and kind='reimbursement';`), '1');
});
