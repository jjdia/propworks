import { deriveChargeStatus, nextChargeFields, planMarkFull, rollUpChargeWith, markChargeFullWith, type ChargeRollupDeps } from '../src/lib/chargeStatus';
import { buildInstallments } from '../src/lib/installments';
import type { Lease, RentCharge, RentInstallment } from '../src/lib/types';

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`);
  if (cond) pass++; else fail++;
}

const meta = { owner_id: 'o1', created_at: '', updated_at: '', deleted_at: null };
const NOW = '2026-10-20T12:00:00.000Z';

function lease(over: Partial<Lease>): Lease {
  return { id: 'lease1', rental_unit_id: 'u1', tenant_id: 't1', total_monthly_rent: 4000, status: 'active', rent_due_day: 1, ...meta, ...over };
}
function charge(over: Partial<RentCharge> = {}): RentCharge {
  return { id: 'c1', lease_id: 'lease1', charge_month: '2026-10-01', total_rent: 4000, status: 'due', ...meta, ...over };
}
let seq = 0;
function insts(l: Lease): RentInstallment[] {
  return buildInstallments('o1', 'c1', '2026-10-01', l).map((i) => ({ ...i, id: `i${++seq}`, ...meta }));
}
const pay = (i: RentInstallment, amt = i.amount): RentInstallment => ({ ...i, status: amt >= i.amount ? 'paid' : 'partial', paid_amount: amt, paid_date: i.due_date });

// Jeff's example: $3,000 gov + $1,000 tenant share ($500 + $500).
const govTenant = lease({ subsidy_program: 'section8', government_portion: 3000, tenant_portion: 1000, tenant_payment_method: 'direct', tenant_payment_frequency: 'twice_monthly' });
const govHra = lease({ subsidy_program: 'section8', government_portion: 3000, tenant_portion: 1000, tenant_payment_method: 'hra' });
const selfPay = lease({ subsidy_program: 'none', tenant_portion: 2000, tenant_payment_method: 'direct' });

// 1. Gov only received → Partial, tenant owes $1,000
{
  const xs = insts(govTenant);
  const r = deriveChargeStatus(charge(), xs.map((i) => (i.portion === 'government' ? pay(i) : i)), 'gov_tenant');
  check('gov only → partial', r.status === 'partial' && !r.readyForFull);
  check('gov only → "Tenant owes $1,000.00"', r.owing.length === 1 && r.owing[0].label === 'Tenant' && r.owing[0].amount === 1000 && /Tenant owes \$1,000\.00/.test(r.summary));
  check('displayStatus shows Partial', r.displayStatus === 'Partial');
}

// 2. Setup 3, gov + one HRA check → HRA owes $500 (30th check)
{
  const xs = insts(govHra);
  const hra = xs.filter((i) => i.payer === 'hra');
  const r = deriveChargeStatus(charge(), xs.map((i) => (i.portion === 'government' || i.id === hra[0].id ? pay(i) : i)), 'gov_hra');
  check('setup 3 one HRA check → partial', r.status === 'partial' && !r.readyForFull);
  check('setup 3 → "HRA (tenant share) owes $500.00 (30th check)"', /HRA \(tenant share\) owes \$500\.00 \(30th check\)/.test(r.summary));
}

// 2b. HRA lands first, gov not yet → Partial, gov owes
{
  const xs = insts(govHra);
  const r = deriveChargeStatus(charge(), xs.map((i) => (i.payer === 'hra' ? pay(i) : i)), 'gov_hra');
  check('HRA first → partial, Section 8 owes $3,000.00', r.status === 'partial' && r.owing.length === 1 && r.owing[0].label === 'Section 8' && r.owing[0].amount === 3000);
}

// 3. Everything received → ready for Full (gov setups don't auto-Full)
{
  const xs = insts(govHra).map((i) => pay(i));
  const r = deriveChargeStatus(charge(), xs, 'gov_hra');
  check('all received (gov setup) → readyForFull, not auto-Full', r.readyForFull && r.status === 'partial' && !r.isFull);
  check('per-payer totals correct', r.lines.find((l) => l.key === 'gov')!.received === 3000 && r.lines.find((l) => l.key === 'hra')!.received === 1000);
  const plan = planMarkFull(charge(), xs, 'gov_hra', NOW);
  check('planMarkFull ok when all met → paid + marked_full_at', plan.ok && plan.fields.status === 'paid' && plan.fields.marked_full_at === NOW);
}

// 4. markChargeFull refuses when short
{
  const xs = insts(govHra);
  const plan = planMarkFull(charge(), xs.map((i) => (i.portion === 'government' ? pay(i) : i)), 'gov_hra', NOW);
  check('planMarkFull refuses when HRA short (no early Full)', !plan.ok && /HRA \(tenant share\) owes \$1,000\.00/.test(plan.reason));
}

// 5. "paid" with a short amount still owed
{
  const xs = insts(selfPay);
  const shortPaid: RentInstallment = { ...xs[0], status: 'paid', paid_amount: 1500 };
  const r = deriveChargeStatus(charge(), [shortPaid], 'self_pay');
  check('installment labelled paid but $500 short → partial, $500 owed', r.status === 'partial' && r.outstanding === 500);
}

// 6. Reducing a payment after Full → back to Partial, marked_full_at cleared
{
  const xs = insts(govHra).map((i) => pay(i));
  const full = charge({ status: 'paid', marked_full_at: NOW });
  check('Full month with all lines met stays Full', nextChargeFields(full, xs, 'gov_hra') === null);
  const reduced = xs.map((i, n) => (n === 0 ? { ...i, status: 'partial' as const, paid_amount: 2500 } : i));
  const f = nextChargeFields(full, reduced, 'gov_hra');
  check('payment reduced after Full → partial', f?.status === 'partial');
  check('payment reduced after Full → marked_full_at cleared', f !== null && f.marked_full_at === null);
}

// 7. Overpayment → display-only credit, Full still needs every line
{
  const xs = insts(govHra);
  const over = xs.map((i) => (i.portion === 'government' ? pay(i, 3100) : i));
  const r = deriveChargeStatus(charge(), over, 'gov_hra');
  check('overpaid gov line → Credit $100.00 shown', r.credit === 100 && /Credit \$100\.00/.test(r.summary));
  check('overpayment does not cover another payer (HRA still owes)', r.status === 'partial' && !r.readyForFull && r.owing[0].key === 'hra');
}

// 8. Self-pay auto-Full
{
  const xs = insts(selfPay).map((i) => pay(i));
  const r = deriveChargeStatus(charge(), xs, 'self_pay');
  check('self-pay fully paid → paid (Full) automatically', r.status === 'paid' && r.isFull && r.displayStatus === 'Full');
}

// 9. Nothing received keeps unknown/due/late
{
  const xs = insts(govHra);
  check('nothing received keeps "unknown"', deriveChargeStatus(charge({ status: 'unknown' }), xs, 'gov_hra').status === 'unknown');
  check('nothing received keeps "late"', deriveChargeStatus(charge({ status: 'late' }), xs, 'gov_hra').status === 'late');
  check('payments all removed from a partial month → due', deriveChargeStatus(charge({ status: 'partial' }), xs, 'gov_hra').status === 'due');
}

// 10. Legacy gov month already "paid" (no marked_full_at) displays as Full
{
  const xs = insts(govTenant).map((i) => pay(i));
  const r = deriveChargeStatus(charge({ status: 'paid' }), xs, 'gov_tenant');
  check('existing paid gov month (no marked_full_at) stays Full', r.status === 'paid' && nextChargeFields(charge({ status: 'paid' }), xs, 'gov_tenant') === null);
}

// 11. Stale-status fix: roll-up reads the store AFTER the save, so it's never one edit behind.
async function rollupTests() {
  const store = { charges: new Map<string, RentCharge>(), insts: new Map<string, RentInstallment>(), leases: new Map<string, Lease>() };
  const deps: ChargeRollupDeps = {
    getCharge: async (id) => store.charges.get(id),
    getInstallments: async (cid) => [...store.insts.values()].filter((i) => i.rent_charge_id === cid && !i.deleted_at),
    getLease: async (id) => store.leases.get(id),
    saveCharge: async (c) => { store.charges.set(c.id, c); return c; },
  };
  store.leases.set('lease1', govHra);
  store.charges.set('c1', charge({ status: 'due' }));
  const xs = insts(govHra);
  xs.forEach((i) => store.insts.set(i.id, i));

  // Edit #1: gov paid → partial immediately (old code would still say "due")
  const gov = xs.find((i) => i.portion === 'government')!;
  store.insts.set(gov.id, pay(gov));
  await rollUpChargeWith(deps, 'c1');
  check('roll-up after first edit reflects that edit (partial)', store.charges.get('c1')!.status === 'partial');

  const early = await markChargeFullWith(deps, 'c1', NOW);
  check('markChargeFull refuses while HRA checks outstanding', !early.ok && store.charges.get('c1')!.status === 'partial');

  // Edits #2 and #3: both HRA checks
  for (const h of xs.filter((i) => i.payer === 'hra')) { store.insts.set(h.id, pay(h)); await rollUpChargeWith(deps, 'c1'); }
  check('after last check: still partial (gov setup needs Mark Full tap)', store.charges.get('c1')!.status === 'partial');

  const ok = await markChargeFullWith(deps, 'c1', NOW);
  check('markChargeFull succeeds when every line met', ok.ok && store.charges.get('c1')!.status === 'paid' && store.charges.get('c1')!.marked_full_at === NOW);

  // Moving back down: undo the gov payment
  store.insts.set(gov.id, { ...gov, status: 'due', paid_amount: undefined });
  await rollUpChargeWith(deps, 'c1');
  check('un-paying a check after Full moves the month back down', store.charges.get('c1')!.status === 'partial' && store.charges.get('c1')!.marked_full_at === null);
}

rollupTests().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}).catch((e) => { console.error(e); process.exit(1); });
