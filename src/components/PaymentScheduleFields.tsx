import type { PaymentFrequency } from '../lib/types';
import { GOV_PROGRAMS, PAYER_SETUP_LABEL, PROGRAM_LABEL, normalizeProgram, type PayerSetup } from '../lib/payerSetup';
import type { PaymentScheduleValue } from '../lib/paymentSchedule';
export type { PaymentScheduleValue } from '../lib/paymentSchedule';

const inputCls = 'w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-slate-400 text-xs">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Payer setup (issue #10). Three setups, derived — never stored:
//   1. Self-pay      — tenant pays the whole rent, one check on the due day
//   2. Gov + tenant  — Section 8 / CityFHEPS + tenant pays the tenant share
//                      (1 check on the due day, or 2: 1st & 15th)
//   3. Gov + HRA     — Section 8 / CityFHEPS + HRA pays the WHOLE tenant
//                      share, locked to 15th & 30th; HRA proof fields
//                      (case #, approved date, proof doc) warn, never block.
// HRA is not offered as a gov program. Legacy leases that stored HRA (or
// unrecognised free text) as the program keep that value until Jeff picks
// a real program, and get a "Review payer setup" prompt.
// ---------------------------------------------------------------------------

export interface ProofDocOption { id: string; title: string }

export function PaymentScheduleFields({ value, onChange, proofDocuments = [] }: {
  value: PaymentScheduleValue;
  onChange: (next: PaymentScheduleValue) => void;
  proofDocuments?: ProofDocOption[];
}) {
  const v = value;
  const set = (patch: Partial<PaymentScheduleValue>) => onChange({ ...v, ...patch });
  const gov = v.setup !== 'self_pay';
  const normalized = normalizeProgram(v.govProgram);
  const legacyProgram = gov && !(GOV_PROGRAMS as string[]).includes(v.govProgram);
  const govFrequencyLocked = normalized === 'hra';
  const effectiveGovFrequency = govFrequencyLocked ? 'twice_monthly' : v.govFrequency;
  const tenantFreq: PaymentFrequency = v.tenantFrequency ?? 'monthly';
  const proofMissing = v.setup === 'gov_hra'
    && !(v.hraCaseNumber.trim() && v.hraApprovedOn && (v.hraProofDocumentId || v.hraProofNewTitle.trim()));

  return (
    <>
      <div className="block text-sm">
        <span className="text-slate-400 text-xs">Payer setup</span>
        <div className="mt-1 grid grid-cols-3 gap-1" role="radiogroup">
          {(['self_pay', 'gov_tenant', 'gov_hra'] as PayerSetup[]).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={v.setup === s}
              onClick={() => set({ setup: s })}
              className={`rounded-md px-2 py-2 text-xs border ${v.setup === s ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}
            >
              {PAYER_SETUP_LABEL[s]}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-500 mt-1">
          {v.setup === 'self_pay' && 'Tenant pays the whole rent.'}
          {v.setup === 'gov_tenant' && 'Section 8 / CityFHEPS pays its portion; the tenant pays their share.'}
          {v.setup === 'gov_hra' && 'Section 8 / CityFHEPS pays its portion; HRA pays the whole tenant share.'}
        </p>
      </div>

      {gov && (
        <>
          {legacyProgram && (
            <p className="text-[11px] text-amber-300 bg-amber-950/40 border border-amber-900 rounded-md px-2 py-1.5">
              Review payer setup: this lease stores “{normalized === 'hra' ? 'HRA' : v.govProgram}” as the gov program.
              HRA now only pays the tenant share — pick Section 8 or CityFHEPS{normalized === 'hra' ? ' and choose “Gov + HRA” if HRA pays the tenant share' : ''}.
              Nothing changes until you save.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Gov program">
              <select className={inputCls} value={v.govProgram} onChange={(e) => set({ govProgram: e.target.value })}>
                {GOV_PROGRAMS.map((p) => <option key={p} value={p}>{PROGRAM_LABEL[p]}</option>)}
                {legacyProgram && <option value={v.govProgram}>{normalized === 'hra' ? 'HRA (legacy)' : v.govProgram} — review</option>}
              </select>
            </Field>
            <Field label="Gov portion ($/mo)">
              <input type="number" step="0.01" className={inputCls} value={v.govPortion} onChange={(e) => set({ govPortion: e.target.value })} />
            </Field>
          </div>
          <Field label="Gov payment schedule">
            <select
              className={inputCls}
              value={effectiveGovFrequency}
              disabled={govFrequencyLocked}
              onChange={(e) => set({ govFrequency: e.target.value as PaymentFrequency })}
            >
              <option value="monthly">Monthly (due day)</option>
              <option value="twice_monthly">Twice a month (15th &amp; 30th)</option>
            </select>
          </Field>
        </>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Field label={v.setup === 'self_pay' ? 'Monthly rent (tenant pays)' : v.setup === 'gov_hra' ? 'HRA (tenant share) $/mo' : 'Tenant share ($/mo)'}>
          <input type="number" step="0.01" className={inputCls} value={v.tenantPortion} onChange={(e) => set({ tenantPortion: e.target.value })} />
        </Field>
        {v.setup === 'gov_tenant' && (
          <Field label="Tenant share checks">
            <select className={inputCls} value={tenantFreq} onChange={(e) => set({ tenantFrequency: e.target.value as PaymentFrequency })}>
              <option value="monthly">1 check (due day)</option>
              <option value="twice_monthly">2 checks (1st &amp; 15th)</option>
            </select>
          </Field>
        )}
        {v.setup === 'gov_hra' && (
          <Field label="HRA (tenant share) checks">
            <select className={inputCls} value="twice_monthly" disabled>
              <option value="twice_monthly">2 checks (15th &amp; 30th)</option>
            </select>
          </Field>
        )}
      </div>
      {v.setup === 'gov_hra' && (
        <p className="text-[11px] text-slate-500 -mt-2">HRA pays the tenant share on the 15th and 30th (30th → last day in shorter months).</p>
      )}

      {v.setup === 'gov_hra' && (
        <div className="space-y-2 border border-slate-800 rounded-lg p-2">
          <div className="text-xs text-slate-400">HRA proof</div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="HRA case #">
              <input className={inputCls} value={v.hraCaseNumber} onChange={(e) => set({ hraCaseNumber: e.target.value })} />
            </Field>
            <Field label="Approved date">
              <input type="date" className={inputCls} value={v.hraApprovedOn} onChange={(e) => set({ hraApprovedOn: e.target.value })} />
            </Field>
          </div>
          <Field label="Proof document">
            <select className={inputCls} value={v.hraProofDocumentId} onChange={(e) => set({ hraProofDocumentId: e.target.value })}>
              <option value="">— None / add a new note below —</option>
              {proofDocuments.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              {v.hraProofDocumentId && !proofDocuments.some((d) => d.id === v.hraProofDocumentId) && (
                <option value={v.hraProofDocumentId}>(linked document)</option>
              )}
            </select>
          </Field>
          {!v.hraProofDocumentId && (
            <Field label="…or save a new proof note to Documents (title)">
              <input className={inputCls} value={v.hraProofNewTitle} placeholder="e.g. HRA approval letter 2026" onChange={(e) => set({ hraProofNewTitle: e.target.value })} />
            </Field>
          )}
          {proofMissing && (
            <p className="text-[11px] text-amber-300">HRA proof missing — you can still save; the tenant will show an “HRA proof missing” chip until it's filled in.</p>
          )}
        </div>
      )}
    </>
  );
}
