import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '../../../packages/domain/database.types';
import {LeadDialog} from './LeadEditor';
import {AviIcon} from './AviIcon';
import {dateTime,readFields} from './leadModel';
import {StaffAdministration} from './StaffAdministration';

export const moduleGroups=[
  {name:'CRM & Pipeline',modules:[['dashboard','Dashboard'],['leads','Leads'],['customers','Customers'],['opportunities','Opportunities']]},
  {name:'Field Operations',modules:[['attendance','Attendance'],['field_visits','Field Visits'],['visit_planner','Visit Planner'],['follow_ups','Follow-ups and Tasks']]},
  {name:'Catalog & Sales',modules:[['products','Products'],['equipment','Installed Equipment'],['demonstrations','Demonstrations'],['quotations','Quotations'],['orders','Sales Orders']]},
  {name:'Operations & Reports',modules:[['tenders','Tenders'],['expenses','Expenses'],['targets','Sales Targets'],['reports','Reports']]},
] as const;
const allModules=moduleGroups.flatMap(group=>group.modules.map(([id])=>id));
const labels:ReadonlyMap<string,string>=new Map(moduleGroups.flatMap(group=>group.modules.map(([id,name])=>[id,name] as const)));
type Member={id:string;name:string;email:string|null;designation:string|null;region:string|null;admin:boolean;modules:string[];
  active:boolean;password_pending:boolean;self:boolean;last_login:string|null};
type Mode={action:'create'}|{action:'update'|'reset'|'activate'|'deactivate';member:Member};

function strongPassword() {
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return 'A7!'+Array.from(crypto.getRandomValues(new Uint8Array(17)),byte=>alphabet[byte%alphabet.length]).join('');
}

export function UserManagement({db,organization,onChanged}:{db:SupabaseClient<Database>;organization:string;onChanged:()=>void}) {
  const [users,setUsers]=useState<Member[]>();
  const [search,setSearch]=useState('');
  const [revision,refresh]=useState(0);
  const [mode,setMode]=useState<Mode>();
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const pending=useRef(false);
  useEffect(()=>{
    let current=true;
    void db.rpc('workspace_user_directory',{p_org:organization}).then(result=>{
      if(!current)return;
      if(result.error)setError('Unable to load User Management.');
      else setUsers(result.data as unknown as Member[]);
    });
    return ()=>{current=false;};
  },[db,organization,revision]);
  const rows=users?.filter(member=>[member.name,member.email,member.designation,member.region].some(value=>
    value?.toLowerCase().includes(search.trim().toLowerCase())));
  function start(next:Mode){setMode(next);setError('');setNotice('');}
  async function save(body:Record<string,unknown>) {
    if(!mode||pending.current)return;
    pending.current=true;setBusy(true);setError('');
    try {
      const result=await db.functions.invoke('admin-users',{method:mode.action==='create'?'POST':'PATCH',
        body:{organization,action:mode.action,id:'member' in mode?mode.member.id:null,...body}});
      if(result.error){
        const context=result.error.context;
        const serverError=context instanceof Response?await context.json().catch(()=>null):null;
        setError(serverError?.error??'Unable to confirm the user change. Refresh the directory.');
        return;
      }
      setNotice(mode.action==='create'?'User created. Share the temporary password through a private channel.':
        mode.action==='reset'?'Temporary password saved. The user must choose a new password when signing in.':'User access updated.');
      setMode(undefined);refresh(value=>value+1);onChanged();
    } catch {setError('Unable to confirm the user change. Refresh the directory.');}
    finally {pending.current=false;setBusy(false);}
  }
  return <div className="lead-workspace avi-lead-console">
    <div className="page-heading avi-lead-hero"><h1>User Management</h1>
      <button className="avi-primary avi-with-icon" type="button" onClick={()=>start({action:'create'})}><AviIcon name="add"/>Create New User</button></div>
    {notice&&<p role="status" className="lead-feedback">{notice}</p>}
    {!mode&&error&&<p role="alert" className="error">{error} <button className="link" onClick={()=>{setError('');refresh(value=>value+1);}}>Retry</button></p>}
    <section className="avi-data-card" aria-label="Users">
      <div className="avi-data-filters"><label className="avi-record-search"><AviIcon name="search"/><input type="search"
        aria-label="Search users" placeholder="Search name, email, designation or region…" value={search} onChange={event=>setSearch(event.target.value)}/></label></div>
      {!users&&!error&&<p className="lead-feedback" role="status">Loading users…</p>}
      {rows&&<div className="avi-data-table table-scroll"><table className="lead-table"><thead><tr>
        <th>User Name &amp; Email</th><th>Designation &amp; Region</th><th>Role</th><th>Module Access</th><th>Status</th><th>Last Login</th><th>Actions</th>
      </tr></thead><tbody>{rows.map(member=><tr key={member.id}>
        <td><strong>{member.name}{member.self?' (you)':''}</strong><small>{member.email}</small></td>
        <td>{member.designation??'—'}<small>{member.region}</small></td>
        <td><span className="lead-badge" data-tone={member.admin?'active':'hold'}>{member.admin?'Admin':'Standard User'}</span></td>
        <td title={member.modules.map(item=>labels.get(item)??item).join(', ')}>{member.modules.length} of {allModules.length} modules</td>
        <td><span className="lead-badge" data-tone={member.active?'won':'hold'}>{member.password_pending?'Password setup':member.active?'Active':'Inactive'}</span></td>
        <td>{member.last_login?dateTime(member.last_login):'—'}</td>
        <td><div className="lead-actions">
          <button className="secondary" type="button" onClick={()=>start({action:'update',member})}>Edit Permissions</button>
          {!member.self&&(member.active||member.password_pending)&&<button className="secondary" type="button" onClick={()=>start({action:'reset',member})}>Reset Password</button>}
          {!member.self&&!member.password_pending&&<button className="secondary" type="button" onClick={()=>start({action:member.active?'deactivate':'activate',member})}>
            {member.active?'Deactivate':'Activate'}</button>}
        </div></td>
      </tr>)}</tbody></table>{!rows.length&&<p className="lead-feedback">No matching users.</p>}</div>}
    </section>
    <details className="panel"><summary>Staff handover</summary><StaffAdministration db={db} organization={organization}/></details>
    {mode&&<UserEditor mode={mode} close={()=>{if(!busy){setMode(undefined);setError('');}}} save={save} busy={busy} error={error}/>}
  </div>;
}

