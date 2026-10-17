import { useEffect, useState } from 'react';
import { getPushState, subscribePush, unsubscribePush, isIos, type PushState } from '../lib/push';

const COPY: Record<'tenant' | 'owner', { title: string; blurb: string }> = {
  tenant: { title: 'Rent reminders on this device', blurb: 'Get a push notification on the day your rent (or your portion) is due. Nothing is sent if it\'s already paid.' },
  owner: { title: 'Push alerts on this device', blurb: 'Rent-day summary on the 1st and 15th (who was reminded, what\'s outstanding) and a reminder on each bill\'s due day.' },
};

export function PushSettings({ audience }: { audience: 'tenant' | 'owner' }) {
  const [state, setState] = useState<PushState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { getPushState().then(setState).catch(() => setState('unsupported')); }, []);

  async function run(fn: () => Promise<PushState>) {
    setBusy(true); setError(null);
    try { setState(await fn()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  const c = COPY[audience];
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
      <div className="text-sm font-medium">🔔 {c.title}</div>
      <p className="text-xs text-slate-400">{c.blurb}</p>
      {state === 'subscribed' && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-emerald-400">On for this device</span>
          <button disabled={busy} onClick={() => run(unsubscribePush)} className="rounded-md bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs">Turn off</button>
        </div>
      )}
      {state === 'not_subscribed' && (
        <button disabled={busy} onClick={() => run(subscribePush)} className="rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3 py-1.5 text-xs font-medium">
          {busy ? 'Turning on…' : 'Turn on push notifications'}
        </button>
      )}
      {state === 'denied' && <p className="text-xs text-amber-300">Notifications are blocked for this site. Allow them in your browser/phone settings, then reopen the app.</p>}
      {state === 'not_configured' && <p className="text-xs text-slate-500">Push isn't set up on the server yet.</p>}
      {state === 'unsupported' && <p className="text-xs text-slate-500">This browser doesn't support push notifications.</p>}
      {state === 'needs_install' && (
        <p className="text-xs text-amber-300">On iPhone/iPad, push only works after you add PropertyWorks to your Home Screen (Share → Add to Home Screen, iOS 16.4 or newer), then open it from that icon.</p>
      )}
      {(isIos() && state !== 'needs_install') && (
        <p className="text-[11px] text-slate-500">iPhone/iPad: push is only delivered to the Home Screen app (iOS 16.4+), not to Safari tabs.</p>
      )}
      {!isIos() && state !== 'needs_install' && (
        <p className="text-[11px] text-slate-500">Note: on iPhone/iPad, push is only delivered if PropertyWorks is installed to the Home Screen (iOS 16.4+).</p>
      )}
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}
