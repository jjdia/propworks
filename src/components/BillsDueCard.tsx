import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { format } from 'date-fns';
import { db } from '../lib/db';
import { billsDue, payAndLogPrefill, RECURRING_CATEGORY_LABEL, type Occurrence } from '../lib/recurringExpenses';
import { ExpenseFormModal, type ExpensePrefill } from './ExpenseFormModal';

const localToday = () => format(new Date(), 'yyyy-MM-dd');

/** "Bills due" list: overdue, due soon, logged this month — each with Pay & log. */
export function BillsDueCard({ compact = false }: { compact?: boolean }) {
  const bills = useLiveQuery(() => db.recurring_expenses.filter((b) => !b.deleted_at).toArray(), []);
  const expenses = useLiveQuery(() => db.expenses.filter((e) => !e.deleted_at && !!e.recurring_expense_id).toArray(), []);
  const properties = useLiveQuery(() => db.properties.toArray(), []);
  const units = useLiveQuery(() => db.rental_units.toArray(), []);
  const [prefill, setPrefill] = useState<ExpensePrefill | null>(null);
  if (!bills || !expenses || !properties || !units) return null;
  const today = localToday();
  const list = billsDue(bills, expenses, today);
  const where = (o: Occurrence) => {
    const p = properties.find((x) => x.id === o.bill.property_id)?.name ?? 'Property';
    const u = o.bill.rental_unit_id ? units.find((x) => x.id === o.bill.rental_unit_id)?.name : null;
    return u ? `${p} · ${u}` : p;
  };

  const row = (o: Occurrence, tone: string, note: string, action = true) => (
    <li key={`${o.bill.id}-${o.period}`} className="flex items-center justify-between gap-2 bg-slate-950 rounded-lg px-2 py-1.5">
      <div className="min-w-0">
        <div className="text-sm truncate">{RECURRING_CATEGORY_LABEL[o.bill.category]}{o.bill.payee ? ` · ${o.bill.payee}` : ''}</div>
        <div className="text-[11px] text-slate-400 truncate">{where(o)} · <span className={tone}>{note}</span></div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="font-mono text-xs">{o.bill.amount != null ? `$${Number(o.bill.amount).toFixed(2)}` : '—'}</span>
        {action && <button onClick={() => setPrefill(payAndLogPrefill(o, today))} className="rounded bg-indigo-600 hover:bg-indigo-500 px-2 py-1 text-[11px] font-medium">Pay &amp; log</button>}
      </div>
    </li>
  );

  const empty = bills.length === 0;
  return (
    <section className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Bills due</h2>
        <Link to="/bills" className="text-xs text-indigo-300">Manage bills →</Link>
      </div>
      {empty && <p className="text-xs text-slate-400">No recurring bills yet. <Link to="/bills" className="text-indigo-300">Set up default bills</Link> (mortgage, tax, insurance, utilities).</p>}
      {!empty && list.overdue.length === 0 && list.dueSoon.length === 0 && <p className="text-xs text-slate-400">Nothing due in the next 7 days.</p>}
      {list.overdue.length > 0 && <ul className="space-y-1">{list.overdue.map((o) => row(o, 'text-rose-400', `overdue · due ${o.dueDate}`))}</ul>}
      {list.dueSoon.length > 0 && <ul className="space-y-1">{list.dueSoon.map((o) => row(o, 'text-amber-300', o.status === 'due_today' ? 'due today' : `due ${o.dueDate}`))}</ul>}
      {!compact && list.loggedThisMonth.length > 0 && (
        <details className="text-xs">
          <summary className="text-slate-400 cursor-pointer">Logged this month ({list.loggedThisMonth.length})</summary>
          <ul className="space-y-1 mt-1">{list.loggedThisMonth.map((o) => row(o, 'text-emerald-400', 'logged', false))}</ul>
        </details>
      )}
      {list.needsDueDay.length > 0 && <p className="text-[11px] text-slate-500">{list.needsDueDay.length} bill{list.needsDueDay.length === 1 ? '' : 's'} need a due day — <Link to="/bills" className="text-indigo-300">set them</Link> to get reminders.</p>}
      {prefill && <ExpenseFormModal prefill={prefill} onClose={() => setPrefill(null)} />}
    </section>
  );
}
