import { RecordFiles } from './RecordFiles';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {Json} from '../../../packages/domain/database.types';
import {LeadDialog} from './LeadEditor';
import {attendanceStatuses,clockInput,emptyReferences,fields,gpsCondition,indiaDay,localInstant,priorities,saveField,
  taskTypes,visitOutcomes,visitPurposes,workModes,type Entry,type FieldDb,type FieldKind,type FieldSnapshot,type Gps,type Option,type References,type Site} from './fieldModel';

export type FieldEdit={action:'start'|'finish'|'create'|'correction'|'review'|'review_location'|'acknowledge'|'begin'|'complete'|'cancel'|'reschedule';
  entry?:Entry;correction?:{id:string;member_name:string;day:string};plan?:Entry;day?:string;owner?:string};
const startTitles={attendance_session:'Start Working Day',visit:'Check In to Visit',visit_plan:'Plan Visit',task:'Create Task'};

function Choice({label,name,choices,value,onChange,required=false}:{label:string;name:string;choices:Option[];
  value?:string;onChange?:(id:string)=>void;required?:boolean}) {
  return <label>{label}<select name={name} required={required} value={value} onChange={onChange?event=>onChange(event.target.value):undefined}>
    <option value="">{required?'Select…':'None'}</option>
    {choices.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
  </select></label>;
}
function Choices({label,name,choices}:{label:string;name:string;choices:Option[]}) {
  return <fieldset className="field-choices"><legend>{label}</legend>{choices.length?choices.map(item=>
    <label key={item.id} className="lead-check"><input type="checkbox" name={name} value={item.id}/>{item.name}</label>)
    :<p className="muted">No records available.</p>}</fieldset>;
}
function Enum({label,name,values,initial}:{label:string;name:string;values:string[];initial?:string}) {
  return <label>{label}<select name={name} defaultValue={initial}>{values.map(value=><option key={value}>{value}</option>)}</select></label>;
}
function LocationCheck({site,visit,radius,onChange}:{site?:Site;visit:boolean;radius:number;
  onChange:(data:{gps?:Gps;permission:string;allowed:boolean})=>void}) {
  const [gps,setGps]=useState<Gps>();
  const [permission,setPermission]=useState('skipped');
  const [capturing,setCapturing]=useState(false);
  const [exception,setException]=useState(false);
  const [reason,setReason]=useState('');
  const condition=gpsCondition(gps,visit,site,radius);
  const verified=condition==='Verified On-Site'||condition==='GPS captured';
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
  useEffect(()=>{onChange({gps,permission,allowed:verified&&!exception||exception&&reason.trim().length>=3});},
    [gps,permission,verified,exception,reason,onChange]);
  function capture() {
    if(capturing)return;
    setCapturing(true);setGps(undefined);
    if(!navigator.geolocation){setPermission('unavailable');setCapturing(false);return;}
    navigator.geolocation.getCurrentPosition(result=>{
      if(!alive.current)return;
      const {latitude,longitude,accuracy}=result.coords;
      setGps({lat:latitude,lon:longitude,accuracy,captured_at:new Date(result.timestamp).toISOString()});
      setPermission('granted');setCapturing(false);
    },error=>{
      if(!alive.current)return;
      setPermission(error.code===1?'denied':'unavailable');setCapturing(false);
    },{enableHighAccuracy:true,maximumAge:0,timeout:10000});
  }
  return <fieldset className="field-location"><legend>Location evidence</legend>
    <p className="muted">Capture your location once for this event. Your browser may ask for permission.</p>
    <button className="secondary" type="button" onClick={capture} disabled={capturing}>{capturing?'Finding location…':'Capture Location'}</button>
    <p role="status"><span className="lead-badge" data-tone={verified&&!exception?'won':'warm'}>
      {exception?'Location Exception':condition}{gps?` (±${Math.round(gps.accuracy)} m)`:permission==='denied'?' · Permission denied':''}
    </span></p>
    {!verified&&<p className="field-warning">{visit?`Site tolerance is ${radius} m. `:''}You can continue with a location exception.</p>}
    <label className="lead-check"><input type="checkbox" checked={exception} onChange={event=>setException(event.target.checked)}/>Log Location Exception</label>
    {exception&&<label>Location exception reason<textarea name="exception" rows={2} required minLength={3} maxLength={500}
      value={reason} onChange={event=>setReason(event.target.value)} placeholder="Poor indoor signal, new wing, off-site meeting…"/></label>}
  </fieldset>;
}

export function FieldEntryEditor({db,org,kind,edit,workspace,close,onSaved}:{db:FieldDb;org:string;kind:FieldKind;edit:FieldEdit;
  workspace:FieldSnapshot;close:()=>void;onSaved:(result:{id:string|null;lead?:{id:string;number:string}|null})=>void}) {
  const {action,entry,plan,correction}=edit;
  const [account,setAccount]=useState(entry?.account_id??plan?.account_id??'');
  const [site,setSite]=useState(entry?.parent_id??plan?.parent_id??'');
  const [leadQuery,setLeadQuery]=useState('');
  const [search,setSearch]=useState('');
  const [refs,setRefs]=useState<References>(emptyReferences);
  const [provisional,setProvisional]=useState(false);
  const [quickContact,setQuickContact]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [point,setPoint]=useState<{gps?:Gps;permission:string;allowed:boolean}>({permission:'skipped',allowed:false});
  const [revision,refresh]=useState(0);
  const [requestError,setRequestError]=useState(false);
  const command=useRef<{key:string;body:string}|undefined>(undefined);
  const contactRequest=useRef<{key:string;body:string}|undefined>(undefined);
  const gps=kind==='visit'||kind==='attendance_session';
  const punch=gps&&['start','finish'].includes(action);
  const requiresRefs=kind!=='attendance_session'&&['create','start','finish'].includes(action);
  useEffect(()=>{
    if(!requiresRefs)return;
    let current=true;
    setRequestError(false);
    const timer=window.setTimeout(()=>{
      void db.rpc('field_reference_data',{p_org:org,p_mode:kind,p_account:account||null,p_search:search}).then(result=>{
        if(!current)return;
        if(result.error)setRequestError(true);
        else setRefs(result.data as unknown as References);
      });
    },150);
    return ()=>{current=false;window.clearTimeout(timer);};
  },[db,org,kind,account,search,requiresRefs,revision]);
  const core=action==='create'||action==='start';
  const onSite=refs.sites.find(item=>item.id===site);
  const headline=action==='finish'?(kind==='visit'?'Check Out & Complete Report':'End Working Day'):
    action==='correction'?'Request Correction':action==='review'?'Review Attendance Correction':action==='review_location'?'Review Location Exception':
      action==='acknowledge'?'Acknowledge Report':core?startTitles[kind]:
        ({begin:'Start Task',complete:'Complete Task',cancel:'Cancel Task',reschedule:'Reschedule'} as const)[action];
  const leadOptions=refs.leads.filter(item=>item.name.toLowerCase().includes(leadQuery.trim().toLowerCase()));
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(busy||punch&&!point.allowed||quickContact)return;
    const form=event.currentTarget;
    const values=fields(form);
    const list=(name:string)=>new FormData(form).getAll(name).map(String);
    const purpose=values.purpose||plan?.title;
    const input:Json={
      ...values,
      id:entry?.id??correction?.id??null,version:entry?.version??null,plan:plan?.id??null,
      title:provisional?values.provisional_name:values.title??purpose??null,
      provisional,account:provisional?null:account||null,site:provisional?null:site||null,
      related:values.related||null,owner:edit.owner??values.owner??null,day:values.day||edit.day||null,
      starts_at:localInstant(values.starts_at),ends_at:localInstant(values.ends_at),follow_up:localInstant(values.follow_up),
      ...(punch?{gps:point.gps??null,permission:point.permission}:{}),
      contacts:list('contacts'),products:list('products'),leads:list('leads'),commercial:list('commercial'),new_lead:values.new_lead==='on',
    };
    const serialized=JSON.stringify(input);
    if(command.current?.body!==serialized)command.current={key:crypto.randomUUID(),body:serialized};
    setBusy(true);setError('');
    try {
      const result=await saveField(db,org,kind,action,command.current.key,input);
      if(result.error){setError(result.error.message);return;}
      onSaved(result.data as {id:string|null;lead?:{id:string;number:string}|null});
    } catch {setError('The save could not be confirmed. Try again with the same details.');}
    finally {setBusy(false);}
  }
  async function addContact(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!account||busy)return;
    const data=fields(event.currentTarget);
    const body={fields:{name:data.name,account,phone:data.phone,email:data.email},links:[{account}]};
    const serialized=JSON.stringify(body);
    if(contactRequest.current?.body!==serialized)contactRequest.current={key:crypto.randomUUID(),body:serialized};
    setBusy(true);setError('');
    try {
      const result=await db.rpc('command_customer_master',{p_org:org,p_action:'contact_create',p_key:contactRequest.current.key,p_input:body});
      if(result.error){setError(result.error.message);return;}
      setQuickContact(false);refresh(value=>value+1);
    } catch {setError('The contact save could not be confirmed. Try again.');}
    finally {setBusy(false);}
  }
  const quickAdd=kind==='visit'&&action==='finish'&&Boolean(account)&&workspace.can_contact;
  return <LeadDialog title={headline} onClose={()=>{if(!busy)close();}}>
    <div className="lead-form">
      {(entry||plan)&&<p className="muted">{(entry??plan)?.title} · {(entry??plan)?.account_name??'Visit record'}</p>}
      <form hidden={quickContact} onSubmit={submit}>
        <div className="lead-form-grid">
          {kind==='attendance_session'&&action==='start'&&<Enum name="work_mode" label="Work mode" values={workModes}/>}
          {core&&(kind==='visit_plan'||kind==='visit')&&!plan&&<>
            {kind==='visit'&&<label className="lead-check lead-span"><input type="checkbox" checked={provisional}
              onChange={event=>setProvisional(event.target.checked)}/>Create Provisional Customer / Hospital</label>}
            {provisional?<label>Provisional customer name<input name="provisional_name" required maxLength={150}/></label>:<>
              <label>Find customer<input type="search" value={search} onChange={event=>setSearch(event.target.value)}/></label>
              <Choice label="Customer / Account" name="customer_display" value={account} required
                choices={refs.accounts.map(item=>({...item,name:item.name+(item.city?' · '+item.city:'')}))}
                onChange={id=>{setAccount(id);setSite('');setRefs(previous=>({...emptyReferences,accounts:previous.accounts}));}}/>
              <Choice label="Site / Branch" name="site_display" choices={refs.sites} value={site} onChange={setSite}/>
              <Choice label="Contact person" name="contact" choices={refs.contacts}/>
              <label>Find related lead<input type="search" value={leadQuery} onChange={event=>setLeadQuery(event.target.value)}/></label>
              <Choice label="Related lead" name="related" choices={leadOptions}/>
            </>}
            <Enum name="purpose" label="Visit purpose" values={visitPurposes}/>
            <Enum name="priority" label="Priority" values={priorities} initial="Medium"/>
            <label className="lead-span">Preparation notes / checklist<textarea name="notes" maxLength={1500}/></label>
          </>}
          {kind==='task'&&action==='create'&&<>
            <label>Task title<input name="title" required maxLength={180}/></label>
            <Enum label="Task type" name="task_type" values={taskTypes}/>
            <Enum label="Priority" name="priority" values={priorities} initial="Medium"/>
            <Choice label="Related record" name="related" choices={refs.related.map(item=>({...item,name:`${item.kind.replaceAll('_',' ')} · ${item.name}`}))}/>
            {workspace.team.length>0&&<Choice label="Assign to" name="owner" choices={[{id:workspace.actor,name:'Me'},...workspace.team]}/>}
            <label className="lead-span">Description<textarea name="notes" rows={3} maxLength={2000}/></label>
          </>}
          {(kind==='visit_plan'||kind==='task')&&(action==='create'||action==='reschedule')&&<>
            <label>{kind==='task'?'Due date and time (IST)':'Planned visit date and time (IST)'}
              <input name="starts_at" type="datetime-local" required defaultValue={entry?clockInput(entry.planned_at):(edit.day?edit.day+'T10:00':undefined)}/></label>
            {kind==='visit_plan'&&<label>Scheduled end time (IST)<input name="ends_at" type="datetime-local" required
              defaultValue={entry?clockInput(entry.ended_at):(edit.day?edit.day+'T10:30':undefined)}/></label>}
          </>}
          {kind==='visit'&&action==='finish'&&<>
            <Enum name="outcome" label="Meeting outcome" values={visitOutcomes}/>
            <label>Next action<input name="next_action" maxLength={200}/></label>
            <label>Next follow-up date and time (IST)<input type="datetime-local" name="follow_up"/></label>
            <label>Customer requirements<textarea name="requirements" rows={3} maxLength={2500}/></label>
            <label>Competitor information<textarea name="competition" rows={3} maxLength={1500}/></label>
          </>}
          {action==='correction'&&<>
            <label>Attendance date<input name="day" type="date" required max={indiaDay()} defaultValue={edit.day??indiaDay()}/></label>
            <label>Requested status<select name="status"><option value="">Keep existing status</option>
              {attendanceStatuses.map(status=><option key={status}>{status}</option>)}
            </select></label>
            <label>Requested punch-in (IST)<input name="starts_at" type="datetime-local"/></label>
            <label>Requested punch-out (IST)<input name="ends_at" type="datetime-local"/></label>
          </>}
          {(action==='review'||action==='review_location')&&<>
            <p>{correction?.member_name??entry?.owner_name} · {correction?.day??(entry?.planned_at&&indiaDay(entry.planned_at))}</p>
            {action==='review_location'&&<p>{[entry?.details.start_evidence?.exception,entry?.details.end_evidence?.exception].filter(Boolean).join(' · ')||
              (entry?.details.overnight?'Overnight working day':'Location evidence needs review')}</p>}
            <Enum label="Decision" name="status" values={['Approved','Rejected']}/>
          </>}
          {['correction','review','review_location','reschedule','complete','cancel','acknowledge'].includes(action)&&
            <label className="lead-span">{({review:'Review comments',review_location:'Review comments',correction:'Justification',complete:'Completion notes',reschedule:'Reschedule reason',
              cancel:'Cancellation reason',acknowledge:'Manager feedback'} as Record<string,string>)[action]}
              <textarea name="reason" required={action!=='acknowledge'} minLength={action==='acknowledge'?0:3} maxLength={1000} rows={3}/></label>}
        </div>
        {kind==='visit'&&action==='finish'&&<>
          <div className="field-report-picks"><Choices label="Contacts met" name="contacts" choices={refs.contacts}/>
            <Choices label="Products discussed" name="products" choices={refs.products}/>
            <Choices label="Link existing leads" name="leads" choices={refs.leads}/>
            <Choices label="Quotations discussed and orders confirmed" name="commercial"
              choices={refs.commercial.map(item=>({...item,name:(item.kind==='quotation'?'Quotation · ':'Order · ')+item.name}))}/>
          </div>
          {quickAdd&&<button type="button" className="secondary" onClick={()=>setQuickContact(true)}>+ Quick Add Contact</button>}
          {workspace.can_lead&&<label className="lead-check"><input name="new_lead" type="checkbox"/>Create New Lead from Visit</label>}

        </>}
        {punch&&<LocationCheck site={onSite} visit={kind==='visit'} radius={workspace.radius} onChange={setPoint}/>}
        {requestError&&<p className="muted">Related records could not be loaded.</p>}
        <div className="lead-form-actions"><button className="secondary" type="button" onClick={close} disabled={busy}>Cancel</button>
          <button disabled={busy||punch&&!point.allowed}>{busy?'Saving…':headline}</button></div>
      </form>
      {kind==='visit'&&action==='finish'&&entry&&!quickContact&&(workspace.can_attach||workspace.can_download)&&
        <RecordFiles db={db} organization={org} record={entry.id} canUpload={workspace.can_attach}/>}
      {quickContact&&<form onSubmit={addContact}>
        <label>Contact name<input name="name" required maxLength={150}/></label>
        <label>Mobile number<input name="phone" type="tel" maxLength={32}/></label>
        <label>Email address<input name="email" type="email" maxLength={254}/></label>
        <div className="lead-form-actions"><button type="button" className="secondary" onClick={()=>setQuickContact(false)} disabled={busy}>Back</button>
          <button disabled={busy}>Save Contact</button></div>
      </form>}
      {error&&<p role="alert" className="error">{error}</p>}
    </div>
  </LeadDialog>;
}
