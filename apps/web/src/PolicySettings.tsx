import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../../packages/domain/database.types';

import { FieldSettings } from './FieldSettings';

type Section = 'expense' | 'tender';
type ExpenseRule = {
  category: string; grade: string; geography: string; travel_type: string;
  calculation: 'actual' | 'mileage' | 'daily'; partial_day: 'none' | 'half';
  rate: string | null; cap: string | null; receipt_threshold: string | null;
  tax_included: boolean; exception_allowed: boolean; travel_approval_required: boolean; prepayment_allowed: boolean;
};
type Route = { process: string; subject: string | null; primary: string; alternate: string | null; limit: string | null };
type Values = { rules: ExpenseRule[]; routes: Route[] };
type Revision = { id: string; revision: number; effective_on: string; settings: Values };
type Snapshot = { today: string; currency: string; expense: Revision | null; tender: Revision | null };
type Staff = { membership_id: string; display_name: string; status: string };

const sections = { expense: 'Expense policy', tender: 'Tender approval' };
const processes = {
  expense: [['travel', 'Travel authorization'], ['manager', 'Manager approval'], ['finance', 'Finance review']],
  tender: [['bid', 'Bid decision'], ['submission', 'Submission approval'], ['waiver', 'Checklist waiver']],
};
const newRule: ExpenseRule = {
  category: '', grade: '*', geography: '*', travel_type: '*', calculation: 'actual', partial_day: 'none',
  rate: null, cap: null, receipt_threshold: null, tax_included: false, exception_allowed: false,
  travel_approval_required: false, prepayment_allowed: false,
};
const ruleScopes = [['category','Category code'],['grade','Employee grade'],['geography','Geography'],['travel_type','Travel type']] as const;
const options = [
  ['tax_included','Includes tax'], ['exception_allowed','Allow approved exceptions'],
  ['travel_approval_required','Requires travel approval'], ['prepayment_allowed','Allow prepaid expenses'],
] as const;

