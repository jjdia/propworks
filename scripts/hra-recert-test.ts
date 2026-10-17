import { addOneYear, recertDueDate, recertStatus, recertItems, recertPushes, recertDedupeKey } from '../src/lib/hraRecert';
import { scheduleFromLease, scheduleToLeaseFields, BLANK_SCHEDULE } from '../src/lib/paymentSchedule';
import type { Lease } from '../src/lib/types';

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`);
  if (cond) pass++; else fail++;
}
const meta = { owner_id: 'o1', created_at: '', updated_at: '', deleted_at: null };
const L = (id: string, over: Partial<Lease> = {}): Lease => ({ id, rental_unit_id: 'u', tenant_id: 't' + id, total_monthly_rent: 4000, status: 'active', subsidy_program: 'section8', government_portion: 3000, tenant_portion: 1000, tenant_payment_method: 'hra', ...meta, ...over });
const tenants = [{ id: 'tA', full_name: 'Ana' }, { id: 'tB', full_name: 'Ben' }, { id: 'tC', full_name: 'Cy' }, { id: 'tD', full_name: 'Di' }];

check('approved + 1 year', addOneYear('2025-11-16') === '2026-11-16');
check('Feb 29 + 1 year → Feb 28', addOneYear('2028-02-29') === '2029-02-28');
check('explicit recert date wins', recertDueDate({ hra_recert_due_on: '2026-12-01', hra_approved_on: '2025-01-01' }).date === '2026-12-01');
check('fallback = approved + 1y, source flagged', recertDueDate({ hra_approved_on: '2025-11-16' }).source === 'approved_plus_1y');
check('no dates → unknown', recertStatus(L('A'), '2026-10-17').status === 'unknown');

const T = '2026-10-17';
check('30-day window', recertStatus(L('A', { hra_approved_on: '2025-11-16' }), T).status === 'due_30');
check('7-day window', recertStatus(L('A', { hra_recert_due_on: '2026-10-24' }), T).status === 'due_7');
check('overdue', recertStatus(L('A', { hra_recert_due_on: '2026-10-16' }), T).status === 'overdue');
check('far away = ok', recertStatus(L('A', { hra_recert_due_on: '2027-03-01' }), T).status === 'ok');

const leases = [
  L('A', { hra_approved_on: '2025-11-16' }), // 30 days
  L('B', { hra_recert_due_on: '2026-10-20' }), // 3 days
  L('C', { tenant_payment_method: 'direct', hra_recert_due_on: '2026-10-20' }), // gov+tenant → ignored
  L('D', { status: 'ended', hra_recert_due_on: '2026-10-20' }), // ended → ignored
  L('E', { subsidy_program: 'none', hra_recert_due_on: '2026-10-20' }), // self-pay → ignored
  L('F', { hra_recert_due_on: '2027-06-01' }), // ok → hidden
  L('G', {}), // HRA, no dates → in-app "set date", no push
];
const items = recertItems(leases, tenants, T);
check('in-app list: only active gov+HRA leases needing attention', items.map((i) => i.leaseId).join() === 'B,A,G');
check('in-app list carries tenant name', items[0].tenantName === 'Ben');
const pushes = recertPushes(leases, tenants, T);
check('pushes only for A (30d) and B (7d)', pushes.map((p) => `${p.item.leaseId}:${p.stage}`).join() === 'B:7,A:30');
check('dedupe key per lease + due date + stage', pushes[1].dedupeKey === recertDedupeKey('A', '2026-11-16', 30) && pushes[1].dedupeKey === 'hra_recert:A:2026-11-16:30');
check('missed cron day still sends (window, same key all window)', recertPushes(leases, tenants, '2026-10-18').find((p) => p.item.leaseId === 'A')?.dedupeKey === 'hra_recert:A:2026-11-16:30');
check('day 8 still stage 30; day 7 switches to stage 7', recertPushes([L('A', { hra_recert_due_on: '2026-10-25' })], tenants, T)[0].stage === 30 && recertPushes([L('A', { hra_recert_due_on: '2026-10-24' })], tenants, T)[0].stage === 7);
check('no push when overdue or unknown', recertPushes([L('A', { hra_recert_due_on: '2026-10-01' }), L('G')], tenants, T).length === 0);
check('push text names tenant + date', /Ben: yearly HRA recertification due 2026-10-20/.test(pushes[0].body) && pushes[0].title === 'HRA recert due in 3 days');
check('new approval date after recert clears the reminder', recertItems([L('A', { hra_approved_on: '2026-10-10' })], tenants, T).length === 0);

// lease form mapping
const f = scheduleToLeaseFields({ ...BLANK_SCHEDULE, setup: 'gov_hra', govPortion: '3000', tenantPortion: '1000', hraRecertDueOn: '2027-01-15' });
check('lease form saves hra_recert_due_on', f.hra_recert_due_on === '2027-01-15');
check('blank recert field saves null (fallback to approved + 1y)', scheduleToLeaseFields({ ...BLANK_SCHEDULE, setup: 'gov_hra' }).hra_recert_due_on === null);
check('lease form loads hra_recert_due_on', scheduleFromLease(L('A', { hra_recert_due_on: '2027-01-15' })).hraRecertDueOn === '2027-01-15');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
