import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../../packages/domain/database.types';
import { LeadImport } from './LeadImport';
import { LeadDialog, LeadEditor } from './LeadEditor';
import { LeadDetailView, StageChange } from './LeadDetailView';
import { LeadSettings } from './LeadSettings';
import { commandError, dateTime, label, money, priorities, readFields, type LeadDetail, type LeadRow, type Workspace } from './leadModel';

const views = [
  ['all','All Leads'], ['mine','My Leads'], ['team','Team Leads'], ['unassigned','Unassigned Leads'], ['new','New Leads'],
  ['hot','Hot Leads'], ['active','Active Leads'], ['overdue','Overdue Follow-ups'], ['inactive','Inactive Leads'], ['won','Won Leads'],
  ['lost','Lost Leads'], ['escalated','Response Escalations'],
];
type Display = 'table' | 'kanban' | 'split';
type Filters = { view:string; source:string; stage:string; priority:string; owner:string; territory:string; sort:string; mode:Display };
type SavedView = { id:string; name:string; filters:Filters };
type ViewPreferences = { saved:SavedView[]; pinned:string };
type QuickAction = 'edit' | 'call' | 'stage';
const baseFilters: Filters = { view:'all',source:'',stage:'',priority:'',owner:'',territory:'',sort:'newest',mode:'table' };
function getPreferences(key:string):ViewPreferences {
  try {
    const stored=JSON.parse(localStorage.getItem(key) ?? 'null') as ViewPreferences | null;
    if(stored && Array.isArray(stored.saved) && typeof stored.pinned==='string') {
      const saved=stored.saved.filter(item=>item && typeof item.id==='string' && typeof item.name==='string'
        && item.filters && ['table','kanban','split'].includes(item.filters.mode)
        && Object.keys(baseFilters).every(field=>typeof item.filters[field as keyof Filters]==='string'));
      return {saved,pinned:stored.pinned};
    }
  } catch { /* Unavailable browser preferences do not prevent using Leads. */ }
  return {saved:[],pinned:''};
}

type ExportFormat = 'csv' | 'excel';

function downloadReport(records: LeadRow[], format: ExportFormat, workspace: Workspace) {
  const columns = ['Lead number','Hospital or organisation','City','State','Source','Contact person','Designation','Mobile','Email','Products','Salesperson',
    'Territory','Expected value (INR)','Stage','Priority','Received','Follow-up','First response overdue'];
  const rows = [columns,...records.map(row => [row.number,row.customer,row.city,row.state,label(workspace,'source',row.source),row.contact,row.designation,
    row.mobile,row.email,row.products,row.owner_name,row.territory_name,row.value,label(workspace,'stage',row.stage),row.priority,
    row.received_at,row.follow_up,row.first_response_overdue?'Yes':'No'])];
  const csv = (value: string | null) => {
    const text = value ?? '';
    return '"' + (/^[\x00-\x20]*[=+\-@]|^[\t\r\n]/.test(text) ? "'" : '') + text.replaceAll('"','""') + '"';
  };
  const xml = (value: string | null) => (value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const content = format==='csv' ? '\uFEFF'+rows.map(row => row.map(csv).join(',')).join('\r\n')
    : '<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>'+
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Leads"><Table>'+
      rows.map(row => '<Row>'+row.map(cell=>'<Cell><Data ss:Type="String">'+xml(cell)+'</Data></Cell>').join('')+'</Row>').join('')+
      '</Table></Worksheet></Workbook>';
  const url=URL.createObjectURL(new Blob([content],{type:format==='csv'?'text/csv;charset=utf-8':'application/vnd.ms-excel'}));
  const anchor=document.createElement('a');
  anchor.href=url;
  anchor.download=format==='csv'?'salesconnect-leads.csv':'salesconnect-leads.xml';
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url),1000);
}

