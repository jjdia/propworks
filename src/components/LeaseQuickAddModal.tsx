import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { saveRentalUnit, saveTenant, saveLease, saveRentCharge, saveRentInstallment, buildInstallments, blankMeta } from '../lib/mutations';
import { useAppStore } from '../store/useAppStore';
import { PaymentScheduleFields, type PaymentScheduleValue } from './PaymentScheduleFields';
import type { RentalUnit } from '../lib/types';

const NEW_UNIT = '__new__';

// Deliberately combines rental_unit + tenant + lease + first rent_charge
// into one flow. The underlying schema keeps them as separate normalized
// tables (so editing a tenant later doesn't touch the lease, etc.), but the
// old app's UX lesson was that owners want to enter this once, not hop
// across four separate screens for a single new tenant.
export function LeaseQuickAddModal({ onClose }: { onClose: () => void }) {
  const ownerId = useAppStore((s) => s.ownerId) ?? 'local-owner';
  const properties = useLiveQuery(() => db.properties.filter((p) => !p.deleted_at).sortBy('name'), []);

  const [propertyId, setPropertyId] = useState('');
  const effectivePropertyId = propertyId || properties?.[0]?.id || '';

  const unitsForProperty = useLiveQuery<RentalUnit[]>(
    () => effectivePropertyId
      ? db.rental_units.filter((u) => !u.deleted_at && u.property_id === effectivePropertyId).toArray()
      : Promise.resolve([]),
    [effectivePropertyId],
  );

  const [unitChoice, setUnitChoice] = useState(NEW_UNIT);
  const [newUnitName, setNewUnitName] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [rent, setRent] = useState('');
  const [dueDay, setDueDay] = useState('1');
  const [leaseStart, setLeaseStart] = useState(new Date().toISOString().slice(0, 10));
  const [schedule, setSchedule] = useState<PaymentScheduleValue>({
    subsidyProgram: 'none', govPortion: '', govFrequency: 'monthly', tenantPortion: '', tenantMethod: 'direct',
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const unitNameToUse = unitChoice === NEW_UNIT ? newUnitName.trim() : unitsForProperty?.find((u) => u.id === unitChoice)?.name;
    if (!effectivePropertyId || !unitNameToUse || !tenantName.trim() || !rent) return;
    setSaving(true);

    const unit = unitChoice === NEW_UNIT
      ? await saveRentalUnit({
          ...blankMeta(ownerId), property_id: effectivePropertyId, name: newUnitName.trim(),
          unit_kind: 'apartment', status: 'occupied',
        })
      : await saveRentalUnit({ ...(unitsForProperty!.find((u) => u.id === unitChoice)!), status: 'occupied' });

    const tenant = await saveTenant({
      ...blankMeta(ownerId), full_name: tenantName.trim(),
      phone: phone.trim() || undefined, email: email.trim() || undefined,
    });

    const tenantPortionValue = schedule.tenantPortion ? Number(schedule.tenantPortion) : Number(rent);
    const lease = await saveLease({
      ...blankMeta(ownerId),
      rental_unit_id: unit.id,
      tenant_id: tenant.id,
      lease_start: leaseStart,
      total_monthly_rent: Number(rent),
      subsidy_program: schedule.subsidyProgram,
      government_portion: schedule.subsidyProgram !== 'none' && schedule.govPortion ? Number(schedule.govPortion) : undefined,
      government_payment_frequency: schedule.subsidyProgram === 'hra' ? 'twice_monthly' : schedule.govFrequency,
      tenant_portion: tenantPortionValue,
      tenant_payment_method: schedule.subsidyProgram !== 'none' ? schedule.tenantMethod : 'direct',
      rent_due_day: Number(dueDay) || 1,
      status: 'active',
    });

    const chargeMonth = `${new Date().toISOString().slice(0, 7)}-01`;
    const charge = await saveRentCharge({
      ...blankMeta(ownerId),
      lease_id: lease.id,
      charge_month: chargeMonth,
      total_rent: Number(rent),
      government_portion: lease.government_portion,
      tenant_portion: lease.tenant_portion,
      status: 'unknown',
    });

    for (const installment of buildInstallments(ownerId, charge.id, chargeMonth, lease)) {
      await saveRentInstallment({ ...blankMeta(ownerId), ...installment });
    }

    setSaving(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold">Add tenant &amp; lease</h2>

        {!properties?.length ? (
          <p className="text-sm text-amber-300">Add a property first.</p>
        ) : (
          <>
            <Field label="Property">
              <select className={inputCls} value={effectivePropertyId} onChange={(e) => { setPropertyId(e.target.value); setUnitChoice(NEW_UNIT); }}>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Unit">
              <select className={inputCls} value={unitChoice} onChange={(e) => setUnitChoice(e.target.value)}>
                <option value={NEW_UNIT}>+ New unit…</option>
                {unitsForProperty?.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.unit_kind})</option>)}
              </select>
            </Field>
            {unitChoice === NEW_UNIT && (
              <Field label="New unit name"><input className={inputCls} value={newUnitName} onChange={(e) => setNewUnitName(e.target.value)} placeholder="Unit 1" /></Field>
            )}
            <Field label="Tenant name"><input className={inputCls} value={tenantName} onChange={(e) => setTenantName(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Phone"><input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
              <Field label="Email"><input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Total monthly rent">
                <input type="number" step="0.01" className={inputCls} value={rent} onChange={(e) => setRent(e.target.value)} placeholder="0.00" />
              </Field>
              <Field label="Due day"><input type="number" min="1" max="28" className={inputCls} value={dueDay} onChange={(e) => setDueDay(e.target.value)} /></Field>
            </div>
            <Field label="Lease start"><input type="date" className={inputCls} value={leaseStart} onChange={(e) => setLeaseStart(e.target.value)} /></Field>

            <PaymentScheduleFields value={schedule} onChange={setSchedule} />
          </>
        )}

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || !properties?.length || !tenantName.trim() || !rent}
            className="flex-1 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2 text-sm font-medium"
          >
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
