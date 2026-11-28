import {useEffect,useRef,useState,type FormEvent} from 'react';
import {saveField,type FieldDb} from './fieldModel';

const automations={
  assignment:'Initial outreach after lead assignment',
  visit:'Next action after visit check-out',
  demo:'Demonstration equipment return reminder',
  tender:'Tender submission reminder',
  payment:'Payment milestone reminder',
};
type Settings={radius:number;version:number;automation:Record<keyof typeof automations,boolean>};

export function FieldSettings({db,organization}:{db:FieldDb;organization:string}) {
  const [settings,setSettings]=useState<Settings>();
  const [revision,reload]=useState(0);
  const [status,setStatus]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const request=useRef<{body:string;id:string}>(undefined);
  useEffect(()=>{
    let active=true;
    void db.rpc('field_workspace',{p_org:organization,p_kind:'settings',p_query:{}}).then(result=>{
      if(!active)return;
      if(result.error)setError('Field settings could not be loaded.');
      else setSettings(result.data as unknown as Settings);
    });
    return ()=>{active=false;};
  },[db,organization,revision]);

  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!settings||busy)return;
    const body=JSON.stringify(settings);
    if(request.current?.body!==body)request.current={body,id:crypto.randomUUID()};
    setBusy(true);setError('');setStatus('');
    try {
      const result=await saveField(db,organization,'settings','save',request.current.id,settings);
      if(result.error){setError(result.error.message);return;}
      setStatus('Field settings saved.');reload(value=>value+1);
    } finally {setBusy(false);}
  }

  return <div className="field-settings">
    <h2>Field Operations</h2>
    {error&&<p className="error" role="alert">{error} <button className="link" type="button" onClick={()=>{setError('');reload(value=>value+1);}}>Reload settings</button></p>}
    {status&&<p role="status">{status}</p>}
    {settings?<form className="policy-form" onSubmit={save}>
      <label>Maximum check-in radius (metres)<input required type="number" min={25} max={10000}
        value={settings.radius} onChange={event=>setSettings({...settings,radius:Number(event.target.value)})}/></label>
      <fieldset><legend>Automatic follow-up tasks</legend><div className="field-choices">
        {(Object.keys(automations) as (keyof typeof automations)[]).map(key=><label className="lead-check" key={key}>
          <input type="checkbox" checked={settings.automation[key]} onChange={event=>setSettings({...settings,
            automation:{...settings.automation,[key]:event.target.checked}})}/>{automations[key]}
        </label>)}
      </div></fieldset>
      <button disabled={busy}>Save field settings</button>
    </form>:!error&&<p role="status">Loading field settings…</p>}
  </div>;
}
