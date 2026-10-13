// ---------------------------------------------------------------------------
// Lease + receipt text parsers (issue #14). Pure: text in, SUGGESTIONS out.
// The text comes from pdf.js / tesseract.js running in the browser; nothing
// leaves the device. Every value is a suggestion the owner confirms in the
// form. Nothing here saves anything.
// ---------------------------------------------------------------------------

export interface LeaseSuggestions {
  tenantNames: string[];
  address?: string;
  unit?: string;
  leaseStart?: string; // YYYY-MM-DD
  leaseEnd?: string;
  monthlyRent?: number;
  deposit?: number;
  govPortion?: number;
  govProgram?: 'section8' | 'cityfheps';
  tenantPortion?: number;
}

export interface ReceiptSuggestions {
  amount?: number;
  date?: string;
  vendor?: string;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONEY = String.raw`\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+(?:\.\d{2})?)`;
const DATE = String.raw`(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:day\s+of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*,?\s+\d{4})`;

const pad = (n: number) => String(n).padStart(2, '0');
function valid(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return undefined;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : undefined;
}

/** Parse one date string (US m/d/y, ISO, "March 1, 2026", "1st day of March 2026"). */
export function parseDate(raw: string): string | undefined {
  const s = raw.trim().toLowerCase();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return valid(y, +m[1], +m[2]); }
  m = s.match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (m) { const mi = MONTHS.indexOf(m[1].slice(0, 3)); return mi < 0 ? undefined : valid(+m[3], mi + 1, +m[2]); }
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(?:day\s+of\s+)?([a-z]+),?\s+(\d{4})$/);
  if (m) { const mi = MONTHS.indexOf(m[2].slice(0, 3)); return mi < 0 ? undefined : valid(+m[3], mi + 1, +m[1]); }
  return undefined;
}

export function parseMoney(raw: string): number | undefined {
  const n = Number(raw.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined;
}

const norm = (t: string) => t.replace(/\r/g, '').replace(/[ \t\u00a0]+/g, ' ');

/** First money amount within `window` chars after a label match. */
function moneyAfter(text: string, label: RegExp, window = 80): number | undefined {
  const re = new RegExp(label.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + window);
    const mm = tail.match(new RegExp(MONEY));
    if (mm && /\$|\d\.\d{2}|,\d{3}/.test(mm[0])) { const v = parseMoney(mm[1]); if (v) return v; }
  }
  return undefined;
}

function dateAfter(text: string, label: RegExp, window = 60): string | undefined {
  const re = new RegExp(label.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + window);
    const dm = tail.match(new RegExp(DATE, 'i'));
    if (dm) { const d = parseDate(dm[1]); if (d) return d; }
  }
  return undefined;
}

const NAME = String.raw`([A-Z][a-zA-Z'-]+(?:\s+[A-Z]\.?)?(?:\s+[A-Z][a-zA-Z'-]+){1,2})`;

