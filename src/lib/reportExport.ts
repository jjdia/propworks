import * as XLSX from 'xlsx';
import type { Property, Expense, RentCharge, RentInstallment, Lease, Tenant, RentalUnit } from './types';

// ---------------------------------------------------------------------------
// Builds the same kind of multi-sheet tax-prep workbook the old app
// produced, entirely client-side (no server round-trip — the data never
// leaves the browser except when the person explicitly shares/emails the
// resulting file themselves).
//
// Sheets: Portfolio Summary, Income Ledger, Expense Ledger, Property Detail.
// (Renovations and Buy-Sell Deals sheets from the old spec are omitted —
// those features don't exist in this rebuild yet.)
// ---------------------------------------------------------------------------

export interface ReportData {
  properties: Property[];
  expenses: Expense[];
  rentCharges: RentCharge[];
  rentInstallments: RentInstallment[];
  leases: Lease[];
  tenants: Tenant[];
  rentalUnits: RentalUnit[];
  periodStart: string; // YYYY-MM-DD, inclusive
  periodEnd: string;   // YYYY-MM-DD, inclusive
}

export interface PortfolioTotals {
  expectedRent: number;
  recordedIncome: number;
  outstanding: number;
  operatingExpenses: number;
  netRecordedCash: number;
}

export interface PropertyPerformance {
  propertyId: string;
  propertyName: string;
  expectedRent: number;
  recordedIncome: number;
  expenses: number;
  net: number;
}

function inPeriod(dateStr: string, start: string, end: string) {
  return dateStr >= start && dateStr <= end;
}

function propertyForUnit(unitId: string | null | undefined, units: RentalUnit[]): string | undefined {
  return units.find((u) => u.id === unitId)?.property_id;
}

function propertyForLease(lease: Lease | undefined, units: RentalUnit[]): string | undefined {
  if (!lease) return undefined;
  return propertyForUnit(lease.rental_unit_id, units);
}

export function computePortfolioTotals(data: ReportData): PortfolioTotals {
  const { rentCharges, rentInstallments, expenses, periodStart, periodEnd } = data;
  const chargesInPeriod = rentCharges.filter((c) => inPeriod(c.charge_month, periodStart, periodEnd));
  const expectedRent = chargesInPeriod.reduce((sum, c) => sum + Number(c.total_rent), 0);

  const chargeIds = new Set(chargesInPeriod.map((c) => c.id));
  const installmentsInPeriod = rentInstallments.filter((i) => chargeIds.has(i.rent_charge_id));
  const recordedIncome = installmentsInPeriod
    .filter((i) => i.status === 'paid' || i.status === 'partial')
    .reduce((sum, i) => sum + Number(i.paid_amount ?? 0), 0);

  const operatingExpenses = expenses
    .filter((e) => inPeriod(e.expense_date, periodStart, periodEnd))
    .reduce((sum, e) => sum + Number(e.amount), 0);

  return {
    expectedRent,
    recordedIncome,
    outstanding: expectedRent - recordedIncome,
    operatingExpenses,
    netRecordedCash: recordedIncome - operatingExpenses,
  };
}

export function computePropertyPerformance(data: ReportData): PropertyPerformance[] {
  const { properties, leases, rentCharges, rentInstallments, expenses, rentalUnits, periodStart, periodEnd } = data;

  return properties.map((p) => {
    const propertyLeaseIds = new Set(
      leases.filter((l) => propertyForLease(l, rentalUnits) === p.id).map((l) => l.id),
    );
    const chargesInPeriod = rentCharges.filter(
      (c) => propertyLeaseIds.has(c.lease_id) && inPeriod(c.charge_month, periodStart, periodEnd),
    );
    const expectedRent = chargesInPeriod.reduce((sum, c) => sum + Number(c.total_rent), 0);
    const chargeIds = new Set(chargesInPeriod.map((c) => c.id));
    const recordedIncome = rentInstallments
      .filter((i) => chargeIds.has(i.rent_charge_id) && (i.status === 'paid' || i.status === 'partial'))
      .reduce((sum, i) => sum + Number(i.paid_amount ?? 0), 0);
    const propertyExpenses = expenses
      .filter((e) => e.property_id === p.id && inPeriod(e.expense_date, periodStart, periodEnd))
      .reduce((sum, e) => sum + Number(e.amount), 0);

    return {
      propertyId: p.id,
      propertyName: p.name,
      expectedRent,
      recordedIncome,
      expenses: propertyExpenses,
      net: recordedIncome - propertyExpenses,
    };
  });
}

export function computeExpenseCategoryTotals(data: ReportData): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const e of data.expenses) {
    if (!inPeriod(e.expense_date, data.periodStart, data.periodEnd)) continue;
    totals[e.category] = (totals[e.category] ?? 0) + Number(e.amount);
  }
  return totals;
}

export interface MonthlyPoint {
  month: string; // YYYY-MM
  income: number;
  expenses: number;
}

