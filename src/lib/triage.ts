import type { Lease, RentCharge, RentInstallment } from './types';
import { deriveChargeStatus, type PayerLineKey } from './chargeStatus';
import { payerSetup, PAYER_SETUP_LABEL } from './payerSetup';

// ---------------------------------------------------------------------------
// Balance + ending-lease triage (issue #15). DERIVED from existing Dexie data
// (leases, rent_charges, rent_installments) using the #10 payer-setup and
// chargeStatus logic. Nothing is stored; no migration. Pure module.
// ---------------------------------------------------------------------------

export interface LeaseBalance {
  leaseId: string;
  tenantId: string;
  setupLabel: string;
  outstanding: number;
  byPayer: Partial<Record<PayerLineKey, number>>;
  /** Months (YYYY-MM-01) with something still owed, oldest first. */
  months: string[];
}

export interface BalanceTriage {
  leases: LeaseBalance[]; // sorted by outstanding desc
  totalOutstanding: number;
  byPayer: { key: PayerLineKey; label: string; amount: number }[];
}

const PAYER_GROUP_LABEL: Record<PayerLineKey, string> = { gov: 'Gov program', tenant: 'Tenant', hra: 'HRA (tenant share)' };
const c = (n: number) => Math.round(n * 100);

/** Owed amounts for charges up to and including `todayIso`'s month. */
export function balanceTriage(
  leases: Lease[], charges: RentCharge[], installments: RentInstallment[], todayIso: string,
): BalanceTriage {
  const thisMonth = todayIso.slice(0, 7) + '-01';
  const instByCharge = new Map<string, RentInstallment[]>();
  for (const i of installments) {
    if (i.deleted_at) continue;
    instByCharge.set(i.rent_charge_id, [...(instByCharge.get(i.rent_charge_id) ?? []), i]);
  }
  const live = leases.filter((l) => !l.deleted_at && l.status !== 'draft');
  const leaseById = new Map(live.map((l) => [l.id, l]));
  const acc = new Map<string, { out: number; by: Map<PayerLineKey, number>; months: Set<string> }>();
  const totals = new Map<PayerLineKey, number>();

  for (const ch of charges) {
    if (ch.deleted_at || ch.charge_month > thisMonth) continue;
    const lease = leaseById.get(ch.lease_id);
    if (!lease) continue;
    const r = deriveChargeStatus(ch, instByCharge.get(ch.id) ?? [], payerSetup(lease));
    if (r.isFull) continue;
    for (const o of r.owing) {
      if (o.amount <= 0) continue;
      const a = acc.get(lease.id) ?? { out: 0, by: new Map(), months: new Set<string>() };
      a.out += c(o.amount);
      a.by.set(o.key, (a.by.get(o.key) ?? 0) + c(o.amount));
      a.months.add(ch.charge_month);
      acc.set(lease.id, a);
      totals.set(o.key, (totals.get(o.key) ?? 0) + c(o.amount));
    }
  }

  const rows: LeaseBalance[] = [...acc.entries()].map(([id, a]) => {
    const l = leaseById.get(id)!;
    return {
      leaseId: id, tenantId: l.tenant_id, setupLabel: PAYER_SETUP_LABEL[payerSetup(l)],
      outstanding: a.out / 100,
      byPayer: Object.fromEntries([...a.by].map(([k, v]) => [k, v / 100])),
      months: [...a.months].sort(),
    };
  }).sort((x, y) => y.outstanding - x.outstanding);

  const order: PayerLineKey[] = ['gov', 'tenant', 'hra'];
  return {
    leases: rows,
    totalOutstanding: [...totals.values()].reduce((s, v) => s + v, 0) / 100,
    byPayer: order.filter((k) => totals.has(k)).map((k) => ({ key: k, label: PAYER_GROUP_LABEL[k], amount: totals.get(k)! / 100 })),
  };
}

export type EndingBucket = 'overdue' | '30' | '60' | '90';
export const ENDING_BUCKET_LABEL: Record<EndingBucket, string> = {
  overdue: 'Already ended (still active)', '30': 'Ends within 30 days', '60': 'Ends in 31–60 days', '90': 'Ends in 61–90 days',
};

export interface EndingLease { leaseId: string; tenantId: string; leaseEnd: string; daysLeft: number; bucket: EndingBucket }

function dayNum(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

/** Active leases whose lease_end falls on/before today+90, bucketed. */
export function endingLeases(leases: Lease[], todayIso: string): EndingLease[] {
  const today = dayNum(todayIso);
  const out: EndingLease[] = [];
  for (const l of leases) {
    if (l.deleted_at || l.status !== 'active' || !l.lease_end) continue;
    const days = dayNum(l.lease_end) - today;
    if (Number.isNaN(days) || days > 90) continue;
    const bucket: EndingBucket = days < 0 ? 'overdue' : days <= 30 ? '30' : days <= 60 ? '60' : '90';
    out.push({ leaseId: l.id, tenantId: l.tenant_id, leaseEnd: l.lease_end, daysLeft: days, bucket });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}
