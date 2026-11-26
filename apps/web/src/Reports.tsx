import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../packages/domain/database.types';

const sources = ['Telephone','Email','WhatsApp','Website','Referral','Event','Other','CSV','IndiaMART'];
const stages = ['Qualified','Requirement Confirmed','Proposal','Negotiation','Won','Lost'];
type Row = { label: string; total: number };

function exportCounts(rows: Row[], metric: string) {
  const content = [`"${metric}",Count`, ...rows.map(({ label, total }) => `"${label}",${total}`)].join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  link.download = 'salesconnect-report.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export function Reports({ db, organization, canReadOpportunities }: {
  db: SupabaseClient<Database>; organization: string; canReadOpportunities: boolean;
}) {
  const [metric, setMetric] = useState<'source' | 'stage'>('source');
  const [period, setPeriod] = useState({ start: '', end: '' });
  const [rows, setRows] = useState<Row[]>();
  const [failed, setFailed] = useState(false);
  const [revision, update] = useState(0);
  const valid = !period.start || !period.end || period.start <= period.end;
  const title = metric === 'source' ? 'Lead source' : 'Opportunity stage';

  useEffect(() => {
    let current = true;
    setRows(undefined);
    setFailed(false);
    if (!valid || (metric === 'stage' && !canReadOpportunities)) return;
    const exact = { count: 'exact' as const, head: true };
    const start = period.start && `${period.start}T00:00:00+05:30`;
    const end = period.end && `${period.end}T23:59:59.999999+05:30`;
    const labels = metric === 'source' ? sources : stages;
    void Promise.all(labels.map(async label => {
      if (metric === 'source') {
        let query = db.from('leads').select('id',exact).eq('organization_id',organization).eq('source',label);
        if (start) query = query.gte('received_at',start);
        if (end) query = query.lte('received_at',end);
        return { label, ...(await query) };
      }
      let query = db.from('opportunities').select('id',exact).eq('organization_id',organization).eq('stage',label);
      if (start) query = query.gte('created_at',start);
      if (end) query = query.lte('created_at',end);
      return { label, ...(await query) };
    })).then(results => {
      if (!current) return;
      if (results.some(result => result.error)) setFailed(true);
      else setRows(results.map(({ label, count }) => ({ label, total: count ?? 0 })));
    }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [db, organization, metric, period, valid, canReadOpportunities, revision]);

  return <>
    <h1>Reports</h1>
    <section className="panel">
      <h2>Sales activity</h2>
      <form onSubmit={event => event.preventDefault()}>
        <label>Report<select value={metric} onChange={event => setMetric(event.target.value as 'source' | 'stage')}>
          <option value="source">Leads by source</option>
          {canReadOpportunities && <option value="stage">Opportunities by stage</option>}
        </select></label>
        <label>From date (IST)<input type="date" value={period.start} onChange={event => setPeriod({ ...period,start:event.target.value })} /></label>
        <label>Through date (IST)<input type="date" value={period.end} onChange={event => setPeriod({ ...period,end:event.target.value })} /></label>
      </form>
      <p className="muted">{metric === 'source' ? 'Dates filter when leads were received.' : 'Dates filter when opportunities were created. Counts use their current stage.'}</p>
      {!valid ? <p role="alert">The end date must be on or after the start date.</p>
        : failed ? <p role="alert">Unable to load this report. <button className="link" onClick={() => update(value => value + 1)}>Retry</button></p>
        : !rows ? <p role="status">Loading report…</p>
        : <><div className="table-scroll"><table><thead><tr><th scope="col">{title}</th><th scope="col">Count</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.total.toLocaleString('en-IN')}</td></tr>)}</tbody></table></div>
          <button className="secondary" onClick={() => exportCounts(rows,title)}>Download CSV</button></>}
    </section>
  </>;
}
