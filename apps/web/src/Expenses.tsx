import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../../packages/domain/database.types';

type ExpenseClient = SupabaseClient<Database> & {
  rpc(name: 'read_expense_workspace', args: { p_org: string }): PromiseLike<{ data: Workspace | null; error: { message: string } | null }>;
  rpc(name: 'run_expense_command', args: { p_org: string; p_action: string; p_key: string; p_payload: Json }):
    PromiseLike<{ data: { id?: string; status?: string; rows?: ExportLine[] } | null; error: { message: string; code: string } | null }>;
};
type ExportLine = { claim: string; version: number; line_id: string; service_on: string; category: string; cost_center: string | null;
  line_reference: string | null; currency: string; claimed: number; allowed: number; status: string;
  employee: string | null; title: string; advance_applied: number; reimbursed: number; outstanding: number; payment_references: string };
type Line = {
  id?: string; purpose?: string; reference?: string; cost_center?: string;
  category: string; service_on: string; vendor: string; amount: string; mileage: string;
  days: string; geography: string; travel_type: string; receipt_id: string; exception_reason: string;
};
type Calculated = Line & { claimed: number; allowed: number; possible_duplicate: boolean; exception_requested: boolean };
type Draft = {
  title: string; starts: string; ends: string; estimated: string; requested_advance: string; geography: string;
  travel_type: string; purpose: string; retrospective_reason: string; travel_id: string; lines: Line[];
};
type ExpenseFile = { id: string; name: string; status: string; purpose: string };
type Movement = { id: string; kind: 'advance' | 'advance_issue' | 'advance_return' | 'reimbursement' | 'reversal'; amount: number; payment_date: string; reference: string; reverses_id: string | null };
type ExpenseRecord = {
  id: string; kind: 'travel' | 'claim'; status: string; revision: number; version: number;
  owner_id: string; owner_name: string; approver_id: string | null; manager_id: string | null; finance_id: string | null;
  routing_stage: string | null; draft: Partial<Draft>; claimed: number; allowed: number; paid: number; outstanding: number; unused_advance: number;
  versions: { version: number; route_policy_id: string; submitted_at: string; snapshot: { title: string; lines?: Calculated[] } }[];
  final_allowances: { id: string; amount: number }[];
  decisions: { action: string; at: string; version: number; reason: string | null }[];
  movements: Movement[]; files: ExpenseFile[];
};

type Grade = { id: string; name: string; grade: string | null };
type Workspace = { today: string; currency: string; records: ExpenseRecord[]; grade_directory: Grade[] | null };
type Command = (action: string, payload: Json) => Promise<boolean>;

const newDraft: Draft = { title: '', starts: '', ends: '', estimated: '', requested_advance: '', geography: '', travel_type: '', purpose: '',
  retrospective_reason: '', travel_id: '', lines: [] };
const blankLine: Line = { category: '', service_on: '', vendor: '', amount: '', mileage: '', days: '', geography: '', travel_type: '',
  receipt_id: '', exception_reason: '' };
const finishStates = ['Approved for Payment', 'Partly Reimbursed', 'Reimbursed'];
const editableStates = ['Draft', 'Returned'];
const decimal = '(0|[1-9][0-9]{0,13})([.][0-9]{1,2})?';
const distance = '(0|[1-9][0-9]{0,8})([.][0-9]{1,3})?';
const code = '[A-Za-z][A-Za-z0-9_\\-]{0,30}';

