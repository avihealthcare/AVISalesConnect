import { useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../../packages/domain/database.types';
import { RecordFiles } from './RecordFiles';
import { LeadDialog } from './LeadEditor';
import { activityTypes, dateTime, label, money, options, readFields, readTime, type LeadDetail, type LeadEvent, type Product, type Workspace } from './leadModel';

const tabs = ['Overview','Products and Requirements','Contacts','Activity Timeline','Follow-ups','Field Visits','Quotations','Demonstrations','Orders','Documents','Status History'];
const relatedTypes: Record<string,string> = {'Follow-ups':'task','Field Visits':'visit','Quotations':'quotation','Demonstrations':'demo','Orders':'financial_reference'};
const recordLabels: Record<string,string> = { task:'Follow-up',visit:'Visit',quotation:'Quotation',demo:'Demonstration',financial_reference:'Order' };
const relatedEvents: Record<string,string[]> = {'Follow-ups':['Follow-up','Follow-up scheduled'],'Field Visits':['Visit'],'Quotations':['Quotation'],
  'Demonstrations':['Demonstration'],'Orders':['Order']};

function Facts({ rows }: { rows: [string,string | number | null | undefined][] }) {
  return <dl className="lead-facts">{rows.map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{value ?? '—'}</dd></div>)}</dl>;
}
function ProductRows({ rows }: { rows: Product[] }) {
  return rows.length ? <div className="table-scroll"><table className="lead-table"><thead><tr>
    <th scope="col">Category</th><th scope="col">Model</th><th scope="col">Quantity</th><th scope="col">Estimated unit price</th><th scope="col">Specifications</th>
  </tr></thead><tbody>{rows.map((product,index) => <tr key={index}>
    <td>{product.category}</td><td>{product.model}</td><td>{product.quantity}</td><td>{money(product.estimated_unit_price)}</td><td>{product.requirements || '—'}</td>
  </tr>)}</tbody></table></div> : <p className="muted">No itemized products.</p>;
}
function Timeline({ events, workspace }: { events: LeadEvent[]; workspace: Workspace }) {
  return events.length ? <ul className="lead-timeline">{events.map((entry,index) => {
    const details = entry.details;
    return <li key={index}><div><strong>{entry.kind}</strong><span>{dateTime(entry.occurred_at)}{entry.actor && ` · ${entry.actor}`}</span></div>
      {details.summary && <p>{details.summary}</p>}
      {details.notes && <p>{details.notes}</p>}
      {details.stage && <p>{details.previous_stage && `${label(workspace,'stage',String(details.previous_stage))} → `}{label(workspace,'stage',String(details.stage))}</p>}
      {['Assignment','Staff handover'].includes(entry.kind) && <p>{details.previous_owner ?? 'Unassigned'} → {details.new_owner ?? 'Unassigned'}</p>}
      {details.due_at && <p>Due {dateTime(String(details.due_at))}</p>}
      {details.inquiry && <p>Original inquiry {details.inquiry}</p>}
      {details.loss_reason && <p>{label(workspace,'loss',String(details.loss_reason))}</p>}
      {details.reason && <p>{details.reason}</p>}
    </li>;
  })}</ul> : <p className="muted">No activity recorded.</p>;
}

