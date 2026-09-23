import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { useAppStore } from '../store/useAppStore';
import { sendNotificationEmail, buildMaintenanceUpdateEmail } from '../lib/emailNotify';
import { computeNextDueDate, isOverdue, isDueSoon } from '../lib/maintenanceSchedule';
import { saveMaintenanceSchedule, softDelete } from '../lib/mutations';
import {
  listMaintenanceRequests, setRequestStatus, listBidsForRequest, awardBid,
  listCompletions, markCompletionPaid, closeRequest,
} from '../lib/maintenance';
import { AddMaintenanceRequestModal } from '../components/AddMaintenanceRequestModal';
import { ScheduleFormModal } from '../components/ScheduleFormModal';
import type { MaintenanceRequest, JobBid, JobCompletion, RequestStatus, MaintenanceSchedule } from '../lib/types';

const TABS = ['submitted', 'approved_for_bidding', 'awarded', 'completed', 'scheduled'] as const;
const TAB_LABEL: Record<string, string> = {
  submitted: 'Needs review',
  approved_for_bidding: 'Out for bids',
  awarded: 'In progress',
  completed: 'Awaiting payment',
  scheduled: 'Scheduled',
};

export function Maintenance() {
  const ownerId = useAppStore((s) => s.ownerId) ?? '';
  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [completions, setCompletions] = useState<JobCompletion[]>([]);
  const [tab, setTab] = useState<typeof TABS[number]>('submitted');
  const [loading, setLoading] = useState(true);
  const [bidsFor, setBidsFor] = useState<{ requestId: string; bids: JobBid[] } | null>(null);
  const [showAddRequest, setShowAddRequest] = useState(false);
  const [editSchedule, setEditSchedule] = useState<MaintenanceSchedule | 'new' | null>(null);

  const schedules = useLiveQuery(() => db.maintenance_schedules.filter((s) => !s.deleted_at && s.status === 'active').toArray(), []);
  const properties = useLiveQuery(() => db.properties.toArray(), []);
  const contractors = useLiveQuery(() => db.contractors.toArray(), []);
  const propertyName = (id: string) => properties?.find((p) => p.id === id)?.name ?? '';
  const contractorName = (id?: string) => id ? (contractors?.find((c) => c.id === id)?.full_name ?? '') : '';

  async function refresh() {
    setLoading(true);
    try {
      const [reqs, comps] = await Promise.all([listMaintenanceRequests(), listCompletions()]);
      setRequests(reqs);
      setCompletions(comps);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  // Tenants are local-first data (see db.ts) — this app already has them on
  // this device, so no extra fetch needed to find their email.
  async function notifyTenant(request: MaintenanceRequest, newStatus: RequestStatus) {
    if (!request.tenant_id) return; // owner-logged request with no specific tenant
    try {
      const tenant = await db.tenants.get(request.tenant_id);
      if (!tenant?.email) return;
      await sendNotificationEmail({
        to: tenant.email,
        content: buildMaintenanceUpdateEmail(tenant.full_name, request.title, newStatus),
        kind: 'maintenance_update', ownerId, tenantId: tenant.id, relatedId: request.id,
      });
    } catch (err) {
      console.error('Maintenance update email failed (status change itself still succeeded):', err);
    }
  }

  async function handleStatusChange(request: MaintenanceRequest, newStatus: RequestStatus) {
    await setRequestStatus(request.id, newStatus);
    await notifyTenant(request, newStatus);
    refresh();
  }

  async function openBids(requestId: string) {
    const bids = await listBidsForRequest(requestId);
    setBidsFor({ requestId, bids });
  }

  async function handleAward(request: MaintenanceRequest, bidId: string) {
    await awardBid(request.id, bidId);
    await notifyTenant(request, 'awarded');
    setBidsFor(null);
    refresh();
  }

  async function handleClose(request: MaintenanceRequest) {
    await closeRequest(request.id);
    await notifyTenant(request, 'closed');
    refresh();
  }

  async function handleMarkDone(schedule: MaintenanceSchedule) {
    const today = new Date().toISOString().slice(0, 10);
    await saveMaintenanceSchedule({
      ...schedule,
      last_completed_date: today,
      next_due_date: computeNextDueDate(today, schedule.frequency),
    });
  }

  const shown = requests.filter((r) => r.status === tab);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Maintenance</h1>
        {tab === 'scheduled' ? (
          <button onClick={() => setEditSchedule('new')} className="rounded-md bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-sm font-medium">
            + Add
          </button>
        ) : (
          <button onClick={() => setShowAddRequest(true)} className="rounded-md bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-sm font-medium">
            + Add request
          </button>
        )}
      </div>

      <div className="flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`whitespace-nowrap text-xs rounded-full px-3 py-1.5 ${tab === t ? 'bg-indigo-600' : 'bg-slate-800 text-slate-300'}`}
          >
            {TAB_LABEL[t]} ({t === 'scheduled' ? (schedules?.length ?? 0) : requests.filter((r) => r.status === t).length})
          </button>
        ))}
      </div>

      {tab === 'scheduled' ? (
        <div className="space-y-2">
          {schedules?.length === 0 && <p className="text-slate-400 text-sm">No recurring maintenance set up yet — pest control, HVAC service, gutter cleaning, etc.</p>}
          {schedules?.map((s) => {
            const overdue = isOverdue(s.next_due_date, today);
            const dueSoon = isDueSoon(s.next_due_date, today);
            return (
              <div key={s.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                <div className="flex items-start justify-between">
                  <button onClick={() => setEditSchedule(s)} className="text-left flex-1">
                    <div className="text-sm font-medium">{s.title}</div>
                    <div className="text-xs text-slate-400">{propertyName(s.property_id)} · {s.frequency.replace('_', ' ')}{contractorName(s.assigned_contractor_id) ? ` · ${contractorName(s.assigned_contractor_id)}` : ''}</div>
                  </button>
                  <span className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 ${overdue ? 'bg-rose-900 text-rose-200' : dueSoon ? 'bg-amber-900 text-amber-200' : 'bg-slate-800 text-slate-300'}`}>
                    {overdue ? 'Overdue' : dueSoon ? 'Due soon' : 'Due ' + s.next_due_date}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[11px] text-slate-500">Next: {s.next_due_date}</span>
                  <div className="flex gap-2">
                    <button onClick={() => handleMarkDone(s)} className="text-xs rounded-md bg-emerald-800 hover:bg-emerald-700 px-2 py-1">Mark done</button>
                    <button onClick={() => { if (confirm('Remove this recurring item?')) softDelete('maintenance_schedules', s.id); }} className="text-xs rounded-md bg-slate-800 hover:bg-rose-900 px-2 py-1">Delete</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          {loading && <p className="text-slate-400 text-sm">Loading…</p>}
          {!loading && shown.length === 0 && <p className="text-slate-400 text-sm">Nothing here.</p>}

          <div className="space-y-2">
            {shown.map((r) => (
              <div key={r.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                <div className="flex items-start justify-between">
                  <div className="text-sm font-medium">{r.title}</div>
                  <span className="text-[10px] uppercase tracking-wide bg-slate-800 rounded px-1.5 py-0.5">{r.urgency}</span>
                </div>
                {r.description && <p className="text-xs text-slate-400 mt-1">{r.description}</p>}
                <p className="text-[11px] text-slate-500 mt-1">{r.permission_to_enter ? 'OK to enter without tenant present' : 'Tenant must be present'}</p>

                <div className="flex gap-2 mt-2">
                  {r.status === 'submitted' && (
                    <>
                      <button onClick={() => handleStatusChange(r, 'approved_for_bidding')} className="text-xs rounded-md bg-emerald-800 hover:bg-emerald-700 px-2 py-1">
                        Approve for bidding
                      </button>
                      <button onClick={() => handleStatusChange(r, 'rejected')} className="text-xs rounded-md bg-slate-800 hover:bg-rose-900 px-2 py-1">
                        Reject
                      </button>
                    </>
                  )}
                  {r.status === 'approved_for_bidding' && (
                    <button onClick={() => openBids(r.id)} className="text-xs rounded-md bg-slate-800 hover:bg-slate-700 px-2 py-1">
                      View bids
                    </button>
                  )}
                  {r.status === 'completed' && (
                    <CompletionActions requestId={r.id} completions={completions} onPaid={refresh} onClose={() => handleClose(r)} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {bidsFor && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
          <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-3 max-h-[80vh] overflow-y-auto">
            <h2 className="text-lg font-semibold">Bids</h2>
            {bidsFor.bids.length === 0 && <p className="text-sm text-slate-400">No bids yet.</p>}
            {bidsFor.bids.map((b) => (
              <div key={b.id} className="bg-slate-800 rounded-lg p-3 flex items-center justify-between">
                <div>
                  <div className="font-mono text-sm">${Number(b.amount).toFixed(2)}</div>
                  {b.message && <div className="text-xs text-slate-400">{b.message}</div>}
                </div>
                <button onClick={() => handleAward(requests.find((r) => r.id === bidsFor.requestId)!, b.id)} className="text-xs rounded-md bg-indigo-600 hover:bg-indigo-500 px-2 py-1">
                  Award
                </button>
              </div>
            ))}
            <button onClick={() => setBidsFor(null)} className="w-full rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm">Close</button>
          </div>
        </div>
      )}

      {showAddRequest && (
        <AddMaintenanceRequestModal onClose={() => setShowAddRequest(false)} onCreated={() => { setShowAddRequest(false); setTab('approved_for_bidding'); refresh(); }} />
      )}
      {editSchedule && (
        <ScheduleFormModal existing={editSchedule === 'new' ? undefined : editSchedule} onClose={() => setEditSchedule(null)} />
      )}
    </div>
  );
}

function CompletionActions({ requestId, completions, onPaid, onClose }: {
  requestId: string; completions: JobCompletion[]; onPaid: () => void; onClose: () => void;
}) {
  const completion = completions.find((c) => c.maintenance_request_id === requestId);
  if (!completion) return <span className="text-xs text-slate-500">Waiting on contractor's completion form</span>;
  return (
    <div className="flex flex-col gap-2 w-full">
      {completion.notes && <p className="text-xs text-slate-400">{completion.notes}</p>}
      <div className="flex gap-2">
        {completion.payment_status === 'pending' ? (
          <button onClick={() => markCompletionPaid(completion.id).then(onPaid)} className="text-xs rounded-md bg-emerald-800 hover:bg-emerald-700 px-2 py-1">
            Mark paid
          </button>
        ) : (
          <span className="text-xs rounded-md bg-emerald-900 text-emerald-200 px-2 py-1">Paid</span>
        )}
        <button onClick={onClose} className="text-xs rounded-md bg-slate-800 hover:bg-slate-700 px-2 py-1">Close request</button>
      </div>
    </div>
  );
}
