import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../../packages/domain/database.types';
import {CustomerImport} from './CustomerImport';
import {CustomerLeadAssignment} from './CustomerLeadAssignment';
import {downloadWorkbook} from './spreadsheets';
import {LeadDialog} from './LeadEditor';
import { CustomerEditor, ContactEditor } from './CustomerEditors';
import { AviIcon } from './AviIcon';
import { RecordFiles } from './RecordFiles';
import { commandError, dateTime, money, readFields } from './leadModel';
import { accountSegments, accountLifecycles, accountSubtypes, customerSegment, telephone, waLink, type Contact, type Customer, type CustomerInfo, type Directory } from './customerModel';

const customerTabs=['Overview','Sites & Branches','Contacts','Leads & Opportunities','Installed Equipment','Orders','Field Visits','Quotations','Demonstrations','Payments','Documents','Activity Timeline'];
const relation = new Map([
  ['Installed Equipment',['equipment']],['Field Visits',['visit']],['Quotations',['quotation']],['Orders',['Order']],
  ['Demonstrations',['demo']],['Payments',['Receipt']],['Sites & Branches',['site']],
]);
const auditLabels: Record<string,string> = {'account.create':'Customer created','customer.create':'Customer created',
  'customer.edit':'Customer profile updated','customer.department':'Department added','resource.owner.transfer':'Salesperson reassigned'};
const kindLabels: Record<string,string> = {equipment:'Installed equipment',visit:'Field visit',quotation:'Quotation',demo:'Demonstration',
  financial_reference:'Sales reference',site:'Customer site'};

type Props = { db:SupabaseClient<Database>; organization:string; mode:'accounts'|'distributors'|'contacts'; initialName?:string; openLead:(reference:string)=>void;canAssign?:boolean;canManageLeads?:boolean;canAddSite?:boolean;membership?:string };
type Destination = {kind:'accounts'|'contacts';id:string};
type Modal = 'create'|'edit'|'contact_create'|'contact_edit'|'site'|'import';

function contactActions(contact: Contact) {
  const mobile=telephone(contact.details.phone);
  const office=telephone(contact.details.office_phone);
  const wa=waLink(contact.details.whatsapp);
  const email=contact.details.email;
  return [mobile&&{label:'Call',href:'tel:'+mobile,external:false},office&&{label:'Call office',href:'tel:'+office,external:false},
    email&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&{label:'Email',href:'mailto:'+encodeURIComponent(email).replace('%40','@'),external:false},
    wa&&{label:'WhatsApp',href:wa,external:true}].filter((item):item is {label:string;href:string;external:boolean}=>Boolean(item));
}
function QuickContact({ contact }: { contact: Contact }) {
  return <div className="customer-links">{contactActions(contact).map(action=><a className="link" key={action.label} href={action.href}
    target={action.external?'_blank':undefined} rel={action.external?'noopener noreferrer':undefined}>{action.label}</a>)}</div>;
}
function Facts({ entries }: { entries: [string,string|null|undefined][] }) {
  return <dl className="lead-facts">{entries.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'—'}</dd></div>)}</dl>;
}

