import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../../packages/domain/database.types';
import { CustomerEditor, ContactEditor } from './CustomerEditors';
import { AviIcon } from './AviIcon';
import { RecordFiles } from './RecordFiles';
import { commandError, dateTime, money, readFields } from './leadModel';
import { customerCategories, customerStatuses, telephone, waLink, type Contact, type Customer, type CustomerInfo, type Directory } from './customerModel';

const customerTabs=['Overview','Contacts','Installed Equipment','Leads','Field Visits','Quotations','Orders','Demonstrations','Payments','Documents','Activity Timeline'];
const relation = new Map([
  ['Installed Equipment',['equipment']],['Field Visits',['visit']],['Quotations',['quotation']],['Orders',['Order']],
  ['Demonstrations',['demo']],['Payments',['Receipt']],['Customer sites',['site']],
]);
const auditLabels: Record<string,string> = {'account.create':'Customer created','customer.create':'Customer created',
  'customer.edit':'Customer profile updated','customer.department':'Department added','resource.owner.transfer':'Salesperson reassigned'};
const kindLabels: Record<string,string> = {equipment:'Installed equipment',visit:'Field visit',quotation:'Quotation',demo:'Demonstration',
  financial_reference:'Sales reference',site:'Customer site'};

type Props = { db:SupabaseClient<Database>; organization:string; mode:'accounts'|'distributors'|'contacts'; initialName?:string; openLead:(reference:string)=>void };
type Destination = {kind:'accounts'|'contacts';id:string};
type Modal = 'create'|'edit'|'contact_create'|'contact_edit';

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

export function CustomerWorkspace({ db, organization, mode, initialName='', openLead }: Props) {
  const [search,setSearch]=useState(initialName);
  const [category,setCategory]=useState('');
  const [status,setStatus]=useState('');
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
      void db.rpc('read_customer_master',{p_org:organization,p_query:{kind:directoryKind,search:search.trim(),category,status,
        offset:page*25,distributors:mode==='distributors'}}).then(result=>{
        if (!live) return;
        setLoading(false);
        if(result.error) setLoadingError('Unable to load the directory.');
        else setListing(result.data as unknown as Directory);
      });
    },120);
    return ()=>{live=false;window.clearTimeout(timer);};
  },[db,organization,directoryKind,mode,search,category,status,page,revision]);

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
  const heading=mode==='contacts'?'Contacts':mode==='distributors'?'Distributors':'Hospitals and Customers';
  return <div className="lead-workspace customer-workspace avi-lead-console">
    {!destination&&<div className="page-heading avi-lead-hero"><div><h1>{heading}</h1>
      <p className="muted">{mode==='contacts'?'Find people by name, designation, phone or email.':'Find customer records by name, group, location or customer ID.'}</p></div>
      {listing?.can_create&&<button className="avi-primary avi-with-icon" onClick={()=>edit(mode==='contacts'?'contact_create':'create')}><AviIcon name="add"/>{mode==='contacts'?'Add Contact':mode==='distributors'?'Add Distributor':'Add a customer'}</button>}
    </div>}
    {notice&&<p role="status" className="lead-feedback">{notice}</p>}
    {!modal&&error&&<p role="alert" className="error lead-feedback">{error}</p>}
    {destination&&<button type="button" className="link lead-back" onClick={back}>← {trail.length>1?'Back to previous record':`Back to ${heading.toLowerCase()}`}</button>}
    {loadingError ? <p role="alert">{loadingError} <button className="link" onClick={()=>refresh(value=>value+1)}>Retry</button></p>
      : customer ? <CustomerDetail db={db} organization={organization} record={customer} tab={tab} setTab={setTab}
        open={open} edit={()=>edit('edit')} addContact={listing?.can_contact?()=>edit('contact_create'):undefined}
        addDepartment={async input=>save('department',input)} busy={busy} openLead={openLead}/>
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
            placeholder={mode==='contacts'?'Search name, designation, phone or email…':'Search name, group, location or customer ID…'}
            onChange={event=>filters(setSearch,event.target.value)} /></label>
          <div className="avi-directory-filters">
            {mode==='accounts'&&<select aria-label="Customer category" value={category} onChange={event=>filters(setCategory,event.target.value)}>
              <option value="">All categories</option>{customerCategories.map(item=><option key={item}>{item}</option>)}</select>}
            {mode!=='contacts'&&<select aria-label="Customer status" value={status} onChange={event=>filters(setStatus,event.target.value)}>
              <option value="">All statuses</option>{customerStatuses.map(item=><option key={item}>{item}</option>)}</select>}
            {(search||category||status)&&<button className="secondary" type="button" onClick={()=>{
              setSearch('');setCategory('');setStatus('');setPage(0);
            }}>Clear filters</button>}
            <button className="secondary avi-icon-button" type="button" title="Refresh directory" aria-label="Refresh directory"
              onClick={()=>refresh(value=>value+1)}><AviIcon name="refresh"/></button>
          </div>
        </div>
        {mode==='contacts'
          ? <ContactTable contacts={(listing?.rows.slice(0,25)??[]) as Contact[]} loading={loading} open={id=>open('contacts',id)} />
          : <CustomerTable customers={(listing?.rows.slice(0,25)??[]) as Customer[]} loading={loading} open={id=>open('accounts',id)}/>}
        {listing&&(page>0||listing.rows.length>25)&&<div className="lead-pagination">
          <span className="muted">Page {page+1}</span>
          <button className="secondary" disabled={!page||loading} onClick={()=>setPage(value=>value-1)}>Previous</button>
          <button className="secondary" disabled={listing.rows.length<=25||loading} onClick={()=>setPage(value=>value+1)}>Next</button>
        </div>}
      </section>}
    {listing&&(modal==='create'||modal==='edit')&&<CustomerEditor workspace={listing} record={modal==='edit'?customer:undefined}
      distributors={mode==='distributors'} busy={busy} error={error} close={()=>setModal(undefined)} save={input=>save(modal,input)}/>}
    {listing&&(modal==='contact_create'||modal==='contact_edit')&&<ContactEditor db={db} organization={organization} workspace={listing} customer={customer} record={modal==='contact_edit'?contact:undefined}
      busy={busy} error={error} close={()=>setModal(undefined)} save={input=>save(modal,input)}/>}
  </div>;
}

