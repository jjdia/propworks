import { useState } from 'react';
import { updatePassword } from '../lib/auth';
import { useAppStore } from '../store/useAppStore';
import { APP_VERSION } from '../version';

export function SetNewPassword() {
  const setPasswordRecoveryMode = useAppStore((s) => s.setPasswordRecoveryMode);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      setDone(true);
      setTimeout(() => setPasswordRecoveryMode(false), 1200);
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

        {done ? (
          <p className="text-sm text-emerald-400">Password updated — continuing to the app…</p>
        ) : (
          <>
            <p className="text-sm text-slate-400">Choose a new password for your account.</p>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                className={inputCls} type="password" placeholder="New password" value={password}
                onChange={(e) => setPassword(e.target.value)} autoComplete="new-password"
              />
              <input
                className={inputCls} type="password" placeholder="Confirm new password" value={confirm}
                onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password"
              />
              {error && <p className="text-xs text-rose-400">{error}</p>}
              <button type="submit" disabled={busy} className="w-full rounded-md bg-indigo-600 hover:bg-indigo-500 py-2 text-sm font-medium disabled:opacity-50">
                {busy ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500';
