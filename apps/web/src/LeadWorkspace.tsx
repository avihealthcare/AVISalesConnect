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

export function LeadWorkspace({ db, organization, initialName, initialView }: {
  db: SupabaseClient<Database>; organization: string; initialName: string; initialView: string;
}) {
  const [search, setSearch]=useState(initialName);
  const [view, setView]=useState(initialView);
  const [source,setSource]=useState('');
  const [stage,setStage]=useState('');
  const [priority,setPriority]=useState('');
  const [territory,setTerritory]=useState('');
  const [owner,setOwner]=useState('');
  const [sort,setSort]=useState('newest');
  const [mode,setMode]=useState('table');
  const [page,setPage]=useState(0);
  const [selected,setSelected]=useState<LeadRow[]>([]);
  const [listing,setListing]=useState<Workspace>();
  const [detail,setDetail]=useState<LeadDetail>();
  const [leadId,openLead]=useState<string>();
  const [tab,setTab]=useState('Overview');
  const [dialog,setDialog]=useState<'create'|'edit'|'stage'|'assignment'>();
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
  const query={search:search.trim(),view,source,stage,priority,owner,territory,sort,mode,offset:page*pageSize};

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
    setTab(destination);setDetail(undefined);setDetailError('');setError('');setMessage('');openLead(id);setControls(undefined);
  }
  function clearInFlight() { setDialog(undefined);setError(''); }
  function filter(set: (next: string) => void, next: string) { set(next);setPage(0);setSelected([]); }
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
  return <div className="lead-workspace">
    {!leadId && <div className="page-heading"><div><h1>Hospital &amp; Institutional Leads</h1>
      <p className="muted">Manage inquiries, equipment requirements, and follow-ups across territories.</p></div>
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
    {leadId ? detailError ? <p role="alert">{detailError} <button className="link" onClick={()=>openLead(undefined)}>Back to leads</button></p>
      : listing && activeDetail ? <LeadDetailView key={activeDetail.data.id} db={db} organization={organization} lead={activeDetail}
        workspace={listing} tab={tab} setTab={setTab} back={()=>{openLead(undefined);setError('');setMessage('');}}
        edit={()=>{setDialog('edit');setError('');}} changeStage={()=>{setDialog('stage');setError('');}} mutate={mutate} busy={busy} error={error} />
      : <p role="status">Loading lead…</p>
      : <>
      <div className="lead-toolbar">
        <div className="lead-mode" aria-label="Lead presentation">
          <button type="button" className="secondary" aria-pressed={mode==='table'} onClick={()=>filter(setMode,'table')}>Table</button>
          <button type="button" className="secondary" aria-pressed={mode==='kanban'} onClick={()=>filter(setMode,'kanban')}>Kanban Pipeline</button>
        </div>
        {listing?.can_export && <div className="lead-actions">
          <button type="button" className="secondary" disabled={busy||loading||!!listError} onClick={()=>void exportRows('csv')}>Export CSV</button>
          <button type="button" className="secondary" disabled={busy||loading||!!listError} onClick={()=>void exportRows('excel')}>Export Excel</button>
        </div>}
      </div>
      <nav className="lead-views" aria-label="Lead views">{views.map(([key,value])=><button className="secondary" type="button" key={key}
        aria-current={view===key?'page':undefined} onClick={()=>filter(setView,key)}>{value}{key===view&&listing&&!loading?` (${listing.total})`:''}</button>)}</nav>
      <div className="lead-filters">
        <label className="lead-search">Search leads<input type="search" maxLength={150} value={search} placeholder="Lead ID, hospital, contact, or equipment"
          onChange={event=>filter(setSearch,event.target.value)} /></label>
        <label>Source<select value={source} onChange={event=>filter(setSource,event.target.value)}>
          <option value="">All sources</option>{listing?.catalog.filter(part=>part.kind==='source').map(part=><option key={part.code} value={part.code}>{part.label}</option>)}</select></label>
        <label>Stage<select value={stage} onChange={event=>filter(setStage,event.target.value)}>
          <option value="">All stages</option>{listing?.catalog.filter(part=>part.kind==='stage').map(part=><option key={part.code} value={part.code}>{part.label}</option>)}</select></label>
        <details className="lead-more"><summary>More filters</summary><div>
          <label>Priority<select value={priority} onChange={event=>filter(setPriority,event.target.value)}>
            <option value="">All priorities</option>{priorities.map(part=><option key={part}>{part}</option>)}</select></label>
          <label>Salesperson<select value={owner} onChange={event=>filter(setOwner,event.target.value)}>
            <option value="">All salespeople</option>{listing?.staff.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label>Territory<select value={territory} onChange={event=>filter(setTerritory,event.target.value)}>
            <option value="">All territories</option>{listing?.territories.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </div></details>
        <label>Sort by<select value={sort} onChange={event=>filter(setSort,event.target.value)}>
          <option value="newest">Newest inquiry</option><option value="oldest">Oldest inquiry</option>
          <option value="customer">Hospital name</option><option value="value">Highest value</option><option value="followup">Next follow-up</option>
        </select></label>
      </div>
      {selected.length>0 && <div className="lead-selection"><span>{selected.length} selected</span>
        <button type="button" onClick={()=>{setDialog('assignment');setError('');}}>Assign Selected</button>
        <button className="link" type="button" onClick={()=>setSelected([])}>Clear selection</button></div>}
      {listError ? <p role="alert">{listError} <button className="link" onClick={()=>refresh(value=>value+1)}>Retry</button></p>
        : !listing ? <p role="status">Loading leads…</p>
        : <div aria-busy={loading}>
          {listing.rows.length===0 ? <div className="panel lead-empty"><h2>{loading?'Loading leads…':'No leads match this view'}</h2>
            </div>
            : mode==='kanban' ? <Pipeline listing={listing} open={open} />
            : <LeadTable listing={listing} selected={selected} toggle={toggle} open={open} toggleAll={()=>
                setSelected(selected.length===listing.rows.length?[]:listing.rows)} />}
          {listing.total>0 && <div className="lead-pagination"><span>{page*pageSize+1}–{Math.min((page+1)*pageSize,listing.total)} of {listing.total} leads</span>
            <button className="secondary" disabled={page===0||loading} onClick={()=>{setSelected([]);setPage(value=>value-1);}}>Previous</button>
            <button className="secondary" disabled={(page+1)*pageSize>=listing.total||loading} onClick={()=>{setSelected([]);setPage(value=>value+1);}}>Next</button>
          </div>}
        </div>}
      {listing?.can_create && listing.catalog.some(item=>item.kind==='source'&&item.code==='csv'&&item.active) &&
        <LeadImport db={db} organization={organization} onSaved={()=>{setPage(0);refresh(value=>value+1);}} />}
    </>}
    {listing && (dialog==='create' || (dialog==='edit'&&activeDetail)) &&
      <LeadEditor key={dialog} workspace={listing} lead={dialog==='edit'?activeDetail:undefined} save={saveEditor} onClose={clearInFlight} busy={busy} error={error} />}
    {dialog==='stage'&&listing&&activeDetail && <StageChange workspace={listing} lead={activeDetail} busy={busy} error={error} onClose={clearInFlight}
      save={async (action,input)=>{if (await mutate(action,input)) setDialog(undefined);}} />}
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

function LeadTable({ listing, selected, toggle, toggleAll, open }: {
  listing:Workspace;selected:LeadRow[];toggle:(row:LeadRow)=>void;toggleAll:()=>void;open:(id:string)=>void;
}) {
  return <div className="table-scroll lead-table-frame"><table className="lead-table">
    <thead><tr>
      {listing.can_manage && <th scope="col"><input type="checkbox" aria-label="Select all leads on this page" checked={listing.rows.length===selected.length} onChange={toggleAll} /></th>}
      <th scope="col">Lead ID</th><th scope="col">Hospital / Organisation</th><th scope="col">Contact</th><th scope="col">Equipment Interest</th>
      <th scope="col">Assigned Rep</th><th scope="col">Est. Value</th><th scope="col">Stage &amp; Priority</th>
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
    </tr>)}</tbody>
  </table></div>;
}
function Pipeline({ listing, open }: { listing:Workspace;open:(id:string)=>void }) {
  const stages=listing.catalog.filter(item=>item.kind==='stage'&&(item.active||listing.rows.some(row=>row.stage===item.code)));
  return <div className="lead-kanban" aria-label="Lead pipeline">
    {stages.map(stage=>{
      const rows=listing.rows.filter(row=>row.stage===stage.code);
      return <section key={stage.code} aria-label={stage.label}><h2>{stage.label}<span>{rows.length}</span></h2>
        {rows.map(row=><button className="secondary lead-card" key={row.id} onClick={()=>open(row.id)}>
          <span className="lead-number">{row.number}</span><strong>{row.customer}</strong><span>{row.products ?? label(listing,'source',row.source)}</span>
          <span className="lead-card-footer">{row.owner_name ?? 'Unassigned'}<strong>{money(row.value)}</strong></span>
          <span className="lead-badge" data-tone={row.priority.toLowerCase()}>{row.priority}</span>
        </button>)}
      </section>;
    })}
  </div>;
}