function DirectoryPlaceholders({ loading, columns }: { loading:boolean; columns:number }) {
  return loading ? Array.from({length:5},(_,row)=><tr key={row} aria-hidden="true">
    {Array.from({length:columns},(_,column)=><td key={column}><span className="avi-skeleton" data-width={(column+row)%3}/></td>)}
  </tr>) : <tr><td colSpan={columns}><div className="lead-empty"><h2>No matching records</h2></div></td></tr>;
}

function CustomerTable({ customers, open, loading = false }: { customers:Customer[];open:(id:string)=>void;loading?:boolean }) {
  return <div className="avi-data-table table-scroll"><table className="lead-table"><thead><tr>
    <th scope="col">Customer ID</th><th scope="col">Customer</th><th scope="col">Category</th>
    <th scope="col">Location</th><th scope="col">Territory / Salesperson</th><th scope="col">Status</th>
  </tr></thead><tbody>{loading||!customers.length?<DirectoryPlaceholders loading={loading} columns={6}/>:customers.map(customer=><tr key={customer.id}>
    <td><button className="link lead-number" onClick={()=>open(customer.id)}>{customer.number}</button></td>
    <td><button className="link lead-customer" onClick={()=>open(customer.id)}>{customer.name}</button><small>{customer.group}</small></td>
    <td>{customer.category}</td><td>{[customer.city,customer.state].filter(Boolean).join(', ')||'—'}</td>
    <td>{customer.territory_name||'—'}<small>{customer.owner_name}</small></td>
    <td><span className="lead-badge" data-tone={customer.status==='Active'?'won':'hold'}>{customer.status}</span></td>
  </tr>)}</tbody></table></div>;
}
function ContactTable({ contacts, open, loading = false }: { contacts:Contact[];open:(id:string)=>void;loading?:boolean }) {
  return <div className="avi-data-table table-scroll"><table className="lead-table customer-contact-table"><thead><tr>
    <th scope="col">Contact</th><th scope="col">Organisations</th><th scope="col">Decision-making role</th><th scope="col">Contact methods</th>
  </tr></thead><tbody>{loading||!contacts.length?<DirectoryPlaceholders loading={loading} columns={4}/>:contacts.map(contact=><tr key={contact.id}>
    <td><button className="link lead-customer" onClick={()=>open(contact.id)}>{contact.name}</button><small>{contact.details.designation}</small></td>
    <td>{contact.accounts.map(account=><small key={account.id}>{account.name}{account.department&&` · ${account.department}`}</small>)}</td>
    <td>{contact.details.decision_role||contact.details.buying_role||'—'}</td><td><QuickContact contact={contact}/></td>
  </tr>)}</tbody></table></div>;
}

