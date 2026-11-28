import {useEffect,useState} from 'react';
import {AviIcon} from './AviIcon';
import {FieldEntryEditor,type FieldEdit} from './FieldEntryEditor';
import {RecordFiles} from './RecordFiles';
import {addDays,dateTime,fieldTitles,indiaDay,interval,timeOnly,weekStart,
  type Entry,type FieldDb,type FieldKind,type FieldSnapshot,type Option} from './fieldModel';

const taskViews=['Today’s Tasks','Upcoming Tasks','Overdue Tasks','Completed Tasks','Team Tasks','Calendar View'];
const moduleDefault:Record<FieldKind,string>={attendance_session:'Calendar',visit_plan:'Week',visit:'Visits',task:taskViews[0]};
const monthLabel=new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric',timeZone:'UTC'});
const weekday=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function useClock(active:boolean) {
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{
    if(!active)return;
    setNow(Date.now());
    const timer=window.setInterval(()=>setNow(Date.now()),1000);
    return ()=>window.clearInterval(timer);
  },[active]);
  return now;
}
function TeamPicker({team,value,change,all=true}:{team:Option[];value:string;change:(value:string)=>void;all?:boolean}) {
  return <label>Team member<select value={value} onChange={event=>change(event.target.value)}>
    {all&&<option value="">All Team Visits / Tasks</option>}<option value="me">Me</option>
    {team.map(rep=><option key={rep.id} value={rep.id}>{rep.name}</option>)}
  </select></label>;
}
function Tone({value}:{value:string}) {
  const tone=['Completed','Present','Verified On-Site','Approved','GPS captured'].includes(value)?'won':
    ['Overdue','Rejected','Absent'].includes(value)?'lost':
      ['Location Exception','Pending','Pending Review','Rescheduled'].includes(value)?'warm':'active';
  return <span className="lead-badge" data-tone={tone}>{value}</span>;
}
function EntryActions({entry,workspace,kind,onEdit,onPlan,today}:{entry:Entry;workspace:FieldSnapshot;kind:FieldKind;
  onEdit:(edit:FieldEdit)=>void;onPlan:(id:string)=>void;today:string}) {
  const own=entry.owner_id===workspace.actor;
  const open=!['Completed','Cancelled'].includes(entry.status);
  return <div className="lead-actions field-entry-actions">
    {kind==='visit_plan'&&entry.status==='Planned'&&own&&<>
      {workspace.can_start_visit&&entry.planned_at&&indiaDay(entry.planned_at)===today&&<button type="button" onClick={()=>onPlan(entry.id)}>Start Check-In →</button>}
      {workspace.can_update&&<button type="button" className="secondary" onClick={()=>onEdit({action:'reschedule',entry})}>Reschedule</button>}
    </>}
    {kind==='visit'&&!own&&entry.status==='Pending Review'&&workspace.can_update&&
      <button type="button" className="secondary" onClick={()=>onEdit({action:'review_location',entry})}>Review Location Exception</button>}
    {kind==='task'&&open&&workspace.can_update&&<>
      {entry.status!=='In Progress'&&<button className="secondary" type="button" onClick={()=>onEdit({action:'begin',entry})}>Start</button>}
      <button type="button" className="secondary" onClick={()=>onEdit({action:'complete',entry})}>Complete</button>
      <button type="button" className="secondary" onClick={()=>onEdit({action:'reschedule',entry})}>Reschedule</button>
      <button type="button" className="link" onClick={()=>onEdit({action:'cancel',entry})}>Cancel task</button>
    </>}
  </div>;
}
function TaskHistory({entry}:{entry:Entry}) {
  if(!entry.history?.length&&!entry.details.completion_notes)return null;
  return <details className="field-history"><summary>Task history</summary>
    {entry.details.completion_notes&&<p>{entry.details.completion_notes}</p>}
    {entry.history?.map((event,index)=><p key={index}>
      {dateTime(event.details.previous_due_date)} → {dateTime(event.details.new_due_date)} · {event.details.reason}
      <small className="muted"> · {event.actor??'Team member'} · {dateTime(event.when)}</small>
    </p>)}
  </details>;
}
function Entries({rows,workspace,kind,onEdit,onPlan,db,org,today}:{rows:Entry[];workspace:FieldSnapshot;kind:FieldKind;
  onEdit:(edit:FieldEdit)=>void;onPlan:(id:string)=>void;db:FieldDb;org:string;today:string}) {
  if(!rows.length)return <p className="field-empty">No records for this view.</p>;
  return <ul className="field-records">{rows.map(entry=>{
    const late=kind==='task'&&entry.planned_at&&Date.parse(entry.planned_at)<Date.now()&&!['Completed','Cancelled'].includes(entry.status);
    return <li key={entry.id} className="field-record">
      <div><strong>{entry.title}</strong>
        <p className="muted">{[entry.account_name,entry.site_name,dateTime(entry.planned_at),entry.owner_name].filter(Boolean).join(' · ')}</p>
        {(entry.details.outcome||entry.details.description||entry.details.notes)&&<p>{entry.details.outcome||entry.details.description||entry.details.notes}</p>}
        {kind==='task'&&<TaskHistory entry={entry}/>}
        {kind==='visit'&&entry.details.outcome&&<details className="field-history"><summary>Meeting report</summary>
          <dl className="lead-facts">
            <div><dt>Duration</dt><dd>{entry.details.duration_minutes??'—'} min</dd></div>
            <div><dt>Contacts met</dt><dd>{entry.details.contacts?.length??0}</dd></div>
            <div><dt>Products discussed</dt><dd>{entry.details.products?.map(product=>product.model).join(', ')||'—'}</dd></div>
            <div><dt>Requirements</dt><dd>{entry.details.requirements||'—'}</dd></div>
            <div><dt>Competitor information</dt><dd>{entry.details.competition||'—'}</dd></div>
            <div><dt>Next action</dt><dd>{entry.details.next_action||'—'}</dd></div>
            <div><dt>Follow-up</dt><dd>{dateTime(entry.details.follow_up)}</dd></div>
          </dl>
        </details>}
        {kind==='visit'&&entry.owner_id===workspace.actor&&(workspace.can_attach||workspace.can_download)&&
          <RecordFiles db={db} organization={org} record={entry.id} canUpload={workspace.can_attach}/>}
      </div>
      <div><Tone value={late?'Overdue':kind==='task'&&entry.status==='Open'?'Pending':entry.status}/>
        {kind==='visit'&&entry.details.start_evidence&&<p><Tone value={entry.details.start_evidence.verdict}/>
          {entry.details.start_evidence.accuracy_meters!=null&&<small> ±{Math.round(entry.details.start_evidence.accuracy_meters)} m</small>}</p>}
        {kind==='visit'&&entry.details.end_evidence&&<p className="muted">Check-out <Tone value={entry.details.end_evidence.verdict}/>
          {entry.details.end_evidence.accuracy_meters!=null&&' ±'+Math.round(entry.details.end_evidence.accuracy_meters)+' m'}</p>}
        {entry.details.location_review&&<p className="muted">{entry.details.location_review.decision} · {entry.details.location_review.reviewer} · {entry.details.location_review.reason}</p>}
        {(entry.details.priority||entry.details.task_type)&&<p className="muted">{[entry.details.priority,entry.details.task_type].filter(Boolean).join(' · ')}</p>}
        <EntryActions {...{entry,workspace,kind,onEdit,onPlan,today}}/>
      </div>
    </li>;
  })}</ul>;
}

