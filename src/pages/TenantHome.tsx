import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
  listMaintenanceRequests, createMaintenanceRequest, uploadPhoto, attachRequestPhotos,
  getMyTenantContext, type TenantContext,
} from '../lib/maintenance';
import type { MaintenanceRequest, RequestUrgency } from '../lib/types';

const STATUS_LABEL: Record<string, string> = {
  submitted: 'Submitted — waiting for review',
  approved_for_bidding: 'Approved — out for contractor bids',
  awarded: 'Contractor assigned',
  completed: 'Work completed',
  closed: 'Closed',
  rejected: 'Not approved',
};

export function TenantHome() {
  const profile = useAppStore((s) => s.profile);
  const ownerId = useAppStore((s) => s.ownerId);
  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      setRequests(await listMaintenanceRequests());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  if (!profile?.tenant_id) {
    return <p className="text-slate-400 text-sm p-4">Your account isn't linked to a tenant record yet — ask your property manager for a new invite code.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Maintenance</h1>
        <button onClick={() => setShowForm(true)} className="rounded-md bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-sm font-medium">
          + Report an issue
        </button>
      </div>

      {loading && <p className="text-slate-400 text-sm">Loading…</p>}
      {!loading && requests.length === 0 && <p className="text-slate-400 text-sm">No requests yet. Report an issue to get started.</p>}

      <div className="space-y-2">
        {requests.map((r) => (
          <div key={r.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
            <div className="flex items-start justify-between">
              <div className="text-sm font-medium">{r.title}</div>
              <span className="text-[10px] uppercase tracking-wide bg-slate-800 rounded px-1.5 py-0.5 text-slate-300">{r.urgency}</span>
            </div>
            {r.description && <p className="text-xs text-slate-400 mt-1">{r.description}</p>}
            <p className="text-xs text-indigo-300 mt-2">{STATUS_LABEL[r.status] ?? r.status}</p>
          </div>
        ))}
      </div>

      {showForm && ownerId && profile.tenant_id && (
        <ReportIssueForm
          ownerId={ownerId}
          tenantId={profile.tenant_id}
          submittedBy={profile.id}
          onDone={() => { setShowForm(false); refresh(); }}
        />
      )}
    </div>
  );
}

function ReportIssueForm({ ownerId, tenantId, submittedBy, onDone }: {
  ownerId: string; tenantId: string; submittedBy: string; onDone: () => void;
}) {
  const [context, setContext] = useState<TenantContext[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [urgency, setUrgency] = useState<RequestUrgency>('normal');
  const [permission, setPermission] = useState(false);
  const [files, setFiles] = useState<FileList | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMyTenantContext().then((ctx) => {
      setContext(ctx);
      if (ctx.length > 0) setPropertyId(ctx[0].propertyId);
    }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function handleSubmit() {
    if (!title.trim() || !propertyId) {
      setError('Please fill in the property and a title.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const request = await createMaintenanceRequest({
        owner_id: ownerId, property_id: propertyId, tenant_id: tenantId,
        submitted_by: submittedBy, title: title.trim(), description: description.trim() || undefined,
        urgency, permission_to_enter: permission,
      });
      if (files && files.length > 0) {
        const paths: string[] = [];
        for (const file of Array.from(files)) {
          paths.push(await uploadPhoto(request.id, 'request', file));
        }
        await attachRequestPhotos(request.id, paths);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold">Report an issue</h2>
        <label className="block text-sm">
          <span className="text-slate-400 text-xs">Property / unit</span>
          {context.length === 0 ? (
            <p className="text-xs text-amber-300 mt-1">No unit on file for your account yet.</p>
          ) : (
            <select className={inputCls} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              {context.map((c) => (
                <option key={c.propertyId} value={c.propertyId}>{c.propertyName} — {c.unitName}</option>
              ))}
            </select>
          )}
        </label>
        <label className="block text-sm">
          <span className="text-slate-400 text-xs">What's the issue?</span>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Leaking faucet" />
        </label>
        <label className="block text-sm">
          <span className="text-slate-400 text-xs">Details</span>
          <textarea className={inputCls} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-400 text-xs">Urgency</span>
          <select className={inputCls} value={urgency} onChange={(e) => setUrgency(e.target.value as RequestUrgency)}>
            <option value="normal">Normal</option>
            <option value="important">Important</option>
            <option value="urgent">Urgent</option>
            <option value="emergency">Emergency</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={permission} onChange={(e) => setPermission(e.target.checked)} />
          OK to enter without me present
        </label>
        <label className="block text-sm">
          <span className="text-slate-400 text-xs">Photos (optional)</span>
          <input type="file" accept="image/*" multiple capture="environment" className="mt-1 text-xs" onChange={(e) => setFiles(e.target.files)} />
        </label>
        {error && <p className="text-xs text-rose-400">{error}</p>}
        <div className="flex gap-2 pt-2">
          <button onClick={onDone} className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="flex-1 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2 text-sm font-medium">
            {saving ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 mt-1';
