// ---------------------------------------------------------------------------
// "Hire a pro" vendor deep link from a work order (issue #16).
// Pure, no network, no paid API, no scraping: the trade category is inferred
// from the work order's title + description, the ZIP comes from the
// property, and we build a public Thumbtack "near me" category URL.
// The description itself is NOT put in the URL (it can contain tenant
// details); the UI offers it as copy-to-clipboard text for the vendor form.
// ---------------------------------------------------------------------------

export type RepairCategory =
  | 'plumbing' | 'electrical' | 'hvac' | 'appliance' | 'pest'
  | 'locksmith' | 'roofing' | 'handyman';

export const CATEGORY_LABEL: Record<RepairCategory, string> = {
  plumbing: 'Plumber', electrical: 'Electrician', hvac: 'HVAC pro', appliance: 'Appliance repair',
  pest: 'Exterminator', locksmith: 'Locksmith', roofing: 'Roofer', handyman: 'Handyman',
};

/** Thumbtack /k/<slug>/near-me pages (checked live 2026-10-13). */
export const THUMBTACK_SLUG: Record<RepairCategory, string> = {
  plumbing: 'plumbers', electrical: 'electricians', hvac: 'hvac-contractors', appliance: 'appliance-repair',
  pest: 'exterminators', locksmith: 'locksmiths', roofing: 'roofing', handyman: 'handyman',
};

// Order matters: first match wins (more specific trades first).
const RULES: [RepairCategory, RegExp][] = [
  ['pest', /\b(roach(es)?|cockroach(es)?|mice|mouse|rats?|rodent|bed ?bugs?|ants?|termite|pest|exterminat|wasp|bees?)\b/],
  ['locksmith', /\b(lock(ed)? out|lockout|locks?|deadbolt|keys?|locksmith)\b/],
  ['roofing', /\b(roof|shingle|gutter|skylight)\b/],
  ['appliance', /\b(fridge|refrigerator|freezer|dishwasher|washer|dryer|washing machine|oven|stove|range|microwave|appliance)\b/],
  ['hvac', /\b(heat|heating|heater|no heat|boiler|furnace|radiator|a\/?c|air ?condition\w*|hvac|thermostat|vent)\b/],
  ['plumbing', /\b(leak\w*|pipes?|plumb\w*|toilet|sink|faucet|drain|clog\w*|sewer|water heater|hot water|shower|tub|bathtub)\b/],
  ['electrical', /\b(electric\w*|outlets?|breaker|fuse|wiring|wires?|lights?|switch|sparks?|power|gfci)\b/],
];

export function inferCategory(title: string, description?: string | null): RepairCategory {
  const text = `${title} ${description ?? ''}`.toLowerCase();
  for (const [cat, re] of RULES) if (re.test(text)) return cat;
  return 'handyman';
}

/** First 5-digit US ZIP in the string, else null. */
export function normalizeZip(zip?: string | null): string | null {
  const m = String(zip ?? '').match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : null;
}

export interface VendorLink { category: RepairCategory; label: string; zip: string | null; url: string; brief: string }

export function buildVendorLink(
  req: { title: string; description?: string | null },
  property?: { zip?: string | null; city?: string | null; state?: string | null } | null,
  category?: RepairCategory,
): VendorLink {
  const cat = category ?? inferCategory(req.title, req.description);
  const zip = normalizeZip(property?.zip);
  const url = new URL(`https://www.thumbtack.com/k/${THUMBTACK_SLUG[cat]}/near-me`);
  if (zip) url.searchParams.set('zip_code', zip);
  const where = [property?.city, property?.state, zip].filter(Boolean).join(', ');
  const brief = [req.title.trim(), req.description?.trim(), where && `Location: ${where}`].filter(Boolean).join('\n');
  return { category: cat, label: CATEGORY_LABEL[cat], zip, url: url.toString(), brief };
}