export function LeadWorkspace({ db, organization, membership, canEditOwn, canConvertOwn, initialName, initialView }: {
  db: SupabaseClient<Database>; organization: string; membership:string; canEditOwn:boolean; canConvertOwn:boolean; initialName: string; initialView: string;
}) {
  const preferenceKey=`avi-lead-views:${organization}:${membership}`;
  const [preferences,setPreferences]=useState(()=>getPreferences(preferenceKey));
  const pinned=preferences.saved.find(item=>item.id===preferences.pinned);
  const usePinned=initialView==='all'&&!initialName;
  const initialFilters=usePinned?pinned?.filters:undefined;
  const [activeSaved,setActiveSaved]=useState(usePinned?pinned?.id ?? '':'');
  const [search, setSearch]=useState(initialName);
  const [view, setView]=useState(initialFilters?.view ?? initialView);
  const [source,setSource]=useState(initialFilters?.source ?? '');
  const [stage,setStage]=useState(initialFilters?.stage ?? '');
  const [priority,setPriority]=useState(initialFilters?.priority ?? '');
  const [territory,setTerritory]=useState(initialFilters?.territory ?? '');
  const [owner,setOwner]=useState(initialFilters?.owner ?? '');
  const [sort,setSort]=useState(initialFilters?.sort ?? 'newest');
  const [mode,setMode]=useState<Display>(initialFilters?.mode ?? 'table');
  const [filtersOpen,setFiltersOpen]=useState(false);
  const [stageChoice,setStageChoice]=useState('');
  const [startCall,setStartCall]=useState(false);
  const [movingCard,setMovingCard]=useState(false);
  const [page,setPage]=useState(0);
  const [selected,setSelected]=useState<LeadRow[]>([]);
  const [listing,setListing]=useState<Workspace>();
  const [detail,setDetail]=useState<LeadDetail>();
  const [leadId,openLead]=useState<string>();
  const [tab,setTab]=useState('Overview');
  const [dialog,setDialog]=useState<'create'|'edit'|'stage'|'assignment'|'save-view'>();
  const [controls,setControls]=useState<'settings'|'notifications'>();
  const [notificationError,setNotificationError]=useState('');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [listError,setListError]=useState('');
  const [detailError,setDetailError]=useState('');
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [revision,refresh]=useState(0);
  const retries=useRef(new Map<string,string>());
  const pending=useRef(false);
  const pageSize=mode==='kanban'?100:25;
  const filters={view,source,stage,priority,owner,territory,sort,mode};
  const query={search:search.trim(),...filters,offset:page*pageSize};

  useEffect(() => {
    let active=true;
    setLoading(true);
    setListError('');
    const timer=window.setTimeout(() => {
      void db.rpc('read_lead_management',{p_org:organization,p_query:{search:search.trim(),view,source,stage,priority,owner,territory,sort,mode,offset:page*pageSize}}).then(result => {
        if (!active) return;
        setLoading(false);
        if (result.error) setListError('Unable to load leads.');
        else setListing(result.data as unknown as Workspace);
      },() => { if (active) { setLoading(false);setListError('Unable to load leads.'); } });
    },120);
    return () => { active=false;window.clearTimeout(timer); };
  },[db,organization,search,view,source,stage,priority,owner,territory,sort,mode,page,pageSize,revision]);

  useEffect(() => {
    if (!leadId) return;
    let current=true;
    setDetailError('');
    void db.rpc('read_lead_management',{p_org:organization,p_id:leadId}).then(result => {
      if (!current) return;
      if (result.error) setDetailError(result.error.code==='PT404'?'This lead is no longer available to you.':'Unable to load this lead.');
      else setDetail(result.data as unknown as LeadDetail);
    },() => { if (current) setDetailError('Unable to load this lead.'); });
    return () => { current=false; };
  },[db,organization,leadId,revision]);

  useEffect(() => {
    const interval=window.setInterval(() => { if (!pending.current && !document.hidden) refresh(value=>value+1); },60000);
    return () => window.clearInterval(interval);
  },[]);
  function open(id: string, destination='Overview') {
    if(leadId!==id) {setDetail(undefined);setDetailError('');openLead(id);}
    else if(detailError) refresh(value=>value+1);
    setStartCall(false);setTab(destination);setError('');setMessage('');setControls(undefined);
  }
  function clearInFlight() { if(movingCard) openLead(undefined);setMovingCard(false);setDialog(undefined);setError(''); }
  function filter<T extends string>(set: (next:T) => void, next:T) { set(next);setPage(0);setSelected([]);setActiveSaved('');if(mode==='split')openLead(undefined); }
  function applyFilters(next:Filters) {
    setView(next.view);setSource(next.source);setStage(next.stage);setPriority(next.priority);
    setOwner(next.owner);setTerritory(next.territory);setSort(next.sort);setMode(next.mode);
    setPage(0);setSelected([]);
  }
  function chooseView(id:string) {
    const saved=preferences.saved.find(item=>item.id===id);
    applyFilters(saved?.filters ?? {...baseFilters,mode,view:id});
    setSearch('');setActiveSaved(saved?.id ?? '');openLead(undefined);
  }
  function savePreferences(next:ViewPreferences) {
    try {
      localStorage.setItem(preferenceKey,JSON.stringify(next));
      setPreferences(next);
      return true;
    } catch {
      setError('This browser could not save your lead view.');
      return false;
    }
  }
  function saveView(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name=readFields(event.currentTarget).name;
    if(!name) return;
    if(preferences.saved.some(item=>item.name.toLowerCase()===name.toLowerCase())) {
      setError('Choose a different name for this view.');return;
    }
    const item={id:crypto.randomUUID(),name,filters};
    if(savePreferences({...preferences,saved:[...preferences.saved,item]})) {
      setActiveSaved(item.id);setDialog(undefined);announce('Lead view saved on this browser.');
    }
  }
  function changeStage(code='') { setStageChoice(code);setDialog('stage');setError(''); }
  function quick(row:LeadRow,action:QuickAction,code='') {
    open(row.id,action==='call'?'Activity Timeline':'Overview');
    if(action==='edit') setDialog('edit');
    if(action==='call') setStartCall(true);
    if(action==='stage') {setMovingCard(mode==='kanban');changeStage(code);}
  }
  function toggle(row: LeadRow) {
    setSelected(previous=>previous.some(item=>item.id===row.id)?previous.filter(item=>item.id!==row.id):[...previous,row]);
  }
  function announce(text: string) { setError('');setMessage(text); }
  async function command(action: string,input: Json) {
    const request=JSON.stringify([action,input]);
    const key=retries.current.get(request) ?? crypto.randomUUID();
    retries.current.set(request,key);
    const {data,error}=await db.rpc('command_lead_management',{p_org:organization,p_action:action,p_key:key,p_input:input});
    if (error) throw new Error(commandError(error));
    retries.current.delete(request);
    return data;
  }
  async function mutate(action: string,input: Json) {
    if (action==='refresh') { refresh(value=>value+1); return true; }
    if (pending.current) return false;
    pending.current=true;setBusy(true);setError('');setMessage('');
    try {
      await command(action,input);
      refresh(value=>value+1);
      announce(action==='merge'?'Duplicate merged. Original inquiry and activity preserved.':action==='assign'?'Lead assignment saved.':'Saved.');
      return true;
    } catch (failure) {
      setError(failure instanceof Error?failure.message:commandError(null));return false;
    } finally { pending.current=false;setBusy(false); }
  }
  async function saveEditor(input: Json) {
    if (pending.current || !input || typeof input!=='object' || Array.isArray(input)) return;
    const action=dialog==='create'?'create':'edit';
    pending.current=true;setBusy(true);setError('');setMessage('');
    try {
      const {open_documents:openDocuments,...record}=input;
      const result=await command(action,record) as {id:string;number:string};
      setDialog(undefined);refresh(value=>value+1);
      if (action==='create') open(result.id,openDocuments?'Documents':'Overview');
      else if (openDocuments) setTab('Documents');
      announce(`${result.number} saved.`);
    } catch (failure) { setError(failure instanceof Error?failure.message:commandError(null)); }
    finally { pending.current=false;setBusy(false); }
  }
  async function mark(notice: Workspace['notifications'][number]) {
    setNotificationError('');
    if (!notice.read_at) {
      try { await command('read_notice',{id:notice.id});refresh(value=>value+1); }
      catch { setNotificationError('Unable to mark the notification as read.'); }
    }
    if (notice.message.includes('allocated')) open(notice.lead_id);
  }
  async function exportRows(format: ExportFormat) {
    if (pending.current || !listing) return;
    pending.current=true;setBusy(true);setError('');setMessage('');
    try {
      const result=await command('export',{query:{...query,offset:0},format}) as {rows:LeadRow[];total:number};
      if (result.rows.length<result.total) throw new Error('Apply additional filters to export up to 5,000 leads.');
      downloadReport(result.rows,format,listing);
      announce(`${result.rows.length} lead records exported.`);
    } catch (failure) { setError(failure instanceof Error?failure.message:commandError(null)); }
    finally { pending.current=false;setBusy(false); }
  }
  function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input=readFields(event.currentTarget);
    void mutate('assign',{reason:input.reason,member:input.owner==='territory'?'':input.owner,
      routing:input.owner==='territory'?'territory':'manual',rows:selected.map(({id,version})=>({id,version}))})
      .then(success=>{ if (success) {setDialog(undefined);setSelected([]);} });
  }

  const unread=listing?.notifications.filter(item=>!item.read_at).length ?? 0;
  const activeDetail=detail?.data.id===leadId?detail:undefined;
  const selectedView=preferences.saved.find(item=>item.id===activeSaved);
  const editable=(row:LeadRow)=>Boolean(listing?.can_manage||(canEditOwn&&row.owner===membership));
  const detailPane=leadId ? detailError ? <p role="alert">{detailError} <button className="link" onClick={()=>openLead(undefined)}>Back to leads</button></p>
    : listing && activeDetail ? <LeadDetailView key={activeDetail.data.id} db={db} organization={organization} lead={activeDetail}
      workspace={listing} tab={tab} setTab={setTab} back={()=>{openLead(undefined);setError('');setMessage('');}}
      edit={()=>{setDialog('edit');setError('');}} changeStage={changeStage} mutate={mutate} busy={busy} error={error} startCall={startCall} canConvert={canConvertOwn&&activeDetail.owner===membership} />
    : <p role="status">Loading lead…</p> : null;
  return <div className="lead-workspace avi-lead-console">
    {(!leadId||mode==='split'||movingCard) && <div className="page-heading avi-lead-hero"><div><h1>Hospital &amp; Institutional Leads</h1></div>
      <div className="lead-actions">
        {listing?.can_settings && <button className="secondary" type="button" aria-expanded={controls==='settings'}
          onClick={() => {setControls(controls==='settings'?undefined:'settings');setError('');}}>Lead Settings</button>}
        <button className="secondary" type="button" aria-expanded={controls==='notifications'} onClick={() => setControls(controls==='notifications'?undefined:'notifications')}>
          Notifications{unread>0 && ` (${unread})`}</button>
        {listing?.can_create && <button type="button" onClick={()=>{setDialog('create');setError('');}}>＋ Add New Lead</button>}
      </div></div>}
    {message && <p role="status" className="lead-feedback">{message}</p>}
    {error && !dialog && <p role="alert" className="error lead-feedback">{error}</p>}
    {controls==='settings' && listing && <LeadSettings workspace={listing} mutate={mutate} busy={busy} />}
    {controls==='notifications' && listing && <section className="panel lead-notices">
      <h2>Lead Notifications</h2>
      {notificationError && <p role="alert">{notificationError}</p>}
      {listing.escalations>0 && <button className="secondary" type="button" onClick={()=>{filter(setView,'escalated');setControls(undefined);}}>
        {listing.escalations} first-response {listing.escalations===1?'deadline':'deadlines'} missed</button>}
      {listing.notifications.length>0 ? <ul className="records">{listing.notifications.map(item=><li key={item.id}>
        <button className={item.read_at?'link':'secondary'} onClick={()=>void mark(item)} type="button">
          {item.message}{!item.read_at && ' · New'}</button><p>{dateTime(item.created_at)}</p></li>)}</ul>
        : <p className="muted">No allocation notifications.</p>}
    </section>}
    {leadId && mode!=='split' && !movingCard ? detailPane : <>
      <section className="avi-lead-command" aria-label="Lead list controls">
        <div className="lead-toolbar">
          <div className="avi-lead-view">
            <label>Lead view<select value={activeSaved||view} onChange={event=>chooseView(event.target.value)}>
              <optgroup label="Standard views">{views.map(([key,value])=><option key={key} value={key}>{value}</option>)}</optgroup>
              {preferences.saved.length>0&&<optgroup label="My saved views">{preferences.saved.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>}
            </select></label>
            {listing&&!loading&&<span className="muted">{listing.total} {listing.total===1?'lead':'leads'}</span>}
          </div>
          <div className="lead-actions">
            <button className="secondary" type="button" disabled={preferences.saved.length>=20}
              onClick={()=>{setError('');setDialog('save-view');}}>Save View</button>
            {selectedView&&<button className="secondary" type="button" aria-pressed={preferences.pinned===selectedView.id}
              onClick={()=>savePreferences({...preferences,pinned:preferences.pinned===selectedView.id?'':selectedView.id})}>
              {preferences.pinned===selectedView.id?'Unpin Default':'Pin as Default'}</button>}
            {selectedView&&<button className="secondary" type="button" onClick={()=>{
              if(savePreferences({saved:preferences.saved.filter(item=>item.id!==selectedView.id),
                pinned:preferences.pinned===selectedView.id?'':preferences.pinned})) setActiveSaved('');
            }}>Remove Saved View</button>}
          </div>
        </div>
        <div className="avi-lead-display">
          <div className="lead-mode" aria-label="Lead presentation">
            {([['table','Table'],['kanban','Kanban Pipeline'],['split','Split View']] as const).map(([value,title])=>
              <button key={value} type="button" className="secondary" aria-pressed={mode===value} onClick={()=>{filter(setMode,value);openLead(undefined);}}>{title}</button>)}
          </div>
          <div className="lead-actions">
            <button className="secondary" type="button" onClick={()=>refresh(value=>value+1)}>Refresh</button>
            {listing?.can_export&&<>
              <button type="button" className="secondary" disabled={busy||loading||!!listError} onClick={()=>void exportRows('csv')}>Export CSV</button>
              <button type="button" className="secondary" disabled={busy||loading||!!listError} onClick={()=>void exportRows('excel')}>Export Excel</button>
            </>}
          </div>
        </div>
      </section>
      <div className="lead-filters">
        <label className="lead-search">Search leads<input type="search" maxLength={150} value={search} placeholder="Lead ID, hospital, contact, or equipment"
          onChange={event=>filter(setSearch,event.target.value)} /></label>
        <button className="secondary avi-lead-filter-button" type="button" aria-expanded={filtersOpen} aria-controls="avi-lead-filter-options"
          onClick={()=>setFiltersOpen(!filtersOpen)}>Filters{[source,stage,priority,owner,territory].filter(Boolean).length>0&&` (${[source,stage,priority,owner,territory].filter(Boolean).length})`}</button>
        <div id="avi-lead-filter-options" className="avi-lead-filter-options" hidden={!filtersOpen}>
        <label>Source<select value={source} onChange={event=>filter(setSource,event.target.value)}>
          <option value="">All sources</option>{listing?.catalog.filter(part=>part.kind==='source').map(part=><option key={part.code} value={part.code}>{part.label}</option>)}</select></label>
        <label>Stage<select value={stage} onChange={event=>filter(setStage,event.target.value)}>
          <option value="">All stages</option>{listing?.catalog.filter(part=>part.kind==='stage').map(part=><option key={part.code} value={part.code}>{part.label}</option>)}</select></label>
          <label>Priority<select value={priority} onChange={event=>filter(setPriority,event.target.value)}>
            <option value="">All priorities</option>{priorities.map(part=><option key={part}>{part}</option>)}</select></label>
          <label>Salesperson<select value={owner} onChange={event=>filter(setOwner,event.target.value)}>
            <option value="">All salespeople</option>{listing?.staff.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label>Territory<select value={territory} onChange={event=>filter(setTerritory,event.target.value)}>
            <option value="">All territories</option>{listing?.territories.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Sort by<select value={sort} onChange={event=>filter(setSort,event.target.value)}>
          <option value="newest">Newest inquiry</option><option value="oldest">Oldest inquiry</option>
          <option value="customer">Hospital name</option><option value="value">Highest value</option><option value="followup">Next follow-up</option>
        </select></label>
        <button className="secondary" type="button" onClick={()=>{applyFilters({...baseFilters,view,mode});setActiveSaved('');}}>Clear Filters</button>
        </div>
      </div>
      {selected.length>0 && <div className="lead-selection"><span>{selected.length} selected</span>
        <button type="button" onClick={()=>{setDialog('assignment');setError('');}}>Assign Selected</button>
        <button className="link" type="button" onClick={()=>setSelected([])}>Clear selection</button></div>}
      {listError ? <p role="alert">{listError} <button className="link" onClick={()=>refresh(value=>value+1)}>Retry</button></p>
        : !listing ? <p role="status">Loading leads…</p>
        : <div aria-busy={loading}>
          {listing.rows.length===0 ? <div className="panel lead-empty"><h2>{loading?'Loading leads…':'No leads match this view'}</h2>
            </div>
            : mode==='kanban' ? <Pipeline listing={listing} open={open} editable={editable} move={(row,code)=>quick(row,'stage',code)} />
            : mode==='split' ? <div className="avi-lead-split">
              <nav aria-label="Leads in this view" className="avi-lead-queue">{listing.rows.map(row=><button className="secondary" type="button" key={row.id}
                aria-current={leadId===row.id?'page':undefined} onClick={()=>open(row.id)}>
                <strong>{row.customer}</strong><small>{row.number} · {label(listing,'stage',row.stage)}</small>
                <small>{row.follow_up?`Follow-up ${dateTime(row.follow_up)}`:row.owner_name??'Unassigned'}</small>
              </button>)}</nav>
              <div className="avi-lead-record-pane">{detailPane??<p className="panel muted">Select a lead to view its details.</p>}</div>
            </div>
            : <LeadTable listing={listing} selected={selected} toggle={toggle} open={open} editable={editable} quick={quick} toggleAll={()=>
                setSelected(selected.length===listing.rows.length?[]:listing.rows)} />}
          {listing.total>0 && <div className="lead-pagination"><span>{page*pageSize+1}–{Math.min((page+1)*pageSize,listing.total)} of {listing.total} leads</span>
            <button className="secondary" disabled={page===0||loading} onClick={()=>{setSelected([]);setPage(value=>value-1);}}>Previous</button>
            <button className="secondary" disabled={(page+1)*pageSize>=listing.total||loading} onClick={()=>{setSelected([]);setPage(value=>value+1);}}>Next</button>
          </div>}
        </div>}
      {!leadId&&listing?.can_create && listing.catalog.some(item=>item.kind==='source'&&item.code==='csv'&&item.active) &&
        <LeadImport db={db} organization={organization} onSaved={()=>{setPage(0);refresh(value=>value+1);}} />}
    </>}
    {listing && (dialog==='create' || (dialog==='edit'&&activeDetail?.can_edit)) &&
      <LeadEditor key={dialog} workspace={listing} lead={dialog==='edit'?activeDetail:undefined} save={saveEditor} onClose={clearInFlight} busy={busy} error={error} />}
    {dialog==='stage'&&listing&&activeDetail?.can_edit && <StageChange workspace={listing} lead={activeDetail} initialStage={stageChoice} busy={busy} error={error} onClose={clearInFlight}
      save={async (action,input)=>{if(await mutate(action,input)) {if(movingCard) openLead(undefined);setMovingCard(false);setDialog(undefined);}}} />}
    {movingCard&&!activeDetail&&!detailError&&<p role="status">Loading selected lead…</p>}
    {movingCard&&(detailError||activeDetail&&!activeDetail.can_edit)&&<p role="alert">
      That lead cannot be moved. <button className="link" onClick={clearInFlight}>Dismiss</button></p>}
    {dialog==='save-view'&&<LeadDialog title="Save Lead View" onClose={clearInFlight}>
      <form className="lead-form" onSubmit={saveView}>
        <label>View name<input name="name" maxLength={60} required /></label>
        <p className="muted">Your filters, sort, and display are saved on this browser.</p>
        {error&&<p role="alert" className="error">{error}</p>}
        <div className="lead-form-actions"><button className="secondary" type="button" onClick={clearInFlight}>Cancel</button><button>Save View</button></div>
      </form></LeadDialog>}
    {dialog==='assignment'&&listing && <LeadDialog title="Assign Leads" onClose={clearInFlight}>
      <form className="lead-form" onSubmit={assign}>
        <p>{selected.length} selected {selected.length===1?'lead':'leads'}</p>
        <label>Assigned salesperson<select name="owner">
          <option value="">Leave unassigned</option><option value="territory">Route by territory</option>
          {listing.staff.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}
        </select></label>
        <label>Assignment reason<textarea name="reason" maxLength={1000} required /></label>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="lead-form-actions"><button className="secondary" type="button" onClick={clearInFlight}>Cancel</button>
          <button disabled={busy}>Save Assignment</button></div>
      </form></LeadDialog>}
  </div>;
}

function LeadTable({ listing, selected, toggle, toggleAll, open, editable, quick }: {
  listing:Workspace;selected:LeadRow[];toggle:(row:LeadRow)=>void;toggleAll:()=>void;open:(id:string)=>void;editable:(row:LeadRow)=>boolean;quick:(row:LeadRow,action:QuickAction)=>void;
}) {
  return <div className="table-scroll lead-table-frame"><table className="lead-table">
    <thead><tr>
      {listing.can_manage && <th scope="col"><input type="checkbox" aria-label="Select all leads on this page" checked={listing.rows.length===selected.length} onChange={toggleAll} /></th>}
      <th scope="col">Lead ID</th><th scope="col">Hospital / Organisation</th><th scope="col">Contact</th><th scope="col">Equipment Interest</th>
      <th scope="col">Assigned Rep</th><th scope="col">Est. Value</th><th scope="col">Stage &amp; Priority</th><th scope="col">Actions</th>
    </tr></thead>
    <tbody>{listing.rows.map(row=><tr key={row.id}>
      {listing.can_manage && <td><input type="checkbox" aria-label={`Select ${row.number}`} checked={selected.some(item=>item.id===row.id)} onChange={()=>toggle(row)} /></td>}
      <td><button className="link lead-number" onClick={()=>open(row.id)}>{row.number}</button></td>
      <td><button className="link lead-customer" onClick={()=>open(row.id)}>{row.customer}</button>
        <small>{[row.city,row.state].filter(Boolean).join(', ')}{(row.city||row.state)&&' · '}{label(listing,'source',row.source)}</small></td>
      <td>{row.contact ?? '—'}<small>{row.designation ?? row.email ?? row.mobile}</small></td>
      <td>{row.products ?? '—'}</td><td>{row.owner_name ?? 'Unassigned'}</td><td className="lead-value">{money(row.value)}</td>
      <td><div className="lead-tags"><span className="lead-badge" data-tone={row.behavior}>{label(listing,'stage',row.stage)}</span>
        <span className="lead-badge" data-tone={row.priority.toLowerCase()}>{row.priority}</span>
        {row.first_response_overdue && <span className="lead-badge" data-tone="lost">First response overdue</span>}</div></td>
      <td>{editable(row)?<details className="avi-lead-row-actions">
        <summary aria-label={`Actions for ${row.customer}`}>Actions</summary>
        <button className="link" onClick={()=>quick(row,'edit')}>Edit</button>
        <button className="link" onClick={()=>quick(row,'call')}>Log Call</button>
        {!['won','lost','closed'].includes(row.behavior)&&<button className="link" onClick={()=>quick(row,'stage')}>Change Stage</button>}
      </details>:<button className="link" onClick={()=>open(row.id)}>Open</button>}</td>
    </tr>)}</tbody>
  </table></div>;
}
function Pipeline({ listing, open, editable, move }: {
  listing:Workspace; open:(id:string)=>void; editable:(row:LeadRow)=>boolean; move:(row:LeadRow,code:string)=>void;
}) {
  const [dragged,setDragged]=useState<string>();
  const [target,setTarget]=useState<string>();
  const current=listing.rows.find(row=>row.id===dragged);
  const canMove=(row:LeadRow)=>editable(row)&&!['won','lost','closed'].includes(row.behavior);
  const stages=listing.catalog.filter(item=>item.kind==='stage'&&(item.active||listing.rows.some(row=>row.stage===item.code)));
  return <div className="lead-kanban" aria-label="Lead pipeline">
    {stages.map(stage=>{
      const rows=listing.rows.filter(row=>row.stage===stage.code);
      const accepts=Boolean(current&&stage.active&&current.stage!==stage.code&&canMove(current));
      return <section key={stage.code} aria-label={stage.label} data-drop-target={accepts&&target===stage.code}
        onDragOver={event=>{if(accepts){event.preventDefault();event.dataTransfer.dropEffect='move';setTarget(stage.code);}}}
        onDrop={event=>{
          if(!accepts||!current) return;
          event.preventDefault();setDragged(undefined);setTarget(undefined);move(current,stage.code);
        }}>
        <h2>{stage.label}<span title="Leads in this page">{rows.length}</span></h2>
        {rows.map(row=><div className="avi-lead-kanban-record" key={row.id} draggable={canMove(row)}
          onDragStart={event=>{if(canMove(row)){event.dataTransfer.setData('text/plain',row.id);event.dataTransfer.effectAllowed='move';setDragged(row.id);}}}
          onDragEnd={()=>{setDragged(undefined);setTarget(undefined);}}>
          <button className="secondary lead-card" onClick={()=>open(row.id)}>
            <span className="lead-number">{row.number}</span><strong>{row.customer}</strong><span>{row.products ?? label(listing,'source',row.source)}</span>
            <span className="lead-card-footer">{row.owner_name ?? 'Unassigned'}<strong>{money(row.value)}</strong></span>
            <span className="lead-badge" data-tone={row.priority.toLowerCase()}>{row.priority}</span>
          </button>
          {canMove(row)&&<button className="link avi-lead-move" onClick={()=>move(row,'')} aria-label={`Move ${row.customer} to another stage`}>Move stage</button>}
        </div>)}
      </section>;
    })}
  </div>;
}
