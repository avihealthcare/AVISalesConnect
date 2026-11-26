import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../../packages/domain/database.types';

type TenderRecord = {
  id: string; authority: string; portal: string; reference: string; portal_url: string | null;
  lifecycle: string; bid_decision: string; deadline: string; source_timezone: string;
  geography: string | null; procurement_sites: string | null; estimate: string | null; fees: string | null;
  owner_name: string; currency: string; version: number; required_items: number; reviewed_items: number;
};
type TenderLot = { id: string; lot_number: string; description: string; offered_model: string | null;
  offered_quantity: string | null; evaluation: string; observed_rank: number | null };
type ChecklistItem = { id: string; title: string; lot_id: string | null; kind: string; mandatory: boolean;
  nonwaivable: boolean; evidence_id: string | null; reviewed_by: string | null; deviation: string | null;
  valid_until: string | null; waiver_policy: string | null };
type TenderEvent = { id: string; kind: string; actor_name: string; recorded_at: string; payload: Record<string, Json> };
type TenderFile = { id: string; name: string; status: string };
type TenderSecurity = { id: string; kind: string; lot_id: string | null; instrument: string; amount: string;
  issuer: string; reference: string; issued_on: string | null; expires_on: string | null; state: string;
  next_follow_up: string | null; expired: boolean; follow_up_due: boolean; exemption_evidence: string | null };
type TenderExecution = { id: string; lot_id: string; kind: string; quantity: string; happened_at: string; reference: string };
type TenderInvoice = { id: string; lot_id: string; reference: string; due_on: string; amount: string; paid: string; outstanding: string;
  next_follow_up: string | null; overdue: boolean };
type PrebidQuery = { id: string; issue: string; change_requested: string; responsible_person: string;
  submitted_at: string | null; submission_reference: string | null; reply_at: string | null; reply: string | null };
type TenderIndex = { can_register: boolean; records: TenderRecord[]; owners: { id: string; name: string }[] };
type TenderDetail = {
  record: TenderRecord; can_edit: boolean; can_review: boolean; can_waive: boolean; can_submit: boolean;
  lots: TenderLot[]; checklist: ChecklistItem[]; events: TenderEvent[]; files: TenderFile[];
  tracking: { securities: TenderSecurity[]; execution: TenderExecution[]; invoices: TenderInvoice[]; prebid: PrebidQuery[] };
  readiness: { reason: string }[]; reminders: { days_before: number; due_at: string }[];
};
type TenderCommand = 'register' | 'add_lot' | 'offer_lot' | 'add_checklist' | 'attach_checklist' |
  'review_checklist' | 'waive_checklist' | 'bid_decision' | 'corrigendum' | 'milestone' |
  'record_submission' | 'submission_addendum' | 'evaluate_lot' | 'award_lot' | 'cancel' | 'close' | 'reopen' |
  'security_add' | 'security_step' | 'security_extend' | 'execution_entry' | 'invoice_add' | 'invoice_follow_up' |
  'prebid_add' | 'prebid_submit' | 'prebid_reply' | 'observe_competitor';
type Payload = Record<string, Json>;
type Command = (action: TenderCommand, payload: Payload, request: string) => Promise<void>;
type Option = [string, string];
type Field = {
  name: string; label: string; required?: boolean; type?: 'text' | 'date' | 'datetime-local' | 'checkbox' | 'textarea' | 'url';
  choices?: Option[]; initial?: string; max?: number; help?: string;
};
type TenderProps = { db: SupabaseClient<Database>; organization: string; membership: string };

type TenderRpcClient = {
  rpc(name: 'tender_workspace', args: { p_organization_id: string; p_tender_id?: string }):
    PromiseLike<{ data: TenderIndex | TenderDetail | null; error: { message: string } | null }>;
  rpc(name: 'execute_tender_command', args: {
    p_organization_id: string; p_tender_id?: string; p_expected_version?: number;
    p_action: TenderCommand; p_payload: Payload; p_request_key: string;
  }): PromiseLike<{ data: { id: string; version: number } | null; error: { message: string; code: string } | null }>;
};

const stages = ['Identified', 'Preparing', 'Submitted', 'Under Evaluation', 'Closed', 'Cancelled'];
const zones = ['Asia/Kolkata', 'UTC', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York'];
const labels: Record<string, string> = {
  register: 'Registered', add_lot: 'Lot added', offer_lot: 'Lot offering revised', add_checklist: 'Requirement added',
  attach_checklist: 'Evidence attached', review_checklist: 'Evidence reviewed', waive_checklist: 'Waiver approved',
  bid_decision: 'Bid decision', corrigendum: 'Deadline revised', milestone: 'Milestone recorded', record_submission: 'Submission recorded',
  submission_addendum: 'Submission addendum', evaluate_lot: 'Lot evaluated', award_lot: 'Award recorded',
  cancel: 'Cancelled', close: 'Closed', reopen: 'Reopened',
  security_add: 'Security entered', security_step: 'Security status recorded', security_extend: 'PBG expiry extended',
  execution_entry: 'Award execution recorded', invoice_add: 'Invoice entered', invoice_follow_up: 'Collection follow-up recorded',
  prebid_add: 'Pre-bid query created', prebid_submit: 'Query submission recorded', prebid_reply: 'Authority reply recorded',
  observe_competitor: 'Competitor observation recorded',
};
const options = (values: string[]): Option[] => values.map(value => [value, value]);
const field = (name: string, label: string, extra: Partial<Field> = {}): Field => ({ name, label, required: true, max: 250, ...extra });
const reason = (label = 'Reason', required = true): Field => field('reason', label, { type: 'textarea', required, max: 1000 });
const zone = (initial = 'Asia/Kolkata'): Field => field('timezone', 'Deadline timezone', { choices: options([...new Set([initial, ...zones])]), initial });

function formatTime(instant: string, timeZone = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium', timeStyle: 'short', timeZone,
  }).format(new Date(instant));
}