function UserEditor({mode,close,save,busy,error}:{mode:Mode;close:()=>void;save:(data:Record<string,unknown>)=>Promise<void>;busy:boolean;error:string}) {
  const member='member' in mode?mode.member:undefined;
  const [admin,setAdmin]=useState(member?.admin??false);
  const [modules,setModules]=useState<string[]>(member?.modules??['dashboard']);
  const [password,setPassword]=useState('');
  const [visible,showPassword]=useState(false);
  const details=mode.action==='create'||mode.action==='update';
  const temporary=mode.action==='create'||mode.action==='reset';
  const names={create:'Create New User',update:'Edit Permissions',reset:'Reset Password',activate:'Activate User',deactivate:'Deactivate User'};
  const chosen=admin?allModules:modules;
  function toggle(ids:readonly string[]) {
    setModules(current=>ids.every(id=>current.includes(id))?current.filter(id=>!ids.includes(id)):[...new Set([...current,...ids])]);
  }
  function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save({...readFields(event.currentTarget),admin,modules:chosen,...(temporary?{password}:{})});
  }
  return <LeadDialog title={names[mode.action]} onClose={close}>
    <form className="lead-form" onSubmit={submit}>
      <fieldset disabled={busy}><legend>{details?'Account Details':member?.name}</legend>
        {details&&<div className="lead-form-grid">
          <label>Full name<input name="name" defaultValue={member?.name} required maxLength={200}/></label>
          <label>Email address<input type="email" name="email" defaultValue={member?.email??''} readOnly={Boolean(member)} required maxLength={254}/></label>
          <label>Designation<input name="designation" defaultValue={member?.designation??''} maxLength={120}/></label>
          <label>Territory or region<input name="region" defaultValue={member?.region??''} maxLength={120}/></label>
          <label>Role<select value={admin?'admin':'user'} onChange={event=>setAdmin(event.target.value==='admin')} disabled={member?.self}>
            <option value="user">Standard User</option><option value="admin">Admin</option></select></label>
        </div>}
        {temporary&&<><label>Temporary password<input type={visible?'text':'password'} autoComplete="new-password"
          required minLength={8} maxLength={128} value={password} onChange={event=>setPassword(event.target.value)}/></label>
          <div className="lead-actions"><button className="secondary" type="button" aria-pressed={visible} onClick={()=>showPassword(!visible)}>
            {visible?'Hide Password':'Show Password'}</button>
          <button className="secondary" type="button" onClick={()=>{setPassword(strongPassword());showPassword(true);}}>Generate Strong Password</button></div></>}
        {!details&&!temporary&&<p>{mode.action==='deactivate'?'Deactivate access for':'Restore access for'} {member?.name}?</p>}
      </fieldset>
      {details&&<section><div className="card-heading"><h3>Module Access</h3>
        <button className="secondary" type="button" disabled={admin||busy} onClick={()=>toggle(allModules)}>
          {allModules.every(id=>chosen.includes(id))?'Deselect All Modules':'Select All Modules'}</button></div>
        {admin&&<p className="lead-feedback">Admins automatically have full access to all modules and all organizational leads.</p>}
        <div className="user-module-matrix">{moduleGroups.map(group=>{
          const ids=group.modules.map(([id])=>id);
          return <fieldset className="customer-360-card" disabled={admin||busy} key={group.name}><legend>{group.name}</legend>
            <button className="secondary" type="button" onClick={()=>toggle(ids)}>{ids.every(id=>chosen.includes(id))?'Deselect All':'Select All'}</button>
            {group.modules.map(([id,name])=><label className="lead-check" key={id}><input type="checkbox"
              checked={chosen.includes(id)} onChange={()=>toggle([id])}/>{name}</label>)}</fieldset>;
        })}</div>
      </section>}
      {error&&<p className="error" role="alert">{error}</p>}
      <div className="lead-form-actions"><button className="secondary" type="button" disabled={busy} onClick={close}>Cancel</button>
        <button disabled={busy}>{busy?'Saving…':names[mode.action]}</button></div>
    </form>
  </LeadDialog>;
}
