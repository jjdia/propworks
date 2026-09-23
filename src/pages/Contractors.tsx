import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { useAppStore } from '../store/useAppStore';
import { listContractors, setContractorStatus, createContractorInvite } from '../lib/maintenance';
import { ContractorFormModal } from '../components/ContractorFormModal';
import type { Profile, Contractor } from '../lib/types';

export function Contractors() {
  const ownerId = useAppStore((s) => s.ownerId) ?? '';
  const [portalAccounts, setPortalAccounts] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [editRosterEntry, setEditRosterEntry] = useState<Contractor | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const roster = useLiveQuery(() => db.contractors.filter((c) => !c.deleted_at).sortBy('full_name'), []);

  async function refresh() {
    setLoading(true);
    try {
      setPortalAccounts(await listContractors());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  async function handleInvite() {
    setError(null);
    try {
      setInviteCode(await createContractorInvite(ownerId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleStatus(id: string, status: 'approved' | 'rejected') {
    await setContractorStatus(id, status);
    refresh();
  }

  const pending = portalAccounts.filter((c) => c.contractor_status === 'pending');
  const approved = portalAccounts.filter((c) => c.contractor_status === 'approved');

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Contractors</h1>
      {error && <p className="text-xs text-rose-400">{error}</p>}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-slate-300">Your roster</h2>
          <button onClick={() => setEditRosterEntry('new')} className="rounded-md bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-sm font-medium">
            + Add contractor
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-2">Contacts you keep on file — not the same as a portal login below.</p>
        {roster?.length === 0 && <p className="text-slate-400 text-sm">No contractors added yet.</p>}
        <div className="space-y-2">
          {roster?.map((c) => (
            <button key={c.id} onClick={() => setEditRosterEntry(c)} className="w-full text-left bg-slate-900 border border-slate-800 rounded-xl p-3 hover:border-slate-700">
              <div className="text-sm font-medium">{c.full_name}</div>
              <div className="text-xs text-slate-400">{[c.trade, c.phone, c.email].filter(Boolean).join(' · ')}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="pt-2 border-t border-slate-800">
        <div className="flex items-center justify-between mb-2 pt-2">
          <h2 className="text-sm font-semibold text-slate-300">Portal logins</h2>
          <button onClick={handleInvite} className="rounded-md bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-sm font-medium">
            + Invite to bid
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-2">Contractors who sign in to see jobs and submit bids.</p>
        {loading && <p className="text-slate-400 text-sm">Loading…</p>}

        {pending.length > 0 && (
          <div className="mb-3">
            <h3 className="text-xs font-semibold text-slate-400 mb-1">Pending approval</h3>
            <div className="space-y-2">
              {pending.map((c) => (
                <div key={c.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{c.full_name}</div>
                    {c.trade && <div className="text-xs text-slate-400">{c.trade}</div>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleStatus(c.id, 'approved')} className="text-xs rounded-md bg-emerald-800 hover:bg-emerald-700 px-2 py-1">Approve</button>
                    <button onClick={() => handleStatus(c.id, 'rejected')} className="text-xs rounded-md bg-slate-800 hover:bg-rose-900 px-2 py-1">Reject</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {approved.length === 0 && <p className="text-slate-400 text-sm">None approved yet.</p>}
        <div className="space-y-2">
          {approved.map((c) => (
            <div key={c.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="text-sm font-medium">{c.full_name}</div>
              {c.trade && <div className="text-xs text-slate-400">{c.trade}</div>}
            </div>
          ))}
        </div>
      </div>

      {editRosterEntry && (
        <ContractorFormModal existing={editRosterEntry === 'new' ? undefined : editRosterEntry} onClose={() => setEditRosterEntry(null)} />
      )}

      {inviteCode && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
          <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-3 text-center">
            <h2 className="text-lg font-semibold">Contractor invite code</h2>
            <div className="text-3xl font-mono tracking-widest bg-slate-800 rounded-lg py-4">{inviteCode}</div>
            <p className="text-xs text-slate-400">They'll use this to sign up, then still need your approval before they see any jobs.</p>
            <button onClick={() => setInviteCode(null)} className="w-full rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
