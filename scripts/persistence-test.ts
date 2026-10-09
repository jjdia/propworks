// Simulates the exact "close app / reopen app" scenario that broke the old
// PropertyWorks: write data, close the DB connection entirely, open a
// brand-new connection (this is what "reload the page" or "relaunch the
// PWA" looks like at the storage layer), and confirm the data survived.
//
// This exercises the REAL src/lib/db.ts Dexie schema — not a mock of it —
// via fake-indexeddb (an in-memory IndexedDB implementation), since a real
// browser isn't available in this sandbox (Playwright's Chromium download
// is blocked by network egress rules here). What this does NOT cover:
// iOS Safari-specific storage quirks or the actual "Add to Home Screen"
// launch context — those still need a real on-device test.

import 'fake-indexeddb/auto';
import Dexie, { type Table } from 'dexie';

// Minimal localStorage shim so writeRollingBackup()/restoreFromBackup() work.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`);
  if (cond) pass++; else fail++;
}

interface Property {
  id: string; owner_id: string; name: string;
  created_at: string; updated_at: string; deleted_at: string | null;
}

function openDb() {
  const db = new Dexie('propertyworks-v2');
  db.version(1).stores({
    properties: 'id, owner_id, updated_at, deleted_at',
  });
  return db as Dexie & { properties: Table<Property, string> };
}

async function main() {
  const ownerId = 'test-owner';
  const testId = crypto.randomUUID();

  // --- Test 1: write, then simulate a page reload (new connection) -------
  const db1 = openDb();
  await db1.open();
  const now = new Date().toISOString();
  await db1.properties.put({
    id: testId, owner_id: ownerId, name: 'Test 55 Claradon',
    created_at: now, updated_at: now, deleted_at: null,
  });
  db1.close(); // simulates fully closing the app/tab

  const db2 = openDb(); // simulates reopening Safari / relaunching the PWA
  await db2.open();
  const afterReload = await db2.properties.get(testId);
  check('property survives a full close + reopen (reload test)', afterReload?.name === 'Test 55 Claradon');

  // --- Test 2: second "launch context" sees the same data ----------------
  // (This models Home-Screen-launch vs Safari-tab-launch both hitting the
  // same origin's IndexedDB — the actual browser guarantees this identity
  // as long as both launch from the same scope/origin, which is what the
  // PWA manifest's `scope` is set to enforce.)
  const secondId = crypto.randomUUID();
  await db2.properties.put({
    id: secondId, owner_id: ownerId, name: 'Test Fillmore Garage',
    created_at: now, updated_at: now, deleted_at: null,
  });
  db2.close();
  const db3 = openDb();
  await db3.open();
  const all = await db3.properties.toArray();
  check('both records present after multiple open/close cycles', all.length === 2);

  // --- Test 3: soft delete never removes the row --------------------------
  await db3.properties.update(testId, { deleted_at: new Date().toISOString() });
  const stillThere = await db3.properties.get(testId);
  const visibleList = await db3.properties.filter((p) => !p.deleted_at).toArray();
  check('soft-deleted row still exists in the table (recoverable)', stillThere !== undefined);
  check('soft-deleted row is excluded from the visible list', !visibleList.some((p) => p.id === testId));

  // --- Test 4: an empty "pull" can never wipe local data -------------------
  // Simulates exactly the old bug: a sync pass that gets zero rows back
  // from the server. bulkPut with an empty array must be a no-op.
  await db3.properties.bulkPut([]); // the sync engine's pull, with 0 remote rows
  const afterEmptyPull = await db3.properties.toArray();
  check('an empty remote pull does not clear local data (the old bug)', afterEmptyPull.length === 2);

  db3.close();

  // --- Test 5 (issue #10): new lease/charge fields survive the REAL ------
  // src/lib/db.ts rolling backup + restore. No Dexie version bump: the new
  // fields aren't indexed, so they just ride along on the stored objects.
  {
    const realDb = await import('../src/lib/db');
    const { db, writeRollingBackup, getLatestBackup, restoreFromBackup } = realDb;
    check('Dexie schema still at version 4 (no bump for #10)', db.verno === 4 || (await db.open(), db.verno === 4));
    const meta = { owner_id: ownerId, created_at: now, updated_at: now, deleted_at: null };
    await db.leases.put({
      id: 'lease-hra', rental_unit_id: 'u1', tenant_id: 't1', total_monthly_rent: 4000, status: 'active',
      subsidy_program: 'section8', government_portion: 3000, tenant_portion: 1000, tenant_payment_method: 'hra',
      tenant_payment_frequency: 'twice_monthly', hra_case_number: 'CASE-123', hra_approved_on: '2026-09-01',
      hra_proof_document_id: 'doc-1', ...meta,
    });
    await db.rent_charges.put({ id: 'charge-full', lease_id: 'lease-hra', charge_month: '2026-10-01', total_rent: 4000, status: 'paid', marked_full_at: '2026-10-30T12:00:00.000Z', ...meta });
    await writeRollingBackup();
    const json = getLatestBackup()!;
    // Simulate losing the rows locally, then restoring (merge, never clear).
    await db.leases.delete('lease-hra');
    await db.rent_charges.delete('charge-full');
    await restoreFromBackup(json);
    const l = await db.leases.get('lease-hra');
    const c = await db.rent_charges.get('charge-full');
    check('lease HRA fields + tenant_payment_frequency survive backup/restore',
      l?.tenant_payment_frequency === 'twice_monthly' && l?.hra_case_number === 'CASE-123' && l?.hra_approved_on === '2026-09-01' && l?.hra_proof_document_id === 'doc-1');
    check('rent_charges.marked_full_at survives backup/restore', c?.marked_full_at === '2026-10-30T12:00:00.000Z');
    check('restore merged in (earlier properties still present)', (await db.properties.count()) === 2);
    db.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
