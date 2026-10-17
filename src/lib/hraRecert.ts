import type { Lease, Tenant } from './types';
import { payerSetup } from './payerSetup';

// ---------------------------------------------------------------------------
// Yearly HRA recertification reminders (V 34). PURE, shared with the
// push-reminders Edge Function.
//   recert due = leases.hra_recert_due_on, or hra_approved_on + 1 year.
//   Only ACTIVE gov + HRA (setup 3) leases. Owners only (Jeff + Lana).
//   Pushes at 30 days and 7 days before. Each stage is deduped per lease and
//   due date, and a missed cron day still sends on the next run (window, not
//   exact day). Overdue shows in-app until the dates are updated.
// ---------------------------------------------------------------------------

export type RecertStatus = 'overdue' | 'due_7' | 'due_30' | 'ok' | 'unknown';
export const RECERT_STAGES = [30, 7] as const;

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD + 1 year; Feb 29 → Feb 28. */
export function addOneYear(date: string): string {
  const y = Number(date.slice(0, 4)) + 1, m = Number(date.slice(5, 7)), d = Number(date.slice(8, 10));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad(m)}-${pad(Math.min(d, last))}`;
}

const days = (a: string, b: string) =>
  Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);

type RecertLease = Pick<Lease, 'id' | 'tenant_id' | 'status' | 'deleted_at' | 'subsidy_program' | 'tenant_payment_method' | 'hra_case_number' | 'hra_approved_on' | 'hra_proof_document_id' | 'hra_recert_due_on'>;

export function recertDueDate(lease: Pick<Lease, 'hra_recert_due_on' | 'hra_approved_on'>): { date: string | null; source: 'explicit' | 'approved_plus_1y' | null } {
  if (lease.hra_recert_due_on) return { date: lease.hra_recert_due_on, source: 'explicit' };
  if (lease.hra_approved_on) return { date: addOneYear(lease.hra_approved_on), source: 'approved_plus_1y' };
  return { date: null, source: null };
}

export interface RecertItem {
  leaseId: string;
  tenantId: string;
  tenantName: string;
  dueDate: string | null;
  source: 'explicit' | 'approved_plus_1y' | null;
  daysUntil: number | null;
  status: RecertStatus;
}

export function isHraLease(l: RecertLease) {
  return !l.deleted_at && l.status === 'active' && payerSetup(l) === 'gov_hra';
}

export function recertStatus(lease: RecertLease, today: string, tenantName = 'Tenant'): RecertItem {
  const { date, source } = recertDueDate(lease);
  const base = { leaseId: lease.id, tenantId: lease.tenant_id, tenantName, dueDate: date, source };
  if (!date) return { ...base, daysUntil: null, status: 'unknown' };
  const d = days(today, date);
  return { ...base, daysUntil: d, status: d < 0 ? 'overdue' : d <= 7 ? 'due_7' : d <= 30 ? 'due_30' : 'ok' };
}

/** In-app list: every active HRA lease that is overdue, due within 30 days, or missing dates. */
export function recertItems(leases: RecertLease[], tenants: Pick<Tenant, 'id' | 'full_name'>[], today: string): RecertItem[] {
  return leases
    .filter(isHraLease)
    .map((l) => recertStatus(l, today, tenants.find((t) => t.id === l.tenant_id)?.full_name))
    .filter((i) => i.status !== 'ok')
    .sort((a, b) => (a.daysUntil ?? 9999) - (b.daysUntil ?? 9999));
}

export function recertDedupeKey(leaseId: string, dueDate: string, stage: number) {
  return `hra_recert:${leaseId}:${dueDate}:${stage}`;
}

/** Owner pushes due today: the tightest stage whose window we're in (≤30 → 30, ≤7 → 7). */
export function recertPushes(leases: RecertLease[], tenants: Pick<Tenant, 'id' | 'full_name'>[], today: string) {
  const out: { item: RecertItem; stage: number; dedupeKey: string; title: string; body: string }[] = [];
  for (const item of recertItems(leases, tenants, today)) {
    if (item.daysUntil == null || item.daysUntil < 0 || !item.dueDate) continue;
    const stage = item.daysUntil <= 7 ? 7 : item.daysUntil <= 30 ? 30 : null;
    if (!stage) continue;
    out.push({
      item, stage,
      dedupeKey: recertDedupeKey(item.leaseId, item.dueDate, stage),
      title: `HRA recert due in ${item.daysUntil} day${item.daysUntil === 1 ? '' : 's'}`,
      body: `${item.tenantName}: yearly HRA recertification due ${item.dueDate}${item.source === 'approved_plus_1y' ? ' (approved date + 1 year)' : ''}.`,
    });
  }
  return out;
}
