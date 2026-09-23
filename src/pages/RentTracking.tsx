import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { saveRentCharge, saveRentInstallment, buildInstallments, blankMeta } from '../lib/mutations';
import { useAppStore } from '../store/useAppStore';
import { LeaseQuickAddModal } from '../components/LeaseQuickAddModal';
import { BackfillModal } from '../components/BackfillModal';
import { InstallmentEditModal } from '../components/InstallmentEditModal';
import type { InstallmentStatus, RentInstallment } from '../lib/types';

const INSTALLMENT_STATUS_COLOR: Record<InstallmentStatus, string> = {
  unknown: 'bg-slate-700 text-slate-200',
  due: 'bg-amber-900 text-amber-200',
  paid: 'bg-emerald-900 text-emerald-200',
  late: 'bg-rose-900 text-rose-200',
  partial: 'bg-sky-900 text-sky-200',
};

const PAYER_LABEL: Record<string, string> = {
  section8: 'Section 8', cityfheps: 'CityFHEPS', hra: 'HRA', tenant: 'Tenant', none: '—',
};

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const newY = Math.floor(total / 12);
  const newM = (total % 12) + 1;
  return `${newY}-${String(newM).padStart(2, '0')}`;
}

export function RentTracking() {
  const ownerId = useAppStore((s) => s.ownerId) ?? 'local-owner';
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBackfillModal, setShowBackfillModal] = useState(false);
  const [editingInstallment, setEditingInstallment] = useState<RentInstallment | null>(null);
  const [monthKey, setMonthKey] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const currentMonth = `${monthKey}-01`;

  const leases = useLiveQuery(() => db.leases.filter((l) => !l.deleted_at && l.status === 'active').toArray(), []);
  const tenants = useLiveQuery(() => db.tenants.toArray(), []);
  const units = useLiveQuery(() => db.rental_units.toArray(), []);
  const properties = useLiveQuery(() => db.properties.toArray(), []);
  const charges = useLiveQuery(
    () => db.rent_charges.filter((c) => !c.deleted_at && c.charge_month === currentMonth).toArray(),
    [currentMonth],
  );
  const installments = useLiveQuery(
    () => db.rent_installments.filter((i) => !i.deleted_at).toArray(),
    [],
  );

  const tenantName = (id: string) => tenants?.find((t) => t.id === id)?.full_name ?? 'Unknown tenant';
  const propertyName = (unitId?: string) => {
    const unit = units?.find((u) => u.id === unitId);
    return properties?.find((p) => p.id === unit?.property_id)?.name;
  };

  async function ensureChargeForLease(leaseId: string) {
    const existing = charges?.find((c) => c.lease_id === leaseId);
    if (existing) return existing;
    const lease = leases?.find((l) => l.id === leaseId);
    if (!lease) return null;
    const charge = await saveRentCharge({
      ...blankMeta(ownerId),
      lease_id: leaseId,
      charge_month: currentMonth,
      total_rent: lease.total_monthly_rent,
      government_portion: lease.government_portion,
      tenant_portion: lease.tenant_portion,
      status: 'unknown',
    });
    for (const installment of buildInstallments(ownerId, charge.id, currentMonth, lease)) {
      await saveRentInstallment({ ...blankMeta(ownerId), ...installment });
    }
    return charge;
  }

  async function rollUpChargeStatus(chargeId: string) {
    const siblings = installments?.filter((i) => i.rent_charge_id === chargeId) ?? [];
    const charge = charges?.find((c) => c.id === chargeId);
    if (!charge || siblings.length === 0) return;
    const allPaid = siblings.every((i) => i.status === 'paid');
    const anyPaid = siblings.some((i) => i.status === 'paid');
    await saveRentCharge({ ...charge, status: allPaid ? 'paid' : anyPaid ? 'partial' : charge.status });
  }

  const isCurrentMonth = monthKey === new Date().toISOString().slice(0, 7);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => setMonthKey((m) => shiftMonth(m, -1))} className="text-slate-400 hover:text-slate-200 px-1">‹</button>
          <h1 className="text-lg font-semibold">
            {new Date(currentMonth).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </h1>
          <button onClick={() => setMonthKey((m) => shiftMonth(m, 1))} className="text-slate-400 hover:text-slate-200 px-1">›</button>
          {!isCurrentMonth && (
            <button onClick={() => setMonthKey(new Date().toISOString().slice(0, 7))} className="text-[11px] text-indigo-400 ml-1">today</button>
          )}
        </div>
        <button onClick={() => setShowAddModal(true)} className="rounded-md bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-sm font-medium">
          + Add tenant
        </button>
      </div>

      <button onClick={() => setShowBackfillModal(true)} className="text-xs text-slate-400 hover:text-slate-200 underline">
        Backfill historical months
      </button>

      {leases?.length === 0 && <p className="text-slate-400 text-sm">No active leases yet. Add a tenant to start tracking rent.</p>}

      <div className="space-y-2">
        {leases?.map((lease) => {
          const charge = charges?.find((c) => c.lease_id === lease.id);
          const leaseInstallments = charge ? (installments?.filter((i) => i.rent_charge_id === charge.id) ?? []) : [];
          return (
            <div key={lease.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-medium">{tenantName(lease.tenant_id)}</div>
                  <div className="text-xs text-slate-400">{propertyName(lease.rental_unit_id)}</div>
                  {lease.subsidy_program && lease.subsidy_program !== 'none' && (
                    <span className="inline-block mt-1 text-[10px] uppercase tracking-wide bg-slate-800 rounded px-1.5 py-0.5 text-slate-300">
                      {PAYER_LABEL[lease.subsidy_program]}
                    </span>
                  )}
                </div>
                <span className="font-mono text-sm">${Number(lease.total_monthly_rent).toFixed(2)}</span>
              </div>

              {!charge ? (
                <button onClick={() => ensureChargeForLease(lease.id)} className="mt-2 text-xs rounded-md bg-slate-800 hover:bg-slate-700 px-2 py-1">
                  Create this month's charge
                </button>
              ) : (
                <div className="mt-3 pt-3 border-t border-slate-800 space-y-1.5">
                  {leaseInstallments.length === 0 && <p className="text-xs text-slate-500">No payment schedule on this lease.</p>}
                  {leaseInstallments
                    .sort((a, b) => a.due_date.localeCompare(b.due_date))
                    .map((inst) => (
                      <button
                        key={inst.id}
                        onClick={() => setEditingInstallment(inst)}
                        className="w-full flex items-center justify-between bg-slate-800/60 hover:bg-slate-800 rounded-lg px-3 py-2 text-left"
                      >
                        <div>
                          <div className="text-xs">
                            <span className="text-slate-300">{inst.portion === 'government' ? PAYER_LABEL[inst.payer] : 'Tenant'}</span>
                            {inst.payer === 'hra' && inst.portion === 'tenant' && <span className="text-slate-500"> (via HRA)</span>}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Due {inst.due_date} · ${Number(inst.amount).toFixed(2)}
                            {inst.status === 'paid' && inst.paid_date && ` · paid ${inst.paid_date}`}
                          </div>
                        </div>
                        <span className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 ${INSTALLMENT_STATUS_COLOR[inst.status]}`}>{inst.status}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showAddModal && <LeaseQuickAddModal onClose={() => setShowAddModal(false)} />}
      {showBackfillModal && <BackfillModal onClose={() => setShowBackfillModal(false)} />}
      {editingInstallment && (
        <InstallmentEditModal
          installment={editingInstallment}
          onClose={() => setEditingInstallment(null)}
          onSaved={() => { rollUpChargeStatus(editingInstallment.rent_charge_id); setEditingInstallment(null); }}
        />
      )}
    </div>
  );
}
