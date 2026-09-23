import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { computeOverdueItems, summarizeOverdue } from '../lib/overdue';
import { notificationsSupported, requestNotificationPermission } from '../lib/localNotifications';

const PORTION_LABEL: Record<string, string> = { section8: 'Section 8', cityfheps: 'CityFHEPS', hra: 'HRA', tenant: 'Tenant' };

export function Notifications() {
  const [permission, setPermission] = useState(notificationsSupported() ? Notification.permission : 'unsupported');

  const installments = useLiveQuery(() => db.rent_installments.filter((i) => !i.deleted_at).toArray(), []);
  const rentCharges = useLiveQuery(() => db.rent_charges.filter((c) => !c.deleted_at).toArray(), []);
  const leases = useLiveQuery(() => db.leases.filter((l) => !l.deleted_at).toArray(), []);
  const tenants = useLiveQuery(() => db.tenants.toArray(), []);
  const rentalUnits = useLiveQuery(() => db.rental_units.toArray(), []);
  const properties = useLiveQuery(() => db.properties.toArray(), []);

  const ready = installments && rentCharges && leases && tenants && rentalUnits && properties;
  const items = ready ? computeOverdueItems({
    installments, rentCharges, leases, tenants, rentalUnits, properties,
    today: new Date().toISOString().slice(0, 10),
  }) : [];
  const summary = summarizeOverdue(items);

  async function handleEnableNotifications() {
    const result = await requestNotificationPermission();
    setPermission(result);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Notifications</h1>

      {notificationsSupported() && permission !== 'granted' && (
        <button onClick={handleEnableNotifications} className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-sm text-left hover:border-slate-700">
          <span className="font-medium">Turn on reminders</span>
          <p className="text-xs text-slate-400 mt-0.5">Get a notification when you open the app if any rent is unpaid. Won't fire more than once a day.</p>
        </button>
      )}

      {items.length === 0 ? (
        <p className="text-slate-400 text-sm">Nothing outstanding — everything's paid up.</p>
      ) : (
        <>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-400">Total outstanding</div>
            <div className="text-2xl font-semibold font-mono mt-0.5 text-rose-400">${summary.total.toFixed(2)}</div>
            <div className="text-xs text-slate-500 mt-1">{summary.count} installment{summary.count === 1 ? '' : 's'} across {summary.tenantCount} tenant{summary.tenantCount === 1 ? '' : 's'}</div>
          </div>

          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.installmentId} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-medium">{item.tenantName}</div>
                    <div className="text-xs text-slate-400">{item.propertyName} · {item.unitName}</div>
                  </div>
                  <span className="font-mono text-sm text-rose-400">${item.amount.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] uppercase tracking-wide bg-slate-800 rounded px-1.5 py-0.5 text-slate-300">
                    {item.portion === 'government' ? PORTION_LABEL[item.payer] : 'Tenant'}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Due {item.dueDate}{item.daysOverdue > 0 ? ` · ${item.daysOverdue} day${item.daysOverdue === 1 ? '' : 's'} overdue` : ' · due today'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
