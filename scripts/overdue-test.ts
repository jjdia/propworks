import { computeOverdueItems, summarizeOverdue, type OverdueData } from '../src/lib/overdue';
import type { Property, RentalUnit, Tenant, Lease, RentCharge, RentInstallment } from '../src/lib/types';

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`);
  if (cond) pass++; else fail++;
}

const meta = { owner_id: 'o1', created_at: '', updated_at: '', deleted_at: null };
const property: Property = { id: 'prop1', name: '62 Fillmore', ...meta };
const unit: RentalUnit = { id: 'unit1', property_id: 'prop1', name: 'Unit 1', unit_kind: 'apartment', status: 'occupied', ...meta };
const tenant: Tenant = { id: 'tenant1', full_name: 'Jane Doe', ...meta };
const lease: Lease = { id: 'lease1', rental_unit_id: 'unit1', tenant_id: 'tenant1', total_monthly_rent: 2000, status: 'active', ...meta };

const charges: RentCharge[] = [
  { id: 'charge-may', lease_id: 'lease1', charge_month: '2026-05-01', total_rent: 2000, status: 'due', ...meta },
  { id: 'charge-jun', lease_id: 'lease1', charge_month: '2026-06-01', total_rent: 2000, status: 'due', ...meta },
];

const installments: RentInstallment[] = [
  // May: unpaid, well overdue relative to "today" = 2026-06-15
  { id: 'i-may', rent_charge_id: 'charge-may', portion: 'tenant', payer: 'tenant', amount: 2000, due_date: '2026-05-01', status: 'due', ...meta },
  // June: partially paid, $500 of $2000 outstanding, still due
  { id: 'i-jun', rent_charge_id: 'charge-jun', portion: 'tenant', payer: 'tenant', amount: 2000, due_date: '2026-06-01', status: 'partial', paid_amount: 1500, ...meta },
  // A future installment not yet due — must NOT appear
  { id: 'i-future', rent_charge_id: 'charge-jun', portion: 'government', payer: 'hra', amount: 500, due_date: '2026-06-30', status: 'due', ...meta },
  // A fully paid installment — must NOT appear
  { id: 'i-paid', rent_charge_id: 'charge-may', portion: 'government', payer: 'hra', amount: 500, due_date: '2026-05-15', status: 'paid', paid_amount: 500, ...meta },
];

const data: OverdueData = {
  installments, rentCharges: charges, leases: [lease], tenants: [tenant], rentalUnits: [unit], properties: [property],
  today: '2026-06-15',
};

const items = computeOverdueItems(data);
check('finds exactly 2 overdue items (May unpaid + June partial)', items.length === 2);
check('excludes a future-dated installment not yet due', !items.some((i) => i.installmentId === 'i-future'));
check('excludes a fully paid installment', !items.some((i) => i.installmentId === 'i-paid'));
check('most-overdue item (May) sorts first', items[0].installmentId === 'i-may');
check('May item shows correct days overdue (May 1 to June 15 = 45 days)', items[0].daysOverdue === 45);
check('partial June item only counts the REMAINING unpaid amount ($500), not the full $2000', items.find((i) => i.installmentId === 'i-jun')!.amount === 500);
check('tenant name resolved correctly', items[0].tenantName === 'Jane Doe');
check('property name resolved correctly', items[0].propertyName === '62 Fillmore');

const summary = summarizeOverdue(items);
check('summary count is 2', summary.count === 2);
check('summary total is 2000 + 500 = 2500', summary.total === 2500);
check('summary tenantCount is 1 (same tenant on both)', summary.tenantCount === 1);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
