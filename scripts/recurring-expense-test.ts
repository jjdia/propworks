import {
  dueDateFor, isDueInPeriod, occurrenceStatus, billsDue, billsDueToday, payAndLogPrefill, addMonths,
  addressKey, planSeed, seedIdFrom, RECURRING_TO_EXPENSE_CATEGORY,
} from '../src/lib/recurringExpenses';
import { EXPENSE_CATEGORIES, type Expense, type Property, type RecurringExpense, type RentalUnit } from '../src/lib/types';

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`);
  if (cond) pass++; else fail++;
}
const meta = { owner_id: 'o1', created_at: '2026-01-05T00:00:00Z', updated_at: '', deleted_at: null };
const bill = (id: string, over: Partial<RecurringExpense> = {}): RecurringExpense => ({ id, property_id: 'p1', category: 'mortgage', frequency: 'monthly', active: true, due_day: 10, amount: 2500, payee: 'Bank', ...meta, ...over });
const exp = (billId: string, period: string, over: Partial<Expense> = {}): Expense => ({ id: `e-${billId}-${period}`, property_id: 'p1', expense_date: `${period}-09`, category: 'Mortgage Payment', paid_by: 'landlord', frequency: 'monthly', amount: 2500, recurring_expense_id: billId, billing_period: period, ...meta, ...over });

// ---- due dates
check('due day clamps to Feb 28', dueDateFor(31, '2026-02') === '2026-02-28');
check('due day clamps to Feb 29 in leap year', dueDateFor(30, '2028-02') === '2028-02-29');
check('blank due day → null', dueDateFor(null, '2026-02') === null && dueDateFor(0, '2026-02') === null);
check('addMonths crosses year', addMonths('2026-11', 3) === '2027-02' && addMonths('2026-01', -1) === '2025-12');
check('monthly due every period', isDueInPeriod({ frequency: 'monthly', anchor_month: null }, '2026-07'));
check('quarterly anchored Jan: due Apr, not May', isDueInPeriod({ frequency: 'quarterly', anchor_month: 1 }, '2026-04') && !isDueInPeriod({ frequency: 'quarterly', anchor_month: 1 }, '2026-05'));
check('annual anchored Jul', isDueInPeriod({ frequency: 'annual', anchor_month: 7 }, '2027-07') && !isDueInPeriod({ frequency: 'annual', anchor_month: 7 }, '2027-06'));
check('semiannual anchored Jan → Jul', isDueInPeriod({ frequency: 'semiannual', anchor_month: 1 }, '2026-07'));

// ---- occurrence status
const b = bill('b1');
check('overdue after due date', occurrenceStatus(b, '2026-10', '2026-10-17', []).status === 'overdue');
check('due today', occurrenceStatus(b, '2026-10', '2026-10-10', []).status === 'due_today');
check('due soon within 7 days', occurrenceStatus(b, '2026-10', '2026-10-04', []).status === 'due_soon');
check('upcoming beyond 7 days', occurrenceStatus(b, '2026-10', '2026-10-01', []).status === 'upcoming');
check('logged when expense stamped with bill + period', occurrenceStatus(b, '2026-10', '2026-10-17', [exp('b1', '2026-10')]).status === 'logged');
check('expense for another period does not count', occurrenceStatus(b, '2026-10', '2026-10-17', [exp('b1', '2026-09')]).status === 'overdue');
check('deleted expense does not count', occurrenceStatus(b, '2026-10', '2026-10-17', [exp('b1', '2026-10', { deleted_at: 'x' })]).status === 'overdue');
check('no due day status', occurrenceStatus(bill('b2', { due_day: null }), '2026-10', '2026-10-17', []).status === 'no_due_day');

// ---- bills due list
const bills = [
  bill('over', { due_day: 5 }),
  bill('soon', { due_day: 20 }),
  bill('logged', { due_day: 3 }),
  bill('blank', { due_day: null }),
  bill('paused', { due_day: 15, active: false }),
  bill('nextmonth', { due_day: 2 }),
  bill('new', { due_day: 1, created_at: '2026-10-12T00:00:00Z' }),
];
const L = billsDue(bills, [exp('logged', '2026-10'), exp('over', '2026-08'), exp('over', '2026-07'), exp('nextmonth', '2026-10'), exp('nextmonth', '2026-09'), exp('nextmonth', '2026-08'), exp('nextmonth', '2026-07'), exp('soon', '2026-09'), exp('soon', '2026-08'), exp('soon', '2026-07'), exp('logged', '2026-09'), exp('logged', '2026-08'), exp('logged', '2026-07')], '2026-10-27');
const ids = (xs: { bill: RecurringExpense; period: string }[]) => xs.map((o) => `${o.bill.id}@${o.period}`).sort().join(',');
check('overdue list includes unlogged past periods (lookback)', ids(L.overdue) === 'new@2026-10,over@2026-09,over@2026-10,soon@2026-10');
check('due-soon includes early next month', ids(L.dueSoon) === 'logged@2026-11,new@2026-11,nextmonth@2026-11');
check('logged this month', ids(L.loggedThisMonth) === 'logged@2026-10,nextmonth@2026-10');
check('blank due day surfaces in needsDueDay', L.needsDueDay.map((x) => x.id).join() === 'blank');
check('paused bill excluded', ![...L.overdue, ...L.dueSoon].some((o) => o.bill.id === 'paused'));
check('bill created this month not overdue for earlier months', !L.overdue.some((o) => o.bill.id === 'new' && o.period < '2026-10'));

// ---- push on due day
const todayPush = billsDueToday([bill('x', { due_day: 17 }), bill('y', { due_day: 17 }), bill('z', { due_day: 18 })], [exp('y', '2026-10')], '2026-10-17');
check('push only for unlogged bills due today', todayPush.length === 1 && todayPush[0].occurrence.bill.id === 'x');
check('bill push dedupe key per bill+period', todayPush[0].dedupeKey === 'bill:x:2026-10');
check('due-day 31 pushes on Feb 28', billsDueToday([bill('f', { due_day: 31 })], [], '2026-02-28').length === 1);

// ---- Pay & log prefill
const pre = payAndLogPrefill(occurrenceStatus(bill('pl', { category: 'water_sewer', payee: 'NYC DEP', amount: 210.5 }), '2026-10', '2026-10-17', []), '2026-10-17');
check('prefill maps category to expense category', pre.category === 'Water / Sewer');
check('prefill carries payee/amount/date/property/link', pre.vendor === 'NYC DEP' && pre.amount === '210.5' && pre.expense_date === '2026-10-17' && pre.property_id === 'p1' && pre.recurring_expense_id === 'pl' && pre.billing_period === '2026-10');
check('blank amount stays blank in prefill', payAndLogPrefill(occurrenceStatus(bill('pb', { amount: null }), '2026-10', '2026-10-17', []), '2026-10-17').amount === '');
check('every recurring category maps to a real expense category', Object.values(RECURRING_TO_EXPENSE_CATEGORY).every((c) => (EXPENSE_CATEGORIES as readonly string[]).includes(c)));

// ---- address matching + seeding against the live property list (dump 2026-10-08)
check('addressKey normalises case/suffix', addressKey('48 Jackson street') === '48 jackson' && addressKey('354 Hoyt Ave') === '354 hoyt');
check('Clarion alias → Claradon', addressKey('55 Clarion Lane') === '55 claradon');
const P = (id: string, name: string, address_line?: string, deleted = false): Property => ({ id, name, address_line, ...meta, deleted_at: deleted ? 'x' : null });
const props = [
  P('fil', '62 Fillmore Street', 'Unit-1'), P('hoy', '354 Hoyt Ave', 'Unit-2'), P('cla', '55 Claradon Lane'),
  P('hoyD1', '354 Hoyt Ave', 'Unit-1', true), P('hoyD2', '354 Hoyt Ave', 'Garage', true),
  P('jac', '48 Jackson Street', 'Unit-1'), P('jacD', '48 Jackson street', 'Unit-2', true),
  P('filD', '62 Fillmore', 'Unit-2', true), P('filG', '62 Fillmore Street', 'Garage', true), P('syc', '706 Sycamore street'),
];
const U = (id: string, property_id: string, name: string): RentalUnit => ({ id, property_id, name, unit_kind: 'apartment', status: 'occupied', ...meta });
const units = [U('j1', 'jac', 'Unit 1'), U('j2', 'jac', 'Unit 2'), U('s1', 'syc', 'unit1'), U('s2', 'syc', 'Unit 2'), U('ct', 'cla', 'Town House')];
const plan = planSeed(props, units, []);
const has = (cat: string, pid: string, uid = '') => plan.items.some((i) => i.category === cat && i.property.id === pid && (i.unit?.id ?? '') === uid);
check('deleted duplicate property rows are ignored (no ambiguity)', plan.ambiguous.length === 0 && plan.unmatched.length === 0);
check('mortgage on the 4 mortgaged homes', ['jac', 'fil', 'hoy', 'syc'].every((p) => has('mortgage', p)) && !has('mortgage', 'cla'));
check('property tax on the same 4', ['jac', 'fil', 'hoy', 'syc'].every((p) => has('property_tax', p)) && !has('property_tax', 'cla'));
check('insurance on all but Claradon', ['jac', 'fil', 'hoy', 'syc'].every((p) => has('insurance', p)) && !has('insurance', 'cla'));
check('HOA only Claradon', has('hoa', 'cla') && plan.items.filter((i) => i.category === 'hoa').length === 1);
check('water/sewer on all 5', plan.items.filter((i) => i.category === 'water_sewer').length === 5);
check('gas: 48 Jackson Unit 1 + 706 Sycamore', has('gas', 'jac', 'j1') && has('gas', 'syc') && plan.items.filter((i) => i.category === 'gas').length === 2);
check('electric: 48 Jackson Unit 1 + 706 Sycamore', has('electric', 'jac', 'j1') && has('electric', 'syc') && plan.items.filter((i) => i.category === 'electric').length === 2);
check('internet on all but Claradon', plan.items.filter((i) => i.category === 'internet').length === 4 && !has('internet', 'cla'));
check('total seed items = 4+4+4+1+5+2+2+4 = 26', plan.items.length === 26);
check('re-plan marks existing items (idempotent)', planSeed(props, units, [bill('m', { category: 'mortgage', property_id: 'jac' })]).items.find((i) => i.category === 'mortgage' && i.property.id === 'jac')?.alreadyExists === true);
const amb = planSeed([...props, P('jac2', '48 Jackson St')], units, []);
check('two live properties at one address → ambiguous, not seeded', amb.ambiguous.some((a) => a.target === '48 jackson') && !amb.items.some((i) => i.property.id === 'jac' || i.property.id === 'jac2'));
const noSyc = planSeed(props.filter((p) => p.id !== 'syc'), units, []);
check('missing property → unmatched and left out', noSyc.unmatched.some((u) => u.target === '706 sycamore' && u.category === 'mortgage'));
check('missing unit → unmatched', planSeed(props, units.filter((u) => u.id !== 'j1'), []).unmatched.some((u) => u.target === '48 jackson Unit 1'));
check('Clarion-named record still gets HOA', planSeed([P('c2', '55 Clarion Lane')], [], []).items.some((i) => i.category === 'hoa'));
check('seedIdFrom is a stable UUID shape', /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(seedIdFrom('a'.repeat(64))) && seedIdFrom('ab'.repeat(32)) === seedIdFrom('ab'.repeat(32)));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
