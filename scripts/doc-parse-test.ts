import { parseLeaseText, parseReceiptText, parseDate, parseMoney } from '../src/lib/docParse';

let pass = 0, fail = 0;
function check(label: string, cond: boolean, got?: unknown) {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}${cond ? '' : ' :: ' + JSON.stringify(got)}`);
  if (cond) pass++; else fail++;
}
// Fixture text only — fictional names/addresses.
check('date m/d/yyyy', parseDate('3/1/2026') === '2026-03-01');
check('date m/d/yy', parseDate('03-01-26') === '2026-03-01');
check('date ISO', parseDate('2026-03-01') === '2026-03-01');
check('date long', parseDate('March 1, 2026') === '2026-03-01');
check('date ordinal day-of', parseDate('1st day of March, 2026') === '2026-03-01');
check('date invalid', parseDate('2/30/2026') === undefined && parseDate('hello') === undefined);
check('money', parseMoney('$2,450.00') === 2450 && parseMoney('0') === undefined);

const LEASE1 = `RESIDENTIAL LEASE AGREEMENT
Landlord: Example Holdings LLC
Tenant(s): Jane Q Sample and John Example
Premises: 123 Fictional Ave, Apt 2B, Brooklyn, NY 11216
Term: The lease term commences on March 1, 2026 and expires on February 28, 2027.
Monthly Rent: $2,450.00 payable on the 1st of each month.
Security Deposit: $2,450.00
`;
const l1 = parseLeaseText(LEASE1);
check('lease1 tenants', JSON.stringify(l1.tenantNames) === '["Jane Q Sample","John Example"]', l1.tenantNames);
check('lease1 address', l1.address === '123 Fictional Ave, Apt 2B, Brooklyn, NY 11216', l1.address);
check('lease1 unit', l1.unit === '2B', l1.unit);
check('lease1 start', l1.leaseStart === '2026-03-01', l1.leaseStart);
check('lease1 end', l1.leaseEnd === '2027-02-28', l1.leaseEnd);
check('lease1 rent', l1.monthlyRent === 2450, l1.monthlyRent);
check('lease1 deposit', l1.deposit === 2450, l1.deposit);
check('lease1 no gov', l1.govProgram === undefined && l1.govPortion === undefined);

const LEASE2 = `This Lease is made between Sample Realty Corp ("Landlord") and Maria Placeholder ("Tenant").
The property located at 45 Nowhere Street Unit 3, Bronx, NY 10451.
Start Date: 10/01/2026   End Date: 09/30/2027
Total monthly rent: $3,000.00. Section 8 portion: $2,200.00. Tenant portion: $800.00.
A security deposit of $800.00 is due at signing.`;
const l2 = parseLeaseText(LEASE2);
check('lease2 tenant from "between" clause', JSON.stringify(l2.tenantNames) === '["Maria Placeholder"]', l2.tenantNames);
check('lease2 address', l2.address === '45 Nowhere Street Unit 3, Bronx, NY 10451', l2.address);
check('lease2 unit', l2.unit === '3', l2.unit);
check('lease2 dates', l2.leaseStart === '2026-10-01' && l2.leaseEnd === '2027-09-30', [l2.leaseStart, l2.leaseEnd]);
check('lease2 rent', l2.monthlyRent === 3000, l2.monthlyRent);
check('lease2 deposit', l2.deposit === 800, l2.deposit);
check('lease2 section8 portions', l2.govProgram === 'section8' && l2.govPortion === 2200 && l2.tenantPortion === 800, l2);

const LEASE3 = `Tenant: Alex Fakename
CityFHEPS will pay $1,900.00 per month. Rent: $2,300.00 per month.`;
const l3 = parseLeaseText(LEASE3);
check('lease3 cityfheps + derived tenant share', l3.govProgram === 'cityfheps' && l3.govPortion === 1900 && l3.tenantPortion === 400 && l3.monthlyRent === 2300, l3);
check('empty text → no suggestions', JSON.stringify(parseLeaseText('')) === '{"tenantNames":[]}');

const R1 = `ACME PLUMBING & HEATING
12 Example Rd
Invoice Date: 09/14/2026
Replace kitchen faucet   $180.00
Parts                    $45.50
TOTAL: $225.50
Thank you!`;
const r1 = parseReceiptText(R1);
check('receipt1 total', r1.amount === 225.5, r1);
check('receipt1 date', r1.date === '2026-09-14', r1);
check('receipt1 vendor', r1.vendor === 'ACME PLUMBING & HEATING', r1);

const R2 = `Con Example Energy
Statement Date Oct 2, 2026
Account 1234 5678
Amount Due $1,312.07`;
const r2 = parseReceiptText(R2);
check('bill2 amount due', r2.amount === 1312.07 && r2.date === '2026-10-02' && r2.vendor === 'Con Example Energy', r2);

const R3 = `Corner Hardware\n10/05/26\nscrews 4.99\n$ 12.98\n$ 3.50`;
const r3 = parseReceiptText(R3);
check('receipt3 fallback: largest $ amount, bare date', r3.amount === 12.98 && r3.date === '2026-10-05' && r3.vendor === 'Corner Hardware', r3);
check('empty receipt', JSON.stringify(parseReceiptText('')) === '{}');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
