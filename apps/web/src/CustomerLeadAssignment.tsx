import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '../../../packages/domain/database.types';
import {customerSegment,type Customer,type CustomerInfo} from './customerModel';
import {userManagementEnabled} from './workspaceFeatures';
import {LeadDialog} from './LeadEditor';
import {readFields,readTime,type Product,type Workspace} from './leadModel';

type CatalogItem={id:string; title:string; details:{category?:string;code?:string}};
type StaffOption={id:string;name:string;designation?:string|null;region?:string|null};
type CreatedLead={id:string;number:string};
const contexts=['Direct Hospital Requirement','Dealer / Stocking / Tender Inquiry'] as const;

export function CustomerLeadAssignment({db,organization,customers,membership,manage,onClose,onSaved,canAddSite,canAddContact}:{
  db:SupabaseClient<Database>;organization:string;customers:Customer[];membership?:string;manage:boolean;
  onClose:()=>void;onSaved:(leads:CreatedLead[])=>void;canAddSite:boolean;canAddContact:boolean;
}) {
  const single=customers.length===1?customers[0]:undefined;
  const [details,setDetails]=useState<CustomerInfo>();
  const [staff,setStaff]=useState<StaffOption[]>([]);
  const [staffFilter,setStaffFilter]=useState('');
  const [owner,setOwner]=useState(membership??'');
  const [catalog,setCatalog]=useState<CatalogItem[]>([]);
  const [catalogPage,setCatalogPage]=useState(0);
  const [moreProducts,setMoreProducts]=useState(false);
  const [items,setItems]=useState<CatalogItem[]>([]);
  const [site,setSite]=useState('');
  const [contact,setContact]=useState('');
  const [quick,setQuick]=useState<'site'|'contact'>();
  const [revision,refresh]=useState(0);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(Boolean(single));
  const [error,setError]=useState('');
  const pending=useRef(false);
  const operation=useRef<{body:string;key:string}|undefined>(undefined);

  useEffect(()=>{
    if(!single)return;
    let current=true;
    void db.rpc('read_customer_master',{p_org:organization,p_id:single.id,p_query:{kind:'accounts'}}).then(result=>{
      if(!current)return;
      setLoading(false);
      if(result.error)setError('Unable to load this customer’s linked records.');
      else setDetails(result.data as unknown as CustomerInfo);
    });
    return ()=>{current=false;};
  },[db,organization,single,revision]);
  useEffect(()=>{
    let current=true;
    if(manage)void (async()=>{
      const result=userManagementEnabled?await db.rpc('workspace_user_directory',{p_org:organization}):undefined;
      if(!current)return;
      if(result&&!result.error){
        const directory=result.data as unknown as (StaffOption&{active:boolean;modules:string[]})[];
        setStaff(directory.filter(item=>item.active&&item.modules.includes('leads')));
      }else{
        const fallback=await db.rpc('read_lead_management',{p_org:organization,p_query:{view:'mine'}});
        if(current&&!fallback.error)setStaff((fallback.data as unknown as Workspace).staff);
      }
    })();
    return ()=>{current=false;};
  },[db,organization,manage]);
  useEffect(()=>{
    let current=true;
    void db.rpc('read_sales_field',{p_org:organization,p_kind:'product',p_offset:catalogPage*25}).then(result=>{
      if(!current||result.error)return;
      const rows=(result.data as unknown as {rows:CatalogItem[]}).rows;
      setCatalog(previous=>[...new Map([...previous,...rows.slice(0,25)].map(item=>[item.id,item])).values()]);
      setMoreProducts(rows.length>25);
    });
    return ()=>{current=false;};
  },[db,organization,catalogPage]);

  async function addRelated(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!single||!quick||pending.current)return;
    const values=readFields(event.currentTarget);
    pending.current=true;setBusy(true);setError('');
    try {
      const result=quick==='site'
        ? await db.rpc('run_sales_field',{p_org:organization,p_kind:'site',p_action:'create',p_key:crypto.randomUUID(),
          p_data:{parent_id:single.id,title:values.name,details:{address:values.address,city:values.city,pin:values.pin}}})
        : await db.rpc('command_customer_master',{p_org:organization,p_action:'contact_create',p_key:crypto.randomUUID(),
          p_input:{fields:{name:values.name,account:single.id,site_id:site,phone:values.phone,email:values.email,designation:values.designation},
            links:[{account:single.id}]}});
      if(result.error){setError(result.error.message);return;}
      const id=(result.data as {id?:string}).id;
      if(id && quick==='site')setSite(id);
      if(id && quick==='contact')setContact(id);
      setQuick(undefined);refresh(value=>value+1);
    } finally {pending.current=false;setBusy(false);}
  }
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(pending.current)return;
    const values=readFields(event.currentTarget);
    const products:Product[]=items.map(item=>({model:item.title,category:item.details.category??'Other',
      quantity:'1',estimated_unit_price:null,requirements:null}));
    const body={customers:customers.map(item=>item.id),owner,site,contact,context:values.context,priority:values.priority,
      value:values.value,notes:values.notes,follow_up:readTime(values.follow_up),products};
    const serialized=JSON.stringify(body);
    if(operation.current?.body!==serialized)operation.current={body:serialized,key:crypto.randomUUID()};
    pending.current=true;setBusy(true);setError('');
    try {
      const result=await db.rpc('assign_customer_leads',{p_org:organization,p_key:operation.current.key,p_input:body});
      if(result.error){setError(result.error.message);return;}
      onSaved(result.data as unknown as CreatedLead[]);
    } catch {setError('Unable to confirm the assignment. Retry with the same details.');}
    finally {pending.current=false;setBusy(false);}
  }
  const sites=details?.related.filter(item=>item.kind==='site')??[];
  const suggested=customers.every(item=>customerSegment(item)==='Healthcare Institution')?contexts[0]:contexts[1];
  const reps=staff.filter(item=>item.id===owner||[item.name,item.designation,item.region].filter(Boolean).join(' ').toLowerCase().includes(staffFilter.toLowerCase()));

  return <LeadDialog title={quick?quick==='site'?'Quick Add Site':'Quick Add Contact':'Assign Customer as Lead'} onClose={()=>{if(!busy)onClose();}}>
    <div className="lead-form">
      <ul className="records">{customers.map(item=><li key={item.id}><strong>{item.name}</strong> <span className="lead-badge">{customerSegment(item)}</span></li>)}</ul>
      <form hidden={Boolean(quick)} onSubmit={submit}>
        <div className="lead-form-grid">
          {single&&<>
            <label>Site / Branch<select value={site} onChange={event=>setSite(event.target.value)} disabled={loading}>
              <option value="">No site selected</option>{sites.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}
            </select></label>
            <label>Primary contact<select value={contact} onChange={event=>setContact(event.target.value)} disabled={loading}>
              <option value="">No contact selected</option>{details?.contacts.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            {canAddSite&&<button type="button" className="secondary" onClick={()=>setQuick('site')}>+ Quick Add Site</button>}
            {canAddContact&&<button type="button" className="secondary" onClick={()=>setQuick('contact')}>+ Quick Add Contact</button>}
          </>}
          {manage ? <>
            <label>Search active users<input type="search" value={staffFilter} onChange={event=>setStaffFilter(event.target.value)}/></label>
            <label>Assign to user<select value={owner} onChange={event=>setOwner(event.target.value)} required>
              <option value={membership??''}>Me</option>{reps.filter(item=>item.id!==membership).map(item=>
                <option key={item.id} value={item.id}>{[item.name,item.designation,item.region].filter(Boolean).join(' · ')}</option>)}
            </select></label>
          </> : <label>Assign to user<input value="Me" readOnly/></label>}
          <label>Lead type / inquiry context<select name="context" defaultValue={suggested}>{contexts.map(item=><option key={item}>{item}</option>)}</select></label>
          <label>Estimated deal value (₹)<input name="value" type="number" min="0" step="0.01"/></label>
          <label>Priority<select name="priority" defaultValue="Warm"><option>Hot</option><option>Warm</option><option>Cold</option></select></label>
          <label>Next follow-up<input name="follow_up" type="datetime-local"/></label>
          <label className="lead-span">Initial notes<textarea name="notes" rows={3} maxLength={10000}/></label>
        </div>
        {catalog.length>0&&<fieldset><legend>Equipment / Product Interest</legend><div className="customer-product-options">
          {catalog.map(item=><label className="lead-check" key={item.id}>
            <input type="checkbox" checked={items.some(product=>product.id===item.id)}
              onChange={event=>setItems(previous=>event.target.checked?[...previous,item]:previous.filter(product=>product.id!==item.id))}/>
            {item.title}{item.details.code&&` · ${item.details.code}`}
          </label>)}
        </div>{moreProducts&&<button type="button" className="secondary" onClick={()=>setCatalogPage(value=>value+1)}>Load more products</button>}</fieldset>}
        <div className="lead-form-actions"><button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</button>
          <button disabled={busy||loading}>Assign {customers.length===1?'as Lead':`${customers.length} Leads`}</button></div>
      </form>
      {quick&&<form onSubmit={addRelated} className="lead-form-grid">
        <label>{quick==='site'?'Site name':'Contact name'}<input name="name" required maxLength={200}/></label>
        {quick==='site'?<>
          <label>Address<input name="address" required maxLength={500}/></label>
          <label>City<input name="city" maxLength={120}/></label><label>PIN code<input name="pin" maxLength={16}/></label>
        </>:<>
          <label>Designation<input name="designation" maxLength={120}/></label>
          <label>Phone<input name="phone" type="tel" maxLength={30}/></label><label>Email<input name="email" type="email" maxLength={254}/></label>
        </>}
        <div className="lead-form-actions lead-span"><button type="button" className="secondary" disabled={busy} onClick={()=>{setQuick(undefined);setError('');}}>Back</button>
          <button disabled={busy}>Save {quick}</button></div>
      </form>}
      {error&&<p className="error" role="alert">{error}</p>}
    </div>
  </LeadDialog>;
}
