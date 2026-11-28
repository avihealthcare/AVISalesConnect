import {useState,type ChangeEvent} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '../../../packages/domain/database.types';
import {LeadDialog} from './LeadEditor';
import {readCsv} from './LeadImport';
import {downloadWorkbook,readLeadWorkbook} from './spreadsheets';
import {accountSegments,accountSubtypes,telephone} from './customerModel';

const fields=['name','segment','sub_type','city','state','phone','gstin','drug_license_no'] as const;
type Input={number:number;fields:Record<string,string>;error?:string;key:string;saved?:boolean};

export function CustomerImport({db,organization,close,refresh}:{
  db:SupabaseClient<Database>;organization:string;close:()=>void;refresh:()=>void;
}) {
  const [rows,setRows]=useState<Input[]>([]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const pending=rows.filter(row=>!row.error&&!row.saved);
  async function review(event:ChangeEvent<HTMLInputElement>) {
    const file=event.target.files?.[0];
    setRows([]);setMessage('');
    if(!file)return;
    setBusy(true);
    try {
      if(file.size>1024*1024||!/\.(csv|xls|xlsx)$/i.test(file.name))throw new Error('Choose a CSV or Excel file under 1 MB.');
      const bytes=await file.arrayBuffer();
      const parsed=/\.csv$/i.test(file.name)?{data:readCsv(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),
        formulas:new Set<number>(),firstRow:1}:await readLeadWorkbook(bytes);
      const [head=[],...data]=parsed.data;
      const header=head.map(item=>item.trim().toLowerCase());
      if(!header.includes('name')||!header.includes('segment')||new Set(header).size!==header.length||
        data.length>250)throw new Error('Use the template headers and include up to 250 rows.');
      const seen=new Set<string>();
      setRows(data.flatMap((cells,index)=>{
        if(!cells.some(cell=>cell.trim())&&!parsed.formulas.has(index+1))return [];
        const values=Object.fromEntries(fields.map(key=>[key,cells[header.indexOf(key)]?.trim()??'']));
        const segment=accountSegments.find(item=>item===values.segment);
        const key=[values.name,values.city,values.state].join('|').toLowerCase();
        const problem=parsed.formulas.has(index+1)?'Replace formulas with values.'
          :cells.length!==header.length?'Review the column count.'
          :!values.name||values.name.length>200?'Enter an account name up to 200 characters.'
          :!segment?'Choose a category from the template.'
          :values.sub_type&&!accountSubtypes[segment].includes(values.sub_type)?'Choose a sub-type for this category.'
          :values.phone&&!telephone(values.phone)?'Enter a valid phone number.'
          :values.gstin&&!/^[0-9A-Z]{15}$/i.test(values.gstin)?'Enter a valid 15-character GSTIN.'
          :seen.has(key)?'Duplicate account in this file.':undefined;
        if(!problem)seen.add(key);
        return [{number:parsed.firstRow+index+1,fields:{...values,gstin:values.gstin.toUpperCase(),status:'Prospect',lifecycle:'Prospect',
          category:segment==='Dealer / Distributor'?'Distributor':segment==='Government / Tender Body'?'Government Department':'Private Hospital'},error:problem,key:crypto.randomUUID()}];
      }));
    } catch(error){setMessage(error instanceof Error?error.message:'Unable to read the file.');}
    finally {setBusy(false);}
  }
  async function save() {
    if(busy||!pending.length)return;
    setBusy(true);setMessage('');
    let count=0;
    try {
      for(const row of pending){
        const result=await db.rpc('command_customer_master',{p_org:organization,p_action:'create',p_key:row.key,p_input:{fields:row.fields}});
        if(result.error){
          if(['PT409','22023','23505','23514'].includes(result.error.code)){
            setRows(current=>current.map(item=>item.key===row.key?{...item,error:'Customer already exists or the details need review.'}:item));
            continue;
          }
          setMessage(`Import paused at row ${row.number}. Retry to continue.`);return;
        }
        count++;
        setRows(current=>current.map(item=>item.key===row.key?{...item,saved:true}:item));
      }
      setMessage(`${count} customer records saved.`);
    } catch {setMessage('Unable to confirm the import. Retry remaining rows.');}
    finally {if(count)refresh();setBusy(false);}
  }
  return <LeadDialog title="Import Customers" onClose={()=>{if(!busy)close();}}>
    <div className="lead-form"><p>Upload a CSV or Excel file using the template. Each row creates one customer account.</p>
      <button className="secondary" type="button" onClick={()=>void downloadWorkbook([[...fields],
        ['Example account','Healthcare Institution','Clinic','','','','','']],'Customers','customer-import-template.xlsx')
        .catch(()=>setMessage('Template download failed.'))}>Download template</button>
      <label>Customer file<input type="file" disabled={busy} accept=".csv,.xls,.xlsx" onChange={review}/></label>
      {rows.length>0&&<div className="table-scroll"><table className="lead-table"><thead><tr><th>Row</th><th>Account</th><th>Review</th></tr></thead>
        <tbody>{rows.map(row=><tr key={row.key}><td>{row.number}</td><td>{row.fields.name}</td><td>{row.saved?'Saved':row.error??'Ready'}</td></tr>)}</tbody>
      </table></div>}
      {message&&<p role="status">{message}</p>}
      <button type="button" disabled={busy||!pending.length} onClick={()=>void save()}>Import {pending.length} customers</button>
    </div>
  </LeadDialog>;
}
