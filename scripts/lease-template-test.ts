import { buildLeaseDocument, lawfulLateFeeCap, LEGAL_REVIEW_NOTICE, type LeaseDocInput } from '../src/lib/leaseTemplate';
import { buildGarageDocument, GARAGE_LEGAL_REVIEW_NOTICE, type GarageDocInput } from '../src/lib/garageTemplate';

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`);
  if (cond) pass++; else fail++;
}

function baseInput(overrides: Partial<LeaseDocInput> = {}): LeaseDocInput {
  return {
    landlordName: 'Jeff Jdia', propertyAddress: '62 Fillmore Street, Staten Island, NY 10301',
    unitName: 'Unit 1', tenantNames: 'Jane Doe', leaseStart: '2026-01-01', leaseEnd: '2026-12-31',
    isRenewal: false, monthlyRent: 2000, dueDay: 1, utilityAssignment: {}, petsAllowed: false,
    smokingAllowed: false, parkingIncluded: false, backyardAccess: false, garageOrBasementAccess: false,
    insuranceRequired: false, builtBefore1978: false, rentStabilized: false,
    goodCauseApplies: false, goodCauseSmallLandlordExempt: false, bedBugHistory: false, windowGuardsRequired: false,
    sprinklerSystemPresent: false, stoveKnobCoversRequired: false, floodRisk: false,
    section8OrCityfhepsAddendumRequired: false, rentStabilizedRiderRequired: false,
    ...overrides,
  };
}

function hasHeading(doc: ReturnType<typeof buildLeaseDocument>, heading: string) {
  return doc.sections.some((s) => s.heading.includes(heading));
}
function bodyText(doc: ReturnType<typeof buildLeaseDocument>, heading: string) {
  return doc.sections.find((s) => s.heading.includes(heading))?.body.join(' ') ?? '';
}

// --- Lead paint disclosure only for pre-1978 buildings ---
{
  const withLead = buildLeaseDocument(baseInput({ builtBefore1978: true }));
  const withoutLead = buildLeaseDocument(baseInput({ builtBefore1978: false }));
  check('pre-1978 building includes lead paint disclosure', hasHeading(withLead, 'Lead-Based Paint'));
  check('post-1978 building omits lead paint disclosure', !hasHeading(withoutLead, 'Lead-Based Paint'));
}

// --- Bed bug disclosure is ALWAYS present (required either way) ---
{
  const withHistory = buildLeaseDocument(baseInput({ bedBugHistory: true, bedBugDetails: 'Unit 3B, treated June 2025' }));
  const withoutHistory = buildLeaseDocument(baseInput({ bedBugHistory: false }));
  check('bed bug section present when there IS history', hasHeading(withHistory, 'Bed Bug'));
  check('bed bug section present when there is NO history (still required to disclose that)', hasHeading(withoutHistory, 'Bed Bug'));
  check('bed bug details text appears when provided', bodyText(withHistory, 'Bed Bug').includes('Unit 3B, treated June 2025'));
  check('no-history version says no known history', bodyText(withoutHistory, 'Bed Bug').toLowerCase().includes('no history'));
}

// --- Window guards only when toggled ---
{
  const withGuards = buildLeaseDocument(baseInput({ windowGuardsRequired: true }));
  const withoutGuards = buildLeaseDocument(baseInput({ windowGuardsRequired: false }));
  check('window guards section present when required', hasHeading(withGuards, 'Window Guards'));
  check('window guards section absent when not required', !hasHeading(withoutGuards, 'Window Guards'));
}

// --- Good Cause / rent stabilization only when applicable ---
{
  const doc = buildLeaseDocument(baseInput({ goodCauseApplies: true, rentStabilized: true }));
  const plain = buildLeaseDocument(baseInput());
  check('Good Cause notice present when applicable', hasHeading(doc, 'Good Cause'));
  check('Rent Stabilization notice present when applicable', hasHeading(doc, 'Rent Stabilization'));
  check('neither present for a plain market lease', !hasHeading(plain, 'Good Cause') && !hasHeading(plain, 'Rent Stabilization'));
}

// --- Good Cause small-landlord exemption path ---
{
  const doc = buildLeaseDocument(baseInput({ goodCauseApplies: false, goodCauseSmallLandlordExempt: true }));
  check('exemption-claimed notice present when small-landlord exemption checked', hasHeading(doc, 'Exemption Claimed'));
  check('exemption notice references the official NY Courts form', bodyText(doc, 'Exemption Claimed').includes('nycourts.gov'));
}

// --- Security deposit clause only appears if a deposit is set, and states the 1-month-max rule ---
{
  const withDeposit = buildLeaseDocument(baseInput({ securityDeposit: 2000 }));
  const noDeposit = buildLeaseDocument(baseInput({ securityDeposit: undefined }));
  check('security deposit section present when set', hasHeading(withDeposit, 'Security Deposit'));
  check('security deposit section absent when not set', !hasHeading(noDeposit, 'Security Deposit'));
  check('mentions the one month statutory cap', bodyText(withDeposit, 'Security Deposit').includes("one month's rent"));
}

// --- Subsidy program math shows up correctly in the rent clause ---
{
  const doc = buildLeaseDocument(baseInput({ subsidyProgram: 'hra', governmentPortion: 1500, tenantPortion: 500, monthlyRent: 2000 }));
  const rentText = bodyText(doc, '3. Rent') || bodyText(doc, 'Rent');
  check('subsidy program name (HRA) appears in rent clause', rentText.includes('HRA'));
  check('government portion dollar amount appears', rentText.includes('$1500.00'));
}

// --- Late fee is always auto-capped at the lesser of $50 or 5% of rent (never free text) ---
{
  check('lawfulLateFeeCap picks $50 when 5% would exceed it (rent $2000 -> 5% = $100)', lawfulLateFeeCap(2000) === 50);
  check('lawfulLateFeeCap picks 5% when it is less than $50 (rent $600 -> 5% = $30)', lawfulLateFeeCap(600) === 30);
  const doc = buildLeaseDocument(baseInput({ monthlyRent: 2000 }));
  const rentText = bodyText(doc, '3. Rent');
  check('rent clause cites the $50 cap for a $2000/mo lease', rentText.includes('$50.00'));
  check('rent clause cites RPL 238-a', rentText.includes('238-a'));
}

// --- Itemized utility assignment ---
{
  const doc = buildLeaseDocument(baseInput({ utilityAssignment: { Water: 'landlord', Electricity: 'tenant' } }));
  const text = bodyText(doc, 'Utilities');
  check('itemized utility assignment shows Water paid by Landlord', text.includes('Water: paid by Landlord'));
  check('itemized utility assignment shows Electricity paid by Tenant', text.includes('Electricity: paid by Tenant'));
}

// --- Joint and several liability only appears with multiple tenants ---
{
  const single = buildLeaseDocument(baseInput({ tenantNames: 'Jane Doe' }));
  const multiple = buildLeaseDocument(baseInput({ tenantNames: 'Jane Doe, John Doe' }));
  check('single tenant: no joint-and-several clause', !bodyText(single, 'Parties').includes('jointly and severally'));
  check('multiple tenants: joint-and-several clause present', bodyText(multiple, 'Parties').includes('jointly and severally'));
  check('multiple tenants: extra signature line added', multiple.sections.find((s) => s.heading === 'Signatures')!.body.some((b) => b.includes('Additional Tenant')));
}

// --- Short-term rental / Airbnb prohibition always present ---
check('Use of Premises clause prohibits short-term/Airbnb use', bodyText(buildLeaseDocument(baseInput()), 'Use of Premises').toLowerCase().includes('airbnb'));

// --- Reciprocal attorney fees, holdover non-penalty, and mitigation duty always present ---
{
  const doc = buildLeaseDocument(baseInput());
  check('reciprocal attorney fees clause present and cites RPL 234', hasHeading(doc, 'Attorney') && bodyText(doc, 'Attorney').includes('234'));
  check('holdover clause states it is not a penalty', bodyText(doc, 'Holdover').toLowerCase().includes('not intended to') );
  check('early termination clause states landlord duty to mitigate', bodyText(doc, 'Mitigate').toLowerCase().includes('mitigate'));
}

// --- Section 8 / CityFHEPS addendum reminder, and DHCR rider reminder ---
{
  const doc = buildLeaseDocument(baseInput({ subsidyProgram: 'section8', governmentPortion: 1000, tenantPortion: 500, section8OrCityfhepsAddendumRequired: true }));
  check('Section 8 addendum reminder present and notes it overrides the lease', hasHeading(doc, 'Section 8') && bodyText(doc, 'Section 8').includes('control over'));
  const rsDoc = buildLeaseDocument(baseInput({ rentStabilized: true, rentStabilizedRiderRequired: true }));
  check('DHCR rider reminder present with real link', hasHeading(rsDoc, 'DHCR Lease Rider') && bodyText(rsDoc, 'DHCR Lease Rider').includes('hcr.ny.gov'));
}

// --- The mandatory legal review notice is a real, non-empty string, names REBNY, every caller must show ---
check('LEGAL_REVIEW_NOTICE is present and non-trivial', LEGAL_REVIEW_NOTICE.length > 100);
check('LEGAL_REVIEW_NOTICE explicitly says not legal advice', LEGAL_REVIEW_NOTICE.toLowerCase().includes('not legal advice'));
check('LEGAL_REVIEW_NOTICE clarifies this is not the REBNY form', LEGAL_REVIEW_NOTICE.includes('REBNY'));

// --- Entity name (LLC/trust) fully replaces the individual's name as Landlord ---
{
  const withEntity = buildLeaseDocument(baseInput({ landlordName: 'Jeff Jdia', entityName: '62 Fillmore Street LLC' }));
  const withoutEntity = buildLeaseDocument(baseInput({ landlordName: 'Jeff Jdia', entityName: undefined }));
  const partiesWithEntity = bodyText(withEntity, 'Parties');
  const partiesWithoutEntity = bodyText(withoutEntity, 'Parties');
  check('landlordLabel reflects the LLC when set', withEntity.landlordLabel === '62 Fillmore Street LLC');
  check('landlordLabel falls back to individual name when no entity', withoutEntity.landlordLabel === 'Jeff Jdia');
  check('Parties clause names the LLC when entity is set', partiesWithEntity.includes('62 Fillmore Street LLC'));
  check('Parties clause does NOT also print the individual name when an entity is set', !partiesWithEntity.includes('Jeff Jdia'));
  check('Parties clause names the individual when no entity is set', partiesWithoutEntity.includes('Jeff Jdia'));
}

// --- Garage/parking agreement: separate, simpler document, no residential disclosures ---
function baseGarageInput(overrides: Partial<GarageDocInput> = {}): GarageDocInput {
  return {
    landlordName: 'Jeff Jdia', propertyAddress: '62 Fillmore Street, Staten Island, NY 10301',
    spaceName: '62 Fillmore Garage', renterName: 'Sam Renter', leaseStart: '2026-01-01', leaseEnd: '2026-12-31',
    isMonthToMonth: true, monthlyRent: 200, dueDay: 1, permittedUse: 'parking one passenger vehicle',
    ...overrides,
  };
}
{
  const garageDoc = buildGarageDocument(baseGarageInput());
  const leaseDoc = buildLeaseDocument(baseInput());
  check('garage doc title identifies it as a garage/parking agreement, not a lease', garageDoc.title.includes('Garage/Parking'));
  check('garage doc explicitly states it is not a residential lease', garageDoc.sections[0].body.some((b) => b.toLowerCase().includes('not a residential lease')));
  check('garage doc has NO lead paint disclosure (residential-only concern)', !garageDoc.sections.some((s) => s.heading.includes('Lead-Based Paint')));
  check('garage doc has NO Good Cause Eviction notice (residential-only concern)', !garageDoc.sections.some((s) => s.heading.includes('Good Cause')));
  check('garage doc entity name overrides individual name same as residential lease', buildGarageDocument(baseGarageInput({ entityName: '62 Fillmore Street LLC' })).landlordLabel === '62 Fillmore Street LLC');
  check('leaseDoc sanity: still has its own disclosures (contrast check)', leaseDoc.sections.some((s) => s.heading.includes('Bed Bug')));
  check('GARAGE_LEGAL_REVIEW_NOTICE present and says not legal advice', GARAGE_LEGAL_REVIEW_NOTICE.toLowerCase().includes('not legal advice'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
