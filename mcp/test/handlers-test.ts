import { createHandlers, MAX_ROWS, type ReadSource, type ReadTable } from '../src/handlers';
import { supabaseSource, checkEnv } from '../src/supabaseSource';
import { buildServer } from '../src/server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildInstallments } from '../../src/lib/installments';
import type { Lease, RentCharge, RentInstallment } from '../../src/lib/types';

let pass = 0, fail = 0;
function check(label: string, cond: boolean, got?: unknown) {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}${cond ? '' : ' :: ' + JSON.stringify(got)}`);
  if (cond) pass++; else fail++;
}
// Fictional fixture data only.
const meta = { owner_id: 'o1', created_at: '', updated_at: '', deleted_at: null };
const NOW = () => new Date('2026-10-13T12:00:00Z');
const lease = (id: string, over: Partial<Lease>): Lease => ({ id, rental_unit_id: 'u' + id, tenant_id: 't' + id, total_monthly_rent: 4000, status: 'active', rent_due_day: 1, ...meta, ...over });
const govHra = lease('A', { subsidy_program: 'section8', government_portion: 3000, tenant_portion: 1000, tenant_payment_method: 'hra', lease_end: '2026-11-01' });
const selfPay = lease('B', { subsidy_program: 'none', total_monthly_rent: 2000, tenant_portion: 2000, tenant_payment_method: 'direct', lease_end: '2027-06-30' });
const ended = lease('C', { status: 'ended' });
const gone = lease('D', { deleted_at: '2026-01-01' });
let seq = 0;
const mk = (l: Lease, ch: string, m: string): RentInstallment[] => buildInstallments('o1', ch, m, l).map((i) => ({ ...i, id: `i${++seq}`, ...meta }));
const pay = (i: RentInstallment): RentInstallment => ({ ...i, status: 'paid', paid_amount: i.amount, paid_date: i.due_date });
let hra = 0;
const aI = mk(govHra, 'cA', '2026-10-01').map((i) => i.portion === 'government' ? pay(i) : i.payer === 'hra' && hra++ === 0 ? pay(i) : i);
const bI = mk(selfPay, 'cB', '2026-09-01');
const charges: RentCharge[] = [
  { id: 'cA', lease_id: 'A', charge_month: '2026-10-01', total_rent: 4000, status: 'partial', ...meta },
  { id: 'cB', lease_id: 'B', charge_month: '2026-09-01', total_rent: 2000, status: 'due', ...meta },
];
const DB: Record<ReadTable, Record<string, unknown>[]> = {
  properties: [{ id: 'p1', name: 'Fake St 1', city: 'Brooklyn', zip: '11216', ...meta }],
  rental_units: ['A', 'B', 'C', 'D'].map((x) => ({ id: 'u' + x, property_id: 'p1', name: 'Unit ' + x, unit_kind: 'apartment', status: 'occupied', ...meta })),
  tenants: ['A', 'B', 'C', 'D'].map((x) => ({ id: 't' + x, full_name: 'Tenant ' + x, ...meta })),
  leases: [govHra, selfPay, ended, gone] as unknown as Record<string, unknown>[],
  rent_charges: charges as unknown as Record<string, unknown>[],
  rent_installments: [...aI, ...bI] as unknown as Record<string, unknown>[],
  expenses: [
    { id: 'e1', property_id: 'p1', expense_date: '2026-09-02', category: 'Repairs', paid_by: 'landlord', frequency: 'one_time', amount: 120.5, ...meta },
    { id: 'e2', property_id: 'p1', expense_date: '2026-10-02', category: 'Utilities', paid_by: 'landlord', frequency: 'monthly', amount: 80, ...meta },
  ],
};
const calls: string[] = [];
const src: ReadSource = {
  async select(t, range) {
    calls.push(t);
    return DB[t].filter((r) => !range || ((!range.gte || String(r[range.column]) >= range.gte) && (!range.lte || String(r[range.column]) <= range.lte)));
  },
};
const h = createHandlers(src, NOW);

const props = await h.list_properties();
check('list_properties: one property, 4 units, address', props.total === 1 && props.items[0].units.length === 4 && props.items[0].address === 'Brooklyn, 11216', props);

const ls = await h.list_leases();
check('list_leases default active only, deleted excluded', ls.items.map((x) => x.id).join() === 'A,B', ls.items.map((x) => x.id));
check('list_leases subsidy fields', ls.items[0].payer_setup === 'gov_hra' && ls.items[0].gov_program === 'section8' && ls.items[0].tenant === 'Tenant A' && ls.items[0].property === 'Fake St 1');
check('list_leases active_only=false includes ended', (await h.list_leases({ active_only: false })).items.length === 3);
check('list_leases ending_within_days=30', (await h.list_leases({ ending_within_days: 30 })).items.map((x) => x.id).join() === 'A');
check('list_leases payer_setup filter', (await h.list_leases({ payer_setup: 'self_pay' })).items.map((x) => x.id).join() === 'B');

const gl = await h.get_lease({ lease_id: 'A' });
check('get_lease recent month: Partial, HRA owes $500', 'recent_months' in gl && gl.recent_months[0].status === 'Partial' && gl.recent_months[0].outstanding === 500 && gl.recent_months[0].owing[0].payer === 'HRA (tenant share)', gl);
check('get_lease missing → error', 'error' in (await h.get_lease({ lease_id: 'zzz' })));
check('get_lease deleted lease not visible', 'error' in (await h.get_lease({ lease_id: 'D' })));

const rc = await h.list_rent_charges({ from_month: '2026-10' });
check('list_rent_charges month range', rc.items.length === 1 && rc.items[0].month === '2026-10', rc);
check('list_rent_charges status filter', (await h.list_rent_charges({ status: 'Due' })).items.map((x) => x.lease_id).join() === 'B');

const bal = await h.get_balances();
check('get_balances total $2,500 (B $2,000 + A HRA $500)', bal.total_outstanding === 2500, bal);
check('get_balances by payer', bal.by_payer.tenant === 2000 && bal.by_payer.hra === 500 && !bal.by_payer.gov, bal.by_payer);
check('get_balances lease rows labelled', bal.leases.items[0].tenant === 'Tenant B' && bal.leases.items[1].months[0] === '2026-10');

const ex = await h.list_expenses({ from_date: '2026-10-01' });
check('list_expenses date filter + total', ex.total === 1 && ex.total_amount === 80);
check('list_expenses all newest first', (await h.list_expenses()).items[0].date === '2026-10-02');

// Caps
const many: ReadSource = { async select(t) { return t === 'properties' ? Array.from({ length: 500 }, (_, i) => ({ id: 'p' + i, name: 'P' + i, ...meta })) : []; } };
const capped = await createHandlers(many, NOW).list_properties();
check(`result cap ${MAX_ROWS}`, capped.returned === MAX_ROWS && capped.truncated && capped.total === 500);
check('limit honoured, clamped', (await createHandlers(many, NOW).list_leases({ limit: 5 })).returned === 0);

// supabaseSource against a mocked client that only allows read builder calls
const log: string[] = [];
const builder: Record<string, unknown> = {};
for (const m of ['select', 'is', 'gte', 'lte', 'order']) builder[m] = (...a: unknown[]) => { log.push(`${m}(${a.map(String).join(',')})`); return builder; };
builder.range = async () => { log.push('range'); return { data: [{ id: 'x', deleted_at: null }], error: null }; };
const mockClient = new Proxy({ from: (t: string) => { log.push(`from(${t})`); return builder; } }, {
  get(target, k) { if (k === 'from') return target.from; if (k === 'rpc') throw new Error('rpc used'); return undefined; },
});
const rows = await supabaseSource(mockClient as never).select('expenses', { column: 'expense_date', gte: '2026-01-01' });
check('supabaseSource: select * where deleted_at is null + range', rows.length === 1 && log.join(' ').startsWith('from(expenses) select(*) is(deleted_at,null) gte(expense_date,2026-01-01) order(id) range'), log);
let threw = false;
try { await supabaseSource(mockClient as never).select('profiles' as never); } catch { threw = true; }
check('supabaseSource rejects non-allowlisted table', threw);

// Env / key guard
const fakeJwt = (role: string) => `x.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.y`;
const envBase = { PROPWORKS_SUPABASE_URL: 'https://example.supabase.co', PROPWORKS_REFRESH_TOKEN: 'r' };
const throws = (env: NodeJS.ProcessEnv) => { try { checkEnv(env); return false; } catch { return true; } };
check('env: service_role JWT refused', throws({ ...envBase, PROPWORKS_SUPABASE_ANON_KEY: fakeJwt('service_role') }));
check('env: sb_secret_ key refused', throws({ ...envBase, PROPWORKS_SUPABASE_ANON_KEY: 'sb_secret_abc' }));
check('env: anon JWT accepted', !throws({ ...envBase, PROPWORKS_SUPABASE_ANON_KEY: fakeJwt('anon') }));
check('env: missing login refused', throws({ PROPWORKS_SUPABASE_URL: 'u', PROPWORKS_SUPABASE_ANON_KEY: fakeJwt('anon') }));

// MCP protocol: tools listed, read-only annotated, call works
const server = buildServer(async () => src);
const [ct, st] = InMemoryTransport.createLinkedPair();
await server.connect(st);
const client = new Client({ name: 't', version: '0' });
await client.connect(ct);
const tools = (await client.listTools()).tools;
check('6 tools listed', tools.map((t) => t.name).sort().join() === 'get_balances,get_lease,list_expenses,list_leases,list_properties,list_rent_charges', tools.map((t) => t.name));
check('all tools annotated readOnlyHint', tools.every((t) => t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint === false));
const res = await client.callTool({ name: 'get_balances', arguments: {} });
const body = JSON.parse((res.content as { text: string }[])[0].text);
check('callTool get_balances returns compact JSON', body.total_outstanding === 2500);
const bad = await client.callTool({ name: 'list_leases', arguments: { limit: 9999 } });
check('input over cap rejected', bad.isError === true);
await client.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
