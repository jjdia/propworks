import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
  listMaintenanceRequests, listMyBids, submitBid, submitJobCompletion, uploadPhoto,
} from '../lib/maintenance';
import type { MaintenanceRequest, JobBid } from '../lib/types';

export function ContractorJobs() {
  const profile = useAppStore((s) => s.profile);
  const ownerId = useAppStore((s) => s.ownerId);
  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [myBids, setMyBids] = useState<JobBid[]>([]);
  const [loading, setLoading] = useState(true);
  const [bidTarget, setBidTarget] = useState<MaintenanceRequest | null>(null);
  const [completeTarget, setCompleteTarget] = useState<MaintenanceRequest | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const [reqs, bids] = await Promise.all([listMaintenanceRequests(), listMyBids()]);
      setRequests(reqs);
      setMyBids(bids);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  if (profile?.contractor_status === 'pending') {
    return <p className="text-slate-400 text-sm p-4">Your contractor account is waiting on approval from the property manager. You'll see jobs here once approved.</p>;
  }
  if (profile?.contractor_status === 'rejected') {
    return <p className="text-slate-400 text-sm p-4">Your contractor account was not approved for this network.</p>;
  }

  const available = requests.filter((r) => r.status === 'approved_for_bidding' && !myBids.some((b) => b.maintenance_request_id === r.id));
  const myJobs = requests.filter((r) => r.status === 'awarded' && myBids.some((b) => b.maintenance_request_id === r.id && b.status === 'awarded'));
  const myPendingBids = requests.filter((r) => myBids.some((b) => b.maintenance_request_id === r.id && b.status === 'pending') && r.status === 'approved_for_bidding');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold mb-2">Available jobs</h1>
        {loading && <p className="text-slate-400 text-sm">Loading…</p>}
        {!loading && available.length === 0 && <p className="text-slate-400 text-sm">No open jobs right now.</p>}
        <div className="space-y-2">
          {available.map((r) => (
            <div key={r.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="flex items-start justify-between">
                <div className="text-sm font-medium">{r.title}</div>
                <span className="text-[10px] uppercase tracking-wide bg-slate-800 rounded px-1.5 py-0.5">{r.urgency}</span>
              </div>
              {r.description && <p className="text-xs text-slate-400 mt-1">{r.description}</p>}
              <button onClick={() => setBidTarget(r)} className="mt-2 text-xs rounded-md bg-indigo-600 hover:bg-indigo-500 px-2 py-1">
                Submit bid
              </button>
            </div>
          ))}
        </div>
      </div>

      {myPendingBids.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-300 mb-2">Your pending bids</h2>
          <div className="space-y-2">
            {myPendingBids.map((r) => (
              <div key={r.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-sm">
                {r.title} — waiting on the property manager
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-slate-300 mb-2">My jobs</h2>
        {myJobs.length === 0 && <p className="text-slate-400 text-sm">Nothing awarded yet.</p>}
        <div className="space-y-2">
          {myJobs.map((r) => (
            <div key={r.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="text-sm font-medium">{r.title}</div>
              {r.description && <p className="text-xs text-slate-400 mt-1">{r.description}</p>}
              <button onClick={() => setCompleteTarget(r)} className="mt-2 text-xs rounded-md bg-emerald-800 hover:bg-emerald-700 px-2 py-1">
                Submit completion
              </button>
            </div>
          ))}
        </div>
      </div>

      {bidTarget && ownerId && profile && (
        <BidModal
          request={bidTarget}
          ownerId={ownerId}
          contractorId={profile.id}
          onClose={() => setBidTarget(null)}
          onDone={() => { setBidTarget(null); refresh(); }}
        />
      )}
      {completeTarget && ownerId && profile && (
        <CompletionModal
          request={completeTarget}
          ownerId={ownerId}
          contractorId={profile.id}
          onClose={() => setCompleteTarget(null)}
          onDone={() => { setCompleteTarget(null); refresh(); }}
        />
      )}
    </div>
  );
}

function BidModal({ request, ownerId, contractorId, onClose, onDone }: {
  request: MaintenanceRequest; ownerId: string; contractorId: string; onClose: () => void; onDone: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!amount) return;
    setSaving(true);
    setError(null);
    try {
      await submitBid({ owner_id: ownerId, maintenance_request_id: request.id, contractor_id: contractorId, amount: Number(amount), message: message.trim() || undefined });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3">
        <h2 className="text-lg font-semibold">Bid on: {request.title}</h2>
        <label className="block text-sm">
          <span className="text-slate-400 text-xs">Your price</span>
          <input type="number" step="0.01" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-400 text-xs">Message (optional)</span>
          <textarea className={inputCls} rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
        {error && <p className="text-xs text-rose-400">{error}</p>}
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm">Cancel</button>
          <button onClick={handleSubmit} disabled={saving || !amount} className="flex-1 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2 text-sm font-medium">
            {saving ? 'Submitting…' : 'Submit bid'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CompletionModal({ request, ownerId, contractorId, onClose, onDone }: {
  request: MaintenanceRequest; ownerId: string; contractorId: string; onClose: () => void; onDone: () => void;
}) {
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<FileList | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    try {
      const paths: string[] = [];
      if (files) {
        for (const file of Array.from(files)) {
          paths.push(await uploadPhoto(request.id, 'completion', file));
        }
      }
      await submitJobCompletion({ owner_id: ownerId, maintenance_request_id: request.id, contractor_id: contractorId, notes: notes.trim() || undefined, photos: paths });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3">
        <h2 className="text-lg font-semibold">Complete: {request.title}</h2>
        <label className="block text-sm">
          <span className="text-slate-400 text-xs">Notes</span>
          <textarea className={inputCls} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was done, parts used, etc." />
        </label>
        <label className="block text-sm">
          <span className="text-slate-400 text-xs">Completion photos</span>
          <input type="file" accept="image/*" multiple capture="environment" className="mt-1 text-xs" onChange={(e) => setFiles(e.target.files)} />
        </label>
        {error && <p className="text-xs text-rose-400">{error}</p>}
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="flex-1 rounded-md bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 py-2 text-sm font-medium">
            {saving ? 'Submitting…' : 'Submit for payment'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 mt-1';
