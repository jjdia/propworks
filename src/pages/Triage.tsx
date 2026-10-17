import { BillsDueCard } from '../components/BillsDueCard';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { format } from 'date-fns';
import { db } from '../lib/db';
import { fmtMoney } from '../lib/chargeStatus';
import { balanceTriage, endingLeases, ENDING_BUCKET_LABEL, type EndingBucket } from '../lib/triage';

// Issue #15: read-only triage view. Derived entirely from local Dexie data.
export function Triage() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const leases = useLiveQuery(() => db.leases.filter((l) => !l.deleted_at).toArray(), []);
  const charges = useLiveQuery(() => db.rent_charges.filter((c) => !c.deleted_at).toArray(), []);
  const installments = useLiveQuery(() => db.rent_installments.filter((i) => !i.deleted_at).toArray(), []);
  const tenants = useLiveQuery(() => db.tenants.toArray(), []);
  const units = useLiveQuery(() => db.rental_units.toArray(), []);

  const balances = useMemo(() => (leases && charges && installments ? balanceTriage(leases, charges, installments, today) : null), [leases, charges, installments, today]);
  const ending = useMemo(() => (leases ? endingLeases(leases, today) : []), [leases, today]);

  if (!balances) return <p className="text-sm text-slate-400">Loading…</p>;
  const tenantName = (id: string) => tenants?.find((t) => t.id === id)?.full_name ?? 'Unknown tenant';
  const unitName = (leaseId: string) => {
    const l = leases?.find((x) => x.id === leaseId);
    return units?.find((u) => u.id === l?.rental_unit_id)?.name ?? '';
  };
  const buckets: EndingBucket[] = ['overdue', '30', '60', '90'];
  const monthLabel = (m: string) => format(new Date(m + 'T00:00:00'), 'MMM yyyy');

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Triage — balances &amp; ending leases</h1>
      <BillsDueCard compact />

      <section className="space-y-2">
        <h2 className="font-medium">Who owes what</h2>
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-3 text-sm">
          <div className="flex justify-between font-semibold"><span>Total outstanding</span><span>{fmtMoney(balances.totalOutstanding)}</span></div>
          {balances.byPayer.map((p) => (
            <div key={p.key} className="flex justify-between text-slate-300"><span>{p.label}</span><span>{fmtMoney(p.amount)}</span></div>
          ))}
        </div>
        {balances.leases.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing outstanding. 🎉</p>
        ) : (
          <ul className="space-y-2">
            {balances.leases.map((b) => (
              <li key={b.leaseId} className="rounded-xl bg-slate-900 border border-slate-800 p-3 text-sm">
                <div className="flex justify-between font-medium">
                  <span>{tenantName(b.tenantId)} <span className="text-slate-400">{unitName(b.leaseId)}</span></span>
                  <span>{fmtMoney(b.outstanding)}</span>
                </div>
                <div className="text-xs text-slate-400">
                  {b.setupLabel} · {b.byPayer.gov ? `Gov ${fmtMoney(b.byPayer.gov)} · ` : ''}{b.byPayer.tenant ? `Tenant ${fmtMoney(b.byPayer.tenant)} · ` : ''}{b.byPayer.hra ? `HRA ${fmtMoney(b.byPayer.hra)} · ` : ''}
                  {b.months.map(monthLabel).join(', ')}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Link to="/rent" className="text-xs text-sky-400">Record payments on Rent →</Link>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Leases ending soon</h2>
        {ending.length === 0 && <p className="text-sm text-slate-400">No active leases end in the next 90 days.</p>}
        {buckets.map((k) => {
          const rows = ending.filter((e) => e.bucket === k);
          if (!rows.length) return null;
          return (
            <div key={k} className="space-y-1">
              <h3 className="text-xs uppercase tracking-wide text-slate-400">{ENDING_BUCKET_LABEL[k]} ({rows.length})</h3>
              <ul className="space-y-1">
                {rows.map((e) => (
                  <li key={e.leaseId} className="flex justify-between rounded-xl bg-slate-900 border border-slate-800 p-3 text-sm">
                    <span>{tenantName(e.tenantId)} <span className="text-slate-400">{unitName(e.leaseId)}</span></span>
                    <span className={e.daysLeft < 0 ? 'text-rose-400' : ''}>{e.leaseEnd} · {e.daysLeft < 0 ? `${-e.daysLeft}d ago` : `${e.daysLeft}d`}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>
    </div>
  );
}
