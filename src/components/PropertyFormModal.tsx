import { useState } from 'react';
import type { Property } from '../lib/types';
import { saveProperty, blankMeta } from '../lib/mutations';
import { useAppStore } from '../store/useAppStore';

export function PropertyFormModal({ existing, onClose }: { existing?: Property; onClose: () => void }) {
  const ownerId = useAppStore((s) => s.ownerId) ?? 'local-owner';
  const [name, setName] = useState(existing?.name ?? '');
  const [addressLine, setAddressLine] = useState(existing?.address_line ?? '');
  const [city, setCity] = useState(existing?.city ?? 'Staten Island');
  const [state, setState] = useState(existing?.state ?? 'NY');
  const [zip, setZip] = useState(existing?.zip ?? '');
  const [propertyType, setPropertyType] = useState(existing?.property_type ?? 'two-family');
  const [entityName, setEntityName] = useState(existing?.entity_name ?? '');
  const [hasMortgage, setHasMortgage] = useState(existing?.has_mortgage ?? false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    const base = existing ?? blankMeta(ownerId);
    await saveProperty({
      ...base,
      name: name.trim(),
      address_line: addressLine.trim() || undefined,
      city: city.trim() || undefined,
      state: state.trim() || undefined,
      zip: zip.trim() || undefined,
      property_type: propertyType,
      entity_name: entityName.trim() || undefined,
      has_mortgage: hasMortgage,
      deleted_at: existing?.deleted_at ?? null,
    });
    setSaving(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold">{existing ? 'Edit property' : 'Add property'}</h2>

        <Field label="Name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="62 Fillmore Street" />
        </Field>
        <Field label="Address">
          <input className={inputCls} value={addressLine} onChange={(e) => setAddressLine(e.target.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="City"><input className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} /></Field>
          <Field label="State"><input className={inputCls} value={state} onChange={(e) => setState(e.target.value)} /></Field>
          <Field label="Zip"><input className={inputCls} value={zip} onChange={(e) => setZip(e.target.value)} /></Field>
        </div>
        <Field label="Type">
          <select className={inputCls} value={propertyType} onChange={(e) => setPropertyType(e.target.value)}>
            {['two-family', 'multi-family', 'single-family', 'condo'].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Held by / entity (optional)">
          <input className={inputCls} value={entityName} onChange={(e) => setEntityName(e.target.value)} placeholder="e.g. an irrevocable trust" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={hasMortgage} onChange={(e) => setHasMortgage(e.target.checked)} />
          Has a mortgage
        </label>

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
