import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../../packages/domain/database.types';

type Screen = 'home' | 'accounts' | 'leads' | 'opportunities';
type Account = { id: string; name: string; account_type: string };
type Lead = { id: string; display_number: number; prospect_name: string; source: string; received_at: string; lifecycle: string; contact_route: string | null; requirement_text: string | null; account_id: string | null; row_version: number; next_action: string | null; next_action_due_at: string | null };
type OrganizationMembership = { id: string; organization_id: string; organizations: { name: string } | null };
const manualSources = ['Telephone', 'Email', 'WhatsApp', 'Website', 'Referral', 'Event', 'Other'];
const leadSources = [...manualSources, 'CSV', 'IndiaMART'];
const timestamp = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

function IntakeList({ db, organization, screen }: { db: SupabaseClient<Database>; organization: string; screen: 'accounts' | 'leads' }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [revision, refresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const pending = useRef<{ key: string; body: string } | null>(null);
  const isLead = screen === 'leads';

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    (async () => {
      if (!isLead) {
        const result = await db.from('accounts').select('id,name,account_type').eq('organization_id', organization)
          .order('name').order('id').range(page * 25, page * 25 + 25);
        if (!active) return;
        setAccounts((result.data ?? []).slice(0, 25));
        setMore((result.data?.length ?? 0) > 25);
        setLoadError(Boolean(result.error));
      } else {
        let query = db.from('leads').select('id,display_number,prospect_name,source,received_at,lifecycle,contact_route,requirement_text,account_id,row_version,next_action,next_action_due_at')
          .eq('organization_id', organization);
        if (filter) query = query.eq('source', filter);
        const [result, links] = await Promise.all([
          query.order('received_at', { ascending: false }).order('id').range(page * 25, page * 25 + 25),
          db.from('accounts').select('id,name,account_type').eq('organization_id', organization).order('name').limit(100)
        ]);
        if (!active) return;
        setLeads((result.data ?? []).slice(0, 25));
        setMore((result.data?.length ?? 0) > 25);
        setAccounts(links.data ?? []);
        setLoadError(Boolean(result.error || links.error));
      }
      setLoading(false);
    })().catch(() => { if (active) { setLoadError(true); setLoading(false); } });
    return () => { active = false; };
  }, [db, organization, isLead, filter, page, revision]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const field = (name: string) => String(values.get(name) ?? '').trim();
    setError('');
    setSaved(false);
    const received = isLead ? new Date(field('received_at')) : null;
    if (received && (!Number.isFinite(received.valueOf()) || received.valueOf() > Date.now())) {
      setError('Enter a receipt time in the past.');
      return;
    }
    if (isLead && !field('contact_route') && !field('missing_contact_reason')) {
      setError('Enter a phone number or email, or explain why contact details are missing.');
      return;
    }
    const input = isLead ? {
      prospect_name: field('prospect_name'), source: field('source'), received_at: received!.toISOString(),
      contact_route: field('contact_route') || null, missing_contact_reason: field('missing_contact_reason') || null,
      requirement_text: field('requirement_text') || null, account_id: field('account_id') || null
    } : { name: field('name'), account_type: field('account_type') };
    const body = JSON.stringify(input);
    if (pending.current?.body !== body) pending.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    try {
      const result = await db.rpc('create_intake_record', { p_org: organization, p_key: pending.current.key, p_kind: isLead ? 'lead' : 'account', p_input: input });
      if (result.error) {
        if (result.error.code === '42501') setError('You do not have permission to create this record or use the selected customer.');
        else if (['23502', '23514', '22023', '22007'].includes(result.error.code)) setError('Review the name, source, receipt time, and contact details, then try again.');
        else setError('Unable to confirm the save. Retry with the same entries to avoid creating a duplicate.');
        return;
      }
      pending.current = null;
      form.reset();
      setSaved(true);
      setPage(0);
      setFilter('');
      refresh(value => value + 1);
    } catch {
      setError('Unable to confirm the save. Retry with the same entries to avoid creating a duplicate.');
    } finally { setBusy(false); }
  }

  return <div className="workspace-grid">
    <section className="panel" aria-labelledby="create-title">
      <h2 id="create-title">{isLead ? 'Capture a lead' : 'Add a customer'}</h2>
      <form onSubmit={create}>
        {isLead ? <>
          <label htmlFor="prospect_name">Customer or contact name</label><input id="prospect_name" name="prospect_name" required maxLength={200} />
          <label htmlFor="source">Source</label><select id="source" name="source">{manualSources.map(source => <option key={source}>{source}</option>)}</select>
          <label htmlFor="received_at">Received at (your device’s local time)</label><input id="received_at" name="received_at" type="datetime-local" required />
          <label htmlFor="contact_route">Phone number or email</label><input id="contact_route" name="contact_route" maxLength={254} placeholder="+919876543210 or name@example.com" />
          <label htmlFor="missing_contact_reason">Reason, if contact details are missing</label><input id="missing_contact_reason" name="missing_contact_reason" maxLength={500} />
          <label htmlFor="account_id">Link a visible customer (optional)</label><select id="account_id" name="account_id"><option value="">No linked customer</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select>
          <label htmlFor="requirement_text">Requirement or original message</label><textarea id="requirement_text" name="requirement_text" maxLength={10000} rows={3} />
        </> : <>
          <label htmlFor="name">Customer name</label><input id="name" name="name" required maxLength={200} />
          <label htmlFor="account_type">Customer type</label><select id="account_type" name="account_type">{['Hospital','Institution','Distributor','Other'].map(type => <option key={type}>{type}</option>)}</select>
        </>}
        <button disabled={busy}>{busy ? 'Saving…' : (isLead ? 'Save lead' : 'Save customer')}</button>
      </form>
      {saved && <p role="status">Record saved.</p>}
      {error && <p role="alert" className="error">{error}</p>}
    </section>
    <section className="panel" aria-labelledby="list-title">
      <h2 id="list-title">{isLead ? 'Leads' : 'Customers'}</h2>
      {isLead && <><label htmlFor="source-filter">Filter by source</label><select id="source-filter" value={filter} onChange={e => { setFilter(e.target.value); setPage(0); }}><option value="">All sources</option>{leadSources.map(source => <option key={source}>{source}</option>)}</select></>}
      {loading ? <p role="status">Loading records…</p> : loadError ? <p role="alert">Unable to load records. <button className="link" onClick={() => refresh(value => value + 1)}>Retry</button></p> : isLead ? (
        leads.length ? <ul className="records">{leads.map(lead => <li key={lead.id}><strong>{lead.prospect_name}</strong><p>Lead {lead.display_number} · {lead.source} · {lead.lifecycle}</p><p>{timestamp.format(new Date(lead.received_at))} IST</p>{lead.contact_route && <p>{lead.contact_route}</p>}{lead.requirement_text && <p className="requirement">{lead.requirement_text}</p>}{lead.next_action && <p>Next action: {lead.next_action}{lead.next_action_due_at && ` · ${timestamp.format(new Date(lead.next_action_due_at))} IST`}</p>}
        <LeadFollowUp db={db} organization={organization} lead={lead} refresh={() => refresh(value => value + 1)} /></li>)}</ul> : <p>No leads are visible for this selection.</p>
      ) : accounts.length ? <ul className="records">{accounts.map(account => <li key={account.id}><strong>{account.name}</strong><p>{account.account_type}</p></li>)}</ul> : <p>No customers are visible.</p>}
      {!loading && !loadError && (page > 0 || more) && <div><button className="secondary" disabled={!page} onClick={() => setPage(value => value - 1)}>Previous</button><button className="secondary" disabled={!more} onClick={() => setPage(value => value + 1)}>Next</button></div>}
    </section>
  </div>;
}

