import { useEffect, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../../packages/domain/database.types';
import { LeadDialog } from './LeadEditor';
import { readFields } from './leadModel';
import { contactDesignations, customerCategories, customerStatuses, decisionRoles, type AccountOption, type Contact, type CustomerInfo, type Directory } from './customerModel';

type EditorProps = { workspace: Directory; busy: boolean; error: string; close: () => void; save: (input:Json) => Promise<boolean> };
const locationFields = [['address','Complete address'],['city','City'],['district','District'],['state','State'],['pin','PIN code'],['country','Country']] as const;
const bedFields = [['beds','Hospital beds'],['nicu','NICU bed capacity'],['picu','PICU bed capacity'],['icu','ICU bed capacity'],['theatres','Operating theatres']] as const;

export function CustomerEditor({ workspace, record, distributors, busy, error, close, save }: EditorProps & {
  record?:CustomerInfo;distributors:boolean;
}) {
  const data=record?.details;
  function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values=readFields(event.currentTarget);
    const openDocuments=values.open_documents==='on';
    delete values.open_documents;
    void save({id:record?.id ?? null,version:record?.version ?? null,fields:values,open_documents:openDocuments});
  }
  return <LeadDialog title={record?'Edit Customer':distributors?'Add Distributor':'Add Customer'} onClose={close}>
    <form className="lead-form" onSubmit={submit}>
      <section><h3>Customer identity</h3><div className="lead-form-grid">
        <label>Customer ID<input value={record?.number ?? 'Assigned when saved'} readOnly /></label>
        <label>Customer name<input name="name" required maxLength={200} defaultValue={record?.name ?? ''} /></label>
        <label>Hospital group or chain<input name="group" maxLength={200} defaultValue={record?.group ?? ''} /></label>
        <label>Customer category<select name="category" defaultValue={record?.category ?? (distributors?'Distributor':'Private Hospital')}>
          {customerCategories.map(category=><option key={category}>{category}</option>)}</select></label>
        <label>Ownership type<input name="ownership" maxLength={120} defaultValue={data?.ownership ?? ''} /></label>
        <label>Customer classification<input name="classification" maxLength={120} defaultValue={data?.classification ?? ''} /></label>
        <label>Customer status<select name="status" defaultValue={record?.status ?? 'Active'}>
          {customerStatuses.map(status=><option key={status}>{status}</option>)}</select></label>
        <label>Zoho Books customer ID<input name="zoho_id" maxLength={120} defaultValue={record?.zoho_id ?? ''} /></label>
      </div></section>
      <section><h3>Location and contact</h3><div className="lead-form-grid">
        {locationFields.map(([key,label])=><label key={key} className={key==='address'?'lead-span':undefined}>{label}
          <input name={key} maxLength={key==='address'?500:120} defaultValue={data?.[key] ?? (key==='country'&&!record?'India':'')} /></label>)}
        <label>Latitude<input name="latitude" inputMode="decimal" defaultValue={data?.latitude ?? ''} /></label>
        <label>Longitude<input name="longitude" inputMode="decimal" defaultValue={data?.longitude ?? ''} /></label>
        <label>Website<input name="website" type="url" maxLength={500} defaultValue={data?.website ?? ''} /></label>
        <label>Main telephone number<input name="phone" type="tel" maxLength={32} defaultValue={data?.phone ?? ''} /></label>
      </div></section>
      <section><h3>Facility and assignment</h3><div className="lead-form-grid">
        {bedFields.map(([key,label])=><label key={key}>{label}<input name={key} type="number" min="0" max="999999" defaultValue={data?.[key] ?? ''} /></label>)}
        <label>Assigned territory<select name="territory" defaultValue={record?.territory ?? ''}>
          <option value="">No territory</option>
          {record?.territory&&!workspace.territories.some(t=>t.id===record.territory)&&<option value={record.territory}>{record.territory_name ?? 'Current territory'}</option>}
          {workspace.territories.map(option=><option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
        {workspace.manage ? <label>Assigned salesperson<select name="owner" defaultValue={record?.owner ?? ''}>
          <option value="">{record?'Keep current salesperson':'Assign to me'}</option>
          {workspace.staff.map(option=><option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
          : <label>Assigned salesperson<input value={record?.owner_name ?? workspace.actor_name} readOnly /></label>}
        <label className="lead-span">Notes<textarea name="notes" rows={4} maxLength={5000} defaultValue={data?.notes ?? ''} /></label>
      </div></section>
      {error&&<p role="alert" className="error">{error}</p>}
      <label className="lead-check"><input type="checkbox" name="open_documents" /> Open customer attachments after saving</label>
      <EditorButtons busy={busy} close={close} label="Save customer" />
    </form>
  </LeadDialog>;
}

type Link = { key:string;account:string;department:string };
const link=(account='',department=''):Link=>({key:crypto.randomUUID(),account,department});
export function ContactEditor({ db, organization, workspace, record, customer, busy, error, close, save }: EditorProps & {
  db:SupabaseClient<Database>;organization:string;record?:Contact;customer?:CustomerInfo;
}) {
  const data=record?.details;
  const [lookup,setLookup]=useState('');
  const [matches,setMatches]=useState<AccountOption[]>([]);
  const [lookupError,setLookupError]=useState(false);
  const [lastRequested,setLastRequested]=useState('');
  const [lastMatches,setLastMatches]=useState<string[]>([]);
  useEffect(()=>{
    const value=lookup.trim();
    if(!value) return;
    let active=true;
    const timer=window.setTimeout(()=>{
      void db.rpc('read_customer_master',{p_org:organization,p_query:{kind:'contact_choices',search:value}}).then(result=>{
        if(!active) return;
        setLookupError(Boolean(result.error));setLastRequested(value);
        if(!result.error) {
          const next=result.data as unknown as AccountOption[];
          setMatches(previous=>[...new Map([...previous,...next].map(a=>[a.id,a])).values()]);
          setLastMatches(next.map(item=>item.id));
        }
      });
    },180);
    return ()=>{active=false;window.clearTimeout(timer);};
  },[db,organization,lookup]);
  const available: AccountOption[]=[...new Map([...workspace.accounts,...matches].map(a=>[a.id,a])).values()];
  if(customer&&!available.some(account=>account.id===customer.id)) available.push({id:customer.id,name:customer.name,departments:customer.departments});
  for(const a of record?.accounts ?? []) if(!available.some(account=>account.id===a.id)) {
    available.push({id:a.id,name:a.name,departments:a.department_key&&a.department?[{key:a.department_key,name:a.department}]:[]});
  }
  const [links,setLinks]=useState<Link[]>(()=>record?.accounts.length ? record.accounts.map(a=>link(a.id,a.department_key ?? '')) : [link(customer?.id)]);
  const [validation,setValidation]=useState('');
  const term=lookup.trim().toLowerCase();
  const matching=term ? available.filter(a=>a.name.toLowerCase().includes(term)
    || (lastRequested===lookup.trim()&&lastMatches.includes(a.id))) : available;
  const choices=available.filter(a=>matching.includes(a)||links.some(row=>row.account===a.id));
  function update(key:string,value:Partial<Link>) {
    setLinks(previous=>previous.map(row=>row.key===key ? {...row,...value}:row));
  }
  function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidation('');
    if(links.some(row=>!row.account) || new Set(links.map(row=>row.account)).size!==links.length) {
      setValidation('Select a different organisation for every affiliation.');
      return;
    }
    const fields=readFields(event.currentTarget);
    const openDocuments=fields.open_documents==='on';
    delete fields.open_documents;
    void save({id:record?.id ?? null,version:record?.version ?? null,fields:{...fields,account:links[0].account},
      links:links.map(({account,department})=>({account,department})),open_documents:openDocuments});
  }
  return <LeadDialog title={record?'Edit Contact':'Add Contact'} onClose={close}>
    <form className="lead-form" onSubmit={submit}>
      <section><h3>Contact details</h3><div className="lead-form-grid">
        <label>Full name<input name="name" required maxLength={200} defaultValue={record?.name ?? ''} /></label>
        <label>Designation<input name="designation" maxLength={150} list="customer-contact-designations" defaultValue={data?.designation ?? ''} /></label>
        <datalist id="customer-contact-designations">{contactDesignations.map(item=><option key={item} value={item} />)}</datalist>
        <label>Mobile number<input name="phone" type="tel" maxLength={32} defaultValue={data?.phone ?? ''} /></label>
        <label>WhatsApp number<input name="whatsapp" type="tel" maxLength={32} defaultValue={data?.whatsapp ?? ''} placeholder="+91…" /></label>
        <label>Email address<input name="email" type="email" maxLength={254} defaultValue={data?.email ?? ''} /></label>
        <label>Office telephone<input name="office_phone" type="tel" maxLength={32} defaultValue={data?.office_phone ?? ''} /></label>
        <label>Contact category<input name="category" list="customer-contact-categories" maxLength={120} defaultValue={data?.category ?? ''} /></label>
        <datalist id="customer-contact-categories">{['Clinical','Nursing','Biomedical','Procurement','Administration','Finance','Distributor','Other'].map(item=><option key={item} value={item} />)}</datalist>
        <label>Decision-making role<select name="decision_role" defaultValue={data?.decision_role ?? ''}>
          <option value="">Select role</option>{decisionRoles.map(item=><option key={item}>{item}</option>)}</select></label>
        <label>Preferred communication method<select name="preference" defaultValue={data?.preference ?? ''}>
          <option value="">No preference recorded</option>{['Phone','WhatsApp','Email','Office telephone','In person'].map(item=><option key={item}>{item}</option>)}
          {data?.preference&&!['Phone','WhatsApp','Email','Office telephone','In person'].includes(data.preference)&&<option>{data.preference}</option>}</select></label>
        <label className="lead-span">Notes<textarea name="notes" rows={3} maxLength={5000} defaultValue={data?.notes ?? ''} /></label>
      </div></section>
      <section><h3>Organisations and departments</h3>
        <label>Find an organisation<input type="search" maxLength={150} value={lookup} onChange={event=>setLookup(event.target.value)} /></label>
        {term&&lastRequested===lookup.trim()&&(lookupError?<p role="alert">Organisation search is unavailable.</p>
          : <p role="status">{matching.length?matching.length+' matching organisations':'No matching organisations'}</p>)}
        {links.map((row,index)=><fieldset className="lead-product" key={row.key}>
          <legend>{index===0?'Primary organisation':`Additional organisation ${index}`}</legend>
          <div className="lead-form-grid">
            <label>Hospital or organisation<select required value={row.account} onChange={event=>update(row.key,{account:event.target.value,department:''})}>
              <option value="">Select customer</option>{choices.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
            <label>Department<select value={row.department} onChange={event=>update(row.key,{department:event.target.value})}>
              <option value="">No department</option>{available.find(account=>account.id===row.account)?.departments.map(dept=><option key={dept.key} value={dept.key}>{dept.name}</option>)}</select></label>
          </div>
          {index>0&&<button type="button" className="secondary" onClick={()=>setLinks(previous=>previous.filter(item=>item.key!==row.key))}>Remove affiliation</button>}
        </fieldset>)}
        <button type="button" className="secondary" disabled={links.length>=40} onClick={()=>setLinks(previous=>[...previous,link()])}>Add Organisation</button>
      </section>
      <label className="lead-check"><input type="checkbox" name="open_documents" /> Open visiting card attachments after saving</label>
      {(error||validation)&&<p role="alert" className="error">{validation||error}</p>}
      <EditorButtons busy={busy} close={close} label="Save Contact" />
    </form>
  </LeadDialog>;
}

function EditorButtons({ busy, close, label }: { busy:boolean;close:()=>void;label:string }) {
  return <div className="lead-form-actions"><button className="secondary" type="button" onClick={close}>Cancel</button>
    <button type="submit" disabled={busy}>{busy?'Saving…':label}</button></div>;
}
