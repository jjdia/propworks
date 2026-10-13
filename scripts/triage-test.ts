import { balanceTriage, endingLeases } from '../src/lib/triage';
import { buildInstallments } from '../src/lib/installments';
import type { Lease, RentCharge, RentInstallment } from '../src/lib/types';

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`);
  if (cond) pass++; else fail++;
}
const meta = { owner_id: 'o1', created_at: '', updated_at: '', deleted_at: null };
const TODAY = '2026-10-13';
const lease = (id: string, over: Partial<Lease>): Lease => ({ id, rental_unit_id: 'u' + id, tenant_id: 't' + id, total_monthly_rent: 4000, status: 'active', rent_due_day: 1, ...meta, ...over });
const charge = (id: string, leaseId: string, month: string, over: Partial<RentCharge> = {}): RentCharge => ({ id, lease_id: leaseId, charge_month: month, total_rent: 4000, status: 'due', ...meta, ...over });
let seq = 0;
const insts = (l: Lease, chId: string, month: string): RentInstallment[] => buildInstallments('o1', chId, month, l).map((i) => ({ ...i, id: `i${++seq}`, ...meta }));
const pay = (i: RentInstallment, amt = i.amount): RentInstallment => ({ ...i, status: amt >= i.amount ? 'paid' : 'partial', paid_amount: amt, paid_date: i.due_date });

const govHra = lease('A', { subsidy_program: 'section8', government_portion: 3000, tenant_portion: 1000, tenant_payment_method: 'hra' });
const selfPay = lease('B', { subsidy_program: 'none', total_monthly_rent: 2000, tenant_portion: 2000, tenant_payment_method: 'direct' });
const govTenant = lease('C', { subsidy_program: 'cityfheps', government_portion: 3000, tenant_portion: 1000, tenant_payment_method: 'direct' });

// A: Oct gov paid, one HRA check paid → HRA owes 500
const aI = insts(govHra, 'cA', '2026-10-01');
let hraSeen = 0;
const aPaid = aI.map((i) => i.portion === 'government' ? pay(i) : (i.payer === 'hra' && hraSeen++ === 0 ? pay(i) : i));
// B: Sep unpaid (2000), Oct fully paid → Full
const bSep = insts(selfPay, 'cB9', '2026-09-01');
const bOct = insts(selfPay, 'cB10', '2026-10-01').map((i) => pay(i));
// C: Oct nothing received → gov 3000 + tenant 1000; Nov future → ignored
const cOct = insts(govTenant, 'cC', '2026-10-01');
const cNov = insts(govTenant, 'cCn', '2026-11-01');
// Deleted charge ignored
const deleted = charge('cDel', 'C', '2026-08-01', { deleted_at: '2026-09-01' });
const delI = insts(govTenant, 'cDel', '2026-08-01');

const charges = [charge('cA', 'A', '2026-10-01'), charge('cB9', 'B', '2026-09-01', { total_rent: 2000 }), charge('cB10', 'B', '2026-10-01', { total_rent: 2000, status: 'paid' }), charge('cC', 'C', '2026-10-01'), charge('cCn', 'C', '2026-11-01'), deleted];
const r = balanceTriage([govHra, selfPay, govTenant], charges, [...aPaid, ...bSep, ...bOct, ...cOct, ...cNov, ...delI], TODAY);

const row = (id: string) => r.leases.find((x) => x.leaseId === id);
check('A: HRA owes $500', row('A')?.outstanding === 500 && row('A')?.byPayer.hra === 500 && !row('A')?.byPayer.gov);
check('A: setup label Gov + HRA', row('A')?.setupLabel === 'Gov + HRA');
check('B: only unpaid Sept counted ($2,000)', row('B')?.outstanding === 2000 && row('B')?.months.join() === '2026-09-01');
check('C: gov $3,000 + tenant $1,000, future Nov ignored', row('C')?.outstanding === 4000 && row('C')?.byPayer.gov === 3000 && row('C')?.byPayer.tenant === 1000 && row('C')?.months.length === 1);
check('deleted charge ignored', !row('C')?.months.includes('2026-08-01'));
check('sorted by outstanding desc', r.leases.map((x) => x.leaseId).join() === 'C,B,A');
check('total outstanding $6,500', r.totalOutstanding === 6500);
check('by payer totals', JSON.stringify(r.byPayer) === JSON.stringify([{ key: 'gov', label: 'Gov program', amount: 3000 }, { key: 'tenant', label: 'Tenant', amount: 3000 }, { key: 'hra', label: 'HRA (tenant share)', amount: 500 }]));
check('fully paid lease absent', balanceTriage([selfPay], [charges[2]], bOct, TODAY).leases.length === 0);
check('deleted lease ignored', balanceTriage([{ ...selfPay, deleted_at: 'x' }], charges, bSep, TODAY).leases.length === 0);
check('no data → zero', balanceTriage([], [], [], TODAY).totalOutstanding === 0);

// Ending leases
const e = endingLeases([
  lease('p', { lease_end: '2026-10-01' }),
  lease('d0', { lease_end: '2026-10-13' }),
  lease('d30', { lease_end: '2026-11-12' }),
  lease('d31', { lease_end: '2026-11-13' }),
  lease('d60', { lease_end: '2026-12-12' }),
  lease('d61', { lease_end: '2026-12-13' }),
  lease('d90', { lease_end: '2027-01-11' }),
  lease('d91', { lease_end: '2027-01-12' }),
  lease('none', {}),
  lease('ended', { lease_end: '2026-10-20', status: 'ended' }),
  lease('del', { lease_end: '2026-10-20', deleted_at: 'x' }),
], TODAY);
const b = (id: string) => e.find((x) => x.leaseId === id)?.bucket;
check('past end, still active → overdue', b('p') === 'overdue' && e[0].leaseId === 'p' && e[0].daysLeft === -12);
check('ends today → 30', b('d0') === '30');
check('day 30 → 30, day 31 → 60', b('d30') === '30' && b('d31') === '60');
check('day 60 → 60, day 61 → 90', b('d60') === '60' && b('d61') === '90');
check('day 90 in, day 91 out', b('d90') === '90' && !b('d91'));
check('no end / ended / deleted excluded', !b('none') && !b('ended') && !b('del'));
check('sorted soonest first', e.every((x, i) => i === 0 || e[i - 1].daysLeft <= x.daysLeft));
check('DST-safe across Nov boundary', e.find((x) => x.leaseId === 'd30')?.daysLeft === 30);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