export function parseLeaseText(raw: string): LeaseSuggestions {
  const text = norm(raw);
  const out: LeaseSuggestions = { tenantNames: [] };

  // Tenant(s): "Tenant: Jane Doe and John Roe" / "Tenant(s): A, B" / "between X (Landlord) and Y (Tenant)"
  const tm = text.match(/\b(?:tenants?|tenant\(s\)|lessees?|residents?)\s*(?:name\(s\)|names?)?\s*[:-]\s*([^\n]+)/i);
  if (tm) {
    out.tenantNames = tm[1].split(/\s*(?:,|&|\band\b|;)\s*/).map((s) => s.trim().replace(/[.("].*$/, '').trim())
      .filter((s) => new RegExp(`^${NAME}$`).test(s));
  }
  if (!out.tenantNames.length) {
    const bm = text.match(new RegExp(String.raw`and\s+${NAME}\s*\(?["“]?(?:the\s+)?["“]?(?:tenant|lessee)`, 'i'));
    if (bm) out.tenantNames = [bm[1]];
  }

  const am = text.match(/\b(?:premises|property|address|located at|leased premises)\s*(?:address)?\s*[:-]?\s*(?:is\s+)?(\d+[^\n]*?\b\d{5}(?:-\d{4})?)/i);
  if (am) out.address = am[1].trim().replace(/[,.]$/, '');
  const um = text.match(/\b(?:apartment|apt\.?|unit|suite)\s*#?\s*([A-Z0-9][A-Z0-9-]{0,5})\b/i);
  if (um) out.unit = um[1].toUpperCase();

  out.leaseStart = dateAfter(text, /\b(?:commenc\w*|start(?:ing)?\s*date|begin\w*|lease start|term\s+(?:begins|starts)|from)\b\s*(?:on|date)?\s*[:-]?/);
  out.leaseEnd = dateAfter(text, /\b(?:end(?:ing)?\s*date|expir\w*|terminat\w*|lease end|end(?:s)? on|through|until|to)\b\s*(?:on|date)?\s*[:-]?/);
  if (out.leaseStart && out.leaseEnd && out.leaseEnd <= out.leaseStart) out.leaseEnd = undefined;

  out.monthlyRent = moneyAfter(text, /\b(?:monthly rent|total (?:monthly )?rent|rent (?:is|of|shall be|amount)|rent)\b\s*[:-]?/);
  out.deposit = moneyAfter(text, /\b(?:security deposit|deposit)\b\s*(?:of|is|amount)?\s*[:-]?/);

  const prog = /cityfheps|city fheps|fheps/i.test(text) ? 'cityfheps' : /section\s*8|housing choice voucher|\bhcv\b|\bnycha\b/i.test(text) ? 'section8' : undefined;
  if (prog) {
    out.govProgram = prog;
    out.govPortion = moneyAfter(text, /\b(?:section\s*8|cityfheps|city fheps|fheps|housing authority|hap|government|subsidy|agency|voucher)\s*(?:portion|share|payment|pays|amount)?\b\s*(?:of|is|will pay|shall pay)?\s*[:-]?/);
    out.tenantPortion = moneyAfter(text, /\b(?:tenant(?:'s)?\s*(?:portion|share|rent share|pays|payment)|tenant rent)\b\s*(?:of|is)?\s*[:-]?/);
    if (out.govPortion && out.monthlyRent && out.govPortion >= out.monthlyRent) out.govPortion = undefined;
    if (!out.tenantPortion && out.govPortion && out.monthlyRent) out.tenantPortion = Math.round((out.monthlyRent - out.govPortion) * 100) / 100;
  }
  return out;
}

export function parseReceiptText(raw: string): ReceiptSuggestions {
  const text = norm(raw);
  const out: ReceiptSuggestions = {};
  out.amount = moneyAfter(text, /\b(?:amount due|total due|balance due|grand total|total amount|amount paid|total)\b\s*[:-]?/, 40);
  if (!out.amount) {
    const all = [...text.matchAll(new RegExp(String.raw`\$\s*(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})`, 'g'))].map((m) => parseMoney(m[1]) ?? 0);
    if (all.length) out.amount = Math.max(...all);
  }
  out.date = dateAfter(text, /\b(?:invoice date|bill date|statement date|date of service|service date|date)\b\s*[:-]?/, 40);
  if (!out.date) {
    const dm = text.match(new RegExp(DATE, 'i'));
    if (dm) out.date = parseDate(dm[1]);
  }
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const v = lines.find((l) => /[a-z]{3}/i.test(l) && !/\b(receipt|invoice|bill|statement|date|total|amount|page|account|customer|thank)\b/i.test(l) && !/^\d/.test(l) && !new RegExp(DATE, 'i').test(l) && l.length <= 50);
  if (v) out.vendor = v.replace(/[^\w&'.,\- ]/g, '').trim();
  return out;
}
