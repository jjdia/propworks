import type { RentInstallment, RentCharge, Lease, Tenant, RentalUnit, Property } from './types';

// ---------------------------------------------------------------------------
// Finds every unpaid (or partially paid) rent installment across ALL
// months — not just the current one — so tenants who fell behind a while
// ago don't silently drop off the radar once the month changes. Kept as a
// pure function (same pattern as reportExport.ts) so the "who owes what"
// logic is unit-testable without touching Dexie or the UI.
// ---------------------------------------------------------------------------

export interface OverdueData {
  installments: RentInstallment[];
  rentCharges: RentCharge[];
  leases: Lease[];
  tenants: Tenant[];
  rentalUnits: RentalUnit[];
  properties: Property[];
  today: string; // YYYY-MM-DD
}

export interface OverdueItem {
  installmentId: string;
  tenantName: string;
  propertyName: string;
  unitName: string;
  portion: 'government' | 'tenant';
  payer: string;
  amount: number;
  dueDate: string;
  daysOverdue: number; // 0 if due today, negative never appears (upcoming excluded)
  status: string;
}

export function computeOverdueItems(data: OverdueData): OverdueItem[] {
  const relevant = data.installments.filter(
    (i) => (i.status === 'due' || i.status === 'late' || i.status === 'partial') && i.due_date <= data.today,
  );

  const items: OverdueItem[] = relevant.map((inst) => {
    const charge = data.rentCharges.find((c) => c.id === inst.rent_charge_id);
    const lease = charge ? data.leases.find((l) => l.id === charge.lease_id) : undefined;
    const tenant = lease ? data.tenants.find((t) => t.id === lease.tenant_id) : undefined;
    const unit = lease ? data.rentalUnits.find((u) => u.id === lease.rental_unit_id) : undefined;
    const property = unit ? data.properties.find((p) => p.id === unit.property_id) : undefined;

    const dueMs = new Date(inst.due_date).getTime();
    const todayMs = new Date(data.today).getTime();
    const daysOverdue = Math.max(0, Math.round((todayMs - dueMs) / 86400000));

    return {
      installmentId: inst.id,
      tenantName: tenant?.full_name ?? 'Unknown tenant',
      propertyName: property?.name ?? 'Unknown property',
      unitName: unit?.name ?? '',
      portion: inst.portion,
      payer: inst.payer,
      amount: inst.status === 'partial' ? inst.amount - (inst.paid_amount ?? 0) : inst.amount,
      dueDate: inst.due_date,
      daysOverdue,
      status: inst.status,
    };
  });

  return items.sort((a, b) => b.daysOverdue - a.daysOverdue);
}

export function summarizeOverdue(items: OverdueItem[]): { count: number; total: number; tenantCount: number } {
  const total = items.reduce((sum, i) => sum + i.amount, 0);
  const tenantCount = new Set(items.map((i) => i.tenantName)).size;
  return { count: items.length, total, tenantCount };
}
