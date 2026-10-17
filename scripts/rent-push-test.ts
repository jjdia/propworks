import { planRentPushes, buildLandlordSummary, tenantDedupeKey, ownerSummaryDedupeKey } from '../src/lib/rentPush';
import { buildInstallments } from '../src/lib/installments';
import type { Lease, RentCharge, RentInstallment } from '../src/lib/types';

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`);
  if (cond) pass++; else fail++;
}
const meta = { owner_id: 'o1', created_at: '', updated_at: '', deleted_at: null };
const lease = (id: string, over: Partial<Lease>): Lease => ({ id, rental_unit_id: 'u' + id, tenant_id: 't' + id, total_monthly_rent: 2000, status: 'active', rent_due_day: 1, ...meta, ...over });
const charge = (id: string, l: Lease, month: string, over: Partial<RentCharge> = {}): RentCharge => ({ id, lease_id: l.id, charge_month: month, total_rent: l.total_monthly_rent, status: 'due', ...meta, ...over });
let seq = 0;
const insts = (l: Lease, chId: string, month: string): RentInstallment[] => buildInstallments('o1', chId, month, l).map((i) => ({ ...i, id: `i${++seq}`, ...meta }));
const pay = (i: RentInstallment, amt = i.amount): RentInstallment => ({ ...i, status: amt >= i.amount ? 'paid' : 'partial', paid_amount: amt, paid_date: i.due_date });
const tenants = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((k) => ({ id: 't' + k, full_name: 'Tenant ' + k }));

const selfPay = lease('A', { subsidy_program: 'none', tenant_portion: 2000, tenant_payment_method: 'direct' });
const govTenantTwice = lease('B', { subsidy_program: 'section8', total_monthly_rent: 4000, government_portion: 3000, tenant_portion: 1000, tenant_payment_method: 'direct', tenant_payment_frequency: 'twice_monthly' });
const govHra = lease('C', { subsidy_program: 'cityfheps', total_monthly_rent: 4000, government_portion: 3000, tenant_portion: 1000, tenant_payment_method: 'hra' });
const govTenantMonthly = lease('D', { subsidy_program: 'CityFHEPS', total_monthly_rent: 4000, government_portion: 3500, tenant_portion: 500, tenant_payment_method: 'direct' });
const paidSelf = lease('E', { subsidy_program: 'none', tenant_portion: 1500, total_monthly_rent: 1500 });
const ended = lease('F', { status: 'ended' });
const noCharge = lease('G', { subsidy_program: 'none', tenant_portion: 1750, total_monthly_rent: 1750 });

const M = '2026-11-01';
const aI = insts(selfPay, 'cA', M), bI = insts(govTenantTwice, 'cB', M), cI = insts(govHra, 'cC', M), dI = insts(govTenantMonthly, 'cD', M);
const eI = insts(paidSelf, 'cE', M).map((i) => pay(i));
const charges = [charge('cA', selfPay, M), charge('cB', govTenantTwice, M), charge('cC', govHra, M), charge('cD', govTenantMonthly, M), charge('cE', paidSelf, M, { status: 'paid' })];
const base = { leases: [selfPay, govTenantTwice, govHra, govTenantMonthly, paidSelf, ended, noCharge], charges, tenants };

// ---- 1st
const in1 = { ...base, today: '2026-11-01', installments: [...aI, ...bI, ...cI, ...dI, ...eI] };
const p1 = planRentPushes(in1);
const by = (plan: typeof p1, id: string) => plan.decisions.find((d) => d.leaseId === id);
check('1st is a rent day', p1.isRentDay);
check('1st: self-pay reminded for full 2000', by(p1, 'A')?.amount === 2000 && by(p1, 'A')?.kind === 'rent_due');
check('1st: gov+tenant twice-monthly reminded for first half (500)', by(p1, 'B')?.amount === 500);
check('1st: gov+tenant monthly reminded for tenant portion 500', by(p1, 'D')?.amount === 500);
check('1st: gov+HRA (setup 3) skipped', !by(p1, 'C') && p1.skipped.some((s) => s.leaseId === 'C' && s.reason === 'hra_pays_tenant_share'));
check('1st: already-paid self-pay skipped', !by(p1, 'E') && p1.skipped.some((s) => s.leaseId === 'E' && s.reason === 'already_paid'));
check('1st: ended lease ignored', !by(p1, 'F'));
check('1st: no month generated → falls back to lease terms', by(p1, 'G')?.amount === 1750);
check('dedupe key is per tenant per due date', by(p1, 'A')?.dedupeKey === tenantDedupeKey('tA', '2026-11-01'));

// partial payment → remind only for remainder
const aPartial = aI.map((i) => pay(i, 1200));
const p1b = planRentPushes({ ...in1, installments: [...aPartial, ...bI, ...cI, ...dI, ...eI] });
check('1st: partial self-pay reminded for remainder 800', by(p1b, 'A')?.amount === 800);

// ---- 15th
const in15 = { ...base, today: '2026-11-15', installments: [...aI, ...bI, ...cI, ...dI, ...eI] };
const p15 = planRentPushes(in15);
check('15th: only gov+tenant twice-monthly reminded', p15.decisions.length === 1 && by(p15, 'B')?.kind === 'tenant_portion_15th' && by(p15, 'B')?.amount === 500);
check('15th: self-pay skipped (not twice monthly gov)', p15.skipped.some((s) => s.leaseId === 'A' && s.reason === 'not_twice_monthly'));
check('15th: HRA setup 3 skipped', p15.skipped.some((s) => s.leaseId === 'C' && s.reason === 'hra_pays_tenant_share'));
check('15th: monthly gov+tenant skipped', p15.skipped.some((s) => s.leaseId === 'D'));
const bPaid15 = bI.map((i) => (i.portion === 'tenant' && i.due_date.endsWith('15') ? pay(i) : i));
const p15b = planRentPushes({ ...in15, installments: [...aI, ...bPaid15, ...cI, ...dI, ...eI] });
check('15th: skipped when 15th check already paid', p15b.decisions.length === 0 && p15b.skipped.some((s) => s.leaseId === 'B' && s.reason === 'already_paid'));
// 1st-half paid but 15th still owed → still reminded on 15th
const bPaid1 = bI.map((i) => (i.portion === 'tenant' && i.due_date.endsWith('01') ? pay(i) : i));
check('1st: skipped when first check paid', !by(planRentPushes({ ...in1, installments: [...aI, ...bPaid1, ...cI, ...dI, ...eI] }), 'B'));
check('15th: still reminded after first check paid', !!by(planRentPushes({ ...in15, installments: [...aI, ...bPaid1, ...cI, ...dI, ...eI] }), 'B'));

// ---- other days
check('other days: no decisions', planRentPushes({ ...in1, today: '2026-11-02' }).decisions.length === 0 && !planRentPushes({ ...in1, today: '2026-11-02' }).isRentDay);
// future lease
const future = lease('A', { lease_start: '2026-12-01', subsidy_program: 'none' });
check('lease starting next month skipped', planRentPushes({ ...in1, leases: [future] }).skipped[0]?.reason === 'lease_not_started');
// duplicate leases for same tenant → one push
const dup = { ...selfPay, id: 'A2' };
check('one push per tenant per due date even with two leases', planRentPushes({ ...in1, leases: [selfPay, dup] }).decisions.length === 1);

// ---- landlord summary
const s1 = buildLandlordSummary(p1, in1);
check('owner summary lists 4 tenant lines due', s1.remindedCount === 4);
check('summary outstanding = A 2000 + B 4000 + C 4000 + D 4000', s1.outstandingTotal === 14000);
check('owner summary shows per-tenant amount + type', /Tenant A \$2,000\.00 \(rent\)/.test(s1.body) && /Tenant B \$500\.00 \(tenant portion\)/.test(s1.body));
check('owner summary omits HRA-covered tenant and notes the skip', !/Tenant C/.test(s1.body) && /1 HRA-covered/.test(s1.body));
check('owner summary omits already-paid tenant', !/Tenant E/.test(s1.body));
check('owner summary dedupe = one per portfolio per day', ownerSummaryDedupeKey('o1', '2026-11-01') === 'landlord:o1:2026-11-01');
check('summary mentions already paid', /1 already paid/.test(s1.body));
const s15 = buildLandlordSummary(p15, in15);
check('15th owner summary: only gov+tenant twice-monthly portion', s15.title.includes('15th') && /Tenant B \$500\.00/.test(s15.body) && !/Tenant A|Tenant D/.test(s15.body));
check('15th owner summary when 15th already paid says nothing due', /Nothing due from tenants today/.test(buildLandlordSummary(p15b, { ...in15, installments: [...aI, ...bPaid15, ...cI, ...dI, ...eI] }).body));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
