import { useState, type FormEvent } from 'react';
import type { Json } from '../../../packages/domain/database.types';
import { behaviors, readFields, type Option, type Workspace } from './leadModel';

const sections = [['source','Lead sources'],['stage','Sales stages'],['loss','Lost reasons'],['rules','Response rules'],['territory','Territory routing']] as const;
export function LeadSettings({ workspace, mutate, busy }: {
  workspace: Workspace; mutate: (action: string,input: Json) => Promise<boolean>; busy: boolean;
}) {
  const [section,setSection] = useState<typeof sections[number][0]>('source');
  const [selection, select] = useState('new_option');
  const current = workspace.catalog.find(item => item.kind===section && item.code===selection);
  const isCatalog = section==='source' || section==='stage' || section==='loss';
  const catalog = isCatalog ? workspace.catalog.filter(item => item.kind===section) : [];
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input=readFields(event.currentTarget);
    void mutate('settings',{ kind:section,...input,active:new FormData(event.currentTarget).has('active') });
  }
  return <section className="panel lead-settings">
    <h2>Lead Management Settings</h2>
    <nav className="lead-detail-tabs" aria-label="Lead configuration">{sections.map(([key,label]) =>
      <button className="secondary" type="button" aria-current={section===key?'page':undefined} key={key} onClick={() => { setSection(key);select('new_option'); }}>{label}</button>)}
    </nav>
    {isCatalog && <>
      <label>Configuration item<select value={selection} onChange={event => select(event.target.value)}>
        <option value="new_option">Add new</option>
        {catalog.map(item => <option value={item.code} key={item.code}>{item.label}{item.active?'':' (inactive)'}</option>)}
      </select></label>
      <OptionForm key={section+selection} option={current} kind={section} save={save} busy={busy} />
    </>}
    {section==='rules' && <form key={`${workspace.rules.response_hours}:${workspace.rules.inactive_days}`} className="lead-inline-form" onSubmit={save}>
      <label>First response deadline (hours)<input required type="number" min={1} max={720} name="response_hours" defaultValue={workspace.rules.response_hours} /></label>
      <label>Mark inactive after (days)<input required type="number" min={1} max={365} name="inactive_days" defaultValue={workspace.rules.inactive_days} /></label>
      <button disabled={busy}>Save Response Rules</button>
    </form>}
    {section==='territory' && <>
      <form className="lead-inline-form" onSubmit={event => {
        event.preventDefault();
        const form=event.currentTarget;
        void mutate('settings',{kind:'territory_create',label:readFields(form).label}).then(success => { if (success) form.reset(); });
      }}>
        <label>New territory name<input name="label" required maxLength={120} /></label>
        <button disabled={busy}>Add Territory</button>
      </form>
      {workspace.territories.length>0 && <div className="lead-route-list">{workspace.territories.map(territory => <form key={territory.id + territory.owner} onSubmit={save}>
        <input type="hidden" name="territory" value={territory.id} />
        <label>{territory.name}<select name="member" defaultValue={territory.owner ?? ''}>
          <option value="">No automatic assignment</option>
          {workspace.staff.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
        </select></label>
        <button disabled={busy}>Save Routing</button>
      </form>)}</div>}
    </>}
  </section>;
}
function OptionForm({ option, kind, save, busy }: {
  option?: Option; kind: Option['kind']; save: (event: FormEvent<HTMLFormElement>) => void; busy: boolean;
}) {
  const [name,setName]=useState(option?.label ?? '');
  const generated = name.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,60);
  const [code,setCode]=useState<string>();
  return <form className="lead-inline-form" onSubmit={save}>
    <label>Display name<input name="label" value={name} onChange={event => setName(event.target.value)} maxLength={120} required /></label>
    <label>Code<input name="code" value={option?.code ?? code ?? generated} readOnly={Boolean(option)}
      onChange={event => setCode(event.target.value)} pattern="[a-z][a-z0-9_]{0,59}" required /></label>
    <label>Display order<input name="sort_order" type="number" min={1} max={9999} defaultValue={option?.sort_order ?? 200} required /></label>
    {kind==='stage' && <label>Stage behavior<select name="behavior" defaultValue={option?.behavior ?? 'active'}>
      {behaviors.map(([key,label]) => <option key={key} value={key}>{label}</option>)}
    </select></label>}
    <label className="lead-check"><input name="active" type="checkbox" defaultChecked={option?.active ?? true} /> Available for new changes</label>
    <button disabled={busy}>{option?'Save Configuration':'Add Configuration'}</button>
  </form>;
}
