import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { createMaintenanceRequest } from '../lib/maintenance';
import { useAppStore } from '../store/useAppStore';
import type { RequestUrgency } from '../lib/types';

// Lets the OWNER log a maintenance item directly — a common-area repair,
// something they noticed themselves, an "odd" one-off request — without
// requiring a tenant to have submitted it through their portal first.
// Created straight into 'approved_for_bidding' since there's no separate
// party whose submission needs review; the owner is both.
export function AddMaintenanceRequestModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const ownerId = useAppStore((s) => s.ownerId) ?? 'local-owner';
  const properties = useLiveQuery(() => db.properties.filter((p) => !p.deleted_at).sortBy('name'), []);
  const units = useLiveQuery(() => db.rental_units.toArray(), []);
  const leases = useLiveQuery(() => db.leases.filter((l) => !l.deleted_at && l.status === 'active').toArray(), []);
  const tenants = useLiveQuery(() => db.tenants.toArray(), []);

  const [propertyId, setPropertyId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [urgency, setUrgency] = useState<RequestUrgency>('normal');
  const [permission, setPermission] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const propertyUnits = units?.filter((u) => u.property_id === propertyId) ?? [];
  const unitLeases = leases?.filter((l) => l.rental_unit_id === unitId) ?? [];

  async function handleSubmit() {
    if (!propertyId || !title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createMaintenanceRequest({
        owner_id: ownerId, property_id: propertyId,
        rental_unit_id: unitId || undefined,
        tenant_id: tenantId || undefined,
        submitted_by: ownerId, // the owner is submitting this one themselves
        title: title.trim(), description: description.trim() || undefined,
        urgency, permission_to_enter: permission,
        status: 'approved_for_bidding',
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold">Add maintenance request</h2>
        <p className="text-xs text-slate-500">For anything you're logging yourself — a common-area repair, something you noticed, a one-off job — not tied to a tenant's own submission.</p>

        {!properties?.length ? (
          <p className="text-sm text-amber-300">Add a property first.</p>
        ) : (
          <>
            <Field label="Property">
              <select className={inputCls} value={propertyId} onChange={(e) => { setPropertyId(e.target.value); setUnitId(''); setTenantId(''); }}>
                <option value="">Select a property…</option>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Unit (optional — leave blank for common areas)">
              <select className={inputCls} value={unitId} onChange={(e) => { setUnitId(e.target.value); setTenantId(''); }}>
                <option value="">Common area / whole property</option>
                {propertyUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            {unitLeases.length > 0 && (
              <Field label="Tenant (optional)">
                <select className={inputCls} value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
                  <option value="">No specific tenant</option>
                  {unitLeases.map((l) => {
                    const t = tenants?.find((tt) => tt.id === l.tenant_id);
                    return <option key={l.id} value={l.tenant_id}>{t?.full_name ?? 'Unknown'}</option>;
                  })}
                </select>
              </Field>
            )}
            <Field label="What's the issue?"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Roof inspection, hallway light out…" /></Field>
            <Field label="Details"><textarea className={inputCls} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
            <Field label="Urgency">
              <select className={inputCls} value={urgency} onChange={(e) => setUrgency(e.target.value as RequestUrgency)}>
                <option value="normal">Normal</option>
                <option value="important">Important</option>
                <option value="urgent">Urgent</option>
                <option value="emergency">Emergency</option>
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={permission} onChange={(e) => setPermission(e.target.checked)} />
              OK for a contractor to access without a tenant present
            </label>
          </>
        )}

        {error && <p className="text-xs text-rose-400">{error}</p>}

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={saving || !properties?.length || !propertyId || !title.trim()}
            className="flex-1 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2 text-sm font-medium"
          >
            {saving ? 'Adding…' : 'Add — ready for bids'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500';
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-slate-400 text-xs">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
