import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import type { Lease, LeaseStatus } from '../lib/types';
import { saveLease, saveDocument, saveRentalUnit, blankMeta, regenerateMonthsAfterLeaseEdit } from '../lib/mutations';
import { unitConflicts, currentMonthStart } from '../lib/leaseRegen';
import { payerSetupInfo } from '../lib/payerSetup';
import { PaymentScheduleFields } from './PaymentScheduleFields';
import { DocImport, Suggestion } from './DocImport';
import { parseLeaseText, type LeaseSuggestions } from '../lib/docParse';
import { scheduleFromLease, scheduleToLeaseFields, type PaymentScheduleValue } from '../lib/paymentSchedule';

export function LeaseFormModal({ existing, onClose }: { existing: Lease; onClose: () => void }) {
  const [rent, setRent] = useState(String(existing.total_monthly_rent));
  const [dueDay, setDueDay] = useState(String(existing.rent_due_day ?? 1));
  const [leaseStart, setLeaseStart] = useState(existing.lease_start ?? '');
  const [leaseEnd, setLeaseEnd] = useState(existing.lease_end ?? '');
  const [schedule, setSchedule] = useState<PaymentScheduleValue>(() => scheduleFromLease(existing));
  const review = payerSetupInfo(existing);
  // Premises: property → unit picker (owner's own, non-deleted). propertyPick
  // '' = follow the selected unit's property.
  const [unitId, setUnitId] = useState(existing.rental_unit_id);
  const [propertyPick, setPropertyPick] = useState('');
  const [confirmConflict, setConfirmConflict] = useState(false);
  const [doneNote, setDoneNote] = useState<string | null>(null);
  const properties = useLiveQuery(() => db.properties.filter((p) => !p.deleted_at && p.owner_id === existing.owner_id).sortBy('name'), [existing.owner_id]);
  const allUnits = useLiveQuery(() => db.rental_units.filter((u) => !u.deleted_at && u.owner_id === existing.owner_id).sortBy('name'), [existing.owner_id]);
  const allLeases = useLiveQuery(() => db.leases.toArray(), []);
  const allTenants = useLiveQuery(() => db.tenants.toArray(), []);
  const unit = useLiveQuery(() => db.rental_units.get(unitId), [unitId]);
  const selectedPropertyId = propertyPick || unit?.property_id || '';
  const unitsForProperty = (allUnits ?? []).filter((u) => u.property_id === selectedPropertyId);
  const conflicts = unitId !== existing.rental_unit_id ? unitConflicts(existing.id, unitId, allLeases) : [];
  const conflictNames = conflicts.map((l) => allTenants?.find((t) => t.id === l.tenant_id)?.full_name ?? 'another tenant').join(', ');
  const proofDocs = useLiveQuery(
    () => db.documents.filter((d) => !d.deleted_at && (d.lease_id === existing.id || d.tenant_id === existing.tenant_id)).toArray(),
    [existing.id, existing.tenant_id],
  );
  const [deposit, setDeposit] = useState(existing.security_deposit ? String(existing.security_deposit) : '');
  const [status, setStatus] = useState<LeaseStatus>(existing.status);
  const [saving, setSaving] = useState(false);
  const [sugg, setSugg] = useState<LeaseSuggestions | null>(null);
  const [imported, setImported] = useState<{ name: string; text: string } | null>(null);
  const [keepText, setKeepText] = useState(false);
  const tenant = useLiveQuery(() => db.tenants.get(existing.tenant_id), [existing.tenant_id]);

  function applyAll(x: LeaseSuggestions) {
    if (x.monthlyRent) setRent(String(x.monthlyRent));
    if (x.leaseStart) setLeaseStart(x.leaseStart);
    if (x.leaseEnd) setLeaseEnd(x.leaseEnd);
    if (x.deposit) setDeposit(String(x.deposit));
    if (x.govProgram || x.tenantPortion) applySchedule(x);
  }
  function applySchedule(x: LeaseSuggestions) {
    setSchedule((v) => ({
      ...v,
      ...(x.govProgram ? { setup: v.setup === 'self_pay' ? 'gov_tenant' as const : v.setup, govProgram: x.govProgram } : {}),
      ...(x.govPortion ? { govPortion: String(x.govPortion) } : {}),
      ...(x.tenantPortion ? { tenantPortion: String(x.tenantPortion) } : {}),
    }));
  }

  async function handleSave(conflictConfirmed = false) {
    if (!rent || !unitId) return;
    if (conflicts.length > 0 && !conflictConfirmed) { setConfirmConflict(true); return; }
    setConfirmConflict(false);
    setSaving(true);
    // Proof note first, so the lease never points at a document that
    // doesn't exist yet (no FK on hra_proof_document_id, by design).
    let proofId: string | undefined;
    if (schedule.setup === 'gov_hra' && !schedule.hraProofDocumentId && schedule.hraProofNewTitle.trim() && unit?.property_id) {
      const doc = await saveDocument({
        ...blankMeta(existing.owner_id),
        property_id: unit.property_id,
        tenant_id: existing.tenant_id,
        lease_id: existing.id,
        doc_type: 'other',
        title: schedule.hraProofNewTitle.trim(),
        content: `HRA proof${schedule.hraCaseNumber ? ` · case #${schedule.hraCaseNumber.trim()}` : ''}${schedule.hraApprovedOn ? ` · approved ${schedule.hraApprovedOn}` : ''}`,
      });
      proofId = doc.id;
    }
    if (keepText && imported && unit?.property_id) {
      await saveDocument({
        ...blankMeta(existing.owner_id),
        property_id: unit.property_id,
        tenant_id: existing.tenant_id,
        lease_id: existing.id,
        doc_type: 'lease',
        title: `Imported lease: ${imported.name}`,
        content: imported.text,
      });
    }
    const saved = await saveLease({
      ...existing,
      rental_unit_id: unitId,
      total_monthly_rent: Number(rent),
      rent_due_day: Number(dueDay) || 1,
      lease_start: leaseStart || undefined,
      lease_end: leaseEnd || undefined,
      ...scheduleToLeaseFields(schedule, proofId),
      security_deposit: deposit ? Number(deposit) : undefined,
      status,
    });
    // Moved to a different unit: mark it occupied (same as quick-add). The
    // old unit's status is left for Jeff to set.
    if (unitId !== existing.rental_unit_id && status === 'active' && unit && unit.status !== 'occupied') {
      await saveRentalUnit({ ...unit, status: 'occupied' });
    }
    // Rent/payer/due-day edits flow into this month (and pre-created future
    // months) unless money was already received there. Past months never change.
    const regen = await regenerateMonthsAfterLeaseEdit(existing, saved);
    setSaving(false);
    if (regen.skippedWithPayments.length > 0) {
      setDoneNote(regen.skippedWithPayments.includes(currentMonthStart())
        ? 'This month already has payments; changes apply from next month.'
        : `Some months already have payments (${regen.skippedWithPayments.map((m) => m.slice(0, 7)).join(', ')}); those stay as they are.`);
      return;
    }
    onClose();
  }

  if (doneNote) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
        <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-3">
          <h2 className="text-lg font-semibold">Lease saved</h2>
          <p className="text-sm text-amber-300">{doneNote}</p>
          <button onClick={onClose} className="w-full rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm">Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold">Edit lease</h2>
        <DocImport label="Fill from lease PDF" accept="application/pdf,image/*" onText={(text, file) => { setSugg(parseLeaseText(text)); setImported({ name: file.name, text }); }} />
        {sugg && (
          <div className="rounded-lg border border-indigo-800 bg-slate-950 p-2 space-y-1">
            <div className="flex justify-between text-xs font-medium"><span>Suggested from {imported?.name}</span>
              <button type="button" onClick={() => applyAll(sugg)} className="rounded bg-indigo-600 px-1.5 py-0.5">Use all</button></div>
            {sugg.tenantNames.length > 0 && <Suggestion label="Tenant(s)" value={sugg.tenantNames.join(', ')}
              note={tenant && !sugg.tenantNames.some((n) => n.toLowerCase() === tenant.full_name.toLowerCase()) ? `on file: ${tenant.full_name}` : undefined} />}
            {(sugg.address || sugg.unit) && <Suggestion label="Premises" value={[sugg.address, sugg.unit && !sugg.address?.includes(sugg.unit) ? `Unit ${sugg.unit}` : ''].filter(Boolean).join(' · ')}
              note={unit && sugg.unit && unit.name.toUpperCase().indexOf(sugg.unit) < 0 ? `unit on file: ${unit.name}` : undefined} />}
            {sugg.leaseStart && <Suggestion label="Start" value={sugg.leaseStart} onUse={() => setLeaseStart(sugg.leaseStart!)} />}
            {sugg.leaseEnd && <Suggestion label="End" value={sugg.leaseEnd} onUse={() => setLeaseEnd(sugg.leaseEnd!)} />}
            {sugg.monthlyRent && <Suggestion label="Monthly rent" value={`$${sugg.monthlyRent}`} onUse={() => setRent(String(sugg.monthlyRent))} />}
            {sugg.deposit && <Suggestion label="Deposit" value={`$${sugg.deposit}`} onUse={() => setDeposit(String(sugg.deposit))} />}
            {(sugg.govProgram || sugg.govPortion || sugg.tenantPortion) && <Suggestion label="Payer split"
              value={[sugg.govProgram === 'cityfheps' ? 'CityFHEPS' : sugg.govProgram ? 'Section 8' : '', sugg.govPortion && `gov $${sugg.govPortion}`, sugg.tenantPortion && `tenant $${sugg.tenantPortion}`].filter(Boolean).join(' · ')}
              onUse={() => applySchedule(sugg)} />}
            {!sugg.tenantNames.length && !sugg.leaseStart && !sugg.monthlyRent && <p className="text-xs text-amber-300">Couldn't find lease fields in that file.</p>}
            <p className="text-[11px] text-slate-500">Tenant name is shown for checking only; change it on the tenant. Change the unit with the Property/Unit pickers below.</p>
            <label className="flex items-center gap-1 text-[11px] text-slate-400"><input type="checkbox" checked={keepText} onChange={(e) => setKeepText(e.target.checked)} /> Also save the extracted text to Documents when I tap Save</label>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Property">
            <select className={inputCls} value={selectedPropertyId} onChange={(e) => {
              const pid = e.target.value;
              setPropertyPick(pid);
              setUnitId((allUnits ?? []).find((u) => u.property_id === pid)?.id ?? '');
              setConfirmConflict(false);
            }}>
              {!selectedPropertyId && <option value="">Select…</option>}
              {properties?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Unit">
            <select className={inputCls} value={unitId} onChange={(e) => { setUnitId(e.target.value); setConfirmConflict(false); }}>
              {!unitId && <option value="">{unitsForProperty.length ? 'Select…' : 'No units on this property'}</option>}
              {unitsForProperty.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
        </div>
        {conflicts.length > 0 && (
          <p className="text-[11px] text-amber-300">This unit already has an active lease ({conflictNames}). You'll be asked to confirm before saving.</p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Monthly rent"><input type="number" step="0.01" className={inputCls} value={rent} onChange={(e) => setRent(e.target.value)} /></Field>
          <Field label="Due day"><input type="number" min="1" max="28" className={inputCls} value={dueDay} onChange={(e) => setDueDay(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Lease start"><input type="date" className={inputCls} value={leaseStart} onChange={(e) => setLeaseStart(e.target.value)} /></Field>
          <Field label="Lease end"><input type="date" className={inputCls} value={leaseEnd} onChange={(e) => setLeaseEnd(e.target.value)} /></Field>
        </div>

        {review.needsReview && (
          <p className="text-[11px] text-amber-300">Review payer setup: {review.reviewReasons.join('; ')}.</p>
        )}
        <PaymentScheduleFields
          value={schedule}
          onChange={setSchedule}
          proofDocuments={(proofDocs ?? []).map((d) => ({ id: d.id, title: d.title }))}
        />
        <p className="text-[11px] text-slate-500">Rent, payer and due-day changes also update this month (and any later months already created) if no money has been received there yet. Past months never change.</p>

        <Field label="Security deposit"><input type="number" step="0.01" className={inputCls} value={deposit} onChange={(e) => setDeposit(e.target.value)} /></Field>
        <Field label="Status">
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as LeaseStatus)}>
            <option value="active">Active</option>
            <option value="ended">Ended</option>
            <option value="draft">Draft</option>
          </select>
        </Field>
        {confirmConflict && (
          <div className="rounded-lg border border-amber-800 bg-amber-950/40 p-2 space-y-2">
            <p className="text-xs text-amber-200">{unit?.name ?? 'This unit'} already has an active lease for {conflictNames}. Assign this lease there anyway?</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmConflict(false)} className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 py-1.5 text-xs">Back</button>
              <button onClick={() => handleSave(true)} disabled={saving} className="flex-1 rounded-md bg-amber-700 hover:bg-amber-600 disabled:opacity-50 py-1.5 text-xs font-medium">Save anyway</button>
            </div>
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm">Cancel</button>
          <button onClick={() => handleSave()} disabled={saving || !rent || !unitId} className="flex-1 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2 text-sm font-medium">
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
