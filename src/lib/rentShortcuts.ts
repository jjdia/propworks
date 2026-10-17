// Resolves which tenant/lease the Rent Tracking "Edit tenant" / "Edit lease"
// shortcuts should open. Pure (no Dexie) so it can be tested in scripts/.
// The actual editing reuses TenantFormModal / LeaseFormModal, which save via
// mutations.ts (Dexie first, then outbox) — same path as the Tenants page.
import type { Lease, RentCharge, RentInstallment, Tenant } from './types';

type WithId = { id: string; deleted_at?: string | null };

function live<T extends WithId>(rows: readonly T[] | undefined, id: string | undefined): T | null {
  if (!id || !rows) return null;
  const row = rows.find((r) => r.id === id);
  return row && !row.deleted_at ? row : null;
}

/** Tenant to edit for a lease card; null when missing or soft-deleted (button hidden). */
export function tenantForLease(lease: Pick<Lease, 'tenant_id'>, tenants: readonly Tenant[] | undefined): Tenant | null {
  return live(tenants, lease.tenant_id);
}

/** Lease (and its tenant) behind a payment line: installment → charge → lease. */
export function editTargetsForInstallment(
  inst: Pick<RentInstallment, 'rent_charge_id'>,
  charges: readonly RentCharge[] | undefined,
  leases: readonly Lease[] | undefined,
  tenants: readonly Tenant[] | undefined,
): { lease: Lease | null; tenant: Tenant | null } {
  const charge = live(charges, inst.rent_charge_id);
  const lease = live(leases, charge?.lease_id);
  return { lease, tenant: lease ? tenantForLease(lease, tenants) : null };
}
