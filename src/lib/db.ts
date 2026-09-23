import Dexie, { type Table } from 'dexie';
import type {
  Property, RentalUnit, Tenant, Lease, RentCharge, RentPayment, RentInstallment, Expense, PropertyDocument,
  Contractor, MaintenanceSchedule, OutboxItem,
} from './types';

// ---------------------------------------------------------------------------
// THE CORE RULE THIS FILE ENFORCES:
//
// The UI never talks to Supabase directly. It only ever reads/writes Dexie
// (browser IndexedDB). Dexie is the source of truth for what the user sees.
// Supabase is a remote backup/sync target, not the primary store.
//
// This inverts the old app's design (which read from Supabase and could show
// an empty portfolio if a query returned zero rows, or wipe local state on a
// bad sync). Here, a failed or empty Supabase read/write can NEVER make data
// disappear from the screen, because the screen is fed by Dexie, and nothing
// in this file ever does `table.clear()` or replaces the whole table from a
// remote payload — every remote row is merged in one record at a time.
// ---------------------------------------------------------------------------

class PropertyWorksDB extends Dexie {
  properties!: Table<Property, string>;
  rental_units!: Table<RentalUnit, string>;
  tenants!: Table<Tenant, string>;
  leases!: Table<Lease, string>;
  rent_charges!: Table<RentCharge, string>;
  rent_payments!: Table<RentPayment, string>;
  rent_installments!: Table<RentInstallment, string>;
  expenses!: Table<Expense, string>;
  documents!: Table<PropertyDocument, string>;
  contractors!: Table<Contractor, string>;
  maintenance_schedules!: Table<MaintenanceSchedule, string>;
  outbox!: Table<OutboxItem, string>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super('propertyworks-v2');
    this.version(1).stores({
      properties: 'id, owner_id, updated_at, deleted_at',
      rental_units: 'id, owner_id, property_id, updated_at, deleted_at',
      tenants: 'id, owner_id, updated_at, deleted_at',
      leases: 'id, owner_id, rental_unit_id, tenant_id, updated_at, deleted_at',
      rent_charges: 'id, owner_id, lease_id, charge_month, updated_at, deleted_at',
      rent_payments: 'id, owner_id, rent_charge_id, updated_at, deleted_at',
      expenses: 'id, owner_id, property_id, expense_date, updated_at, deleted_at',
      outbox: 'id, table, createdAt',
      meta: 'key',
    });
    // v2: adds rent_installments (per-payer, per-due-date breakdown of a
    // month's rent_charge — see types.ts RentInstallment for why).
    this.version(2).stores({
      rent_installments: 'id, owner_id, rent_charge_id, due_date, status, updated_at, deleted_at',
    });
    // v3: adds documents (generated leases and other saved paperwork).
    this.version(3).stores({
      documents: 'id, owner_id, property_id, tenant_id, lease_id, doc_type, updated_at, deleted_at',
    });
    // v4: adds contractors (owner's roster) and maintenance_schedules
    // (recurring maintenance like monthly pest control).
    this.version(4).stores({
      contractors: 'id, owner_id, updated_at, deleted_at',
      maintenance_schedules: 'id, owner_id, property_id, next_due_date, status, updated_at, deleted_at',
    });
  }
}

export const db = new PropertyWorksDB();

// -----------------------------------------------------------------------
// Rolling local backup: every mutation also snapshots the full local
// dataset into localStorage (belt-and-suspenders on top of IndexedDB).
// If IndexedDB itself ever gets corrupted, this lets the user recover.
// -----------------------------------------------------------------------
const BACKUP_KEY = 'propertyworks_backup_v2';
const BACKUP_HISTORY_KEY = 'propertyworks_backup_v2_history';
const MAX_BACKUPS = 5;

export async function writeRollingBackup() {
  try {
    const snapshot = {
      timestamp: new Date().toISOString(),
      properties: await db.properties.toArray(),
      rental_units: await db.rental_units.toArray(),
      tenants: await db.tenants.toArray(),
      leases: await db.leases.toArray(),
      rent_charges: await db.rent_charges.toArray(),
      rent_payments: await db.rent_payments.toArray(),
      expenses: await db.expenses.toArray(),
    };
    const json = JSON.stringify(snapshot);
    localStorage.setItem(BACKUP_KEY, json);

    const historyRaw = localStorage.getItem(BACKUP_HISTORY_KEY);
    const history: string[] = historyRaw ? JSON.parse(historyRaw) : [];
    history.unshift(json);
    while (history.length > MAX_BACKUPS) history.pop();
    localStorage.setItem(BACKUP_HISTORY_KEY, JSON.stringify(history));
  } catch (err) {
    // Never let a backup failure break the app or throw during a mutation.
    console.error('Rolling backup failed', err);
  }
}

export function getLatestBackup(): string | null {
  return localStorage.getItem(BACKUP_KEY);
}

export function getBackupHistory(): string[] {
  const raw = localStorage.getItem(BACKUP_HISTORY_KEY);
  return raw ? JSON.parse(raw) : [];
}

// Restore from a backup snapshot by MERGING it in (never clearing tables
// first), so restoring can only add records back, never remove anything
// that's currently present.
export async function restoreFromBackup(json: string) {
  const snapshot = JSON.parse(json);
  const tables = [db.properties, db.rental_units, db.tenants, db.leases, db.rent_charges, db.rent_payments, db.expenses];
  await db.transaction('rw', tables, async () => {
    if (snapshot.properties) await db.properties.bulkPut(snapshot.properties);
    if (snapshot.rental_units) await db.rental_units.bulkPut(snapshot.rental_units);
    if (snapshot.tenants) await db.tenants.bulkPut(snapshot.tenants);
    if (snapshot.leases) await db.leases.bulkPut(snapshot.leases);
    if (snapshot.rent_charges) await db.rent_charges.bulkPut(snapshot.rent_charges);
    if (snapshot.rent_payments) await db.rent_payments.bulkPut(snapshot.rent_payments);
    if (snapshot.expenses) await db.expenses.bulkPut(snapshot.expenses);
  });
}
