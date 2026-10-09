// Issue #10 PR2: payer-setup form value <-> lease fields.
import { BLANK_SCHEDULE, scheduleFromLease, scheduleToLeaseFields } from '../src/lib/paymentSchedule';
import { payerSetupInfo, tenantShareFrequency } from '../src/lib/payerSetup';
import { buildInstallments } from '../src/lib/installments';
import type { Lease } from '../src/lib/types';

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`);
  if (cond) pass++; else fail++;
}

const base = { id: 'L1', owner_id: 'o', created_at: '', updated_at: '', deleted_at: null, rental_unit_id: 'u', tenant_id: 't', total_monthly_rent: 4000, rent_due_day: 1, status: 'active' } as Lease;
const asLease = (f: ReturnType<typeof scheduleToLeaseFields>) => ({ ...base, ...f }) as Lease;

// self-pay
{
  const f = scheduleToLeaseFields({ ...BLANK_SCHEDULE, tenantPortion: '1500' });
  check('self-pay → subsidy none, direct, freq null', f.subsidy_program === 'none' && f.tenant_payment_method === 'direct' && f.tenant_payment_frequency === null);
  check('self-pay → no gov portion', f.government_portion === undefined);
  check('self-pay derives self_pay', payerSetupInfo(asLease(f)).setup === 'self_pay');
}
// gov + tenant, 2 checks → 1st & 15th
{
  const f = scheduleToLeaseFields({ ...BLANK_SCHEDULE, setup: 'gov_tenant', govProgram: 'section8', govPortion: '3000', tenantPortion: '1000', tenantFrequency: 'twice_monthly' });
  const l = asLease(f);
  check('gov_tenant → section8 + direct + twice', f.subsidy_program === 'section8' && f.tenant_payment_method === 'direct' && f.tenant_payment_frequency === 'twice_monthly');
  const t = buildInstallments('o', 'c', '2026-11-01', l).filter((i) => i.portion === 'tenant');
  check('gov_tenant twice → tenant checks on 1st & 15th', t.length === 2 && t[0].due_date === '2026-11-01' && t[1].due_date === '2026-11-15' && t.every((i) => i.payer === 'tenant'));
}
// gov + tenant, default null → 1 check
{
  const f = scheduleToLeaseFields({ ...BLANK_SCHEDULE, setup: 'gov_tenant', govProgram: 'cityfheps', govPortion: '3000', tenantPortion: '1000' });
  check('gov_tenant default → freq null → monthly', f.tenant_payment_frequency === null && tenantShareFrequency(asLease(f)) === 'monthly');
}
// gov + HRA: locked 15th/30th even if form somehow carries 'monthly'
{
  const f = scheduleToLeaseFields({ ...BLANK_SCHEDULE, setup: 'gov_hra', govProgram: 'section8', govPortion: '3000', tenantPortion: '1000', tenantFrequency: 'monthly', hraCaseNumber: ' 123 ', hraApprovedOn: '2026-09-01' });
  const l = asLease(f);
  check('gov_hra → method hra, freq null (15th/30th)', f.tenant_payment_method === 'hra' && f.tenant_payment_frequency === null);
  const t = buildInstallments('o', 'c', '2026-11-01', l).filter((i) => i.portion === 'tenant');
  check('gov_hra → HRA checks on 15th & 30th', t.length === 2 && t[0].due_date === '2026-11-15' && t[1].due_date === '2026-11-30' && t.every((i) => i.payer === 'hra'));
  check('gov_hra trims case #', f.hra_case_number === '123');
  check('gov_hra no proof doc → proof missing (warn)', payerSetupInfo(l).hraProofMissing === true);
  const f2 = scheduleToLeaseFields({ ...BLANK_SCHEDULE, setup: 'gov_hra', govPortion: '3000', hraCaseNumber: '1', hraApprovedOn: '2026-09-01' }, 'doc-9');
  check('created proof doc id overrides picker', f2.hra_proof_document_id === 'doc-9' && !payerSetupInfo(asLease(f2)).hraProofMissing);
}
// round trip
{
  const l = { ...base, subsidy_program: 'cityfheps', government_portion: 2500, government_payment_frequency: 'twice_monthly', tenant_portion: 500, tenant_payment_method: 'hra', hra_case_number: 'X1', hra_approved_on: '2026-01-02', hra_proof_document_id: 'd1' } as Lease;
  const v = scheduleFromLease(l);
  check('fromLease → gov_hra cityfheps', v.setup === 'gov_hra' && v.govProgram === 'cityfheps' && v.govFrequency === 'twice_monthly');
  const f = scheduleToLeaseFields(v);
  check('round trip keeps fields', f.subsidy_program === 'cityfheps' && f.government_portion === 2500 && f.tenant_portion === 500 && f.hra_case_number === 'X1' && f.hra_proof_document_id === 'd1' && f.tenant_payment_frequency === null);
}
// legacy free text + legacy hra-as-gov are not rewritten
{
  const v = scheduleFromLease({ ...base, subsidy_program: 'Section 8' as never, government_portion: 3000, tenant_payment_method: 'direct' } as Lease);
  check("free-text 'Section 8' shown as section8", v.govProgram === 'section8');
  const v2 = scheduleFromLease({ ...base, subsidy_program: 'hra', government_portion: 3000, tenant_payment_method: 'direct' } as Lease);
  check('legacy hra-as-gov kept raw (flagged in form)', v2.govProgram === 'hra' && v2.setup === 'gov_tenant');
  const f = scheduleToLeaseFields(v2);
  check('legacy hra-as-gov saved unchanged, gov freq stays 15th/30th', f.subsidy_program === 'hra' && f.government_payment_frequency === 'twice_monthly');
}
// existing V28 lease with null new fields → identical installments after a no-op save
{
  const old = { ...base, subsidy_program: 'section8', government_portion: 3000, government_payment_frequency: 'monthly', tenant_portion: 1000, tenant_payment_method: 'hra' } as Lease;
  const resaved = { ...old, ...scheduleToLeaseFields(scheduleFromLease(old)) } as Lease;
  const strip = (l: Lease) => JSON.stringify(buildInstallments('o', 'c', '2026-02-01', l));
  check('no-op save of V28 HRA lease → same installments', strip(old) === strip(resaved));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