export function IntakeWorkspace({ db, memberships, signOut, busy }: { db: SupabaseClient<Database>; memberships: OrganizationMembership[]; signOut: () => void; busy: boolean }) {
  const [organization, selectOrganization] = useState(memberships[0].organization_id);
  const [screen, setScreen] = useState<Screen>('home');
  return <main className="workspace">
    <header className="workspace-header"><div><p className="eyebrow">AVI Healthcare</p><h1>SalesConnect</h1></div>
      <div><label htmlFor="organization">Organization</label><select id="organization" value={organization} onChange={e => selectOrganization(e.target.value)}>{memberships.map(m => <option key={m.id} value={m.organization_id}>{m.organizations?.name ?? 'Organization'}</option>)}</select></div>
      <button className="secondary" onClick={signOut} disabled={busy}>Sign out</button>
    </header>
    <nav className="workspace-nav" aria-label="SalesConnect">{([['home','Home'],['accounts','Customers'],['leads','Leads'],['opportunities','Opportunities']] as const).map(([id,label]) => <button key={id} className="secondary" aria-current={id === screen ? 'page' : undefined} onClick={() => setScreen(id)}>{label}</button>)}</nav>
    {screen === 'home' ? <section className="panel"><h2>Sales workspace</h2><p>Create customers, capture and follow up on inquiries, and view converted opportunities.</p></section> : screen === 'opportunities' ? <OpportunityList key={organization} db={db} organization={organization} /> : <IntakeList key={organization + screen} db={db} organization={organization} screen={screen} />}
  </main>;
}

