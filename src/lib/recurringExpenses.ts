import type { Expense, Property, RecurringExpense, RecurringCategory, RecurringFrequency, RentalUnit } from './types';

// ---------------------------------------------------------------------------
// Recurring-expense reminders (V 34). PURE: no Dexie, no Supabase, no
// Date.now(). Shared with the push-reminders Edge Function.
//
// An "occurrence" is one bill for one billing period (YYYY-MM). It is
// LOGGED when an expense exists with recurring_expense_id = bill.id and
// billing_period = that period ("Pay & log" stamps both).
// ---------------------------------------------------------------------------

export const RECURRING_CATEGORIES: RecurringCategory[] = [
  'mortgage', 'property_tax', 'insurance', 'hoa', 'water_sewer', 'gas', 'electric', 'internet', 'other',
];

export const RECURRING_CATEGORY_LABEL: Record<RecurringCategory, string> = {
  mortgage: 'Mortgage', property_tax: 'Property tax', insurance: 'Insurance', hoa: 'HOA',
  water_sewer: 'Water / sewer', gas: 'Gas', electric: 'Electric', internet: 'Internet', other: 'Other',
};

/** Recurring category → existing EXPENSE_CATEGORIES value used when logging. */
export const RECURRING_TO_EXPENSE_CATEGORY: Record<RecurringCategory, string> = {
  mortgage: 'Mortgage Payment', property_tax: 'Property Taxes', insurance: 'Insurance', hoa: 'HOA / Condo Fees',
  water_sewer: 'Water / Sewer', gas: 'Gas / Heating Fuel', electric: 'Electric', internet: 'Internet / Smart Devices',
  other: 'Miscellaneous',
};

export const FREQUENCY_MONTHS: Record<RecurringFrequency, number> = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };

export const DUE_SOON_DAYS = 7;

const pad = (n: number) => String(n).padStart(2, '0');
export const periodOf = (date: string) => date.slice(0, 7);