// One point per calendar month between periodStart and periodEnd (inclusive),
// even if a month has no activity — so the chart has a consistent x-axis
// instead of skipping gaps, which reads as broken/missing data on a graph.
export function computeMonthlySeries(data: ReportData): MonthlyPoint[] {
  const [startY, startM] = data.periodStart.slice(0, 7).split('-').map(Number);
  const [endY, endM] = data.periodEnd.slice(0, 7).split('-').map(Number);

  const points: MonthlyPoint[] = [];
  let y = startY, m = startM;
  // Cap at 120 months (10 years) so a fat-fingered "all time" range can't
  // hang the chart trying to render thousands of points.
  let guard = 0;
  while ((y < endY || (y === endY && m <= endM)) && guard < 120) {
    points.push({ month: `${y}-${String(m).padStart(2, '0')}`, income: 0, expenses: 0 });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    guard += 1;
  }

  const byMonth = new Map(points.map((p) => [p.month, p]));

  for (const charge of data.rentCharges) {
    const monthKey = charge.charge_month.slice(0, 7);
    const point = byMonth.get(monthKey);
    if (!point) continue;
    const paidForCharge = data.rentInstallments
      .filter((i) => i.rent_charge_id === charge.id && (i.status === 'paid' || i.status === 'partial'))
      .reduce((sum, i) => sum + Number(i.paid_amount ?? 0), 0);
    point.income += paidForCharge;
  }

  for (const expense of data.expenses) {
    const monthKey = expense.expense_date.slice(0, 7);
    const point = byMonth.get(monthKey);
    if (!point) continue;
    point.expenses += Number(expense.amount);
  }

  return points;
}

export function buildTaxExportWorkbook(data: ReportData): Blob {
  const wb = XLSX.utils.book_new();
  const totals = computePortfolioTotals(data);
  const perProperty = computePropertyPerformance(data);
  const categoryTotals = computeExpenseCategoryTotals(data);
  const propertyName = (id: string) => data.properties.find((p) => p.id === id)?.name ?? 'Unknown property';
  const tenantName = (id: string) => data.tenants.find((t) => t.id === id)?.full_name ?? 'Unknown tenant';
  const leaseById = (id: string) => data.leases.find((l) => l.id === id);
  const chargeById = (id: string) => data.rentCharges.find((c) => c.id === id);

  // --- Portfolio Summary ---
  const summarySheet = XLSX.utils.aoa_to_sheet([
    ['PropertyWorks Tax Prep Summary'],
    ['Period', `${data.periodStart} to ${data.periodEnd}`],
    [],
    ['Expected rent', totals.expectedRent],
    ['Recorded income', totals.recordedIncome],
    ['Outstanding / difference', totals.outstanding],
    ['Operating expenses', totals.operatingExpenses],
    ['Net recorded cash', totals.netRecordedCash],
    [],
    ['Expense category totals'],
    ...Object.entries(categoryTotals).map(([cat, amt]) => [cat, amt]),
  ]);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Portfolio Summary');

  // --- Income Ledger (every paid/partial installment in period) ---
  const chargesInPeriod = data.rentCharges.filter((c) => inPeriod(c.charge_month, data.periodStart, data.periodEnd));
  const chargeIdsInPeriod = new Set(chargesInPeriod.map((c) => c.id));
  const incomeRows = data.rentInstallments
    .filter((i) => chargeIdsInPeriod.has(i.rent_charge_id) && (i.status === 'paid' || i.status === 'partial'))
    .map((i) => {
      const charge = chargeById(i.rent_charge_id);
      const lease = charge ? leaseById(charge.lease_id) : undefined;
      const propId = propertyForLease(lease, data.rentalUnits);
      return {
        'Charge month': charge?.charge_month ?? '',
        'Property': propId ? propertyName(propId) : '',
        'Tenant': lease ? tenantName(lease.tenant_id) : '',
        'Portion': i.portion,
        'Payer': i.payer,
        'Due date': i.due_date,
        'Paid date': i.paid_date ?? '',
        'Amount paid': i.paid_amount ?? 0,
        'Status': i.status,
      };
    });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(incomeRows), 'Income Ledger');

  // --- Expense Ledger ---
  const expenseRows = data.expenses
    .filter((e) => inPeriod(e.expense_date, data.periodStart, data.periodEnd))
    .map((e) => ({
      'Date': e.expense_date,
      'Property': propertyName(e.property_id),
      'Category': e.category,
      'Paid by': e.paid_by,
      'Frequency': e.frequency,
      'Vendor / provider': e.vendor ?? '',
      'Amount': Number(e.amount),
      'Description': e.description ?? '',
    }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expenseRows), 'Expense Ledger');

  // --- Property Detail ---
  const propertyRows = perProperty.map((p) => ({
    'Property': p.propertyName,
    'Expected rent': p.expectedRent,
    'Recorded income': p.recordedIncome,
    'Expenses': p.expenses,
    'Net': p.net,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(propertyRows), 'Property Detail');

  const wbArray = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([wbArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function taxExportFileName(): string {
  return `PropertyWorks_Tax_Prep_${new Date().toISOString().slice(0, 10)}.xlsx`;
}
