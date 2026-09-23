import { useState } from 'react';
import type { Tenant } from '../lib/types';
import { saveTenant, blankMeta } from '../lib/mutations';
import { useAppStore } from '../store/useAppStore';

export function TenantFormModal({ existing, onClose }: { existing?: Tenant; onClose: () => void }) {
  const ownerId = useAppStore((s) => s.ownerId) ?? 'local-owner';
  const [fullName, setFullName] = useState(existing?.full_name ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [emergencyName, setEmergencyName] = useState(existing?.emergency_contact_name ?? '');
  const [emergencyPhone, setEmergencyPhone] = useState(existing?.emergency_contact_phone ?? '');
  const [occupants, setOccupants] = useState(existing?.other_occupants ?? '');
  const [pets, setPets] = useState(existing?.pets ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!fullName.trim()) return;
    setSaving(true);
    const base = existing ?? blankMeta(ownerId);
    await saveTenant({
      ...base,
      full_name: fullName.trim(),
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      emergency_contact_name: emergencyName.trim() || undefined,
      emergency_contact_phone: emergencyPhone.trim() || undefined,
      other_occupants: occupants.trim() || undefined,
      pets: pets.trim() || undefined,
      notes: notes.trim() || undefined,
      deleted_at: existing?.deleted_at ?? null,
    });
    setSaving(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold">{existing ? 'Edit tenant' : 'Add tenant'}</h2>
        <Field label="Full name"><input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Phone"><input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="Email"><input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Emergency contact"><input className={inputCls} value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} /></Field>
          <Field label="Emergency phone"><input className={inputCls} value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} /></Field>
        </div>
        <Field label="Other occupants"><input className={inputCls} value={occupants} onChange={(e) => setOccupants(e.target.value)} /></Field>
        <Field label="Pets"><input className={inputCls} value={pets} onChange={(e) => setPets(e.target.value)} /></Field>
        <Field label="Notes"><textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm">Cancel</button>
          <button onClick={handleSave} disabled={saving || !fullName.trim()} className="flex-1 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2 text-sm font-medium">
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
