import type { SubsidyProgram, PaymentFrequency, TenantPaymentMethod } from '../lib/types';

const inputCls = 'w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-slate-400 text-xs">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

export interface PaymentScheduleValue {
  subsidyProgram: SubsidyProgram;
  govPortion: string;
  govFrequency: PaymentFrequency;
  tenantPortion: string;
  tenantMethod: TenantPaymentMethod;
}

// HRA always runs on the 15th/30th schedule in practice, so we force and
// lock that choice whenever HRA is selected as the government payer — it's
// only a real choice for CityFHEPS, which genuinely varies per tenant.
export function PaymentScheduleFields({ value, onChange }: {
  value: PaymentScheduleValue;
  onChange: (next: PaymentScheduleValue) => void;
}) {
  const { subsidyProgram, govPortion, govFrequency, tenantPortion, tenantMethod } = value;
  const govFrequencyLocked = subsidyProgram === 'hra';
  const effectiveGovFrequency = govFrequencyLocked ? 'twice_monthly' : govFrequency;

  return (
    <>
      <Field label="Government / subsidy program">
        <select
          className={inputCls}
          value={subsidyProgram}
          onChange={(e) => onChange({ ...value, subsidyProgram: e.target.value as SubsidyProgram })}
        >
          <option value="none">None — tenant pays full rent</option>
          <option value="section8">Section 8</option>
          <option value="cityfheps">CityFHEPS</option>
          <option value="hra">HRA</option>
        </select>
      </Field>

      {subsidyProgram !== 'none' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Government portion ($/mo)">
            <input type="number" step="0.01" className={inputCls} value={govPortion} onChange={(e) => onChange({ ...value, govPortion: e.target.value })} />
          </Field>
          <Field label="Government payment schedule">
            <select
              className={inputCls}
              value={effectiveGovFrequency}
              disabled={govFrequencyLocked}
              onChange={(e) => onChange({ ...value, govFrequency: e.target.value as PaymentFrequency })}
            >
              <option value="monthly">Monthly</option>
              <option value="twice_monthly">Twice a month (15th &amp; 30th)</option>
            </select>
          </Field>
          {govFrequencyLocked && <p className="text-[11px] text-slate-500 -mt-2 col-span-2">HRA always pays on the 15th and 30th.</p>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Field label={subsidyProgram === 'none' ? 'Monthly rent (tenant pays)' : 'Tenant portion ($/mo)'}>
          <input type="number" step="0.01" className={inputCls} value={tenantPortion} onChange={(e) => onChange({ ...value, tenantPortion: e.target.value })} />
        </Field>
        {subsidyProgram !== 'none' && (
          <Field label="Tenant portion paid via">
            <select
              className={inputCls}
              value={tenantMethod}
              onChange={(e) => onChange({ ...value, tenantMethod: e.target.value as TenantPaymentMethod })}
            >
              <option value="direct">Tenant pays directly</option>
              <option value="hra">Paid through HRA</option>
            </select>
          </Field>
        )}
      </div>
      {tenantMethod === 'hra' && subsidyProgram !== 'none' && (
        <p className="text-[11px] text-slate-500 -mt-2">HRA-paid tenant portions are also split across the 15th and 30th.</p>
      )}
    </>
  );
}
