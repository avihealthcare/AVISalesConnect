import {useEffect,useRef,useState} from 'react';
import {saveField,type FieldDb,type FieldSnapshot} from './fieldModel';

export function ProvisionalCustomer({db,org,id,onVerified}:{db:FieldDb;org:string;id:string;onVerified:()=>void}) {
  const [canVerify,setCanVerify]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const operation=useRef<string>(undefined);
  useEffect(()=>{
    let active=true;
    void db.rpc('field_workspace',{p_org:org,p_kind:'visit',p_query:{account:id}}).then(result=>{
      if(active&&!result.error)setCanVerify(Boolean((result.data as unknown as FieldSnapshot).can_verify_customer));
    });
    return ()=>{active=false;};
  },[db,org,id]);
  if(!canVerify)return null;
  return <div><button className="secondary" type="button" disabled={busy} onClick={async()=>{
    if(busy)return;
    setBusy(true);setError('');
    operation.current??=crypto.randomUUID();
    try {
      const result=await saveField(db,org,'visit','verify_customer',operation.current,{id});
      if(result.error)setError(result.error.message);
      else onVerified();
    } catch {setError('Verification could not be confirmed. Try again.');}
    finally {setBusy(false);}
  }}>Verify Customer</button>{error&&<p className="error" role="alert">{error}</p>}</div>;
}