function Calendar({days,rows,workspace,kind,onEdit,onPlan,today}:{days:string[];rows:Entry[];workspace:FieldSnapshot;kind:FieldKind;
  onEdit:(edit:FieldEdit)=>void;onPlan:(id:string)=>void;today:string}) {
  return <div className="field-calendar-scroll"><div className="field-calendar" data-day={days.length===1?'single':'week'}>
    {days.map(day=><section className="field-calendar-column" key={day}><h3>{new Intl.DateTimeFormat('en-IN',{weekday:'short',day:'numeric',timeZone:'UTC'}).format(new Date(day+'T00:00:00Z'))}</h3>
      {rows.filter(row=>row.planned_at&&indiaDay(row.planned_at)===day).sort((a,b)=>(a.planned_at??'').localeCompare(b.planned_at??'')).map(row=>
        <article key={row.id} className="field-time-block">
          <small>{timeOnly(row.planned_at)}{kind==='visit_plan'&&` – ${timeOnly(row.ended_at)}`}</small>
          <strong>{row.account_name??row.title}</strong><p>{row.account_name?row.title:row.owner_name}</p><Tone value={row.status}/>
          <EntryActions entry={row} {...{workspace,kind,onEdit,onPlan,today}}/>
        </article>)}
    </section>)}
  </div></div>;
}

