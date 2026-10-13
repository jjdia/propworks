import { useState } from 'react';
import { buildVendorLink, CATEGORY_LABEL, type RepairCategory } from '../lib/vendorLink';
import type { MaintenanceRequest, Property } from '../lib/types';

// Issue #16: "Hire a pro" deep link on a work order. No API calls; opens
// Thumbtack's public category page for the property ZIP in a new tab.
export function HireProLink({ request, property }: { request: MaintenanceRequest; property?: Property }) {
  const [override, setOverride] = useState<RepairCategory | undefined>();
  const [copied, setCopied] = useState(false);
  const link = buildVendorLink(request, property, override);

  async function copyBrief() {
    try {
      await navigator.clipboard.writeText(link.brief);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
      <a href={link.url} target="_blank" rel="noopener noreferrer" className="rounded-md bg-sky-800 hover:bg-sky-700 px-2 py-1">
        Hire a {link.label} on Thumbtack{link.zip ? ` · ${link.zip}` : ''} ↗
      </a>
      <select
        aria-label="Trade"
        value={link.category}
        onChange={(e) => setOverride(e.target.value as RepairCategory)}
        className="bg-slate-800 rounded-md px-1 py-1"
      >
        {(Object.keys(CATEGORY_LABEL) as RepairCategory[]).map((k) => <option key={k} value={k}>{CATEGORY_LABEL[k]}</option>)}
      </select>
      <button onClick={copyBrief} className="rounded-md bg-slate-800 hover:bg-slate-700 px-2 py-1">{copied ? 'Copied ✓' : 'Copy job details'}</button>
      {!link.zip && <span className="text-amber-400">Add a ZIP to the property for local results</span>}
    </div>
  );
}
