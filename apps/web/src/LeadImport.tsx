import { useState, type ChangeEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../packages/domain/database.types';

const fields = ['prospect_name', 'received_at', 'contact_route', 'missing_contact_reason', 'requirement_text'] as const;
const template = fields.join(',') + '\r\n';
type LeadInput = Record<typeof fields[number], string | null> & { source: 'CSV' };
type ImportRow = { number: number; name: string; input: LeadInput; issue?: string; saved?: boolean };

function readCsv(text: string) {
  const input = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let enclosed = false;
  let closed = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (enclosed) {
      if (char !== '"') field += char;
      else if (input[index + 1] === '"') { field += '"'; index += 1; }
      else { enclosed = false; closed = true; }
    } else if (char === ',') {
      row.push(field); field = ''; closed = false;
    } else if (char === '\n' || char === '\r') {
      row.push(field); rows.push(row);
      row = []; field = ''; closed = false;
      if (char === '\r' && input[index + 1] === '\n') index += 1;
    } else if (char === '"' && field === '' && !closed) {
      enclosed = true;
    } else {
      if (closed || char === '"') throw new Error('A quoted CSV cell is malformed.');
      field += char;
    }
  }
  if (enclosed) throw new Error('A quoted CSV cell is unfinished.');
  if (row.length || field || closed) rows.push([...row, field]);
  return rows;
}

async function requestKey(input: LeadInput) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input))));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes.slice(0,16), value => value.toString(16).padStart(2,'0')).join('');
  return [hex.slice(0,8), hex.slice(8,12), hex.slice(12,16), hex.slice(16,20), hex.slice(20)].join('-');
}

export function LeadImport({ db, organization, onSaved }: {
  db: SupabaseClient<Database>; organization: string; onSaved: () => void;
}) {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [message, setMessage] = useState('');
  const [invalidFile, setInvalidFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const ready = rows.filter(row => !row.issue && !row.saved).length;

  async function preview(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setRows([]);
    setMessage('');
    setInvalidFile(false);
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 1024 * 1024) throw new Error('Choose a UTF-8 CSV file under 1 MB.');
      const [header = [], ...data] = readCsv(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()));
      const names = header.map(value => value.trim().toLowerCase());
      if (!names.includes('prospect_name') || !names.includes('received_at') || new Set(names).size !== names.length) {
        throw new Error('Use the template headers, including prospect_name and received_at.');
      }
      const used = new Set<string>();
      const reviewed = data.map((row, index): ImportRow => {
        const read = (name: string) => row[names.indexOf(name)]?.trim() || null;
        const original = read('received_at');
        const timestamp = original ? new Date(original) : null;
        const timed = Boolean(original && /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(original) &&
          timestamp && Number.isFinite(timestamp.valueOf()) && timestamp.valueOf() <= Date.now());
        const input: LeadInput = {
          source: 'CSV', prospect_name: read('prospect_name'), received_at: timed ? timestamp!.toISOString() : original,
          contact_route: read('contact_route'), missing_contact_reason: read('missing_contact_reason'), requirement_text: read('requirement_text'),
        };
        const fingerprint = JSON.stringify(input);
        const issue = row.length !== names.length ? 'Column count differs from the header.'
          : !input.prospect_name || input.prospect_name.length > 200 ? 'Enter a name up to 200 characters.'
          : !timed ? 'Use a past receipt time with an offset, such as 2026-01-01T10:00:00+05:30.'
          : !input.contact_route && !input.missing_contact_reason ? 'Enter contact details or a missing-contact reason.'
          : input.contact_route && (!/^([+]?[0-9]{7,15}|[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(input.contact_route) || input.contact_route.length > 254) ? 'Review the phone number or email.'
          : (input.missing_contact_reason?.length ?? 0) > 500 || (input.requirement_text?.length ?? 0) > 10000 ? 'Shorten the notes.'
          : used.has(fingerprint) ? 'Exact repeat in this file.' : undefined;
        if (!issue) used.add(fingerprint);
        return { number: index + 2, name: input.prospect_name ?? '', input, issue };
      }).filter((_,index) => data[index].some(cell => cell.trim()));
      if (!reviewed.length || reviewed.length > 250) throw new Error('Include between 1 and 250 rows per CSV file.');
      setRows(reviewed);
    } catch (error) {
      setInvalidFile(true);
      setMessage(error instanceof Error ? error.message : 'Unable to preview this CSV.');
    } finally { setBusy(false); }
  }

  async function commit() {
    if (busy || !ready) return;
    setBusy(true);
    setMessage('');
    let saved = 0;
    try {
      for (const row of rows.filter(row => !row.issue && !row.saved)) {
        const result = await db.rpc('create_intake_record', {
          p_org: organization, p_key: await requestKey(row.input), p_kind: 'lead', p_input: row.input,
        });
        if (result.error) {
          setMessage(`Import paused at CSV row ${row.number}. Review your access or retry the remaining rows.`);
          return;
        }
        saved += 1;
        setRows(previous => previous.map(item => item.number === row.number ? { ...item, saved: true } : item));
      }
      setMessage(`${saved} CSV ${saved === 1 ? 'row' : 'rows'} saved or matched to your earlier import.`);
    } catch {
      setMessage('The import paused. Retry the remaining rows to resume.');
    } finally {
      if (saved > 0) onSaved();
      setBusy(false);
    }
  }

  return <details className="panel">
    <summary>Import leads from CSV</summary>
    <p>Upload a UTF-8 file and review its rows before saving. Keep the template headers in any order.</p>
    <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`} download="salesconnect-leads-template.csv">Download CSV template</a>
    <label>CSV file<input type="file" accept=".csv,text/csv" disabled={busy} onChange={preview} /></label>
    {message && <p role={invalidFile ? 'alert' : 'status'}>{message}</p>}
    {rows.length > 0 && <>
      <div className="table-scroll"><table><thead><tr><th scope="col">Row</th><th scope="col">Lead</th><th scope="col">Review</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.number}><td>{row.number}</td><td>{row.name}</td><td>{row.saved ? 'Saved' : row.issue ?? 'Ready'}</td></tr>)}</tbody>
      </table></div>
      <button type="button" disabled={busy || !ready} onClick={commit}>{busy ? 'Importing…' : `Import ${ready} valid ${ready === 1 ? 'row' : 'rows'}`}</button>
    </>}
  </details>;
}