function localParts(epoch: number, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone,
  }).formatToParts(epoch).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function zonedTime(input: string, timeZone: string) {
  const target = Date.parse(input + 'Z');
  const candidateOffsets = new Set<number>();
  for (const halfDay of [-43200000, 0, 43200000]) {
    const sample = target + halfDay;
    candidateOffsets.add(Date.parse(localParts(sample, timeZone) + 'Z') - sample);
  }
  const matches = [...candidateOffsets].filter(offset => localParts(target - offset, timeZone) === input);
  if (matches.length !== 1) throw new Error('This local time is ambiguous or unavailable. Choose a different local time.');
  const minutes = Math.abs(matches[0]) / 60000;
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
  const remainder = String(minutes % 60).padStart(2, '0');
  return input + (matches[0] < 0 ? '-' : '+') + hours + ':' + remainder;
}

function displayDeadline(record: TenderRecord) {
  return `${formatTime(record.deadline, record.source_timezone)} (${record.source_timezone})`;
}

export function Tenders(props: TenderProps) {
  return <TenderWorkspace key={props.organization + ':' + props.membership} {...props} />;
}

function TenderWorkspace({ db, organization }: TenderProps) {
  const client = db as unknown as TenderRpcClient;
  const [index, setIndex] = useState<TenderIndex>();
  const [detail, setDetail] = useState<TenderDetail>();
  const [selected, select] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('Overview');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, refresh] = useState(0);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    void client.rpc('tender_workspace', { p_organization_id: organization, p_tender_id: selected }).then(result => {
      if (!current) return;
      if (result.error || !result.data) setError('This tender workspace is unavailable or access has changed.');
      else if ('record' in result.data) setDetail(result.data);
      else setIndex(result.data);
      setLoading(false);
    });
    return () => { current = false; };
  }, [client, organization, selected, revision]);

  const command: Command = async (action, payload, request) => {
    const result = await client.rpc('execute_tender_command', {
      p_organization_id: organization, p_action: action, p_payload: payload, p_request_key: request,
      p_tender_id: selected, p_expected_version: selected ? detail?.record.version : undefined,
    });
    if (result.error || !result.data) {
      throw new Error(result.error?.code === '23505' ? 'A record with the same portal reference or lot number is already present.'
        : result.error?.code === '23503' || result.error?.code === '23514' ? 'Check the required fields and the allowed values.'
          : result.error?.message ?? 'Tender action could not be confirmed.');
    }
    setNotice(labels[action] + '.');
    if (action === 'register') {
      select(result.data.id);
      setTab('Overview');
      setCreating(false);
    }
    refresh(value => value + 1);
  };

  function open(id?: string) {
    select(id);
    setDetail(undefined);
    setCreating(false);
    setNotice('');
    setTab('Overview');
  }

  const records = index?.records.filter(record => (!status || record.lifecycle === status) &&
    [record.authority, record.reference, record.portal, record.owner_name, record.geography].some(
      value => value?.toLowerCase().includes(query.trim().toLowerCase()))) ?? [];
  const currencyFormat = (record: TenderRecord) => record.estimate ? `${record.currency} ${record.estimate}` : 'Unknown';
  const active = detail?.record.id === selected ? detail : undefined;

  return <section className="panel" aria-labelledby="tender-heading">
    <h1 id="tender-heading">{active ? active.record.reference : 'Tenders'}</h1>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error} <button type="button" className="link" onClick={() => refresh(value => value + 1)}>Retry</button></p>}
    {loading && <p role="status">Loading tenders…</p>}
    {selected && <button type="button" className="secondary" onClick={() => open()}>Back to tender register</button>}
    {!selected && index && !error && <>
      {!creating && index.can_register && <button type="button" onClick={() => setCreating(true)}>Register tender</button>}
      {creating && <>
        <h2>New tender</h2>
        <CommandForm action="register" command={command} busy={loading} label="Save tender" dateZone="Asia/Kolkata" fields={[
          field('authority', 'Procuring authority'), field('portal', 'Portal', { max: 120 }), field('reference', 'Bid reference', { max: 160 }),
          field('portal_url', 'Portal URL', { required: false, type: 'url', max: 2000 }), zone(),
          field('deadline', 'Submission deadline', { type: 'datetime-local' }),
          field('published_at', 'Publication date and time', { required: false, type: 'datetime-local' }),
          ...(index.owners.length ? [field('owner', 'Tender owner', {
            choices: [['', 'Assign to me'], ...index.owners.map(({ id, name }): Option => [id, name])], required: false,
          })] : []),
          field('geography', 'Geography', { required: false, max: 150 }), field('procurement_sites', 'Procurement sites', { required: false, max: 1000 }),
          field('estimate', 'Estimated value', { required: false, max: 18 }), field('fees', 'Tender fees', { required: false, max: 18 }),
        ]} />
        <button type="button" className="secondary" onClick={() => setCreating(false)}>Back to register</button>
      </>}
      {!creating && <>
        <div className="policy-fields">
          <label>Search tenders<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <label>Stage<select value={status} onChange={event => setStatus(event.target.value)}><option value="">All stages</option>
            {stages.map(stage => <option key={stage}>{stage}</option>)}</select></label>
        </div>
        {records.length ? <div className="table-scroll"><table>
          <thead><tr><th>Bid reference</th><th>Authority</th><th>Portal</th><th>Owner</th><th>Deadline</th>
            <th>Stage</th><th>Bid decision</th><th>Value</th><th>Checklist reviewed</th></tr></thead>
          <tbody>{records.map(record => <tr key={record.id}>
            <td><button type="button" className="link" onClick={() => open(record.id)}>{record.reference}</button></td>
            <td>{record.authority}</td><td>{record.portal}</td><td>{record.owner_name}</td><td>{displayDeadline(record)}</td>
            <td>{record.lifecycle}</td><td>{record.bid_decision}</td><td>{currencyFormat(record)}</td><td>{record.reviewed_items}/{record.required_items}</td>
          </tr>)}</tbody>
        </table></div> : <p>{query || status ? 'No tenders match the filters.' : 'There are no tenders in your workspace.'}</p>}
      </>}
    </>}
    {active && !error && <>
      <p>{active.record.authority} · {active.record.owner_name} · {active.record.lifecycle} · {active.record.bid_decision}</p>
      <p>Submission deadline <strong>{displayDeadline(active.record)}</strong></p>
      <div className="settings-tabs" aria-label="Tender sections">
        {['Overview', 'Lots and evaluation', 'Checklist and submission', 'Dates', 'Securities and execution', 'Pre-bid and market', 'Files and history'].map(name =>
          <button key={name} type="button" className="secondary" aria-pressed={tab === name} onClick={() => setTab(name)}>{name}</button>)}
      </div>
      <TenderSection key={active.record.id + ':' + tab} db={db} organization={organization} tab={tab} detail={active}
        command={command} busy={loading} refresh={() => refresh(value => value + 1)} />
    </>}
  </section>;
}

