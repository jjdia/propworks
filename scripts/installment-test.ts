import { buildInstallments, splitEven } from '../src/lib/installments';
import type { Lease } from '../src/lib/types';

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`);
  if (cond) pass++; else fail++;
}

function baseLease(overrides: Partial<Lease>): Lease {
  const now = new Date().toISOString();
  return {
    id: 'lease-1', owner_id: 'owner-1', created_at: now, updated_at: now, deleted_at: null,
    rental_unit_id: 'unit-1', tenant_id: 'tenant-1', total_monthly_rent: 2000,
    status: 'active', rent_due_day: 5,
    ...overrides,
  };
}

// HRA government portion + HRA-paid tenant portion: 2 + 2 = 4 installments,
// all on the 15th/30th, amounts halved and summing back to the original.
{
  const lease = baseLease({
    subsidy_program: 'hra', government_portion: 1500, government_payment_frequency: 'monthly', // should be forced to twice_monthly anyway
    tenant_portion: 500, tenant_payment_method: 'hra',
  });
  const inst = buildInstallments('owner-1', 'charge-1', '2026-10-01', lease);
  check('HRA lease produces 4 installments', inst.length === 4);
  check('all HRA installments due on 15th or 30th', inst.every((i) => i.due_date.endsWith('-15') || i.due_date.endsWith('-30')));
  const govTotal = inst.filter((i) => i.portion === 'government').reduce((s, i) => s + i.amount, 0);
  const tenantTotal = inst.filter((i) => i.portion === 'tenant').reduce((s, i) => s + i.amount, 0);
  check('government installments sum back to government_portion', Math.abs(govTotal - 1500) < 0.01);
  check('tenant installments sum back to tenant_portion', Math.abs(tenantTotal - 500) < 0.01);
}

// CityFHEPS monthly government + tenant pays directly: 1 + 1 = 2 installments.
{
  const lease = baseLease({
    subsidy_program: 'cityfheps', government_portion: 1200, government_payment_frequency: 'monthly',
    tenant_portion: 800, tenant_payment_method: 'direct',
  });
  const inst = buildInstallments('owner-1', 'charge-2', '2026-10-01', lease);
  check('CityFHEPS-monthly + direct-tenant produces 2 installments', inst.length === 2);
  check('both due on the lease due day (5th)', inst.every((i) => i.due_date.endsWith('-05')));
}

// CityFHEPS twice-monthly government + tenant pays directly: 2 + 1 = 3.
{
  const lease = baseLease({
    subsidy_program: 'cityfheps', government_portion: 1200, government_payment_frequency: 'twice_monthly',
    tenant_portion: 800, tenant_payment_method: 'direct',
  });
  const inst = buildInstallments('owner-1', 'charge-3', '2026-10-01', lease);
  check('CityFHEPS-twice-monthly + direct-tenant produces 3 installments', inst.length === 3);
  const govInst = inst.filter((i) => i.portion === 'government');
  check('2 government installments on 15th/30th', govInst.length === 2 && govInst.every((i) => i.due_date.endsWith('-15') || i.due_date.endsWith('-30')));
}

// No subsidy: tenant pays the full rent directly, 1 installment.
{
  const lease = baseLease({ subsidy_program: 'none', tenant_portion: 2000, tenant_payment_method: 'direct' });
  const inst = buildInstallments('owner-1', 'charge-4', '2026-10-01', lease);
  check('no-subsidy lease produces exactly 1 installment for the full rent', inst.length === 1 && Math.abs(inst[0].amount - 2000) < 0.01);
}

// Day-30 due date clamps correctly for February (28 days in 2026, non-leap).
{
  const lease = baseLease({ subsidy_program: 'hra', government_portion: 1000, tenant_portion: 0, tenant_payment_method: 'direct' });
  const inst = buildInstallments('owner-1', 'charge-5', '2026-02-01', lease);
  check('Feb 30th clamps to Feb 28th (2026 is not a leap year)', inst.some((i) => i.due_date === '2026-02-28'));
}

// --- Bulk-paid backfill mode: status='paid' stamps paid_date/paid_amount too ---
{
  const lease = baseLease({ subsidy_program: 'none', tenant_portion: 2000, tenant_payment_method: 'direct' });
  const inst = buildInstallments('owner-1', 'charge-6', '2026-03-01', lease, 'paid');
  check('paid-mode installment has status paid', inst[0].status === 'paid');
  check('paid-mode installment stamps paid_date to its own due_date', inst[0].paid_date === inst[0].due_date);
  check('paid-mode installment stamps paid_amount to the full amount', inst[0].paid_amount === inst[0].amount);
}
{
  // HRA split (2 installments) — both halves must be individually stamped paid.
  const lease = baseLease({ subsidy_program: 'hra', government_portion: 1000, tenant_portion: 0, tenant_payment_method: 'direct' });
  const inst = buildInstallments('owner-1', 'charge-7', '2026-03-01', lease, 'paid');
  check('both halves of an HRA split are marked paid', inst.every((i) => i.status === 'paid'));
  check('both halves have their own correct paid_amount (not the combined total)', inst.every((i) => i.paid_amount === i.amount) && inst[0].paid_amount === 500);
}
// Default ('due') and 'unknown' modes must NOT set paid_date/paid_amount.
{
  const lease = baseLease({ subsidy_program: 'none', tenant_portion: 2000, tenant_payment_method: 'direct' });
  const dueMode = buildInstallments('owner-1', 'charge-8', '2026-03-01', lease, 'due');
  const unknownMode = buildInstallments('owner-1', 'charge-9', '2026-03-01', lease, 'unknown');
  check('due-mode installment has no paid_date', dueMode[0].paid_date === undefined);
  check('unknown-mode installment has no paid_date', unknownMode[0].paid_date === undefined);
}

// ======================= issue #10: payer setups =======================
const sum = (xs: { amount: number }[]) => Math.round(xs.reduce((s, i) => s + i.amount * 100, 0)) / 100;
const days = (xs: { due_date: string }[]) => xs.map((i) => i.due_date.slice(8)).join(',');

// Setup 1 — self-pay: one check on rent_due_day
{
  const inst = buildInstallments('owner-1', 'c', '2026-10-01', baseLease({ subsidy_program: 'none', tenant_portion: 2000, tenant_payment_method: 'direct' }));
  check('setup 1 self-pay → 1 tenant check on due day (5th)', inst.length === 1 && inst[0].payer === 'tenant' && days(inst) === '05');
}
// Setup 2 — gov + tenant: default 1 check; twice → 1st & 15th
{
  const l = baseLease({ subsidy_program: 'section8', government_portion: 3000, tenant_portion: 1000, tenant_payment_method: 'direct' });
  const one = buildInstallments('owner-1', 'c', '2026-10-01', l).filter((i) => i.portion === 'tenant');
  check('setup 2 default (null freq) → 1 tenant check on due day', one.length === 1 && days(one) === '05' && one[0].payer === 'tenant');
  const two = buildInstallments('owner-1', 'c', '2026-10-01', { ...l, tenant_payment_frequency: 'twice_monthly' }).filter((i) => i.portion === 'tenant');
  check('setup 2 twice_monthly → tenant checks on 1st & 15th', two.length === 2 && days(two) === '01,15' && two.every((i) => i.payer === 'tenant'));
  check('setup 2 twice_monthly sums to tenant_portion', sum(two) === 1000);
}
// Setup 3 — gov + HRA: default 2 checks 15th/30th; monthly → 1
{
  const l = baseLease({ subsidy_program: 'cityfheps', government_portion: 3000, tenant_portion: 1000, tenant_payment_method: 'hra' });
  const hra = buildInstallments('owner-1', 'c', '2026-10-01', l).filter((i) => i.portion === 'tenant');
  check('setup 3 default (null freq) → HRA 15th & 30th', hra.length === 2 && days(hra) === '15,30' && hra.every((i) => i.payer === 'hra'));
  const hraTwice = buildInstallments('owner-1', 'c', '2026-10-01', { ...l, tenant_payment_frequency: 'twice_monthly' }).filter((i) => i.portion === 'tenant');
  check('setup 3 explicit twice_monthly → HRA 15th & 30th (not 1st/15th)', days(hraTwice) === '15,30');
  const hraOne = buildInstallments('owner-1', 'c', '2026-10-01', { ...l, tenant_payment_frequency: 'monthly' }).filter((i) => i.portion === 'tenant');
  check('setup 3 monthly → one HRA check for the whole share', hraOne.length === 1 && hraOne[0].payer === 'hra' && hraOne[0].amount === 1000);
  const feb = buildInstallments('owner-1', 'c', '2026-02-01', l).filter((i) => i.portion === 'tenant');
  check('setup 3 Feb: HRA "30th" moves to Feb 28', days(feb) === '15,28');
}
// Null frequency output is identical to the pre-#10 builder for existing lease shapes
{
  const hraLease = baseLease({ subsidy_program: 'section8', government_portion: 1500, tenant_portion: 500, tenant_payment_method: 'hra' });
  const inst = buildInstallments('owner-1', 'c', '2026-10-01', hraLease);
  check('null freq HRA lease unchanged: gov 1 on 5th + HRA 250/250 on 15th/30th',
    inst.length === 3 && inst[0].amount === 1500 && days(inst) === '05,15,30' && inst[1].amount === 250 && inst[2].amount === 250);
  const direct = buildInstallments('owner-1', 'c', '2026-10-01', baseLease({ subsidy_program: 'section8', government_portion: 1500, tenant_portion: 500, tenant_payment_method: 'direct' }));
  check('null freq direct lease unchanged: gov + tenant both on 5th', direct.length === 2 && days(direct) === '05,05');
}
// Legacy hra-as-gov still generates its 15th/30th gov installments
{
  const inst = buildInstallments('owner-1', 'c', '2026-10-01', baseLease({ subsidy_program: 'hra', government_portion: 1200, tenant_portion: 300, tenant_payment_method: 'direct' }));
  const gov = inst.filter((i) => i.portion === 'government');
  check('legacy hra-as-gov still generates 2 gov checks on 15th/30th', gov.length === 2 && days(gov) === '15,30' && gov.every((i) => i.payer === 'hra'));
}
// Free-text legacy program normalised for the payer tag
{
  const inst = buildInstallments('owner-1', 'c', '2026-10-01', baseLease({ subsidy_program: 'Section 8' as never, government_portion: 1000, tenant_portion: 500 }));
  check("free-text 'Section 8' gov installment gets payer 'section8'", inst[0].payer === 'section8');
}
// Odd-cent split fix
{
  check('splitEven(1000.01) = [500.01, 500.00]', JSON.stringify(splitEven(1000.01)) === '[500.01,500]');
  check('splitEven(1234.57) sums exactly', Math.round((splitEven(1234.57)[0] + splitEven(1234.57)[1]) * 100) === 123457);
  const l = baseLease({ subsidy_program: 'cityfheps', government_portion: 1000.01, government_payment_frequency: 'twice_monthly', tenant_portion: 1234.57, tenant_payment_method: 'hra' });
  const inst = buildInstallments('owner-1', 'c', '2026-10-01', l);
  check('$1,000.01 gov split adds up exactly (was $1,000.02)', sum(inst.filter((i) => i.portion === 'government')) === 1000.01);
  check('$1,234.57 HRA split adds up exactly', sum(inst.filter((i) => i.portion === 'tenant')) === 1234.57);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