function Attendance({data,view,day,today,onEdit,now}:{data:FieldSnapshot;view:string;day:string;today:string;onEdit:(edit:FieldEdit)=>void;now:number}) {
  const month=day.slice(0,7);
  const first=month+'-01';
  const year=Number(month.slice(0,4));
  const last=new Date(Date.UTC(year,Number(month.slice(5)),0)).getUTCDate();
  const active=data.rows.find(row=>row.owner_id===data.actor&&row.status==='Open');
  const todayRow=data.rows.find(row=>row.owner_id===data.actor&&row.planned_at&&indiaDay(row.planned_at)===today);
  const myCorrections=data.corrections.filter(item=>item.member_id===data.actor);
  const approved=new Map<string,{requested_status:string|null;start_at:string|null;end_at:string|null}>();
  const correctionsByDecision=myCorrections.filter(item=>item.status==='Approved')
    .sort((a,b)=>(b.decided_at??'').localeCompare(a.decided_at??''));
  for(const item of correctionsByDecision){
    const prior=approved.get(item.day);
    approved.set(item.day,{requested_status:prior?.requested_status??item.requested_status,
      start_at:prior?.start_at??item.start_at,end_at:prior?.end_at??item.end_at});
  }
  const days=Array.from({length:last},(_,index)=>{
    const date=addDays(first,index);
    const punch=data.rows.find(row=>row.owner_id===data.actor&&row.planned_at&&indiaDay(row.planned_at)===date);
    const amendment=approved.get(date);
    const mode=punch?.details.work_mode;
    const status=amendment?.requested_status??(punch ? mode==='Work From Home'||mode==='On Tour'?mode:'Present':
      date<today&&Boolean(data.attendance_since&&date>=data.attendance_since)&&![0,6].includes(new Date(date+'T00:00:00Z').getUTCDay())?'Absent':'—');
    return {date,punch,amendment,mode,status};
  });
  const pending=myCorrections.filter(item=>item.status==='Pending').length;
  const team=data.corrections.filter(item=>item.member_id!==data.actor);
  const accuracy=active?.details.start_evidence?.accuracy_meters??todayRow?.details.start_evidence?.accuracy_meters;
  const stats=[
    ['Present Days',days.filter(item=>['Present','Half Day'].includes(item.status)).length],
    ['Field / On-Tour Days',days.filter(item=>item.mode==='Field Work'&&['Present','Half Day'].includes(item.status)||item.status==='On Tour').length],
    ['WFH / Leaves',days.filter(item=>['Work From Home','Leave'].includes(item.status)).length],['Pending Corrections',pending],
  ] as const;
  return <>
    <section className="panel field-punch" aria-label="Today’s attendance">
      <div><h2>Today’s attendance</h2><Tone value={active?'Working day in progress':todayRow?'Workday ended':'Ready to begin'}/>
        {accuracy!=null&&<p className="muted">Location captured (±{Math.round(accuracy)} m)</p>}</div>
      <div className="field-clock" aria-label="Elapsed working time">{interval(active?.planned_at??todayRow?.planned_at??null,
        todayRow?.ended_at?Date.parse(todayRow.ended_at):now)}</div>
      <div className="lead-actions">
        {active&&data.can_update&&<button onClick={()=>onEdit({action:'finish',entry:active})}>End Working Day</button>}
        {!active&&!todayRow&&data.can_create&&<button onClick={()=>onEdit({action:'start'})}>Start Working Day</button>}
        {data.can_create&&<button className="secondary" onClick={()=>onEdit({action:'correction',day:day<=today?day:today})}>Request Correction</button>}
      </div>
    </section>
    <div className="avi-kpis" aria-label="Attendance summary">{stats.map(([title,value])=><div key={title} className="panel avi-kpi">
      <span>{title}</span><strong>{value}</strong></div>)}</div>
    {view==='Calendar'&&<section className="avi-data-card field-month" aria-label="Monthly attendance calendar">
      <h2>{monthLabel.format(new Date(first+'T00:00:00Z'))}</h2>
      <div className="field-month-grid">{weekday.map(label=><strong className="muted" key={label}>{label}</strong>)}
        {Array.from({length:(new Date(first+'T00:00:00Z').getUTCDay()+6)%7},(_,i)=><span key={i}/>)}
        {days.map(item=><div className="field-month-day" key={item.date} data-today={item.date===today}>
          <strong>{Number(item.date.slice(-2))}</strong>{item.status!=='—'&&<Tone value={item.status}/>}
        </div>)}</div>
    </section>}
    {view==='Attendance Log'&&<section className="avi-data-card avi-data-table table-scroll"><table className="lead-table">
      <thead><tr><th>Date</th><th>Status</th><th>Mode</th><th>Punch in</th><th>Punch out</th><th>Evidence</th></tr></thead>
      <tbody>{days.filter(item=>item.date<=today||item.amendment).map(item=><tr key={item.date}><td>{item.date}</td>
        <td><Tone value={item.status}/></td><td>{item.mode??'—'}</td>
        <td>{timeOnly(item.amendment?.start_at??item.punch?.planned_at)}</td>
        <td>{timeOnly(item.amendment?.end_at??item.punch?.ended_at)}</td>
        <td>{item.amendment?'Approved correction':item.punch?.details.start_evidence?.verdict??'—'}{item.punch?.details.overnight&&' · Overnight'}
          {item.punch&&['Pending Review','Rejected'].includes(item.punch.status)&&<> · <Tone value={item.punch.status}/></>}</td></tr>)}</tbody>
    </table></section>}
    {['My Corrections','Team Corrections'].includes(view)&&<section className="avi-data-card" aria-label={view}>
      {!(view==='My Corrections'?myCorrections:team).length&&<p className="field-empty">No corrections for this month.</p>}
      <ul className="field-records">{(view==='My Corrections'?myCorrections:team).map(item=>
        <li className="field-record" key={item.id}><div><strong>{item.member_name} · {item.day}</strong>
          <p>{item.requested_status??'Punch time correction'} · {timeOnly(item.start_at)} → {timeOnly(item.end_at)}</p><p>{item.justification}</p>{item.review&&<p>{item.review}</p>}</div>
          <div><Tone value={item.status}/>{view==='Team Corrections'&&item.status==='Pending'&&
            <button className="secondary" onClick={()=>onEdit({action:'review',correction:item})}>Review</button>}</div></li>)}</ul>
    </section>}
    {view==='Team Corrections'&&data.can_update&&<section className="avi-data-card field-dsr" aria-label="Attendance location exceptions">
      <h2>Attendance location exceptions</h2>
      <ul className="field-records">{data.rows.filter(row=>row.owner_id!==data.actor&&row.status==='Pending Review').map(entry=>
        <li key={entry.id} className="field-record"><strong>{entry.owner_name} · {dateTime(entry.planned_at)}</strong>
          <button className="secondary" onClick={()=>onEdit({action:'review_location',entry})}>Review Location Exception</button>
        </li>)}</ul>
    </section>}
  </>;
}

