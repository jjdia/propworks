import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { saveExpense, blankMeta } from '../lib/mutations';
import { useAppStore } from '../store/useAppStore';
import { EXPENSE_CATEGORIES, type PaidBy, type Frequency, type Expense } from '../lib/types';

export function ExpenseFormModal({ existing, onClose }: { existing?: Expense; onClose: () => void }) {
  const ownerId = useAppStore((s) => s.ownerId) ?? 'local-owner';
  const properties = useLiveQuery(() => db.properties.filter((p) => !p.deleted_at).sortBy('name'), []);

  const [propertyId, setPropertyId] = useState(existing?.property_id ?? '');
  const [date, setDate] = useState(existing?.expense_date ?? new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState<string>(existing?.category ?? EXPENSE_CATEGORIES[0]);
  const [paidBy, setPaidBy] = useState<PaidBy>(existing?.paid_by ?? 'landlord');
  const [frequency, setFrequency] = useState<Frequency>(existing?.frequency ?? 'one_time');
  const [vendor, setVendor] = useState(existing?.vendor ?? '');
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [saving, setSaving] = useState(false);

  const effectivePropertyId = propertyId || properties?.[0]?.id || '';

  async function handleSave() {
    if (!effectivePropertyId || !amount) return;
    setSaving(true);
    const base = existing ?? blankMeta(ownerId);
    await saveExpense({
      ...base,
      property_id: effectivePropertyId,
      expense_date: date,
      category,
      paid_by: paidBy,
      frequency,
      vendor: vendor.trim() || undefined,
      amount: Number(amount),
      description: description.trim() || undefined,
      deleted_at: existing?.deleted_at ?? null,
    });
    setSaving(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold">{existing ? 'Edit expense' : 'Add expense'}</h2>

        {!properties?.length ? (
          <p className="text-sm text-amber-300">Add a property first before logging expenses.</p>
        ) : (
          <>
            <Field label="Property">
              <select className={inputCls} value={effectivePropertyId} onChange={(e) => setPropertyId(e.target.value)}>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Date"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Amount">
                <input type="number" step="0.01" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </Field>
            </div>
            <Field label="Category">
              <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Paid by">
                <select className={inputCls} value={paidBy} onChange={(e) => setPaidBy(e.target.value as PaidBy)}>
                  <option value="landlord">Landlord</option>
                  <option value="tenant">Tenant</option>
                  <option value="split_reimbursed">Split / Reimbursed</option>
                </select>
              </Field>
              <Field label="Frequency">
                <select className={inputCls} value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
                  <option value="one_time">One-time</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="seasonal">Seasonal</option>
                  <option value="annual">Annual</option>
                </select>
              </Field>
            </div>
            <Field label="Vendor / provider"><input className={inputCls} value={vendor} onChange={(e) => setVendor(e.target.value)} /></Field>
            <Field label="Notes"><textarea className={inputCls} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          </>
        )}

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || !properties?.length || !amount}
            className="flex-1 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2 text-sm font-medium"
          >
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
