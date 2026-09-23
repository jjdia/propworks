import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../lib/db';
import {
  cancelPendingInvite,
  listPendingInvites,
  listPortfolioProfiles,
  removePortalProfile,
  type PendingInvite,
} from '../../lib/adminUsers';
import {
  createContractorInvite,
  createOwnerInvite,
  createTenantInvite,
  setContractorStatus,
} from '../../lib/maintenance';
import { sendNotificationEmail, buildOnboardingEmail } from '../../lib/emailNotify';
import { useAppStore } from '../../store/useAppStore';
import type { Profile, Tenant } from '../../lib/types';
import {
  canAccessAdmin,
  canRemovePortalUser,
  isPrimaryPortfolioOwner,
  roleLabel,
} from './access';

type ConfirmAction =
  | { kind: 'offboard' | 'delete'; profile: Profile }
  | null;

type InviteModal =
  | { kind: 'code'; title: string; code: string; note?: string }
  | null;

export function AdminUsersPage() {
  const profile = useAppStore((s) => s.profile);
  const ownerId = useAppStore((s) => s.ownerId) ?? '';
  const localOnly = useAppStore((s) => s.localOnly);

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmAction>(null);
  const [inviteModal, setInviteModal] = useState<InviteModal>(null);
  const [tenantPick, setTenantPick] = useState<string>('');

  const tenants = useLiveQuery(
    () => db.tenants.filter((t) => !t.deleted_at).sortBy('full_name'),
    [],
  );

  const allowed = canAccessAdmin(profile?.role);

  const refresh = useCallback(async () => {
    if (localOnly || !allowed) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [p, i] = await Promise.all([listPortfolioProfiles(), listPendingInvites()]);
      setProfiles(p);
      setInvites(i);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [localOnly, allowed]);

  useEffect(() => { refresh(); }, [refresh]);

  if (!allowed) {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-semibold">Admin</h1>
        <p className="text-sm text-rose-400">Only owners/admins can access user administration.</p>
        <Link to="/" className="text-sm text-indigo-400 hover:text-indigo-300">Back to home</Link>
      </div>
    );
  }

  if (localOnly) {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-semibold">Admin — Users & roles</h1>
        <p className="text-sm text-slate-400">
          User onboarding, offboarding, and portal accounts require Supabase to be configured.
          This browser is in local-only mode.
        </p>
        <Link to="/more" className="text-sm text-indigo-400 hover:text-indigo-300">Back to More</Link>
      </div>
    );
  }

  const owners = profiles.filter((p) => p.role === 'owner');
  const tenantProfiles = profiles.filter((p) => p.role === 'tenant');
  const contractorProfiles = profiles.filter((p) => p.role === 'contractor');
  const pendingContractors = contractorProfiles.filter((c) => c.contractor_status === 'pending');

  async function handleInviteCoOwner() {
    setError(null);
    setBusy(true);
    try {
      const code = await createOwnerInvite(ownerId);
      setInviteModal({
        kind: 'code',
        title: 'Co-owner invite code',
        code,
        note: 'They sign up with “I have a co-owner invite code.” Single-use; joins this exact portfolio.',
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleInviteContractor() {
    setError(null);
    setBusy(true);
    try {
      const code = await createContractorInvite(ownerId);
      setInviteModal({
        kind: 'code',
        title: 'Contractor invite code',
        code,
        note: 'They sign up as a contractor, then still need your approval before seeing jobs.',
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleInviteTenant() {
    if (!tenantPick) {
      setError('Pick a tenant from your roster first.');
      return;
    }
    const tenant = tenants?.find((t) => t.id === tenantPick);
    if (!tenant) {
      setError('That tenant was not found locally.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const code = await createTenantInvite(ownerId, tenant.id);
      let note = 'Share this code with the tenant. Single-use.';
      if (tenant.email) {
        try {
          await sendNotificationEmail({
            to: tenant.email,
            content: buildOnboardingEmail(tenant.full_name, code, profile?.full_name || 'Your property manager'),
            kind: 'onboarding',
            ownerId,
            tenantId: tenant.id,
          });
          note = `Emailed to ${tenant.email}. Share the code directly if they don’t get it.`;
        } catch {
          note = 'Invite created, but email could not be sent (Resend may not be configured). Share the code directly.';
        }
      } else {
        note = 'No email on file for this tenant — share this code directly.';
      }
      setInviteModal({ kind: 'code', title: `Invite for ${tenant.full_name}`, code, note });
      setTenantPick('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleContractorStatus(id: string, status: 'approved' | 'rejected') {
    setError(null);
    setBusy(true);
    try {
      await setContractorStatus(id, status);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelInvite(inv: PendingInvite) {
    setError(null);
    setBusy(true);
    try {
      await cancelPendingInvite(inv.kind, inv.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmRemove() {
    if (!confirm || !profile) return;
    const decision = canRemovePortalUser({
      actorProfileId: profile.id,
      portfolioOwnerId: ownerId,
      target: confirm.profile,
    });
    if (!decision.ok) {
      setError(decision.reason);
      setConfirm(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await removePortalProfile(confirm.profile.id);
      setConfirm(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function removeButtons(p: Profile) {
    const decision = canRemovePortalUser({
      actorProfileId: profile!.id,
      portfolioOwnerId: ownerId,
      target: p,
    });
    if (!decision.ok) {
      return (
        <span className="text-[10px] text-slate-500" title={decision.reason}>
          {isPrimaryPortfolioOwner(p.id, ownerId) ? 'Primary owner' : 'Protected'}
        </span>
      );
    }
    return (
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirm({ kind: 'offboard', profile: p })}
          className="text-xs rounded-md bg-slate-800 hover:bg-slate-700 px-2 py-1 disabled:opacity-50"
        >
          Offboard
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirm({ kind: 'delete', profile: p })}
          className="text-xs rounded-md bg-rose-950 hover:bg-rose-900 text-rose-200 px-2 py-1 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    );
  }

  function profileCard(p: Profile, extra?: ReactNode) {
    return (
      <div key={p.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-medium">{p.full_name || 'Unnamed'}</div>
            <div className="text-xs text-slate-400">
              {roleLabel(p.role)}
              {p.trade ? ` · ${p.trade}` : ''}
              {p.contractor_status ? ` · ${p.contractor_status}` : ''}
              {isPrimaryPortfolioOwner(p.id, ownerId) ? ' · primary' : ''}
            </div>
            <div className="text-[10px] text-slate-600 font-mono mt-0.5 truncate max-w-[220px]">{p.id}</div>
          </div>
          {removeButtons(p)}
        </div>
        {extra}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Admin — Users & roles</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Onboard, offboard, and remove portal logins for this portfolio. Roster contacts stay on Tenants / Contractors.
          </p>
        </div>
        <Link to="/more" className="text-xs text-indigo-400 hover:text-indigo-300 shrink-0">More</Link>
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}
      {loading && <p className="text-sm text-slate-400">Loading…</p>}

      {/* Onboard */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-300">Onboard</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={busy}
            onClick={handleInviteCoOwner}
            className="text-left rounded-xl border border-slate-800 bg-slate-900 hover:border-slate-700 p-3 disabled:opacity-50"
          >
            <div className="text-sm font-medium">Invite co-owner / admin</div>
            <div className="text-xs text-slate-500">Share the portfolio with a spouse or partner login</div>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleInviteContractor}
            className="text-left rounded-xl border border-slate-800 bg-slate-900 hover:border-slate-700 p-3 disabled:opacity-50"
          >
            <div className="text-sm font-medium">Invite contractor (portal)</div>
            <div className="text-xs text-slate-500">They can bid after you approve them</div>
          </button>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 space-y-2">
          <div className="text-sm font-medium">Invite tenant (portal)</div>
          <p className="text-xs text-slate-500">Links a signup to an existing tenant on your roster.</p>
          <select
            className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-2 text-sm"
            value={tenantPick}
            onChange={(e) => setTenantPick(e.target.value)}
          >
            <option value="">Select tenant…</option>
            {(tenants ?? []).map((t: Tenant) => (
              <option key={t.id} value={t.id}>{t.full_name}{t.email ? ` (${t.email})` : ''}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !tenantPick}
            onClick={handleInviteTenant}
            className="w-full rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2 text-sm font-medium"
          >
            Generate tenant invite
          </button>
        </div>
      </section>

      {/* Pending invites */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-300">Pending invites</h2>
        {invites.length === 0 && <p className="text-xs text-slate-500">No unused invite codes.</p>}
        <div className="space-y-2">
          {invites.map((inv) => {
            const tenantName = inv.tenant_id
              ? tenants?.find((t) => t.id === inv.tenant_id)?.full_name
              : undefined;
            return (
              <div key={`${inv.kind}-${inv.id}`} className="flex items-center justify-between gap-2 bg-slate-900 border border-slate-800 rounded-xl p-3">
                <div>
                  <div className="text-sm font-mono tracking-wider">{inv.code}</div>
                  <div className="text-xs text-slate-500 capitalize">
                    {inv.kind}{tenantName ? ` · ${tenantName}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleCancelInvite(inv)}
                  className="text-xs rounded-md bg-slate-800 hover:bg-slate-700 px-2 py-1 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Contractor approvals */}
      {pendingContractors.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-300">Contractor approvals</h2>
          <div className="space-y-2">
            {pendingContractors.map((c) => (
              <div key={c.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">{c.full_name}</div>
                  {c.trade && <div className="text-xs text-slate-400">{c.trade}</div>}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleContractorStatus(c.id, 'approved')}
                    className="text-xs rounded-md bg-emerald-800 hover:bg-emerald-700 px-2 py-1 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleContractorStatus(c.id, 'rejected')}
                    className="text-xs rounded-md bg-slate-800 hover:bg-rose-900 px-2 py-1 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Portal accounts */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-300">Portal accounts</h2>
        <p className="text-xs text-slate-500">
          Offboard revokes app access (deletes the profile). Delete is the same action with a stronger confirmation.
          Auth emails remain in Supabase Auth until removed from the dashboard — there is no client-side auth-user delete.
        </p>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Owners / admins</h3>
          {owners.length === 0 && <p className="text-xs text-slate-500">None listed.</p>}
          {owners.map((p) => profileCard(p))}
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Tenants</h3>
          {tenantProfiles.length === 0 && <p className="text-xs text-slate-500">No tenant portal logins yet.</p>}
          {tenantProfiles.map((p) => profileCard(p))}
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Contractors</h3>
          {contractorProfiles.length === 0 && <p className="text-xs text-slate-500">No contractor portal logins yet.</p>}
          {contractorProfiles.map((p) => profileCard(p))}
        </div>
      </section>

      <p className="text-[10px] text-slate-600">
        Dexie roster (properties/tenants/contractors contacts) is unchanged by offboard/delete — manage those on their own pages.
      </p>

      {inviteModal && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
          <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-3 text-center">
            <h2 className="text-lg font-semibold">{inviteModal.title}</h2>
            <div className="text-3xl font-mono tracking-widest bg-slate-800 rounded-lg py-4">{inviteModal.code}</div>
            {inviteModal.note && <p className="text-xs text-slate-400">{inviteModal.note}</p>}
            <button
              type="button"
              onClick={() => setInviteModal(null)}
              className="w-full rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
          <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-3">
            <h2 className="text-lg font-semibold">
              {confirm.kind === 'delete' ? 'Delete portal user?' : 'Offboard portal user?'}
            </h2>
            <p className="text-xs text-slate-400">
              {confirm.kind === 'delete'
                ? `This permanently removes the PropertyWorks profile for ${confirm.profile.full_name || 'this user'} from your portfolio. Their Auth login may still exist in Supabase until you delete it in the dashboard.`
                : `This revokes portal access for ${confirm.profile.full_name || 'this user'}. You can invite them again later with a new code.`}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirm(null)}
                className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleConfirmRemove}
                className={`flex-1 rounded-md py-2 text-sm ${
                  confirm.kind === 'delete'
                    ? 'bg-rose-700 hover:bg-rose-600'
                    : 'bg-indigo-600 hover:bg-indigo-500'
                }`}
              >
                {busy ? 'Working…' : confirm.kind === 'delete' ? 'Delete' : 'Offboard'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