export function PolicySettings({ db, organization }: { db: SupabaseClient<Database>; organization: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [section, setSection] = useState<Section|'field'>('expense');

  useEffect(() => {
    let current = true;
    void Promise.all([
      db.rpc('read_operating_policy_settings', { p_org: organization }),
      db.rpc('staff_directory', { p_org: organization }),
    ]).then(([settings, directory]) => {
      if (!current) return;
      if (settings.error || directory.error || !settings.data) {
        setLoadError(true);
        return;
      }
      setSnapshot(settings.data as unknown as Snapshot);
      setStaff(directory.data ?? []);
    });
    return () => { current = false; };
  }, [db, organization, reload]);

  return <section className="panel" aria-labelledby="settings-title">
    <h1 id="settings-title">Organization settings</h1>
    <div className="settings-tabs" aria-label="Policy sections">
      {(Object.keys(sections) as Section[]).map(key => <button key={key} className="secondary"
        aria-pressed={section === key} onClick={() => setSection(key)}>{sections[key]}</button>)}
      <button className="secondary" aria-pressed={section==='field'} onClick={()=>setSection('field')}>Field Operations</button>
    </div>
    {section==='field' ? <FieldSettings db={db} organization={organization}/> : loadError ? <p role="alert">Policy settings are unavailable. <button className="link"
      onClick={() => { setLoadError(false); setReload(value => value + 1); }}>Retry</button></p>
      : snapshot ? <PolicyEditor key={section + (snapshot[section]?.id ?? '')} section={section}
        latest={snapshot[section]} today={snapshot.today} currency={snapshot.currency} staff={staff}
        db={db} organization={organization} refresh={() => setReload(value => value + 1)} />
      : <p role="status">Loading policy settings…</p>}
  </section>;
}

function PolicyEditor({ section, latest, today, currency, staff, db, organization, refresh }: {
  section: Section; latest: Revision | null; today: string; currency: string; staff: Staff[];
  db: SupabaseClient<Database>; organization: string; refresh: () => void;
}) {
  const [values, setValues] = useState<Values>(latest?.settings ?? { rules: [], routes: [] });
  const [effective, setEffective] = useState(latest && latest.effective_on > today ? latest.effective_on : today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const operation = useRef<{ body: string; key: string } | undefined>(undefined);
  const changeRule = (index: number, edit: Partial<ExpenseRule>) => setValues(old => ({
    ...old, rules: old.rules.map((rule, i) => i === index ? { ...rule, ...edit } : rule),
  }));
  const changeRoute = (index: number, edit: Partial<Route>) => setValues(old => ({
    ...old, routes: old.routes.map((route, i) => i === index ? { ...route, ...edit } : route),
  }));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || conflict) return;
    setBusy(true);
    setError('');
    const body = JSON.stringify({ effective, values });
    if (operation.current?.body !== body) operation.current = { body, key: crypto.randomUUID() };
    try {
      const result = await db.rpc('publish_operating_policy_settings', {
        p_org: organization, p_section: section, p_expected: latest?.id ?? null,
        p_effective_on: effective, p_settings: values as Json, p_key: operation.current.key,
      });
      if (result.error?.code === 'PT409') {
        setConflict(true);
        setError('This policy changed while you were editing. Reload the latest version before saving.');
      } else if (result.error?.code === '22023') {
        setError(result.error.message);
      } else if (result.error) {
        setError('Unable to confirm the save. Try again with the same details.');
      } else {
        refresh();
      }
    } catch {
      setError('Unable to confirm the save. Try again with the same details.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <p className="muted">{latest ? `Saved version ${latest.revision} · Effective ${latest.effective_on}` : 'No policy has been saved.'}</p>
    <form onSubmit={save} className="policy-form">
      <label>Effective date<input required type="date" min={today} value={effective} onChange={event => setEffective(event.target.value)} /></label>
      {section === 'expense' && <>
        <h2>Expense rules</h2>
        <p className="muted">Use * for any grade, geography or travel type.</p>
        {values.rules.map((rule, i) => <fieldset key={i}>
          <legend>Expense rule {i + 1}</legend>
          <div className="policy-fields">
            {ruleScopes.map(([key, label]) => <label key={key}>{label}
              <input required maxLength={31} value={rule[key]}
                onChange={event => changeRule(i, { [key]: event.target.value.toUpperCase() })} />
            </label>)}
            <label>Calculation<select value={rule.calculation} onChange={event => changeRule(i, {
              calculation: event.target.value as ExpenseRule['calculation'], rate: null, partial_day: 'none',
            })}>
              <option value="actual">Actual cost</option><option value="mileage">Mileage</option><option value="daily">Daily allowance</option>
            </select></label>
            {rule.calculation !== 'actual' && <label>Rate per {rule.calculation === 'mileage' ? 'kilometre' : 'day'} ({currency})
              <input required inputMode="decimal" value={rule.rate ?? ''} onChange={event => changeRule(i, { rate: event.target.value })} />
            </label>}
            {rule.calculation === 'daily' && <label>Partial day<select value={rule.partial_day}
              onChange={event => changeRule(i, { partial_day: event.target.value as ExpenseRule['partial_day'] })}>
              <option value="none">No partial-day allowance</option><option value="half">Half rate</option>
            </select></label>}
            <label>Cap ({currency})<input inputMode="decimal" value={rule.cap ?? ''} onChange={event => changeRule(i, { cap: event.target.value || null })} /></label>
            <label>Receipt threshold ({currency})<input inputMode="decimal" value={rule.receipt_threshold ?? ''} onChange={event => changeRule(i, { receipt_threshold: event.target.value || null })} /></label>
          </div>
          <div className="policy-options">{options.map(([key, label]) => <label key={key}>
            <input type="checkbox" checked={rule[key]} onChange={event => changeRule(i, { [key]: event.target.checked })} /> {label}
          </label>)}</div>
          <button className="secondary" type="button" onClick={() => setValues(old => ({ ...old, rules: old.rules.filter((_, index) => index !== i) }))}>Remove rule</button>
        </fieldset>)}
        <div><button type="button" className="secondary" onClick={() => setValues(old => ({ ...old, rules: [...old.rules, { ...newRule }] }))}>Add expense rule</button></div>
      </>}
      <h2>Approval routes</h2>
      {values.routes.map((route, i) => <fieldset key={i}>
        <legend>Approval route {i + 1}</legend>
        <div className="policy-fields">
          <label>Approval step<select value={route.process} onChange={event => changeRoute(i, { process: event.target.value })}>
            {processes[section].map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          {([['subject', 'Applies to', 'All staff'], ['primary', 'Primary approver', 'Select staff'], ['alternate', 'Alternate approver', 'No alternate']] as const).map(([key, label, empty]) => <label key={key}>{label}
            <select value={route[key] ?? ''} required={key === 'primary'} onChange={event => changeRoute(i, { [key]: event.target.value || (key === 'primary' ? '' : null) })}>
              <option value="">{empty}</option>
              {staff.filter(member => member.status === 'Active' || member.membership_id === route[key]).map(member =>
                <option key={member.membership_id} value={member.membership_id} disabled={member.status !== 'Active'}>
                  {member.display_name}{member.status !== 'Active' ? ' (inactive)' : ''}
                </option>)}
            </select>
          </label>)}
          <label>Approval limit ({currency})<input inputMode="decimal" placeholder="No amount limit" value={route.limit ?? ''}
            onChange={event => changeRoute(i, { limit: event.target.value || null })} /></label>
        </div>
        <button className="secondary" type="button" onClick={() => setValues(old => ({ ...old, routes: old.routes.filter((_, index) => index !== i) }))}>Remove route</button>
      </fieldset>)}
      <div><button className="secondary" type="button" onClick={() => setValues(old => ({
        ...old, routes: [...old.routes, { process: processes[section][0][0], subject: null, primary: '', alternate: null, limit: null }],
      }))}>Add approval route</button></div>
      {error && <p role="alert" className="error">{error}</p>}
      <div>
        <button disabled={busy || conflict}>{busy ? 'Saving…' : 'Save new version'}</button>
        {conflict && <button type="button" className="secondary" onClick={refresh}>Reload latest version</button>}
      </div>
    </form>
  </>;
}
