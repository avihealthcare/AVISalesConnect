import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../packages/domain/database.types';

type FileRow = Database['public']['Functions']['crm_record_files']['Returns'][number];
type FileProps = { db: SupabaseClient<Database>; organization: string; record: string; canUpload: boolean };

const fileTypes = ['application/pdf', 'image/jpeg', 'image/png'];
const maxUpload = 25 * 1024 * 1024;

export function RecordFiles(props: FileProps) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="secondary" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? 'Hide attachments' : 'Attachments'}
    </button>
    {open && <AttachmentList {...props} />}
  </>;
}

function AttachmentList({ db, organization, record, canUpload }: FileProps) {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, refresh] = useState(0);
  const [page, movePage] = useState(0);
  const [resume, setResume] = useState<FileRow>();
  const reservation = useRef<{ file: File; key: string } | null>(null);
  const inputId = useId();

  useEffect(() => {
    let current = true;
    setLoading(true);
    void db.rpc('crm_record_files', { p_org: organization, p_resource: record, p_offset: page * 25 })
      .then(({ data, error }) => {
        if (!current) return;
        setFiles(data ?? []);
        if (error) setError('Attachments are unavailable for this record.');
        setLoading(false);
      });
    return () => { current = false; };
  }, [db, organization, record, page, revision]);

  async function fileRequest(stage: string, method: 'GET' | 'POST', file?: File) {
    const { data } = await db.auth.getSession();
    if (!data.session) throw new Error('Sign in again before accessing attachments.');
    const endpoint = new URL('/functions/v1/private-files', import.meta.env.VITE_SUPABASE_URL);
    endpoint.searchParams.set('stage', stage);
    const result = await fetch(endpoint, {
      method,
      credentials: 'omit',
      headers: {
        authorization: 'Bearer ' + data.session.access_token,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        ...(file ? { 'content-type': file.type } : {}),
      },
      body: file,
    });
    if (result.status === 409) throw new Error('Select the original file used for this attachment.');
    if (!result.ok) throw new Error('The file service is unavailable or access was denied.');
    return result;
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const file = (form.elements.namedItem('attachment') as HTMLInputElement).files?.[0];
    setNotice('');
    if (!file || !fileTypes.includes(file.type) || !file.size || file.size > maxUpload) {
      setError('Choose a PDF, JPEG or PNG file up to 25 MB.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      let stage = resume?.id;
      if (!stage) {
        if (reservation.current?.file !== file) reservation.current = { file, key: crypto.randomUUID() };
        const result = await db.rpc('reserve_file_stage', {
          p_org: organization, p_parent: record, p_key: reservation.current.key,
          p_name: file.name, p_purpose: 'business_document', p_mime: file.type, p_size: file.size,
        });
        if (result.error || !result.data) throw new Error('Could not reserve the attachment.');
        stage = result.data;
      }

      const result = await fileRequest(stage, 'POST', file);
      const { status } = await result.json();
      setNotice(status === 'available' ? 'Attachment available.'
        : status === 'rejected' ? 'The scanner rejected this file.' : 'Attachment saved and awaiting a scan.');
      setResume(undefined);
      reservation.current = null;
      form.reset();
      movePage(0);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to confirm the upload.');
    } finally {
      setBusy(false);
      refresh(value => value + 1);
    }
  }

  async function download(file: FileRow) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await fileRequest(file.id, 'GET');
      const href = URL.createObjectURL(await result.blob());
      const link = document.createElement('a');
      link.href = href;
      link.download = file.file_name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to download the file.');
    } finally {
      setBusy(false);
    }
  }

  return <div>
    {loading && <p role="status">Loading attachments…</p>}
    {!loading && !files.length && !error && <p>No attachments.</p>}
    <ul className="records">
      {files.slice(0, 25).map(file => <li key={file.id}>
        {file.file_name} <span>· {file.status}</span>
        {file.status === 'Available' && <button disabled={busy} className="secondary"
          onClick={() => void download(file)}>Download</button>}
        {canUpload && ['Awaiting scan', 'Pending upload'].includes(file.status) &&
          <button disabled={busy} className="secondary" onClick={() => setResume(file)}>Retry</button>}
      </li>)}
    </ul>
    {page > 0 && <button className="secondary" disabled={loading || busy} onClick={() => movePage(value => value - 1)}>Previous attachments</button>}
    {files.length > 25 && <button className="secondary" disabled={loading || busy} onClick={() => movePage(value => value + 1)}>Next attachments</button>}
    {canUpload && <form onSubmit={upload}>
      <label htmlFor={inputId}>{resume ? 'Select the original file for ' + resume.file_name : 'Add attachment'}</label>
      <input id={inputId} name="attachment" type="file" accept={fileTypes.join(',')} required disabled={busy} />
      <button disabled={busy}>{busy ? 'Processing…' : 'Upload'}</button>
      {resume && <button className="secondary" type="button" disabled={busy} onClick={() => setResume(undefined)}>Cancel retry</button>}
    </form>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </div>;
}
