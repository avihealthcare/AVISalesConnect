import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../packages/domain/database.types';

const stages = ['Qualified', 'Requirement Confirmed', 'Proposal', 'Negotiation', 'Won', 'Lost'];

export function Dashboard({ db, organization, permissions, openLeads, openActiveLeads, openOverdueLeads, openAccounts, openOpportunities }: {
  db: SupabaseClient<Database>; organization: string; permissions?: Set<string>; openLeads: () => void;
  openActiveLeads: () => void; openOverdueLeads: () => void; openAccounts: () => void; openOpportunities: () => void;
}) {
  const [summary, setSummary] = useState<{
    metrics: number[]; stages: number[];
    recent: { id: string; prospect_name: string; lifecycle: string; source: string }[];
  }>();
  const [error, setError] = useState(false);
  const [revision, refresh] = useState(0);

  useEffect(() => {
    let current = true;
    const exact = { count: 'exact' as const, head: true };
    void Promise.all([
      db.rpc('read_lead_management',{p_org:organization,p_query:{summary:'dashboard'}}),
      db.from('accounts').select('id', exact).eq('organization_id', organization),
      db.from('opportunities').select('id', exact).eq('organization_id', organization).not('stage', 'in', '(Won,Lost)'),
      Promise.all(stages.map(stage => db.from('opportunities').select('id', exact).eq('organization_id', organization).eq('stage', stage))),
      db.from('leads').select('id,prospect_name,lifecycle,source').eq('organization_id', organization)
        .order('received_at', { ascending: false }).limit(6),
    ]).then(([leads, accounts, open, pipeline, recent]) => {
      if (!current) return;
      if ([accounts, open, ...pipeline, recent].some(result => result.error)
        || (permissions?.has('lead.read') && (leads.error || recent.error))) {
        setError(true);
        return;
      }
      const activity = leads.data as {active:number;overdue:number} | null;
      setSummary({ metrics: [activity?.active ?? 0,accounts.count ?? 0,open.count ?? 0,activity?.overdue ?? 0],
        stages: pipeline.map(result => result.count ?? 0), recent: recent.data ?? [] });
    }).catch(() => { if (current) setError(true); });
    return () => { current = false; };
  }, [db, organization, revision, permissions]);

  const peak = Math.max(1, ...(summary?.stages ?? []));
  const cards = [
    ['Active leads', openActiveLeads, 'lead.read'], ['Hospitals and customers', openAccounts, 'account.read'],
    ['Open opportunities', openOpportunities, 'opportunity.read'], ['Overdue lead follow-ups', openOverdueLeads, 'lead.read'],
  ] as const;
  return <>
    <div className="page-heading">
      <div><h1>Executive Sales &amp; Field Operations Overview</h1>
        <p className="muted">Customer activity and sales pipeline for your organization</p></div>
      {permissions?.has('lead.read') && <button onClick={openLeads}>New hospital lead</button>}
    </div>
    {error ? <p className="panel" role="alert">Unable to load the dashboard. <button className="link"
      onClick={() => { setError(false); refresh(value => value + 1); }}>Retry</button></p>
      : !summary ? <p role="status">Loading dashboard…</p> : <>
        <div className="metric-grid">{cards.map(([title, go, permission], index) => permissions?.has(permission) && <button key={title} className="panel metric" onClick={go}>
          <span>{title}</span><strong>{summary.metrics[index].toLocaleString('en-IN')}</strong>
        </button>)}</div>
        <div className="dashboard-grid">
          {permissions?.has('lead.read') && <section className="panel">
            <div className="card-heading"><h2>Recent hospital and institutional leads</h2>
              <button className="link" onClick={openLeads}>View leads</button></div>
            {summary.recent.length ? <div className="table-scroll"><table>
              <thead><tr><th scope="col">Customer or contact</th><th scope="col">Source</th><th scope="col">Status</th></tr></thead>
              <tbody>{summary.recent.map(lead => <tr key={lead.id}>
                <td>{lead.prospect_name}</td><td>{lead.source}</td><td><span className="status-pill">{lead.lifecycle}</span></td>
              </tr>)}</tbody>
            </table></div> : <p className="muted">No leads yet.</p>}
          </section>}
          {permissions?.has('opportunity.read') && <section className="panel">
            <div className="card-heading"><h2>Sales pipeline by stage</h2></div>
            <ul className="pipeline-stages">{stages.map((stage, i) => <li key={stage}>
              <span>{stage}</span><strong>{summary.stages[i].toLocaleString('en-IN')}</strong>
              <meter min={0} max={peak} value={summary.stages[i]} aria-label={stage} />
            </li>)}</ul>
          </section>}
        </div>
      </>}
  </>;
}
