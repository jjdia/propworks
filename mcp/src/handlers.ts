// Read-only tool handlers for the PropWorks portfolio MCP (issue #17).
// All data access goes through `ReadSource`, which can only SELECT. Business
// logic is imported straight from the web app (#10 payer setup / charge
// status, #15 triage) so totals match what Jeff sees in the app.
import type { Expense, Lease, Property, RentalUnit, RentCharge, RentInstallment, Tenant } from '../../src/lib/types';
import { payerSetupInfo, PAYER_SETUP_LABEL, type PayerSetup } from '../../src/lib/payerSetup';
import { deriveChargeStatus } from '../../src/lib/chargeStatus';
import { balanceTriage, endingLeases } from '../../src/lib/triage';

export const READ_TABLES = ['properties', 'rental_units', 'tenants', 'leases', 'rent_charges', 'rent_installments', 'expenses'] as const;
export type ReadTable = typeof READ_TABLES[number];

export interface RangeFilter { column: string; gte?: string; lte?: string }
/** Select-only data source. RLS on the owner's session scopes the rows. */
export interface ReadSource {
  select(table: ReadTable, range?: RangeFilter): Promise<Record<string, unknown>[]>;
}

export const MAX_ROWS = 200;

function cap<T>(rows: T[], limit?: number) {
  const n = Math.max(1, Math.min(limit ?? MAX_ROWS, MAX_ROWS));
  return { total: rows.length, returned: Math.min(n, rows.length), truncated: rows.length > n, items: rows.slice(0, n) };
}
const live = <T extends { deleted_at?: string | null }>(rows: Record<string, unknown>[]) => (rows as unknown as T[]).filter((r) => !r.deleted_at);
const today = (now: Date) => now.toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;