function CustomerDetail({ db, organization, record, tab, setTab, open, edit, addContact, addDepartment, busy, openLead }: {
  db:SupabaseClient<Database>;organization:string;record:CustomerInfo;tab:string;setTab:(tab:string)=>void;
  open:(kind:Destination['kind'],id:string)=>void;edit:()=>void;addContact?:()=>void;
  addDepartment:(input:Json)=>Promise<boolean>;busy:boolean;openLead:(reference:string)=>void;
}) {
  const data=record.details;
  const phone=telephone(data.phone);
  const related=record.related.filter(item=>(relation.get(tab)??[]).some(subtype=>item.kind===subtype||item.subtype===subtype));
  const events=[...record.timeline.map(item=>({...item,title:auditLabels[item.title]??item.title,summary:item.actor})),
    ...record.contacts.map(item=>({created_at:item.created_at,title:'Contact recorded',summary:item.name})),
    ...record.leads.map(item=>({created_at:item.created_at,title:'Inquiry received',summary:item.reference+' · '+item.title})),
    ...record.related.map(item=>({created_at:item.created_at,title:kindLabels[item.kind]??item.kind,summary:item.title}))].sort(
    (first,second)=>Date.parse(second.created_at)-Date.parse(first.created_at));
  return <section className="panel lead-profile">
    <div className="page-heading"><div><p className="lead-number">{record.number}</p><h1>{record.name}</h1>
      <div className="lead-tags"><span className="lead-badge" data-tone="active">{record.category}</span>
        <span className="lead-badge" data-tone={record.status==='Active'?'won':'hold'}>{record.status}</span>
        {record.group&&<span>{record.group}</span>}{record.owner_name&&<span>{record.owner_name}</span>}</div></div>
      {record.can_edit&&<button className="secondary" type="button" onClick={edit}>Edit Customer</button>}</div>
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
    {tab==='Leads'&&<><h2>Leads</h2>{record.leads.length?<ul className="records">{record.leads.map(lead=><li key={lead.id}>
      <button className="link lead-number" onClick={()=>openLead(lead.reference)}>{lead.reference}</button><strong> {lead.title}</strong>
      <p>{lead.status} · {dateTime(lead.created_at)}</p></li>)}</ul>:<p className="muted">No related leads are visible.</p>}</>}
    {relation.has(tab)&&<><h2>{tab}</h2>
      {tab==='Payments'&&<p className="muted">Recorded receipt references from linked sales records. Amounts reflect the recorded reference.</p>}
      <RelatedRows items={related}/></>}
    {tab==='Documents'&&<><h2>Documents</h2><Documents db={db} organization={organization} record={record}/></>}
    {tab==='Activity Timeline'&&<><h2>Activity Timeline</h2>{events.length?<ul className="lead-timeline">{events.map((event,index)=><li key={index}>
      <div><strong>{event.title}</strong><span>{dateTime(event.created_at)}</span></div>
      {event.summary&&<p>{event.summary}</p>}</li>)}</ul>:<p className="muted">No activity recorded.</p>}</>}
  </section>;
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
