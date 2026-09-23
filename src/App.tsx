import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { supabaseConfigured } from './lib/supabase';
import { getSession, onAuthChange } from './lib/auth';
import { getMyProfile } from './lib/maintenance';
import { startBackgroundSync, onSyncStatus } from './lib/sync';
import { useAppStore } from './store/useAppStore';
import { Layout } from './components/Layout';
import { RecoveryBoundary } from './components/RecoveryBoundary';
import { Dashboard } from './pages/Dashboard';
import { Properties } from './pages/Properties';
import { RentTracking } from './pages/RentTracking';
import { Expenses } from './pages/Expenses';
import { Tenants } from './pages/Tenants';
import { Contractors } from './pages/Contractors';
import { Maintenance } from './pages/Maintenance';
import { Reports } from './pages/Reports';
import { LeaseGenerator } from './pages/LeaseGenerator';
import { Documents } from './pages/Documents';
import { Notifications } from './pages/Notifications';
import { Broadcasts } from './pages/Broadcasts';
import { More } from './pages/More';
import { TenantHome } from './pages/TenantHome';
import { ContractorJobs } from './pages/ContractorJobs';
import { Account } from './pages/Account';
import { AdminUsersPage } from './pages/admin';
import { Login } from './pages/Login';
import { SetNewPassword } from './pages/SetNewPassword';

// HashRouter (not BrowserRouter) deliberately - GitHub Pages/Netlify serve
// this as a static site with no guaranteed server-side rewrite, so a
// path-based router would 404 on refresh at any route other than "/".
export default function App() {
  const [ready, setReady] = useState(false);
  const ownerId = useAppStore((s) => s.ownerId);
  const profile = useAppStore((s) => s.profile);
  const setSession = useAppStore((s) => s.setSession);
  const setProfile = useAppStore((s) => s.setProfile);
  const setSyncStatus = useAppStore((s) => s.setSyncStatus);
  const setLocalOnly = useAppStore((s) => s.setLocalOnly);
  const passwordRecoveryMode = useAppStore((s) => s.passwordRecoveryMode);
  const setPasswordRecoveryMode = useAppStore((s) => s.setPasswordRecoveryMode);

  useEffect(() => {
    const unsubStatus = onSyncStatus(setSyncStatus);

    if (!supabaseConfigured) {
      // No Supabase project wired up: run fully local, owner-only. The
      // tenant/contractor workflow needs Supabase (it's shared, multi-party
      // state) so it simply isn't reachable in this mode.
      setLocalOnly(true);
      setSession('local-owner', null);
      setProfile({ id: 'local-owner', owner_id: 'local-owner', role: 'owner', full_name: null, phone: null, tenant_id: null, contractor_status: null, trade: null });
      setReady(true);
      return () => unsubStatus();
    }

    async function loadSessionAndProfile() {
      const session = await getSession();
      setSession(session?.user.id ?? null, session?.user.email ?? null);
      if (session?.user.id) {
        try {
          const p = await getMyProfile();
          setProfile(p);
          // Data reads/writes use the PORTFOLIO id (profile.owner_id), not
          // the login's own id — for a solo owner these are the same, but
          // for a co-owner who joined someone else's portfolio via invite
          // they differ, and everything must scope to the shared portfolio.
          if (p) setSession(p.owner_id, session.user.email ?? null);
        } catch (err) {
          console.error('Failed to load profile', err);
        }
      }
      setReady(true);
    }
    loadSessionAndProfile();

    const unsubAuth = onAuthChange(async (session, event) => {
      if (event === 'PASSWORD_RECOVERY') {
        // Clicking the reset-password email link lands here with a
        // freshly-established recovery session — show the "set a new
        // password" screen instead of dropping them straight into the app
        // (or, worse, a login screen with no obvious next step).
        setPasswordRecoveryMode(true);
      }
      setSession(session?.user.id ?? null, session?.user.email ?? null);
      if (session?.user.id) {
        try {
          let profile = await getMyProfile();
          if (!profile) {
            await new Promise((r) => setTimeout(r, 700));
            profile = await getMyProfile();
          }
          setProfile(profile);
          if (profile) setSession(profile.owner_id, session.user.email ?? null);
        } catch (err) {
          console.error('Failed to load profile', err);
        }
      } else {
        setProfile(null);
      }
    });
    return () => { unsubStatus(); unsubAuth(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Only the owner's private financial data goes through the local-first
    // Dexie sync engine. Tenants/contractors don't have (or need) that
    // local dataset — their pages talk to Supabase directly.
    if (ready && ownerId && profile?.role === 'owner') {
      startBackgroundSync(() => ownerId);
    }
  }, [ready, ownerId, profile?.role]);

  if (!ready) return null;
  if (passwordRecoveryMode) return <SetNewPassword />;
  if (supabaseConfigured && (!ownerId || !profile)) return <Login />;

  return (
    <RecoveryBoundary>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/account" element={<Account />} />
            {profile?.role === 'tenant' && (
              <Route path="/" element={<TenantHome />} />
            )}
            {profile?.role === 'contractor' && (
              <Route path="/" element={<ContractorJobs />} />
            )}
            {(!profile || profile.role === 'owner') && (
              <>
                <Route path="/" element={<Dashboard />} />
                <Route path="/properties" element={<Properties />} />
                <Route path="/rent" element={<RentTracking />} />
                <Route path="/expenses" element={<Expenses />} />
                <Route path="/tenants" element={<Tenants />} />
                <Route path="/contractors" element={<Contractors />} />
                <Route path="/maintenance" element={<Maintenance />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/lease-generator" element={<LeaseGenerator />} />
                <Route path="/documents" element={<Documents />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/broadcasts" element={<Broadcasts />} />
                <Route path="/more" element={<More />} />
                <Route path="/admin" element={<AdminUsersPage />} />
              </>
            )}
          </Route>
        </Routes>
      </HashRouter>
    </RecoveryBoundary>
  );
}