export function StageChange({ workspace, lead, onClose, save, busy, error }: {
  workspace: Workspace; lead: LeadDetail; onClose: () => void; save: (action: string, input: Json) => Promise<void>; busy: boolean; error: string;
}) {
  const behavior = workspace.catalog.find(item => item.kind === 'stage' && item.code === lead.data.sales_stage)?.behavior;
  const reopen = ['won','lost','closed'].includes(behavior ?? '');
  const available = options(workspace,'stage').filter(item => item.code !== lead.data.sales_stage &&
    (!reopen || !['won','lost','closed'].includes(item.behavior ?? '')));
  const [stage, setStage] = useState('');
  const lost = available.find(item => item.code === stage)?.behavior === 'lost';
  const closed = available.find(item => item.code === stage)?.behavior === 'closed';
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = readFields(event.currentTarget);
    void save(reopen ? 'reopen' : 'stage',{ ...values,follow_up:readTime(values.follow_up),id:lead.data.id,version:lead.data.row_version });
  }
  return <LeadDialog title={reopen ? 'Reopen Lead' : 'Change Sales Stage'} onClose={onClose}>
    <form className="lead-form" onSubmit={submit}>
      <label>Move to stage<select name="stage" value={stage} onChange={event => setStage(event.target.value)} required>
        <option value="">Select stage</option>{available.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}
      </select></label>
      {lost && <label>Lost lead reason<select name="loss_reason" required defaultValue="">
        <option value="">Select reason</option>{options(workspace,'loss').map(item => <option key={item.code} value={item.code}>{item.label}</option>)}
      </select></label>}
      {lost && <label>Competitor<input name="competitor" defaultValue={lead.data.competitor ?? ''} maxLength={200} /></label>}
      <label>{reopen ? 'Reopening reason' : 'Reason'}<textarea name="reason" maxLength={1000} required={reopen || closed} /></label>
      <label>Next action<input name="next_action" maxLength={500} defaultValue={lead.data.next_action ?? ''} /></label>
      <label>Next follow-up date (device time)<input name="follow_up" type="datetime-local" /></label>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="lead-form-actions"><button className="secondary" type="button" onClick={onClose}>Cancel</button>
        <button disabled={busy}>{reopen ? 'Reopen Lead' : 'Update Stage'}</button></div>
    </form>
  </LeadDialog>;
}

