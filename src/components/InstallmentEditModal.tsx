import { useState } from 'react';
import type { RentInstallment, InstallmentStatus } from '../lib/types';
import { saveRentInstallment } from '../lib/mutations';

export function InstallmentEditModal({ installment, onClose, onSaved }: {
  installment: RentInstallment; onClose: () => void; onSaved: () => void;
}) {
  const [status, setStatus] = useState<InstallmentStatus>(installment.status);
  const [paidDate, setPaidDate] = useState(installment.paid_date ?? new Date().toISOString().slice(0, 10));
  const [paidAmount, setPaidAmount] = useState(String(installment.paid_amount ?? installment.amount));
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await saveRentInstallment({
      ...installment,
      status,
      paid_date: status === 'paid' || status === 'partial' ? paidDate : undefined,
      paid_amount: status === 'paid' || status === 'partial' ? Number(paidAmount) : undefined,
    });
    setSaving(false);
    onSaved();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-3">
        <h2 className="text-lg font-semibold">Update payment</h2>
        <p className="text-xs text-slate-400">Due {installment.due_date} · ${Number(installment.amount).toFixed(2)}</p>

        <Field label="Status">
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as InstallmentStatus)}>
            <option value="unknown">Unknown</option>
            <option value="due">Due</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="late">Late</option>
          </select>
        </Field>

        {(status === 'paid' || status === 'partial') && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Paid date"><input type="date" className={inputCls} value={paidDate} onChange={(e) => setPaidDate(e.target.value)} /></Field>
            <Field label="Amount paid"><input type="number" step="0.01" className={inputCls} value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} /></Field>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2 text-sm font-medium">
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
