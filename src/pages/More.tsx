import { useState } from 'react';
import { Link } from 'react-router-dom';
import { signOut } from '../lib/auth';
import { createOwnerInvite } from '../lib/maintenance';
import { useAppStore } from '../store/useAppStore';

const LINKS = [
  { to: '/notifications', label: 'Notifications', icon: '🔔' },
  { to: '/broadcasts', label: 'Announcements', icon: '📢' },
  { to: '/reports', label: 'Reports & Tax Export', icon: '📊' },
  { to: '/lease-generator', label: 'Lease Generator', icon: '📝' },
  { to: '/documents', label: 'Documents', icon: '📁' },
  { to: '/expenses', label: 'Expenses', icon: '🧾' },
  { to: '/tenants', label: 'Tenants', icon: '🧑\u200d🤝\u200d🧑' },
  { to: '/contractors', label: 'Contractors', icon: '🛠️' },
];

export function More() {
  const email = useAppStore((s) => s.email);
  const ownerId = useAppStore((s) => s.ownerId);
  const localOnly = useAppStore((s) => s.localOnly);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleInviteCoOwner() {
    if (!ownerId) return;
    setError(null);
    try {
      setInviteCode(await createOwnerInvite(ownerId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">More</h1>
      <div className="space-y-2">
        {LINKS.map((l) => (
          <Link key={l.to} to={l.to} className="flex items-center gap-3 bg-slate-900 border border-slate-800 rounded-xl p-4 hover:border-slate-700">
            <span className="text-lg">{l.icon}</span>
            <span className="text-sm font-medium">{l.label}</span>
          </Link>
        ))}
      </div>

      {!localOnly && (
        <div className="pt-4 border-t border-slate-800 space-y-2">
          <button onClick={handleInviteCoOwner} className="w-full flex items-center gap-3 bg-slate-900 border border-slate-800 rounded-xl p-4 hover:border-slate-700 text-left">
            <span className="text-lg">👥</span>
            <div>
              <div className="text-sm font-medium">Invite a co-owner</div>
              <div className="text-xs text-slate-500">Share this exact portfolio with a spouse or partner's own login</div>
            </div>
          </button>
          {error && <p className="text-xs text-rose-400">{error}</p>}
        </div>
      )}

      {!localOnly && (
        <div className="pt-4 border-t border-slate-800">
          {email && <p className="text-xs text-slate-500 mb-2">Signed in as {email}</p>}
          <button onClick={() => signOut()} className="text-sm rounded-md bg-slate-800 hover:bg-slate-700 px-3 py-2">
            Sign out
          </button>
        </div>
      )}

      {inviteCode && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
          <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-3 text-center">
            <h2 className="text-lg font-semibold">Co-owner invite code</h2>
            <div className="text-3xl font-mono tracking-widest bg-slate-800 rounded-lg py-4">{inviteCode}</div>
            <p className="text-xs text-slate-400">
              They sign up choosing "I have a co-owner invite code" and enter this. Once redeemed, their login sees and edits the exact same portfolio as yours — single-use.
            </p>
            <button onClick={() => setInviteCode(null)} className="w-full rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
