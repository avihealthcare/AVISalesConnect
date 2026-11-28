import { useEffect, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../../packages/domain/database.types';
import { LeadDialog } from './LeadEditor';
import { readFields } from './leadModel';
import { accountSegments, accountLifecycles, accountSubtypes, customerSegment, contactDesignations, customerCategories, customerStatuses, decisionRoles, type AccountOption, type Contact, type Customer, type CustomerInfo, type Directory } from './customerModel';

type EditorProps = { workspace: Directory; busy: boolean; error: string; close: () => void; save: (input:Json) => Promise<boolean> };
const locationFields = [['address','Complete address'],['city','City'],['district','District'],['state','State'],['pin','PIN code'],['country','Country']] as const;
const bedFields = [['beds','Hospital beds'],['nicu','NICU bed capacity'],['picu','PICU bed capacity'],['icu','ICU bed capacity'],['theatres','Operating theatres']] as const;

export function CustomerEditor({ workspace, record, distributors, busy, error, close, save }: EditorProps & {
  record?:CustomerInfo;distributors:boolean;
}) {
  const data=record?.details;
  const [segment,setSegment]=useState<typeof accountSegments[number]>(()=>record?customerSegment(record):distributors?'Dealer / Distributor':'Healthcare Institution');
  const statusMap:Record<string,string>={Prospect:'Prospect','Active Account':'Active','Key Partner / Account':'Active',Inactive:'Inactive'};
  function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values=readFields(event.currentTarget);
    values.status=statusMap[values.lifecycle]??values.status;
    values.gstin=values.gstin.toUpperCase();
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
        <label>Account category<select name="segment" value={segment} onChange={event=>setSegment(event.target.value as typeof segment)}>
          {accountSegments.map(item=><option key={item}>{item}</option>)}</select></label>
        <label>Account sub-type<select name="sub_type" key={segment} defaultValue={record&&customerSegment(record)===segment?data?.sub_type??'':''}>
          <option value="">Select sub-type</option>{accountSubtypes[segment].map(item=><option key={item}>{item}</option>)}</select></label>
        {segment==='Healthcare Institution'?<label>Facility category<select name="category" defaultValue={record?.category??'Private Hospital'}>
          {customerCategories.filter(item=>!['Distributor','Government Department','Procurement Agency'].includes(item)).map(item=><option key={item}>{item}</option>)}</select></label>:
          <input type="hidden" name="category" value={segment==='Dealer / Distributor'?'Distributor':'Government Department'}/>}
        <label>Tier<select name="tier" key={'tier'+segment} defaultValue={record&&customerSegment(record)===segment?data?.tier??'':''}>
          <option value="">No tier</option>{(segment==='Dealer / Distributor'?['Platinum Partner','Gold Partner','Silver Partner']:['Tier 1','Tier 2','Tier 3'])
            .map(item=><option key={item}>{item}</option>)}</select></label>
        <label>GSTIN<input name="gstin" maxLength={15} pattern="[0-9a-zA-Z]{15}" defaultValue={data?.gstin??''}/></label>
        <label>Drug Licence No.<input name="drug_license_no" maxLength={100} defaultValue={data?.drug_license_no??''}/></label>
        <label>Ownership type<input name="ownership" maxLength={120} defaultValue={data?.ownership ?? ''} /></label>
        <label>Customer classification<input name="classification" maxLength={120} defaultValue={data?.classification ?? ''} /></label>
        <label>Lifecycle stage<select name="lifecycle" defaultValue={data?.lifecycle??(record?.status==='Inactive'?'Inactive':record?.status==='Prospect'?'Prospect':'Active Account')}>
          {accountLifecycles.map(item=><option key={item}>{item}</option>)}</select></label>
        <input type="hidden" name="status" value={customerStatuses.includes(record?.status??'')?record?.status:'Active'}/>
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
        {segment==='Healthcare Institution'?bedFields.map(([key,label])=><label key={key}>{label}<input name={key} type="number" min="0" max="999999" defaultValue={data?.[key] ?? ''} /></label>):
          <label>Territory coverage<input name="territory_coverage" maxLength={200} defaultValue={data?.territory_coverage??''}/></label>}
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
export function ContactEditor({ db, organization, workspace, record, customer, account, busy, error, close, save }: EditorProps & {
  db:SupabaseClient<Database>;organization:string;record?:Contact;customer?:CustomerInfo;account?:Customer;
}) {
  const data=record?.details;
  const target=customer??account;
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
  if(target&&!available.some(account=>account.id===target.id)) available.push({id:target.id,name:target.name,departments:customer?.departments??[]});
  for(const a of record?.accounts ?? []) if(!available.some(account=>account.id===a.id)) {
    available.push({id:a.id,name:a.name,departments:a.department_key&&a.department?[{key:a.department_key,name:a.department}]:[]});
  }
  const [links,setLinks]=useState<Link[]>(()=>record?.accounts.length ? record.accounts.map(a=>link(a.id,a.department_key ?? '')) : [link(target?.id)]);
  const [branchSites,setBranchSites]=useState<{id:string;title:string}[]>([]);
  const [site,setSite]=useState(data?.site_id??'');
  const primaryAccount=links[0]?.account;
  useEffect(()=>{
    if(!primaryAccount){setBranchSites([]);return;}
    let active=true;
    void db.rpc('read_customer_master',{p_org:organization,p_id:primaryAccount,p_query:{kind:'accounts'}}).then(result=>{
      if(active)setBranchSites(result.error?[]:(result.data as unknown as CustomerInfo).related.filter(item=>item.kind==='site'));
    });
    return ()=>{active=false;};
  },[db,organization,primaryAccount]);
  const [validation,setValidation]=useState('');
  const term=lookup.trim().toLowerCase();
  const matching=term ? available.filter(a=>a.name.toLowerCase().includes(term)
    || (lastRequested===lookup.trim()&&lastMatches.includes(a.id))) : available;
  const choices=available.filter(a=>matching.includes(a)||links.some(row=>row.account===a.id));
  function update(key:string,value:Partial<Link>) {
    if(key===links[0]?.key&&value.account!==undefined)setSite('');
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
        <label>Salutation<select name="salutation" defaultValue={data?.salutation??''}>
          <option value="">None</option>{['Dr.','Prof.','Mr.','Ms.'].map(item=><option key={item}>{item}</option>)}</select></label>
        <label>Site or branch<select value={site} onChange={event=>setSite(event.target.value)}>
          <option value="">Account-wide contact</option>{site&&!branchSites.some(item=>item.id===site)&&<option value={site}>Current branch</option>}
          {branchSites.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label className="lead-check"><input type="checkbox" name="primary_contact" defaultChecked={data?.primary_contact==='true'}/>Primary contact</label>
        <label>Designation<input name="designation" maxLength={150} list="customer-contact-designations" defaultValue={data?.designation ?? ''} /></label>
        <datalist id="customer-contact-designations">{contactDesignations.map(item=><option key={item} value={item} />)}</datalist>
        <label>Mobile number<input name="phone" type="tel" maxLength={32} defaultValue={data?.phone ?? ''} /></label>
        <label>WhatsApp number<input name="whatsapp" type="tel" maxLength={32} defaultValue={data?.whatsapp ?? ''} placeholder="+91…" /></label>
        <label>Email address<input name="email" type="email" maxLength={254} defaultValue={data?.email ?? ''} /></label>
        <label>Office telephone<input name="office_phone" type="tel" maxLength={32} defaultValue={data?.office_phone ?? ''} /></label>
        <label>Contact category<input name="category" list="customer-contact-categories" maxLength={120} defaultValue={data?.category ?? ''} /></label>
        <datalist id="customer-contact-categories">{['Clinical','Nursing','Biomedical','Procurement','Administration','Finance','Distributor','Other'].map(item=><option key={item} value={item} />)}</datalist>
        <label>Decision-making role<select name="stakeholder_role" defaultValue={data?.stakeholder_role??data?.decision_role ?? ''}>
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
