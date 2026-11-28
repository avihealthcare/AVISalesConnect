import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../../packages/domain/database.types';

export type SalesFieldKind = 'site' | 'contact' | 'product' | 'task' | 'visit_plan' | 'attendance_session' | 'visit' | 'equipment' | 'quotation' | 'financial_reference' | 'demo' | 'target';
type Input = { name: string; label: string; type?: string; required?: boolean; choices?: string[] };
type FieldConfig = { title: string; action: string; titleLabel: string; parent?: string; inputs: Input[] };
const settings: Record<SalesFieldKind, FieldConfig> = {
  site: { title: 'Customer Sites', action: 'Add a site', titleLabel: 'Site name', parent: 'Customer', inputs: [
    { name: 'address', label: 'Address', required: true }, { name: 'pin', label: 'PIN code' }, { name: 'city', label: 'City' },
    { name: 'district', label: 'District' }, { name: 'state', label: 'State' }, { name: 'department', label: 'Department' },
    { name: 'ownership', label: 'Ownership' },
    { name:'site_type',label:'Site type', choices:['Hospital Campus','Clinic Branch','Registered Office','Warehouse / Godown','Service Center'] },
    { name:'is_primary',label:'Primary site', choices:['true','false'] },
    { name: 'latitude', label: 'Latitude (decimal degrees)' }, { name: 'longitude', label: 'Longitude (decimal degrees)' },
    { name: 'beds', label: 'Total beds', type: 'number' },
    { name: 'icu_beds', label: 'ICU beds', type: 'number' }, { name: 'nicu_beds', label: 'NICU beds', type: 'number' },
  ] },
  contact: { title: 'Contacts', action: 'Add a contact', titleLabel: 'Contact name', parent: 'Customer', inputs: [
    { name: 'designation', label: 'Designation' }, { name: 'specialty', label: 'Specialty' }, { name: 'buying_role', label: 'Buying role' },
    { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' },
    { name: 'preference', label: 'Communication preference' },
  ] },
  product: { title: 'Products', action: 'Add a product', titleLabel: 'Model or product name', inputs: [
    { name: 'code', label: 'Product code', required: true }, { name: 'category', label: 'Category', required: true },
    { name: 'manufacturer', label: 'Manufacturer' }, { name: 'specifications', label: 'Specifications' },
  ] },
  equipment: { title: 'Installed Equipment', action: 'Record installed equipment', titleLabel: 'Equipment model', parent: 'Customer site', inputs: [
    { name: 'manufacturer', label: 'Manufacturer', required: true }, { name: 'category', label: 'Category' },
    { name: 'quantity', label: 'Quantity', type: 'number', required: true }, { name: 'installed_on', label: 'Estimated installation date', type: 'date' },
    { name: 'warranty_until', label: 'Warranty expiry', type: 'date' }, { name: 'source', label: 'Information source' },
    { name: 'verified_on', label: 'Verified on', type: 'date' },
  ] },
  quotation: { title: 'Quotations', action: 'Record an external quotation revision', titleLabel: 'Quotation title', parent: 'Opportunity', inputs: [
    { name: 'number', label: 'Quotation number', required: true }, { name: 'revision', label: 'Revision', type: 'number', required: true },
    { name: 'source', label: 'Issuing system', required: true }, { name: 'external_id', label: 'External ID' },
    { name: 'issued_on', label: 'Issued on', type: 'date', required: true }, { name: 'valid_until', label: 'Valid until', type: 'date', required: true },
    { name: 'amount', label: 'Amount (INR)', type: 'number', required: true }, { name: 'terms', label: 'Terms and item summary' },
  ] },
  financial_reference: { title: 'Sales Orders and Invoice References', action: 'Add an external reference', titleLabel: 'Reference title', parent: 'Opportunity', inputs: [
    { name: 'type', label: 'Reference type', choices: ['Order', 'Invoice', 'Receipt'], required: true },
    { name: 'number', label: 'External document number', required: true }, { name: 'source', label: 'Issuing system', required: true },
    { name: 'external_id', label: 'External ID' }, { name: 'document_on', label: 'Document date', type: 'date', required: true },
    { name: 'due_on', label: 'Due date', type: 'date' }, { name: 'amount', label: 'Amount (INR)', type: 'number', required: true },
  ] },
  demo: { title: 'Demonstrations', action: 'Log a demonstration', titleLabel: 'Demonstration subject', parent: 'Customer or opportunity', inputs: [
    { name: 'occurred_on', label: 'Demonstration date', type: 'date', required: true }, { name: 'product_summary', label: 'Products demonstrated' },
    { name: 'outcome', label: 'Outcome', required: true }, { name: 'next_action', label: 'Next action' },
  ] },
  target: { title: 'Sales Targets', action: 'Set a personal sales target', titleLabel: 'Target period or label', inputs: [
    { name: 'from_date', label: 'Period start', type: 'date', required: true }, { name: 'through_date', label: 'Period end', type: 'date', required: true },
    { name: 'amount', label: 'Booked value target (INR)', type: 'number', required: true },
  ] },
  task: { title: 'Follow-ups and Tasks', action: 'Create a task', titleLabel: 'Subject', parent: 'Related customer, lead or opportunity', inputs: [
    { name: 'type', label: 'Action type', required: true }, { name: 'notes', label: 'Notes' },
  ] },
  visit_plan: { title: 'Visit Planner', action: 'Plan a visit', titleLabel: 'Purpose', parent: 'Customer site', inputs: [] },
  attendance_session: { title: 'Attendance', action: 'Check in', titleLabel: 'Attendance', inputs: [] },
  visit: { title: 'Field Visits', action: 'Start a visit', titleLabel: 'Purpose', parent: 'Customer site', inputs: [] },
};

type Data = Record<string, string | number | null | object>;
type Row = {
  id: string; title: string; status: string; parent_id: string | null; created_at: string;
  planned_at: string | null; ended_at: string | null; version: number; details: Data; owned: boolean;
};
type Workspace = { rows: Row[]; parents: { id: string; title: string; kind: string }[]; can_create: boolean; can_update: boolean };
type Location = { lat: number; lon: number; accuracy: number };
const indiaTime = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

function LocationEvidence({ point, onLocation }: { point: Location | null; onLocation: (point: Location | null) => void }) {
  const [status, setStatus] = useState('');
  function capture() {
    onLocation(null);
    if (!navigator.geolocation) {
      setStatus('Location is unavailable on this device. Enter the reason below.');
      return;
    }
    setStatus('Getting your location…');
    navigator.geolocation.getCurrentPosition(position => {
      const { latitude, longitude, accuracy } = position.coords;
      onLocation({ lat: latitude, lon: longitude, accuracy });
      setStatus(`Location captured with ${Math.round(accuracy)} m accuracy.`);
    }, () => setStatus('Location could not be captured. Enter an exception reason.'), {
      enableHighAccuracy: true, maximumAge: 0, timeout: 10000,
    });
  }
  return <>
    <button type="button" className="secondary" onClick={capture}>Capture current location</button>
    {status && <p role="status">{status}</p>}
    <label>Location exception reason <input name="exception" maxLength={500} minLength={3} required={!point} /></label>
  </>;
}

export function SalesField({ db, organization, kind }: { db: SupabaseClient<Database>; organization: string; kind: SalesFieldKind }) {
  const config = settings[kind];
  const [workspace, setWorkspace] = useState<Workspace>();
  const [record, setRecord] = useState<Row>();
  const [action, setAction] = useState('create');
  const [location, setLocation] = useState<Location | null>(null);
  const [revision, update] = useState(0);
  const [page, setPage] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(false);
  const retry = useRef<{ body: string; key: string } | null>(null);
  const isTimed = kind === 'attendance_session' || kind === 'visit';
  const isSchedule = kind === 'visit_plan' || kind === 'task';
  const activeSession = isTimed && workspace?.rows.some(row => row.status === 'Open');
  const canEnter = action === 'create' ? workspace?.can_create && !activeSession : workspace?.can_update;
  const report = action === 'complete' && (kind === 'task' || kind === 'visit');

  useEffect(() => {
    let active = true;
    void db.rpc('read_sales_field', { p_org: organization, p_kind: kind, p_offset: page * 25 }).then(result => {
      if (!active) return;
      setLoadError(Boolean(result.error));
      setWorkspace(result.error ? undefined : result.data as unknown as Workspace);
    });
    return () => { active = false; };
  }, [db, organization, kind, page, revision]);

  function changeAction(next: string, row?: Row) {
    setRecord(row);
    setAction(next);
    setLocation(null);
    setMessage('');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    const get = (name: string) => String(values.get(name) ?? '').trim();
    const date = (name: string) => get(name) ? new Date(get(name)).toISOString() : null;
    const details: Record<string, Json> = {};
    if (action === 'create' || action === 'edit') for (const input of config.inputs) details[input.name] = get(input.name);
    if (action === 'reschedule') details.reason = get('reason');
    if (report) for (const name of ['outcome','next_action','no_action_reason','meeting_contacts','products','requirements','competition']) details[name] = get(name);
    if (report && get('next_date')) details.next_due_at = date('next_date');
    if (isTimed && get('exception')) details.exception = get('exception');
    if (isTimed && location) details.location = location;
    const data = {
      id: record?.id ?? null, version: record?.version ?? null,
      title: kind === 'attendance_session' ? 'Attendance' : get('title'),
      parent_id: get('parent_id') || null, planned_at: date('planned_at'), ended_at: date('ended_at'), details,
    };
    const body = JSON.stringify({ action, data });
    if (retry.current?.body !== body) retry.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    setMessage('');
    try {
      const result = await db.rpc('run_sales_field', { p_org: organization, p_kind: kind, p_action: action, p_key: retry.current.key, p_data: data });
      if (result.error) {
        setFailure(true);
        const code = result.error.code;
        setMessage(code === '40001' ? 'This record changed. Refresh and try again.'
          : code === '42501' ? 'This action or the related record is unavailable.'
          : code === '23505' && isTimed ? 'End the open session before starting another.'
          : code === '23505' ? 'A record with this code, reference or revision already exists.'
          : code === '22023' ? result.error.message
          : 'The save could not be confirmed. Retry with the same entries.');
        return;
      }
      event.target instanceof HTMLFormElement && event.target.reset();
      retry.current = null;
      changeAction('create');
      setPage(0);
      setFailure(false);
      setMessage('Saved.');
      update(value => value + 1);
    } catch {
      setFailure(true);
      setMessage('The save could not be confirmed. Retry with the same entries.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <h1>{config.title}</h1>
    {message && <p role={failure ? 'alert' : 'status'}>{message}</p>}
    <div className="workspace-grid">
      {canEnter && <section className="panel">
        <h2>{action === 'create' ? config.action : action === 'edit' ? `Edit ${record?.title}`
          : action === 'reschedule' ? 'Reschedule' : kind === 'attendance_session' ? 'Check out' : kind === 'visit' ? 'Submit visit report' : 'Complete'}</h2>
        <form key={record?.id + action} onSubmit={save}>
          {(action === 'create' || action === 'edit') && <>
            {kind !== 'attendance_session' && <label>{config.titleLabel}
              <input name="title" maxLength={200} required defaultValue={record?.title} />
            </label>}
            {config.parent && action === 'create' && <label>{config.parent}<select name="parent_id" required defaultValue="">
              <option value="">Select</option>
              {workspace?.parents.map(parent => <option key={parent.id} value={parent.id}>{parent.title}</option>)}
            </select></label>}
            {config.inputs.map(input => <label key={input.name}>{input.label}
              {input.choices ? <select name={input.name} required={input.required} defaultValue={String(record?.details[input.name] ?? '')}>
                <option value="">Select</option>{input.choices.map(choice => <option key={choice}>{choice}</option>)}
              </select> : <input name={input.name} type={input.type ?? 'text'} min={input.type === 'number' ? 0 : undefined}
                step={input.name === 'amount' ? '0.01' : undefined} maxLength={500} required={input.required}
                defaultValue={String(record?.details[input.name] ?? '')} />}
            </label>)}
          </>}
          {isSchedule && (action === 'create' || action === 'reschedule') && <>
            <label>{kind === 'task' ? 'Due date and time' : 'Planned start'} (device time)<input name="planned_at" type="datetime-local" required /></label>
            {kind === 'visit_plan' && <label>Planned end (device time)<input name="ended_at" type="datetime-local" required /></label>}
          </>}
          {action === 'reschedule' && <label>Rescheduling reason<input name="reason" required minLength={3} maxLength={500} /></label>}
          {report && <>
            {kind === 'visit' && <>
              <label>Meeting contacts<input name="meeting_contacts" maxLength={500} /></label>
              <label>Products and quantities<input name="products" maxLength={500} /></label>
              <label>Requirements<textarea name="requirements" maxLength={1000} /></label>
              <label>Competitor observations<textarea name="competition" maxLength={1000} /></label>
            </>}
            <label>Outcome<textarea name="outcome" minLength={3} maxLength={2000} required /></label>
            <label>Next action<input name="next_action" maxLength={500} /></label>
            <label>Follow-up date and time (device time)<input name="next_date" type="datetime-local" /></label>
            <label>Reason if no follow-up<input name="no_action_reason" maxLength={500} /></label>
          </>}
          {isTimed && <LocationEvidence point={location} onLocation={setLocation} />}
          <button disabled={busy}>{busy ? 'Saving…' : action === 'create' && isTimed ? config.action : 'Save'}</button>
          {action !== 'create' && <button className="secondary" type="button" onClick={() => changeAction('create')}>Cancel</button>}
        </form>
      </section>}
      <section className="panel">
        <h2>{kind === 'attendance_session' ? 'Attendance log' : 'Records'}</h2>
        {loadError ? <p role="alert">Unable to load records. <button className="link" onClick={() => update(value => value + 1)}>Retry</button></p>
          : !workspace ? <p role="status">Loading…</p> : !workspace.rows.length ? <p>No records to display.</p>
          : <ul className="records">{workspace.rows.slice(0,25).map(row => {
            const parent = workspace.parents.find(item => item.id === row.parent_id);
            const completion = row.details.completion as Record<string,string | undefined> | undefined;
            return <li key={row.id}>
              <strong>{row.title}</strong><p>{row.status}{parent && ` · ${parent.title}`}</p>
              {row.planned_at && <p>{indiaTime.format(new Date(row.planned_at))} IST
                {row.ended_at && ` – ${indiaTime.format(new Date(row.ended_at))} IST`}</p>}
              {config.inputs.map(input => row.details[input.name] ? <p key={input.name}>{input.label} · {String(row.details[input.name])}</p> : null)}
              {kind === 'visit' && typeof row.details.geofence === 'string' && <p>Check-in · {row.details.geofence}
                {typeof row.details.site_distance_metres === 'number' && ` · ${Math.round(row.details.site_distance_metres)} m`}</p>}
              {completion?.outcome && <p>Outcome · {completion.outcome}</p>}
              {completion?.next_action && <p>Next action · {completion.next_action}
                {completion.next_due_at && ` · ${indiaTime.format(new Date(completion.next_due_at))} IST`}</p>}
              {workspace.can_update && row.owned && <>
                {row.status === 'Active' && <button className="secondary" onClick={() => changeAction('edit',row)}>Edit</button>}
                {['Open','Planned'].includes(row.status) && <button className="secondary" onClick={() => changeAction('complete',row)}>
                  {kind === 'attendance_session' ? 'Check out' : kind === 'visit' ? 'End visit' : 'Complete'}
                </button>}
                {isSchedule && ['Open','Planned'].includes(row.status) && <button className="secondary" onClick={() => changeAction('reschedule',row)}>Reschedule</button>}
              </>}
            </li>;
          })}</ul>}
        {workspace && (page > 0 || workspace.rows.length > 25) && <div>
          <button className="secondary" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous</button>
          <button className="secondary" disabled={workspace.rows.length <= 25} onClick={() => setPage(value => value + 1)}>Next</button>
        </div>}
      </section>
    </div>
  </>;
}