export function CustomerWorkspace({ db, organization, mode, initialName='', openLead, canAssign=false,canManageLeads=false,canAddSite=false,membership }: Props) {
  const [search,setSearch]=useState(initialName);
  const [category,setCategory]=useState('');
  const [status,setStatus]=useState('');
  const [subType,setSubType]=useState('');
  const [state,setState]=useState('');
  const [owner,setOwner]=useState('');
  const [selection,setSelection]=useState<Customer[]>([]);
  const [assigning,setAssigning]=useState<Customer[]>();
  const [created,setCreated]=useState<{id:string;number:string}[]>([]);
  const [actionCustomer,setActionCustomer]=useState<Customer>();
  const [exportBusy,setExportBusy]=useState(false);
  const [page,setPage]=useState(0);
  const [listing,setListing]=useState<Directory>();
  const [record,setRecord]=useState<CustomerInfo|Contact>();
  const [trail,setTrail]=useState<Destination[]>([]);
  const [tab,setTab]=useState('Overview');
  const [modal,setModal]=useState<Modal>();
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [revision,refresh]=useState(0);
  const [error,setError]=useState('');
  const [loadingError,setLoadingError]=useState('');
  const [notice,setNotice]=useState('');
  const pending=useRef<{ key:string; request:string } | null>(null);
  const destination=trail.at(-1);
  const currentId=destination?.id;
  const currentKind=destination?.kind;
  const directoryKind=mode==='contacts'?'contacts':'accounts';
  const customer=record?.id===currentId&&currentKind==='accounts'?record as CustomerInfo:undefined;
  const contact=record?.id===currentId&&currentKind==='contacts'?record as Contact:undefined;

  useEffect(() => {
    let live=true;
    setLoading(true);setLoadingError('');
    const timer=window.setTimeout(()=>{
      const request=mode==='accounts'?db.rpc('enterprise_customer_directory',{p_org:organization,
        p_query:{search:search.trim(),segment:category,lifecycle:status,subtype:subType,state,owner,offset:page*25}})
        :db.rpc('read_customer_master',{p_org:organization,p_query:{kind:directoryKind,search:search.trim(),offset:page*25,distributors:mode==='distributors'}});
      void request.then(result=>{
        if (!live) return;
        setLoading(false);
        if(result.error) setLoadingError('Unable to load the directory.');
        else setListing(result.data as unknown as Directory);
      });
    },120);
    return ()=>{live=false;window.clearTimeout(timer);};
  },[db,organization,directoryKind,mode,search,category,status,subType,state,owner,page,revision]);

  useEffect(() => {
    if(!currentId||!currentKind) return;
    let live=true;
    setLoadingError('');
    void db.rpc('read_customer_master',{p_org:organization,p_query:{kind:currentKind},p_id:currentId}).then(result=>{
      if(!live) return;
      if(result.error) setLoadingError('This record is unavailable.');
      else setRecord(result.data as unknown as CustomerInfo|Contact);
    });
    return ()=>{live=false;};
  },[db,organization,currentId,currentKind,revision]);

  function open(kind:Destination['kind'],id:string) {
    setTrail(previous=>[...previous,{kind,id}]);setTab('Overview');setRecord(undefined);setLoadingError('');setError('');
  }
  function back() {
    setTrail(previous=>previous.slice(0,-1));setTab('Overview');setRecord(undefined);setLoadingError('');setError('');setNotice('');
  }
  function edit(next:Modal) {setError('');setNotice('');setModal(next);}
  async function save(action:string,input:Json) {
    if(busy || !input || typeof input!=='object' || Array.isArray(input)) return false;
    const {open_documents:openDocuments,...body}=input;
    const request=JSON.stringify([action,body]);
    if(pending.current?.request!==request) pending.current={key:crypto.randomUUID(),request};
    setBusy(true);setError('');setNotice('');
    try {
      const {error,data}=await db.rpc('command_customer_master',{p_org:organization,p_action:action,p_key:pending.current.key,p_input:body});
      if(error) {
        setError(error.code==='23505'?'This customer reference or location is already recorded.':commandError(error));return false;
      }
      pending.current=null;setModal(undefined);refresh(value=>value+1);
      const result=data as {id:string;visible:boolean};
      if(result.visible&&(action==='create'||action==='contact_create')) open(action==='create'?'accounts':'contacts',result.id);
      if(!result.visible&&action==='edit') back();
      if(openDocuments&&result.visible) setTab('Documents');
      setNotice(action==='department'?'Department saved.':action.startsWith('contact')?'Contact saved.':'Customer saved.');
      return true;
    } catch {setError('Unable to confirm the save. Retry with the same entries.');return false;}
    finally {setBusy(false);}
  }
  function filters(change:(value:string)=>void,value:string) {change(value);setPage(0);}
  const heading=mode==='contacts'?'Contacts':mode==='distributors'?'Distributors':'Customers & Partners';
  const toggle=(record:Customer)=>setSelection(current=>current.some(item=>item.id===record.id)
    ? current.filter(item=>item.id!==record.id) : current.length<25?[...current,record]:current);
  function addFor(next:'site'|'contact_create',item:Customer) {setActionCustomer(item);edit(next);}
  async function exportCustomers(rows:Customer[]) {
    if(!listing?.manage||exportBusy||!rows.length)return;
    setExportBusy(true);setError('');
    try {await downloadWorkbook([['Account','Category','Subtype','Lifecycle','City','State','GSTIN','Account owner'],
      ...rows.map(item=>[item.name,customerSegment(item),item.subtype??item.category,item.lifecycle??item.status,
        item.city,item.state,item.details.gstin??'',item.owner_name])],'Customers','salesconnect-customers.xlsx');}
    catch {setError('Unable to export the selected customer records.');}
    finally {setExportBusy(false);}
  }
  return <div className="lead-workspace customer-workspace avi-lead-console">
    {!destination&&<div className="page-heading avi-lead-hero"><div><h1>{heading}</h1>
      <p className="muted">{mode==='contacts'?'Find people by name, designation, phone or email.':'Search organizations, locations, GSTINs and contacts.'}</p></div>
      <div className="lead-actions">
      {mode==='accounts'&&(listing?.manage||listing?.can_create)&&<details className="avi-action-menu"><summary>Import / Export <AviIcon name="chevron" size={13}/></summary><div>
        {listing.can_create&&<button className="secondary" onClick={()=>edit('import')}>Import customers</button>}
        {listing.manage&&<button className="secondary" disabled={exportBusy||!listing.rows.length} onClick={()=>void exportCustomers(listing.rows.slice(0,25) as Customer[])}>Export this page</button>}
      </div></details>}
      {listing?.can_create&&<button className="avi-primary avi-with-icon" onClick={()=>edit(mode==='contacts'?'contact_create':'create')}><AviIcon name="add"/>{mode==='contacts'?'Add Contact':mode==='distributors'?'Add Distributor':'Add Customer'}</button>}
      </div>
    </div>}
    {!destination&&listing?.summary&&<div className="avi-kpis" aria-label="Customer summary">
      {([['total','Total Accounts'],['healthcare','Hospitals & Clinics'],['partners','Dealers & Distributors'],['active','Active Accounts']] as const)
        .map(([key,label])=><div key={key} className="panel avi-kpi"><span>{label}</span><strong>{listing.summary?.[key]??0}</strong></div>)}
    </div>}
    {created.length>0&&<div role="status" className="lead-feedback">{created.length===1?'Lead assigned.':`${created.length} leads assigned.`}
      {created.map(item=><button key={item.id} type="button" className="link" onClick={()=>openLead(item.id)}>{created.length===1?'View Lead →':item.number+' →'}</button>)}
    </div>}
    {notice&&<p role="status" className="lead-feedback">{notice}</p>}
    {!modal&&error&&<p role="alert" className="error lead-feedback">{error}</p>}
    {destination&&<button type="button" className="link lead-back" onClick={back}>← {trail.length>1?'Back to previous record':`Back to ${heading.toLowerCase()}`}</button>}
    {loadingError ? <p role="alert">{loadingError} <button className="link" onClick={()=>refresh(value=>value+1)}>Retry</button></p>
      : customer ? <CustomerDetail db={db} organization={organization} record={customer} tab={tab} setTab={setTab}
        open={open} edit={()=>edit('edit')} addContact={listing?.can_contact?()=>addFor('contact_create',customer):undefined}
        addSite={canAddSite?()=>addFor('site',customer):undefined} assign={canAssign?()=>setAssigning([customer]):undefined}
        addDepartment={async input=>save('department',input)} saveOverview={input=>save('edit',input)}
        staff={listing?.manage?listing.staff:[]} busy={busy} openLead={openLead}/>
      : contact ? <ContactDetail db={db} organization={organization} record={contact} tab={tab} setTab={setTab}
        openCustomer={id=>open('accounts',id)} onEdit={()=>edit('contact_edit')} />
      : destination ? <p role="status">Loading record…</p>
      : <section className="avi-data-card avi-directory" aria-label={heading} aria-busy={loading}>
        <div className="avi-data-toolbar avi-directory-heading">
          <span><AviIcon name="table"/>{mode==='contacts'?'All contacts':mode==='distributors'?'All distributors':'All customers'}</span>
          {listing&&!loading&&<small className="muted">{Math.min(listing.rows.length,25)} on this page</small>}
        </div>
        <div className="avi-data-filters">
          <label className="avi-record-search"><AviIcon name="search"/><input type="search" value={search} maxLength={150}
            aria-label={mode==='contacts'?'Search contacts':'Search by name'}
            placeholder={mode==='contacts'?'Search name, designation, phone or email…':'Search name, city, GSTIN, or contact…'}
            onChange={event=>filters(setSearch,event.target.value)} /></label>
          <div className="avi-directory-filters">
            {mode==='accounts'&&<>
              <select aria-label="Category" value={category} onChange={event=>{filters(setCategory,event.target.value);setSubType('');}}>
                <option value="">All categories</option>{accountSegments.map(item=><option key={item}>{item}</option>)}</select>
              <select aria-label="Sub-Type" value={subType} onChange={event=>filters(setSubType,event.target.value)}>
                <option value="">All sub-types</option>{listing?.subtypes?.map(item=><option key={item}>{item}</option>)}</select>
              <select aria-label="Lifecycle Stage" value={status} onChange={event=>filters(setStatus,event.target.value)}>
                <option value="">All stages</option>{accountLifecycles.map(item=><option key={item}>{item}</option>)}</select>
              <select aria-label="State or Region" value={state} onChange={event=>filters(setState,event.target.value)}>
                <option value="">All states</option>{listing?.states?.map(item=><option key={item}>{item}</option>)}</select>
              {!!listing?.staff.length&&<select aria-label="Account Owner" value={owner} onChange={event=>filters(setOwner,event.target.value)}>
                <option value="">All owners</option>{listing.staff.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>}
            </>}
            {(search||category||status||subType||state||owner)&&<button className="secondary" type="button" onClick={()=>{
              setSearch('');setCategory('');setStatus('');setSubType('');setState('');setOwner('');setPage(0);
            }}>Clear filters</button>}
            <button className="secondary avi-icon-button" type="button" title="Refresh directory" aria-label="Refresh directory"
              onClick={()=>refresh(value=>value+1)}><AviIcon name="refresh"/></button>
          </div>
        </div>
        {mode==='contacts'
          ? <ContactTable contacts={(listing?.rows.slice(0,25)??[]) as Contact[]} loading={loading} open={id=>open('contacts',id)} />
          : <CustomerTable customers={(listing?.rows.slice(0,25)??[]) as Customer[]} loading={loading} open={id=>open('accounts',id)}
              selected={selection} toggle={canAssign||listing?.manage?toggle:undefined} assign={canAssign?item=>setAssigning([item]):undefined}
              addSite={canAddSite?item=>addFor('site',item):undefined}
              addContact={listing?.can_contact?item=>addFor('contact_create',item):undefined}/>}
        {selection.length>0&&<div className="lead-selection customer-selection"><strong>{selection.length} selected</strong>
          {canAssign&&<button type="button" onClick={()=>setAssigning(selection)}>Assign to User as Lead</button>}
          {listing?.manage&&<button className="secondary" type="button" disabled={exportBusy} onClick={()=>void exportCustomers(selection)}>Export Selected</button>}
          <button className="secondary" type="button" onClick={()=>setSelection([])}>Clear selection</button>
        </div>}
        {listing&&(page>0||listing.rows.length>25)&&<div className="lead-pagination">
          <span className="muted">Page {page+1}</span>
          <button className="secondary" disabled={!page||loading} onClick={()=>setPage(value=>value-1)}>Previous</button>
          <button className="secondary" disabled={listing.rows.length<=25||loading} onClick={()=>setPage(value=>value+1)}>Next</button>
        </div>}
      </section>}
    {listing&&(modal==='create'||modal==='edit')&&<CustomerEditor workspace={listing} record={modal==='edit'?customer:undefined}
      distributors={mode==='distributors'} busy={busy} error={error} close={()=>setModal(undefined)} save={input=>save(modal,input)}/>}
    {listing&&(modal==='contact_create'||modal==='contact_edit')&&<ContactEditor db={db} organization={organization} workspace={listing} customer={customer} account={actionCustomer} record={modal==='contact_edit'?contact:undefined}
      busy={busy} error={error} close={()=>{setModal(undefined);setActionCustomer(undefined);}} save={input=>save(modal,input)}/>}
    {modal==='import'&&listing?.can_create&&<CustomerImport db={db} organization={organization} close={()=>setModal(undefined)} refresh={()=>refresh(value=>value+1)}/>}
    {modal==='site'&&actionCustomer&&<CustomerSiteDialog db={db} organization={organization} customer={actionCustomer}
      close={()=>{setModal(undefined);setActionCustomer(undefined);}}
      saved={()=>{setModal(undefined);setActionCustomer(undefined);refresh(value=>value+1);setNotice('Site added.');}}/>}
    {assigning&&<CustomerLeadAssignment db={db} organization={organization} customers={assigning} membership={membership} manage={canManageLeads}
      canAddSite={canAddSite} canAddContact={Boolean(listing?.can_contact)} onClose={()=>setAssigning(undefined)}
      onSaved={leads=>{setCreated(leads);setAssigning(undefined);setSelection([]);refresh(value=>value+1);}}/>}
  </div>;
}

function DirectoryPlaceholders({ loading, columns }: { loading:boolean; columns:number }) {
  return loading ? Array.from({length:5},(_,row)=><tr key={row} aria-hidden="true">
    {Array.from({length:columns},(_,column)=><td key={column}><span className="avi-skeleton" data-width={(column+row)%3}/></td>)}
  </tr>) : <tr><td colSpan={columns}><div className="lead-empty"><h2>No matching records</h2></div></td></tr>;
}

function CustomerTable({customers,open,loading=false,selected=[],toggle,assign,addSite,addContact}: {
  customers:Customer[];open:(id:string)=>void;loading?:boolean;selected?:Customer[];
  toggle?:(record:Customer)=>void;assign?:(record:Customer)=>void;addSite?:(record:Customer)=>void;addContact?:(record:Customer)=>void;
}) {
  return <div className="avi-data-table table-scroll"><table className="lead-table customer-accounts-table"><thead><tr>
    {toggle&&<th scope="col">Select</th>}<th scope="col">Account Name</th><th scope="col">Primary City &amp; State</th>
    <th scope="col">Sites / Branches</th><th scope="col">Primary Contact</th><th scope="col">Active Leads / Deals</th>
    <th scope="col">Account Owner</th><th scope="col">Actions</th>
  </tr></thead><tbody>{loading||!customers.length?<DirectoryPlaceholders loading={loading} columns={toggle?8:7}/>:customers.map(customer=><tr key={customer.id}>
    {toggle&&<td><input type="checkbox" aria-label={`Select ${customer.name}`} checked={selected.some(item=>item.id===customer.id)}
      disabled={selected.length>=25&&!selected.some(item=>item.id===customer.id)} onChange={()=>toggle(customer)}/></td>}
    <td><button className="link lead-customer" onClick={()=>open(customer.id)}>{customer.name}</button><small>{customer.number} · {customer.subtype??customer.category}</small>
      <span className="lead-badge" data-tone={customerSegment(customer)==='Dealer / Distributor'?'warm':'active'}>{customerSegment(customer)}</span></td>
    <td>{[customer.city,customer.state].filter(Boolean).join(', ')||'—'}</td>
    <td>{customer.site_count==null?'—':`${customer.site_count} ${customer.site_count===1?'site':'sites'}`}</td>
    <td>{customer.primary_contact?.name??'—'}<small>{customer.primary_contact?.designation}</small><small>{customer.primary_contact?.phone}</small></td>
    <td>{customer.active_count??'—'}</td><td>{customer.owner_name??'Unassigned'}</td>
    <td><div className="customer-row-actions" aria-label={`Actions for ${customer.name}`}>
      <button className="link" onClick={()=>open(customer.id)}>View 360° Record</button>
      {assign&&<button className="link" onClick={()=>assign(customer)}>Assign as Lead</button>}
      {addSite&&<button className="link" onClick={()=>addSite(customer)}>Add Site</button>}
      {addContact&&<button className="link" onClick={()=>addContact(customer)}>Add Contact</button>}
    </div></td>
  </tr>)}</tbody></table></div>;
}

function CustomerSiteDialog({db,organization,customer,close,saved}:{
  db:SupabaseClient<Database>;organization:string;customer:Customer;close:()=>void;saved:()=>void;
}) {
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const operation=useRef<{body:string;key:string}|undefined>(undefined);
  return <LeadDialog title={`Add Site · ${customer.name}`} onClose={()=>{if(!busy)close();}}>
    <form className="lead-form" onSubmit={async event=>{
      event.preventDefault();if(busy)return;setBusy(true);setError('');
      const {name,...details}=readFields(event.currentTarget);
      const data={title:name,parent_id:customer.id,details};
      const body=JSON.stringify(data);
      if(operation.current?.body!==body)operation.current={body,key:crypto.randomUUID()};
      try {
        const result=await db.rpc('run_sales_field',{p_org:organization,p_kind:'site',p_action:'create',p_key:operation.current.key,p_data:data});
        if(result.error)setError(result.error.message);else saved();
      } catch {setError('Unable to confirm the site save. Retry with the same details.');}
      finally {setBusy(false);}
    }}>
      <div className="lead-form-grid">
        <label>Site name<input name="name" required maxLength={200}/></label>
        <label>Site type<select name="site_type"><option>Hospital Campus</option><option>Clinic Branch</option><option>Registered Office</option><option>Warehouse / Godown</option><option>Service Center</option></select></label>
        <label className="lead-span">Address<input name="address" required maxLength={500}/></label>
        <label>City<input name="city" maxLength={120}/></label><label>State<input name="state" maxLength={120}/></label>
        <label>PIN code<input name="pin" maxLength={16}/></label>
        {customerSegment(customer)==='Healthcare Institution'&&<label>Bed capacity<input name="beds" type="number" min="0" max="999999"/></label>}
        <label>Primary site<select name="is_primary"><option value="false">No</option><option value="true">Yes</option></select></label>
      </div>
      {error&&<p className="error" role="alert">{error}</p>}
      <div className="lead-form-actions"><button type="button" className="secondary" onClick={close} disabled={busy}>Cancel</button><button disabled={busy}>Save site</button></div>
    </form>
  </LeadDialog>;
}
function ContactTable({ contacts, open, loading = false }: { contacts:Contact[];open:(id:string)=>void;loading?:boolean }) {
  return <div className="avi-data-table table-scroll"><table className="lead-table customer-contact-table"><thead><tr>
    <th scope="col">Contact</th><th scope="col">Organisations</th><th scope="col">Decision-making role</th><th scope="col">Contact methods</th>
  </tr></thead><tbody>{loading||!contacts.length?<DirectoryPlaceholders loading={loading} columns={4}/>:contacts.map(contact=><tr key={contact.id}>
    <td><button className="link lead-customer" onClick={()=>open(contact.id)}>{contact.name}</button><small>{contact.details.designation}</small></td>
    <td>{contact.accounts.map(account=><small key={account.id}>{account.name}{account.department&&` · ${account.department}`}</small>)}</td>
    <td>{contact.details.stakeholder_role||contact.details.decision_role||contact.details.buying_role||'—'}</td><td><QuickContact contact={contact}/></td>
  </tr>)}</tbody></table></div>;
}

function CustomerDetail({ db, organization, record, tab, setTab, open, edit, addContact, addSite, assign, addDepartment, saveOverview, staff, busy, openLead }: {
  db:SupabaseClient<Database>;organization:string;record:CustomerInfo;tab:string;setTab:(tab:string)=>void;
  open:(kind:Destination['kind'],id:string)=>void;edit:()=>void;addContact?:()=>void;addSite?:()=>void;assign?:()=>void;
  addDepartment:(input:Json)=>Promise<boolean>;saveOverview:(input:Json)=>Promise<boolean>;staff:Directory['staff'];busy:boolean;openLead:(reference:string)=>void;
}) {
  const data=record.details;
  const phone=telephone(data.phone);
  const [recorded,setRecorded]=useState<{title:string;summary:string;created_at:string}[]>([]);
  const [activityRevision,reloadActivity]=useState(0);
  const [activity,setActivity]=useState(false);
  const [activityError,setActivityError]=useState('');
  const [logging,setLogging]=useState(false);
  const [copied,setCopied]=useState('');
  const [editingSummary,setEditingSummary]=useState(false);
  const activityKey=useRef<{body:string;key:string}|undefined>(undefined);
  useEffect(()=>{
    let active=true;
    void db.rpc('customer_activities',{p_org:organization,p_id:record.id}).then(result=>{
      if(active&&!result.error)setRecorded(result.data as typeof recorded);
    });
    return ()=>{active=false;};
  },[db,organization,record.id,activityRevision]);
  const related=record.related.filter(item=>(relation.get(tab)??[]).some(subtype=>item.kind===subtype||item.subtype===subtype));
  const events=[...recorded,...record.timeline.map(item=>({...item,title:auditLabels[item.title]??item.title,summary:item.actor})),
    ...record.contacts.map(item=>({created_at:item.created_at,title:'Contact recorded',summary:item.name})),
    ...record.leads.map(item=>({created_at:item.created_at,title:'Inquiry received',summary:item.reference+' · '+item.title})),
    ...record.related.map(item=>({created_at:item.created_at,title:kindLabels[item.kind]??item.kind,summary:item.title}))].sort(
    (first,second)=>Date.parse(second.created_at)-Date.parse(first.created_at));
  return <section className="panel lead-profile">
    <div className="page-heading"><div><p className="lead-number">{record.number}</p><h1>{record.name}</h1>
      <div className="lead-tags"><span className="lead-badge" data-tone="active">{record.category}</span>
        <span className="lead-badge" data-tone={record.status==='Active'?'won':'hold'}>{record.status}</span>
        {record.group&&<span>{record.group}</span>}{record.owner_name&&<span>{record.owner_name}</span>}</div></div>
      <div className="lead-actions">{record.can_edit&&<button className="secondary" type="button" onClick={edit}>Edit Customer</button>}
        {assign&&<button className="avi-primary" type="button" onClick={assign}>Assign as Lead</button>}</div></div>
    <div className="customer-360">
    <aside className="customer-360-card"><h2>About This Account</h2>
      {editingSummary?<CustomerSummaryEditor record={record} staff={staff} busy={busy} close={()=>setEditingSummary(false)}
        save={async input=>{if(await saveOverview(input))setEditingSummary(false);}}/>:<>
        <Facts entries={[[ 'Account name',record.name],['Category',customerSegment(record)],['Sub-Type',data.sub_type??record.category],
          ['Lifecycle',data.lifecycle??record.status],['GSTIN',data.gstin],['Drug licence',data.drug_license_no],
          [customerSegment(record)==='Healthcare Institution'?'Bed capacity':'Territory coverage',customerSegment(record)==='Healthcare Institution'?data.beds:data.territory_coverage],
          ['Account Owner',record.owner_name]]}/>
        {record.can_edit&&<button className="link" type="button" onClick={()=>setEditingSummary(true)}>Edit account fields</button>}
      </>}
      <div className="customer-links">{record.can_edit&&<button className="secondary" onClick={()=>setActivity(true)}>+ Log Activity</button>}{addSite&&<button className="secondary" onClick={addSite}>+ Add Site</button>}
        {addContact&&<button className="secondary" onClick={addContact}>+ Add Contact</button>}</div>
    </aside>
    <div className="customer-360-center">
    <nav className="lead-detail-tabs" aria-label="Customer details">{customerTabs.map(name=><button className="secondary" key={name}
      aria-current={tab===name?'page':undefined} onClick={()=>setTab(name)}>{name}</button>)}</nav>
    {tab==='Overview'&&<>
      <h2>Overview</h2>
      <Facts entries={ [
        ['Hospital group or chain',record.group],['Address',data.address],['City',data.city],['District',data.district],['State',data.state],
        ['PIN code',data.pin],['Country',data.country],['Latitude',data.latitude],['Longitude',data.longitude],
        ['Hospital beds',data.beds],['NICU bed capacity',data.nicu],['PICU bed capacity',data.picu],['ICU bed capacity',data.icu],
        ['Operating theatres',data.theatres],['Ownership type',data.ownership],['Assigned territory',record.territory_name],
        ['Assigned salesperson',record.owner_name],['Customer classification',data.classification],['Zoho Books customer ID',record.zoho_id],
      ] }/>
      <div className="customer-links">{phone&&<a href={'tel:'+phone}>Call {phone}</a>}
        {data.website&&/^https?:\/\//i.test(data.website)&&<a href={data.website} target="_blank" rel="noopener noreferrer">Website</a>}</div>
      {data.notes&&<section className="lead-section"><h3>Notes</h3><p className="requirement">{data.notes}</p></section>}
      <section className="lead-section"><h3>Departments</h3>
        {record.departments.length?<ul>{record.departments.map(department=><li key={department.key}>{department.name}</li>)}</ul>:<p className="muted">No departments recorded.</p>}
        {record.can_edit&&<form className="lead-inline-form" onSubmit={event=>{
          event.preventDefault();const form=event.currentTarget;
          void addDepartment({id:record.id,version:record.version,fields:readFields(form)}).then(success=>{if(success) form.reset();});
        }}><label>Department name<input name="name" required maxLength={120}/></label><button disabled={busy}>Add Department</button></form>}
      </section>
      {record.branches.length>0&&<section className="lead-section"><h3>Other branches in this group</h3>
        <CustomerTable customers={record.branches} open={id=>open('accounts',id)}/></section>}
      {record.related.some(item=>item.kind==='site')&&<section className="lead-section"><h3>Customer sites</h3>
        <RelatedRows items={record.related.filter(item=>item.kind==='site')}/></section>}
    </>}
    {tab==='Contacts'&&<><div className="card-heading"><h2>Contacts</h2>{addContact&&<button type="button" onClick={addContact}>Add Contact</button>}</div>
      {record.contacts.length?<ContactTable contacts={record.contacts} open={id=>open('contacts',id)}/>:<p className="muted">No contacts are visible for this customer.</p>}</>}
    {tab==='Leads & Opportunities'&&<><h2>Leads &amp; Opportunities</h2>{record.leads.length?<ul className="records">{record.leads.map(lead=><li key={lead.id}>
      <button className="link lead-number" onClick={()=>openLead(lead.id)}>{lead.reference}</button><strong> {lead.title}</strong>
      <p>{lead.status} · {dateTime(lead.created_at)}</p></li>)}</ul>:<p className="muted">No related leads are visible.</p>}
      {!!record.opportunities?.length&&<><h3>Opportunities</h3><ul className="records">{record.opportunities.map(item=>
        <li key={item.id}><strong>{item.title}</strong><p>{item.status} · {dateTime(item.created_at)}</p></li>)}</ul></>}
    </>}
    {relation.has(tab)&&<><h2>{tab}</h2>
      {tab==='Payments'&&<p className="muted">Recorded receipt references from linked sales records. Amounts reflect the recorded reference.</p>}
      <RelatedRows items={related}/></>}
    {tab==='Documents'&&<><h2>Documents</h2><Documents db={db} organization={organization} record={record}/></>}
    {tab==='Activity Timeline'&&<><h2>Activity Timeline</h2>{events.length?<ul className="lead-timeline">{events.map((event,index)=><li key={index}>
      <div><strong>{event.title}</strong><span>{dateTime(event.created_at)}</span></div>
      {event.summary&&<p>{event.summary}</p>}</li>)}</ul>:<p className="muted">No activity recorded.</p>}</>}
    </div>
    <aside className="customer-360-related">
      <section className="customer-360-card"><div className="card-heading"><h2>Sites / Branches</h2>{addSite&&<button className="secondary" onClick={addSite}>+ Add</button>}</div>
        {record.sites?.length?<ul className="records">{record.sites.map(site=><li key={site.id}>{site.title}<small>{[site.type,site.city,site.pin].filter(Boolean).join(' · ')}</small></li>)}</ul>:<p className="muted">No sites visible.</p>}
      </section>
      <section className="customer-360-card"><div className="card-heading"><h2>Contacts</h2>{addContact&&<button className="secondary" onClick={addContact}>+ Add</button>}</div>
        {record.contacts.length?<ul className="records">{record.contacts.map(item=><li key={item.id}><button className="link" onClick={()=>open('contacts',item.id)}>{item.name}</button>
          <small>{item.details.stakeholder_role??item.details.decision_role??item.details.designation}</small><QuickContact contact={item}/>
          <div className="customer-links">{([['phone',item.details.phone],['email',item.details.email]] as const).map(([label,value])=>value&&
            <button className="link" key={label} onClick={()=>void navigator.clipboard.writeText(value).then(()=>setCopied(label+' copied.'),()=>setCopied('Unable to copy.'))}>
              Copy {label}</button>)}</div></li>)}</ul>:<p className="muted">No contacts visible.</p>}
      </section>
      <section className="customer-360-card"><h2>Leads &amp; Opportunities</h2>
        {record.leads.length?<ul className="records">{record.leads.slice(0,5).map(item=><li key={item.id}><button className="link" onClick={()=>openLead(item.id)}>{item.reference}</button>
          <small>{item.status}</small></li>)}</ul>:<p className="muted">No leads visible.</p>}
        {!!record.opportunities?.length&&<ul className="records">{record.opportunities.slice(0,5).map(item=><li key={item.id}>{item.title}<small>{item.status}</small></li>)}</ul>}
      </section>
    </aside></div>
    {copied&&<p role="status">{copied}</p>}
    {activity&&<LeadDialog title="Log Customer Activity" onClose={()=>{if(!logging){setActivity(false);setActivityError('');}}}>
      <form className="lead-form" onSubmit={async event=>{
        event.preventDefault();if(logging)return;setLogging(true);setActivityError('');
        const {kind,summary}=readFields(event.currentTarget);
        const body=JSON.stringify({kind,summary});
        if(activityKey.current?.body!==body)activityKey.current={body,key:crypto.randomUUID()};
        try {
          const result=await db.rpc('log_customer_activity',{p_org:organization,p_id:record.id,p_key:activityKey.current.key,p_kind:kind,p_summary:summary});
          if(result.error)setActivityError(result.error.message);
          else {activityKey.current=undefined;setActivity(false);reloadActivity(value=>value+1);setTab('Activity Timeline');}
        } catch {setActivityError('Unable to confirm the save. Retry with the same details.');}
        finally {setLogging(false);}
      }}>
        <label>Activity type<select name="kind"><option>Call</option><option>Meeting</option><option>Note</option></select></label>
        <label>Summary<textarea name="summary" required maxLength={1000} rows={3}/></label>
        {activityError&&<p role="alert" className="error">{activityError}</p>}
        <div className="lead-form-actions"><button className="secondary" type="button" disabled={logging} onClick={()=>setActivity(false)}>Cancel</button>
          <button disabled={logging}>Save Activity</button></div>
      </form>
    </LeadDialog>}
  </section>;
}

function CustomerSummaryEditor({record,staff,busy,close,save}:{
  record:CustomerInfo;staff:Directory['staff'];busy:boolean;close:()=>void;save:(input:Json)=>Promise<void>;
}) {
  const data=record.details;
  const previous=customerSegment(record);
  const [segment,setSegment]=useState(previous);
  return <form onSubmit={event=>{
    event.preventDefault();
    const values=readFields(event.currentTarget);
    const legacy=segment==='Dealer / Distributor'?'Distributor':segment==='Government / Tender Body'?'Government Department':
      previous===segment?record.category:'Private Hospital';
    const status=values.lifecycle==='Inactive'?'Inactive':values.lifecycle==='Prospect'?'Prospect':'Active';
    const original=Object.fromEntries(Object.entries(data).filter(([,value])=>typeof value==='string')) as Record<string,string>;
    void save({id:record.id,version:record.version,fields:{...original,...values,category:legacy,status,segment,
      gstin:values.gstin.toUpperCase(),group:record.group,zoho_id:record.zoho_id,territory:record.territory}});
  }}>
    <label>Account name<input name="name" required maxLength={200} defaultValue={record.name}/></label>
    <label>Category<select value={segment} onChange={event=>setSegment(event.target.value as typeof segment)}>
      {accountSegments.map(item=><option key={item}>{item}</option>)}</select></label>
    <label>Sub-Type<select key={segment} name="sub_type" defaultValue={segment===previous?data.sub_type??'':''}>
      <option value="">No sub-type</option>{accountSubtypes[segment].map(item=><option key={item}>{item}</option>)}</select></label>
    <label>Lifecycle Stage<select name="lifecycle" defaultValue={data.lifecycle??(record.status==='Inactive'?'Inactive':record.status==='Prospect'?'Prospect':'Active Account')}>
      {accountLifecycles.map(item=><option key={item}>{item}</option>)}</select></label>
    <label>GSTIN<input name="gstin" maxLength={15} pattern="[0-9a-zA-Z]{15}" defaultValue={data.gstin??''}/></label>
    <label>Drug Licence No.<input name="drug_license_no" maxLength={100} defaultValue={data.drug_license_no??''}/></label>
    {segment==='Healthcare Institution'?<label>Bed Capacity<input name="beds" type="number" min="0" max="999999" defaultValue={data.beds??''}/></label>
      :<label>Territory Coverage<input name="territory_coverage" maxLength={200} defaultValue={data.territory_coverage??''}/></label>}
    {staff.length>0&&<label>Account Owner<select name="owner" defaultValue={record.owner??''}>
      <option value="">Keep current owner</option>{staff.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    <div className="lead-actions"><button className="secondary" type="button" onClick={close} disabled={busy}>Cancel</button>
      <button disabled={busy}>Save</button></div>
  </form>;
}

function Documents({ db, organization, record }: { db:SupabaseClient<Database>;organization:string;record:{id:string;can_attach:boolean;can_download:boolean} }) {
  return record.can_attach||record.can_download ? <RecordFiles db={db} organization={organization} record={record.id} canUpload={record.can_attach} />
    : <p className="muted">Attachments are unavailable with your current permissions.</p>;
}
function RelatedRows({ items }: { items:CustomerInfo['related'] }) {
  return items.length?<ul className="records">{items.map(item=><li key={item.id}>
    <strong>{item.title}</strong><p>{item.reference ? item.reference+' · ':''}{item.status} · {dateTime(item.planned_at||item.created_at)}
      {item.amount&&` · ${money(item.amount)}`}</p>
    {item.equipment&&<Facts entries={[
      ['Manufacturer',item.equipment.manufacturer],['Category',item.equipment.category],['Quantity',item.equipment.quantity],
      ['Installed on',item.equipment.installed_on],['Warranty until',item.equipment.warranty_until],['Source',item.equipment.source],['Verified on',item.equipment.verified_on],
    ]}/>}</li>)}</ul>:<p className="muted">No related records are visible.</p>;
}
function ContactDetail({ db, organization, record, tab, setTab, openCustomer, onEdit }: { db:SupabaseClient<Database>;organization:string;
  record:Contact;tab:string;setTab:(tab:string)=>void;openCustomer:(id:string)=>void;onEdit:()=>void }) {
  return <section className="panel lead-profile">
    <div className="page-heading avi-lead-hero"><div><h1>{record.name}</h1><p>{record.details.designation||'Contact'}</p><QuickContact contact={record}/></div>
      {record.can_edit&&<button className="secondary" onClick={onEdit}>Edit Contact</button>}</div>
    <nav className="lead-detail-tabs" aria-label="Contact details">{['Overview','Documents'].map(name=><button className="secondary" key={name}
      aria-current={tab===name?'page':undefined} onClick={()=>setTab(name)}>{name}</button>)}</nav>
    {tab==='Documents'?<><h2>Visiting card and documents</h2><Documents db={db} organization={organization} record={record}/></>
      : <><h2>Overview</h2>
        <Facts entries={ [
          ['Mobile number',record.details.phone],['WhatsApp number',record.details.whatsapp],['Email address',record.details.email],
          ['Office telephone',record.details.office_phone],['Contact category',record.details.category],
          ['Decision-making role',record.details.decision_role||record.details.buying_role],['Preferred communication',record.details.preference],
        ] }/>
        <h3>Organisations and departments</h3><ul className="records">{record.accounts.map(account=><li key={account.id}>
          <button className="link" onClick={()=>openCustomer(account.id)}>{account.name}</button>
          {account.primary&&' · Primary organisation'}{account.department&&` · ${account.department}`}</li>)}</ul>
        {record.details.notes&&<><h3>Notes</h3><p className="requirement">{record.details.notes}</p></>}
      </>}
  </section>;
}
