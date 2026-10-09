import type { ChargeStatus, Lease, RentCharge, RentInstallment } from './types';
import { payerLabel, payerSetup, type PayerSetup } from './payerSetup';

// ---------------------------------------------------------------------------
// Per-payer month status (issue #10).
//
// A month's installments are grouped into PAYER LINES — gov program, tenant,
// HRA (tenant share). Each line has expected (sum of `amount`) and received
// (sum of what was actually paid). A line is met by AMOUNTS, not labels: an
// installment set to "paid" with a short paid_amount still shows as owed.
//
//   nothing received          → keep unknown/due/late (paid/partial fall back to due)
//   something received, short → partial, + who owes what
//   every line met            → self-pay: paid (Full) automatically
//                               gov setups: readyForFull; Jeff taps Mark Full
//                               (an already-Full month stays Full)
//   payment reduced after Full → back to partial, marked_full_at cleared
//   overpaid line              → display-only "Credit $X", no carry-forward
//
// Stored status values don't change ('partial' / 'paid'); the UI shows them
// as "Partial" / "Full".
//
// Pure module (no Dexie/Supabase imports). The two async helpers at the
// bottom take their data access as injected deps so mutations.ts can wire
// them to Dexie and tests can wire them to an in-memory store.
// ---------------------------------------------------------------------------

export type PayerLineKey = 'gov' | 'tenant' | 'hra';

export interface CheckDetail {
  installmentId: string;
  dueDate: string;
  expected: number;
  received: number;
  outstanding: number;
}

export interface PayerLine {
  key: PayerLineKey;
  label: string;
  expected: number;
  received: number;
  outstanding: number;
  credit: number;
  met: boolean;
  checks: CheckDetail[];
}

export interface Owing {
  key: PayerLineKey;
  label: string;
  amount: number;
  /** e.g. "30th check" — only the checks still short. */
  checks: string[];
}

export interface ChargeStatusResult {
  /** Status that should be stored on the rent_charge. */
  status: ChargeStatus;
  /** "Full" / "Partial" / "Due" / "Late" / "Unknown". */
  displayStatus: string;
  lines: PayerLine[];
  expected: number;
  received: number;
  outstanding: number;
  credit: number;
  owing: Owing[];
  /** Every line met, but the month still needs the Mark Full tap (gov setups). */
  readyForFull: boolean;
  isFull: boolean;
  /** e.g. "Partial · HRA (tenant share) owes $500.00 (30th check)". */
  summary: string;
}

export const CHARGE_STATUS_LABEL: Record<ChargeStatus, string> = {
  unknown: 'Unknown',
  due: 'Due',
  late: 'Late',
  partial: 'Partial',
  paid: 'Full',
};

const cents = (n: number | undefined | null) => Math.round(Number(n ?? 0) * 100);
const dollars = (c: number) => c / 100;
export const fmtMoney = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What was actually received on one installment, by amount. */
export function receivedOn(inst: Pick<RentInstallment, 'status' | 'amount' | 'paid_amount'>): number {
  if (inst.status !== 'paid' && inst.status !== 'partial') return 0;
  if (inst.paid_amount != null) return Number(inst.paid_amount);
  return inst.status === 'paid' ? Number(inst.amount) : 0;
}