function LeadFollowUp({ db, organization, lead, refresh }: {
  db: SupabaseClient<Database>; organization: string; lead: Lead; refresh: () => void;
}) {
  const [action, setAction] = useState('contact');
  const [busy, setBusy] = useState(false);
  const [message, showMessage] = useState('');
  const retry = useRef<{ body: string; id: string } | null>(null);
  const [attempts, setAttempts] = useState<{ id: string; outcome: string; attempted_at: string; notes: string | null }[] | null>(null);

  async function showHistory() {
    const response = await db.from('lead_contact_attempts').select('id,outcome,attempted_at,notes')
      .eq('organization_id', organization).eq('lead_id', lead.id).order('attempted_at', { ascending: false }).limit(25);
    if (response.error) showMessage('Could not load contact history.');
    else setAttempts(response.data);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const read = (name: string) => String(fields.get(name) ?? '').trim();
    let input: Json = {};
    if (action === 'contact') input = { outcome: read('outcome'), notes: read('notes') };
    if (action === 'disqualify') input = { reason: read('reason') };
    if (action === 'qualify') {
      const due = new Date(read('due'));
      if (!Number.isFinite(due.valueOf()) || due.valueOf() <= Date.now()) {
        showMessage('Choose a future date and time for the next action.');
        return;
      }
      input = { requirement: read('requirement'), next_action: read('next_action'), due_at: due.toISOString() };
    }
    const body = JSON.stringify([lead.row_version, action, input]);
    if (retry.current?.body !== body) retry.current = { body, id: crypto.randomUUID() };
    setBusy(true);
    showMessage('');
    try {
      const response = await db.rpc('progress_lead', { p_org: organization, p_id: lead.id, p_version: lead.row_version, p_key: retry.current.id, p_action: action, p_input: input });
      if (response.error) {
        const errors: Record<string, string> = {
          '42501': 'You do not have permission for this action.',
          PT404: 'The lead or customer is no longer available.',
          PT409: 'The lead changed. Refresh the records before trying again.',
          PT422: 'This action is unavailable in the current lead status.',
          '22023': 'Check the required fields and try again.'
        };
        showMessage(errors[response.error.code] ?? 'Could not confirm the save. Retry with the same entries.');
      } else {
        retry.current = null;
        refresh();
      }
    } catch {
      showMessage('Could not confirm the save. Retry with the same entries.');
    } finally { setBusy(false); }
  }

  const closed = ['Converted', 'Disqualified'].includes(lead.lifecycle);
  const suffix = lead.id;
  return <details>
    <summary>Follow-up and history</summary>
    <button type="button" className="secondary" onClick={() => void showHistory()}>Load contact history</button>
    {attempts && (attempts.length ? <ul>{attempts.map(attempt => <li key={attempt.id}>
      {attempt.outcome} · {timestamp.format(new Date(attempt.attempted_at))} IST{attempt.notes && <p>{attempt.notes}</p>}
    </li>)}</ul> : <p>No contact attempts recorded.</p>)}
    {!closed && <form onSubmit={submit}>
      <label htmlFor={`action-${suffix}`}>Action</label>
      <select id={`action-${suffix}`} value={action} onChange={event => setAction(event.target.value)} disabled={busy}>
        <option value="contact">Log contact attempt</option><option value="qualify">Qualify</option>
        <option value="disqualify">Disqualify</option>
        {lead.lifecycle === 'Qualified' && lead.account_id && <option value="convert">Convert to opportunity</option>}
      </select>
      {action === 'contact' && <><label htmlFor={`outcome-${suffix}`}>Outcome</label><select id={`outcome-${suffix}`} name="outcome"><option>No answer</option><option>Reached</option><option>Invalid contact</option></select>
        <label htmlFor={`notes-${suffix}`}>Notes</label><textarea id={`notes-${suffix}`} name="notes" maxLength={2000} /></>}
      {action === 'qualify' && <><label htmlFor={`requirement-${suffix}`}>Requirement</label><textarea id={`requirement-${suffix}`} name="requirement" defaultValue={lead.requirement_text ?? ''} required maxLength={10000} />
        <label htmlFor={`next-${suffix}`}>Next action</label><input id={`next-${suffix}`} name="next_action" defaultValue={lead.next_action ?? ''} required maxLength={500} />
        <label htmlFor={`due-${suffix}`}>Due (your device’s local time)</label><input id={`due-${suffix}`} name="due" type="datetime-local" required /></>}
      {action === 'disqualify' && <><label htmlFor={`reason-${suffix}`}>Reason</label><textarea id={`reason-${suffix}`} name="reason" required maxLength={1000}/></>}
      <button disabled={busy}>{busy ? 'Saving…' : 'Save action'}</button>
    </form>}
    {message && <p role="alert">{message}</p>}
    {message.includes('Refresh the records') && <button type="button" className="secondary" onClick={refresh}>Refresh records</button>}
  </details>;
}

