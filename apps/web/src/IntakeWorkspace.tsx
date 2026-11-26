import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../../packages/domain/database.types';
import { StaffAdministration } from './StaffAdministration';
import { RecordFiles } from './RecordFiles';
import { PolicySettings } from './PolicySettings';
import { LeadWorkspace } from './LeadWorkspace';
import { Reports } from './Reports';
import { Tenders } from './Tenders';
import { Expenses } from './Expenses';
import { Dashboard } from './Dashboard';
import { SalesField, type SalesFieldKind } from './SalesField';
import { RecordSearch, containsTerm } from './RecordSearch';

type Screen = 'home' | 'accounts' | 'leads' | 'opportunities' | 'administration' | 'settings' | 'distributors' | 'reports' | 'tenders' | 'expenses' | SalesFieldKind;
type LeadView = 'all' | 'active' | 'overdue';
type RecordOwner = { resources: { owner_membership_id: string | null } | null };
type Account = { id: string; name: string; account_type: string } & RecordOwner;
type OrganizationMembership = { id: string; organization_id: string; organizations: { name: string } | null };

function Accounts({ db, organization, membership, distributors, initialName }: {
  db: SupabaseClient<Database>; organization: string; membership?: string; distributors: boolean; initialName: string;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [search, setSearch] = useState(initialName);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [revision, refresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [grants,setGrants] = useState<string[]>([]);
  const pending = useRef<{ key: string; body: string } | null>(null);

  useEffect(() => {
    let current = true;
    void db.from('role_permissions').select('permission_code').eq('organization_id', organization)
      .in('permission_code',['account.create','file.stage','file.download']).then(result => {
        if (current) setGrants((result.data ?? []).map(row => row.permission_code));
      });
    return () => { current = false; };
  },[db,organization]);

  useEffect(() => {
    let active = true;
    setLoading(true);setLoadError(false);
    let query = db.from('accounts').select('id,name,account_type,resources(owner_membership_id)').eq('organization_id',organization);
    if (distributors) query = query.eq('account_type','Distributor');
    if (search) query = query.ilike('name',containsTerm(search));
    void query.order('name').order('id').range(page*25,page*25+25).then(result => {
      if (!active) return;
      setAccounts((result.data ?? []).slice(0,25));setMore((result.data?.length ?? 0)>25);
      setLoadError(Boolean(result.error));setLoading(false);
    });
    return () => { active=false; };
  },[db,organization,distributors,search,page,revision]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form=event.currentTarget, values=new FormData(form);
    const input={name:String(values.get('name') ?? '').trim(),account_type:distributors?'Distributor':String(values.get('account_type') ?? '')};
    const body=JSON.stringify(input);
    if (pending.current?.body!==body) pending.current={body,key:crypto.randomUUID()};
    setBusy(true);setError('');setSaved(false);
    try {
      const result=await db.rpc('create_intake_record',{p_org:organization,p_key:pending.current.key,p_kind:'account',p_input:input});
      if (result.error) {
        setError(result.error.code==='42501'?'You do not have permission to create this customer.':
          ['23502','23514','22023'].includes(result.error.code)?'Review the name and customer type.':'Unable to confirm the save. Retry with the same entries.');
        return;
      }
      pending.current=null;form.reset();setSaved(true);setPage(0);refresh(value=>value+1);
    } catch {setError('Unable to confirm the save. Retry with the same entries.');}
    finally {setBusy(false);}
  }

  return <div className="workspace-grid">
    {grants.includes('account.create') && <section className="panel">
      <h2>{distributors?'Add a distributor':'Add a customer'}</h2>
      <form onSubmit={create}>
        <label>Customer name<input name="name" required maxLength={200} /></label>
        {!distributors && <label>Customer type<select name="account_type">
          {['Hospital','Institution','Distributor','Other'].map(type=><option key={type}>{type}</option>)}
        </select></label>}
        <button disabled={busy}>{busy?'Saving…':distributors?'Save distributor':'Save customer'}</button>
      </form>
      {saved && <p role="status">Record saved.</p>}
      {error && <p role="alert" className="error">{error}</p>}
    </section>}
    <section className="panel">
      <h2>{distributors?'Distributors':'Customers'}</h2>
      <label>Search by name<input value={search} maxLength={140} onChange={event=>{setSearch(event.target.value);setPage(0);}} /></label>
      {loading ? <p role="status">Loading records…</p> : loadError ? <p role="alert">Unable to load records. <button className="link" onClick={()=>refresh(value=>value+1)}>Retry</button></p>
        : accounts.length ? <ul className="records">{accounts.map(account=><li key={account.id}><strong>{account.name}</strong><p>{account.account_type}</p>
          {membership && account.resources?.owner_membership_id===membership && (grants.includes('file.stage')||grants.includes('file.download')) &&
            <RecordFiles db={db} organization={organization} record={account.id} canUpload={grants.includes('file.stage')} />}
        </li>)}</ul> : <p>{distributors?'No distributors are visible.':'No customers are visible.'}</p>}
      {!loading && !loadError && (page>0||more) && <div><button className="secondary" disabled={!page} onClick={()=>setPage(value=>value-1)}>Previous</button>
        <button className="secondary" disabled={!more} onClick={()=>setPage(value=>value+1)}>Next</button></div>}
    </section>
  </div>;
}

const navigation: { id: Screen; label: string; permission?: string; salesField?: boolean }[] = [
  { id: 'home', label: 'Dashboard' }, { id: 'leads', label: 'Leads', permission: 'lead.read' },
  { id: 'accounts', label: 'Hospitals and Customers', permission: 'account.read' },
  { id: 'site', label: 'Customer Sites', permission: 'site.read', salesField: true },
  { id: 'contact', label: 'Contacts', permission: 'contact.read', salesField: true },
  { id: 'opportunities', label: 'Opportunities', permission: 'opportunity.read' },
  { id: 'attendance_session', label: 'Attendance', permission: 'attendance_session.read', salesField: true },
  { id: 'visit', label: 'Field Visits', permission: 'visit.read', salesField: true },
  { id: 'visit_plan', label: 'Visit Planner', permission: 'visit_plan.read', salesField: true },
  { id: 'task', label: 'Follow-ups and Tasks', permission: 'task.read', salesField: true },
  { id: 'product', label: 'Products', permission: 'product.read', salesField: true },
  { id: 'equipment', label: 'Installed Equipment', permission: 'equipment.read', salesField: true },
  { id: 'quotation', label: 'Quotations', permission: 'quotation.read', salesField: true },
  { id: 'financial_reference', label: 'Sales Orders', permission: 'financial_reference.read', salesField: true },
  { id: 'demo', label: 'Demonstrations', permission: 'demo.read', salesField: true },
  { id: 'distributors', label: 'Distributors', permission: 'account.read' },
  { id: 'tenders', label: 'Tenders' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'target', label: 'Sales Targets', permission: 'target.read', salesField: true },
  { id: 'reports', label: 'Reports', permission: 'lead.read' },
  { id: 'administration', label: 'Administration', permission: 'staff.directory.read' },
  { id: 'settings', label: 'Settings' },
];
const navigationPermissions = navigation.flatMap(item => item.permission ? [item.permission] : []);

export function IntakeWorkspace({ db, memberships, signOut, busy }: {
  db: SupabaseClient<Database>; memberships: OrganizationMembership[]; signOut: () => void; busy: boolean;
}) {
  const [organization, selectOrganization] = useState(memberships[0].organization_id);
  const [screen, setScreen] = useState<Screen>('home');
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [initialName, setInitialName] = useState('');
  const [initialView, setInitialView] = useState<LeadView>('all');
  const [dark, setDark] = useState(() => localStorage.getItem('salesconnect-color-mode') === 'dark');
  const [access, setAccess] = useState<{ organization: string; permissions: Set<string>; settings: boolean }>();
  const current = memberships.find(member => member.organization_id === organization);
  const permissions = access?.organization === organization ? access.permissions : undefined;
  const canViewAdministration = permissions?.has('staff.directory.read');
  const canViewSettings = access?.organization === organization && access.settings;
  const canUseSearch = permissions?.has('account.read') || permissions?.has('lead.read');
  useEffect(() => {
    let current = true;
    void Promise.all([
      db.from('role_permissions').select('permission_code').eq('organization_id', organization)
        .in('permission_code', [...navigationPermissions, 'lead.create']),
      db.from('roles').select('id').eq('organization_id', organization).eq('code', 'super_admin').limit(1),
    ]).then(([grants, role]) => {
      if (current) setAccess({ organization, permissions: new Set((grants.data ?? []).map(row => row.permission_code)),
        settings: !role.error && Boolean(role.data?.length) });
    });
    return () => { current = false; };
  }, [db, organization]);

  function go(destination: Screen, name = '', view: LeadView = 'all') {
    setScreen(destination);
    setSearchTerm('');
    setInitialName(name);
    setInitialView(view);
    setNavigationOpen(false);
  }
  const selected = navigation.find(item => item.id === screen);
  const title = searchTerm ? 'Search' : selected?.label;
  return <div className="sales-shell" data-theme={dark ? 'dark' : 'light'} data-nav-open={navigationOpen} data-collapsed={collapsed}>
    <a className="skip-link" href="#workspace-content">Skip to content</a>
    <aside className="sales-sidebar" id="sales-navigation">
      <div className="sales-brand"><span className="sales-mark" aria-hidden="true">AVI</span>
        <div><strong>AVI SalesConnect</strong><span>AVI Healthcare Pvt. Ltd.</span></div>
      </div>
      <nav aria-label="SalesConnect">
        {navigation.filter(item => (item.id !== 'settings' || canViewSettings)
          && (!item.permission || permissions?.has(item.permission))).map(item =>
          <button key={item.id} aria-current={!searchTerm && item.id === screen ? 'page' : undefined}
            onClick={() => go(item.id)}>{item.label}</button>)}
      </nav>
    </aside>
    <div className="sales-main">
      <header className="sales-header">
        <button className="secondary sales-toggle" aria-expanded={navigationOpen} aria-controls="sales-navigation"
          onClick={() => setNavigationOpen(value => !value)}>Menu</button>
        <button className="secondary desktop-nav-toggle" aria-expanded={!collapsed} aria-controls="sales-navigation"
          onClick={() => setCollapsed(value => !value)}>{collapsed ? 'Show navigation' : 'Hide navigation'}</button>
        <div className="breadcrumb"><button type="button" className="link" onClick={() => go('home')}>AVI SalesConnect</button>
          <span aria-hidden="true">›</span><strong>{title}</strong></div>
        {canUseSearch && <form className="global-search" onSubmit={event => {
          event.preventDefault(); setSearchTerm(searchText.trim()); setNavigationOpen(false);
        }}>
          <input type="search" aria-label="Search hospitals and leads" maxLength={140} placeholder="Search hospitals and leads"
            value={searchText} onChange={event => setSearchText(event.target.value)} />
          <button className="secondary" disabled={!searchText.trim()}>Search</button>
        </form>}
        <div className="sales-actions">
          {memberships.length > 1 ? <select aria-label="Organization" value={organization}
            onChange={event => { selectOrganization(event.target.value); go('home'); }}>
            {memberships.map(member => <option key={member.id} value={member.organization_id}>{member.organizations?.name ?? 'Organization'}</option>)}
          </select> : <span className="active-organization">{current?.organizations?.name}</span>}
          <button className="secondary" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => {
            setDark(!dark); localStorage.setItem('salesconnect-color-mode', dark ? 'light' : 'dark');
          }}>{dark ? 'Light' : 'Dark'}</button>
          <button className="secondary" onClick={signOut} disabled={busy}>Sign out</button>
        </div>
      </header>
      <main className="sales-content" id="workspace-content" tabIndex={-1}>
        {searchTerm ? <RecordSearch key={organization + searchTerm} db={db} organization={organization} term={searchTerm} open={go} /> : <>
        {screen === 'home' && <Dashboard key={organization} db={db} organization={organization} permissions={permissions}
          openLeads={() => go('leads')} openActiveLeads={() => go('leads', '', 'active')}
          openOverdueLeads={() => go('leads', '', 'overdue')}
          openAccounts={() => go('accounts')} openOpportunities={() => go('opportunities')} />}
        {screen === 'administration' && canViewAdministration && <StaffAdministration key={organization} db={db} organization={organization} />}
        {screen === 'settings' && canViewSettings && <PolicySettings key={organization} db={db} organization={organization} />}
        {screen === 'tenders' && current && <Tenders key={organization} db={db} organization={organization} membership={current.id} />}
        {screen === 'expenses' && current && <Expenses key={organization} db={db} organization={organization} membership={current.id} />}
        {screen === 'reports' && permissions?.has('lead.read') && <Reports key={organization}
          db={db} organization={organization} canReadOpportunities={permissions.has('opportunity.read')} />}
        {selected?.salesField && selected.permission && permissions?.has(selected.permission)
          && <SalesField key={organization + screen} db={db} organization={organization} kind={screen as SalesFieldKind} />}
        {screen === 'opportunities' && <><h1>{title}</h1><OpportunityList key={organization} db={db} organization={organization} /></>}
        {screen === 'leads' && permissions?.has('lead.read') && <LeadWorkspace
          key={organization+initialName+initialView} db={db} organization={organization} initialName={initialName} initialView={initialView} />}
        {(screen === 'accounts' || screen === 'distributors') && <>
          <h1>{title}</h1><Accounts key={organization+screen+initialName} db={db} organization={organization}
            membership={current?.id} distributors={screen==='distributors'} initialName={initialName} />
        </>}
        </>}
      </main>
    </div>
  </div>;
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