export function createHandlers(src: ReadSource, now: () => Date = () => new Date()) {
  const load = async <T extends { deleted_at?: string | null }>(t: ReadTable, range?: RangeFilter) => live<T>(await src.select(t, range));

  async function context() {
    const [properties, units, tenants] = await Promise.all([load<Property>('properties'), load<RentalUnit>('rental_units'), load<Tenant>('tenants')]);
    const unit = new Map(units.map((u) => [u.id, u]));
    const prop = new Map(properties.map((p) => [p.id, p]));
    const tenant = new Map(tenants.map((t) => [t.id, t]));
    return {
      label(l: Lease) {
        const u = unit.get(l.rental_unit_id);
        return { tenant: tenant.get(l.tenant_id)?.full_name ?? null, unit: u?.name ?? null, property: u ? prop.get(u.property_id)?.name ?? null : null };
      },
      properties, units,
    };
  }

  function leaseSummary(l: Lease, ctx: Awaited<ReturnType<typeof context>>) {
    const info = payerSetupInfo(l);
    return {
      id: l.id, ...ctx.label(l), status: l.status, lease_start: l.lease_start ?? null, lease_end: l.lease_end ?? null,
      monthly_rent: Number(l.total_monthly_rent), payer_setup: info.setup, payer_setup_label: PAYER_SETUP_LABEL[info.setup],
      gov_program: info.program, gov_portion: l.government_portion ?? null, tenant_portion: l.tenant_portion ?? null,
      needs_review: info.needsReview ? info.reviewReasons : undefined,
    };
  }

  return {
    async list_properties() {
      const ctx = await context();
      return cap(ctx.properties.map((p) => ({
        id: p.id, name: p.name, address: [p.address_line, p.city, p.state, p.zip].filter(Boolean).join(', ') || null,
        units: ctx.units.filter((u) => u.property_id === p.id).map((u) => ({ id: u.id, name: u.name, status: u.status })),
      })));
    },

    async list_leases(a: { active_only?: boolean; ending_within_days?: number; payer_setup?: PayerSetup; limit?: number } = {}) {
      const [ctx, leases] = await Promise.all([context(), load<Lease>('leases')]);
      let rows = leases;
      if (a.active_only ?? true) rows = rows.filter((l) => l.status === 'active');
      if (a.payer_setup) rows = rows.filter((l) => payerSetupInfo(l).setup === a.payer_setup);
      if (a.ending_within_days != null) {
        const ends = new Map(endingLeases(rows, today(now())).map((e) => [e.leaseId, e.daysLeft]));
        rows = rows.filter((l) => ends.has(l.id) && ends.get(l.id)! <= a.ending_within_days!);
      }
      return cap(rows.map((l) => leaseSummary(l, ctx)), a.limit);
    },

    async get_lease(a: { lease_id: string }) {
      const [ctx, leases] = await Promise.all([context(), load<Lease>('leases')]);
      const l = leases.find((x) => x.id === a.lease_id);
      if (!l) return { error: 'Lease not found (or not visible to this account)' };
      const [charges, insts] = await Promise.all([load<RentCharge>('rent_charges'), load<RentInstallment>('rent_installments')]);
      const mine = charges.filter((c) => c.lease_id === l.id).sort((x, y) => y.charge_month.localeCompare(x.charge_month)).slice(0, 12);
      const setup = payerSetupInfo(l).setup;
      return {
        ...leaseSummary(l, ctx), rent_due_day: l.rent_due_day ?? null, security_deposit: l.security_deposit ?? null,
        tenant_payment_method: l.tenant_payment_method ?? null,
        recent_months: mine.map((c) => {
          const r = deriveChargeStatus(c, insts.filter((i) => i.rent_charge_id === c.id), setup);
          return { month: c.charge_month.slice(0, 7), status: r.displayStatus, expected: r.expected, received: r.received, outstanding: r.outstanding, owing: r.owing.map((o) => ({ payer: o.label, amount: o.amount })) };
        }),
      };
    },

    async list_rent_charges(a: { from_month?: string; to_month?: string; status?: string; lease_id?: string; limit?: number } = {}) {
      const range: RangeFilter = { column: 'charge_month', gte: a.from_month ? `${a.from_month.slice(0, 7)}-01` : undefined, lte: a.to_month ? `${a.to_month.slice(0, 7)}-01` : undefined };
      const [ctx, leases, charges, insts] = await Promise.all([context(), load<Lease>('leases'), load<RentCharge>('rent_charges', range), load<RentInstallment>('rent_installments')]);
      const lease = new Map(leases.map((l) => [l.id, l]));
      const rows = charges.filter((c) => (!a.lease_id || c.lease_id === a.lease_id) && lease.has(c.lease_id))
        .sort((x, y) => y.charge_month.localeCompare(x.charge_month))
        .map((c) => {
          const l = lease.get(c.lease_id)!;
          const r = deriveChargeStatus(c, insts.filter((i) => i.rent_charge_id === c.id), payerSetupInfo(l).setup);
          return { id: c.id, lease_id: c.lease_id, ...ctx.label(l), month: c.charge_month.slice(0, 7), status: r.displayStatus, expected: r.expected, received: r.received, outstanding: r.outstanding, owing: r.owing.map((o) => ({ payer: o.label, amount: o.amount })) };
        })
        .filter((x) => !a.status || x.status.toLowerCase() === a.status.toLowerCase());
      return cap(rows, a.limit);
    },

    async get_balances(a: { limit?: number } = {}) {
      const [ctx, leases, charges, insts] = await Promise.all([context(), load<Lease>('leases'), load<RentCharge>('rent_charges'), load<RentInstallment>('rent_installments')]);
      const t = balanceTriage(leases, charges, insts, today(now()));
      const lease = new Map(leases.map((l) => [l.id, l]));
      return {
        as_of: today(now()),
        total_outstanding: t.totalOutstanding,
        by_payer: Object.fromEntries(t.byPayer.map((p) => [p.key, p.amount])) as Record<'gov' | 'tenant' | 'hra', number>,
        leases: cap(t.leases.map((b) => ({ lease_id: b.leaseId, ...ctx.label(lease.get(b.leaseId)!), payer_setup: b.setupLabel, outstanding: b.outstanding, by_payer: b.byPayer, months: b.months.map((m) => m.slice(0, 7)) })), a.limit),
      };
    },

    async list_expenses(a: { from_date?: string; to_date?: string; property_id?: string; limit?: number } = {}) {
      const [ctx, ex] = await Promise.all([context(), load<Expense>('expenses', { column: 'expense_date', gte: a.from_date, lte: a.to_date })]);
      const pname = new Map(ctx.properties.map((p) => [p.id, p.name]));
      const rows = ex.filter((e) => !a.property_id || e.property_id === a.property_id).sort((x, y) => y.expense_date.localeCompare(x.expense_date));
      return { ...cap(rows.map((e) => ({ id: e.id, date: e.expense_date, property: pname.get(e.property_id) ?? null, category: e.category, vendor: e.vendor ?? null, amount: Number(e.amount), paid_by: e.paid_by })), a.limit), total_amount: r2(rows.reduce((s, e) => s + Number(e.amount), 0)) };
    },
  };
}
export type Handlers = ReturnType<typeof createHandlers>;
