import { payerSetup, payerSetupInfo, normalizeProgram, payerLabel, tenantShareFrequency, GOV_PROGRAMS } from '../src/lib/payerSetup';
import type { Lease } from '../src/lib/types';

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`);
  if (cond) pass++; else fail++;
}

type L = Partial<Lease> & Record<string, unknown>;
const info = (l: L) => payerSetupInfo(l as Lease);

// --- setup derivation ---
check('no program → self_pay', payerSetup({} as Lease) === 'self_pay');
check("subsidy_program 'none' → self_pay", payerSetup({ subsidy_program: 'none', tenant_payment_method: 'direct' } as Lease) === 'self_pay');
check("subsidy_program '' → self_pay", info({ subsidy_program: '' as never }).setup === 'self_pay');
check('section8 + direct → gov_tenant', payerSetup({ subsidy_program: 'section8', tenant_payment_method: 'direct' } as Lease) === 'gov_tenant');
check('cityfheps + undefined method → gov_tenant', payerSetup({ subsidy_program: 'cityfheps' } as Lease) === 'gov_tenant');
check('section8 + hra → gov_hra', payerSetup({ subsidy_program: 'section8', tenant_payment_method: 'hra' } as Lease) === 'gov_hra');
check('cityfheps + hra → gov_hra', payerSetup({ subsidy_program: 'cityfheps', tenant_payment_method: 'hra' } as Lease) === 'gov_hra');

// --- legacy / free-text normalisation ---
check("'Section 8' → section8", normalizeProgram('Section 8') === 'section8');
check("'section_8' → section8", normalizeProgram('section_8') === 'section8');
check("'CityFHEPS' → cityfheps", normalizeProgram('CityFHEPS') === 'cityfheps');
check("'City FHEPS' → cityfheps", normalizeProgram('City FHEPS') === 'cityfheps');
check("'HRA' → hra", normalizeProgram('HRA') === 'hra');
check('null → none', normalizeProgram(null) === 'none');
check("'NYCHA' → null (unrecognised)", normalizeProgram('NYCHA') === null);
check("free-text 'Section 8' lease → gov_tenant, no review", (() => { const i = info({ subsidy_program: 'Section 8' as never, tenant_payment_method: 'direct' }); return i.setup === 'gov_tenant' && i.program === 'section8' && !i.needsReview; })());

// --- legacy hra-as-gov flagged, never rewritten ---
{
  const lease = { subsidy_program: 'hra', tenant_payment_method: 'direct' } as Lease;
  const before = JSON.stringify(lease);
  const i = payerSetupInfo(lease);
  check('legacy hra-as-gov is flagged "Review payer setup"', i.needsReview && i.reviewReasons.some((r) => /legacy/.test(r)));
  check('legacy hra-as-gov lease object is not mutated', JSON.stringify(lease) === before);
}
check('unrecognised program flagged for review', info({ subsidy_program: 'NYCHA' as never }).needsReview);
check('no program but HRA tenant share flagged for review', info({ subsidy_program: 'none', tenant_payment_method: 'hra' }).needsReview);
check('HRA is not offered as a gov program', !(GOV_PROGRAMS as string[]).includes('hra'));

// --- HRA proof: warn only ---
check('gov_hra without proof → hraProofMissing', info({ subsidy_program: 'section8', tenant_payment_method: 'hra' }).hraProofMissing);
check('gov_hra with case #, date, doc → proof OK', !info({ subsidy_program: 'section8', tenant_payment_method: 'hra', hra_case_number: 'X1', hra_approved_on: '2026-01-02', hra_proof_document_id: 'doc-1' }).hraProofMissing);
check('gov_tenant never reports HRA proof missing', !info({ subsidy_program: 'section8', tenant_payment_method: 'direct' }).hraProofMissing);

// --- tenant-share frequency defaults (null = payer default) ---
check('HRA + null frequency → twice_monthly', tenantShareFrequency({ tenant_payment_method: 'hra', tenant_payment_frequency: null }) === 'twice_monthly');
check('direct + null frequency → monthly', tenantShareFrequency({ tenant_payment_method: 'direct' }) === 'monthly');
check('HRA + explicit monthly → monthly', tenantShareFrequency({ tenant_payment_method: 'hra', tenant_payment_frequency: 'monthly' }) === 'monthly');
check('direct + explicit twice → twice_monthly', tenantShareFrequency({ tenant_payment_method: 'direct', tenant_payment_frequency: 'twice_monthly' }) === 'twice_monthly');

// --- payerLabel ---
check('gov section8 → "Section 8"', payerLabel({ portion: 'government', payer: 'section8' }) === 'Section 8');
check('gov cityfheps → "CityFHEPS"', payerLabel({ portion: 'government', payer: 'cityfheps' }) === 'CityFHEPS');
check('tenant/tenant → "Tenant"', payerLabel({ portion: 'tenant', payer: 'tenant' }) === 'Tenant');
check('tenant/hra → "HRA (tenant share)" (Notifications mislabel fix)', payerLabel({ portion: 'tenant', payer: 'hra' }) === 'HRA (tenant share)');
check('legacy gov/hra → labelled as legacy', payerLabel({ portion: 'government', payer: 'hra' }) === 'HRA (gov, legacy)');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
