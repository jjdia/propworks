import type { Lease, RentInstallment } from './types';
import { normalizeProgram, tenantShareFrequency } from './payerSetup';

// ---------------------------------------------------------------------------
// Installment generation: given a lease's payment configuration, work out
// what actual due sub-payments (one per expected check) a month's
// rent_charge breaks into.
//
// Gov portion (Section 8 / CityFHEPS):
//   - monthly → ONE installment on rent_due_day
//   - twice_monthly → TWO, on the 15th and the 30th
//   - legacy subsidy_program = 'hra' → always 15th/30th, as before
// Tenant share (issue #10):
//   - paid by HRA (tenant_payment_method = 'hra'): default (null) or
//     twice_monthly → 15th & 30th; monthly → one check on rent_due_day
//   - paid by the tenant directly: default (null) or monthly → one check on
//     rent_due_day; twice_monthly → 1st & 15th
// The "30th" moves to the last day in shorter months.
// Two-check splits use splitEven() so they add up to the exact total.
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

/**
 * Split a money amount into two checks that add up to EXACTLY the total
 * (to the cent). The odd cent goes on the first check.
 * $1,000.01 → [500.01, 500.00] (previously both were round2(x/2) = 500.01).
 */
export function splitEven(total: number): [number, number] {
  const cents = Math.round(Number(total) * 100);
  const second = Math.floor(cents / 2);
  const first = cents - second;
  return [first / 100, second / 100];
}

type NewInstallment = Omit<RentInstallment, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>;

function stamp(base: NewInstallment, status: 'due' | 'unknown' | 'paid'): NewInstallment {
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
): NewInstallment[] {
  const installments: NewInstallment[] = [];
  const dueDay = lease.rent_due_day ?? 1;
  const mk = (portion: RentInstallment['portion'], payer: RentInstallment['payer'], amount: number, day: number) =>
    stamp({ owner_id: ownerId, rent_charge_id: chargeId, portion, payer, amount, due_date: dueDateInMonth(chargeMonth, day), status: 'due' }, defaultStatus);

  const rawProgram = lease.subsidy_program as string | undefined;
  const program = normalizeProgram(rawProgram);
  const hasProgram = program !== 'none';
  // Unrecognised free text keeps its raw value as the payer (flagged for review elsewhere).
  const govPayer = (program ?? rawProgram) as RentInstallment['payer'];

  const govAmount = Number(lease.government_portion ?? 0);
  if (govAmount > 0 && hasProgram) {
    const frequency = program === 'hra' ? 'twice_monthly' : (lease.government_payment_frequency ?? 'monthly');
    if (frequency === 'twice_monthly') {
      const [a, b] = splitEven(govAmount);
      installments.push(mk('government', govPayer, a, 15), mk('government', govPayer, b, 30));
    } else {
      installments.push(mk('government', govPayer, govAmount, dueDay));
    }
  }

  const tenantAmount = Number(lease.tenant_portion ?? (govAmount > 0 ? 0 : lease.total_monthly_rent));
  if (tenantAmount > 0) {
    const viaHra = lease.tenant_payment_method === 'hra';
    const payer: RentInstallment['payer'] = viaHra ? 'hra' : 'tenant';
    const frequency = tenantShareFrequency(lease);
    if (frequency === 'twice_monthly') {
      const [a, b] = splitEven(tenantAmount);
      const [d1, d2] = viaHra ? [15, 30] : [1, 15];
      installments.push(mk('tenant', payer, a, d1), mk('tenant', payer, b, d2));
    } else {
      installments.push(mk('tenant', payer, tenantAmount, dueDay));
    }
  }

  return installments;
}
