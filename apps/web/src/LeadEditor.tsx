import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Json } from '../../../packages/domain/database.types';
import { dateTime, inputTime, label, options, priorities, readFields, readTime,
  type LeadDetail, type Product, type Workspace } from './leadModel';

export function LeadDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const current = dialog.current; current?.showModal(); return () => current?.close(); }, []);
  return <dialog ref={dialog} className="lead-dialog" aria-labelledby="lead-dialog-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="lead-dialog-header"><h2 id="lead-dialog-title">{title}</h2>
      <button className="secondary lead-close" type="button" aria-label="Close dialog" onClick={onClose}>×</button>
    </div>
    {children}
  </dialog>;
}

const newProduct = (): Product => ({ category:'',model:'',quantity:'1',estimated_unit_price:'',requirements:'' });
export function LeadEditor({ workspace, lead, save, onClose, busy, error }: {
  workspace: Workspace; lead?: LeadDetail; save: (payload: Json) => Promise<void>; onClose: () => void; busy: boolean; error: string;
}) {
  const data = lead?.data;
  const [products, setProducts] = useState(() => lead?.products.map(product => ({ id:crypto.randomUUID(), product })) ?? []);
  const [stage, setStage] = useState(data?.sales_stage ?? 'new');
  const [routing, setRouting] = useState('self');
  const [attachments, setAttachments] = useState(false);
  const behavior = workspace.catalog.find(item => item.kind === 'stage' && item.code === stage)?.behavior;
  const previousBehavior = workspace.catalog.find(item => item.kind === 'stage' && item.code === data?.sales_stage)?.behavior;
  const closed = data && (['won','lost','closed'].includes(previousBehavior ?? ''));
  const oldRoute = data && !data.mobile && !data.alternate_mobile && !data.email ? data.contact_route ?? '' : '';
  const [localError, setLocalError] = useState('');

  function updateProduct(id: string, field: keyof Product, value: string) {
    setProducts(current => current.map(row => row.id === id ? { ...row,product:{ ...row.product,[field]:value } } : row));
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError('');
    const values = readFields(event.currentTarget);
    if (!values.mobile && !values.alternate_mobile && !values.email && !values.missing_contact_reason) {
      setLocalError('Enter a phone number or email, or explain why contact details are missing.');
      return;
    }
    values.follow_up = readTime(values.follow_up);
    if (!data) values.received_at = readTime(values.received_at);
    if (closed) values.stage = data.sales_stage;
    if (data?.account_id && !workspace.accounts.some(account => account.id === data.account_id)) delete values.account;
    if (lead?.territory && !workspace.territories.some(item => item.id === lead.territory)) delete values.territory;
    void save({ id:data?.id ?? null, version:data?.row_version ?? null, fields:values,
      products:products.map(row => row.product), open_documents:attachments });
  }

  return <LeadDialog title={lead ? `Edit ${lead.number}` : 'Add New Lead'} onClose={onClose}>
    <form onSubmit={submit} className="lead-form">
      <section aria-labelledby="lead-inquiry-fields"><h3 id="lead-inquiry-fields">Inquiry</h3>
        <div className="lead-form-grid">
          <label>Lead number<input value={lead?.number ?? 'Assigned when saved'} readOnly /></label>
          <label>Creation date and time<input value={data ? dateTime(data.ingested_at) : 'Recorded when saved'} readOnly /></label>
          {!lead && <label>Received at (device time)<input name="received_at" type="datetime-local" /></label>}
          <label>Lead source<select name="source" defaultValue={data?.source_key ?? ''} required>
            <option value="" disabled>Select a source</option>
            {options(workspace,'source',data?.source_key).map(item => <option key={item.code} value={item.code}>{item.label}</option>)}
          </select></label>
          <label>External inquiry reference<input name="external_reference" defaultValue={data?.external_reference ?? ''} maxLength={150} /></label>
          <label>Hospital or organisation name<input name="customer" defaultValue={data?.prospect_name ?? ''} required maxLength={200} autoFocus /></label>
          <label>Customer type<select name="customer_type" defaultValue={data?.customer_type ?? ''}>
            <option value="">Select type</option>{['Hospital','Clinic','Institution','Government','Distributor','Other'].map(type => <option key={type}>{type}</option>)}
          </select></label>
          <label>Link a visible customer<select name="account" defaultValue={data?.account_id ?? ''}>
            <option value="">No linked customer</option>
            {data?.account_id && !workspace.accounts.some(account => account.id === data.account_id) &&
              <option value={data.account_id}>Existing link</option>}
            {workspace.accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select></label>
          <label>City<input name="city" defaultValue={data?.city ?? ''} maxLength={120} /></label>
          <label>State<input name="state" defaultValue={data?.state ?? ''} maxLength={120} /></label>
          <label>Country<input name="country" defaultValue={data?.country ?? (lead ? '' : 'India')} maxLength={120} /></label>
          <label>Territory<select name="territory" defaultValue={lead?.territory ?? ''}>
            <option value="">No territory</option>
            {lead?.territory && !workspace.territories.some(item => item.id === lead.territory) && <option value={lead.territory}>Existing territory</option>}
            {workspace.territories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          {lead ? <label>Assigned salesperson<input value={lead.owner_name ?? 'Unassigned'} readOnly /></label> : <>
            <label>Assignment<select name="routing" value={routing} onChange={event => setRouting(event.target.value)}>
              <option value="self">Assign to me</option><option value="territory">Route by territory</option>
              {workspace.can_manage && <><option value="manual">Select a salesperson</option><option value="unassigned">Leave unassigned</option></>}
            </select></label>
            {routing === 'manual' && <label>Assigned salesperson<select name="owner" defaultValue="" required>
              <option value="">Choose a salesperson</option>{workspace.staff.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>}
          </>}
        </div>
      </section>
      <section><h3>Contacts</h3><div className="lead-form-grid">
        <label>Contact person<input name="contact" defaultValue={data?.contact_person ?? ''} maxLength={200} /></label>
        <label>Designation<input name="designation" defaultValue={data?.designation ?? ''} maxLength={150} /></label>
        <label>Mobile number<input name="mobile" type="tel" defaultValue={data?.mobile ?? (oldRoute.includes('@') ? '' : oldRoute)} maxLength={30} /></label>
        <label>Alternate mobile number<input name="alternate_mobile" type="tel" defaultValue={data?.alternate_mobile ?? ''} maxLength={30} /></label>
        <label>Email address<input type="email" name="email" defaultValue={data?.email ?? (oldRoute.includes('@') ? oldRoute : '')} maxLength={254} /></label>
        <label>Reason for missing contact details<input name="missing_contact_reason" defaultValue={data?.missing_contact_reason ?? ''} maxLength={500} /></label>
      </div></section>
      <section><div className="card-heading"><h3>Products and Requirements</h3>
        <button type="button" className="secondary" disabled={products.length >= 100} onClick={() =>
          setProducts(current => [...current,{id:crypto.randomUUID(),product:newProduct()}])}>Add product</button></div>
        {products.map(({ id,product },index) => <fieldset key={id} className="lead-product">
          <legend>Product {index + 1}</legend>
          <div className="lead-form-grid">
            <label>Product category<input value={product.category} onChange={event => updateProduct(id,'category',event.target.value)} required maxLength={150} /></label>
            <label>Product model<input value={product.model} onChange={event => updateProduct(id,'model',event.target.value)} required maxLength={200} /></label>
            <label>Required quantity<input type="number" min={1} max={1000000} value={product.quantity} onChange={event => updateProduct(id,'quantity',event.target.value)} required /></label>
            <label>Estimated unit price (INR)<input type="number" min="0" step="0.01" value={product.estimated_unit_price ?? ''} onChange={event => updateProduct(id,'estimated_unit_price',event.target.value)} /></label>
            <label className="lead-span">Product specifications<textarea value={product.requirements ?? ''} onChange={event => updateProduct(id,'requirements',event.target.value)} maxLength={4000} /></label>
          </div>
          <button type="button" className="secondary" onClick={() => setProducts(current => current.filter(row => row.id !== id))}>Remove product {index + 1}</button>
        </fieldset>)}
        <label>Product specifications or requirements<textarea name="requirements" rows={2} defaultValue={data?.requirement_text ?? ''} maxLength={10000} /></label>
      </section>
      <section><h3>Pipeline and follow-up</h3><div className="lead-form-grid">
        <label>Lead priority<select name="priority" defaultValue={data?.priority ?? 'Unqualified'}>
          {priorities.map(priority => <option key={priority}>{priority}</option>)}
        </select></label>
        <label>Current sales stage<select name="stage" value={stage} disabled={Boolean(closed)} onChange={event => setStage(event.target.value)}>
          {options(workspace,'stage',stage).map(item => <option key={item.code} value={item.code}>{item.label}</option>)}
        </select></label>
        {behavior === 'lost' && <label>Lost lead reason<select name="loss_reason" defaultValue={data?.loss_reason ?? ''} required>
          <option value="">Choose a reason</option>{options(workspace,'loss',data?.loss_reason).map(item => <option key={item.code} value={item.code}>{item.label}</option>)}
        </select></label>}
        <label>Probability of conversion (%)<input name="probability" type="number" min="0" max="100" defaultValue={data?.probability ?? ''} /></label>
        <label>Estimated budget (INR)<input name="budget" type="number" min="0" step=".01" defaultValue={data?.budget ?? ''} /></label>
        <label>Expected order value (INR)<input name="value" type="number" min="0" step=".01" defaultValue={data?.expected_value ?? ''} /></label>
        <label>Expected purchase date<input name="purchase_on" type="date" defaultValue={data?.expected_purchase_on ?? ''} /></label>
        <label>Next follow-up date (device time)<input name="follow_up" type="datetime-local" defaultValue={inputTime(data?.next_action_due_at)} /></label>
        <label>Next action<input name="next_action" defaultValue={data?.next_action ?? ''} maxLength={500} /></label>
        <label>Competitor<input name="competitor" defaultValue={data?.competitor ?? ''} maxLength={200} /></label>
        <label className="lead-span">Lead description<textarea name="description" rows={3} defaultValue={data?.description ?? ''} maxLength={10000} /></label>
        <label>Created by<input value={lead?.created_name ?? (lead ? '—' : 'Signed-in user')} readOnly /></label>
        <label>Last updated by<input value={lead?.updated_name ?? (lead ? '—' : 'Signed-in user')} readOnly /></label>
      </div></section>
      <label className="lead-check"><input type="checkbox" checked={attachments} onChange={event => setAttachments(event.target.checked)} />
        Attachments · open after saving</label>
      {data && <p className="muted">Source · {label(workspace,'source',data.source_key)}</p>}
      {(error || localError) && <p role="alert" className="error">{localError || error}</p>}
      <div className="lead-form-actions"><button className="secondary" type="button" onClick={onClose}>Cancel</button>
        <button disabled={busy} type="submit">{busy ? 'Saving…' : lead ? 'Save Lead' : 'Create Lead'}</button></div>
    </form>
  </LeadDialog>;
}
