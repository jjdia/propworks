import type { Lease, PaymentFrequency, SubsidyProgram, TenantPaymentMethod } from './types';
import { normalizeProgram, payerSetupInfo, type PayerSetup } from './payerSetup';

// Form value <-> lease fields for the payer-setup form (issue #10).
// Pure module so it can be unit-tested with tsx (scripts/payment-schedule-test.ts).

export interface PaymentScheduleValue {
  setup: PayerSetup;
  /** Raw program value. Normally section8/cityfheps; may hold a legacy value. */
  govProgram: string;
  govPortion: string;
  govFrequency: PaymentFrequency;
  tenantPortion: string;
  /** Explicit tenant-share frequency; null = payer default. */
  tenantFrequency: PaymentFrequency | null;
  hraCaseNumber: string;
  hraApprovedOn: string;
  hraProofDocumentId: string;
  /** Optional: create a new proof note in Documents with this title on save. */
  hraProofNewTitle: string;
}

export const BLANK_SCHEDULE: PaymentScheduleValue = {
  setup: 'self_pay', govProgram: 'section8', govPortion: '', govFrequency: 'monthly',
  tenantPortion: '', tenantFrequency: null,
  hraCaseNumber: '', hraApprovedOn: '', hraProofDocumentId: '', hraProofNewTitle: '',
};

export function scheduleFromLease(l: Lease): PaymentScheduleValue {
  const info = payerSetupInfo(l);
  const raw = (l.subsidy_program as string | undefined) ?? 'none';
  return {
    setup: info.setup,
    // Recognised free text ('Section 8') is shown as the canonical value;
    // legacy 'hra' / unrecognised text stays raw so the form flags it.
    govProgram: info.setup === 'self_pay'
      ? 'section8'
      : (info.program === 'section8' || info.program === 'cityfheps' ? info.program : raw),
    govPortion: l.government_portion ? String(l.government_portion) : '',
    govFrequency: (l.government_payment_frequency as PaymentFrequency) ?? 'monthly',
    tenantPortion: l.tenant_portion ? String(l.tenant_portion) : String(l.total_monthly_rent ?? ''),
    tenantFrequency: l.tenant_payment_frequency ?? null,
    hraCaseNumber: l.hra_case_number ?? '',
    hraApprovedOn: l.hra_approved_on ?? '',
    hraProofDocumentId: l.hra_proof_document_id ?? '',
    hraProofNewTitle: '',
  };
}

/**
 * Lease fields for a schedule value. `proofDocumentId` overrides the picked
 * doc (used when the modal just created a new proof note).
 */
export function scheduleToLeaseFields(v: PaymentScheduleValue, proofDocumentId?: string) {
  const gov = v.setup !== 'self_pay';
  const hra = v.setup === 'gov_hra';
  const legacyHraGov = normalizeProgram(v.govProgram) === 'hra';
  const fields: Pick<Lease,
    'subsidy_program' | 'government_portion' | 'government_payment_frequency' | 'tenant_portion'
    | 'tenant_payment_method' | 'tenant_payment_frequency' | 'hra_case_number' | 'hra_approved_on' | 'hra_proof_document_id'> = {
    subsidy_program: (gov ? v.govProgram : 'none') as SubsidyProgram,
    government_portion: gov && v.govPortion ? Number(v.govPortion) : undefined,
    government_payment_frequency: legacyHraGov ? 'twice_monthly' : v.govFrequency,
    tenant_portion: v.tenantPortion ? Number(v.tenantPortion) : undefined,
    tenant_payment_method: (hra ? 'hra' : 'direct') as TenantPaymentMethod,
    // Self-pay: one check on the due day. HRA: locked to 15th/30th (null =
    // the HRA default). Gov + tenant: explicit choice, or null = 1 check.
    tenant_payment_frequency: v.setup === 'gov_tenant' ? v.tenantFrequency : null,
    // HRA proof is only meaningful on setup 3; keep what's stored otherwise
    // so flipping setups back and forth never loses it.
    hra_case_number: v.hraCaseNumber.trim() || null,
    hra_approved_on: v.hraApprovedOn || null,
    hra_proof_document_id: proofDocumentId ?? (v.hraProofDocumentId || null),
  };
  return fields;
}

