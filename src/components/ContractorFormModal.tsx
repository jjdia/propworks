import { useState } from 'react';
import type { Contractor } from '../lib/types';
import { saveContractor, blankMeta } from '../lib/mutations';
import { useAppStore } from '../store/useAppStore';

export function ContractorFormModal({ existing, onClose }: { existing?: Contractor; onClose: () => void }) {
  const ownerId = useAppStore((s) => s.ownerId) ?? 'local-owner';
  const [fullName, setFullName] = useState(existing?.full_name ?? '');
  const [trade, setTrade] = useState(existing?.trade ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!fullName.trim()) return;
    setSaving(true);
    const base = existing ?? blankMeta(ownerId);
    await saveContractor({
      ...base,
      full_name: fullName.trim(),
      trade: trade.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      notes: notes.trim() || undefined,
      deleted_at: existing?.deleted_at ?? null,
    });
    setSaving(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-3">
        <h2 className="text-lg font-semibold">{existing ? 'Edit contractor' : 'Add contractor'}</h2>
        <p className="text-xs text-slate-500">This is your own contact roster — not the same as a portal login. Use "Invite" below if you want them to log in and bid on jobs.</p>
        <Field label="Name"><input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
        <Field label="Trade"><input className={inputCls} value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="Plumbing, electrical, general…" /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Phone"><input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="Email"><input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        </div>
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
