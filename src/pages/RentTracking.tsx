import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { saveRentCharge, saveRentInstallment, buildInstallments, blankMeta, rollUpCharge, markChargeFull } from '../lib/mutations';
import { useAppStore } from '../store/useAppStore';
import { LeaseQuickAddModal } from '../components/LeaseQuickAddModal';
import { BackfillModal } from '../components/BackfillModal';
import { InstallmentEditModal } from '../components/InstallmentEditModal';
import type { ChargeStatus, InstallmentStatus, RentInstallment } from '../lib/types';
import { PAYER_SETUP_LABEL, PROGRAM_LABEL, payerLabel, payerSetupInfo } from '../lib/payerSetup';
import { deriveChargeStatus, fmtMoney } from '../lib/chargeStatus';

const INSTALLMENT_STATUS_COLOR: Record<InstallmentStatus, string> = {
  unknown: 'bg-slate-700 text-slate-200',
  due: 'bg-amber-900 text-amber-200',
  paid: 'bg-emerald-900 text-emerald-200',
  late: 'bg-rose-900 text-rose-200',
  partial: 'bg-sky-900 text-sky-200',
};

const CHARGE_BADGE_COLOR: Record<ChargeStatus, string> = {
  unknown: 'bg-slate-700 text-slate-200',
  due: 'bg-amber-900 text-amber-200',
  paid: 'bg-emerald-900 text-emerald-200',
  late: 'bg-rose-900 text-rose-200',
  partial: 'bg-sky-900 text-sky-200',
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
  const [confirmFullId, setConfirmFullId] = useState<string | null>(null);
  const [markError, setMarkError] = useState<{ chargeId: string; reason: string } | null>(null);
  const [marking, setMarking] = useState(false);
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

  // Mark Full re-reads Dexie and refuses unless every payer line is fully
  // received (no early Full). Only offered on gov setups; self-pay auto-Fulls.
  async function handleMarkFull(chargeId: string) {
    setMarking(true);
    setMarkError(null);
    const r = await markChargeFull(chargeId);
    setMarking(false);
    setConfirmFullId(null);
    if (!r.ok) setMarkError({ chargeId, reason: r.reason });
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
          const info = payerSetupInfo(lease);
          const roll = charge ? deriveChargeStatus(charge, leaseInstallments, info.setup) : null;
          return (
            <div key={lease.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-medium">{tenantName(lease.tenant_id)}</div>
                  <div className="text-xs text-slate-400">{propertyName(lease.rental_unit_id)}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <span className="text-[10px] uppercase tracking-wide bg-slate-800 rounded px-1.5 py-0.5 text-slate-300">
                      {PAYER_SETUP_LABEL[info.setup]}{info.program && info.program !== 'hra' ? ` · ${PROGRAM_LABEL[info.program]}` : ''}
                    </span>
                    {info.needsReview && <span className="text-[10px] uppercase tracking-wide bg-amber-900 rounded px-1.5 py-0.5 text-amber-200" title={info.reviewReasons.join('; ')}>Review payer setup</span>}
                    {info.hraProofMissing && <span className="text-[10px] uppercase tracking-wide bg-amber-950 border border-amber-900 rounded px-1.5 py-0.5 text-amber-300">HRA proof missing</span>}
                  </div>
                </div>
                <div className="text-right">
                  <span className="font-mono text-sm">${Number(lease.total_monthly_rent).toFixed(2)}</span>
                  {roll && (
                    <div className="mt-1">
                      <span className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 ${roll.readyForFull ? 'bg-indigo-900 text-indigo-200' : CHARGE_BADGE_COLOR[roll.status]}`}>
                        {roll.readyForFull ? 'Ready for Full' : roll.displayStatus}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {!charge ? (
                <button onClick={() => ensureChargeForLease(lease.id)} className="mt-2 text-xs rounded-md bg-slate-800 hover:bg-slate-700 px-2 py-1">
                  Create this month's charge
                </button>
              ) : (
                <div className="mt-3 pt-3 border-t border-slate-800 space-y-1.5">
                  {leaseInstallments.length === 0 && <p className="text-xs text-slate-500">No payment schedule on this lease.</p>}
                  {roll && roll.lines.length > 0 && (
                    <div className="space-y-0.5 pb-1">
                      {roll.lines.map((l) => (
                        <div key={l.key} className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-400">{l.label}</span>
                          <span className={l.met ? 'text-emerald-300 font-mono' : 'text-slate-300 font-mono'}>
                            {fmtMoney(l.received)} / {fmtMoney(l.expected)}{l.met ? ' ✓' : ''}
                          </span>
                        </div>
                      ))}
                      {roll.status === 'partial' && !roll.readyForFull && roll.owing.length > 0 && (
                        <p className="text-[11px] text-sky-300">{roll.summary}</p>
                      )}
                      {roll.credit > 0 && <p className="text-[11px] text-emerald-300">Credit {fmtMoney(roll.credit)} (display only)</p>}
                      {roll.isFull && charge.marked_full_at && (
                        <p className="text-[11px] text-slate-500">Marked Full {new Date(charge.marked_full_at).toLocaleDateString()}</p>
                      )}
                    </div>
                  )}
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
                            <span className="text-slate-300">{payerLabel(inst)}</span>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Due {inst.due_date} · ${Number(inst.amount).toFixed(2)}
                            {(inst.status === 'paid' || inst.status === 'partial') && inst.paid_date && ` · paid ${inst.paid_date}`}
                            {(inst.status === 'paid' || inst.status === 'partial') && inst.paid_amount != null && Number(inst.paid_amount) !== Number(inst.amount) && ` (${fmtMoney(Number(inst.paid_amount))})`}
                          </div>
                        </div>
                        <span className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 ${INSTALLMENT_STATUS_COLOR[inst.status]}`}>{inst.status}</span>
                      </button>
                    ))}
                  {roll && info.setup !== 'self_pay' && !roll.isFull && roll.lines.length > 0 && (
                    confirmFullId === charge.id ? (
                      <div className="bg-slate-800/60 rounded-lg p-2 space-y-2">
                        <p className="text-xs text-slate-300">Mark this month Full? Every payer line has been received ({fmtMoney(roll.received)} of {fmtMoney(roll.expected)}).</p>
                        <div className="flex gap-2">
                          <button onClick={() => setConfirmFullId(null)} className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 py-1.5 text-xs">Cancel</button>
                          <button onClick={() => handleMarkFull(charge.id)} disabled={marking} className="flex-1 rounded-md bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 py-1.5 text-xs font-medium">
                            {marking ? 'Saving…' : 'Confirm Full'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setMarkError(null); setConfirmFullId(charge.id); }}
                        disabled={!roll.readyForFull}
                        title={roll.readyForFull ? 'Every payer line received' : 'Available once every payer line is fully received'}
                        className="w-full rounded-md bg-emerald-800 hover:bg-emerald-700 disabled:bg-slate-800 disabled:text-slate-500 py-1.5 text-xs font-medium"
                      >
                        Mark Full
                      </button>
                    )
                  )}
                  {markError?.chargeId === charge.id && <p className="text-[11px] text-rose-400">{markError.reason}</p>}
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
          onSaved={() => { void rollUpCharge(editingInstallment.rent_charge_id); setEditingInstallment(null); }}
        />
      )}
    </div>
  );
}
