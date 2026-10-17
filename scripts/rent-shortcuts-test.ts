import { tenantForLease, editTargetsForInstallment } from '../src/lib/rentShortcuts';
import type { Lease, RentCharge, RentInstallment, Tenant } from '../src/lib/types';

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`);
  if (cond) pass++; else fail++;
}

const meta = { owner_id: 'o', created_at: '', updated_at: '', deleted_at: null };
const maurice = { ...meta, id: 't1', full_name: 'Maurice' } as unknown as Tenant;
const gone = { ...meta, id: 't2', full_name: 'Gone', deleted_at: '2026-01-01' } as unknown as Tenant;
const tenants = [maurice, gone];
const l1 = { ...meta, id: 'l1', tenant_id: 't1', rental_unit_id: 'u1', total_monthly_rent: 1500, status: 'active' } as unknown as Lease;
const l2 = { ...meta, id: 'l2', tenant_id: 't2', rental_unit_id: 'u2', total_monthly_rent: 1200, status: 'active' } as unknown as Lease;
const l3 = { ...meta, id: 'l3', tenant_id: 'tX', rental_unit_id: 'u3', total_monthly_rent: 900, status: 'active', deleted_at: '2026-02-01' } as unknown as Lease;
const leases = [l1, l2, l3];
const c1 = { ...meta, id: 'c1', lease_id: 'l1', charge_month: '2026-10-01', total_rent: 1500 } as unknown as RentCharge;
const c3 = { ...meta, id: 'c3', lease_id: 'l3', charge_month: '2026-10-01', total_rent: 900 } as unknown as RentCharge;
const cDel = { ...meta, id: 'cD', lease_id: 'l1', charge_month: '2026-10-01', total_rent: 1500, deleted_at: '2026-03-01' } as unknown as RentCharge;
const charges = [c1, c3, cDel];
const inst = (cid: string) => ({ rent_charge_id: cid }) as Pick<RentInstallment, 'rent_charge_id'>;

check('lease card → its tenant', tenantForLease(l1, tenants)?.id === 't1');
check('soft-deleted tenant → null (Edit tenant hidden)', tenantForLease(l2, tenants) === null);
check('missing tenant → null', tenantForLease({ tenant_id: 'nope' }, tenants) === null);
check('tenants not loaded yet → null', tenantForLease(l1, undefined) === null);

const a = editTargetsForInstallment(inst('c1'), charges, leases, tenants);
check('installment → charge → lease l1', a.lease?.id === 'l1');
check('installment → tenant Maurice', a.tenant?.full_name === 'Maurice');
const b = editTargetsForInstallment(inst('c3'), charges, leases, tenants);
check('soft-deleted lease → no lease/tenant', b.lease === null && b.tenant === null);
const c = editTargetsForInstallment(inst('cD'), charges, leases, tenants);
check('soft-deleted charge → nothing', c.lease === null && c.tenant === null);
const d = editTargetsForInstallment(inst('zzz'), charges, leases, tenants);
check('unknown charge → nothing', d.lease === null && d.tenant === null);
const e = editTargetsForInstallment(inst('c1'), undefined, leases, tenants);
check('charges not loaded → nothing', e.lease === null && e.tenant === null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