function CommandForm({ action, command, label, fields, dateZone, busy }: {
  action: TenderCommand; command: Command; label: string; fields: Field[]; dateZone?: string; busy: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const last = useRef<{ payload: string; key: string } | undefined>(undefined);
  const id = useId();

  function updatePreview(form: HTMLFormElement) {
    const values = new FormData(form);
    const deadline = String(values.get('deadline') ?? '');
    if (!deadline || !dateZone) return;
    const selectedZone = String(values.get('timezone') || dateZone);
    try {
      setPreview(`India time ${formatTime(zonedTime(deadline, selectedZone))} IST`);
    } catch (failure) {
      setPreview(failure instanceof Error ? failure.message : '');
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || running) return;
    const form = event.currentTarget;
    setRunning(true);
    setError('');
    try {
      const values = new FormData(form);
      const payload: Payload = {};
      for (const entry of fields) {
        const value = String(values.get(entry.name) ?? '').trim();
        if (entry.type === 'checkbox') payload[entry.name] = values.has(entry.name);
        else if (entry.type === 'datetime-local' && value) payload[entry.name] = zonedTime(value, String(values.get('timezone') || dateZone || 'Asia/Kolkata'));
        else payload[entry.name] = value || null;
      }
      const serial = JSON.stringify(payload);
      if (last.current?.payload !== serial) last.current = { payload: serial, key: crypto.randomUUID() };
      await command(action, payload, last.current.key);
      last.current = undefined;
      form.reset();
      setPreview('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to confirm the tender action.');
    } finally {
      setRunning(false);
    }
  }

  return <form onSubmit={submit} onChange={event => updatePreview(event.currentTarget)} className="policy-form">
    <fieldset disabled={busy || running}>
      <legend>{label}</legend>
      <div className="policy-fields">
        {fields.map(entry => <label key={entry.name} htmlFor={id + entry.name}>{entry.label}
          {entry.choices ? <select id={id + entry.name} name={entry.name} defaultValue={entry.initial ?? ''} required={entry.required}>
            {entry.required && !entry.initial && <option value="">Choose one</option>}
            {entry.choices.map(([value, name]) => <option value={value} key={value}>{name}</option>)}
          </select>
            : entry.type === 'textarea' ? <textarea id={id + entry.name} name={entry.name} required={entry.required} maxLength={entry.max} />
              : <input id={id + entry.name} name={entry.name} type={entry.type ?? 'text'} required={entry.type !== 'checkbox' && entry.required}
                defaultChecked={entry.type === 'checkbox' && entry.initial === 'yes'} maxLength={entry.max} defaultValue={entry.type === 'checkbox' ? undefined : entry.initial} />}
          {entry.help && <small>{entry.help}</small>}
        </label>)}
      </div>
      {preview && <p role="status">{preview}</p>}
      <button type="submit">{running ? 'Saving…' : label}</button>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  </form>;
}

function TenderSection({ db, organization, tab, detail, command, busy, refresh }: {
  db: SupabaseClient<Database>; organization: string; tab: string; detail: TenderDetail;
  command: Command; busy: boolean; refresh: () => void;
}) {
  const { record, lots, checklist, events, files, can_edit, can_review, can_waive, can_submit } = detail;
  const [action, choose] = useState('');
  const preparing = record.lifecycle === 'Preparing';
  const identified = record.lifecycle === 'Identified';
  const evaluation = ['Submitted', 'Under Evaluation'].includes(record.lifecycle);
  const submitted = events.find(event => event.kind === 'record_submission');
  const approvalAvailable = preparing || identified;
  const lotChoices: Option[] = lots.map(lot => [lot.id, `${lot.lot_number} · ${lot.description}`]);
  const checklistChoices: Option[] = checklist.map(item => [item.id, item.title]);
  const cleanChoices: Option[] = files.filter(file => file.status === 'Available').map(file => [file.id, file.name]);
  const evidence = (required = true, label = 'Scanned attachment') => field('file', label, {
    choices: required ? cleanChoices : [['', 'No attachment'], ...cleanChoices], required,
    help: required && !cleanChoices.length ? 'Upload a file and wait for scanning under Files and history.' : undefined,
  });
  const lot = (choices = lotChoices) => field('lot', 'Lot', { choices });
  const checklistField = (choices = checklistChoices) => field('item', 'Checklist item', { choices });
  const time = (name: string, label: string): Field => field(name, `${label} (${record.source_timezone})`, { type: 'datetime-local' });
  const editableLots = lots.filter(item => !['Awarded', 'Lost', 'Technical Rejected'].includes(item.evaluation));
  const itemsById = Object.fromEntries(checklist.map(item => [item.id, item]));
  const lotsById = Object.fromEntries(lots.map(item => [item.id, item]));
  const { securities, execution, invoices, prebid } = detail.tracking;
  const awarded = lotChoices.filter(([id]) => lotsById[id]?.evaluation === 'Awarded');
  const securitiesOpen = securities.filter(item => !['Released', 'Forfeited', 'Cancelled'].includes(item.state));
  const pbgExtendable = securitiesOpen.filter(item => item.kind === 'PBG' && item.state !== 'Draft' && item.expires_on);
  const invoicesOpen = invoices.filter(item => !/^0(\.0+)?$/.test(item.outstanding));
  const pendingQueries = prebid.filter(item => !item.submitted_at);
  const awaitingReply = prebid.filter(item => item.submitted_at && !item.reply);
  const competitorObservations = events.filter(event => event.kind === 'observe_competitor');
  const day = (name: string, label: string, required = true) => field(name, label, { type: 'date', required });
  const followUp = () => day('follow_up', 'Next follow-up date', false);
  const forms: { name: TenderCommand; button: string; fields: Field[] }[] = [];
  const addForm = (name: TenderCommand, button: string, fields: Field[]) => forms.push({ name, button, fields });

  switch (tab) {
    case 'Overview':
      if (can_review && identified && record.bid_decision === 'Pending') addForm('bid_decision', 'Record bid decision', [
        field('decision', 'Bid decision', { choices: options(['Go', 'No Go']) }), reason('Decision rationale'),
      ]);
      if (can_review && (preparing || record.lifecycle === 'Cancelled' || (identified && record.bid_decision === 'No Go'))) {
        addForm('reopen', 'Reopen bid decision', [reason()]);
      }
      if (can_edit && approvalAvailable) addForm('cancel', 'Cancel tender', [reason('Cancellation reason'), evidence(false)]);
      if (can_edit && evaluation && !editableLots.length) addForm('close', 'Close tender', [reason('Closure reason')]);
      break;
    case 'Lots and evaluation':
      if (can_edit && identified) addForm('add_lot', 'Add lot', [
        field('number', 'Lot number', { max: 80 }), field('description', 'Description', { max: 500 }),
      ]);
      if (can_edit && preparing && lots.length) addForm('offer_lot', 'Record lot offering', [
        lot(), field('model', 'Offered model', { max: 160 }), field('quantity', 'Offered quantity', { max: 19 }),
      ]);
      if (can_edit && evaluation && editableLots.length) {
        addForm('evaluate_lot', 'Record evaluation', [
          lot(lotChoices.filter(([id]) => editableLots.some(item => item.id === id))),
          field('state', 'Evaluation outcome', { choices: options(['Technical Pending', 'Technical Qualified', 'Technical Rejected', 'Financial Opened', 'Lost']) }),
          field('rank', 'Observed rank after financial opening', { required: false, max: 9 }), reason('Outcome source and rationale'),
        ]);
        const opened = lotChoices.filter(([id]) => lotsById[id]?.evaluation === 'Financial Opened');
        if (opened.length) addForm('award_lot', 'Record lot award', [
          lot(opened), field('customer', 'Awarded customer'), field('contract', 'Contract reference'),
          field('quantity', 'Awarded quantity', { max: 19 }), field('value', `Award value (${record.currency})`, { max: 18 }),
          time('awarded_at', 'Awarded at'), evidence(),
        ]);
      }
      break;
    case 'Checklist and submission':
      if (can_edit && approvalAvailable) addForm('add_checklist', 'Add checklist requirement', [
        field('title', 'Requirement', { max: 300 }), field('kind', 'Requirement type', {
          choices: [['document', 'Document'], ['compliance', 'Lot compliance']], initial: 'document',
          help: 'For lot compliance, choose a lot and mark the requirement mandatory and non-waivable.',
        }),
        field('lot', 'Applies to lot', { required: false, choices: [['', 'Entire tender'], ...lotChoices] }),
        field('mandatory', 'Mandatory', { type: 'checkbox', initial: 'yes' }),
        field('nonwaivable', 'Non-waivable', { type: 'checkbox' }),
      ]);
      if (can_edit && preparing && checklist.length) addForm('attach_checklist', 'Attach checklist evidence', [
        checklistField(), evidence(), field('valid_until', 'Evidence expiry date', { type: 'date', required: false }),
        field('deviation', 'Deviation from requirement, if any', { type: 'textarea', required: false, max: 2000 }),
      ]);
      if (can_review && preparing && checklist.some(item => item.evidence_id)) addForm('review_checklist', 'Verify checklist evidence', [
        checklistField(checklistChoices.filter(([id]) => itemsById[id].evidence_id)), reason('Review note and deviation rationale', false),
      ]);
      if (can_waive && preparing && checklist.some(item => !item.nonwaivable)) addForm('waive_checklist', 'Approve checklist waiver', [
        checklistField(checklistChoices.filter(([id]) => !itemsById[id].nonwaivable)), reason('Waiver rationale'),
      ]);
      if (can_submit && preparing) addForm('record_submission', 'Record portal acknowledgement', [
        time('submitted_at', 'Actual submission time'),
        field('submitted_by', 'Person who submitted'), field('acknowledgement', 'Acknowledgement reference', { required: false }),
        evidence(false, 'Acknowledgement file'),
        field('late_reason', 'Explanation for a late submission', { required: false, type: 'textarea', max: 1000 }),
      ]);
      if (can_edit && submitted) addForm('submission_addendum', 'Add submission correction', [reason('Correction details'), evidence()]);
      break;
    case 'Securities and execution':
      if (can_edit) {
        addForm('security_add', 'Add security', [
          field('kind', 'Security type', { choices: options(awarded.length ? ['EMD', 'PBG'] : ['EMD']), initial: 'EMD' }),
          field('lot', 'Awarded lot for PBG', { required: false, choices: [['', 'Tender level'], ...awarded] }),
          field('instrument', 'Instrument or exemption category', { max: 120 }),
          field('amount', `Amount (${record.currency})`, { max: 18, help: 'For an exemption, enter 0 and attach scanned evidence.' }),
          field('issuer', 'Issuer or exemption authority'), field('reference', 'Instrument reference'),
          day('issued_on', 'Issue date', false), day('expires_on', 'Expiry date', false), followUp(),
          evidence(false, 'Exemption evidence'),
        ]);
        if (securitiesOpen.length) addForm('security_step', 'Update security status', [
          field('security', 'Security record', { choices: securitiesOpen.map(item => [item.id, `${item.reference} · ${item.kind} · ${item.state}`]) }),
          field('state', 'New status', { choices: options(['Submitted', 'Active', 'Release Requested', 'Released', 'Forfeited', 'Cancelled']) }),
          day('occurred_on', 'Action date'), field('reference', 'Release or forfeiture reference', { required: false }),
          reason('Status update details'), followUp(), evidence(false, 'Supporting evidence'),
        ]);
        if (pbgExtendable.length) addForm('security_extend', 'Extend PBG expiry', [
          field('security', 'PBG record', { choices: pbgExtendable.map(item => [item.id, `${item.reference} · ${item.expires_on}`]) }),
          day('expires_on', 'New expiry date'), reason('Extension reason'), evidence(),
        ]);
        if (awarded.length) {
          addForm('execution_entry', 'Record execution milestone', [
            lot(awarded), field('kind', 'Movement', { choices: options(['Dispatched', 'Installed', 'Accepted']) }),
            field('quantity', 'Quantity', { max: 19 }), time('happened_at', 'Actual event time'), field('reference', 'Evidence reference'), evidence(),
          ]);
          addForm('invoice_add', 'Record invoice follow-up item', [
            lot(awarded), field('reference', 'Invoice reference'), day('due_on', 'Invoice due date'),
            field('amount', `Invoiced amount (${record.currency})`, { max: 18 }), followUp(), evidence(),
          ]);
        }
        if (invoicesOpen.length) addForm('invoice_follow_up', 'Record collection follow-up', [
          field('invoice', 'Outstanding invoice', { choices: invoicesOpen.map(item => [item.id, `${item.reference} · ${record.currency} ${item.outstanding}`]) }),
          field('received', `Amount received externally (${record.currency})`, { max: 18, required: false }),
          time('happened_at', 'Actual follow-up or payment time'), field('reference', 'Payment reference, if any', { required: false }),
          followUp(), reason('Follow-up result'), evidence(false, 'Proof of receipt (required for payments)'),
        ]);
      }
      break;
    case 'Pre-bid and market':
      if (can_edit) {
        if (approvalAvailable) addForm('prebid_add', 'Add pre-bid query', [
          field('issue', 'Specification issue', { type: 'textarea', max: 1000 }),
          field('change', 'Requested change', { type: 'textarea', max: 1000 }),
          field('responsible', 'Person responsible'),
        ]);
        const queryChoices = (items: PrebidQuery[]): Option[] => items.map(item => [item.id, item.issue]);
        if (pendingQueries.length) addForm('prebid_submit', 'Record external query submission', [
          field('query', 'Pre-bid query', { choices: queryChoices(pendingQueries) }), time('happened_at', 'Submission time'),
          field('reference', 'Submission reference'), evidence(false),
        ]);
        if (awaitingReply.length) addForm('prebid_reply', 'Record authority response', [
          field('query', 'Pre-bid query', { choices: queryChoices(awaitingReply) }), time('happened_at', 'Response time'),
          field('response', 'Authority response', { type: 'textarea', max: 2000 }), evidence(false),
        ]);
        addForm('observe_competitor', 'Record competitor observation', [
          field('competitor', 'Competitor'), field('observation', 'Observation', { type: 'textarea', max: 1500 }),
          field('source', 'Public source or evidence reference', { max: 500 }), day('observed_on', 'Observed on'),
          field('confidence', 'Confidence', { choices: options(['Low', 'Medium', 'High']) }),
        ]);
      }
      break;
    case 'Dates':
      if (can_edit && approvalAvailable) {
        addForm('milestone', 'Record milestone date', [
          field('kind', 'Milestone', { choices: options(['Publication', 'Pre-bid', 'Clarification', 'Opening']) }), time('instant', 'Date and time'),
          reason('Source or change reason'), evidence(false, 'Corrigendum file (required for changes)'),
        ]);
        addForm('corrigendum', 'Record deadline corrigendum', [
          zone(record.source_timezone), field('deadline', 'Revised submission deadline', { type: 'datetime-local' }),
          reason('Corrigendum reason'), evidence(),
        ]);
      }
      break;
  }
  const form = forms.find(value => value.name === action);
  const dates = events.filter(event => ['register', 'corrigendum', 'milestone'].includes(event.kind));
  const safeUrl = record.portal_url?.startsWith('https://') ? record.portal_url : null;

  return <>
    {tab === 'Overview' && <>
      <dl>
        <dt>Portal</dt><dd>{safeUrl ? <a href={safeUrl} target="_blank" rel="noopener noreferrer">{record.portal}</a> : record.portal}</dd>
        <dt>Estimated value</dt><dd>{record.estimate === null ? 'Unknown' : `${record.currency} ${record.estimate}`}</dd>
        {record.fees && <><dt>Tender fees</dt><dd>{record.currency} {record.fees}</dd></>}
        {record.geography && <><dt>Geography</dt><dd>{record.geography}</dd></>}
        {record.procurement_sites && <><dt>Procurement sites</dt><dd>{record.procurement_sites}</dd></>}
      </dl>
      {identified && record.bid_decision === 'Pending' && !can_review && <p>Awaiting an independent bid reviewer. An administrator can configure tender approval in Organization settings.</p>}
    </>}
    {tab === 'Lots and evaluation' && <>
      <h2>Lots</h2>
      {lots.length ? <div className="table-scroll"><table>
        <thead><tr><th>Lot</th><th>Description</th><th>Offering</th><th>Evaluation</th><th>Observed rank</th><th>Award</th></tr></thead>
        <tbody>{lots.map(item => {
          const award = events.find(event => event.kind === 'award_lot' && event.payload.lot === item.id)?.payload;
          return <tr key={item.id}><td>{item.lot_number}</td><td>{item.description}</td>
            <td>{item.offered_model ? `${item.offered_model} × ${item.offered_quantity}` : 'Pending'}</td>
            <td>{item.evaluation}</td><td>{item.observed_rank ? 'L' + item.observed_rank : '—'}</td>
            <td>{award ? `${award.quantity} · ${award.currency} ${award.value} · ${award.contract}` : '—'}</td></tr>;
        })}</tbody>
      </table></div> : <p>No lots recorded.</p>}
    </>}
    {tab === 'Checklist and submission' && <>
      <h2>Checklist</h2>
      {checklist.length ? <div className="table-scroll"><table>
        <thead><tr><th>Requirement</th><th>Applies to</th><th>Restriction</th><th>Evidence</th><th>Review</th><th>Deviation</th></tr></thead>
        <tbody>{checklist.map(item => <tr key={item.id}><td>{item.title}</td>
          <td>{item.lot_id ? `Lot ${lotsById[item.lot_id]?.lot_number}` : 'Tender'}</td>
          <td>{item.nonwaivable ? 'Non-waivable' : item.mandatory ? 'Mandatory' : 'Optional'}</td>
          <td>{files.find(file => file.id === item.evidence_id)?.name ?? '—'}{item.valid_until && ` · valid to ${item.valid_until}`}</td>
          <td>{item.waiver_policy ? 'Waiver approved' : item.reviewed_by ? 'Verified' : 'Pending'}</td>
          <td>{item.deviation || '—'}</td></tr>)}</tbody>
      </table></div> : <p>No checklist requirements recorded.</p>}
      <h2>{submitted ? 'Recorded submission' : 'Submission readiness'}</h2>
      {submitted ? <>
        <p>{formatTime(String(submitted.payload.submitted_at), record.source_timezone)} · {String(submitted.payload.submitted_by)}
          {submitted.payload.late && ` · Late — ${submitted.payload.late_reason}`}</p>
        {typeof submitted.payload.acknowledgement === 'string' && <p>Reference {submitted.payload.acknowledgement}</p>}
        <p>Snapshot SHA-256 <code>{String(submitted.payload.snapshot_sha256)}</code></p>
      </> : detail.readiness.length ? <ul>{detail.readiness.map((item, index) => <li key={item.reason + index}>{item.reason}</li>)}</ul>
        : <p>Checklist is ready for an authorized submission recording. Enter the external portal acknowledgement after the bid is submitted.</p>}
    </>}
    {tab === 'Dates' && <>
      <h2>Milestone history</h2>
      <div className="table-scroll"><table><thead><tr><th>Milestone</th><th>Source time</th><th>Reason</th></tr></thead>
        <tbody>{dates.flatMap(event => {
          const name = String(event.payload.kind || 'Submission deadline');
          const when = String(event.payload.instant || event.payload.deadline);
          const timezone = String(event.payload.timezone || record.source_timezone);
          return [
            <tr key={event.id}><td>{name}</td><td>{formatTime(when, timezone)} ({timezone})</td><td>{String(event.payload.reason || 'Registration')}</td></tr>,
            ...(event.payload.published_at ? [<tr key={event.id + ':published'}><td>Publication</td><td>{formatTime(String(event.payload.published_at), timezone)} ({timezone})</td><td>Registration</td></tr>] : []),
          ];
        })}</tbody>
      </table></div>
      <h2>Upcoming deadline reminders</h2>
      {detail.reminders.filter(item => Date.parse(item.due_at) > Date.now()).length ? <ul>
        {detail.reminders.filter(item => Date.parse(item.due_at) > Date.now()).map(item =>
          <li key={item.days_before}>{item.days_before} {item.days_before === 1 ? 'day' : 'days'} before closing · {formatTime(item.due_at)} IST</li>)}
      </ul> : <p>No upcoming deadline reminders.</p>}
    </>}
    {tab === 'Securities and execution' && <>
      <h2>EMD and PBG</h2>
      {securities.length ? <div className="table-scroll"><table>
        <thead><tr><th>Type</th><th>Instrument and reference</th><th>Issuer</th><th>Amount</th><th>Status</th><th>Expiry</th><th>Follow-up</th></tr></thead>
        <tbody>{securities.map(item => <tr key={item.id}><td>{item.kind}{item.lot_id && ` · ${lotsById[item.lot_id]?.lot_number}`}</td>
          <td>{item.instrument} · {item.reference}</td><td>{item.issuer}</td>
          <td>{item.exemption_evidence ? 'Exempt' : record.currency + ' ' + item.amount}</td>
          <td>{item.state}{item.expired && ' · Expired'}</td><td>{item.expires_on ?? '—'}</td>
          <td>{item.next_follow_up ?? '—'}{item.follow_up_due && ' · Due'}</td></tr>)}</tbody>
      </table></div> : <p>No security instruments recorded.</p>}
      <h2>Award execution</h2>
      {execution.length ? <div className="table-scroll"><table>
        <thead><tr><th>Lot</th><th>Event</th><th>Quantity</th><th>Actual time</th><th>Reference</th></tr></thead>
        <tbody>{execution.map(item => <tr key={item.id}><td>{lotsById[item.lot_id]?.lot_number}</td>
          <td>{item.kind}</td><td>{item.quantity}</td><td>{formatTime(item.happened_at, record.source_timezone)}</td><td>{item.reference}</td></tr>)}</tbody>
      </table></div> : <p>No dispatch, installation or acceptance recorded.</p>}
      <h2>Invoice and collection follow-up</h2>
      {invoices.length ? <div className="table-scroll"><table>
        <thead><tr><th>Invoice</th><th>Lot</th><th>Due</th><th>Invoiced ({record.currency})</th><th>Recorded receipts</th>
          <th>Outstanding</th><th>Next follow-up</th></tr></thead>
        <tbody>{invoices.map(item => <tr key={item.id}><td>{item.reference}</td><td>{lotsById[item.lot_id]?.lot_number}</td>
          <td>{item.due_on}{item.overdue && ' · Overdue'}</td><td>{item.amount}</td><td>{item.paid}</td>
          <td>{item.outstanding}</td><td>{item.next_follow_up ?? '—'}</td></tr>)}</tbody>
      </table></div> : <p>No invoices recorded for follow-up.</p>}
    </>}
    {tab === 'Pre-bid and market' && <>
      <h2>Pre-bid queries</h2>
      {prebid.length ? <div className="table-scroll"><table>
        <thead><tr><th>Specification issue</th><th>Requested change</th><th>Responsible person</th><th>Submission</th><th>Authority response</th></tr></thead>
        <tbody>{prebid.map(item => <tr key={item.id}><td>{item.issue}</td><td>{item.change_requested}</td><td>{item.responsible_person}</td>
          <td>{item.submitted_at ? formatTime(item.submitted_at, record.source_timezone) + ' · ' + item.submission_reference : 'Draft'}</td>
          <td>{item.reply && item.reply_at ? formatTime(item.reply_at, record.source_timezone) + ' · ' + item.reply : '—'}</td></tr>)}</tbody>
      </table></div> : <p>No pre-bid queries recorded.</p>}
      <h2>Competitor observations</h2>
      {competitorObservations.length ? <div className="table-scroll"><table>
        <thead><tr><th>Competitor</th><th>Observation</th><th>Source</th><th>Date</th><th>Confidence</th></tr></thead>
        <tbody>{competitorObservations.map(({ id, payload }) => <tr key={id}><td>{String(payload.competitor)}</td><td>{String(payload.observation)}</td>
          <td>{String(payload.source)}</td><td>{String(payload.observed_on)}</td><td>{String(payload.confidence)}</td></tr>)}</tbody>
      </table></div> : <p>No competitor observations recorded.</p>}
    </>}
    {tab === 'Files and history' && <>
      <TenderAttachments db={db} organization={organization} detail={detail} refresh={refresh} />
      <h2>Change history</h2>
      <div className="table-scroll"><table><thead><tr><th>When (IST)</th><th>Action</th><th>By</th><th>Details</th></tr></thead>
        <tbody>{events.map(event => <tr key={event.id}><td>{formatTime(event.recorded_at)}</td><td>{labels[event.kind]}</td>
          <td>{event.actor_name}</td><td>{String(event.payload.reason || event.payload.decision || event.payload.state || '')}</td></tr>)}</tbody>
      </table></div>
    </>}
    {forms.length > 0 && <div className="settings-tabs" aria-label={tab + ' actions'}>
      {forms.map(item => <button type="button" key={item.name} className="secondary" aria-pressed={action === item.name}
        onClick={() => choose(action === item.name ? '' : item.name)}>{item.button}</button>)}
    </div>}
    {form && <CommandForm key={form.name} action={form.name} label={form.button} fields={form.fields} command={async (...args) => {
      await command(...args);
      choose('');
    }} busy={busy} dateZone={record.source_timezone} />}
  </>;
}

function TenderAttachments({ db, organization, detail, refresh }: {
  db: SupabaseClient<Database>; organization: string; detail: TenderDetail; refresh: () => void;
}) {
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const reservation = useRef<{ file: File; key: string; stage?: string } | undefined>(undefined);
  const id = useId();

  async function fileRequest(stage: string, file?: File) {
    const { data } = await db.auth.getSession();
    if (!data.session) throw new Error('Sign in again to access attachments.');
    const endpoint = new URL('/functions/v1/private-files', import.meta.env.VITE_SUPABASE_URL);
    endpoint.searchParams.set('stage', stage);
    const response = await fetch(endpoint, {
      method: file ? 'POST' : 'GET',
      credentials: 'omit',
      headers: {
        authorization: 'Bearer ' + data.session.access_token,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        ...(file ? { 'content-type': file.type } : {}),
      },
      body: file,
    });
    if (!response.ok) throw new Error('Attachment service is unavailable or access has changed.');
    return response;
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const file = (form.elements.namedItem('file') as HTMLInputElement).files?.[0];
    if (!file || !file.size || file.size > 26214400 || !['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) {
      setError('Choose a PDF, PNG or JPEG file up to 25 MB.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (reservation.current?.file !== file) reservation.current = { file, key: crypto.randomUUID() };
      let stage = reservation.current.stage;
      if (!stage) {
        const result = await db.rpc('reserve_file_stage', {
          p_org: organization, p_parent: detail.record.id, p_key: reservation.current.key,
          p_name: file.name, p_purpose: 'business_document', p_mime: file.type, p_size: file.size,
        });
        if (result.error || !result.data) throw new Error('Could not reserve the attachment.');
        stage = result.data;
        reservation.current.stage = stage;
      }
      const response = await fileRequest(stage, file);
      const result = await response.json();
      setNotice(result.status === 'available' ? 'Attachment available.' : result.status === 'rejected'
        ? 'The scanner rejected this attachment.' : 'Attachment uploaded and awaiting a scan.');
      if (result.status === 'available' || result.status === 'rejected') {
        reservation.current = undefined;
        form.reset();
      }
      refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Attachment upload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function download(file: TenderFile) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fileRequest(file.id);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to download the attachment.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <h2>Private attachments</h2>
    {detail.files.length ? <ul>{detail.files.map(file => <li key={file.id}>{file.name} · {file.status}
      {file.status === 'Available' && <button type="button" className="link" disabled={busy} onClick={() => void download(file)}>Download</button>}
    </li>)}</ul> : <p>No attachments available.</p>}
    {detail.can_edit && <form onSubmit={upload} className="policy-form">
      <label htmlFor={id}>Tender file<input id={id} name="file" type="file" accept="application/pdf,image/png,image/jpeg" disabled={busy} required /></label>
      <button type="submit" disabled={busy}>{busy ? 'Checking file…' : 'Upload for scanning'}</button>
    </form>}
    {detail.files.some(file => file.status === 'Awaiting scan') && <button type="button" className="secondary" onClick={refresh}>Check scan status</button>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </>;
}