export function Expenses({ db, organization, membership }: { db: SupabaseClient<Database>; organization: string; membership: string }) {
  const rpc = db as ExpenseClient;
  const [workspace, setWorkspace] = useState<Workspace>();
  const [tab, setTab] = useState<'claim' | 'travel' | 'review'>('claim');
  const [active, setActive] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [reload, refresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  const pending = useRef(false);

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const response = await rpc.rpc('read_expense_workspace', { p_org: organization });
        if (!current) return;
        if (response.error || !response.data) {
          setFailure('Travel and expenses are unavailable. Try refreshing.');
          return;
        }
        setWorkspace(response.data);
      } catch {
        if (current) setFailure('Travel and expenses are unavailable. Try refreshing.');
      }
    })();
    return () => { current = false; };
  }, [organization, rpc, reload]);

  async function command(action: string, data: Json) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setFailure('');
    setMessage('');
    const fingerprint = JSON.stringify([organization, action, data]);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const result = await rpc.rpc('run_expense_command', { p_org: organization, p_action: action, p_key: request.current.key, p_payload: data });
      if (result.error) {
        const friendly = ['22023', '40001', '42501'].includes(result.error.code);
        setFailure(friendly ? result.error.message : result.error.code === '23505' ? 'That payment reference or request key is already in use.' :
          'The change could not be confirmed. Try again or refresh.');
        if (result.error.code === '40001') refresh(value => value + 1);
        return false;
      }
      request.current = null;
      if (result.data?.id) setActive(result.data.id);
      setCreating(false);
      setMessage(result.data?.status ? `Saved · ${result.data.status}` : 'Saved');
      refresh(value => value + 1);
      return true;
    } catch {
      setFailure('The change could not be confirmed. Try again or refresh.');
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const records = workspace?.records.filter(record => tab === 'review' ? record.owner_id !== membership : record.kind === tab && record.owner_id === membership) ?? [];
  const selection = records.find(item => item.id === active);
  const trips = workspace?.records.filter(item => item.kind === 'travel' && item.owner_id === membership && ['Approved', 'Closed'].includes(item.status)) ?? [];
  const money = (amount: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: workspace?.currency ?? 'INR' }).format(amount);

  function openTab(value: typeof tab) {
    setTab(value);
    setActive(undefined);
    setCreating(false);
    setFailure('');
    setMessage('');
  }

  async function exportCsv() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailure('');
    try {
      const response = await rpc.rpc('run_expense_command', {
        p_org: organization, p_action: 'export_csv', p_key: crypto.randomUUID(), p_payload: {},
      });
      if (response.error || !response.data?.rows) throw new Error();
      const rows = [['Claim ID', 'Version', 'Line ID', 'Employee', 'Claim', 'Status', 'Service date', 'Category',
        'Cost center', 'Line reference', 'Currency', 'Line claimed', 'Line allowed', 'Claim advances',
        'Claim reimbursed', 'Claim outstanding', 'Payment references']];
      const first = new Set<string>();
      for (const line of response.data.rows) {
        const printClaimTotals = !first.has(line.claim);
        rows.push([line.claim, String(line.version), line.line_id, line.employee ?? '', line.title, line.status, line.service_on,
          line.category, line.cost_center ?? '', line.line_reference ?? '', line.currency, line.claimed.toFixed(2), line.allowed.toFixed(2),
          printClaimTotals ? line.advance_applied.toFixed(2) : '', printClaimTotals ? line.reimbursed.toFixed(2) : '',
          printClaimTotals ? line.outstanding.toFixed(2) : '', printClaimTotals ? line.payment_references : '']);
        first.add(line.claim);
      }
      const csv = rows.map(row => row.map(value => '"' + (/^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/.test(value) ? "'" : '') +
        value.replaceAll('"', '""') + '"').join(',')).join('\r\n');
      download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `expense-reconciliation-${workspace?.today}.csv`);
    } catch {
      setFailure('The finance export could not be created.');
    } finally {
      setBusy(false);
      pending.current = false;
    }
  }

  return <section className="panel" aria-labelledby="expense-name">
    <div className="panel-heading">
      <h1 id="expense-name">Travel & expenses</h1>
      {tab !== 'review' && <button disabled={busy || !workspace} onClick={() => { setCreating(true); setActive(undefined); }}>
        {tab === 'travel' ? 'New travel request' : 'New claim'}
      </button>}
    </div>
    <div className="settings-tabs" aria-label="Travel and expense views">
      <button className="secondary" aria-pressed={tab === 'claim'} onClick={() => openTab('claim')}>My claims</button>
      <button className="secondary" aria-pressed={tab === 'travel'} onClick={() => openTab('travel')}>My travel</button>
      <button className="secondary" aria-pressed={tab === 'review'} onClick={() => openTab('review')}>Assigned reviews</button>
    </div>
    {failure && <p role="alert">{failure} <button className="link" onClick={() => { setFailure(''); refresh(value => value + 1); }}>Refresh</button></p>}
    {message && <p role="status">{message}</p>}
    {!workspace && !failure && <p role="status">Loading travel and expenses…</p>}
    {workspace && tab === 'review' && records.some(record => record.finance_id === membership && record.kind === 'claim') &&
      <button className="secondary" disabled={busy} onClick={() => void exportCsv()}>Export approved claims as CSV</button>}
    {workspace && !records.length && !creating && <p>{tab === 'review' ? 'No assigned reviews.' : 'No records in this view.'}</p>}
    {!!records.length && <ul className="records">
      {records.map(record => <li key={record.id}>
        <button className="link" aria-pressed={selection?.id === record.id} onClick={() => {
          setActive(record.id); setCreating(false); setFailure(''); setMessage('');
        }}>{record.draft.title}</button>
        <span> · {record.status}{tab === 'review' ? ' · ' + record.owner_name : ''}</span>
      </li>)}
    </ul>}
    {workspace?.grade_directory && <ExpenseGradeEditor staff={workspace.grade_directory} busy={busy} save={command} />}
    {creating && tab !== 'review' && <DraftForm kind={tab} key={tab} trips={trips} files={[]} busy={busy}
      save={data => command(tab === 'travel' ? 'create_travel' : 'create_claim', data)} />}
    {selection && workspace && <ExpenseDetails key={`${selection.id}:${selection.revision}`} record={selection} member={membership}
      trips={trips} today={workspace.today} busy={busy} command={command} money={money} db={db} organization={organization}
      refresh={() => refresh(value => value + 1)} />}
  </section>;
}

