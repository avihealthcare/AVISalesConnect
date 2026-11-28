import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../../packages/domain/database.types';
import { StaffAdministration } from './StaffAdministration';
import { UserManagement } from './UserManagement';
import { CustomerWorkspace } from './CustomerWorkspace';
import { PolicySettings } from './PolicySettings';
import { LeadWorkspace } from './LeadWorkspace';
import { Reports } from './Reports';
import { Tenders } from './Tenders';
import { Expenses } from './Expenses';
import { Dashboard } from './Dashboard';
import { SalesField, type SalesFieldKind } from './SalesField';
import { AviIcon } from './AviIcon';
import type { LeadConsoleMetrics } from './leadModel';
import {userManagementEnabled} from './workspaceFeatures';
import { FieldOperations } from './FieldOperations';
import type { FieldKind } from './fieldModel';
import { RecordSearch } from './RecordSearch';

type Screen = 'home' | 'accounts' | 'leads' | 'opportunities' | 'administration' | 'settings' | 'distributors' | 'reports' | 'tenders' | 'expenses' | SalesFieldKind;
type LeadView = 'all' | 'active' | 'overdue';
type OrganizationMembership = { id: string; organization_id: string; organizations: { name: string } | null };

const navigation: { id: Screen; label: string; permission?: string; salesField?: boolean }[] = [
  { id: 'home', label: 'Dashboard' }, { id: 'leads', label: 'Leads', permission: 'lead.read' },
  { id: 'accounts', label: 'Customers', permission: 'account.read' },
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
  { id: 'tenders', label: 'Tenders' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'target', label: 'Sales Targets', permission: 'target.read', salesField: true },
  { id: 'reports', label: 'Reports', permission: 'lead.read' },
  { id: 'administration', label: 'User Management', permission: 'staff.directory.read' },
  { id: 'settings', label: 'Settings' },
];
const navigationGroups: { title?:string; ids:Screen[] }[] = [
  {title:'CRM & Pipeline',ids:['home','leads','accounts','opportunities']},
  {title:'Field Operations',ids:['attendance_session','visit','visit_plan','task']},
  {title:'Catalog & Sales',ids:['product','equipment','demo','quotation','financial_reference']},
  {ids:['tenders','expenses','target','reports']},
  {title:'Administration',ids:['administration','settings']},
];
const moduleForScreen:Partial<Record<Screen,string>>={
  home:'dashboard',accounts:'customers',leads:'leads',opportunities:'opportunities',attendance_session:'attendance',
  visit:'field_visits',visit_plan:'visit_planner',task:'follow_ups',product:'products',equipment:'equipment',quotation:'quotations',
  financial_reference:'orders',demo:'demonstrations',tenders:'tenders',expenses:'expenses',target:'targets',reports:'reports',
};

const routes:Partial<Record<Screen,string>>={home:'dashboard',accounts:'customers',contact:'contacts',site:'customer-sites',administration:'users',attendance_session:'attendance',visit_plan:'visit-planner',visit:'field-visits',task:'tasks'};
const fieldScreens = new Set<Screen>(['attendance_session','visit_plan','visit','task']);
function readRoute():{screen:Screen;customerTab:'accounts'|'site'|'contact';name:string} {
  const [,slug,detail]=window.location.pathname.split('/');
  const saved=navigation.find(item=>(routes[item.id]??item.id)===slug||item.id===slug)?.id ?? 'home';
  const customerTab=slug==='contacts'||detail==='contacts'?'contact':slug==='customer-sites'||detail==='sites'?'site':'accounts';
  return {screen:['hospitals','accounts','contacts','customer-sites','distributors'].includes(slug)?'accounts':saved,
    customerTab,name:(saved==='leads'||saved==='visit')&&detail&&/^[0-9a-f-]{36}$/i.test(detail)?detail:''};
}
function routePath(screen:Screen,name:string,destination:Screen) {
  if(screen==='accounts'&&(destination==='contact'||destination==='site'))return '/customers/'+(destination==='contact'?'contacts':'sites');
  return '/'+(routes[screen]??screen)+((screen==='leads'||screen==='visit')&&/^[0-9a-f-]{36}$/i.test(name)?'/'+name:'');
}

