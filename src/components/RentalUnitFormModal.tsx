import { useState } from 'react';
import type { RentalUnit, UnitKind, UnitStatus } from '../lib/types';
import { saveRentalUnit, blankMeta } from '../lib/mutations';
import { useAppStore } from '../store/useAppStore';

export function RentalUnitFormModal({ propertyId, existing, onClose }: {
  propertyId: string; existing?: RentalUnit; onClose: () => void;
}) {
  const ownerId = useAppStore((s) => s.ownerId) ?? 'local-owner';
  const [name, setName] = useState(existing?.name ?? '');
  const [kind, setKind] = useState<UnitKind>(existing?.unit_kind ?? 'apartment');
  const [status, setStatus] = useState<UnitStatus>(existing?.status ?? 'vacant');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    const base = existing ?? { ...blankMeta(ownerId), property_id: propertyId };
    await saveRentalUnit({
      ...base,
      property_id: propertyId,
      name: name.trim(),
      unit_kind: kind,
      status,
      notes: notes.trim() || undefined,
      deleted_at: existing?.deleted_at ?? null,
    });
    setSaving(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-3">
        <h2 className="text-lg font-semibold">{existing ? 'Edit unit' : 'Add unit'}</h2>
        <Field label="Name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Unit 1, Unit 2, Garage" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Type">
            <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as UnitKind)}>
              <option value="apartment">Apartment</option>
              <option value="garage">Garage</option>
              <option value="parking">Parking</option>
              <option value="storage">Storage</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as UnitStatus)}>
              <option value="vacant">Vacant</option>
              <option value="occupied">Occupied</option>
              <option value="available">Available</option>
              <option value="advertising">Advertising</option>
            </select>
          </Field>
        </div>
        <Field label="Notes"><textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm">Cancel</button>
          <button onClick={handleSave} disabled={saving || !name.trim()} className="flex-1 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2 text-sm font-medium">
            {saving ? 'Saving…' : 'Save'}
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
