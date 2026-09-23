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

/** Local-first tables included in rolling + downloadable backups. */
export const BACKUP_TABLES = [
  'properties',
  'rental_units',
  'tenants',
  'leases',
  'rent_charges',
  'rent_payments',
  'rent_installments',
  'expenses',
  'documents',
  'contractors',
  'maintenance_schedules',
] as const;

export type BackupTableName = typeof BACKUP_TABLES[number];

export interface BackupSnapshot {
  version: 2;
  timestamp: string;
  properties: Property[];
  rental_units: RentalUnit[];
  tenants: Tenant[];
  leases: Lease[];
  rent_charges: RentCharge[];
  rent_payments: RentPayment[];
  rent_installments: RentInstallment[];
  expenses: Expense[];
  documents: PropertyDocument[];
  contractors: Contractor[];
  maintenance_schedules: MaintenanceSchedule[];
}

// -----------------------------------------------------------------------
// Rolling local backup: every mutation also snapshots the full local
// dataset into localStorage (belt-and-suspenders on top of IndexedDB).
// If IndexedDB itself ever gets corrupted, this lets the user recover.
// -----------------------------------------------------------------------
const BACKUP_KEY = 'propertyworks_backup_v2';
const BACKUP_HISTORY_KEY = 'propertyworks_backup_v2_history';
const MAX_BACKUPS = 5;

export async function buildBackupSnapshot(): Promise<BackupSnapshot> {
  return {
    version: 2,
    timestamp: new Date().toISOString(),
    properties: await db.properties.toArray(),
    rental_units: await db.rental_units.toArray(),
    tenants: await db.tenants.toArray(),
    leases: await db.leases.toArray(),
    rent_charges: await db.rent_charges.toArray(),
    rent_payments: await db.rent_payments.toArray(),
    rent_installments: await db.rent_installments.toArray(),
    expenses: await db.expenses.toArray(),
    documents: await db.documents.toArray(),
    contractors: await db.contractors.toArray(),
    maintenance_schedules: await db.maintenance_schedules.toArray(),
  };
}

export async function writeRollingBackup() {
  try {
    const snapshot = await buildBackupSnapshot();
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

/** Trigger a browser download of the full Dexie snapshot as JSON. */
export async function downloadBackupFile() {
  const snapshot = await buildBackupSnapshot();
  const json = JSON.stringify(snapshot, null, 2);
  const stamp = snapshot.timestamp.replace(/[:.]/g, '-');
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `propworks-backup-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Restore from a backup snapshot by MERGING it in (never clearing tables
// first), so restoring can only add/overwrite records by id, never remove
// anything that's currently present and missing from the snapshot.
export async function restoreFromBackup(json: string) {
  const snapshot = JSON.parse(json) as Partial<BackupSnapshot> & Record<string, unknown>;
  const tables = [
    db.properties, db.rental_units, db.tenants, db.leases,
    db.rent_charges, db.rent_payments, db.rent_installments, db.expenses,
    db.documents, db.contractors, db.maintenance_schedules,
  ];
  await db.transaction('rw', tables, async () => {
    if (Array.isArray(snapshot.properties)) await db.properties.bulkPut(snapshot.properties as Property[]);
    if (Array.isArray(snapshot.rental_units)) await db.rental_units.bulkPut(snapshot.rental_units as RentalUnit[]);
    if (Array.isArray(snapshot.tenants)) await db.tenants.bulkPut(snapshot.tenants as Tenant[]);
    if (Array.isArray(snapshot.leases)) await db.leases.bulkPut(snapshot.leases as Lease[]);
    if (Array.isArray(snapshot.rent_charges)) await db.rent_charges.bulkPut(snapshot.rent_charges as RentCharge[]);
    if (Array.isArray(snapshot.rent_payments)) await db.rent_payments.bulkPut(snapshot.rent_payments as RentPayment[]);
    if (Array.isArray(snapshot.rent_installments)) await db.rent_installments.bulkPut(snapshot.rent_installments as RentInstallment[]);
    if (Array.isArray(snapshot.expenses)) await db.expenses.bulkPut(snapshot.expenses as Expense[]);
    if (Array.isArray(snapshot.documents)) await db.documents.bulkPut(snapshot.documents as PropertyDocument[]);
    if (Array.isArray(snapshot.contractors)) await db.contractors.bulkPut(snapshot.contractors as Contractor[]);
    if (Array.isArray(snapshot.maintenance_schedules)) await db.maintenance_schedules.bulkPut(snapshot.maintenance_schedules as MaintenanceSchedule[]);
  });
}
