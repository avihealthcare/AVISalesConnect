import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../packages/domain/database.types';

type StaffMember = Database['public']['Functions']['staff_directory']['Returns'][number];

export function StaffAdministration({ db, organization }: { db: SupabaseClient<Database>; organization: string }) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState('');
  const [confirmMember, setConfirmMember] = useState<StaffMember>();
  const operation = useRef<{ member: string; key: string } | undefined>(undefined);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError(false);
    void db.rpc('staff_directory', { p_org: organization }).then(({ data, error }) => {
      if (!current) return;
      setStaff(data ?? []);
      setLoadError(Boolean(error));
      setLoading(false);
    });
    return () => { current = false; };
  }, [db, organization, revision]);

  async function deactivate(member: StaffMember) {
    if (busy) return;
    if (operation.current?.member !== member.membership_id) {
      operation.current = { member: member.membership_id, key: crypto.randomUUID() };
    }
    setBusy(member.membership_id);
    setError('');
    try {
      const { error } = await db.rpc('deactivate_staff', {
        p_org: organization, p_member: member.membership_id, p_key: operation.current.key,
      });
      if (error) {
        if (error.code === 'PT409' && error.message === 'Reassign open records before deactivating this member') {
          setError('Reassign this staff member’s open records before deactivating access.');
        } else {
          setError('Unable to confirm deactivation. Refresh the directory before retrying.');
        }
        return;
      }
      operation.current = undefined;
      setConfirmMember(undefined);
      setRevision(current => current + 1);
    } catch {
      setError('Unable to confirm deactivation. Refresh the directory before retrying.');
    } finally {
      setBusy(undefined);
    }
  }

  return <section className="panel" aria-labelledby="staff-title">
    <h2 id="staff-title">Staff administration</h2>
    {loading && <p role="status">Loading staff…</p>}
    {loadError && <p role="alert">Unable to load staff. <button className="link" onClick={() => setRevision(value => value + 1)}>Retry</button></p>}
    {!loading && !loadError && <ul className="records">
      {staff.map(member => <li key={member.membership_id}>
        <strong>{member.display_name}</strong>
        <p>{member.status}</p>
        {member.can_deactivate && confirmMember?.membership_id !== member.membership_id &&
          <button className="secondary" disabled={Boolean(busy)} onClick={() => { setError(''); setConfirmMember(member); }}>
            Deactivate access
          </button>}
        {confirmMember?.membership_id === member.membership_id && <div>
          <p>Deactivate {member.display_name}’s access to this organization?</p>
          <button disabled={Boolean(busy)} onClick={() => void deactivate(member)}>Confirm deactivation</button>
          <button className="secondary" disabled={Boolean(busy)} onClick={() => { setError(''); setConfirmMember(undefined); }}>Cancel</button>
        </div>}
      </li>)}
    </ul>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
