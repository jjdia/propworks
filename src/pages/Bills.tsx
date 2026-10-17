import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { saveRecurringExpense, softDelete, blankMeta } from '../lib/mutations';
import { hasPulledOnce } from '../lib/sync';
import { useAppStore } from '../store/useAppStore';
import {
  planSeed, seedIdFrom, RECURRING_CATEGORIES, RECURRING_CATEGORY_LABEL,
} from '../lib/recurringExpenses';
import type { RecurringExpense, RecurringCategory, RecurringFrequency } from '../lib/types';
import { BillsDueCard } from '../components/BillsDueCard';
import { supabaseConfigured } from '../lib/supabase';

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function Bills() {
  const ownerId = useAppStore((s) => s.ownerId) ?? 'local-owner';
  const bills = useLiveQuery(() => db.recurring_expenses.toArray(), []);
  const properties = useLiveQuery(() => db.properties.filter((p) => !p.deleted_at).sortBy('name'), []);
  const units = useLiveQuery(() => db.rental_units.filter((u) => !u.deleted_at).toArray(), []);
  const [editing, setEditing] = useState<RecurringExpense | 'new' | null>(null);
  const [showSeed, setShowSeed] = useState(false);

  const live = (bills ?? []).filter((b) => !b.deleted_at);
  const propName = (id: string) => properties?.find((p) => p.id === id)?.name ?? '(deleted property)';
  const unitName = (id?: string | null) => (id ? units?.find((u) => u.id === id)?.name : null);
  const grouped = useMemo(() => {
    const m = new Map<string, RecurringExpense[]>();
    for (const b of live) m.set(b.property_id, [...(m.get(b.property_id) ?? []), b]);
    return [...m.entries()].sort((a, b) => propName(a[0]).localeCompare(propName(b[0])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills, properties]);

  if (!bills || !properties || !units) return null;
  // Seed only on an empty table, and (when syncing) only after this device
  // has pulled once — so a second device can't re-seed blanks over edits.
  const canSeed = bills.length === 0 && (!supabaseConfigured || hasPulledOnce());

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Recurring bills</h1>
        <button onClick={() => setEditing('new')} className="rounded-md bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-sm font-medium">+ Add bill</button>
      </div>
      <BillsDueCard />
      {canSeed && (
        <button onClick={() => setShowSeed(true)} className="w-full bg-slate-900 border border-indigo-800 rounded-xl p-3 text-left text-sm">
          <span className="font-medium">Set up default bills</span>
          <p className="text-xs text-slate-400">Mortgage, property tax, insurance, HOA, water/sewer, gas, electric, internet — matched to your properties. Amounts and due days start blank. You'll review before anything is created.</p>
        </button>
      )}
      {bills.length === 0 && !canSeed && <p className="text-xs text-slate-400">Waiting for the first sync before offering default bills…</p>}

      {grouped.map(([pid, rows]) => (
        <section key={pid} className="space-y-1">
          <h2 className="text-xs uppercase tracking-wide text-slate-400">{propName(pid)}</h2>
          <ul className="space-y-1">
            {rows.sort((a, b) => RECURRING_CATEGORIES.indexOf(a.category) - RECURRING_CATEGORIES.indexOf(b.category)).map((b) => (
              <li key={b.id} className={`flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 ${b.active ? '' : 'opacity-50'}`}>
                <div className="min-w-0">
                  <div className="text-sm">{RECURRING_CATEGORY_LABEL[b.category]}{unitName(b.rental_unit_id) ? ` · ${unitName(b.rental_unit_id)}` : ''}{b.payee ? ` · ${b.payee}` : ''}</div>
                  <div className="text-[11px] text-slate-400">
                    {b.amount != null ? `$${Number(b.amount).toFixed(2)}` : <span className="text-amber-300">amount blank</span>}
                    {' · '}{b.due_day ? `due day ${b.due_day}` : <span className="text-amber-300">due day blank</span>}
                    {' · '}{b.frequency}{b.active ? '' : ' · paused'}
                  </div>
                </div>
                <button onClick={() => setEditing(b)} className="rounded bg-slate-800 hover:bg-slate-700 px-2 py-1 text-xs">Edit</button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {editing && <BillFormModal ownerId={ownerId} existing={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {showSeed && <SeedModal ownerId={ownerId} onClose={() => setShowSeed(false)} />}
    </div>
  );
}

function BillFormModal({ ownerId, existing, onClose }: { ownerId: string; existing?: RecurringExpense; onClose: () => void }) {
  const properties = useLiveQuery(() => db.properties.filter((p) => !p.deleted_at).sortBy('name'), []);
  const units = useLiveQuery(() => db.rental_units.filter((u) => !u.deleted_at).toArray(), []);
  const [propertyId, setPropertyId] = useState(existing?.property_id ?? '');
  const [unitId, setUnitId] = useState(existing?.rental_unit_id ?? '');
  const [category, setCategory] = useState<RecurringCategory>(existing?.category ?? 'other');
  const [payee, setPayee] = useState(existing?.payee ?? '');
  const [amount, setAmount] = useState(existing?.amount != null ? String(existing.amount) : '');
  const [dueDay, setDueDay] = useState(existing?.due_day ? String(existing.due_day) : '');
  const [frequency, setFrequency] = useState<RecurringFrequency>(existing?.frequency ?? 'monthly');
  const [anchor, setAnchor] = useState(existing?.anchor_month ? String(existing.anchor_month) : '');
  const [active, setActive] = useState(existing?.active ?? true);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const pid = propertyId || properties?.[0]?.id || '';
  const dueDayNum = dueDay === '' ? null : Number(dueDay);
  const valid = pid && (dueDayNum === null || (Number.isInteger(dueDayNum) && dueDayNum >= 1 && dueDayNum <= 31)) && (amount === '' || !Number.isNaN(Number(amount)));

  async function save() {
    if (!valid) return;
    setSaving(true);
    await saveRecurringExpense({
      ...(existing ?? blankMeta(ownerId)),
      property_id: pid,
      rental_unit_id: unitId || null,
      category,
      payee: payee.trim() || null,
      amount: amount === '' ? null : Number(amount),
      due_day: dueDayNum,
      frequency,
      anchor_month: frequency === 'monthly' || anchor === '' ? null : Number(anchor),
      active,
      notes: notes.trim() || null,
    });
    onClose();
  }
  async function remove() {
    if (!existing || !confirm('Delete this recurring bill? Logged expenses are kept.')) return;
    await softDelete('recurring_expenses', existing.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold">{existing ? 'Edit bill' : 'Add bill'}</h2>
        <F label="Property"><select className={inputCls} value={pid} onChange={(e) => { setPropertyId(e.target.value); setUnitId(''); }}>{properties?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></F>
        <F label="Unit (optional)"><select className={inputCls} value={unitId ?? ''} onChange={(e) => setUnitId(e.target.value)}><option value="">Whole property</option>{units?.filter((u) => u.property_id === pid).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></F>
        <F label="Category"><select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value as RecurringCategory)}>{RECURRING_CATEGORIES.map((c) => <option key={c} value={c}>{RECURRING_CATEGORY_LABEL[c]}</option>)}</select></F>
        <F label="Payee"><input className={inputCls} value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="e.g. lender, utility" /></F>
        <div className="grid grid-cols-2 gap-2">
          <F label="Amount (blank = varies)"><input type="number" step="0.01" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="—" /></F>
          <F label="Due day (1–31)"><input type="number" min={1} max={31} className={inputCls} value={dueDay} onChange={(e) => setDueDay(e.target.value)} placeholder="—" /></F>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <F label="Frequency"><select className={inputCls} value={frequency} onChange={(e) => setFrequency(e.target.value as RecurringFrequency)}>
            <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="semiannual">Every 6 months</option><option value="annual">Annual</option>
          </select></F>
          {frequency !== 'monthly' && <F label="First due month (1–12)"><input type="number" min={1} max={12} className={inputCls} value={anchor} onChange={(e) => setAnchor(e.target.value)} placeholder="1" /></F>}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (remind me)</label>
        <F label="Notes"><textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></F>
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm">Cancel</button>
          {existing && <button onClick={remove} className="rounded-md bg-rose-900/60 hover:bg-rose-800 px-3 py-2 text-sm">Delete</button>}
          <button onClick={save} disabled={saving || !valid} className="flex-1 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2 text-sm font-medium">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function SeedModal({ ownerId, onClose }: { ownerId: string; onClose: () => void }) {
  const properties = useLiveQuery(() => db.properties.toArray(), []);
  const units = useLiveQuery(() => db.rental_units.toArray(), []);
  const existing = useLiveQuery(() => db.recurring_expenses.toArray(), []);
  const plan = useMemo(() => (properties && units && existing ? planSeed(properties, units, existing) : null), [properties, units, existing]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  if (!plan) return null;
  const isOn = (k: string, exists: boolean) => !exists && (picked[k] ?? true);
  const chosen = plan.items.filter((i) => isOn(i.key, i.alreadyExists));

  async function seed() {
    setSaving(true);
    for (const item of chosen) {
      const id = seedIdFrom(await sha256Hex(`${ownerId}|${item.key}`));
      if (await db.recurring_expenses.get(id)) continue; // idempotent
      const meta = blankMeta(ownerId);
      await saveRecurringExpense({
        ...meta, id,
        property_id: item.property.id,
        rental_unit_id: item.unit?.id ?? null,
        category: item.category,
        payee: null, amount: null, due_day: null,
        frequency: 'monthly', anchor_month: null, active: true, notes: null,
      });
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold">Confirm default bills</h2>
        <p className="text-xs text-slate-400">Matched to your property records by street address. Untick anything that's wrong. Amounts and due days start blank — edit them after.</p>
        <ul className="space-y-1">
          {plan.items.map((i) => (
            <li key={i.key} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" disabled={i.alreadyExists} checked={isOn(i.key, i.alreadyExists)} onChange={(e) => setPicked({ ...picked, [i.key]: e.target.checked })} />
              <div><div>{RECURRING_CATEGORY_LABEL[i.category]} — {i.property.name}{i.unit ? ` · ${i.unit.name}` : ''}{i.alreadyExists ? ' (already set up)' : ''}</div><div className="text-[11px] text-slate-500">{i.matchedBy}</div></div>
            </li>
          ))}
        </ul>
        {(plan.ambiguous.length > 0 || plan.unmatched.length > 0) && (
          <div className="rounded-lg border border-amber-800 bg-slate-950 p-2 text-xs space-y-1">
            <div className="font-medium text-amber-300">Not created — needs you</div>
            {plan.ambiguous.map((a, k) => <div key={`a${k}`}>{RECURRING_CATEGORY_LABEL[a.category]} for “{a.target}”: {a.reason} ({a.candidates.map((c) => c.name).join(', ')}). Add it by hand with + Add bill.</div>)}
            {plan.unmatched.map((u, k) => <div key={`u${k}`}>{RECURRING_CATEGORY_LABEL[u.category]} for “{u.target}”: {u.reason}.</div>)}
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm">Cancel</button>
          <button onClick={seed} disabled={saving || chosen.length === 0} className="flex-1 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2 text-sm font-medium">{saving ? 'Creating…' : `Create ${chosen.length} bills`}</button>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500';
function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm"><span className="text-slate-400 text-xs">{label}</span><div className="mt-1">{children}</div></label>;
}
