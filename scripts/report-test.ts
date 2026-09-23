import { computePortfolioTotals, computePropertyPerformance, computeExpenseCategoryTotals, computeMonthlySeries, type ReportData } from '../src/lib/reportExport';
import type { Property, Expense, RentCharge, RentInstallment, Lease, Tenant, RentalUnit } from '../src/lib/types';

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`);
  if (cond) pass++; else fail++;
}

const meta = { owner_id: 'o1', created_at: '', updated_at: '', deleted_at: null };

const property: Property = { id: 'prop1', name: '62 Fillmore', ...meta };
const unit: RentalUnit = { id: 'unit1', property_id: 'prop1', name: 'Unit 1', unit_kind: 'apartment', status: 'occupied', ...meta };
const tenant: Tenant = { id: 'tenant1', full_name: 'Test Tenant', ...meta };
const lease: Lease = { id: 'lease1', rental_unit_id: 'unit1', tenant_id: 'tenant1', total_monthly_rent: 2000, status: 'active', ...meta };

const charge: RentCharge = { id: 'charge1', lease_id: 'lease1', charge_month: '2026-06-01', total_rent: 2000, status: 'partial', ...meta };
const installments: RentInstallment[] = [
  { id: 'i1', rent_charge_id: 'charge1', portion: 'tenant', payer: 'tenant', amount: 2000, due_date: '2026-06-05', status: 'paid', paid_date: '2026-06-04', paid_amount: 1500, ...meta },
];

const expense: Expense = { id: 'e1', property_id: 'prop1', expense_date: '2026-06-10', category: 'Repairs & Maintenance', paid_by: 'landlord', frequency: 'one_time', amount: 300, ...meta };

const data: ReportData = {
  properties: [property], expenses: [expense], rentCharges: [charge], rentInstallments: installments,
  leases: [lease], tenants: [tenant], rentalUnits: [unit],
  periodStart: '2026-06-01', periodEnd: '2026-06-30',
};

const totals = computePortfolioTotals(data);
check('expected rent = 2000', totals.expectedRent === 2000);
check('recorded income = 1500 (partial payment)', totals.recordedIncome === 1500);
check('outstanding = 500', totals.outstanding === 500);
check('operating expenses = 300', totals.operatingExpenses === 300);
check('net recorded cash = 1200 (1500 - 300)', totals.netRecordedCash === 1200);

const perProperty = computePropertyPerformance(data);
check('one property row', perProperty.length === 1);
check('property net matches portfolio net', perProperty[0].net === 1200);

const catTotals = computeExpenseCategoryTotals(data);
check('category total correct', catTotals['Repairs & Maintenance'] === 300);

// Out-of-period expense should be excluded.
const dataWithOldExpense: ReportData = {
  ...data,
  expenses: [...data.expenses, { id: 'e2', property_id: 'prop1', expense_date: '2025-01-01', category: 'Insurance', paid_by: 'landlord', frequency: 'annual', amount: 999, ...meta }],
};
const totals2 = computePortfolioTotals(dataWithOldExpense);
check('out-of-period expense excluded from totals', totals2.operatingExpenses === 300);

// --- monthly series ---
const yearData: ReportData = { ...data, periodStart: '2026-01-01', periodEnd: '2026-12-31' };
const series = computeMonthlySeries(yearData);
check('monthly series has 12 points for a full year', series.length === 12);
check('June point has the 1500 recorded income', series.find((p) => p.month === '2026-06')?.income === 1500);
check('June point has the 300 expense', series.find((p) => p.month === '2026-06')?.expenses === 300);
check('a month with no activity is still present with zeros', series.find((p) => p.month === '2026-03')?.income === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
