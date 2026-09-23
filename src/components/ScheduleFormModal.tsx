import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { saveMaintenanceSchedule, blankMeta } from '../lib/mutations';
import { useAppStore } from '../store/useAppStore';
import type { MaintenanceSchedule, MaintenanceFrequency } from '../lib/types';

export function ScheduleFormModal({ existing, onClose }: { existing?: MaintenanceSchedule; onClose: () => void }) {
  const ownerId = useAppStore((s) => s.ownerId) ?? 'local-owner';
  const properties = useLiveQuery(() => db.properties.filter((p) => !p.deleted_at).sortBy('name'), []);
  const contractors = useLiveQuery(() => db.contractors.filter((c) => !c.deleted_at).sortBy('full_name'), []);

  const [propertyId, setPropertyId] = useState(existing?.property_id ?? '');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [frequency, setFrequency] = useState<MaintenanceFrequency>(existing?.frequency ?? 'monthly');
  const [nextDueDate, setNextDueDate] = useState(existing?.next_due_date ?? new Date().toISOString().slice(0, 10));
  const [assignedContractorId, setAssignedContractorId] = useState(existing?.assigned_contractor_id ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [saving, setSaving] = useState(false);

  const effectivePropertyId = propertyId || properties?.[0]?.id || '';

  async function handleSave() {
    if (!effectivePropertyId || !title.trim()) return;
    setSaving(true);
    const base = existing ?? blankMeta(ownerId);
    await saveMaintenanceSchedule({
      ...base,
      property_id: effectivePropertyId,
      title: title.trim(),
      description: description.trim() || undefined,
      frequency,
      next_due_date: nextDueDate,
      assigned_contractor_id: assignedContractorId || undefined,
      status: existing?.status ?? 'active',
      notes: notes.trim() || undefined,
      deleted_at: existing?.deleted_at ?? null,
    });
    setSaving(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold">{existing ? 'Edit scheduled maintenance' : 'Add scheduled maintenance'}</h2>

        {!properties?.length ? (
          <p className="text-sm text-amber-300">Add a property first.</p>
        ) : (
          <>
            <Field label="Property">
              <select className={inputCls} value={effectivePropertyId} onChange={(e) => setPropertyId(e.target.value)}>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="What is it?"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Pest control, HVAC service, gutter cleaning…" /></Field>
            <Field label="Notes for the job (optional)"><textarea className={inputCls} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Repeats">
                <select className={inputCls} value={frequency} onChange={(e) => setFrequency(e.target.value as MaintenanceFrequency)}>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="semi_annual">Twice a year</option>
                  <option value="annual">Annually</option>
                </select>
              </Field>
              <Field label="Next due"><input type="date" className={inputCls} value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)} /></Field>
            </div>
            <Field label="Assigned contractor (optional)">
              <select className={inputCls} value={assignedContractorId} onChange={(e) => setAssignedContractorId(e.target.value)}>
                <option value="">Unassigned</option>
                {contractors?.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
            </Field>
            <Field label="Other notes (optional)"><input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </>
        )}

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || !properties?.length || !title.trim()}
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
