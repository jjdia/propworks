import type { Lease, PaymentFrequency, RentInstallment, SubsidyProgram } from './types';

// ---------------------------------------------------------------------------
// Payer setups (issue #10). The setup is DERIVED from fields a lease already
// has — never stored — so every existing lease falls into a setup
// automatically and nothing is rewritten:
//   self_pay   — no gov program; tenant pays the whole rent
//   gov_tenant — Section 8 / CityFHEPS + tenant pays the tenant share
//   gov_hra    — Section 8 / CityFHEPS + HRA pays the WHOLE tenant share
// HRA is only ever a tenant-share payer. Leases that stored HRA as the gov
// program (legacy) are flagged "Review payer setup", never auto-rewritten.
//
// Pure module, no I/O, so it's unit-testable with tsx.
// ---------------------------------------------------------------------------

export type PayerSetup = 'self_pay' | 'gov_tenant' | 'gov_hra';
export type GovProgram = 'section8' | 'cityfheps';

export const PAYER_SETUP_LABEL: Record<PayerSetup, string> = {
  self_pay: 'Self-pay',
  gov_tenant: 'Gov + tenant',
  gov_hra: 'Gov + HRA',
};

/** Gov programs offered in the UI. HRA is deliberately not one of them. */
export const GOV_PROGRAMS: GovProgram[] = ['section8', 'cityfheps'];

export const PROGRAM_LABEL: Record<string, string> = {
  section8: 'Section 8',
  cityfheps: 'CityFHEPS',
  hra: 'HRA',
  tenant: 'Tenant',
};

/**
 * Normalise a stored subsidy_program (which started life as free text) to a
 * known value. Returns null for non-empty values we don't recognise.
 */
export function normalizeProgram(raw: string | null | undefined): SubsidyProgram | null {
  if (raw == null) return 'none';
  const k = String(raw).toLowerCase().replace(/[\s_\-.]/g, '');
  if (k === '' || k === 'none' || k === 'na' || k === 'n/a' || k === 'selfpay') return 'none';
  if (k === 'section8' || k === 'sec8' || k === 's8' || k === 'hcv' || k === 'housingchoicevoucher') return 'section8';
  if (k === 'cityfheps' || k === 'fheps') return 'cityfheps';
  if (k === 'hra') return 'hra';
  return null;
}

export interface PayerSetupInfo {
  setup: PayerSetup;
  /** Normalised gov program, or null for self-pay / unrecognised. */
  program: SubsidyProgram | null;
  /** True when the lease needs a human look (legacy hra-as-gov, unknown program, …). */
  needsReview: boolean;
  reviewReasons: string[];
  /** Setup 3 with no case #, approved date or proof document. Warn only. */
  hraProofMissing: boolean;
}

export function payerSetupInfo(lease: Pick<Lease, 'subsidy_program' | 'tenant_payment_method' | 'hra_case_number' | 'hra_approved_on' | 'hra_proof_document_id'>): PayerSetupInfo {
  const raw = lease.subsidy_program as string | null | undefined;
  const program = normalizeProgram(raw);
  const reviewReasons: string[] = [];
  const tenantViaHra = lease.tenant_payment_method === 'hra';

  let setup: PayerSetup;
  if (program === 'none') {
    setup = 'self_pay';
    if (tenantViaHra) reviewReasons.push('HRA pays tenant share but no gov program is set');
  } else {
    setup = tenantViaHra ? 'gov_hra' : 'gov_tenant';
    if (program === 'hra') reviewReasons.push('HRA stored as the gov program (legacy)');
    if (program === null) reviewReasons.push(`Unrecognised gov program "${raw}"`);
  }

  const hraProofMissing = setup === 'gov_hra'
    && !(lease.hra_case_number && lease.hra_approved_on && lease.hra_proof_document_id);

  return {
    setup,
    program: program === 'none' ? null : program,
    needsReview: reviewReasons.length > 0,
    reviewReasons,
    hraProofMissing,
  };
}

export function payerSetup(lease: Parameters<typeof payerSetupInfo>[0]): PayerSetup {
  return payerSetupInfo(lease).setup;
}

/**
 * Resolve how many checks the tenant share arrives in. NULL means the
 * payer's default: HRA → twice_monthly (15th/30th), tenant direct → monthly.
 */
export function tenantShareFrequency(lease: Pick<Lease, 'tenant_payment_method' | 'tenant_payment_frequency'>): PaymentFrequency {
  if (lease.tenant_payment_frequency === 'monthly' || lease.tenant_payment_frequency === 'twice_monthly') {
    return lease.tenant_payment_frequency;
  }
  return lease.tenant_payment_method === 'hra' ? 'twice_monthly' : 'monthly';
}

/**
 * One shared label for who pays an installment:
 * "Section 8" / "CityFHEPS" / "Tenant" / "HRA (tenant share)".
 */
export function payerLabel(inst: { portion: RentInstallment['portion']; payer: string }): string {
  if (inst.portion === 'tenant') {
    return inst.payer === 'hra' ? 'HRA (tenant share)' : 'Tenant';
  }
  const p = normalizeProgram(inst.payer as string);
  if (p === 'hra') return 'HRA (gov, legacy)';
  if (p && p !== 'none') return PROGRAM_LABEL[p];
  return String(inst.payer || 'Gov');
}
