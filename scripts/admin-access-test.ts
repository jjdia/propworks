import {
  canAccessAdmin,
  canRemovePortalUser,
  isPrimaryPortfolioOwner,
  roleLabel,
} from '../src/pages/admin/access';

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`);
  if (cond) pass++; else fail++;
}

check('owner can access admin', canAccessAdmin('owner') === true);
check('tenant cannot access admin', canAccessAdmin('tenant') === false);
check('contractor cannot access admin', canAccessAdmin('contractor') === false);
check('null role cannot access admin', canAccessAdmin(null) === false);
check('undefined role cannot access admin', canAccessAdmin(undefined) === false);

const portfolio = 'owner-primary';
const actor = 'owner-primary';
const coOwner = { id: 'co-owner-1', role: 'owner' as const };
const tenant = { id: 'tenant-1', role: 'tenant' as const };
const contractor = { id: 'contractor-1', role: 'contractor' as const };
const primary = { id: portfolio, role: 'owner' as const };

check('cannot remove self', canRemovePortalUser({ actorProfileId: actor, portfolioOwnerId: portfolio, target: primary }).ok === false);
check('cannot remove primary owner even as another actor', canRemovePortalUser({
  actorProfileId: 'co-owner-1', portfolioOwnerId: portfolio, target: primary,
}).ok === false);
check('can remove co-owner', canRemovePortalUser({
  actorProfileId: actor, portfolioOwnerId: portfolio, target: coOwner,
}).ok === true);
check('can remove tenant', canRemovePortalUser({
  actorProfileId: actor, portfolioOwnerId: portfolio, target: tenant,
}).ok === true);
check('can remove contractor', canRemovePortalUser({
  actorProfileId: actor, portfolioOwnerId: portfolio, target: contractor,
}).ok === true);
check('co-owner cannot remove themselves', canRemovePortalUser({
  actorProfileId: 'co-owner-1', portfolioOwnerId: portfolio, target: coOwner,
}).ok === false);

check('primary owner detection', isPrimaryPortfolioOwner(portfolio, portfolio) === true);
check('co-owner is not primary', isPrimaryPortfolioOwner('co-owner-1', portfolio) === false);
check('roleLabel owner', roleLabel('owner') === 'Owner / admin');
check('roleLabel tenant', roleLabel('tenant') === 'Tenant');
check('roleLabel contractor', roleLabel('contractor') === 'Contractor');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
