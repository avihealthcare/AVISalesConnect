import {useEffect,useState} from 'react';
import {addDays,dateTime,indiaDay,type Entry,type FieldDb,type FieldSnapshot} from './fieldModel';

export function FieldLinkedRecords({db,org,id,linkedBy,kind}:{db:FieldDb;org:string;id:string;
  linkedBy:'lead'|'account';kind:'visit'|'task'}) {
  const [period,setPeriod]=useState(0);
  const through=addDays(indiaDay(),-90*period);
  const from=addDays(through,-89);
  const [rows,setRows]=useState<Entry[]>();
  useEffect(()=>{
    let active=true;
    setRows(undefined);
    void db.rpc('field_workspace',{p_org:org,p_kind:kind,p_query:{[linkedBy]:id,...(kind==='visit'?{from,through}:{})}}).then(result=>{
      if(active&&!result.error)setRows((result.data as unknown as FieldSnapshot).rows);
    });
    return ()=>{active=false;};
  },[db,org,id,kind,linkedBy,from,through]);
  if(!rows)return null;
  const visible=kind==='task'?rows.filter(row=>!['Completed','Cancelled'].includes(row.status)&&row.planned_at&&indiaDay(row.planned_at)>=indiaDay())
    .sort((a,b)=>(a.planned_at??'').localeCompare(b.planned_at??'')):rows;
  const title=kind==='task'?'Upcoming Tasks':'Visit History';
  return <section className="lead-section" aria-label={title}>
    <div className="card-heading"><h3>{title}</h3>
      {kind==='visit'&&<div className="lead-actions">
        <button className="secondary" type="button" disabled={!period} onClick={()=>setPeriod(value=>value-1)}>Newer</button>
        <button className="secondary" type="button" onClick={()=>setPeriod(value=>value+1)}>Older</button>
      </div>}
    </div>
    {kind==='visit'&&<p className="muted">{from} – {through}</p>}
    {visible.length?<ul className="records">{visible.map(row=><li key={row.id}><strong>{row.title}</strong>
      <p>{row.status} · {dateTime(row.planned_at)}{row.owner_name&&' · '+row.owner_name}</p>
      {row.details.outcome&&<p>{row.details.outcome}</p>}</li>)}</ul>:<p className="muted">{kind==='task'?'No upcoming tasks.':'No recent visits.'}</p>}
  </section>;
}
