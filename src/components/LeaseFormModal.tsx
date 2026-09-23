import { useState } from 'react';
import type { Lease, LeaseStatus, SubsidyProgram, PaymentFrequency, TenantPaymentMethod } from '../lib/types';
import { saveLease } from '../lib/mutations';
import { PaymentScheduleFields, type PaymentScheduleValue } from './PaymentScheduleFields';

export function LeaseFormModal({ existing, onClose }: { existing: Lease; onClose: () => void }) {
  const [rent, setRent] = useState(String(existing.total_monthly_rent));
  const [dueDay, setDueDay] = useState(String(existing.rent_due_day ?? 1));
  const [leaseStart, setLeaseStart] = useState(existing.lease_start ?? '');
  const [leaseEnd, setLeaseEnd] = useState(existing.lease_end ?? '');
  const [schedule, setSchedule] = useState<PaymentScheduleValue>({
    subsidyProgram: (existing.subsidy_program as SubsidyProgram) ?? 'none',
    govPortion: existing.government_portion ? String(existing.government_portion) : '',
    govFrequency: (existing.government_payment_frequency as PaymentFrequency) ?? 'monthly',
    tenantPortion: existing.tenant_portion ? String(existing.tenant_portion) : String(existing.total_monthly_rent),
    tenantMethod: (existing.tenant_payment_method as TenantPaymentMethod) ?? 'direct',
  });
  const [deposit, setDeposit] = useState(existing.security_deposit ? String(existing.security_deposit) : '');
  const [status, setStatus] = useState<LeaseStatus>(existing.status);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!rent) return;
    setSaving(true);
    await saveLease({
      ...existing,
      total_monthly_rent: Number(rent),
      rent_due_day: Number(dueDay) || 1,
      lease_start: leaseStart || undefined,
      lease_end: leaseEnd || undefined,
      subsidy_program: schedule.subsidyProgram,
      government_portion: schedule.subsidyProgram !== 'none' && schedule.govPortion ? Number(schedule.govPortion) : undefined,
      government_payment_frequency: schedule.subsidyProgram === 'hra' ? 'twice_monthly' : schedule.govFrequency,
      tenant_portion: schedule.tenantPortion ? Number(schedule.tenantPortion) : undefined,
      tenant_payment_method: schedule.subsidyProgram !== 'none' ? schedule.tenantMethod : 'direct',
      security_deposit: deposit ? Number(deposit) : undefined,
      status,
    });
    setSaving(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold">Edit lease</h2>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Monthly rent"><input type="number" step="0.01" className={inputCls} value={rent} onChange={(e) => setRent(e.target.value)} /></Field>
          <Field label="Due day"><input type="number" min="1" max="28" className={inputCls} value={dueDay} onChange={(e) => setDueDay(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Lease start"><input type="date" className={inputCls} value={leaseStart} onChange={(e) => setLeaseStart(e.target.value)} /></Field>
          <Field label="Lease end"><input type="date" className={inputCls} value={leaseEnd} onChange={(e) => setLeaseEnd(e.target.value)} /></Field>
        </div>

        <PaymentScheduleFields value={schedule} onChange={setSchedule} />

        <Field label="Security deposit"><input type="number" step="0.01" className={inputCls} value={deposit} onChange={(e) => setDeposit(e.target.value)} /></Field>
        <Field label="Status">
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as LeaseStatus)}>
            <option value="active">Active</option>
            <option value="ended">Ended</option>
            <option value="draft">Draft</option>
          </select>
        </Field>
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm">Cancel</button>
          <button onClick={handleSave} disabled={saving || !rent} className="flex-1 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2 text-sm font-medium">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500';
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-slate-400 text-xs">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
