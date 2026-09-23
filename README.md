# PropertyWorks v2

Rebuilt from scratch on React + Vite + TypeScript, deployed as a PWA to
GitHub Pages. See `src/lib/sync.ts` and `src/lib/db.ts` for the persistence
architecture -- that's the part this rebuild exists to fix.

## Architecture, in one paragraph

The UI reads and writes **only** the local IndexedDB (via Dexie), never
Supabase directly. Every write goes through `src/lib/mutations.ts`, which
saves to Dexie first (instant, works offline), then queues the change in an
outbox table for background sync. Sync (`src/lib/sync.ts`) pushes the outbox
one row at a time and pulls remote changes with `bulkPut` (upsert, never a
table replace or `.clear()`). Deletes are soft (`deleted_at`), both locally
and remotely. A rolling localStorage backup snapshots the full dataset after
every mutation as a second line of defense, and a top-level React error
boundary (`RecoveryBoundary`) guarantees a crash shows a recovery screen with
a restore-from-backup button instead of a blank page.

This directly targets the failure mode described in the v1 handoff doc:
local data being silently replaced or wiped by an empty/failed cloud sync.
With this design that specific failure class isn't possible -- nothing here
ever writes an empty remote result back over a non-empty local table.

## Local development

```bash
npm install
cp .env.example .env   # fill in your Supabase project URL + anon key
npm run dev
```

Without a `.env`, the app still runs -- it just stays in local-only mode
(no login, no cross-device sync, data lives in this browser only).

## Deploying

1. Create a **new** Supabase project (this is a schema redesign, not reusing
   the old `PropertyWorks` project) and run `supabase/schema.sql` in the SQL
   editor.
2. In the new project's API settings, copy the Project URL and the
   **anon/public** key (never the `service_role` key).
3. In the GitHub repo, add those as Actions secrets: `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`.
4. Push to `main` -- `.github/workflows/deploy.yml` builds and deploys to
   GitHub Pages automatically. In repo Settings -> Pages, set source to
   "GitHub Actions" (not "Deploy from a branch").
5. `vite.config.ts` has `base: '/propworks/'` -- update this if the repo
   name changes.

## What v1 of the rebuild covers

Properties, rental units (apartments + garages/parking unified), tenants,
leases, rent charges/payments, expenses, dashboard. Deliberately **not**
included yet, in order of likely priority: lease generator, maintenance
requests, contractor marketplace, documents, broadcast center, tax export.
The schema and sync engine are built so those slot in as more tables +
pages without touching the persistence layer.

## Data-integrity rules this codebase enforces (do not violate these)

- Never call `.clear()` on a Dexie table, and never replace a Supabase pull
  result by anything other than `bulkPut` (row-level upsert).
- Every mutation goes through `src/lib/mutations.ts`, not raw `db.<table>.put`.
- Deletes are soft (`deleted_at`) everywhere, local and remote.
- Any new top-level route must render inside `<RecoveryBoundary>`.
- Schema changes: keep old columns/tables around (additive migrations) until
  a full backup is confirmed; never drop a column with user data in it.