type Opportunity = {
  id: string;
  stage: string;
  requirement_text: string;
  accounts: { name: string } | null;
  row_version: number;
  estimated_net_inr: string | null;
  probability_percent: number | null;
  weighted_net_inr: string | null;
};

const openStages = ['Qualified', 'Requirement Confirmed', 'Proposal', 'Negotiation'];
const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
function formatInr(value: string) {
  const [whole, fraction = ''] = value.split('.');
  return `${rupees.format(BigInt(whole))}.${fraction.padEnd(2, '0')}`;
}

function PipelineEditor({ db, organization, row, refresh }: {
  db: SupabaseClient<Database>; organization: string; row: Opportunity; refresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const operation = useRef<{ payload: string; key: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const stage = String(form.get('stage'));
    const amount = String(form.get('amount')).trim();
    const probability = String(form.get('probability')).trim();
    const reason = String(form.get('reason')).trim();
    if (Boolean(amount) !== Boolean(probability) || (amount && !/^[0-9]{1,16}([.][0-9]{1,2})?$/.test(amount))) {
      setError('Enter both a valid rupee amount and a probability, or leave both blank.');
      return;
    }
    const payload = JSON.stringify([row.row_version, stage, amount, probability, reason]);
    if (operation.current?.payload !== payload) operation.current = { payload, key: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      const { error: saveError } = await db.rpc('update_opportunity_pipeline', {
        p_org: organization, p_id: row.id, p_version: row.row_version, p_key: operation.current.key,
        p_stage: stage, p_amount: amount || null!, p_probability: probability ? Number(probability) : null!, p_reason: reason
      });
      if (saveError) {
        const messages: Record<string, string> = {
          '42501': 'You do not have permission to edit this opportunity.',
          PT404: 'This opportunity is no longer available.',
          PT409: 'The opportunity has changed. Refresh before editing again.',
          PT422: 'This opportunity is already closed.',
          '22023': 'Check the stage, estimate, probability and reason.'
        };
        setError(messages[saveError.code] ?? 'Could not confirm the save. Retry with the same entries.');
      } else refresh();
    } catch { setError('Could not confirm the save. Retry with the same entries.'); }
    finally { setBusy(false); }
  }
  if (!openStages.includes(row.stage)) return null;
  return <details><summary>Edit pipeline</summary>
    <form onSubmit={submit}>
      <label htmlFor={`stage-${row.id}`}>Stage</label>
      <select id={`stage-${row.id}`} name="stage" defaultValue={row.stage}>{openStages.map(stage => <option key={stage}>{stage}</option>)}</select>
      <label htmlFor={`amount-${row.id}`}>Manual net estimate (INR, excluding tax)</label>
      <input id={`amount-${row.id}`} name="amount" inputMode="decimal" maxLength={19} defaultValue={row.estimated_net_inr ?? ''} />
      <label htmlFor={`probability-${row.id}`}>Probability (%)</label>
      <input id={`probability-${row.id}`} name="probability" type="number" min={0} max={100} step={1} defaultValue={row.probability_percent ?? ''} />
      <label htmlFor={`reason-${row.id}`}>Reason for update</label>
      <textarea id={`reason-${row.id}`} name="reason" required maxLength={500}/>
      <button disabled={busy}>{busy ? 'Saving…' : 'Save pipeline update'}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {error.includes('Refresh before') && <button type="button" className="secondary" onClick={refresh}>Refresh opportunities</button>}
  </details>;
}

function OpportunityList({ db, organization }: { db: SupabaseClient<Database>; organization: string }) {
  const [rows, setRows] = useState<Opportunity[]>([]);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [status, setStatus] = useState<'loading'|'ready'|'error'>('loading');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    setStatus('loading');
    (async () => {
      const result = await db.from('opportunities').select('id,stage,requirement_text,row_version,estimated_net_inr::text,probability_percent,weighted_net_inr::text,accounts(name)')
        .eq('organization_id', organization).order('created_at', { ascending: false }).order('id').range(page * 25, page * 25 + 25);
      if (!current) return;
      if (result.error) { setStatus('error'); return; }
      setRows(result.data.slice(0, 25)); setMore(result.data.length > 25); setStatus('ready');
    })().catch(() => { if (current) setStatus('error'); });
    return () => { current = false; };
  }, [db, organization, page, reload]);
  return <section className="panel"><h2>Opportunities</h2>
    {status === 'loading' && <p role="status">Loading opportunities…</p>}
    {status === 'error' && <p role="alert">Unable to load opportunities. <button className="link" onClick={() => setReload(v => v + 1)}>Retry</button></p>}
    {status === 'ready' && (rows.length ? <ul className="records">{rows.map(row => <li key={row.id}>
      <strong>{row.accounts?.name ?? 'Customer unavailable'}</strong><p>{row.stage}</p><p className="requirement">{row.requirement_text}</p>
      {row.estimated_net_inr != null && <p>Manual net estimate {formatInr(row.estimated_net_inr)} · {row.probability_percent}% probability</p>}
      {row.weighted_net_inr != null && <p>Weighted pipeline {formatInr(row.weighted_net_inr)}</p>}
      <PipelineEditor key={row.row_version} db={db} organization={organization} row={row} refresh={() => setReload(v => v + 1)}/>
    </li>)}</ul> : <p>No opportunities are visible.</p>)}
    {status === 'ready' && (page > 0 || more) && <div>
      <button className="secondary" disabled={!page} onClick={() => setPage(v => v - 1)}>Previous</button>
      <button className="secondary" disabled={!more} onClick={() => setPage(v => v + 1)}>Next</button>
    </div>}
  </section>;
}
