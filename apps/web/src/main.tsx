import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../packages/domain/database.types';
import '@fontsource-variable/inter';
import './style.css';
import {userManagementEnabled} from './workspaceFeatures';
const IntakeWorkspace = lazy(async () => ({ default: (await import('./IntakeWorkspace')).IntakeWorkspace }));

type Membership = { id: string; organization_id: string; organizations: { name: string } | null };
type Page = 'loading' | 'login' | 'no-access' | 'home' | 'error' | 'recover' | 'recovery-sent' | 'new-password';
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
// Capture the callback type before Supabase consumes the URL fragment.
const invitationRedirect = (() => {
  const callback = new URLSearchParams(window.location.hash.slice(1));
  return callback.get('type') === 'invite'
    && callback.has('access_token') && callback.has('refresh_token');
})();
const client: SupabaseClient<Database> | null = url && key ? createClient<Database>(url, key) : null;

function App() {
  const [page, setPage] = useState<Page>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const passwordSetup = useRef(invitationRedirect);
  const [busy, setBusy] = useState(false);
  const accessCheck = useRef(0);

  const verifyAccess = useCallback(async (current: Session | null) => {
    const checkId = ++accessCheck.current;
    setSession(current);
    setMemberships([]);
    setError('');
    if (!client) { setError('The app connection is not configured.'); setPage('error'); return; }
    if (!current) { setPage('login'); return; }
    setPage('loading');
    try {
      if(userManagementEnabled){
        const setup=await client.rpc('workspace_password_required');
        if(checkId!==accessCheck.current)return;
        if(setup.error&&setup.error.code!=='PGRST202')throw setup.error;
        if(setup.data){passwordSetup.current=true;setPage('new-password');return;}
      }
      const { data: membershipData, error: membershipError } = await client.from('memberships').select('id, organization_id, organizations(name)').eq('status', 'Active');
      if (checkId !== accessCheck.current) return;
      if (membershipError) throw membershipError;
      if (!membershipData?.length) { setPage('no-access'); return; }
      setMemberships(membershipData);
      setPage('home');
    } catch {
      if (checkId !== accessCheck.current) return;
      setError('Unable to verify your access. Please try again.');
      setPage('error');
    }
  }, []);

  useEffect(() => {
    if (!client) { setError('The app connection is not configured.'); setPage('error'); return; }
    const db = client;
    let live = true;
    if (invitationRedirect) {
      void (async () => {
        const { error: redirectError } = await db.auth.initialize();
        const { data, error: sessionError } = await db.auth.getSession();
        if (!live) return;
        if (redirectError || sessionError || !data.session) {
          ++accessCheck.current;
          setError('The invitation could not be verified. Ask your administrator for a fresh invitation.');
          setPage('error');
          return;
        }
        ++accessCheck.current;
        setSession(data.session);
        setPage('new-password');
      })();
    } else {
      void db.auth.getSession().then(({ data, error: sessionError }) => {
        if (!live || passwordSetup.current) return;
        if (sessionError) { setError('Unable to check your session.'); setPage('error'); return; }
        void verifyAccess(data.session);
      });
    }
    const { data: listener } = db.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') {
        passwordSetup.current = true; ++accessCheck.current; setSession(next); setMemberships([]); setError(''); setPage('new-password'); return;
      }
      if (passwordSetup.current && event !== 'SIGNED_OUT') return;
      // Avoid awaiting other Supabase calls inside the auth callback.
      window.setTimeout(() => { if (live && !passwordSetup.current) void verifyAccess(next); }, 0);
    });
    return () => { live = false; listener.subscription.unsubscribe(); };
  }, [verifyAccess]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault(); if (!client || busy) return;
    setBusy(true); setError('');
    const { error: signInError } = await client.auth.signInWithPassword({ email: email.trim(), password });
    setPassword('');
    if (signInError) setError('Sign-in failed. Check your details and try again.');
    setBusy(false);
  }
  async function requestRecovery(e: React.FormEvent) {
    e.preventDefault(); if (!client || busy) return;
    setBusy(true); setError('');
    const result = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + window.location.pathname });
    if (result.error) setError('Unable to request a recovery link. Please try again.');
    else setPage('recovery-sent');
    setBusy(false);
  }
  async function updatePassword(e: React.FormEvent) {
    e.preventDefault(); if (!client || busy) return;
    if(newPassword.length<8){setError('Use at least 8 characters.');return;}
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }
    setBusy(true); setError('');
    const result = await client.auth.updateUser({ password: newPassword });
    setNewPassword(''); setConfirmPassword('');
    if (result.error) {
      setError(result.error.code === 'insufficient_aal'
        ? 'This account still has an authenticator enrolled with the sign-in provider. Contact your administrator for help resetting the password.'
        : 'Password could not be updated. Check the password requirements and try again.');
      setBusy(false);
      return;
    }
    passwordSetup.current = false;
    const logout = await client.auth.signOut();
    if (logout.error) { setError('Password updated, but sign-out failed. Please sign out and sign in again.'); setPage('error'); }
    else { setSession(null); setPage('login'); }
    setBusy(false);
  }
  async function signOut() { if (client) { setBusy(true); const result = await client.auth.signOut(); if (result.error) setError('Sign-out failed. Please try again.'); setBusy(false); } }
  if (page === 'home' && client && memberships.length) return <Suspense fallback={<p role="status">Loading SalesConnect…</p>}>
    <IntakeWorkspace db={client} memberships={memberships} signOut={signOut} busy={busy} />
    {error && <p role="alert" className="error">{error}</p>}
  </Suspense>;
  return <main className="layout"><section className="card" aria-labelledby="title">
    <p className="eyebrow">AVI Healthcare</p><h1 id="title">SalesConnect</h1>
    {page === 'loading' && <p role="status">Checking access…</p>}
    {page === 'login' && <><h2>Sign in</h2><p>Use the account provided by your administrator.</p><form onSubmit={signIn}>
      <label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required />
      <label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
      <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form><button type="button" className="link" onClick={() => { setError(''); setPage('recover'); }}>Forgot password?</button></>}
    {page === 'recover' && <><h2>Reset password</h2><p>Enter your account email and we’ll send a recovery link if the account is eligible.</p><form onSubmit={requestRecovery}><label htmlFor="recovery-email">Email</label><input id="recovery-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /><button disabled={busy}>{busy ? 'Sending…' : 'Send recovery link'}</button></form><button type="button" className="link" onClick={() => { setError(''); setPage('login'); }}>Back to sign in</button></>}
    {page === 'recovery-sent' && <><h2>Check your email</h2><p>If the account is eligible, a recovery link will be sent. Check your inbox and spam folder.</p><button onClick={() => setPage('login')}>Back to sign in</button></>}
    {page === 'new-password' && <><h2>{invitationRedirect ? 'Choose a password' : 'Choose a new password'}</h2><form onSubmit={updatePassword}><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={e => setNewPassword(e.target.value)} required /><label htmlFor="confirm-password">Confirm password</label><input id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required /><button disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button></form></>}
    {page === 'no-access' && <><h2>Access unavailable</h2><p>No active organization membership is available for this account. Contact your administrator.</p><button onClick={signOut} disabled={busy}>Sign out</button></>}
    {page === 'error' && <><h2>Access check unavailable</h2><p>We couldn’t confirm your access. Try again when the connection is available.</p>{session && <button onClick={signOut} disabled={busy}>Sign out</button>}{!session && client && <button onClick={() => void verifyAccess(null)}>Back to sign in</button>}</>}
    {error && <p role="alert" className="error">{error}</p>}
  </section></main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
