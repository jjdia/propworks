import { db, writeRollingBackup } from './db';
import { enqueueOutbox } from './sync';
import type {
  Property, RentalUnit, Tenant, Lease, RentCharge, RentPayment, RentInstallment, Expense, PropertyDocument,
  Contractor, MaintenanceSchedule,
} from './types';
export { buildInstallments } from './installments';

// Every create/update in the app should go through one of these helpers.
// They all do the same three things, in order:
//   1. write to Dexie (so the UI updates instantly via useLiveQuery)
//   2. enqueue the change in the outbox (so it reaches Supabase eventually)
//   3. refresh the rolling localStorage backup
// Never call db.<table>.put(...) directly from a component — go through here
// so nothing skips the outbox and silently fails to sync.

function nowIso() { return new Date().toISOString(); }

type MutableTable = 'properties' | 'rental_units' | 'tenants' | 'leases' | 'rent_charges' | 'rent_payments' | 'rent_installments' | 'expenses' | 'documents' | 'contractors' | 'maintenance_schedules';

async function saveRecord<T extends { id: string; owner_id: string; updated_at: string; created_at: string }>(
  table: MutableTable,
  record: T,
): Promise<T> {
  const stamped = { ...record, updated_at: nowIso() };
  const tbl = db[table] as unknown as import('dexie').Table<T, string>;
  await tbl.put(stamped);
  await enqueueOutbox(table, stamped.id, stamped, 'upsert');
  void writeRollingBackup();
  return stamped;
}

export function newId() { return crypto.randomUUID(); }

export function blankMeta(ownerId: string) {
  const id = newId();
  const ts = nowIso();
  return { id, owner_id: ownerId, created_at: ts, updated_at: ts, deleted_at: null };
}

export const saveProperty = (p: Property) => saveRecord('properties', p);
export const saveRentalUnit = (u: RentalUnit) => saveRecord('rental_units', u);
export const saveTenant = (t: Tenant) => saveRecord('tenants', t);
export const saveLease = (l: Lease) => saveRecord('leases', l);
export const saveRentCharge = (c: RentCharge) => saveRecord('rent_charges', c);
export const saveRentPayment = (p: RentPayment) => saveRecord('rent_payments', p);
export const saveRentInstallment = (i: RentInstallment) => saveRecord('rent_installments', i);
export const saveExpense = (e: Expense) => saveRecord('expenses', e);
export const saveDocument = (d: PropertyDocument) => saveRecord('documents', d);
export const saveContractor = (c: Contractor) => saveRecord('contractors', c);
export const saveMaintenanceSchedule = (m: MaintenanceSchedule) => saveRecord('maintenance_schedules', m);

// Soft delete: sets deleted_at locally (record stays recoverable) and
// enqueues the same soft-delete to Supabase. Nothing is ever hard-removed
// by app logic.
export async function softDelete(table: MutableTable, id: string) {
  const ts = nowIso();
  const tbl = db[table] as unknown as import('dexie').Table<{ id: string; deleted_at: string | null; updated_at: string }, string>;
  await tbl.update(id, { deleted_at: ts, updated_at: ts });
  await enqueueOutbox(table, id, null, 'delete');
  void writeRollingBackup();
}