export function LeadDetailView({ db, organization, lead, workspace, tab, setTab, back, edit, changeStage, mutate, busy, error }: {
  db: SupabaseClient<Database>; organization: string; lead: LeadDetail; workspace: Workspace; tab: string; setTab: (tab: string) => void;
  back: () => void; edit: () => void; changeStage: () => void; mutate: (action: string,input: Json) => Promise<boolean>; busy: boolean; error: string;
}) {
  const {data} = lead;
  const stage = workspace.catalog.find(item => item.kind === 'stage' && item.code === data.sales_stage);
  const isClosed = ['won','lost','closed'].includes(stage?.behavior ?? '');
  const timeline=[...lead.timeline,...lead.related.map(record=>({
    kind:recordLabels[record.kind],occurred_at:record.created_at,actor:null,
    details:{summary:record.title,notes:[record.status,record.reference].filter(Boolean).join(' · ')},
  }))].sort((first,second)=>Date.parse(second.occurred_at)-Date.parse(first.occurred_at));
  const [logging, setLogging] = useState(false);
  const [merge, setMerge] = useState<string>();
  const [convertNotice, setConvertNotice] = useState('');
  const [converting, setConverting] = useState(false);
  function log(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = readFields(event.currentTarget);
    void mutate('activity',{id:data.id,version:data.row_version,kind:values.kind,summary:values.summary,occurred_at:readTime(values.occurred_at)})
      .then(success => { if (success) setLogging(false); });
  }
  async function convert() {
    setConverting(true);
    const {error} = await db.rpc('progress_lead',{p_org:organization,p_id:data.id,p_key:crypto.randomUUID(),p_version:data.row_version,p_action:'convert',p_input:{}});
    setConverting(false);
    setConvertNotice(error ? 'Could not create the opportunity. Check that you own the linked customer and refresh the lead.' : 'Opportunity created.');
    if (!error) await mutate('refresh',{});
  }
  return <>
    <button className="link lead-back" type="button" onClick={back}>← Back to leads</button>
    <section className="panel lead-profile">
      <div className="page-heading"><div>
        <p className="lead-number">{lead.number}</p><h1>{data.prospect_name}</h1>
        <div className="lead-tags"><span className="lead-badge" data-tone={stage?.behavior}>{stage?.label ?? data.sales_stage}</span>
          <span className="lead-badge" data-tone={data.priority.toLowerCase()}>{data.priority}</span>
          <span>{lead.owner_name ?? 'Unassigned'}</span><strong>{money(data.expected_value)}</strong></div>
      </div><div className="lead-actions">
        {lead.can_edit && <button className="secondary" type="button" onClick={edit}>Edit Lead</button>}
        {lead.can_edit && (!isClosed || lead.can_reopen) && <button type="button" onClick={changeStage}>{isClosed ? 'Reopen Lead' : 'Change Stage'}</button>}
      </div></div>
      <nav aria-label="Lead details" className="lead-detail-tabs">{tabs.map(name =>
        <button className="secondary" type="button" key={name} aria-current={tab === name ? 'page' : undefined}
          onClick={() => { setLogging(false); setTab(name); }}>{name}</button>)}</nav>
      {tab === 'Overview' && <>
        <h2>Overview</h2>
        <Facts rows={[
          ['Lead source',label(workspace,'source',data.source_key)], ['External inquiry reference',data.external_reference],
          ['Customer type',data.customer_type], ['Location',[data.city,data.state,data.country].filter(Boolean).join(', ') || null],
          ['Territory',workspace.territories.find(item => item.id === lead.territory)?.name], ['Created',dateTime(data.ingested_at)],
          ['Received',dateTime(data.received_at)], ['Created by',lead.created_name], ['Last updated',dateTime(data.updated_at)],
          ['Last updated by',lead.updated_name], ['Estimated budget',money(data.budget)], ['Expected order value',money(data.expected_value)],
          ['Estimated conversion probability',data.probability === null ? null : `${data.probability}%`], ['Expected purchase date',data.expected_purchase_on],
          ['Competitor',data.competitor], ['Lost reason',data.loss_reason ? label(workspace,'loss',data.loss_reason) : null],
        ]} />
        {data.description && <><h3>Description</h3><p className="requirement">{data.description}</p></>}
        {lead.can_edit && data.lifecycle === 'Qualified' && data.account_id && <button type="button" className="secondary"
          disabled={converting || busy} onClick={() => void convert()}>Create Opportunity</button>}
        {convertNotice && <p role="status">{convertNotice}</p>}
        {lead.duplicates.length > 0 && <section className="lead-section"><h3>Potential duplicates</h3>
          <p className="muted">Compare the inquiry, contact, and equipment details before merging.</p>
          <div className="table-scroll"><table className="lead-table"><thead><tr><th scope="col">Inquiry</th><th scope="col">Hospital</th>
            <th scope="col">Contact</th><th scope="col">Equipment requirement</th><th scope="col">Match</th>
            {workspace.can_manage && <th scope="col">Action</th>}</tr></thead><tbody>
            {lead.duplicates.map(candidate => <tr key={candidate.id}><td>{candidate.number}<small>{label(workspace,'source',candidate.source)}</small></td>
              <td>{candidate.customer}<small>{candidate.city}</small></td><td>{candidate.contact}<small>{[candidate.mobile,candidate.email].filter(Boolean).join(' · ')}</small></td>
              <td>{candidate.requirements || '—'}</td><td>{candidate.match}</td>
              {workspace.can_manage && <td><button className="secondary" type="button" onClick={() => setMerge(candidate.id)}>Review Merge</button></td>}</tr>)}
          </tbody></table></div>
        </section>}
        {lead.inquiries.length > 0 && <section className="lead-section"><h3>Original merged inquiries</h3>
          {lead.inquiries.map(inquiry => <details key={inquiry.number}>
            <summary>{inquiry.number} · {inquiry.customer}</summary>
            <p>{label(workspace,'source',inquiry.source)} · {dateTime(inquiry.received_at)}{inquiry.external_reference && ` · ${inquiry.external_reference}`}</p>
            {inquiry.description && <p className="requirement">{inquiry.description}</p>}
            {inquiry.requirements && <p className="requirement">{inquiry.requirements}</p>}
            <ProductRows rows={inquiry.products} />
          </details>)}</section>}
      </>}
      {tab === 'Products and Requirements' && <><h2>{tab}</h2><ProductRows rows={lead.products} />{data.requirement_text && <p className="requirement">{data.requirement_text}</p>}</>}
      {tab === 'Contacts' && <><h2>Contacts</h2><Facts rows={[
        ['Contact person',data.contact_person],['Designation',data.designation],['Mobile',data.mobile],
        ['Alternate mobile',data.alternate_mobile],['Email',data.email],['Original contact route',data.contact_route],
        ['Missing contact reason',data.missing_contact_reason],
      ]} /></>}
      {tab === 'Activity Timeline' && <><div className="card-heading"><h2>{tab}</h2>
        {lead.can_edit && <button className="secondary" type="button" onClick={() => setLogging(!logging)}>Log Activity</button>}</div>
        {logging && <form onSubmit={log} className="lead-inline-form">
          <label>Activity type<select name="kind">{activityTypes.map(kind => <option key={kind}>{kind}</option>)}</select></label>
          <label>Occurred at (device time)<input name="occurred_at" type="datetime-local" /></label>
          <label className="lead-span">Activity summary<textarea name="summary" required maxLength={2000} /></label>
          <button disabled={busy} type="submit">Save Activity</button>
        </form>}
        <Timeline events={timeline} workspace={workspace} /></>}
      {tab === 'Status History' && <><h2>{tab}</h2><Timeline workspace={workspace}
        events={lead.timeline.filter(event => ['Inquiry created','Stage change','Reopened','Assignment','Merge','Staff handover','Lead converted'].includes(event.kind))} /></>}
      {relatedTypes[tab] && <><h2>{tab}</h2>
        {tab === 'Follow-ups' && <Facts rows={ [['Next action',data.next_action],['Next follow-up',dateTime(data.next_action_due_at)]] } />}
        {lead.related.some(item => item.kind === relatedTypes[tab]) && <ul className="records">{lead.related.filter(item => item.kind===relatedTypes[tab]).map(item =>
          <li key={item.id}><strong>{item.title}</strong><p>{item.status} · {dateTime(item.planned_at ?? item.created_at)}{item.reference && ` · ${item.reference}`}</p></li>)}</ul>}
        <Timeline workspace={workspace} events={lead.timeline.filter(event => relatedEvents[tab].includes(event.kind))} />
      </>}
      {tab === 'Documents' && <><h2>Documents</h2>
        {(lead.can_attach || lead.can_download) ? <RecordFiles db={db} organization={organization} record={data.id} canUpload={lead.can_attach} />
          : <p className="muted">Your file permissions do not allow viewing or uploading attachments for this lead.</p>}
      </>}
    </section>
    {merge && <LeadDialog title="Merge Duplicate Inquiry" onClose={() => setMerge(undefined)}>
      <form className="lead-form" onSubmit={event => {
        event.preventDefault();
        const values=readFields(event.currentTarget);
        const candidate=lead.duplicates.find(item => item.id===merge);
        if (!candidate) return;
        void mutate('merge',{id:data.id,version:data.row_version,other_id:candidate.id,other_version:candidate.version,reason:values.reason})
          .then(success => { if (success) setMerge(undefined); });
      }}>
        <p>Keep <strong>{lead.number} · {data.prospect_name}</strong> as the main lead. The duplicate’s original inquiry, products, and activity history remain available here.</p>
        <Facts rows={ [['Duplicate',lead.duplicates.find(item=>item.id===merge)?.number],['Matched by',lead.duplicates.find(item=>item.id===merge)?.match]] } />
        <label>Merge reason<textarea name="reason" required maxLength={1000} /></label>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="lead-form-actions"><button className="secondary" type="button" onClick={() => setMerge(undefined)}>Cancel</button>
          <button disabled={busy} type="submit">Merge Leads</button></div>
      </form>
    </LeadDialog>}
  </>;
}