function ExpenseGradeEditor({ staff, busy, save }: { staff: Grade[]; busy: boolean; save: Command }) {
  const [member, setMember] = useState('');
  const [grade, setGrade] = useState('');
  return <details>
    <summary>Employee expense grades</summary>
    <form onSubmit={event => { event.preventDefault(); void save('set_grade', { membership: member, grade }); }}>
      <label>Employee<select value={member} required onChange={event => {
        setMember(event.target.value); setGrade(staff.find(person => person.id === event.target.value)?.grade ?? '');
      }}>
        <option value="">Select an employee</option>
        {staff.map(person => <option value={person.id} key={person.id}>{person.name}</option>)}
      </select></label>
      <label>Policy grade code<input pattern={code} value={grade} onChange={event => setGrade(event.target.value)} /></label>
      <p>Leave blank to remove the grade assignment.</p>
      <button disabled={busy}>Save grade</button>
    </form>
  </details>;
}

function DraftForm({ kind, initial, trips, files, busy, save, amendment = false }: {
  kind: ExpenseRecord['kind']; initial?: Partial<Draft>; trips: ExpenseRecord[]; files: ExpenseFile[];
  busy: boolean; save: (data: Draft & { reason?: string }) => Promise<boolean>; amendment?: boolean;
}) {
  const [draft, setDraft] = useState<Draft>({ ...newDraft, ...initial });
  const [reason, setReason] = useState('');
  function set(key: Exclude<keyof Draft, 'lines'>, value: string) {
    setDraft(previous => ({ ...previous, [key]: value }));
  }
  function changeLine(index: number, key: keyof Line, value: string) {
    setDraft(previous => ({ ...previous, lines: previous.lines.map((line, i) => i === index ? { ...line, [key]: value } : line) }));
  }
  return <form onSubmit={(event) => { event.preventDefault(); void save(amendment ? { ...draft, reason } : draft); }}>
    {amendment && <label>Reason for changing approved travel<textarea value={reason} required maxLength={500}
      onChange={event => setReason(event.target.value)} /></label>}
    <label>Title<input value={draft.title} onChange={event => set('title', event.target.value)} required maxLength={120} /></label>
    {kind === 'travel' ? <>
      <label>Start date<input type="date" value={draft.starts} onChange={event => set('starts', event.target.value)} required /></label>
      <label>End date<input type="date" value={draft.ends} min={draft.starts} onChange={event => set('ends', event.target.value)} required /></label>
      <label>Geography code<input value={draft.geography} onChange={event => set('geography', event.target.value)} required pattern={code} /></label>
      <label>Travel type code<input value={draft.travel_type} onChange={event => set('travel_type', event.target.value)} required pattern={code} /></label>
      <label>Estimated amount<input inputMode="decimal" pattern={decimal} value={draft.estimated} onChange={event => set('estimated', event.target.value)} required /></label>
      <label>Requested advance<input inputMode="decimal" pattern={decimal} value={draft.requested_advance}
        onChange={event => set('requested_advance', event.target.value)} /></label>
      <label>Business purpose<textarea value={draft.purpose} onChange={event => set('purpose', event.target.value)} required maxLength={500} /></label>
      <label>Emergency reason for retrospective travel<textarea value={draft.retrospective_reason ?? ''} onChange={event => set('retrospective_reason', event.target.value)} maxLength={500} /></label>
    </> : <>
      <label>Approved travel<select value={draft.travel_id ?? ''} onChange={event => set('travel_id', event.target.value)}>
        <option value="">No linked travel</option>
        {trips.map(trip => <option value={trip.id} key={trip.id}>{trip.draft.title}</option>)}
      </select></label>
      <div>
        {draft.lines.map((line, index) => <fieldset key={index}>
          <legend>Expense line {index + 1}</legend>
          <label>Category code<input value={line.category ?? ''} onChange={event => changeLine(index, 'category', event.target.value)} required pattern={code} /></label>
          <label>Service date<input type="date" value={line.service_on ?? ''} onChange={event => changeLine(index, 'service_on', event.target.value)} required /></label>
          <label>Vendor<input value={line.vendor ?? ''} onChange={event => changeLine(index, 'vendor', event.target.value)} maxLength={120} /></label>
          <label>Purpose<input value={line.purpose ?? ''} onChange={event => changeLine(index, 'purpose', event.target.value)} maxLength={300} /></label>
          <label>Reference<input value={line.reference ?? ''} onChange={event => changeLine(index, 'reference', event.target.value)} maxLength={120} /></label>
          <label>Cost center<input value={line.cost_center ?? ''} onChange={event => changeLine(index, 'cost_center', event.target.value)} maxLength={60} /></label>
          <label>Geography code<input value={line.geography ?? ''} onChange={event => changeLine(index, 'geography', event.target.value)} required pattern={code} /></label>
          <label>Travel type code<input value={line.travel_type ?? ''} onChange={event => changeLine(index, 'travel_type', event.target.value)} required pattern={code} /></label>
          <label>Actual amount<input inputMode="decimal" pattern={decimal} value={line.amount ?? ''} onChange={event => changeLine(index, 'amount', event.target.value)} /></label>
          <label>Kilometres for mileage<input inputMode="decimal" pattern={distance} value={line.mileage ?? ''} onChange={event => changeLine(index, 'mileage', event.target.value)} /></label>
          <label>Day fraction for allowance<select value={line.days ?? ''} onChange={event => changeLine(index, 'days', event.target.value)}>
            <option value="">Select if applicable</option><option value="0.5">Half day</option><option value="1">Full day</option>
          </select></label>
          <label>Scanned receipt<select value={line.receipt_id ?? ''} onChange={event => changeLine(index, 'receipt_id', event.target.value)}>
            <option value="">Select after uploading</option>
            {files.filter(file => file.purpose === 'receipt' && file.status === 'Available').map(file => <option value={file.id} key={file.id}>{file.name}</option>)}
          </select></label>
          <label>Receipt exception reason<textarea value={line.exception_reason ?? ''} onChange={event => changeLine(index, 'exception_reason', event.target.value)} maxLength={500} /></label>
          <button type="button" className="secondary" disabled={busy} onClick={() => setDraft(previous => ({ ...previous,
            lines: previous.lines.filter((_, i) => i !== index) }))}>Remove line {index + 1}</button>
        </fieldset>)}
      </div>
      <button type="button" className="secondary" disabled={busy || draft.lines.length >= 100} onClick={() => setDraft(previous => ({
        ...previous, lines: [...previous.lines, { ...blankLine,
          geography: trips.find(trip => trip.id === draft.travel_id)?.draft.geography ?? '',
          travel_type: trips.find(trip => trip.id === draft.travel_id)?.draft.travel_type ?? '' }] }))}>Add expense line</button>
    </>}
    <button disabled={busy}>Save draft</button>
  </form>;
}

