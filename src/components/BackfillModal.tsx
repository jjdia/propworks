import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { saveRentCharge, saveRentInstallment, buildInstallments, blankMeta } from '../lib/mutations';
import { useAppStore } from '../store/useAppStore';

// Historical backfill: generate one rent_charge (+ its installments) per
// month in the chosen range, for however many leases are selected at once.
// Months that already have a charge are skipped — this can be re-run
// safely without duplicating anything. Status is the owner's choice:
// "Unknown" (review later, nothing assumed) for genuinely uncertain
// history, or "Paid" for a bulk catch-up entry when the owner already
// knows those months were paid on time and just hasn't logged them yet —
// either way it beats forcing a month-by-month, lease-by-lease loop.
function monthsBetween(startMonth: string, endMonth: string): string[] {
  const months: string[] = [];
  let [y, m] = startMonth.split('-').map(Number);
  const [endY, endM] = endMonth.split('-').map(Number);
  while (y < endY || (y === endY && m <= endM)) {
    months.push(`${y}-${String(m).padStart(2, '0')}-01`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return months;
}

export function BackfillModal({ onClose }: { onClose: () => void }) {
  const ownerId = useAppStore((s) => s.ownerId) ?? 'local-owner';
  const leases = useLiveQuery(() => db.leases.filter((l) => !l.deleted_at && l.status === 'active').toArray(), []);
  const tenants = useLiveQuery(() => db.tenants.toArray(), []);
  const units = useLiveQuery(() => db.rental_units.toArray(), []);
  const properties = useLiveQuery(() => db.properties.toArray(), []);
  const existingCharges = useLiveQuery(() => db.rent_charges.filter((c) => !c.deleted_at).toArray(), []);

  const [selectedLeaseIds, setSelectedLeaseIds] = useState<string[]>([]);
  const [startMonth, setStartMonth] = useState('2026-01');
  const [endMonth, setEndMonth] = useState(new Date().toISOString().slice(0, 7));
  const [status, setStatus] = useState<'unknown' | 'paid'>('unknown');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number; leaseCount: number } | null>(null);

  const tenantName = (id: string) => tenants?.find((t) => t.id === id)?.full_name ?? 'Unknown tenant';
  const propertyLabel = (leaseUnitId: string) => {
    const unit = units?.find((u) => u.id === leaseUnitId);
    const property = properties?.find((p) => p.id === unit?.property_id);
    return [property?.name, unit?.name].filter(Boolean).join(' — ');
  };

  function toggleLease(id: string) {
    setSelectedLeaseIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }
  function toggleAll() {
    if (!leases) return;
    setSelectedLeaseIds((prev) => prev.length === leases.length ? [] : leases.map((l) => l.id));
  }

  async function handleBackfill() {
    if (selectedLeaseIds.length === 0) return;
    setSaving(true);
    let created = 0, skipped = 0;
    const months = monthsBetween(`${startMonth}-01`, `${endMonth}-01`);

    for (const leaseId of selectedLeaseIds) {
      const lease = leases?.find((l) => l.id === leaseId);
      if (!lease) continue;
      for (const chargeMonth of months) {
        const already = existingCharges?.some((c) => c.lease_id === lease.id && c.charge_month === chargeMonth);
        if (already) { skipped++; continue; }
        const charge = await saveRentCharge({
          ...blankMeta(ownerId),
          lease_id: lease.id,
          charge_month: chargeMonth,
          total_rent: lease.total_monthly_rent,
          government_portion: lease.government_portion,
          tenant_portion: lease.tenant_portion,
          status,
        });
        for (const installment of buildInstallments(ownerId, charge.id, chargeMonth, lease, status)) {
          await saveRentInstallment({ ...blankMeta(ownerId), ...installment });
        }
        created++;
      }
    }
    setSaving(false);
    setResult({ created, skipped, leaseCount: selectedLeaseIds.length });
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold">Backfill rent history</h2>
        <p className="text-xs text-slate-400">
          Creates a monthly charge (and its payment schedule) for every month in the range, for every tenant you select — across as many properties as you like in one pass. Months that already have a charge are skipped, so this is safe to re-run.
        </p>

        {!leases?.length ? (
          <p className="text-sm text-amber-300">Add a tenant and lease first.</p>
        ) : (
          <>
            <div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-xs">Tenants ({selectedLeaseIds.length} of {leases.length} selected)</span>
                <button onClick={toggleAll} className="text-[11px] text-indigo-400">
                  {selectedLeaseIds.length === leases.length ? 'Clear all' : 'Select all'}
                </button>
              </div>
              <div className="mt-1 space-y-1 max-h-40 overflow-y-auto border border-slate-800 rounded-lg p-2">
                {leases.map((l) => (
                  <label key={l.id} className="flex items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" checked={selectedLeaseIds.includes(l.id)} onChange={() => toggleLease(l.id)} />
                    <span>{tenantName(l.tenant_id)}</span>
                    <span className="text-[11px] text-slate-500">{propertyLabel(l.rental_unit_id)}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Start month"><input type="month" className={inputCls} value={startMonth} onChange={(e) => setStartMonth(e.target.value)} /></Field>
              <Field label="End month"><input type="month" className={inputCls} value={endMonth} onChange={(e) => setEndMonth(e.target.value)} /></Field>
            </div>

            <Field label="Mark these months as">
              <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as 'unknown' | 'paid')}>
                <option value="unknown">Unknown — review and correct later</option>
                <option value="paid">Paid — I know these were paid on time</option>
              </select>
            </Field>
            {status === 'paid' && (
              <p className="text-[11px] text-amber-300">
                Every installment in range will be marked paid, dated to its own due date. You can still correct any individual month afterward from Rent Tracking.
              </p>
            )}
          </>
        )}

        {result && (
          <p className="text-xs text-emerald-300">
            Created {result.created} month{result.created === 1 ? '' : 's'} across {result.leaseCount} tenant{result.leaseCount === 1 ? '' : 's'}, skipped {result.skipped} that already existed.
          </p>
        )}

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm">
            {result ? 'Done' : 'Cancel'}
          </button>
          {!result && (
            <button
              onClick={handleBackfill}
              disabled={saving || selectedLeaseIds.length === 0}
              className="flex-1 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2 text-sm font-medium"
            >
              {saving ? 'Backfilling…' : `Backfill ${selectedLeaseIds.length || ''} tenant${selectedLeaseIds.length === 1 ? '' : 's'}`}
            </button>
          )}
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
