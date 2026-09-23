import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import {
  computePortfolioTotals, computePropertyPerformance, computeExpenseCategoryTotals, computeMonthlySeries,
  buildTaxExportWorkbook, taxExportFileName, type ReportData,
} from '../lib/reportExport';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

function currentYearRange() {
  const year = new Date().getFullYear();
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export function Reports() {
  const [{ start, end }, setRange] = useState(currentYearRange());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const properties = useLiveQuery(() => db.properties.filter((p) => !p.deleted_at).toArray(), []);
  const expenses = useLiveQuery(() => db.expenses.filter((e) => !e.deleted_at).toArray(), []);
  const rentCharges = useLiveQuery(() => db.rent_charges.filter((c) => !c.deleted_at).toArray(), []);
  const rentInstallments = useLiveQuery(() => db.rent_installments.filter((i) => !i.deleted_at).toArray(), []);
  const leases = useLiveQuery(() => db.leases.filter((l) => !l.deleted_at).toArray(), []);
  const tenants = useLiveQuery(() => db.tenants.toArray(), []);
  const rentalUnits = useLiveQuery(() => db.rental_units.toArray(), []);

  const ready = properties && expenses && rentCharges && rentInstallments && leases && tenants && rentalUnits;
  const data: ReportData | null = ready ? {
    properties, expenses, rentCharges, rentInstallments, leases, tenants, rentalUnits,
    periodStart: start, periodEnd: end,
  } : null;

  const totals = data ? computePortfolioTotals(data) : null;
  const perProperty = data ? computePropertyPerformance(data) : [];
  const categoryTotals = data ? computeExpenseCategoryTotals(data) : {};
  const monthlySeries = data ? computeMonthlySeries(data) : [];
  const categoryChartData = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([category, amount]) => ({ category, amount }));

  async function handleExport(share: boolean) {
    if (!data) return;
    setExporting(true);
    setExportError(null);
    try {
      const blob = buildTaxExportWorkbook(data);
      const fileName = taxExportFileName();
      const file = new File([blob], fileName, { type: blob.type });

      if (share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: fileName });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        if (share) setExportError("Sharing isn't supported in this browser — downloaded instead. You can share the downloaded file from your Files app.");
      }
    } catch (err) {
      // AbortError just means the person cancelled the native share sheet.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Reports &amp; Tax Export</h1>

      <div className="grid grid-cols-2 gap-2">
        <Field label="From">
          <input type="date" className={inputCls} value={start} onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))} />
        </Field>
        <Field label="To">
          <input type="date" className={inputCls} value={end} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))} />
        </Field>
      </div>
      <div className="flex gap-2 text-xs">
        <button onClick={() => setRange(currentYearRange())} className="rounded-md bg-slate-800 hover:bg-slate-700 px-2 py-1">This year</button>
        <button onClick={() => setRange({ start: '2000-01-01', end: '2100-01-01' })} className="rounded-md bg-slate-800 hover:bg-slate-700 px-2 py-1">All time</button>
      </div>

      {!totals ? (
        <p className="text-slate-400 text-sm">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <SummaryCard label="Expected rent" value={totals.expectedRent} />
            <SummaryCard label="Recorded income" value={totals.recordedIncome} tone="positive" />
            <SummaryCard label="Outstanding" value={totals.outstanding} tone={totals.outstanding > 0 ? 'warning' : undefined} />
            <SummaryCard label="Operating expenses" value={totals.operatingExpenses} tone="negative" />
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-400">Net recorded cash</div>
            <div className={`text-2xl font-semibold font-mono mt-0.5 ${totals.netRecordedCash >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              ${totals.netRecordedCash.toFixed(2)}
            </div>
          </div>

          {monthlySeries.length > 1 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-slate-300 mb-2">Income vs. expenses by month</h2>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={monthlySeries} margin={{ left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} tickLine={false} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} width={50} />
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#e2e8f0' }}
                    formatter={(value) => `$${Number(value).toFixed(2)}`}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="income" name="Income" fill="#34d399" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="expenses" name="Expenses" fill="#fb7185" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {categoryChartData.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-slate-300 mb-2">Expenses by category</h2>
              <ResponsiveContainer width="100%" height={Math.max(160, categoryChartData.length * 34)}>
                <BarChart data={categoryChartData} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category" dataKey="category" width={130}
                    tick={{ fill: '#cbd5e1', fontSize: 11 }} axisLine={false} tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#e2e8f0' }}
                    formatter={(value) => `$${Number(value).toFixed(2)}`}
                  />
                  <Bar dataKey="amount" name="Amount" fill="#818cf8" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {perProperty.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-slate-300 mb-2">By property</h2>
              <div className="space-y-2">
                {perProperty.map((p) => (
                  <div key={p.propertyId} className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center justify-between">
                    <span className="text-sm">{p.propertyName}</span>
                    <span className={`font-mono text-sm ${p.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>${p.net.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {exportError && <p className="text-xs text-amber-300">{exportError}</p>}

          <div className="flex gap-2 pt-2">
            <button
              onClick={() => handleExport(false)}
              disabled={exporting}
              className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-50 py-2 text-sm font-medium"
            >
              {exporting ? 'Preparing…' : 'Download Excel'}
            </button>
            <button
              onClick={() => handleExport(true)}
              disabled={exporting}
              className="flex-1 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2 text-sm font-medium"
            >
              Share
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            Excel file with Portfolio Summary, Income Ledger, Expense Ledger, and Property Detail sheets — built on this device, nothing sent to a server.
          </p>
        </>
      )}
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
function SummaryCard({ label, value, tone }: { label: string; value: number; tone?: 'positive' | 'negative' | 'warning' }) {
  const color = tone === 'positive' ? 'text-emerald-400' : tone === 'negative' ? 'text-rose-400' : tone === 'warning' ? 'text-amber-400' : '';
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-xl font-semibold font-mono mt-0.5 ${color}`}>${value.toFixed(2)}</div>
    </div>
  );
}
