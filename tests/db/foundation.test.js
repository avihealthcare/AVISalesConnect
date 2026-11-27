import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const u1='10000000-0000-0000-0000-000000000001', u2='10000000-0000-0000-0000-000000000002';
const u3='10000000-0000-0000-0000-000000000003', m3='30000000-0000-0000-0000-000000000003', r3='40000000-0000-0000-0000-000000000003';
const o1='20000000-0000-0000-0000-000000000001', o2='20000000-0000-0000-0000-000000000002';
const m1='30000000-0000-0000-0000-000000000001', m2='30000000-0000-0000-0000-000000000002';
const r1='40000000-0000-0000-0000-000000000001', r2='40000000-0000-0000-0000-000000000002';

test('foundation enforces tenant, owner, membership and mutation boundaries', async () => {
  const db = new PGlite({ extensions: { btree_gist } });
  try {
    await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth;
      create table auth.users(id uuid primary key);
      create table auth.sessions(id uuid primary key, user_id uuid not null, aal text, not_after timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)$$;
      grant usage on schema auth to authenticated, anon; grant execute on function auth.uid(), auth.jwt() to authenticated, anon;
      create schema storage;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(bucket_id text references storage.buckets(id), name text);
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon, authenticated;
      grant select, insert on storage.objects to anon, authenticated;`);
    const files = await import('node:fs/promises').then(fs => fs.readdir('supabase/migrations'));
    for (const migration of files.filter(f => f.endsWith('.sql')).sort()) await db.exec(await readFile(`supabase/migrations/${migration}`, 'utf8'));
    await db.exec(`insert into storage.buckets(id, name, public) values ('test-bucket', 'test-bucket', false);
      insert into storage.objects values ('avi-file-quarantine', 'synthetic-pending'), ('lead-cards', 'synthetic-card'), ('test-bucket', 'synthetic-other');
      create policy test_permissive_policy on storage.objects for all to anon, authenticated using (true) with check (true);`);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role};`);
      const visible = await db.query('select name from storage.objects');
      assert.deepEqual(visible.rows, [{ name: 'synthetic-other' }], 'quarantine stays invisible under a permissive policy');
      await assert.rejects(db.exec("insert into storage.objects values ('avi-file-quarantine', 'synthetic-denied')"), /row-level security/i);
      await assert.rejects(db.exec("insert into storage.objects values ('lead-cards', 'synthetic-denied')"), /row-level security/i);
      await db.exec('reset role;');
    }
    // Audit the whole migrated public schema, including tables added by future migrations.
    const unsafeTables = await db.query(`select c.relname from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p') and
        (not c.relrowsecurity or has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))`);
    assert.deepEqual(unsafeTables.rows, [], 'public tables must enforce RLS and deny anonymous table privileges');
    const unsafeFunctions = await db.query(`select n.nspname, p.proname from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and p.prosecdef and
        (n.nspname <> 'private' or not coalesce(p.proconfig @> array['search_path=pg_catalog'],false)
         or has_function_privilege('anon',p.oid,'EXECUTE'))`);
    assert.deepEqual(unsafeFunctions.rows, [], 'privileged functions must be private, fix search_path and deny anonymous execution');
    await db.exec(`insert into auth.users values ('${u1}'), ('${u2}'), ('${u3}');
      insert into public.organizations(id,name,timezone,base_currency,financial_year_start_month) values ('${o1}','Synthetic 1','Asia/Kolkata','INR',4),('${o2}','Synthetic 2','Asia/Kolkata','INR',4);
      insert into public.profiles(id,display_name) values ('${u1}','Synthetic A'), ('${u2}','Synthetic B'), ('${u3}','Synthetic C');
      insert into public.memberships(id,organization_id,user_id,status) values ('${m1}','${o1}','${u1}','Active'), ('${m2}','${o2}','${u2}','Active'), ('${m3}','${o1}','${u3}','Active');
      insert into public.resources(id,organization_id,resource_type,owner_membership_id) values ('${r1}','${o1}','lead','${m1}'), ('${r2}','${o2}','lead','${m2}'), ('${r3}','${o1}','lead','${m3}');
      insert into public.roles(id,organization_id,code,name,requires_mfa) values ('50000000-0000-0000-0000-000000000001','${o1}','rep','Rep',false), ('50000000-0000-0000-0000-000000000002','${o2}','finance','Finance',false);
      insert into public.permissions(code,description,requires_mfa) values ('lead.read','Read leads',false),('expense.approve','Approve expenses',true) on conflict(code) do nothing;
      insert into public.role_permissions values ('${o1}','50000000-0000-0000-0000-000000000001','lead.read'), ('${o2}','50000000-0000-0000-0000-000000000002','expense.approve');
      insert into public.member_roles(organization_id,membership_id,role_id,effective_from) values ('${o1}','${m1}','50000000-0000-0000-0000-000000000001',now() - interval '1 day'), ('${o2}','${m2}','50000000-0000-0000-0000-000000000002',now() - interval '1 day');`);
    const stage = (organization, parent, uploader, purpose='receipt', size=100, extra='') => db.exec(`
      insert into private.file_upload_stages(organization_id,parent_resource_id,uploader_membership_id,original_name,purpose,declared_mime,declared_size_bytes,expires_at)
      values ('${organization}','${parent}','${uploader}','Synthetic.pdf','${purpose}','application/pdf',${size},now() + interval '${extra || '1 hour'}')`);
    await stage(o1,r1,m1);
    await assert.rejects(stage(o1,r2,m1), /foreign key/i);
    await assert.rejects(stage(o1,r1,m2), /foreign key/i);
    await assert.rejects(stage(o1,r1,m1,'receipt',10485761), /check constraint/i);
    await assert.rejects(stage(o1,r1,m1,'business_document',26214401), /check constraint/i);
    await assert.rejects(stage(o1,r1,m1,'receipt',10,'25 hours'), /check constraint/i);
    await assert.rejects(db.exec('delete from private.file_upload_stages'), /append-only/i);
    await assert.rejects(db.exec('truncate private.file_upload_stages cascade'), /append-only/i);
    await db.exec(`insert into private.audit_events(organization_id,actor_membership_id,action,request_id) values ('${o1}','${m1}','test','60000000-0000-0000-0000-000000000001');
      insert into private.operation_receipts(organization_id,actor_membership_id,operation_key,command_type,request_hash,response_snapshot) values ('${o1}','${m1}','70000000-0000-0000-0000-000000000001','test',repeat('a',64),'{}');`);
    await assert.rejects(db.exec('delete from private.audit_events'), /append-only/i);
    await assert.rejects(db.exec('truncate private.operation_receipts'), /append-only/i);
    await assert.rejects(db.exec(`insert into private.operation_receipts(organization_id,actor_membership_id,operation_key,command_type,request_hash,response_snapshot) values ('${o1}','${m1}','70000000-0000-0000-0000-000000000001','test',repeat('b',64),'{}')`), /duplicate key/i);
    await assert.rejects(db.exec(`insert into public.member_roles(organization_id,membership_id,role_id,effective_from) values ('${o1}','${m1}','50000000-0000-0000-0000-000000000002',now())`), /foreign key/i);
    await assert.rejects(db.exec(`insert into public.member_roles(organization_id,membership_id,role_id,effective_from) values ('${o1}','${m1}','50000000-0000-0000-0000-000000000001',now())`), /conflicting key/i);
    await db.exec(`insert into public.member_roles(organization_id,membership_id,role_id,effective_from,effective_to) values ('${o1}','${m1}','50000000-0000-0000-0000-000000000001',now() - interval '3 days',(select effective_from from public.member_roles where membership_id='${m1}'))`);
    await assert.rejects(db.exec(`insert into public.resources(organization_id,resource_type,owner_membership_id) values ('${o1}','lead','${m2}')`), /foreign key/i);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${u1}',false);`);
    for (const [table, id] of [['organizations',o1],['memberships',m1],['profiles',u1],['resources',r1]]) {
      const result=await db.query(`select id from public.${table}`);
      assert.deepEqual(result.rows.map(row=>row.id),[id],table);
    }
    assert.equal((await db.query(`select id from public.resources where id in ('${r2}','${r3}')`)).rows.length,0);
    await db.exec(`reset role; delete from public.role_permissions where organization_id='${o1}' and permission_code='lead.read'; set role authenticated;`);
    assert.equal((await db.query('select id from public.resources')).rows.length,0,'ownership without permission is denied');
    await db.exec(`reset role; insert into public.role_permissions values ('${o1}','50000000-0000-0000-0000-000000000001','lead.read'); set role authenticated;`);
    await db.exec(`select set_config('request.jwt.claims','{"aal":"aal1","user_metadata":{"role":"admin","permissions":["expense.approve"]}}',false)`);
    assert.equal((await db.query('select id from public.resources')).rows.length,1);
    assert.equal((await db.query(`select private.has_permission('${o1}','expense.approve') as allowed`)).rows[0].allowed,false, 'editable metadata grants no authority');
    assert.deepEqual((await db.query('select code from public.roles')).rows.map(x=>x.code), ['rep']);
    assert.deepEqual((await db.query('select code from public.permissions')).rows.map(x=>x.code), ['lead.read']);
    await db.exec(`update public.profiles set display_name='Updated synthetic' where id='${u1}'`);
    assert.equal((await db.query('select display_name from public.profiles')).rows[0].display_name,'Updated synthetic');
    await assert.rejects(db.exec(`update public.profiles set id='${u2}' where id='${u1}'`), /permission denied/i);
    await assert.rejects(db.exec('select * from private.audit_events'), /permission denied/i);
    await assert.rejects(db.exec('select * from private.file_upload_stages'), /permission denied/i);
    await assert.rejects(db.exec(`insert into public.member_roles(organization_id,membership_id,role_id,effective_from) values ('${o1}','${m1}','50000000-0000-0000-0000-000000000001',now())`), /permission denied/i);
    assert.equal((await db.query(`select private.has_permission('${o1}','lead.read') as allowed`)).rows[0].allowed,true);
    assert.equal((await db.query(`select private.has_permission('${o2}','expense.approve') as allowed`)).rows[0].allowed,false);
    await db.exec(`select set_config('request.jwt.claim.sub','${u2}',false); select set_config('request.jwt.claims','{"aal":"aal1"}',false)`);
    assert.equal((await db.query(`select private.has_permission('${o2}','expense.approve') as allowed`)).rows[0].allowed,true,
      'a current assignment authorizes email/password sessions even if legacy permission metadata still has an MFA flag');
    await db.exec(`reset role; update public.member_roles set effective_to=now() where membership_id='${m2}'; set role authenticated;`);
    assert.equal((await db.query(`select private.has_permission('${o2}','expense.approve') as allowed`)).rows[0].allowed,false);
    await db.exec(`select set_config('request.jwt.claim.sub','${u1}',false)`);
    await assert.rejects(db.exec(`update public.memberships set status='Active' where id='${m1}'`), /permission denied/i);
    await assert.rejects(db.exec(`insert into public.resources(organization_id,resource_type) values ('${o1}','lead')`), /permission denied/i);
    const create = (kind, key, input, org=o1) => db.query('select public.create_intake_record($1,$2,$3,$4) as id',[org,key,kind,JSON.stringify(input)]);
    const accountKey='80000000-0000-0000-0000-000000000001', leadKey='80000000-0000-0000-0000-000000000002';
    const account={name:'Synthetic Hospital',account_type:'Hospital'};
    await assert.rejects(create('account',accountKey,account), {code:'42501'});
    await db.exec(`reset role; insert into public.role_permissions
      select '${o1}','50000000-0000-0000-0000-000000000001',code from public.permissions
      where code in ('account.create','account.read','lead.create'); set role authenticated;`);
    await assert.rejects(create('account',accountKey,account,o2), {code:'42501'});
    const [{id:accountId}]=(await create('account',accountKey,account)).rows;
    assert.equal((await create('account',accountKey,account)).rows[0].id,accountId);
    await assert.rejects(create('account',accountKey,{...account,name:'Changed'}), {code:'PT409'});
    const lead={source:'Telephone',received_at:'2026-01-01T10:00:00+05:30',prospect_name:'Synthetic prospect',account_id:accountId};
    await assert.rejects(create('lead',leadKey,lead), {code:'23514'});
    await db.exec('reset role');
    assert.equal((await db.query("select count(*)::int as n from private.operation_receipts where operation_key=$1",[leadKey])).rows[0].n,0,'failed command must not leave a receipt');
    assert.equal((await db.query("select count(*)::int as n from private.audit_events where request_id=$1",[leadKey])).rows[0].n,0,'failed command must not leave an audit event');
    assert.equal((await db.query("select count(*)::int as n from public.resources where resource_type='lead'")).rows[0].n,3,'failed command must roll back its resource');
    await db.exec('set role authenticated');
    await assert.rejects(create('lead',leadKey,{...lead,contact_route:'+919000000000',account_id:r3}), {code:'42501'});
    await assert.rejects(create('lead',leadKey,{...lead,contact_route:'+919000000000',owner_membership_id:m3}), {code:'22023'});
    await assert.rejects(create('lead',leadKey,{...lead,source:'IndiaMART',contact_route:'+919000000000'}), {code:'22023'});
    const [{id:leadId}]=(await create('lead',leadKey,{...lead,contact_route:'+919000000000'})).rows;
    assert.equal((await db.query('select id from public.leads')).rows[0].id,leadId);
    await assert.rejects(db.exec('update public.leads set received_at=now()'), {code:'42501'});
    const progress = (key, version, action, input={}) => db.query('select public.progress_lead($1,$2,$3,$4,$5,$6) as id',
      [o1,leadId,'90000000-0000-0000-0000-'+String(key).padStart(12,'0'),version,action,JSON.stringify(input)]);
    await assert.rejects(progress(1,1,'contact',{outcome:'Reached'}),{code:'42501'});
    await db.exec(`reset role; insert into public.role_permissions
      select '${o1}','50000000-0000-0000-0000-000000000001',code from public.permissions
      where code in ('lead.contact','lead.qualify','lead.disqualify','lead.convert','opportunity.read'); set role authenticated;`);
    await assert.rejects(progress(2,1,'convert'),{code:'PT422'});
    await progress(1,1,'contact',{outcome:'No answer'});
    await progress(1,1,'contact',{outcome:'No answer'});
    assert.equal((await db.query('select outcome from public.lead_contact_attempts')).rows.length,1);
    const first = (await db.query('select first_attempt_at,first_successful_contact_at from public.leads where id=$1',[leadId])).rows[0];
    assert.ok(first.first_attempt_at);
    assert.equal(first.first_successful_contact_at,null);
    await assert.rejects(progress(3,1,'contact',{outcome:'Reached'}),{code:'PT409'});
    await progress(3,2,'contact',{outcome:'Reached'});
    const contacted=(await db.query('select first_attempt_at,first_successful_contact_at from public.leads where id=$1',[leadId])).rows[0];
    assert.deepEqual(contacted.first_attempt_at,first.first_attempt_at);
    assert.ok(contacted.first_successful_contact_at);
    await assert.rejects(progress(4,3,'qualify',{requirement:'Monitor'}),{code:'22023'});
    await progress(4,3,'qualify',{requirement:'Monitor',next_action:'Call',due_at:new Date(Date.now()+86400000).toISOString()});
    const opportunity = (await progress(5,4,'convert')).rows[0].id;
    assert.equal((await progress(5,4,'convert')).rows[0].id,opportunity);
    await assert.rejects(progress(6,4,'convert'),{code:'PT409'});
    assert.deepEqual((await db.query('select id,stage from public.opportunities')).rows,[{id:opportunity,stage:'Qualified'}]);
    assert.equal((await db.query('select lifecycle from public.leads where id=$1',[leadId])).rows[0].lifecycle,'Converted');
    const pipeline = (key,version,stage,amount='100000.01',probability=40) => db.query(
      'select public.update_opportunity_pipeline($1,$2,$3,$4,$5,$6,$7,$8) as version',
      [o1,opportunity,'92000000-0000-0000-0000-'+String(key).padStart(12,'0'),version,stage,amount,probability,'Synthetic estimate']);
    await assert.rejects(pipeline(1,1,'Proposal'),{code:'42501'});
    await db.exec(`reset role; insert into public.role_permissions values ('${o1}','50000000-0000-0000-0000-000000000001','opportunity.edit_pipeline'); set role authenticated;`);
    await assert.rejects(pipeline(1,1,'Won'),{code:'22023'});
    await assert.rejects(pipeline(1,1,'Proposal','1.001'),{code:'22023'});
    assert.equal((await pipeline(1,1,'Proposal')).rows[0].version,2);
    assert.equal((await pipeline(1,1,'Proposal')).rows[0].version,2);
    await assert.rejects(pipeline(1,1,'Negotiation'),{code:'PT409'});
    await assert.rejects(pipeline(2,1,'Negotiation'),{code:'PT409'});
    assert.deepEqual((await db.query('select stage,weighted_net_inr::text from public.opportunities')).rows,
      [{stage:'Proposal',weighted_net_inr:'40000.00'}]);
    await pipeline(2,2,'Qualified',null,null);
    assert.equal((await db.query('select weighted_net_inr from public.opportunities')).rows[0].weighted_net_inr,null);
    await assert.rejects(db.exec("update public.opportunities set stage='Won'"),{code:'42501'});
    await db.exec(`reset role`);
    assert.equal((await db.query('select count(*)::int as n from private.audit_events where resource_id in ($1,$2)',[accountId,leadId])).rows[0].n,6);
    assert.equal((await db.query("select count(*)::int as n from private.operation_receipts where command_type in ('lead.create','account.create')")).rows[0].n,2);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${u3}',false)`);
    assert.deepEqual((await db.query('select id from public.accounts')).rows,[]);
    assert.deepEqual((await db.query('select id from public.leads')).rows,[]);
    assert.deepEqual((await db.query('select id from public.opportunities')).rows,[]);
    assert.deepEqual((await db.query('select id from public.lead_contact_attempts')).rows,[]);
    const provision = () => db.query('select private.provision_intake_staff($1,$2,$3,null,$4) as id',
      [o2,u3,'Synthetic staff','91000000-0000-0000-0000-000000000001']);
    await assert.rejects(provision(),{code:'42501'});
    await db.exec('reset role');
    const newMembership=(await provision()).rows[0].id;
    assert.ok(newMembership);
    await assert.rejects(provision(),{code:'23505'});
    assert.equal((await db.query("select count(*)::int as n from private.audit_events where action='staff.provision'")).rows[0].n,1);
    await db.exec(`set role authenticated; select set_config('request.jwt.claims','{"aal":"aal1"}',false)`);
    assert.equal((await db.query("select private.has_permission($1,'lead.create') as can",[o2])).rows[0].can,true);
    assert.equal((await db.query("select private.has_permission($1,'expense.approve') as can",[o2])).rows[0].can,false);
    await db.exec(`select set_config('request.jwt.claim.sub','${u1}',false)`);
    await db.exec(`reset role; update public.memberships set status='Inactive' where id='${m1}'; set role authenticated;`);
    assert.equal((await db.query(`select private.has_permission('${o1}','lead.read') as allowed`)).rows[0].allowed,false);
    for (const table of ['organizations','memberships','profiles','resources','roles','member_roles','permissions','role_permissions']) assert.equal((await db.query(`select * from public.${table}`)).rows.length,0,table);
    await assert.rejects(create('lead',leadKey,{...lead,contact_route:'+919000000000'}), {code:'42501'});
    await db.exec(`reset role; set role anon;`);
    await assert.rejects(db.exec('select * from public.resources'), /permission denied/i);
    await assert.rejects(create('lead',leadKey,{...lead,contact_route:'+919000000000'}), {code:'42501'});

    const adminSession = '92000000-0000-0000-0000-000000000001';
    await db.exec(`reset role;
      select private.provision_pilot_super_admin('${o1}','${u2}','Synthetic administrator','91000000-0000-0000-0000-000000000002');
      insert into auth.sessions(id,user_id,aal) values ('${adminSession}','${u2}','aal1');
      set role authenticated;
      select set_config('request.jwt.claim.sub','${u2}',false);
      select set_config('request.jwt.claims','{"aal":"aal1","session_id":"${adminSession}"}',false);`);
    const fieldWrite = (kind, action, key, data) => db.query(
      'select public.run_sales_field($1,$2,$3,$4,$5) as record', [o1,kind,action,key,data],
    ).then(result => result.rows[0].record);
    const product = { title: 'Synthetic model', details: { code: 'SYN-1', category: 'Testing' } };
    const productKey = '94000000-0000-0000-0000-000000000001';
    const savedProduct = await fieldWrite('product','create',productKey,product);
    assert.deepEqual(await fieldWrite('product','create',productKey,product), savedProduct);
    await assert.rejects(fieldWrite('product','create',productKey,{...product,title:'Different'}), {code:'22023'});
    await assert.rejects(fieldWrite('product','create','94000000-0000-0000-0000-000000000002',product), {code:'23505'});
    const updatedProduct = await fieldWrite('product','edit','94000000-0000-0000-0000-000000000003',
      { ...product, title: 'Updated synthetic model', ...savedProduct });
    assert.equal(updatedProduct.version,2);
    await assert.rejects(fieldWrite('product','edit','94000000-0000-0000-0000-000000000004',
      {...product,...savedProduct}), {code:'40001'});
    const fetched = await db.query("select public.read_sales_field($1,'product') as data",[o1]);
    assert.equal(fetched.rows[0].data.rows[0].title,'Updated synthetic model');
    await assert.rejects(db.query("select public.read_sales_field($1,'product')",[o2]), {code:'42501'});
    const attendance = {title:'Attendance', details:{exception:'Synthetic GPS exception'}};
    const session = await fieldWrite('attendance_session','create','94000000-0000-0000-0000-000000000005',attendance);
    await assert.rejects(fieldWrite('attendance_session','create','94000000-0000-0000-0000-000000000006',attendance), {code:'23505'});
    await fieldWrite('attendance_session','complete','94000000-0000-0000-0000-000000000007',{...attendance,...session});
    assert.equal((await db.query("select public.read_sales_field($1,'attendance_session') as data",[o1]))
      .rows[0].data.rows[0].status,'Pending Review');
    const leadRead = (query={},id=null,org=o1) => db.query('select public.read_lead_management($1,$2,$3) as result',[org,query,id])
      .then(result => result.rows[0].result);
    const leadCommand = (action,input,key=crypto.randomUUID()) =>
      db.query('select public.command_lead_management($1,$2,$3,$4) as result',[o1,action,key,input]).then(result => result.rows[0].result);
    await assert.rejects(leadRead({},null,o2),{code:'42501'});
    const workspace = await leadRead();
    assert.equal(workspace.catalog.filter(entry => entry.kind==='source').length,16);
    assert.equal(workspace.catalog.filter(entry => entry.kind==='stage').length,16);
    const createInput = { fields:{ customer:'Synthetic lead workflow',source:'indiamart',contact:'Synthetic buyer',
      external_reference:'INQUIRY-001',mobile:'+91 90000 00001',email:'Pilot@Example.invalid',stage:'demo_requested',
      requirements:'Synthetic equipment',priority:'Hot',next_action:'Confirm demo',value:'4500.25',received_at:'2025-01-01T00:00:00Z' },
      products:[{category:'Test',model:'Synthetic warmer',quantity:'1',estimated_unit_price:'2500.25'},
        {category:'Test',model:'Synthetic monitor',quantity:'2',estimated_unit_price:'1000.00'}] };
    const newLeadKey = crypto.randomUUID();
    const created = await leadCommand('create',createInput,newLeadKey);
    assert.match(created.number,/^LD-\d{4}-\d+$/);
    assert.deepEqual(await leadCommand('create',createInput,newLeadKey),created);
    await assert.rejects(leadCommand('create',createInput),{code:'23505'});
    let record = await leadRead({},created.id);
    assert.equal(record.products.length,2);
    assert.equal(record.data.sales_stage,'demo_requested');
    assert.equal(record.data.mobile,'+919000000001');
    assert.equal((await leadRead({view:'escalated',search:'Synthetic lead workflow'})).total,1);
    await assert.rejects(leadCommand('stage',{id:created.id,version:1,stage:'lost'}),{code:'22023'});
    const lost = await leadCommand('stage',{id:created.id,version:1,stage:'lost',loss_reason:'price',competitor:'Synthetic supplier'});
    await assert.rejects(leadCommand('stage',{id:created.id,version:2,stage:'quote_requested'}),{code:'22023'});
    const reopened = await leadCommand('reopen',{id:created.id,version:lost.version,stage:'quote_requested',reason:'Customer resumed project'});
    const activity = await leadCommand('activity',{id:created.id,version:reopened.version,kind:'Call',summary:'Synthetic conversation'});
    assert.equal((await leadRead({view:'escalated',search:'Synthetic lead workflow'})).total,0);
    const copy = await leadCommand('create',{fields:{...createInput.fields,external_reference:'INQUIRY-002',routing:'unassigned'},products:[]});
    record = await leadRead({},created.id);
    assert.equal(record.duplicates[0].id,copy.id);
    const merged = await leadCommand('merge',{id:created.id,version:activity.version,other_id:copy.id,other_version:copy.version,reason:'Same original inquiry'});
    assert.equal(merged.version,activity.version+1);
    record = await leadRead({},created.id);
    assert.equal(record.inquiries[0].external_reference,'INQUIRY-002');
    assert.ok(record.timeline.some(event => event.kind==='Call'));
    assert.ok(record.timeline.some(event => event.kind==='Merge'));
    await assert.rejects(leadRead({},copy.id),{code:'PT404'});
    const exported = await leadCommand('export',{query:{search:'Synthetic lead workflow'},format:'csv'});
    assert.equal(exported.total,1);
    await leadCommand('settings',{kind:'source',code:'indiamart',label:'IndiaMART',sort_order:10,active:false});
    await assert.rejects(leadCommand('create',{...createInput,fields:{...createInput.fields,external_reference:'INQUIRY-003'}}),{code:'22023'});
    await leadCommand('settings',{kind:'stage',code:'custom_wave',label:'Pilot stage',sort_order:15,behavior:'active',active:true});
    assert.ok((await leadRead()).catalog.some(entry => entry.code==='custom_wave'));
    const convertedLead = await leadRead({},leadId);
    assert.equal(convertedLead.data.lifecycle,'Converted');
    const continued = await leadCommand('stage',{id:leadId,version:convertedLead.data.row_version,stage:'negotiation'});
    const continuingLead = await leadRead({},leadId);
    assert.equal(continuingLead.data.row_version,continued.version);
    assert.equal(continuingLead.data.sales_stage,'negotiation');
    assert.equal(continuingLead.data.lifecycle,'Converted','linked opportunities stay intact as the lead advances');
    await leadCommand('settings',{kind:'territory_create',label:'Synthetic Northeast'});
    assert.ok((await leadRead()).territories.some(item=>item.name==='Synthetic Northeast'));
    const territoryFixture = '95000000-0000-0000-0000-000000000001';
    const salespersonRole = '95000000-0000-0000-0000-000000000002';
    await db.exec(`reset role;
      insert into private.territories(id,organization_id,name) values ('${territoryFixture}','${o1}','Synthetic lead territory');
      insert into private.territory_memberships values ('${o1}','${m3}','${territoryFixture}');
      insert into public.roles(id,organization_id,code,name) values ('${salespersonRole}','${o1}','lead_test_rep','Synthetic salesperson');
      insert into public.role_permissions values ('${o1}','${salespersonRole}','lead.read');
      insert into public.member_roles(organization_id,membership_id,role_id,effective_from)
        values ('${o1}','${m3}','${salespersonRole}',now());
      set role authenticated;`);
    await leadCommand('settings',{kind:'territory',territory:territoryFixture,member:m3});
    const routed = await leadCommand('create',{fields:{customer:'Synthetic routed lead',source:'website',
      missing_contact_reason:'Telephone pending',territory:territoryFixture,routing:'territory'}});
    assert.equal((await leadRead({},routed.id)).owner,m3);
    assert.ok((await leadRead()).territories.some(t=>t.owner===m3));
    const allocated = await leadCommand('create',{fields:{customer:'Synthetic allocated lead',source:'website',missing_contact_reason:'Telephone pending',routing:'unassigned'}});
    await assert.rejects(leadCommand('assign',{rows:[{id:routed.id,version:0},{id:allocated.id,version:allocated.version}],member:m3,reason:'Synthetic reassignment'}),{code:'PT409'});
    assert.equal((await leadRead({},allocated.id)).owner,null,'bulk assignments are atomic');
    await leadCommand('assign',{rows:[{id:allocated.id,version:allocated.version}],member:m3,reason:'Synthetic reassignment'});
    await db.exec(`select set_config('request.jwt.claim.sub','${u3}',false);`);
    const personal = await leadRead({view:'mine'});
    assert.equal(personal.total,2);
    assert.equal(personal.notifications.length,2);
    assert.ok((await leadCommand('read_notice',{id:personal.notifications[0].id})).saved);
    assert.equal((await leadRead({view:'mine'})).notifications.filter(n=>n.read_at).length,1);
    await assert.rejects(leadRead({},created.id),{code:'PT404'});
    await assert.rejects(leadCommand('export',{query:{},format:'csv'}),{code:'42501'});
    await assert.rejects(leadCommand('activity',{id:routed.id,version:routed.version,kind:'Call',summary:'Read-only user'}),{code:'PT404'});
    await db.exec(`select set_config('request.jwt.claim.sub','${u2}',false);`);
    const customerRead=(query={},id=null,org=o1)=>db.query(
      'select public.read_customer_master($1,$2,$3) as result',[org,query,id]).then(result=>result.rows[0].result);
    const customerWrite=(action,input,key=crypto.randomUUID())=>db.query(
      'select public.command_customer_master($1,$2,$3,$4) as result',[o1,action,key,input]).then(result=>result.rows[0].result);
    const westProfile={name:'Synthetic Medical Centre',group:'Synthetic Group',category:'Private Hospital',status:'Active',
      address:'1 Synthetic Street',city:'Mumbai',nicu:'12',latitude:'19.075',longitude:'72.8777',zoho_id:'TEST-100',phone:'+91 22222 22222'};
    const creationKey=crypto.randomUUID();
    const west=await customerWrite('create',{fields:westProfile},creationKey);
    assert.deepEqual(await customerWrite('create',{fields:westProfile},creationKey),west);
    await assert.rejects(customerWrite('create',{fields:westProfile}),{code:'PT409'});
    await assert.rejects(customerWrite('create',{fields:{...westProfile,name:'Synthetic Zoho duplicate'}}),{code:'23505'});
    await assert.rejects(customerWrite('create',{fields:{...westProfile,longitude:'',name:'Synthetic invalid coordinates'}}),{code:'22023'});
    const east=await customerWrite('create',{fields:{...westProfile,address:'2 Synthetic Street',group:'synthetic  group',zoho_id:'TEST-101'}});
    const westDetails=await customerRead({},west.id);
    assert.match(westDetails.number,/^CUST-\d+$/);
    assert.equal(westDetails.details.nicu,'12');
    assert.equal(westDetails.details.phone,'+912222222222');
    assert.equal(westDetails.branches[0].id,east.id);
    await assert.rejects(customerRead({},west.id,o2),{code:'42501'});
    await customerWrite('department',{id:west.id,version:westDetails.version,fields:{name:'NICU'}});
    await assert.rejects(customerWrite('edit',{id:west.id,version:westDetails.version,fields:westProfile}),{code:'PT409'});
    const contactBody={fields:{name:'Synthetic Clinical Contact',account:west.id,designation:'Neonatologist',
      phone:'+91 90000 00001',whatsapp:'+91 90000 00002',email:'clinic@example.invalid',decision_role:'Technical Evaluator'},
      links:[{account:west.id,department:'nicu'},{account:east.id}]};
    await assert.rejects(customerWrite('contact_create',{...contactBody,links:[{account:west.id,department:'missing'}]}),{code:'22023'});
    const linked=await customerWrite('contact_create',contactBody);
    assert.equal((await customerRead({},west.id)).contacts[0].id,linked.id);
    assert.equal((await customerRead({},east.id)).contacts[0].id,linked.id);
    const person=await customerRead({kind:'contacts'},linked.id);
    assert.equal(person.accounts.length,2);
    assert.equal(person.accounts.find(a=>a.primary).department,'NICU');
    assert.equal(person.details.whatsapp,'+919000000002');
    const matching=await db.query('select public.find_card_matches($1,$2,$3,$4,$5) as result',
      [o1,'Synthetic Medical Centre','09000000001','','clinic@example.invalid']);
    assert.ok(matching.rows[0].result.customers.some(item=>item.id===west.id&&item.can_link));
    assert.deepEqual(matching.rows[0].result.contacts.map(item=>item.id),[linked.id]);
    await assert.rejects(db.query('select public.find_card_matches($1,$2,$3,$4,$5)',
      [o2,'Synthetic Medical Centre','','','clinic@example.invalid']),{code:'42501'});
    const uploadKey=crypto.randomUUID();
    const cardKey=crypto.randomUUID();
    const cardInput={upload_key:uploadKey,front:'jpg',back:'png',fields:{
      source:'visiting_card',customer:'Synthetic Visiting Card',account:west.id,linked_contact_id:linked.id,
      email:'clinic@example.invalid',salutation:'Dr.',department:'NICU',pincode:'400001'}};
    const createCard=(input,key=cardKey)=>db.query('select public.create_card_lead($1,$2,$3) as result',[o1,key,input])
      .then(result=>result.rows[0].result);
    const readCards=(org,lead)=>db.query('select public.read_lead_cards($1,$2) as result',[org,lead])
      .then(result=>result.rows[0].result);
    await assert.rejects(createCard(cardInput),{code:'22023'});
    await db.exec(`reset role;
      insert into storage.objects values
        ('lead-cards','${o1}/${u2}/${uploadKey}/front.jpg'),
        ('lead-cards','${o1}/${u2}/${uploadKey}/back.png');
      set role authenticated;`);
    const cardLead=await createCard(cardInput);
    assert.deepEqual(await createCard(cardInput),cardLead);
    await assert.rejects(createCard({...cardInput,fields:{...cardInput.fields,department:'ICU'}}),{code:'PT409'});
    await assert.rejects(createCard(cardInput,crypto.randomUUID()),{code:'23505'});
    const savedCards=await readCards(o1,cardLead.id);
    assert.equal(savedCards[0].details.department,'NICU');
    assert.equal(savedCards[0].contact,'Synthetic Clinical Contact');
    assert.equal(savedCards[0].has_back,true);
    assert.doesNotMatch(JSON.stringify(savedCards),/front.jpg|back.png/);
    await assert.rejects(readCards(o2,cardLead.id),{code:'PT404'});
    await db.query("select public.authorize_card_request($1,'extract')",[o1]);
    await assert.rejects(db.query("select public.authorize_card_request($1,'extract')",[o2]),{code:'42501'});
    const picker=await customerRead({kind:'contact_choices',search:'mumbai'});
    assert.ok(picker.some(account=>account.id===west.id&&account.departments.some(d=>d.key==='nicu')));
    const masterOwner=(await customerRead({},west.id)).owner;
    const scopedContactRole=crypto.randomUUID();
    await db.exec(`reset role;
      insert into public.roles(id,organization_id,code,name) values ('${scopedContactRole}','${o1}','customer_fixture','Synthetic account reader');
      insert into public.role_permissions values ('${o1}','${scopedContactRole}','account.read'),('${o1}','${scopedContactRole}','contact.read');
      insert into public.member_roles(organization_id,membership_id,role_id,effective_from)
        values ('${o1}','${m3}','${scopedContactRole}',now());
      insert into private.crm_record_shares(organization_id,resource_id,resource_type,owner_membership_id,recipient_membership_id,expires_at)
        values ('${o1}','${east.id}','account','${masterOwner}','${m3}',now()+interval '1 day');
      set role authenticated;
      select set_config('request.jwt.claim.sub','${u3}',false);`);
    const scopedContact=await customerRead({kind:'contacts'},linked.id);
    assert.deepEqual(scopedContact.accounts.map(a=>a.id),[east.id]);
    assert.equal(scopedContact.can_edit,false);
    await assert.rejects(customerRead({},west.id),{code:'PT404'});
    await db.exec(`select set_config('request.jwt.claim.sub','${u2}',false);`);
    await customerWrite('contact_edit',{...contactBody,id:linked.id,version:person.version,links:[contactBody.links[0]]});
    assert.equal((await customerRead({},east.id)).contacts.length,0);
    const fileStage = () => db.query("select public.reserve_file_stage($1,$2,$3,'Synthetic card.pdf','business_document','application/pdf',100) as id",
      [o1,linked.id,crypto.randomUUID()]);
    await assert.rejects(fileStage(),{code:'42501'});
    await db.exec(`reset role;
      insert into public.role_permissions(organization_id,role_id,permission_code) select organization_id,id,'file.stage'
       from public.roles where organization_id='${o1}' and code='super_admin';
      set role authenticated;`);
    assert.ok((await fileStage()).rows[0].id);
    assert.equal((await db.query('select status from public.crm_record_files($1,$2,0)',[o1,linked.id])).rows[0].status,'Pending upload');
    await db.exec(`select set_config('request.jwt.claim.sub','${u3}',false);`);
    await assert.rejects(customerRead({},west.id),{code:'PT404'});
    await db.exec(`select set_config('request.jwt.claim.sub','${u2}',false);`);
    const consoleRead=org=>db.query('select public.read_lead_console($1) as result',[org]).then(result=>result.rows[0].result);
    await assert.rejects(consoleRead(o2),{code:'42501'});
    const summary=await consoleRead(o1);
    assert.ok(summary.active>0);
    assert.ok(summary.categories.includes('Test'));
    const metricsLead=await leadCommand('create',{fields:{customer:'Synthetic console demo',source:'government',priority:'Hot',city:'Mumbai',
      stage:'demo_requested',next_action:'Test follow-up',missing_contact_reason:'Synthetic contact pending',value:'1500000'},
      products:[{category:'Synthetic monitors',model:'Test monitor',quantity:'2'}]});
    const filtered=await leadRead({view:'hot_tenders',city:'Mumbai',product_category:'Synthetic monitors'});
    assert.equal(filtered.total,1);
    assert.equal(filtered.rows[0].id,metricsLead.id);
    const scheduleKey=crypto.randomUUID();
    const due=new Date(Date.now()+1000*60*10).toISOString();
    const scheduleDemo=(version=metricsLead.version,key=scheduleKey)=>db.query(
      'select public.schedule_lead_demo($1,$2,$3,$4,$5,$6) as result',
      [o1,metricsLead.id,key,version,due,'Synthetic trial']).then(result=>result.rows[0].result);
    const scheduled=await scheduleDemo();
    assert.deepEqual(await scheduleDemo(),scheduled);
    await assert.rejects(scheduleDemo(metricsLead.version,crypto.randomUUID()),{code:'PT409'});
    const scheduledDetail=await leadRead({},metricsLead.id);
    assert.equal(scheduledDetail.timeline.filter(e=>e.kind==='Demo scheduled').length,1);
    assert.equal((await leadRead({search:'Synthetic console demo'})).rows[0].demo_at!==null,true);
    const readPolicy = organization => db.query('select public.read_operating_policy_settings($1) as settings', [organization]);
    assert.equal((await readPolicy(o1)).rows[0].settings.expense, null, 'a live email/password session can read admin settings');
    await assert.rejects(readPolicy(o2), {code:'42501'});
    await db.exec(`reset role; update auth.sessions set not_after=now() - interval '1 day' where id='${adminSession}'; set role authenticated;`);
    await assert.rejects(readPolicy(o1), {code:'42501'});
  } finally { await db.close(); }
});