function lineKey(inst: { portion: RentInstallment['portion']; payer: string }): PayerLineKey {
  if (inst.portion === 'government') return 'gov';
  return inst.payer === 'hra' ? 'hra' : 'tenant';
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const LINE_ORDER: PayerLineKey[] = ['gov', 'tenant', 'hra'];

export function payerLines(installments: RentInstallment[]): PayerLine[] {
  const live = installments.filter((i) => !i.deleted_at);
  const byKey = new Map<PayerLineKey, RentInstallment[]>();
  for (const i of live) {
    const k = lineKey(i);
    byKey.set(k, [...(byKey.get(k) ?? []), i]);
  }
  return LINE_ORDER.filter((k) => byKey.has(k)).map((k) => {
    const insts = [...byKey.get(k)!].sort((a, b) => a.due_date.localeCompare(b.due_date));
    const exp = insts.reduce((s, i) => s + cents(i.amount), 0);
    const rec = insts.reduce((s, i) => s + cents(receivedOn(i)), 0);
    return {
      key: k,
      label: payerLabel(insts[0]),
      expected: dollars(exp),
      received: dollars(rec),
      outstanding: dollars(Math.max(0, exp - rec)),
      credit: dollars(Math.max(0, rec - exp)),
      met: rec >= exp,
      checks: insts.map((i) => {
        const e = cents(i.amount), r = cents(receivedOn(i));
        return { installmentId: i.id, dueDate: i.due_date, expected: dollars(e), received: dollars(r), outstanding: dollars(Math.max(0, e - r)) };
      }),
    };
  });
}

export function deriveChargeStatus(
  charge: Pick<RentCharge, 'status' | 'marked_full_at'>,
  installments: RentInstallment[],
  setup: PayerSetup,
): ChargeStatusResult {
  const lines = payerLines(installments);
  const expC = lines.reduce((s, l) => s + cents(l.expected), 0);
  const recC = lines.reduce((s, l) => s + cents(l.received), 0);
  const outC = lines.reduce((s, l) => s + cents(l.outstanding), 0);
  const creditC = lines.reduce((s, l) => s + cents(l.credit), 0);
  const allMet = lines.length > 0 && lines.every((l) => l.met);

  const owing: Owing[] = lines.filter((l) => !l.met).map((l) => {
    const shortChecks = l.checks.filter((c) => c.outstanding > 0);
    return {
      key: l.key,
      label: l.label,
      amount: l.outstanding,
      checks: l.checks.length > 1 ? shortChecks.map((c) => `${ordinal(Number(c.dueDate.slice(8, 10)))} check`) : [],
    };
  });

  let status: ChargeStatus;
  let readyForFull = false;
  if (lines.length === 0) {
    status = charge.status; // nothing to roll up from
  } else if (recC === 0 && !allMet) {
    status = charge.status === 'paid' || charge.status === 'partial' ? 'due' : charge.status;
  } else if (!allMet) {
    status = 'partial';
  } else if (setup === 'self_pay' || charge.status === 'paid') {
    // Self-pay auto-Fulls; an already-Full gov month (marked, or legacy paid) stays Full.
    status = 'paid';
  } else {
    status = 'partial';
    readyForFull = true;
  }

  const isFull = status === 'paid';
  const parts: string[] = [];
  if (status === 'partial' && !readyForFull) {
    parts.push('Partial');
    for (const o of owing) parts.push(`${o.label} owes ${fmtMoney(o.amount)}${o.checks.length ? ` (${o.checks.join(', ')})` : ''}`);
  } else if (readyForFull) {
    parts.push('Ready for Full');
  } else {
    parts.push(CHARGE_STATUS_LABEL[status]);
  }
  if (creditC > 0) parts.push(`Credit ${fmtMoney(dollars(creditC))}`);

  return {
    status,
    displayStatus: readyForFull ? 'Partial' : CHARGE_STATUS_LABEL[status],
    lines,
    expected: dollars(expC),
    received: dollars(recC),
    outstanding: dollars(outC),
    credit: dollars(creditC),
    owing,
    readyForFull,
    isFull,
    summary: parts.join(' · '),
  };
}

/**
 * The fields a roll-up should write back to the charge, or null if nothing
 * changes. Clears marked_full_at whenever the month is no longer Full.
 */
export function nextChargeFields(
  charge: RentCharge,
  installments: RentInstallment[],
  setup: PayerSetup,
): Pick<RentCharge, 'status' | 'marked_full_at'> | null {
  const r = deriveChargeStatus(charge, installments, setup);
  const marked_full_at = r.status === 'paid' ? (charge.marked_full_at ?? null) : null;
  if (r.status === charge.status && (marked_full_at ?? null) === (charge.marked_full_at ?? null)) return null;
  return { status: r.status, marked_full_at };
}

export type MarkFullPlan =
  | { ok: true; fields: Pick<RentCharge, 'status' | 'marked_full_at'> }
  | { ok: false; reason: string; result: ChargeStatusResult };

/** No early Full: refuses unless every payer line is fully received. */
export function planMarkFull(
  charge: RentCharge,
  installments: RentInstallment[],
  setup: PayerSetup,
  nowIso: string,
): MarkFullPlan {
  const r = deriveChargeStatus(charge, installments, setup);
  if (r.lines.length === 0) return { ok: false, reason: 'No installments for this month', result: r };
  if (r.owing.length > 0) {
    return { ok: false, reason: `Not fully received: ${r.owing.map((o) => `${o.label} owes ${fmtMoney(o.amount)}`).join('; ')}`, result: r };
  }
  return { ok: true, fields: { status: 'paid', marked_full_at: charge.marked_full_at ?? nowIso } };
}

// ----------------------------------------------------------- injected I/O

export interface ChargeRollupDeps {
  getCharge(id: string): Promise<RentCharge | undefined>;
  getInstallments(chargeId: string): Promise<RentInstallment[]>;
  getLease(id: string): Promise<Lease | undefined>;
  saveCharge(charge: RentCharge): Promise<RentCharge>;
}

/**
 * Re-reads the charge and its installments from the store (AFTER the
 * installment save has landed) and writes the rolled-up status. This is the
 * fix for the old one-edit-behind bug, where the roll-up used installments
 * captured at the previous render.
 */
export async function rollUpChargeWith(deps: ChargeRollupDeps, chargeId: string): Promise<RentCharge | undefined> {
  const charge = await deps.getCharge(chargeId);
  if (!charge) return undefined;
  const [insts, lease] = await Promise.all([deps.getInstallments(chargeId), deps.getLease(charge.lease_id)]);
  const setup = lease ? payerSetup(lease) : 'self_pay';
  const fields = nextChargeFields(charge, insts, setup);
  if (!fields) return charge;
  return deps.saveCharge({ ...charge, ...fields });
}

export async function markChargeFullWith(
  deps: ChargeRollupDeps,
  chargeId: string,
  nowIso: string,
): Promise<{ ok: true; charge: RentCharge } | { ok: false; reason: string }> {
  const charge = await deps.getCharge(chargeId);
  if (!charge) return { ok: false, reason: 'Month not found' };
  const [insts, lease] = await Promise.all([deps.getInstallments(chargeId), deps.getLease(charge.lease_id)]);
  const plan = planMarkFull(charge, insts, lease ? payerSetup(lease) : 'self_pay', nowIso);
  if (!plan.ok) return { ok: false, reason: plan.reason };
  return { ok: true, charge: await deps.saveCharge({ ...charge, ...plan.fields }) };
}
