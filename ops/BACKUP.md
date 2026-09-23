# PropWorks backups & restore

Last updated: 2026-09-23 (EDT)

## What exists where

| Store | What it holds | Automated? | Notes |
| --- | --- | --- | --- |
| **Dexie IndexedDB** (`propertyworks-v2`) | Owner private portfolio (source of truth for UI) | N/A (browser-local) | Cannot be dumped from the server. |
| **localStorage** `propertyworks_backup_v2` (+ `_history`, last 5) | Rolling JSON snapshot after every mutation | Automatic in-app | Same browser only; lost if site data cleared. |
| **Downloadable JSON** (Account page) | Full Dexie snapshot file | Manual (user) | Safest off-device copy of client data. |
| **Supabase Postgres** | Synced portfolio + maintenance/bidding/profiles/invites | **Daily Actions dump** once `SUPABASE_DB_URL` is set | RLS blocks anon dumps. |
| **GitHub Actions artifacts** | `pg_dump` `.sql.gz` from workflow | Daily 09:00 UTC + manual | 30-day retention. |
| **GitHub Actions secrets** | `VITE_SUPABASE_*` only today | N/A | Not app data. |

### Dexie tables in client backups

`properties`, `rental_units`, `tenants`, `leases`, `rent_charges`, `rent_payments`,
`rent_installments`, `expenses`, `documents`, `contractors`, `maintenance_schedules`.

Outbox / meta are **not** included (transient sync state).

### Supabase tables (server dump)

Everything in the project DB that `pg_dump` can see, including local-first sync
targets plus shared tables from `supabase/schema*.sql`:
`profiles`, invites, `maintenance_requests`, `job_bids`, `job_completions`, etc.

Storage bucket **files** (maintenance photos) are **not** included in the SQL
dump — re-upload or use Supabase Storage backups separately if needed.

---

## Honest gap: no service-role / DB password yet

Repo Actions secrets today:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Those are **build-time public** credentials. They cannot produce a full DB
backup under RLS.

### REQUIRED_SECRET for Jeff

Add a repository secret:

| Name | Value |
| --- | --- |
| `SUPABASE_DB_URL` | Postgres URI from Supabase → **Project Settings → Database → Connection string (URI)**. Include the database password. Prefer **Session** or **Direct** (not Transaction pooler) for `pg_dump`. |

Do **not** put the `service_role` key in git or in this secret name unless you
intentionally switch tooling — this workflow uses `pg_dump` over the DB URL.

Until `SUPABASE_DB_URL` exists, `.github/workflows/backup-supabase.yml` fails
fast with a clear `REQUIRED_SECRET` error. Client backups still work.

---

## Client backup & restore (available now)

### Automatic rolling backup

- Written by `writeRollingBackup()` after every mutation (`mutations.ts`) and after sync pulls.
- Keys: `propertyworks_backup_v2`, `propertyworks_backup_v2_history` (max 5).
- On crash, `RecoveryBoundary` offers “Restore latest local backup”.

### Manual download / restore

1. Open the app → **Account**.
2. **Download backup JSON** — save the file to Drive/email.
3. To restore: **Restore from backup file…** (or restore the latest rolling local backup).
4. Confirm **Merge & reload**. Restore uses `bulkPut` only — **never** `clear()`.

Recommended cadence: download a JSON backup after any large data entry session,
and at least weekly.

### Ops note for developers

```bash
# No Node dump of IndexedDB from CI is possible for Jeff's real browser data.
# Enhance/test restore logic via fake-indexeddb in scripts if needed.
```

---

## Server backup (GitHub Actions)

Workflow: `.github/workflows/backup-supabase.yml`

- **Schedule:** daily `0 9 * * *` UTC (~5:00 AM EDT / 4:00 AM EST).
- **Manual:** Actions → “Backup Supabase” → Run workflow.
- **Script:** `ops/supabase-backup.sh` → `backup-out/propworks-supabase-<UTC>.sql.gz`.
- **Storage:** workflow artifact `propworks-supabase-backup-<run_id>`, **30 days**.

### Local / one-off dump

```bash
export SUPABASE_DB_URL='postgresql://…'   # never commit
./ops/supabase-backup.sh ./backup-out
```

---

## Restore from a Supabase artifact

1. Download the artifact from the successful workflow run.
2. Decompress: `gunzip propworks-supabase-YYYYMMDD….sql.gz`
3. **Danger:** restoring over production replaces objects flagged by `--clean`.
   Prefer restoring into a **new** Supabase project / staging DB first.
4. Apply:

```bash
psql "$SUPABASE_DB_URL" -f propworks-supabase-….sql
```

5. After DB restore, open the app signed in as owner and let sync **pull** merge
   remote rows into Dexie (`bulkPut`). Do **not** clear IndexedDB manually.

If only a client JSON backup exists (no DB dump): use Account → Restore from
backup file, then wait for outbox sync to push missing rows (if still logged in).

---

## What this does *not* cover

- Full IndexedDB from a remote machine (impossible without the browser).
- Supabase Storage binary objects.
- Guaranteed multi-year retention (artifacts expire at 30 days — download
  important dumps elsewhere if you need longer).
- Restoring auth.users passwords beyond what `pg_dump` of the project DB
  includes (auth schema may be partially restricted depending on connection).
