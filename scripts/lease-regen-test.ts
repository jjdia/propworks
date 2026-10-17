import {
  scheduleFieldsChanged, monthHasPayments, planMonthRegen, regenerateLeaseMonthsWith, unitConflicts, currentMonthStart,
  type LeaseRegenDeps,
} from '../src/lib/leaseRegen';
import { buildInstallments } from '../src/lib/installments';
import type { Lease, RentCharge, RentInstallment } from '../src/lib/types';

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`);
  if (cond) pass++; else fail++;
}

const meta = { owner_id: 'o1', created_at: '', updated_at: '', deleted_at: null as string | null };
const CUR = '2026-10-01';
function lease(over: Partial<Lease> = {}): Lease {
  return { id: 'L1', rental_unit_id: 'u1', tenant_id: 't1', total_monthly_rent: 2000, tenant_portion: 2000, subsidy_program: 'none', tenant_payment_method: 'direct', status: 'active', rent_due_day: 1, ...meta, ...over };
}
const charge = (month: string, over: Partial<RentCharge> = {}): RentCharge =>
  ({ id: `c-${month}`, lease_id: 'L1', charge_month: month, total_rent: 2000, tenant_portion: 2000, status: 'due', ...meta, ...over });

// ---- scheduleFieldsChanged
const base = lease();
check('no change → false', !scheduleFieldsChanged(base, { ...base, notes: 'x', lease_end: '2027-01-01' }));
check('rent change → true', scheduleFieldsChanged(base, { ...base, total_monthly_rent: 2100 }));
check('rent "2000" string vs 2000 → false', !scheduleFieldsChanged(base, { ...base, total_monthly_rent: '2000' as unknown as number }));
check('due day change → true', scheduleFieldsChanged(base, { ...base, rent_due_day: 5 }));
check('due day undefined vs 1 → false', !scheduleFieldsChanged(base, { ...base, rent_due_day: undefined }));
check('portion change → true', scheduleFieldsChanged(base, { ...base, tenant_portion: 1500 }));
check('payer setup change → true', scheduleFieldsChanged(base, { ...base, subsidy_program: 'section8', government_portion: 500 }));
check('tenant method change → true', scheduleFieldsChanged(base, { ...base, tenant_payment_method: 'hra' }));
check('tenant frequency change → true', scheduleFieldsChanged(base, { ...base, tenant_payment_frequency: 'twice_monthly' }));
check('gov frequency change → true', scheduleFieldsChanged(base, { ...base, government_payment_frequency: 'twice_monthly' }));
check('unit move alone → false', !scheduleFieldsChanged(base, { ...base, rental_unit_id: 'u2' }));

// ---- monthHasPayments / planMonthRegen
const inst = (over: Partial<RentInstallment> = {}): RentInstallment =>
  ({ id: 'i', rent_charge_id: 'c', portion: 'tenant', payer: 'tenant', amount: 2000, due_date: '2026-10-01', status: 'due', ...meta, ...over });
check('nothing received → no payments', !monthHasPayments(charge(CUR), [inst()]));
check('partial $1 → has payments', monthHasPayments(charge(CUR), [inst({ status: 'partial', paid_amount: 1 })]));
check('paid w/o paid_amount → has payments', monthHasPayments(charge(CUR), [inst({ status: 'paid' })]));
check('paid_amount on a "due" line → has payments (strict)', monthHasPayments(charge(CUR), [inst({ status: 'due', paid_amount: 50 })]));
check('paid_amount 0 → no payments', !monthHasPayments(charge(CUR), [inst({ status: 'partial', paid_amount: 0 })]));
check('deleted paid installment ignored', !monthHasPayments(charge(CUR), [inst({ status: 'paid', paid_amount: 2000, deleted_at: 'x' })]));
check('marked Full → has payments', monthHasPayments(charge(CUR, { marked_full_at: '2026-10-05' }), []));
check('charge status paid → has payments', monthHasPayments(charge(CUR, { status: 'paid' }), []));
check('past month → past', planMonthRegen(charge('2026-09-01'), [], CUR) === 'past');
check('current, unpaid → regenerate', planMonthRegen(charge(CUR), [inst()], CUR) === 'regenerate');
check('future, unpaid → regenerate', planMonthRegen(charge('2026-11-01'), [inst()], CUR) === 'regenerate');
check('future, paid → has_payments', planMonthRegen(charge('2026-11-01'), [inst({ status: 'paid' })], CUR) === 'has_payments');
check('currentMonthStart local', currentMonthStart(new Date(2026, 9, 31, 23, 30)) === '2026-10-01');

// ---- regenerateLeaseMonthsWith (in-memory store)
function store(charges: RentCharge[], insts: RentInstallment[]) {
  const C = new Map(charges.map((c) => [c.id, { ...c }]));
  const I = new Map(insts.map((i) => [i.id, { ...i }]));
  let n = 0, rolled: string[] = [], deletes: string[] = [];
  const deps: LeaseRegenDeps = {
    getCharges: async (lid) => [...C.values()].filter((c) => c.lease_id === lid),
    getInstallments: async (cid) => [...I.values()].filter((i) => i.rent_charge_id === cid),
    saveCharge: async (c) => { C.set(c.id, c); return c; },
    saveInstallment: async (i) => { I.set(i.id, i); return i; },
    softDeleteInstallment: async (id) => { deletes.push(id); I.set(id, { ...I.get(id)!, deleted_at: 'now' }); },
    newMeta: (o) => ({ id: `new${++n}`, owner_id: o, created_at: '', updated_at: '', deleted_at: null }),
    rollUp: async (cid) => { rolled.push(cid); },
  };
  return { C, I, deps, rolled: () => rolled, deletes: () => deletes, live: (cid: string) => [...I.values()].filter((i) => i.rent_charge_id === cid && !i.deleted_at) };
}
const mkInsts = (l: Lease, c: RentCharge, tag: string) =>
  buildInstallments('o1', c.id, c.charge_month, l).map((x, k) => ({ ...x, ...meta, id: `${tag}${k}` }));

{
  const before = lease();
  const sep = charge('2026-09-01'), oct = charge(CUR), nov = charge('2026-11-01'), dec = charge('2026-12-01');
  const novPaid = mkInsts(before, nov, 'n').map((i) => ({ ...i, status: 'partial' as const, paid_amount: 100 }));
  const s = store([sep, oct, nov, dec], [...mkInsts(before, sep, 's'), ...mkInsts(before, oct, 'o'), ...novPaid, ...mkInsts(before, dec, 'd')]);
  const after = lease({ total_monthly_rent: 2400, tenant_portion: 2400, rent_due_day: 5 });
  const r = await regenerateLeaseMonthsWith(s.deps, before, after, CUR);
  check('regenerated current + unpaid future', r.regenerated.join() === '2026-10-01,2026-12-01');
  check('paid future month reported skipped', r.skippedWithPayments.join() === '2026-11-01');
  check('past month untouched (charge)', s.C.get(sep.id)!.total_rent === 2000);
  check('past month untouched (installments)', s.live(sep.id).every((i) => i.amount === 2000 && i.due_date === '2026-09-01'));
  check('paid month untouched', s.C.get(nov.id)!.total_rent === 2000 && s.live(nov.id).every((i) => i.paid_amount === 100));
  check('charge updated in place (same id), new rent', s.C.get(oct.id)!.total_rent === 2400 && s.C.size === 4);
  const octLive = s.live(oct.id);
  check('new installment amount + due day', octLive.length === 1 && octLive[0].amount === 2400 && octLive[0].due_date === '2026-10-05');
  check('old installments soft-deleted (not removed)', s.deletes().includes('o0') && s.I.get('o0')!.deleted_at === 'now');
  check('rolled up regenerated months', s.rolled().join() === `${oct.id},${dec.id}`);
}
{
  const before = lease();
  const oct = charge(CUR);
  const s = store([oct], mkInsts(before, oct, 'o'));
  const r = await regenerateLeaseMonthsWith(s.deps, before, { ...before, notes: 'hi' }, CUR);
  check('non-schedule edit → nothing touched', r.regenerated.length === 0 && s.deletes().length === 0);
  const r2 = await regenerateLeaseMonthsWith(s.deps, before, { ...before, total_monthly_rent: 2500, status: 'ended' }, CUR);
  check('ended lease → nothing regenerated', r2.regenerated.length === 0 && s.deletes().length === 0);
}
{
  const before = lease();
  const oct = charge(CUR, { marked_full_at: '2026-10-02', status: 'paid' });
  const s = store([oct], mkInsts(before, oct, 'o'));
  const r = await regenerateLeaseMonthsWith(s.deps, before, lease({ total_monthly_rent: 2500, tenant_portion: 2500 }), CUR);
  check('marked Full current month → skipped', r.skippedWithPayments.join() === CUR && s.deletes().length === 0);
}
{
  // self-pay → Section 8 gov+tenant: new payer lines generated
  const before = lease();
  const oct = charge(CUR);
  const s = store([oct], mkInsts(before, oct, 'o'));
  const after = lease({ subsidy_program: 'section8', government_portion: 1500, tenant_portion: 500, government_payment_frequency: 'monthly' });
  await regenerateLeaseMonthsWith(s.deps, before, after, CUR);
  const live = s.live(oct.id);
  check('payer setup change → gov + tenant lines', live.length === 2 && live.some((i) => i.portion === 'government' && i.amount === 1500) && live.some((i) => i.portion === 'tenant' && i.amount === 500));
  check('charge portions updated', s.C.get(oct.id)!.government_portion === 1500 && s.C.get(oct.id)!.tenant_portion === 500);
}
{
  // unknown (backfilled-style) month stays unknown
  const before = lease();
  const oct = charge(CUR, { status: 'unknown' });
  const s = store([oct], mkInsts(before, oct, 'o').map((i) => ({ ...i, status: 'unknown' as const })));
  await regenerateLeaseMonthsWith(s.deps, before, lease({ total_monthly_rent: 2100, tenant_portion: 2100 }), CUR);
  check('all-unknown month regenerates as unknown', s.live(oct.id).every((i) => i.status === 'unknown'));
}
{
  // field "changed" (0 vs undefined) but checks identical → no churn
  const before = lease({ government_portion: undefined });
  const oct = charge(CUR);
  const s = store([oct], mkInsts(before, oct, 'o'));
  const r = await regenerateLeaseMonthsWith(s.deps, before, { ...before, government_portion: 0 }, CUR);
  check('equivalent schedule → no churn', r.regenerated.length === 0 && s.deletes().length === 0);
}

// ---- unitConflicts
const leases: Lease[] = [
  lease({ id: 'A', rental_unit_id: 'u1' }),
  lease({ id: 'B', rental_unit_id: 'u2' }),
  lease({ id: 'C', rental_unit_id: 'u3', status: 'ended' }),
  lease({ id: 'D', rental_unit_id: 'u4', deleted_at: 'x' }),
  lease({ id: 'E', rental_unit_id: 'u5', status: 'draft' }),
];
check('unit with another active lease → conflict', unitConflicts('A', 'u2', leases).map((l) => l.id).join() === 'B');
check('own unit → no conflict with itself', unitConflicts('A', 'u1', leases).length === 0);
check('ended lease on unit → no conflict', unitConflicts('A', 'u3', leases).length === 0);
check('soft-deleted lease on unit → no conflict', unitConflicts('A', 'u4', leases).length === 0);
check('draft lease on unit → no conflict', unitConflicts('A', 'u5', leases).length === 0);
check('empty unit / unloaded → no conflict', unitConflicts('A', 'u9', leases).length === 0 && unitConflicts('A', 'u2', undefined).length === 0 && unitConflicts('A', '', leases).length === 0);
check('two active leases on unit → both listed', unitConflicts('Z', 'u1', [...leases, lease({ id: 'F', rental_unit_id: 'u1' })]).length === 2);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