function ExpenseDetails({ record, member, trips, today, busy, command, money, db, organization, refresh }: {
  record: ExpenseRecord; member: string; trips: ExpenseRecord[]; today: string; busy: boolean;
  command: Command; money: (amount: number) => string; db: SupabaseClient<Database>; organization: string; refresh: () => void;
}) {
  const owner = record.owner_id === member;
  const isClaim = record.kind === 'claim';
  const assigned = record.approver_id === member && member !== record.owner_id;
  const finance = record.finance_id === member && member !== record.manager_id && !owner;
  const editable = owner && (editableStates.includes(record.status) || record.status === 'Pending Routing' && record.routing_stage !== 'finance');
  const [editing, setEditing] = useState(false);
  const revisedTravel = owner && record.kind === 'travel' && record.status === 'Approved';
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const lines = record.versions[0]?.snapshot.lines ?? [];
  const [allowances, setAllowances] = useState(lines.map(line => String(line.allowed)));
  const exception = lines.some(line => line.exception_requested);
  const final = isClaim && finishStates.includes(record.status);
  const canReview = assigned && ['Submitted', 'Manager Approved', 'Finance Review'].includes(record.status);
  const canCancel = owner && ['Draft', 'Returned', 'Submitted', 'Pending Routing', 'Approved'].includes(record.status);
  const canPay = finance && final;
  const canPostTripAdvance = finance && !isClaim && ['Approved', 'Closed'].includes(record.status) &&
    (record.unused_advance > 0 || record.status === 'Approved' && Number(record.draft.requested_advance) > 0);
  const reversed = new Set(record.movements.map(item => item.reverses_id));
  const applied = record.movements.filter(item => item.kind === 'advance' && !reversed.has(item.id))
    .reduce((total, item) => total + item.amount, 0);
  const totals = [['Claimed', record.claimed], [record.final_allowances.length ? 'Finance approved' : 'Policy allowance', record.allowed],
    ['Disallowed', record.claimed - record.allowed], ['Applied advances', applied],
    ['Net payable', record.allowed - applied], ['Reimbursed', record.paid - applied],
    ['Outstanding', record.outstanding]] as const;

  function run(action: string, extra: { [key: string]: Json } = {}) {
    return command(action, { record: record.id, revision: record.revision, ...extra });
  }

  return <article aria-label={record.draft.title}>
    <h2>{record.draft.title}</h2>
    <p>{record.status}{!owner && ' · ' + record.owner_name}</p>
    {!isClaim && <div>
      <p>{record.draft.starts} to {record.draft.ends} · {money(Number(record.draft.estimated))} estimated</p>
      <p>{record.draft.geography} · {record.draft.travel_type}</p>
      {Number(record.draft.requested_advance) > 0 && <p>{money(Number(record.draft.requested_advance))} requested advance · {money(record.unused_advance)} unused</p>}
      <p>{record.draft.purpose}</p>
      {record.draft.retrospective_reason && <p>Retrospective travel reason {record.draft.retrospective_reason}</p>}
    </div>}
    {isClaim && record.version > 0 && <dl>
      {totals.slice(0, record.final_allowances.length ? undefined : 3).map(([name, amount]) =>
        <div key={name}><dt>{name}</dt><dd>{money(amount)}</dd></div>)}
    </dl>}
    {owner && record.status === 'Pending Routing' && <p>An independent reviewer is needed. Retry routing after the administrator updates the approval settings.</p>}
    {!!lines.length && <table>
      <caption>Submitted expense lines</caption>
      <thead><tr><th scope="col">Category</th><th scope="col">Service date</th><th scope="col">Claimed</th>
        <th scope="col">Policy allowance</th>{!!record.final_allowances.length && <th scope="col">Finance allowance</th>}
        <th scope="col">Review notes</th></tr></thead>
      <tbody>{lines.map((line, index) => <tr key={index}>
        <td>{line.category}{line.vendor && ' · ' + line.vendor}</td><td>{line.service_on}</td>
        <td>{money(line.claimed)}</td><td>{money(line.allowed)}</td>
        {!!record.final_allowances.length && <td>{money(record.final_allowances.find(decision => decision.id === line.id)?.amount ?? 0)}</td>}<td>
          {line.possible_duplicate && <div>Possible duplicate</div>}
          {line.exception_requested && <div>Receipt exception requested · {line.exception_reason}</div>}
        </td>
      </tr>)}</tbody>
    </table>}
    {record.versions.length > 0 && <details>
      <summary>Submitted versions ({record.versions.length})</summary>
      <ul className="records">{record.versions.map(version => <li key={version.version}>
        <strong>Version {version.version} · {new Date(version.submitted_at).toLocaleDateString()}</strong>
        <div>{version.snapshot.title}</div>
        {version.snapshot.lines?.map((line, index) => <div key={index}>
          {line.category} · {line.service_on} · {money(line.claimed)} claimed · {money(line.allowed)} allowed
        </div>)}
      </li>)}</ul>
    </details>}
    {!!record.decisions.length && <details>
      <summary>Decision history</summary>
      <ul className="records">{record.decisions.map((decision, index) => <li key={index}>
        {decision.action.replace('expense.', '').replaceAll('_', ' ')} · Version {decision.version} · {new Date(decision.at).toLocaleString()}
        {decision.reason && <div>{decision.reason}</div>}
      </li>)}</ul>
    </details>}
    <ExpenseFiles db={db} organization={organization} record={record} upload={owner && editableStates.includes(record.status) || canPay || canPostTripAdvance}
      purpose={isClaim && owner ? 'receipt' : 'business_document'} refresh={refresh} />
    {(editable || revisedTravel) && <>
      <button className="secondary" disabled={busy} onClick={() => setEditing(value => !value)}>
        {editing ? 'Hide draft form' : revisedTravel ? 'Revise approved travel' : 'Edit draft'}
      </button>
      {editing && <DraftForm initial={record.draft} kind={record.kind} trips={trips} files={record.files} busy={busy}
        amendment={revisedTravel} save={data => run(revisedTravel ? 'revise_travel' : 'edit', data)} />}
    </>}
    {owner && editableStates.includes(record.status) && <button disabled={busy || editing} onClick={() => void run('submit')}>
      {isClaim ? 'Submit claim' : 'Submit travel request'}
    </button>}
    {owner && (['Pending Routing','Submitted','Manager Approved','Finance Review'].includes(record.status)
      || !isClaim && record.status === 'Approved' && !record.finance_id && Number(record.draft.requested_advance) > 0) && <button className="secondary"
      disabled={busy} onClick={() => void run('reroute')}>Retry approval routing</button>}
    {owner && record.kind === 'travel' && record.status === 'Approved' && (record.draft.ends ?? '') <= today && <button
      disabled={busy} onClick={() => void run('close')}>Close travel request</button>}
    {(canReview || canCancel) && <label>Reason for returning, rejecting, cancelling or reducing a claim
      <textarea value={reason} maxLength={500} onChange={event => setReason(event.target.value)} />
    </label>}
    {canCancel && <button className="secondary" disabled={busy || !reason.trim()} onClick={() => void run('cancel', { reason })}>Cancel request</button>}
    {canReview && <>
      <button className="secondary" disabled={busy || !reason.trim()} onClick={() => void run('return', { reason })}>Return for changes</button>
      <button className="secondary" disabled={busy || !reason.trim()} onClick={() => void run('reject', { reason })}>Reject</button>
    </>}
    {assigned && record.status === 'Submitted' && <>
      {exception && <label><input type="checkbox" checked={confirm} onChange={event => setConfirm(event.target.checked)} />Approve the stated receipt exceptions</label>}
      <button disabled={busy || exception && !confirm} onClick={() => void run('approve', { confirm_exceptions: confirm })}>
        {isClaim ? 'Approve for finance review' : 'Approve travel'}
      </button>
    </>}
    {finance && record.status === 'Manager Approved' && <button disabled={busy} onClick={() => void run('start_finance')}>Begin finance review</button>}
    {finance && record.status === 'Finance Review' && <form onSubmit={event => {
      event.preventDefault(); void run('finance_approve', { allowances, reason });
    }}>
      {lines.map((line, index) => <label key={index}>Line {index + 1} · {line.category} allowance
        <input required inputMode="decimal" pattern={decimal} value={allowances[index]} onChange={event =>
          setAllowances(previous => previous.map((value, i) => i === index ? event.target.value : value))} />
      </label>)}
      <button disabled={busy}>Approve final amounts</button>
    </form>}
    {!!record.movements.length && <table>
      <caption>Manual payment ledger</caption>
      <thead><tr><th scope="col">Date</th><th scope="col">Movement</th><th scope="col">Reference</th><th scope="col">Amount</th></tr></thead>
      <tbody>{record.movements.map(movement => <tr key={movement.id}>
        <td>{movement.payment_date}</td><td>{movement.kind}</td><td>{movement.reference}</td>
        <td>{movement.kind === 'reversal' ? '−' : ''}{money(movement.amount)}</td>
      </tr>)}</tbody>
    </table>}
    {(canPay || canPostTripAdvance) && <PaymentForm record={record} today={today} busy={busy} pay={run} />}
  </article>;
}

