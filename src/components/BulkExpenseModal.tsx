import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { saveExpense, blankMeta } from '../lib/mutations';
import { useAppStore } from '../store/useAppStore';
import { EXPENSE_CATEGORIES, type PaidBy, type Frequency } from '../lib/types';

// For expenses that recur identically in shape across many properties —
// mortgage payments being the clearest example — filling out the full
// Add Expense form once per property is needless repetition. This form
// fixes the category/date/frequency/paid-by ONCE and lets the owner type
// just an amount per property; any property left blank is simply skipped.
export function BulkExpenseModal({ onClose }: { onClose: () => void }) {
  const ownerId = useAppStore((s) => s.ownerId) ?? 'local-owner';
  const properties = useLiveQuery(() => db.properties.filter((p) => !p.deleted_at).sortBy('name'), []);

  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [paidBy, setPaidBy] = useState<PaidBy>('landlord');
  const [frequency, setFrequency] = useState<Frequency>('monthly');
  const [vendor, setVendor] = useState('');
  const [description, setDescription] = useState('');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ created: number } | null>(null);

  const filledCount = Object.values(amounts).filter((v) => v && Number(v) > 0).length;

  async function handleSave() {
    setSaving(true);
    let created = 0;
    for (const property of properties ?? []) {
      const amount = amounts[property.id];
      if (!amount || Number(amount) <= 0) continue;
      await saveExpense({
        ...blankMeta(ownerId),
        property_id: property.id,
        expense_date: date,
        category,
        paid_by: paidBy,
        frequency,
        vendor: vendor.trim() || undefined,
        amount: Number(amount),
        description: description.trim() || undefined,
      });
      created++;
    }
    setSaving(false);
    setResult({ created });
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold">Bulk add expense</h2>
        <p className="text-xs text-slate-400">One category, date, and frequency — enter an amount for each property that applies. Leave a property blank to skip it.</p>

        {!properties?.length ? (
          <p className="text-sm text-amber-300">Add a property first.</p>
        ) : (
          <>
            <Field label="Category">
              <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Date"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
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
            <div className="grid grid-cols-2 gap-2">
              <Field label="Paid by">
                <select className={inputCls} value={paidBy} onChange={(e) => setPaidBy(e.target.value as PaidBy)}>
                  <option value="landlord">Landlord</option>
                  <option value="tenant">Tenant</option>
                  <option value="split_reimbursed">Split / Reimbursed</option>
                </select>
              </Field>
              <Field label="Vendor / provider (optional)"><input className={inputCls} value={vendor} onChange={(e) => setVendor(e.target.value)} /></Field>
            </div>
            <Field label="Notes (optional, applies to all)"><input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>

            <div className="pt-2 border-t border-slate-800 space-y-2">
              <span className="text-slate-400 text-xs">Amount per property</span>
              {properties.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <span className="text-sm flex-1">{p.name}</span>
                  <input
                    type="number" step="0.01" placeholder="0.00"
                    className="w-28 rounded-md bg-slate-800 border border-slate-700 px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    value={amounts[p.id] ?? ''}
                    onChange={(e) => setAmounts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {result && <p className="text-xs text-emerald-300">Added {result.created} expense{result.created === 1 ? '' : 's'}.</p>}

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm">{result ? 'Done' : 'Cancel'}</button>
          {!result && (
            <button
              onClick={handleSave}
              disabled={saving || !properties?.length || filledCount === 0}
              className="flex-1 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2 text-sm font-medium"
            >
              {saving ? 'Saving…' : `Add ${filledCount || ''} expense${filledCount === 1 ? '' : 's'}`}
            </button>
          )}
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
