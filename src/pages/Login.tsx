import { useState } from 'react';
import { signInWithPassword, signUpWithPassword, resetPasswordForEmail, type SignUpRole } from '../lib/auth';
import { getMyProfile } from '../lib/maintenance';
import { useAppStore } from '../store/useAppStore';
import { APP_VERSION } from '../version';

type Mode = 'signin' | 'signup-owner' | 'signup-owner-invite' | 'signup-tenant' | 'signup-contractor' | 'forgot-password';

export function Login() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [code, setCode] = useState('');
  const [trade, setTrade] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const setSession = useAppStore((s) => s.setSession);
  const setProfile = useAppStore((s) => s.setProfile);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      if (mode === 'forgot-password') {
        await resetPasswordForEmail(email);
        setResetSent(true);
      } else if (mode === 'signin') {
        // The app-level auth listener (App.tsx) handles the transition on
        // sign-in — the profile already exists by then, so there's no race.
        await signInWithPassword(email, password);
      } else {
        const role: SignUpRole =
          mode === 'signup-owner' ? 'owner'
          : mode === 'signup-owner-invite' ? { role: 'owner_invite', code: code.trim().toUpperCase() }
          : mode === 'signup-tenant' ? { role: 'tenant', code: code.trim().toUpperCase() }
          : { role: 'contractor', code: code.trim().toUpperCase(), trade: trade.trim() || undefined };
        const session = await signUpWithPassword(email, password, fullName.trim(), role);

        // BUG FIX: right after signup, Supabase's own auth-state-change
        // event can fire (and App.tsx's listener can fetch the profile)
        // BEFORE the profile row above finishes being written — that fetch
        // then finds nothing and leaves the app stuck on this screen even
        // though the account was created successfully. Rather than rely on
        // that passive listener, explicitly push the session+profile into
        // the store here, AFTER signUpWithPassword has fully finished
        // creating the profile — this call is guaranteed to run last.
        if (session?.user) {
          const profile = await getMyProfile();
          // Data reads/writes scope to the PORTFOLIO (profile.owner_id),
          // not the login's own id — matters for a co-owner joining an
          // existing portfolio via invite.
          setSession(profile?.owner_id ?? session.user.id, session.user.email ?? null);
          setProfile(profile);
        } else {
          setError('Account created — please sign in.');
          setMode('signin');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="max-w-sm w-full space-y-4">
        <h1 className="text-xl font-bold">PropertyWorks</h1>
        <p className="text-[10px] text-slate-600 font-mono -mt-3">{APP_VERSION}</p>

        {mode === 'signin' ? (
          <p className="text-sm text-slate-400">Sign in to your account.</p>
        ) : mode === 'forgot-password' ? (
          <p className="text-sm text-slate-400">Enter your email and we'll send a link to reset your password.</p>
        ) : (
          <p className="text-sm text-slate-400">
            {mode === 'signup-owner' && 'Create the owner/admin account for your portfolio.'}
            {mode === 'signup-owner-invite' && "Enter the co-owner invite code to join an existing portfolio (e.g. a spouse or business partner's)."}
            {mode === 'signup-tenant' && "Enter the invite code your landlord gave you."}
            {mode === 'signup-contractor' && 'Enter the contractor invite code, or ask your property manager for one.'}
          </p>
        )}

        {mode === 'forgot-password' && resetSent ? (
          <p className="text-sm text-emerald-400">Check your email for a reset link.</p>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-3">
            <input
              className={inputCls} type="email" placeholder="Email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username" autoCapitalize="none" autoCorrect="off" inputMode="email"
            />
            {mode !== 'forgot-password' && (
              <input
                className={inputCls} type="password" placeholder="Password" value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              />
            )}

            {mode !== 'signin' && mode !== 'forgot-password' && (
              <input className={inputCls} placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
            )}
            {(mode === 'signup-owner-invite' || mode === 'signup-tenant' || mode === 'signup-contractor') && (
              <input className={inputCls} placeholder="Invite code" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" />
            )}
            {mode === 'signup-contractor' && (
              <input className={inputCls} placeholder="Trade (e.g. plumbing, electrical)" value={trade} onChange={(e) => setTrade(e.target.value)} />
            )}

            {error && <p className="text-xs text-rose-400">{error}</p>}

            <button type="submit" disabled={busy} className="w-full rounded-md bg-indigo-600 hover:bg-indigo-500 py-2 text-sm font-medium disabled:opacity-50">
              {busy ? 'Sending…' : mode === 'signin' ? 'Sign in' : mode === 'forgot-password' ? 'Send reset link' : 'Create account'}
            </button>
          </form>
        )}

        {mode === 'signin' && (
          <button onClick={() => { setMode('forgot-password'); setError(null); }} className="block w-full text-center text-xs text-indigo-400 hover:text-indigo-300">
            Forgot password?
          </button>
        )}

        <div className="pt-2 border-t border-slate-800 space-y-1 text-xs text-center">
          {mode !== 'signin' && (
            <button onClick={() => { setMode('signin'); setResetSent(false); setError(null); }} className="block w-full text-slate-400 hover:text-slate-200 py-1">
              Have an account? Sign in
            </button>
          )}
          {mode !== 'forgot-password' && (
            <>
              {mode !== 'signup-owner' && (
                <button onClick={() => setMode('signup-owner')} className="block w-full text-slate-400 hover:text-slate-200 py-1">
                  New landlord/owner account
                </button>
              )}
              {mode !== 'signup-owner-invite' && (
                <button onClick={() => setMode('signup-owner-invite')} className="block w-full text-slate-400 hover:text-slate-200 py-1">
                  I have a co-owner invite code
                </button>
              )}
              {mode !== 'signup-tenant' && (
                <button onClick={() => setMode('signup-tenant')} className="block w-full text-slate-400 hover:text-slate-200 py-1">
                  I'm a tenant with an invite code
                </button>
              )}
              {mode !== 'signup-contractor' && (
                <button onClick={() => setMode('signup-contractor')} className="block w-full text-slate-400 hover:text-slate-200 py-1">
                  I'm a contractor/handyman
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500';
