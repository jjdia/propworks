import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { computeOverdueItems, summarizeOverdue } from '../lib/overdue';
import { maybeShowOverdueNotification } from '../lib/localNotifications';
import { useAppStore } from '../store/useAppStore';
import { APP_VERSION } from '../version';
import type { RentInstallment, RentCharge, Lease, Tenant, RentalUnit, Property } from '../lib/types';

interface NavItem { to: string; label: string; icon: string; badge?: boolean }

const OWNER_NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: '🏠' },
  { to: '/properties', label: 'Properties', icon: '🏢' },
  { to: '/rent', label: 'Rent', icon: '💵', badge: true },
  { to: '/maintenance', label: 'Maintenance', icon: '🔧' },
  { to: '/more', label: 'More', icon: '⋯' },
];

const TENANT_NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: '🏠' },
  { to: '/account', label: 'Account', icon: '👤' },
];

const CONTRACTOR_NAV: NavItem[] = [
  { to: '/', label: 'Jobs', icon: '🛠️' },
  { to: '/account', label: 'Account', icon: '👤' },
];

const STATUS_LABEL: Record<string, string> = {
  idle: 'Synced',
  syncing: 'Syncing…',
  error: 'Sync issue — data safe locally',
  offline: 'Offline — saved on this device',
};

export function Layout() {
  const syncStatus = useAppStore((s) => s.syncStatus);
  const localOnly = useAppStore((s) => s.localOnly);
  const role = useAppStore((s) => s.profile?.role) ?? 'owner';

  const nav = role === 'tenant' ? TENANT_NAV : role === 'contractor' ? CONTRACTOR_NAV : OWNER_NAV;

  // Computed once here (not per-page) so the nav badge and the
  // once-a-day foreground reminder work no matter which screen is open.
  const installments = useLiveQuery<RentInstallment[] | undefined>(() => role === 'owner' ? db.rent_installments.filter((i) => !i.deleted_at).toArray() : undefined, [role]);
  const rentCharges = useLiveQuery<RentCharge[] | undefined>(() => role === 'owner' ? db.rent_charges.filter((c) => !c.deleted_at).toArray() : undefined, [role]);
  const leases = useLiveQuery<Lease[] | undefined>(() => role === 'owner' ? db.leases.filter((l) => !l.deleted_at).toArray() : undefined, [role]);
  const tenants = useLiveQuery<Tenant[] | undefined>(() => role === 'owner' ? db.tenants.toArray() : undefined, [role]);
  const rentalUnits = useLiveQuery<RentalUnit[] | undefined>(() => role === 'owner' ? db.rental_units.toArray() : undefined, [role]);
  const properties = useLiveQuery<Property[] | undefined>(() => role === 'owner' ? db.properties.toArray() : undefined, [role]);

  const overdueReady = installments && rentCharges && leases && tenants && rentalUnits && properties;
  const overdueSummary = overdueReady ? summarizeOverdue(computeOverdueItems({
    installments, rentCharges, leases, tenants, rentalUnits, properties,
    today: new Date().toISOString().slice(0, 10),
  })) : null;

  useEffect(() => {
    if (overdueSummary) {
      maybeShowOverdueNotification(overdueSummary.count, overdueSummary.total, overdueSummary.tenantCount);
    }
  }, [overdueSummary]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="border-b border-slate-800 px-4 py-3 flex items-center justify-between sticky top-0 bg-slate-950/95 backdrop-blur z-10">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold tracking-tight">PropertyWorks</span>
          <span className="text-[10px] text-slate-500 font-mono">{APP_VERSION}</span>
        </div>
        <div className="text-xs text-slate-400 flex items-center gap-1">
          <span className={`inline-block w-2 h-2 rounded-full ${
            syncStatus === 'idle' ? 'bg-emerald-400' :
            syncStatus === 'syncing' ? 'bg-amber-400 animate-pulse' :
            syncStatus === 'error' ? 'bg-rose-400' : 'bg-slate-500'
          }`} />
          {localOnly ? 'Local only' : STATUS_LABEL[syncStatus]}
        </div>
      </header>

      <main className="flex-1 px-4 py-4 pb-24 max-w-3xl w-full mx-auto">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 inset-x-0 border-t border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="max-w-3xl mx-auto grid" style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}>
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `relative flex flex-col items-center gap-0.5 py-2 text-xs ${
                  isActive ? 'text-indigo-400' : 'text-slate-400'
                }`
              }
            >
              <span className="relative text-lg leading-none">
                {item.icon}
                {item.badge && overdueSummary && overdueSummary.count > 0 && (
                  <span className="absolute -top-1 -right-2 bg-rose-500 text-white text-[9px] leading-none rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5">
                    {overdueSummary.count > 9 ? '9+' : overdueSummary.count}
                  </span>
                )}
              </span>
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
