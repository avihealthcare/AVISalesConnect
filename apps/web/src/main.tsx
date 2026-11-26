import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../packages/domain/database.types';
import './style.css';
import { IntakeWorkspace } from './IntakeWorkspace';

type Membership = { id: string; organization_id: string; organizations: { name: string } | null };
type Page = 'loading' | 'login' | 'challenge' | 'no-access' | 'home' | 'error' | 'recover' | 'recovery-sent' | 'new-password';
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
  const [code, setCode] = useState('');
  const [enrollment, setEnrollment] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const passwordSetup = useRef(invitationRedirect);
  const [busy, setBusy] = useState(false);
  const accessCheck = useRef(0);

  const verifyAccess = useCallback(async (current: Session | null) => {
    const checkId = ++accessCheck.current;
    setSession(current);
    if (!current) setEnrollment(null);
    setMemberships([]);
    setError('');
    if (!client) { setError('The app connection is not configured.'); setPage('error'); return; }
    if (!current) { setPage('login'); return; }
    setPage('loading');
    try {
      const { data: membershipData, error: membershipError } = await client.from('memberships').select('id, organization_id, organizations(name)').eq('status', 'Active');
      if (checkId !== accessCheck.current) return;
      if (membershipError) throw membershipError;
      if (!membershipData?.length) { setPage('no-access'); return; }
      // These reads are filtered to the current member by database policies.
      const [roles, permissions, assurance] = await Promise.all([
        client.from('roles').select('requires_mfa'),
        client.from('permissions').select('requires_mfa'),
        client.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);
      if (checkId !== accessCheck.current) return;
      if (roles.error || permissions.error || assurance.error) throw new Error('Unable to verify access.');
      const requiresMfa = roles.data.some(r => r.requires_mfa) || permissions.data.some(p => p.requires_mfa);
      if (requiresMfa && assurance.data.currentLevel !== 'aal2') { setPage('challenge'); return; }
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
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }
    setBusy(true); setError('');
    const result = await client.auth.updateUser({ password: newPassword });
    setNewPassword(''); setConfirmPassword('');
    if (result.error) { setError('Password could not be updated. Check the password requirements and try again.'); setBusy(false); return; }
    passwordSetup.current = false;
    const logout = await client.auth.signOut();
    if (logout.error) { setError('Password updated, but sign-out failed. Please sign out and sign in again.'); setPage('error'); }
    else { setSession(null); setPage('login'); }
    setBusy(false);
  }
  async function setupAuthenticator() {
    if (!client || busy) return;
    setBusy(true);
    setError('');
    try {
      const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error || assurance.data.nextLevel === 'aal2') {
        setError('Enter a code from your existing authenticator.');
        return;
      }
      const result = await client.auth.mfa.enroll({ factorType: 'totp' });
      if (result.error) { setError('Unable to set up an authenticator. Try again.'); return; }
      setEnrollment({ id: result.data.id, qr: result.data.totp.qr_code, secret: result.data.totp.secret });
    } catch { setError('Unable to set up an authenticator. Try again.'); }
    finally { setBusy(false); }
  }
  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (!client || busy) return;
    setBusy(true);
    setError('');
    try {
      let factorId = enrollment?.id;
      if (!factorId) {
        const factors = await client.auth.mfa.listFactors();
        factorId = factors.data?.totp.find(f => f.status === 'verified')?.id;
        if (factors.error || !factorId) {
          setError('Set up an authenticator first, or contact your administrator.');
          return;
        }
      }
      const result = await client.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
      if (result.error) { setError('The verification code could not be confirmed. Try again.'); return; }
      setEnrollment(null);
      const refreshed = await client.auth.getSession();
      await verifyAccess(refreshed.data.session);
    } catch { setError('The verification code could not be confirmed. Try again.'); }
    finally { setCode(''); setBusy(false); }
  }
  async function signOut() { if (client) { setBusy(true); const result = await client.auth.signOut(); if (result.error) setError('Sign-out failed. Please try again.'); setBusy(false); } }
  if (page === 'home' && client && memberships.length) return <><IntakeWorkspace db={client} memberships={memberships} signOut={signOut} busy={busy} />{error && <p role="alert" className="error">{error}</p>}</>;
  return <main className="layout"><section className="card" aria-labelledby="title">
    <p className="eyebrow">AVI Healthcare</p><h1 id="title">SalesConnect</h1>
    {page === 'loading' && <p role="status">Checking access…</p>}
    {page === 'login' && <><h2>Sign in</h2><p>Use the account provided by your administrator.</p><form onSubmit={signIn}>
      <label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required />
      <label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
      <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form><button type="button" className="link" onClick={() => { setError(''); setPage('recover'); }}>Forgot password?</button></>}
    {page === 'recover' && <><h2>Reset password</h2><p>Enter your account email and we’ll send a recovery link if the account is eligible.</p><form onSubmit={requestRecovery}><label htmlFor="recovery-email">Email</label><input id="recovery-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /><button disabled={busy}>{busy ? 'Sending…' : 'Send recovery link'}</button></form><button type="button" className="link" onClick={() => { setError(''); setPage('login'); }}>Back to sign in</button></>}
    {page === 'recovery-sent' && <><h2>Check your email</h2><p>If the account is eligible, a recovery link will be sent. Check your inbox and spam folder.</p><button onClick={() => setPage('login')}>Back to sign in</button></>}
    {page === 'new-password' && <><h2>{invitationRedirect ? 'Choose a password' : 'Choose a new password'}</h2><form onSubmit={updatePassword}><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required /><label htmlFor="confirm-password">Confirm password</label><input id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required /><button disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button></form></>}
    {page === 'challenge' && <><h2>Verify your identity</h2><p>Enter the code from your authenticator app.</p>
      {enrollment ? <div><p>Scan this QR code with your authenticator app or enter the setup key there.</p>
        {enrollment.qr.startsWith('data:image/svg+xml') && <img className="mfa-qr" src={enrollment.qr} alt="Authenticator setup QR code" />}
        <p>Setup key: <code>{enrollment.secret}</code></p>
      </div> : <button type="button" className="link" disabled={busy} onClick={() => void setupAuthenticator()}>Set up an authenticator</button>}
      <form onSubmit={verifyCode}>
      <label htmlFor="code">Verification code</label><input id="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} required />
      <button disabled={busy}>{busy ? 'Verifying…' : 'Verify'}</button></form><button className="secondary" onClick={signOut} disabled={busy}>Sign out</button></>}
    {page === 'no-access' && <><h2>Access unavailable</h2><p>No active organization membership is available for this account. Contact your administrator.</p><button onClick={signOut} disabled={busy}>Sign out</button></>}
    {page === 'error' && <><h2>Access check unavailable</h2><p>We couldn’t confirm your access. Try again when the connection is available.</p>{session && <button onClick={signOut} disabled={busy}>Sign out</button>}{!session && client && <button onClick={() => void verifyAccess(null)}>Back to sign in</button>}</>}
    {error && <p role="alert" className="error">{error}</p>}
  </section></main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