export function IntakeWorkspace({ db, memberships, signOut, busy }: {
  db: SupabaseClient<Database>; memberships: OrganizationMembership[]; signOut: () => void; busy: boolean;
}) {
  const [organization, selectOrganization] = useState(memberships[0].organization_id);
  const [screen, setScreen] = useState<Screen>(()=>readRoute().screen);
  const [customerTab,setCustomerTab]=useState<'accounts'|'site'|'contact'>(()=>readRoute().customerTab);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const searchInput=useRef<HTMLInputElement>(null);
  const [profile,setProfile]=useState('');
  const [notificationOpen,setNotificationOpen]=useState(false);
  const [summary,setSummary]=useState<{organization:string;data:LeadConsoleMetrics}>();
  const [summaryError,setSummaryError]=useState(false);
  const [summaryRevision,setSummaryRevision]=useState(0);
  const refreshSummary=useCallback(()=>setSummaryRevision(value=>value+1),[]);
  const [searchText, setSearchText] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [initialName, setInitialName] = useState(()=>readRoute().name);
  const [initialView, setInitialView] = useState<LeadView>('all');
  const [dark, setDark] = useState(() => localStorage.getItem('salesconnect-color-mode') === 'dark');
  const [access, setAccess] = useState<{ organization: string; permissions: Set<string>; modules:Set<string>; admin:boolean; userManagement:boolean }>();
  const current = memberships.find(member => member.organization_id === organization);
  const permissions = access?.organization === organization ? access.permissions : undefined;
  const canViewSettings = access?.organization === organization && access.admin;
  const canViewAdministration=canViewSettings;
  const [accessRevision,refreshAccess]=useState(0);
  const canUseSearch = permissions?.has('account.read') || permissions?.has('lead.read');
  useEffect(() => {
    let current = true;
    async function loadAccess() {
      const result=userManagementEnabled?await db.rpc('workspace_access',{p_org:organization}):undefined;
      if(!current)return;
      if(!result||result.error?.code==='PGRST202'){
        const [grants,roles]=await Promise.all([
          db.from('role_permissions').select('permission_code').eq('organization_id',organization),
          db.from('roles').select('id').eq('organization_id',organization).eq('code','super_admin').limit(1),
        ]);
        if(!current)return;
        const legacy=new Set((grants.data??[]).map(row=>row.permission_code));
        const modules=new Set(['dashboard','tenders','expenses']);
        for(const item of navigation){
          const slug=moduleForScreen[item.id];
          if(slug&&item.permission&&legacy.has(item.permission))modules.add(slug);
        }
        if(legacy.has('site.read')||legacy.has('contact.read'))modules.add('customers');
        setAccess({organization,permissions:legacy,modules,admin:!roles.error&&Boolean(roles.data?.length),userManagement:false});
        return;
      }
      if(result.error){setAccess({organization,permissions:new Set(),modules:new Set(),admin:false,userManagement:false});return;}
      const data=result.data as unknown as {admin:boolean;modules:string[];permissions:string[]};
      setAccess({organization,permissions:new Set(data.permissions),modules:new Set(data.modules),admin:data.admin,userManagement:true});
    }
    void loadAccess();
    return () => { current = false; };
  }, [db, organization,accessRevision]);

  useEffect(()=>{
    const check=()=>refreshAccess(value=>value+1);
    window.addEventListener('focus',check);
    return ()=>window.removeEventListener('focus',check);
  },[]);

  useEffect(()=>{
    let current=true;
    void db.from('profiles').select('display_name').limit(1).maybeSingle().then(({data})=>{
      if(current) setProfile(data?.display_name ?? '');
    });
    return ()=>{current=false;};
  },[db,organization]);
  useEffect(()=>{
    if(!permissions?.has('lead.read')) return;
    let current=true;
    setSummaryError(false);
    void db.rpc('read_lead_console',{p_org:organization}).then(result=>{
      if(!current) return;
      if(result.error) setSummaryError(true);
      else setSummary({organization,data:result.data as unknown as LeadConsoleMetrics});
    });
    return ()=>{current=false;};
  },[db,organization,permissions,summaryRevision]);
  useEffect(()=>{
    const interval=window.setInterval(()=>{if(!document.hidden) refreshSummary();},60000);
    const shortcut=(event:KeyboardEvent)=>{
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'&&searchInput.current&&!document.querySelector('dialog[open]')) {
        event.preventDefault();searchInput.current.focus();
      }
    };
    document.addEventListener('keydown',shortcut);
    return ()=>{window.clearInterval(interval);document.removeEventListener('keydown',shortcut);};
  },[refreshSummary]);
  const consoleMetrics=summary?.organization===organization?summary.data:undefined;
  const initials=profile.trim().split(/\s+/).slice(0,2).map(item=>item.charAt(0).toUpperCase()).join('') || 'AV';

  function go(destination: Screen, name = '', view: LeadView = 'all') {
    const customerSection=destination==='contact'||destination==='site'||destination==='distributors';
    const next=customerSection?'accounts':destination;
    setCustomerTab(destination==='contact'||destination==='site'?destination:'accounts');
    const path=routePath(next,name,destination);
    if(window.location.pathname!==path)window.history.pushState(null,'',path);
    setScreen(next);setNotificationOpen(false);
    setSearchTerm('');
    setInitialName(name);
    setInitialView(view);
    setNavigationOpen(false);
  }
  useEffect(()=>{
    const restore=()=>{const route=readRoute();setScreen(route.screen);setCustomerTab(route.customerTab);
      setInitialName(route.name);setInitialView('all');setSearchTerm('');setNavigationOpen(false);};
    window.addEventListener('popstate',restore);
    return ()=>window.removeEventListener('popstate',restore);
  },[]);
  const selected = navigation.find(item => item.id === screen);
  const allowed=(item:typeof navigation[number])=>{
    if(item.id==='administration'||item.id==='settings')return Boolean(canViewSettings);
    if(!access||access.organization!==organization)return item.id==='home';
    if(access.admin)return true;
    const slug=moduleForScreen[item.id];
    return Boolean(slug&&access.modules.has(slug));
  };
  const restricted=Boolean(selected&&permissions&&!allowed(selected));
  const labelFor=(item:typeof navigation[number])=>item.id==='administration'&&!access?.userManagement?'Administration':item.label;
  const title = searchTerm ? 'Search' : selected ? labelFor(selected) : '';
  return <div className="sales-shell" data-theme={dark ? 'dark' : 'light'} data-nav-open={navigationOpen} data-collapsed={collapsed}>
    <a className="skip-link" href="#workspace-content">Skip to content</a>
    <aside className="sales-sidebar" id="sales-navigation">
      <div className="sales-brand"><span className="sales-mark" aria-hidden="true">AVI</span>
        <div><strong>AVI SalesConnect</strong><span>AVI Healthcare Pvt. Ltd.</span></div>
      </div>
      <nav aria-label="SalesConnect">
        {navigationGroups.map(group=>{
          const items=group.ids.map(id=>navigation.find(item=>item.id===id)!)
            .filter(allowed);
          return items.length>0&&<div className="sales-nav-section" key={group.title??'remaining'}>
            {group.title&&<p className="sales-nav-heading">{group.title}</p>}
            {items.map(item=><button key={item.id} aria-current={!searchTerm&&item.id===screen?'page':undefined}
              onClick={()=>go(item.id)}>{item.id==='accounts'&&<AviIcon name="building"/>}{labelFor(item)}</button>)}
          </div>;
        })}
      </nav>
    </aside>
    <div className="sales-main">
      <header className="sales-header avi-global-bar">
        <button className="secondary sales-toggle avi-icon-button" type="button" aria-label="Menu" aria-expanded={navigationOpen} aria-controls="sales-navigation"
          onClick={()=>setNavigationOpen(value=>!value)}><AviIcon name="sidebar" size={18}/></button>
        <button className="secondary desktop-nav-toggle avi-icon-button" type="button" aria-label={collapsed?'Show navigation':'Hide navigation'}
          aria-expanded={!collapsed} aria-controls="sales-navigation" onClick={()=>setCollapsed(value=>!value)}><AviIcon name="sidebar" size={18}/></button>
        <div className="breadcrumb"><button type="button" className="link" onClick={()=>go('home')}>AVI SalesConnect</button>
          <span aria-hidden="true">›</span><strong>{title}</strong></div>
        {canUseSearch&&<form className="global-search avi-global-search" onSubmit={event=>{
          event.preventDefault();setSearchTerm(searchText.trim());setNavigationOpen(false);setNotificationOpen(false);
        }}>
          <button type="submit" className="secondary avi-icon-button" aria-label="Search" disabled={!searchText.trim()}><AviIcon name="search"/></button>
          <input ref={searchInput} type="search" aria-label="Search hospitals and leads" maxLength={140} placeholder="Search hospitals, leads…"
            value={searchText} onChange={event=>setSearchText(event.target.value)}/>
          <kbd title="Focus search with Command+K or Control+K">⌘K</kbd>
        </form>}
        <div className="sales-actions">
          {permissions?.has('lead.read')&&<button className="secondary avi-icon-button avi-bell" aria-label="Notifications"
            aria-expanded={notificationOpen} onClick={()=>{
              if(screen!=='leads'||searchTerm) {go('leads');setNotificationOpen(true);}
              else setNotificationOpen(value=>!value);
            }}><AviIcon name="bell" size={18}/>{Boolean(consoleMetrics?.unread)&&<span className="avi-unread"><span className="avi-sr-only">Unread notifications</span></span>}</button>}
          <button className="secondary avi-icon-button" aria-label={dark?'Switch to light mode':'Switch to dark mode'} onClick={()=>{
            setDark(!dark);localStorage.setItem('salesconnect-color-mode',dark?'light':'dark');
          }}><AviIcon name={dark?'sun':'moon'} size={18}/></button>
          <details className="avi-profile-menu">
            <summary aria-label="User profile"><span>{initials}</span><AviIcon name="chevron" size={13}/></summary>
            <div><strong>{profile||'Signed-in user'}</strong><small>{current?.organizations?.name}</small>
          {memberships.length>1&&<select aria-label="Organization" value={organization} onChange={event=>{selectOrganization(event.target.value);go('home');}}>
            {memberships.map(member=><option key={member.id} value={member.organization_id}>{member.organizations?.name ?? 'Organization'}</option>)}
          </select>}
              <button className="secondary" onClick={signOut} disabled={busy}>Sign out</button></div>
          </details>
        </div>
      </header>
      <main className="sales-content" id="workspace-content" tabIndex={-1}>
        {!permissions&&screen!=='home' ? <p role="status">Checking module access…</p> : restricted&&!searchTerm ? <section className="panel"><h1>Access Restricted</h1><p>Contact your administrator for access to this module.</p>{access?.modules.has('dashboard')&&<button onClick={()=>go('home')}>Go to Dashboard</button>}</section> : searchTerm ? <RecordSearch key={organization + searchTerm} db={db} organization={organization} term={searchTerm} open={go} /> : <>
        {screen === 'home' && <Dashboard key={organization} db={db} organization={organization} permissions={permissions}
          openLeads={() => go('leads')} openActiveLeads={() => go('leads', '', 'active')}
          openOverdueLeads={() => go('leads', '', 'overdue')}
          openAccounts={() => go('accounts')} openOpportunities={() => go('opportunities')} />}
        {screen==='administration'&&canViewAdministration&&(access?.userManagement
          ? <UserManagement key={organization} db={db} organization={organization} onChanged={()=>refreshAccess(value=>value+1)}/>
          : <StaffAdministration key={organization} db={db} organization={organization}/>)}
        {screen === 'settings' && canViewSettings && <PolicySettings key={organization} db={db} organization={organization} />}
        {screen === 'tenders' && current && <Tenders key={organization} db={db} organization={organization} membership={current.id} />}
        {screen === 'expenses' && current && <Expenses key={organization} db={db} organization={organization} membership={current.id} />}
        {screen==='reports'&&permissions&&(permissions.has('lead.read')||permissions.has('opportunity.read') ?
          <Reports key={organization} db={db} organization={organization} canReadLeads={permissions.has('lead.read')}
            canReadOpportunities={permissions.has('opportunity.read')}/>:
          <section className="panel"><h1>Reports</h1><p>Your lead and opportunity permissions determine which reports are available.</p></section>)}
        {selected?.salesField && selected.permission && permissions?.has(selected.permission)
          && (fieldScreens.has(screen) ? <FieldOperations key={organization+screen+initialName} db={db} org={organization}
            kind={screen as FieldKind} initialPlan={screen==='visit'?initialName:undefined} onPlan={id=>go('visit',id)} openLead={id=>go('leads',id)}/>
            : <SalesField key={organization + screen} db={db} organization={organization} kind={screen as SalesFieldKind} />)}
        {screen === 'opportunities' && <><h1>{title}</h1><OpportunityList key={organization} db={db} organization={organization} /></>}
        {screen === 'leads' && current && permissions?.has('lead.read') && <LeadWorkspace
          key={organization+initialName+initialView} db={db} organization={organization} membership={current.id} canEditOwn={permissions.has('lead.contact')} canConvertOwn={permissions.has('lead.convert')} metrics={consoleMetrics} metricsError={summaryError} refreshMetrics={refreshSummary} notificationsOpen={notificationOpen} closeNotifications={()=>setNotificationOpen(false)} initialName={initialName} initialView={initialView} />}
        {screen==='accounts'&&permissions&&<section aria-label="Customers">
          <nav className="lead-detail-tabs" aria-label="Customer workspace">
            {([['accounts','Accounts','account.read'],['site','Sites & Branches','site.read'],['contact','Contacts','contact.read']] as const)
              .filter(([, , permission])=>permissions.has(permission)).map(([id,label])=>
                <button key={id} type="button" className="secondary" aria-current={customerTab===id?'page':undefined}
                  onClick={()=>go(id)}>{label}</button>)}
          </nav>
          {(customerTab==='site'||!permissions.has('account.read')&&!permissions.has('contact.read'))&&permissions.has('site.read') ?
            <SalesField key={organization+'site'} db={db} organization={organization} kind="site"/>
          : customerTab==='contact'&&permissions.has('contact.read')||!permissions.has('account.read') ?
            <CustomerWorkspace key={organization+'contact'+initialName} db={db} organization={organization} initialName={initialName}
              mode="contacts" openLead={reference=>go('leads',reference)}/>
          : <CustomerWorkspace key={organization+initialName} db={db} organization={organization} initialName={initialName} mode="accounts"
              canAssign={permissions.has('lead.create')&&permissions.has('lead.read')} canManageLeads={permissions.has('lead.manage')}
              canAddSite={permissions.has('site.create')&&permissions.has('site.read')}
              membership={current?.id} openLead={reference=>go('leads',reference)}/>}
        </section>}
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