function PaymentForm({ record, today, busy, pay }: {
  record: ExpenseRecord; today: string; busy: boolean;
  pay: (action: string, data: { [key: string]: Json }) => Promise<boolean>;
}) {
  const reversalIds = new Set(record.movements.map(item => item.reverses_id));
  const reversible = record.movements.filter(item => item.kind !== 'reversal' && !reversalIds.has(item.id));
  const proofs = record.files.filter(file => file.status === 'Available' && file.purpose === 'business_document');
  const travel = record.kind === 'travel';
  const [action, setAction] = useState(travel ? (record.status === 'Approved' ? 'issue_advance' : 'return_advance') :
    (record.outstanding > 0 ? 'reimburse' : 'reverse'));
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    void pay(action, { ...fields } as { [key: string]: string });
  }
  return <form onSubmit={submit}>
    <h3>{travel ? 'Manage travel advance' : 'Record a manual payment'}</h3>
    {!proofs.length && <p>Upload and scan payment evidence before posting a movement.</p>}
    <label>Action<select value={action} onChange={event => setAction(event.target.value)}>
      {travel && record.status === 'Approved' && <option value="issue_advance">Record issued advance</option>}
      {travel && record.unused_advance > 0 && <option value="return_advance">Record returned advance balance</option>}
      {!travel && record.outstanding > 0 && <option value="reimburse">Reimbursement</option>}
      {!travel && record.outstanding > 0 && record.unused_advance > 0 && <option value="advance">Apply available travel advance</option>}
      {!travel && !!reversible.length && <option value="reverse">Reverse a payment</option>}
    </select></label>
    {action === 'reverse' ? <>
      <label>Original movement<select name="movement" required>
        <option value="">Select a payment</option>
        {reversible.map(item => <option value={item.id} key={item.id}>{item.reference} · {item.payment_date}</option>)}
      </select></label>
      <label>Reversal reason<textarea name="reason" maxLength={500} required /></label>
    </> : <label>Amount<input name="amount" required pattern={decimal} inputMode="decimal" /></label>}
    <label>Payment date<input type="date" name="payment_date" defaultValue={today} max={today} required /></label>
    <label>Payment reference<input name="reference" required maxLength={120} /></label>
    <label>Scanned payment evidence<select name="evidence" required>
      <option value="">Select an attachment</option>
      {proofs.map(file => <option value={file.id} key={file.id}>{file.name}</option>)}
    </select></label>
    <button disabled={busy || !proofs.length}>Post movement</button>
  </form>;
}

