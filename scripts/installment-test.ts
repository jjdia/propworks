import { buildInstallments } from '../src/lib/installments';
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
