import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { softDelete } from '../lib/mutations';
import { ExpenseFormModal } from '../components/ExpenseFormModal';
import { BulkExpenseModal } from '../components/BulkExpenseModal';
import type { Expense } from '../lib/types';

export function Expenses() {
  const [editExpense, setEditExpense] = useState<Expense | 'new' | null>(null);
  const [showBulkModal, setShowBulkModal] = useState(false);

  const expenses = useLiveQuery(
    () => db.expenses.filter((e) => !e.deleted_at).reverse().sortBy('expense_date'),
    [],
  );
  const properties = useLiveQuery(() => db.properties.toArray(), []);
  const propertyName = (id: string) => properties?.find((p) => p.id === id)?.name ?? 'Unknown property';

  const total = expenses?.reduce((sum, e) => sum + Number(e.amount), 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Expenses</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowBulkModal(true)} className="rounded-md bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-sm font-medium">
            Bulk add
          </button>
          <button onClick={() => setEditExpense('new')} className="rounded-md bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-sm font-medium">
            + Add
          </button>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="text-xs text-slate-400">Total recorded</div>
        <div className="text-2xl font-semibold font-mono">${total.toFixed(2)}</div>
      </div>

      {expenses?.length === 0 && <p className="text-slate-400 text-sm">No expenses logged yet.</p>}

      <div className="space-y-2">
        {expenses?.map((e) => (
          <div key={e.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center justify-between">
            <button onClick={() => setEditExpense(e)} className="text-left flex-1">
              <div className="text-sm font-medium">{e.category}</div>
              <div className="text-xs text-slate-400">{propertyName(e.property_id)} · {e.expense_date}{e.vendor ? ` · ${e.vendor}` : ''}</div>
            </button>
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm">${Number(e.amount).toFixed(2)}</span>
              <button
                onClick={() => { if (confirm('Remove this expense?')) softDelete('expenses', e.id); }}
                className="text-xs text-slate-500 hover:text-rose-400"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      {editExpense && <ExpenseFormModal existing={editExpense === 'new' ? undefined : editExpense} onClose={() => setEditExpense(null)} />}
      {showBulkModal && <BulkExpenseModal onClose={() => setShowBulkModal(false)} />}
    </div>
  );
}
