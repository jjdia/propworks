import type { Lease, RentInstallment } from './types';

// ---------------------------------------------------------------------------
// Installment generation: given a lease's payment configuration, work out
// what actual due sub-payments a month's rent_charge breaks into.
//   - Section 8 / CityFHEPS monthly, or a direct-pay tenant portion:
//     ONE installment, due on the lease's rent_due_day.
//   - HRA (government side, or tenant portion routed through HRA), or a
//     CityFHEPS government portion explicitly marked twice-monthly:
//     TWO installments, due the 15th and the 30th.
//
// Pure function, no I/O — kept in its own module (rather than mutations.ts)
// so it can be unit-tested with plain Node/tsx without dragging in
// Supabase/Dexie initialization.
// ---------------------------------------------------------------------------

function clampDay(year: number, month1to12: number, day: number) {
  const lastDay = new Date(year, month1to12, 0).getDate(); // day 0 of next month = last day of this month
  return Math.min(day, lastDay);
}

function dueDateInMonth(chargeMonth: string, day: number): string {
  const [y, m] = chargeMonth.split('-').map(Number);
  const clamped = clampDay(y, m, day);
  return `${y}-${String(m).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`;
}

function round2(n: number) { return Math.round(n * 100) / 100; }

function stamp(base: Omit<RentInstallment, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>, status: 'due' | 'unknown' | 'paid') {
  if (status === 'paid') {
    return { ...base, status, paid_date: base.due_date, paid_amount: base.amount };
  }
  return { ...base, status };
}

export function buildInstallments(
  ownerId: string,
  chargeId: string,
  chargeMonth: string,
  lease: Lease,
  defaultStatus: 'due' | 'unknown' | 'paid' = 'due',
): Omit<RentInstallment, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>[] {
  const installments: Omit<RentInstallment, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>[] = [];
  const dueDay = lease.rent_due_day ?? 1;

  const govAmount = Number(lease.government_portion ?? 0);
  if (govAmount > 0 && lease.subsidy_program && lease.subsidy_program !== 'none') {
    const frequency = lease.subsidy_program === 'hra' ? 'twice_monthly' : (lease.government_payment_frequency ?? 'monthly');
    if (frequency === 'twice_monthly') {
      installments.push(
        stamp({ owner_id: ownerId, rent_charge_id: chargeId, portion: 'government', payer: lease.subsidy_program, amount: round2(govAmount / 2), due_date: dueDateInMonth(chargeMonth, 15), status: 'due' }, defaultStatus),
        stamp({ owner_id: ownerId, rent_charge_id: chargeId, portion: 'government', payer: lease.subsidy_program, amount: round2(govAmount / 2), due_date: dueDateInMonth(chargeMonth, 30), status: 'due' }, defaultStatus),
      );
    } else {
      installments.push(
        stamp({ owner_id: ownerId, rent_charge_id: chargeId, portion: 'government', payer: lease.subsidy_program, amount: govAmount, due_date: dueDateInMonth(chargeMonth, dueDay), status: 'due' }, defaultStatus),
      );
    }
  }

  const tenantAmount = Number(lease.tenant_portion ?? (govAmount > 0 ? 0 : lease.total_monthly_rent));
  if (tenantAmount > 0) {
    if (lease.tenant_payment_method === 'hra') {
      installments.push(
        stamp({ owner_id: ownerId, rent_charge_id: chargeId, portion: 'tenant', payer: 'hra', amount: round2(tenantAmount / 2), due_date: dueDateInMonth(chargeMonth, 15), status: 'due' }, defaultStatus),
        stamp({ owner_id: ownerId, rent_charge_id: chargeId, portion: 'tenant', payer: 'hra', amount: round2(tenantAmount / 2), due_date: dueDateInMonth(chargeMonth, 30), status: 'due' }, defaultStatus),
      );
    } else {
      installments.push(
        stamp({ owner_id: ownerId, rent_charge_id: chargeId, portion: 'tenant', payer: 'tenant', amount: tenantAmount, due_date: dueDateInMonth(chargeMonth, dueDay), status: 'due' }, defaultStatus),
      );
    }
  }

  return installments;
}
