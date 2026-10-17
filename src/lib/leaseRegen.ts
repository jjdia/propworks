import type { Lease, RentCharge, RentInstallment } from './types';
import { buildInstallments } from './installments';
import { receivedOn } from './chargeStatus';

// ---------------------------------------------------------------------------
// After a lease edit: regenerate-or-skip for the current (and any
// pre-generated future) months.
//
//   - only when a schedule field changed (rent, portions, payer setup,
//     frequency, due day) and the lease is still active
//   - past months (charge_month < current month) are NEVER touched
//   - a month with ANY money received (an installment with received > 0 or
//     paid_amount > 0) or marked Full / paid is left alone → "has_payments"
//   - otherwise the charge is updated IN PLACE (unique lease_id+charge_month,
//     so no new charge row), its old installments are soft-deleted via the
//     outbox path, and fresh ones are built with the #10 buildInstallments()
//
// Pure module; Dexie I/O is injected (mutations.ts wires it, tests use memory).
// ---------------------------------------------------------------------------

const SCHEDULE_FIELDS = [
  'total_monthly_rent', 'government_portion', 'tenant_portion', 'subsidy_program',
  'tenant_payment_method', 'government_payment_frequency', 'tenant_payment_frequency', 'rent_due_day',
] as const satisfies readonly (keyof Lease)[];

function norm(v: unknown): string {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  const n = Number(v);
  return typeof v === 'string' && v.trim() !== '' && !Number.isNaN(n) ? String(Math.round(n * 100) / 100) : String(v);
}

/** True when an edit changed anything that feeds installment generation. */
export function scheduleFieldsChanged(before: Lease, after: Lease): boolean {
  const dueBefore = before.rent_due_day ?? 1;
  const dueAfter = after.rent_due_day ?? 1;
  if (dueBefore !== dueAfter) return true;
  return SCHEDULE_FIELDS.some((f) => f !== 'rent_due_day' && norm(before[f]) !== norm(after[f]));
}

/** Money received on a month, by the strictest reading (amount OR paid_amount). */
export function monthHasPayments(charge: RentCharge, installments: RentInstallment[]): boolean {
  if (charge.marked_full_at || charge.status === 'paid') return true;
  return installments.some((i) => !i.deleted_at && (receivedOn(i) > 0 || Number(i.paid_amount ?? 0) > 0));
}

export type MonthPlan = 'past' | 'has_payments' | 'regenerate';

/** currentMonth is 'YYYY-MM-01'. */
export function planMonthRegen(charge: RentCharge, installments: RentInstallment[], currentMonth: string): MonthPlan {
  if (charge.charge_month < currentMonth) return 'past';
  if (monthHasPayments(charge, installments)) return 'has_payments';
  return 'regenerate';
}

/** Local-time 'YYYY-MM-01'. */
export function currentMonthStart(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

export interface LeaseRegenDeps {
  getCharges(leaseId: string): Promise<RentCharge[]>;
  getInstallments(chargeId: string): Promise<RentInstallment[]>;
  saveCharge(c: RentCharge): Promise<RentCharge>;
  saveInstallment(i: RentInstallment): Promise<RentInstallment>;
  softDeleteInstallment(id: string): Promise<void>;
  newMeta(ownerId: string): { id: string; owner_id: string; created_at: string; updated_at: string; deleted_at: null };
  rollUp(chargeId: string): Promise<unknown>;
}

export interface LeaseRegenResult {
  regenerated: string[]; // charge_month values
  skippedWithPayments: string[];
}

export async function regenerateLeaseMonthsWith(
  deps: LeaseRegenDeps,
  before: Lease,
  after: Lease,
  currentMonth: string,
): Promise<LeaseRegenResult> {
  const result: LeaseRegenResult = { regenerated: [], skippedWithPayments: [] };
  if (after.status !== 'active' || after.deleted_at || !scheduleFieldsChanged(before, after)) return result;
  const charges = (await deps.getCharges(after.id))
    .filter((c) => !c.deleted_at && c.charge_month >= currentMonth)
    .sort((a, b) => a.charge_month.localeCompare(b.charge_month));
  for (const charge of charges) {
    const insts = (await deps.getInstallments(charge.id)).filter((i) => !i.deleted_at);
    const plan = planMonthRegen(charge, insts, currentMonth);
    if (plan === 'has_payments') { result.skippedWithPayments.push(charge.charge_month); continue; }
    if (plan !== 'regenerate') continue;
    const fresh = buildInstallments(after.owner_id, charge.id, charge.charge_month, after);
    const sig = (xs: { portion: string; payer: string; amount: number; due_date: string }[]) =>
      xs.map((x) => `${x.portion}|${x.payer}|${Number(x.amount).toFixed(2)}|${x.due_date}`).sort().join(';');
    const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);
    const totalsSame = cents(charge.total_rent) === cents(after.total_monthly_rent)
      && cents(charge.government_portion) === cents(after.government_portion)
      && cents(charge.tenant_portion) === cents(after.tenant_portion);
    if (totalsSame && sig(insts) === sig(fresh)) continue; // edit didn't change this month's checks
    // Keep "unknown" months unknown (e.g. backfilled); otherwise new checks are "due".
    const defaultStatus = insts.length > 0 && insts.every((i) => i.status === 'unknown') ? 'unknown' : 'due';
    await deps.saveCharge({
      ...charge,
      total_rent: after.total_monthly_rent,
      government_portion: after.government_portion,
      tenant_portion: after.tenant_portion,
      marked_full_at: null,
    });
    for (const i of insts) await deps.softDeleteInstallment(i.id);
    for (const ni of buildInstallments(after.owner_id, charge.id, charge.charge_month, after, defaultStatus)) {
      await deps.saveInstallment({ ...deps.newMeta(after.owner_id), ...ni });
    }
    await deps.rollUp(charge.id);
    result.regenerated.push(charge.charge_month);
  }
  return result;
}

// ------------------------------------------------------- unit reassignment

/** Other active, non-deleted leases already on `unitId` (excluding this lease). */
export function unitConflicts(leaseId: string, unitId: string, leases: readonly Lease[] | undefined): Lease[] {
  if (!unitId || !leases) return [];
  return leases.filter((l) => l.id !== leaseId && !l.deleted_at && l.status === 'active' && l.rental_unit_id === unitId);
}
