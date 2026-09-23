import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { Link } from 'react-router-dom';
import { computePortfolioTotals, computePropertyPerformance, computeExpenseCategoryTotals, computeMonthlySeries, type ReportData } from '../lib/reportExport';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

function currentYearRange() {
  const year = new Date().getFullYear();
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export function Dashboard() {
  const properties = useLiveQuery(() => db.properties.filter((p) => !p.deleted_at).toArray(), []);
  const leases = useLiveQuery(() => db.leases.filter((l) => !l.deleted_at && l.status === 'active').toArray(), []);
  const expenses = useLiveQuery(() => db.expenses.filter((e) => !e.deleted_at).toArray(), []);
  const charges = useLiveQuery(() => db.rent_charges.filter((c) => !c.deleted_at).toArray(), []);
  const installments = useLiveQuery(() => db.rent_installments.filter((i) => !i.deleted_at).toArray(), []);
  const tenants = useLiveQuery(() => db.tenants.toArray(), []);
  const rentalUnits = useLiveQuery(() => db.rental_units.toArray(), []);

  const totalExpenses = expenses?.reduce((sum, e) => sum + Number(e.amount), 0) ?? 0;
  const monthlyRentRoll = leases?.reduce((sum, l) => sum + Number(l.total_monthly_rent), 0) ?? 0;
  const outstandingCharges = charges?.filter((c) => c.status === 'due' || c.status === 'late' || c.status === 'partial').length ?? 0;
  const recordedIncome = installments
    ?.filter((i) => i.status === 'paid' || i.status === 'partial')
    .reduce((sum, i) => sum + Number(i.paid_amount ?? 0), 0) ?? 0;
  const netCashFlow = recordedIncome - totalExpenses;

  const ready = properties && expenses && charges && installments && leases && tenants && rentalUnits;
  const { start, end } = currentYearRange();
  const snapshotData: ReportData | null = ready ? {
    properties, expenses, rentCharges: charges, rentInstallments: installments,
    leases, tenants, rentalUnits, periodStart: start, periodEnd: end,
  } : null;
  const snapshotTotals = snapshotData ? computePortfolioTotals(snapshotData) : null;
  const snapshotByProperty = snapshotData ? computePropertyPerformance(snapshotData).filter((p) => p.expectedRent > 0 || p.expenses > 0) : [];
  const snapshotCategories = snapshotData ? Object.entries(computeExpenseCategoryTotals(snapshotData)).sort((a, b) => b[1] - a[1]).slice(0, 3) : [];
  const snapshotSeries = snapshotData ? computeMonthlySeries(snapshotData) : [];

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Properties" value={properties?.length ?? 0} to="/properties" />
        <StatCard label="Active leases" value={leases?.length ?? 0} to="/rent" />
        <StatCard label="Recorded income" value={`$${recordedIncome.toFixed(0)}`} to="/reports" tone="positive" />
        <StatCard label="Recorded expenses" value={`$${totalExpenses.toFixed(0)}`} to="/expenses" tone="negative" />
        <StatCard label="Net cash flow" value={`$${netCashFlow.toFixed(0)}`} to="/reports" tone={netCashFlow >= 0 ? 'positive' : 'negative'} />
        <StatCard label="Monthly rent roll" value={`$${monthlyRentRoll.toFixed(0)}`} to="/rent" />
      </div>

      {outstandingCharges > 0 && (
        <Link to="/rent" className="block bg-amber-950 border border-amber-800 rounded-xl p-3 text-sm text-amber-200">
          {outstandingCharges} rent charge{outstandingCharges === 1 ? '' : 's'} need attention this month →
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link to="/properties" className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-sm font-medium hover:border-slate-700">
          + Add property
        </Link>
        <Link to="/expenses" className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-sm font-medium hover:border-slate-700">
          + Log expense
        </Link>
      </div>

      <Link to="/reports" className="block bg-slate-900 border border-slate-800 rounded-xl p-4 text-sm font-medium hover:border-slate-700 text-center">
        📊 Reports &amp; Tax Export
      </Link>

      {snapshotTotals && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-300">Snapshot — {new Date().getFullYear()}</h2>
            <Link to="/reports" className="text-xs text-indigo-400">Full report →</Link>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-[11px] text-slate-500">Expected rent</div>
              <div className="font-mono">${snapshotTotals.expectedRent.toFixed(0)}</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">Recorded income</div>
              <div className="font-mono text-emerald-400">${snapshotTotals.recordedIncome.toFixed(0)}</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">Outstanding</div>
              <div className={`font-mono ${snapshotTotals.outstanding > 0 ? 'text-amber-400' : ''}`}>${snapshotTotals.outstanding.toFixed(0)}</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">Net recorded cash</div>
              <div className={`font-mono ${snapshotTotals.netRecordedCash >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>${snapshotTotals.netRecordedCash.toFixed(0)}</div>
            </div>
          </div>

          {snapshotSeries.length > 1 && (
            <div className="pt-2 border-t border-slate-800">
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={snapshotSeries} margin={{ left: -25, top: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={{ stroke: '#334155' }} tickLine={false} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#e2e8f0' }}
                    formatter={(value) => `$${Number(value).toFixed(2)}`}
                  />
                  <Bar dataKey="income" name="Income" fill="#34d399" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="expenses" name="Expenses" fill="#fb7185" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {snapshotByProperty.length > 0 && (
            <div className="pt-2 border-t border-slate-800 space-y-1">
              <div className="text-[11px] text-slate-500">By property</div>
              {snapshotByProperty.map((p) => (
                <div key={p.propertyId} className="flex items-center justify-between text-sm">
                  <span className="text-slate-300">{p.propertyName}</span>
                  <span className={`font-mono ${p.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>${p.net.toFixed(0)}</span>
                </div>
              ))}
            </div>
          )}

          {snapshotCategories.length > 0 && (
            <div className="pt-2 border-t border-slate-800 space-y-1">
              <div className="text-[11px] text-slate-500">Top expense categories</div>
              {snapshotCategories.map(([cat, amt]) => (
                <div key={cat} className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">{cat}</span>
                  <span className="font-mono">${amt.toFixed(0)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, to, tone }: { label: string; value: string | number; to: string; tone?: 'positive' | 'negative' }) {
  const color = tone === 'positive' ? 'text-emerald-400' : tone === 'negative' ? 'text-rose-400' : '';
  return (
    <Link to={to} className="block bg-slate-900 border border-slate-800 rounded-xl p-4 hover:border-slate-700">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-xl font-semibold font-mono mt-0.5 ${color}`}>{value}</div>
    </Link>
  );
}