type DailyReport={attendance:{starts:string|null;ends:string|null;minutes:number|null}|null;visits:number;completed:number;verified:number;
  exceptions:number;planned:number;plans_completed:number;visit_minutes:number;contacts:number;customers:string[];leads:number;followups:number;
  quotations:number;orders:number;can_read_expenses:boolean;tomorrow:{title:string;starts:string}[];can_review:boolean;review:{feedback:string;at:string;reviewer:string}|null};
function Report({db,org,day,owner,data,revision,onEdit}:{db:FieldDb;org:string;day:string;owner:string;data:FieldSnapshot;revision:number;
  onEdit:(edit:FieldEdit)=>void}) {
  const [report,setReport]=useState<DailyReport>();
  const [error,setError]=useState('');
  const member=owner&&owner!=='me'?owner:data.actor;
  useEffect(()=>{
    let current=true;
    setReport(undefined);setError('');
    void db.rpc('field_report',{p_org:org,p_member:member,p_day:day}).then(result=>{
      if(!current)return;
      if(result.error)setError('The daily report could not be loaded.');
      else setReport(result.data as unknown as DailyReport);
    });
    return ()=>{current=false;};
  },[db,org,member,day,revision]);
  if(error)return <p role="alert" className="error">{error}</p>;
  if(!report)return <p role="status">Compiling daily report…</p>;
  return <section className="avi-data-card field-dsr" aria-label="Daily Sales Report">
    <div className="card-heading"><h2>{day} · Daily Sales Report</h2>
      {report.can_review&&!report.review&&day<=indiaDay()&&<button type="button" onClick={()=>onEdit({action:'acknowledge',owner:member,day})}>Acknowledge Report</button>}</div>
    {report.review&&<p><Tone value="Acknowledged"/> {report.review.reviewer} · {dateTime(report.review.at)} {report.review.feedback}</p>}
    <dl className="lead-facts">
      {([
        ['Punch-in / punch-out',`${timeOnly(report.attendance?.starts)} → ${timeOnly(report.attendance?.ends)}`],
        ['Hours recorded',report.attendance?.minutes==null?'—':(report.attendance.minutes/60).toFixed(2)],
        ['Planned visits completed',`${report.plans_completed} of ${report.planned}`],['Total visits completed',`${report.completed} of ${report.visits}`],
        ['Verified check-ins',report.verified],['Visits with location exceptions',report.exceptions],['Contacts met',report.contacts],
        ['Total visit time (minutes)',report.visit_minutes],['New leads generated',report.leads],['Follow-ups completed',report.followups],
        ['Quotations discussed',report.quotations],['Orders confirmed',report.orders],
      ] as const).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
    <h3>Customers visited</h3><p>{report.customers.length?report.customers.join(', '):'No customer names available.'}</p>
    {report.can_read_expenses&&<><h3>Expenses</h3><p><a href="/expenses">View recorded expenses</a></p></>}
    <h3>Tomorrow’s planned visits</h3>{report.tomorrow.length?<ul>{report.tomorrow.map((item,index)=><li key={index}>{item.title} · {timeOnly(item.starts)}</li>)}</ul>:
      <p className="muted">No visits planned.</p>}
  </section>;
}

export function FieldOperations({db,org,kind,initialPlan,onPlan,openLead}:{db:FieldDb;org:string;kind:FieldKind;
  initialPlan?:string;onPlan:(id:string)=>void;openLead:(id:string)=>void}) {
  const [snapshot,setSnapshot]=useState<FieldSnapshot>();
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [createdLead,setCreatedLead]=useState<{id:string;number:string}>();
  const [edit,setEdit]=useState<FieldEdit>();
  const [revision,refresh]=useState(0);
  const [view,setView]=useState(moduleDefault[kind]);
  const [day,setDay]=useState(indiaDay());
  const [owner,setOwner]=useState('me');
  const [pendingPlan,setPendingPlan]=useState(initialPlan);
  const [selectedPlan,setSelectedPlan]=useState<Entry>();
  const today=indiaDay();
  const planStart=weekStart(day);
  const isReport=kind==='visit'&&view==='Daily Sales Reports (DSR)';
  const monthFrom=day.slice(0,7)+'-01';
  const monthThrough=addDays(new Date(Date.UTC(Number(day.slice(0,4)),Number(day.slice(5,7)),1)).toISOString().slice(0,10),-1);
  const from=kind==='attendance_session'?monthFrom:kind==='visit_plan'?(view==='Day'?day:planStart):addDays(day,-30);
  const through=kind==='attendance_session'?monthThrough:kind==='visit_plan'?(view==='Day'?day:addDays(planStart,6)):addDays(day,60);

  useEffect(()=>{
    let current=true;
    setLoading(true);setError('');
    const query={from,through,...(owner&&owner!=='me'?{owner}:{})};
    void db.rpc('field_workspace',{p_org:org,p_kind:kind,p_query:query}).then(result=>{
      if(!current)return;
      setLoading(false);
      if(result.error){setError('This field workspace could not be loaded.');return;}
      setSnapshot(result.data as unknown as FieldSnapshot);
    });
    return ()=>{current=false;};
  },[db,org,kind,from,through,owner,revision]);
  useEffect(()=>{
    if(!pendingPlan||kind!=='visit')return;
    let active=true;
    void db.rpc('field_workspace',{p_org:org,p_kind:'visit_plan',p_query:{from:today,through:today}}).then(result=>{
      if(!active)return;
      const plan=(result.data as unknown as FieldSnapshot|null)?.rows.find(row=>row.id===pendingPlan);
      if(plan)setSelectedPlan(plan);
      else {setMessage('Today’s plan is unavailable. You can start a standalone visit.');setPendingPlan(undefined);}
    });
    return ()=>{active=false;};
  },[db,org,pendingPlan,kind,today]);
  useEffect(()=>{
    if(selectedPlan&&snapshot?.can_create){
      setEdit({action:'start',plan:selectedPlan});setPendingPlan(undefined);setSelectedPlan(undefined);
    }
  },[selectedPlan,snapshot]);

  const ownRows=snapshot?.rows.filter(row=>row.owner_id===snapshot.actor)??[];
  const active=ownRows.find(row=>row.status==='Open');
  const now=useClock(Boolean(active)&&(kind==='attendance_session'||kind==='visit'));
  const overdue=ownRows.filter(row=>row.planned_at&&Date.parse(row.planned_at)<Date.now()&&!['Completed','Cancelled'].includes(row.status));
  let rows=(owner!=='me'?snapshot?.rows:ownRows)??[];
  if(kind==='task'){
    rows=(view==='Team Tasks'?snapshot?.rows:ownRows)??[];
    if(view==='Today’s Tasks')rows=rows.filter(row=>row.planned_at&&indiaDay(row.planned_at)===day&&!['Completed','Cancelled'].includes(row.status));
    if(view==='Upcoming Tasks')rows=rows.filter(row=>row.planned_at&&indiaDay(row.planned_at)>day&&!['Completed','Cancelled'].includes(row.status));
    if(view==='Overdue Tasks')rows=overdue;
    if(view==='Completed Tasks')rows=rows.filter(row=>row.status==='Completed');
  }
  const views=kind==='attendance_session'?['Calendar','Attendance Log','My Corrections',...(snapshot?.team.length?['Team Corrections']:[])]:
    kind==='visit_plan'?['Day','Week','List']:kind==='visit'?['Visits','Daily Sales Reports (DSR)']:
      taskViews.filter(name=>name!=='Team Tasks'||Boolean(snapshot?.team.length));
  return <div className="lead-workspace avi-lead-console field-console">
    <div className="page-heading avi-lead-hero"><h1>{fieldTitles[kind]}</h1>
      {snapshot?.can_create&&kind!=='attendance_session'&&(!active||kind!=='visit')&&!isReport&&
        <button className="avi-primary avi-with-icon" type="button" onClick={()=>setEdit({action:kind==='visit'?'start':'create',day})}>
          <AviIcon name="add"/>{kind==='visit'?'Check In to Visit':kind==='visit_plan'?'Plan Visit':'Create Task'}</button>}
    </div>
    {message&&<p className="lead-feedback" role="status">{message} {createdLead&&<button className="link" onClick={()=>openLead(createdLead.id)}>View {createdLead.number} →</button>}</p>}
    <section className="avi-data-card field-toolbar" aria-label="Field views">
      <div className="avi-data-toolbar"><div className="avi-view-tabs">
        {views.map(name=><button className="secondary" type="button" key={name} aria-current={view===name?'page':undefined}
          onClick={()=>{setView(name);if(name==='Team Tasks')setOwner('');else if(kind==='task')setOwner('me');}}>
          {name}{name==='Overdue Tasks'&&overdue.length>0&&<span className="lead-badge" data-tone="lost">{overdue.length}</span>}</button>)}
      </div><button className="secondary avi-icon-button" type="button" aria-label="Refresh fields" onClick={()=>refresh(value=>value+1)}><AviIcon name="refresh"/></button></div>
      <div className="avi-data-filters">
        {kind==='attendance_session'?<label>Month<input type="month" value={day.slice(0,7)} onChange={event=>{if(event.target.value)setDay(event.target.value+'-01');}}/></label>:
          <label>{isReport?'Report date':'Date'}<input type="date" value={day} onChange={event=>{if(event.target.value)setDay(event.target.value);}}/></label>}
        <div className="lead-actions"><button className="secondary" onClick={()=>setDay(today)}>Today</button>
          {kind==='visit_plan'&&<><button className="secondary" onClick={()=>setDay(addDays(day,view==='Day'?-1:-7))}>Previous</button>
            <button className="secondary" onClick={()=>setDay(addDays(day,view==='Day'?1:7))}>Next</button></>}</div>
        {snapshot&&snapshot.team.length>0&&(kind==='visit_plan'||kind==='visit'||view==='Team Tasks')&&
          <TeamPicker team={snapshot.team} value={isReport&&owner===''?'me':owner} change={setOwner} all={!isReport}/>}
      </div>
    </section>
    {error?<p role="alert" className="error">{error}</p>:!snapshot?<p role="status">Loading field records…</p>:<>
      {loading&&<p className="muted" role="status">Refreshing…</p>}
      {kind==='attendance_session'?<Attendance data={snapshot} {...{view,day,today,now}} onEdit={setEdit}/>:
        isReport?<Report {...{db,org,day,owner,revision}} data={snapshot} onEdit={setEdit}/>:<>
        {kind==='visit'&&active&&<section className="panel field-punch" aria-label="Active visit"><div><h2>Visit in progress</h2>
          <p>{active.account_name??active.title}</p></div><div className="field-clock" aria-label="Elapsed visit time">{interval(active.planned_at,now)}</div>
          {snapshot.can_update&&<button onClick={()=>setEdit({action:'finish',entry:active})}>Check Out &amp; Complete Report</button>}</section>}
        <section className="avi-data-card" aria-label="Field records">
          {(kind==='visit_plan'&&view!=='List'||kind==='task'&&view==='Calendar View')?
            <Calendar days={view==='Day'?[day]:Array.from({length:7},(_,i)=>addDays(planStart,i))} {...{rows,kind,onPlan,today}} workspace={snapshot} onEdit={setEdit}/>:
            <Entries {...{rows,kind,onPlan,db,org,today}} workspace={snapshot} onEdit={setEdit}/>}
        </section>
      </>}
      {edit&&<FieldEntryEditor key={edit.action+(edit.entry?.id??edit.plan?.id??'')} db={db} org={org} kind={kind} edit={edit} workspace={snapshot}
        close={()=>setEdit(undefined)} onSaved={result=>{
          setEdit(undefined);setMessage(edit.action==='finish'&&kind==='visit'?'Visit report saved.':'Saved.');
          setCreatedLead(result.lead??undefined);refresh(value=>value+1);
        }}/>}
    </>}
  </div>;
}
