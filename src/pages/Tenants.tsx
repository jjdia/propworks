import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { useAppStore } from '../store/useAppStore';
import { createTenantInvite } from '../lib/maintenance';
import { sendNotificationEmail, buildOnboardingEmail } from '../lib/emailNotify';
import { TenantFormModal } from '../components/TenantFormModal';
import { LeaseFormModal } from '../components/LeaseFormModal';
import type { Tenant, Lease } from '../lib/types';

export function Tenants() {
  const ownerId = useAppStore((s) => s.ownerId) ?? 'local-owner';
  const profile = useAppStore((s) => s.profile);
  const [editTenant, setEditTenant] = useState<Tenant | 'new' | null>(null);
  const [editLease, setEditLease] = useState<Lease | null>(null);
  const [inviteCode, setInviteCode] = useState<{ tenantName: string; code: string; emailStatus: 'sent' | 'skipped' | 'failed' } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tenants = useLiveQuery(() => db.tenants.filter((t) => !t.deleted_at).sortBy('full_name'), []);
  const leases = useLiveQuery(() => db.leases.filter((l) => !l.deleted_at).toArray(), []);

  async function handleInvite(tenant: Tenant) {
    setError(null);
    try {
      const code = await createTenantInvite(ownerId, tenant.id);
      let emailStatus: 'sent' | 'skipped' | 'failed' = 'skipped';
      if (tenant.email) {
        try {
          await sendNotificationEmail({
            to: tenant.email,
            content: buildOnboardingEmail(tenant.full_name, code, profile?.full_name || 'Your property manager'),
            kind: 'onboarding', ownerId, tenantId: tenant.id,
          });
          emailStatus = 'sent';
        } catch {
          emailStatus = 'failed';
        }
      }
      setInviteCode({ tenantName: tenant.full_name, code, emailStatus });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Tenants</h1>
        <button onClick={() => setEditTenant('new')} className="rounded-md bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-sm font-medium">
          + Add
        </button>
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      <div className="space-y-2">
        {tenants?.map((t) => {
          const lease = leases?.find((l) => l.tenant_id === t.id && l.status === 'active');
          return (
            <div key={t.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-medium">{t.full_name}</div>
                  <div className="text-xs text-slate-400">{[t.phone, t.email].filter(Boolean).join(' · ')}</div>
                </div>
                {lease && <span className="font-mono text-sm">${Number(lease.total_monthly_rent).toFixed(2)}/mo</span>}
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                <button onClick={() => setEditTenant(t)} className="text-xs rounded-md bg-slate-800 hover:bg-slate-700 px-2 py-1">Edit tenant</button>
                {lease && (
                  <button onClick={() => setEditLease(lease)} className="text-xs rounded-md bg-slate-800 hover:bg-slate-700 px-2 py-1">Edit lease</button>
                )}
                <button onClick={() => handleInvite(t)} className="text-xs rounded-md bg-slate-800 hover:bg-slate-700 px-2 py-1">Generate portal invite</button>
              </div>
            </div>
          );
        })}
      </div>

      {editTenant && (
        <TenantFormModal existing={editTenant === 'new' ? undefined : editTenant} onClose={() => setEditTenant(null)} />
      )}
      {editLease && <LeaseFormModal existing={editLease} onClose={() => setEditLease(null)} />}

      {inviteCode && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
          <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-3 text-center">
            <h2 className="text-lg font-semibold">Invite code for {inviteCode.tenantName}</h2>
            <div className="text-3xl font-mono tracking-widest bg-slate-800 rounded-lg py-4">{inviteCode.code}</div>
            {inviteCode.emailStatus === 'sent' && <p className="text-xs text-emerald-400">Emailed to the tenant automatically.</p>}
            {inviteCode.emailStatus === 'failed' && <p className="text-xs text-amber-300">Couldn't send the email automatically (sending may not be fully configured yet) — share this code directly instead.</p>}
            {inviteCode.emailStatus === 'skipped' && <p className="text-xs text-amber-300">No email on file for this tenant — share this code directly instead.</p>}
            <p className="text-xs text-slate-400">Give this to the tenant if they didn't receive an email. They'll enter it when they sign up for the tenant portal — it's single-use.</p>
            <button onClick={() => setInviteCode(null)} className="w-full rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
