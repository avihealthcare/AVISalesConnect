import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../packages/domain/database.types';

export function containsTerm(term: string) {
  return '%' + term.replace(/[\\%_*]/g, character => '\\' + character) + '%';
}

export function RecordSearch({ db, organization, term, open }: {
  db: SupabaseClient<Database>; organization: string; term: string;
  open: (screen: 'accounts' | 'leads', name: string) => void;
}) {
  const [result, setResult] = useState<{ screen: 'accounts' | 'leads'; id: string; name: string; detail: string }[]>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let current = true;
    const pattern = containsTerm(term);
    void Promise.all([
      db.from('accounts').select('id,name,account_type').eq('organization_id', organization).ilike('name', pattern).order('name').limit(12),
      db.from('leads').select('id,prospect_name,source').eq('organization_id', organization).ilike('prospect_name', pattern).order('received_at', { ascending: false }).limit(12),
    ]).then(([accounts, leads]) => {
      if (!current) return;
      if (accounts.error || leads.error) { setError(true); return; }
      setResult([
        ...(accounts.data ?? []).map(row => ({ screen: 'accounts' as const, id: row.id, name: row.name, detail: row.account_type })),
        ...(leads.data ?? []).map(row => ({ screen: 'leads' as const, id: row.id, name: row.prospect_name, detail: 'Lead · ' + row.source })),
      ]);
    }).catch(() => { if (current) setError(true); });
    return () => { current = false; };
  }, [db, organization, term]);

  return <section className="panel">
    <h1>Search results</h1><p className="muted">Hospitals, customers and leads matching “{term}”</p>
    {error ? <p role="alert">Unable to search records.</p>
      : !result ? <p role="status">Searching…</p>
      : result.length ? <ul className="records">{result.map(row => <li key={row.screen + row.id}>
          <button className="link" onClick={() => open(row.screen, row.name)}>{row.name}</button><p>{row.detail}</p>
        </li>)}</ul>
      : <p>No matching records.</p>}
  </section>;
}
