import { db, writeRollingBackup } from './db';
import { supabase, supabaseConfigured } from './supabase';
import type { OutboxItem } from './types';

// ---------------------------------------------------------------------------
// SYNC RULES (these map directly to the data-integrity rules from the old
// app's spec — this file is the enforcement point for all of them):
//
//  - Every mutation is written to Dexie FIRST (instant, works offline), then
//    queued in the outbox. The UI never waits on a network round-trip.
//  - PUSH sends only the outbox: individual upsert/delete calls, one row at
//    a time. There is no "send the whole table" operation, so a partial
//    failure can't nuke unrelated rows.
//  - PULL fetches rows changed since the last successful sync (by
//    updated_at) and merges them into Dexie with `bulkPut` — an upsert, not
//    a replace. An empty or failed pull is a no-op, never a clear().
//  - Deletes are soft (deleted_at set), both locally and remotely, so a
//    delete a user didn't intend can always be recovered by an admin later,
//    and a sync race can never look like "the whole table vanished."
//  - If a push fails, the outbox item stays queued and retries later with
//    backoff. Local data is already saved regardless of push success.
// ---------------------------------------------------------------------------

const TABLES = [
  'properties', 'rental_units', 'tenants', 'leases',
  'rent_charges', 'rent_payments', 'rent_installments', 'expenses', 'documents',
  'contractors', 'maintenance_schedules',
] as const;
type SyncTable = typeof TABLES[number];

const LAST_PULL_KEY = 'last_pull_at';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

let listeners: Array<(s: SyncStatus) => void> = [];
export function onSyncStatus(cb: (s: SyncStatus) => void) {
  listeners.push(cb);
  return () => { listeners = listeners.filter((l) => l !== cb); };
}
function setStatus(s: SyncStatus) {
  listeners.forEach((l) => l(s));
}

// Queue a local mutation for later push. Call this from every write helper
// (see mutations.ts) right after writing to Dexie.
export async function enqueueOutbox(table: SyncTable, recordId: string, payload: unknown, op: 'upsert' | 'delete' = 'upsert') {
  const item: OutboxItem = {
    id: crypto.randomUUID(),
    table,
    recordId,
    op,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  await db.outbox.add(item);
}

async function pushOutbox() {
  if (!supabase) return;
  const items = await db.outbox.orderBy('createdAt').toArray();
  for (const item of items) {
    try {
      const table = item.table as SyncTable;
      if (item.op === 'delete') {
        const { error } = await supabase.from(table)
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', item.recordId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from(table).upsert(item.payload as object);
        if (error) throw error;
      }
      await db.outbox.delete(item.id);
    } catch (err) {
      await db.outbox.update(item.id, {
        attempts: item.attempts + 1,
        lastError: err instanceof Error ? err.message : String(err),
      });
      // Stop on first failure for this pass; we'll retry the whole queue
      // next sync cycle rather than hammering on a broken item.
      throw err;
    }
  }
}

async function pullTable(table: SyncTable, ownerId: string, since: string | null) {
  if (!supabase) return;
  let query = supabase.from(table).select('*').eq('owner_id', ownerId);
  if (since) query = query.gt('updated_at', since);
  const { data, error } = await query;
  if (error) throw error;
  if (!data || data.length === 0) return; // No-op. Never clears anything.

  // bulkPut = upsert by primary key. Existing local rows not present in
  // `data` are left completely untouched.
  await (db[table] as import('dexie').Table<unknown, string>).bulkPut(data);
}

export async function runSync(ownerId: string | null) {
  if (!supabaseConfigured || !navigator.onLine) {
    setStatus('offline');
    return;
  }
  setStatus('syncing');
  try {
    await pushOutbox();
    if (ownerId) {
      const since = localStorage.getItem(LAST_PULL_KEY);
      for (const table of TABLES) {
        await pullTable(table, ownerId, since);
      }
      localStorage.setItem(LAST_PULL_KEY, new Date().toISOString());
    }
    await writeRollingBackup();
    setStatus('idle');
  } catch (err) {
    console.error('Sync error (local data is untouched):', err);
    setStatus('error');
  }
}

let syncInterval: ReturnType<typeof setInterval> | null = null;
export function startBackgroundSync(getOwnerId: () => string | null, intervalMs = 30_000) {
  if (syncInterval) clearInterval(syncInterval);
  runSync(getOwnerId());
  syncInterval = setInterval(() => runSync(getOwnerId()), intervalMs);
  window.addEventListener('online', () => runSync(getOwnerId()));
}