export function addMonths(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

/** Due date of a bill in a period; due day clamps to the month's last day. Null without a due day. */
export function dueDateFor(dueDay: number | null | undefined, period: string): string | null {
  if (!dueDay || dueDay < 1) return null;
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${pad(Math.min(Math.floor(dueDay), last))}`;
}

/** Is the bill due in this period at all (quarterly/semiannual/annual use anchor_month)? */
export function isDueInPeriod(bill: Pick<RecurringExpense, 'frequency' | 'anchor_month'>, period: string): boolean {
  const step = FREQUENCY_MONTHS[bill.frequency ?? 'monthly'] ?? 1;
  if (step === 1) return true;
  const anchor = bill.anchor_month ?? 1;
  const month = Number(period.slice(5, 7));
  return (((month - anchor) % step) + step) % step === 0;
}

export function daysBetween(a: string, b: string) {
  return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);
}

export type OccurrenceStatus = 'logged' | 'overdue' | 'due_today' | 'due_soon' | 'upcoming' | 'no_due_day';

export interface Occurrence {
  bill: RecurringExpense;
  period: string;
  dueDate: string | null;
  status: OccurrenceStatus;
  daysUntil: number | null; // negative = overdue
  expenseId?: string;
}

/** Only the expense fields the reminder logic needs (the Edge Function selects just these). */
export type LoggedExpense = Pick<Expense, 'id' | 'deleted_at' | 'recurring_expense_id' | 'billing_period'>;

export function findLoggedExpense(bill: Pick<RecurringExpense, 'id'>, period: string, expenses: LoggedExpense[]) {
  return expenses.find((e) => !e.deleted_at && e.recurring_expense_id === bill.id && e.billing_period === period);
}

export function occurrenceStatus(bill: RecurringExpense, period: string, today: string, expenses: LoggedExpense[]): Occurrence {
  const dueDate = dueDateFor(bill.due_day, period);
  const logged = findLoggedExpense(bill, period, expenses);
  if (logged) return { bill, period, dueDate, status: 'logged', daysUntil: dueDate ? daysBetween(today, dueDate) : null, expenseId: logged.id };
  if (!dueDate) return { bill, period, dueDate, status: 'no_due_day', daysUntil: null };
  const d = daysBetween(today, dueDate);
  const status: OccurrenceStatus = d < 0 ? 'overdue' : d === 0 ? 'due_today' : d <= DUE_SOON_DAYS ? 'due_soon' : 'upcoming';
  return { bill, period, dueDate, status, daysUntil: d };
}

export interface BillsDueList {
  overdue: Occurrence[];
  dueSoon: Occurrence[]; // includes due today
  loggedThisMonth: Occurrence[];
  needsDueDay: RecurringExpense[];
}

/**
 * The "Bills due" list: overdue (looking back up to `lookbackMonths`, never
 * before the bill was created), due within DUE_SOON_DAYS (incl. early next
 * month), and logged this month.
 */
export function billsDue(bills: RecurringExpense[], expenses: LoggedExpense[], today: string, lookbackMonths = 3): BillsDueList {
  const out: BillsDueList = { overdue: [], dueSoon: [], loggedThisMonth: [], needsDueDay: [] };
  const thisPeriod = periodOf(today);
  for (const bill of bills) {
    if (bill.deleted_at || bill.active === false) continue;
    if (!bill.due_day) { out.needsDueDay.push(bill); continue; }
    const createdPeriod = bill.created_at ? periodOf(bill.created_at) : addMonths(thisPeriod, -lookbackMonths);
    for (let k = -lookbackMonths; k <= 1; k++) {
      const period = addMonths(thisPeriod, k);
      if (period < createdPeriod) continue;
      if (!isDueInPeriod(bill, period)) continue;
      const occ = occurrenceStatus(bill, period, today, expenses);
      if (occ.status === 'logged') { if (period === thisPeriod) out.loggedThisMonth.push(occ); continue; }
      if (occ.status === 'overdue') out.overdue.push(occ);
      else if (occ.status === 'due_today' || occ.status === 'due_soon') out.dueSoon.push(occ);
    }
  }
  const byDue = (a: Occurrence, b: Occurrence) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '');
  out.overdue.sort(byDue); out.dueSoon.sort(byDue); out.loggedThisMonth.sort(byDue);
  return out;
}

/** Bills whose due date is today and not logged → push to Jeff (dedupe per bill+period). */
export function billsDueToday(bills: RecurringExpense[], expenses: LoggedExpense[], today: string) {
  const period = periodOf(today);
  return bills
    .filter((b) => !b.deleted_at && b.active !== false && isDueInPeriod(b, period))
    .map((b) => occurrenceStatus(b, period, today, expenses))
    .filter((o) => o.status === 'due_today')
    .map((o) => ({ occurrence: o, dedupeKey: `bill:${o.bill.id}:${o.period}` }));
}

/** Prefill for ExpenseFormModal's "Pay & log". */
export function payAndLogPrefill(occ: Occurrence, today: string) {
  return {
    property_id: occ.bill.property_id,
    category: RECURRING_TO_EXPENSE_CATEGORY[occ.bill.category] ?? 'Miscellaneous',
    vendor: occ.bill.payee ?? '',
    amount: occ.bill.amount != null ? String(occ.bill.amount) : '',
    expense_date: today,
    frequency: 'monthly' as const,
    recurring_expense_id: occ.bill.id,
    billing_period: occ.period,
  };
}

// ------------------------------------------------------------ default seeding

/** "48 Jackson street" → "48 jackson"; Jeff's "Clarion" alias resolves to Claradon. */
export function addressKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.toLowerCase().replace(/[.,#]/g, ' ').match(/(\d+)\s+([a-z]+)/);
  if (!m) return null;
  const street = m[2] === 'clarion' ? 'claradon' : m[2];
  return `${m[1]} ${street}`;
}

export interface SeedTarget { category: RecurringCategory; addressKey: string; unit?: string; label: string }

const MORTGAGED = ['48 jackson', '62 fillmore', '354 hoyt', '706 sycamore'];
const CLARADON = '55 claradon';

/** Jeff's list. 'all' expands to every active property. */
// 706 Sycamore (Jeff, V 34): main house + Unit 2 share ONE gas and ONE electric
// bill (landlord pays); Unit 1 pays its own. Units on file are 'unit1' and
// 'Unit 2' (no separate main-house record) and a bill holds one optional unit,
// so the shared bill is attached to Unit 2 with this note.
export const SYCAMORE_SHARED_NOTE = 'Main house + Unit 2 (shared meter); Unit 1 pays own';

export const SEED_RULES: { category: RecurringCategory; targets: string[] | 'all'; except?: string[]; units?: Record<string, string>; notes?: Record<string, string> }[] = [
  { category: 'mortgage', targets: MORTGAGED },
  { category: 'property_tax', targets: MORTGAGED },
  { category: 'insurance', targets: 'all', except: [CLARADON] },
  { category: 'hoa', targets: [CLARADON] },
  { category: 'water_sewer', targets: 'all' },
  { category: 'gas', targets: ['48 jackson', '706 sycamore'], units: { '48 jackson': 'Unit 1', '706 sycamore': 'Unit 2' }, notes: { '706 sycamore': SYCAMORE_SHARED_NOTE } },
  { category: 'electric', targets: ['48 jackson', '706 sycamore'], units: { '48 jackson': 'Unit 1', '706 sycamore': 'Unit 2' }, notes: { '706 sycamore': SYCAMORE_SHARED_NOTE } },
  { category: 'internet', targets: 'all', except: [CLARADON] },
];

export interface SeedItem {
  key: string; // stable: category|property|unit
  category: RecurringCategory;
  property: Pick<Property, 'id' | 'name'>;
  unit?: Pick<RentalUnit, 'id' | 'name'>;
  matchedBy: string;
  notes?: string;
  alreadyExists: boolean;
}
export interface SeedProblem { category: RecurringCategory; target: string; reason: string; candidates: Pick<Property, 'id' | 'name'>[] }
export interface SeedPlan { items: SeedItem[]; unmatched: SeedProblem[]; ambiguous: SeedProblem[] }

const normUnit = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^apt/, 'unit');

export function planSeed(properties: Property[], units: RentalUnit[], existing: RecurringExpense[]): SeedPlan {
  const live = properties.filter((p) => !p.deleted_at);
  const byKey = new Map<string, Property[]>();
  for (const p of live) {
    const k = addressKey(p.name) ?? addressKey(p.address_line);
    if (!k) continue;
    byKey.set(k, [...(byKey.get(k) ?? []), p]);
  }
  const plan: SeedPlan = { items: [], unmatched: [], ambiguous: [] };
  const seenKeys = new Set<string>();
  for (const rule of SEED_RULES) {
    const targets = rule.targets === 'all' ? [...byKey.keys()].filter((k) => !(rule.except ?? []).includes(k)) : rule.targets;
    for (const target of targets) {
      const matches = byKey.get(target) ?? [];
      if (matches.length === 0) { plan.unmatched.push({ category: rule.category, target, reason: 'no active property with this address', candidates: [] }); continue; }
      if (matches.length > 1) { plan.ambiguous.push({ category: rule.category, target, reason: 'several active properties share this address', candidates: matches.map((p) => ({ id: p.id, name: p.name })) }); continue; }
      const property = matches[0];
      let unit: RentalUnit | undefined;
      const wantUnit = rule.units?.[target];
      if (wantUnit) {
        const cands = units.filter((u) => !u.deleted_at && u.property_id === property.id && normUnit(u.name) === normUnit(wantUnit));
        if (cands.length !== 1) {
          (cands.length === 0 ? plan.unmatched : plan.ambiguous).push({ category: rule.category, target: `${target} ${wantUnit}`, reason: cands.length === 0 ? 'unit not found on property' : 'several units match', candidates: [{ id: property.id, name: property.name }] });
          continue;
        }
        unit = cands[0];
      }
      const key = `${rule.category}|${property.id}|${unit?.id ?? ''}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const alreadyExists = existing.some((e) => e.category === rule.category && e.property_id === property.id && (e.rental_unit_id ?? '') === (unit?.id ?? ''));
      plan.items.push({
        key, category: rule.category,
        property: { id: property.id, name: property.name },
        unit: unit ? { id: unit.id, name: unit.name } : undefined,
        matchedBy: `"${target}"${wantUnit ? ` + unit "${wantUnit}"` : ''} → ${property.name}${property.address_line ? ` (${property.address_line})` : ''}${unit ? ` / ${unit.name}` : ''}`,
        notes: rule.notes?.[target],
        alreadyExists,
      });
    }
  }
  return plan;
}

/** Deterministic UUID-shaped id from a seed key so re-seeding (any device) can't duplicate. */
export function seedIdFrom(hashHex: string): string {
  const h = hashHex.padEnd(32, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