function download(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function ExpenseFiles({ db, organization, record, upload, purpose, refresh }: {
  db: SupabaseClient<Database>; organization: string; record: ExpenseRecord; upload: boolean;
  purpose: 'receipt' | 'business_document'; refresh: () => void;
}) {
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState<ExpenseFile>();
  const reservation = useRef<{ file: File; key: string } | null>(null);
  const supported = ['application/pdf', 'image/png', 'image/jpeg'];
  const limit = purpose === 'receipt' ? 10 : 25;

  async function requestFile(stage: string, method: 'GET' | 'POST', file?: File) {
    const { data } = await db.auth.getSession();
    if (!data.session) throw new Error('Sign in again before accessing attachments.');
    const endpoint = new URL('/functions/v1/private-files', import.meta.env.VITE_SUPABASE_URL);
    endpoint.searchParams.set('stage', stage);
    const response = await fetch(endpoint, { method, credentials: 'omit', headers: {
      authorization: 'Bearer ' + data.session.access_token, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      ...(file ? { 'content-type': file.type } : {}),
    }, body: file });
    if (!response.ok) throw new Error(response.status === 409 ? 'Select the original file for this attachment.' :
      'The file service is unavailable or this attachment is outside your access.');
    return response;
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const file = (form.elements.namedItem('attachment') as HTMLInputElement).files?.[0];
    setMessage('');
    setError('');
    if (!file || !supported.includes(file.type) || !file.size || file.size > limit * 1024 * 1024) {
      setError(`Choose a PDF, JPEG or PNG up to ${limit} MB.`);
      return;
    }
    setBusy(true);
    try {
      let stage = retry?.id;
      if (!stage) {
        if (reservation.current?.file !== file) reservation.current = { file, key: crypto.randomUUID() };
        const reservationResult = await db.rpc('reserve_file_stage', {
          p_org: organization, p_parent: record.id, p_key: reservation.current.key,
          p_name: file.name, p_purpose: purpose, p_mime: file.type, p_size: file.size,
        });
        if (reservationResult.error || !reservationResult.data) throw new Error('Unable to reserve the attachment.');
        stage = reservationResult.data;
      }
      const response = await requestFile(stage, 'POST', file);
      const { status } = await response.json();
      setMessage(status === 'available' ? 'Attachment available.' : status === 'rejected' ? 'The scanner rejected this attachment.' :
        'Attachment saved and awaiting scan.');
      setRetry(undefined);
      reservation.current = null;
      form.reset();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The upload could not be confirmed.');
    } finally {
      refresh();
      setBusy(false);
    }
  }

  async function open(file: ExpenseFile) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await requestFile(file.id, 'GET');
      download(await response.blob(), file.name);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to download this attachment.');
    } finally {
      setBusy(false);
    }
  }

  return <details>
    <summary>Private attachments ({record.files.length})</summary>
    {!!record.files.length && <ul className="records">{record.files.map(file => <li key={file.id}>
      {file.name} · {file.status}
      {file.status === 'Available' && <button disabled={busy} className="secondary" onClick={() => void open(file)}>Download</button>}
      {upload && ['Pending upload','Awaiting scan'].includes(file.status) &&
        <button disabled={busy} className="secondary" onClick={() => setRetry(file)}>Retry upload</button>}
    </li>)}</ul>}
    {upload && <form onSubmit={event => { void add(event); }}>
      <label>{retry ? 'Select original ' + retry.name : purpose === 'receipt' ? 'Add scanned receipt' : 'Add supporting evidence'}
        <input type="file" name="attachment" accept={supported.join(',')} required disabled={busy} /></label>
      <button disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</button>
      {retry && <button type="button" className="secondary" disabled={busy} onClick={() => setRetry(undefined)}>Cancel retry</button>}
    </form>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
