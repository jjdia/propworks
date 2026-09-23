# PropertyWorks — Project Handoff

This file is the bridge from a long claude.ai chat session (22 versions built
and deployed) to Claude Code. Read this fully before making changes. It
replaces needing the original chat history.

## What this is

A mobile-first property management PWA for a Staten Island landlord (Jeff),
rebuilt from scratch as a React/Vite/TypeScript app after the original
single-file app had unrecoverable data-loss bugs. Tenant, contractor, and
co-owner logins exist alongside the owner/admin.

## Tech stack

- React 19 + Vite 8 + TypeScript, Tailwind v4
- react-router (**HashRouter** — deliberate, see note below)
- Zustand for app state
- Dexie (IndexedDB) as local source of truth for the owner's own private data
- Supabase (Postgres + Auth + Storage + Edge Functions) as sync target and
  shared multi-party backend
- vite-plugin-pwa for manifest/service worker
- jsPDF (dynamically imported) for PDF generation; SheetJS (xlsx) for Excel
  export; Recharts for charts

**Why HashRouter:** deploy targets (GitHub Pages, Netlify static) don't
reliably rewrite arbitrary paths to index.html, and hash routing sidesteps
that entirely. Don't switch to BrowserRouter without solving that first.

## Architecture — the one thing to understand before touching anything

There are **two persistence patterns** in this app, used deliberately for
different data:

1. **Local-first (Dexie + outbox sync)** — for the owner's own private data:
   properties, rental_units, tenants, leases, rent_charges, rent_payments,
   rent_installments, expenses, documents, contractors, maintenance_schedules.
   All UI reads/writes go through `src/lib/mutations.ts`, which writes Dexie
   first (instant, offline-capable) then queues an outbox entry.
   `src/lib/sync.ts` pushes the outbox and pulls remote changes via
   `bulkPut` (upsert) — **never** a table replace/clear. This exists
   specifically because the original app lost data by replacing local state
   with empty cloud results. Do not break this invariant.

2. **Direct Supabase (shared multi-party state)** — for the maintenance
   request → bidding → award → completion workflow, and profiles/invites.
   Multiple different logins (tenant, owner, contractor) need to see live
   shared state, so there's no meaningful "local copy." `src/lib/maintenance.ts`
   talks to Supabase directly. Privacy/security is enforced via Postgres RLS,
   not app logic.

Every mutation to local-first tables must go through `mutations.ts` — never
call `db.<table>.put()` directly from a component.

## Supabase project

- Project ref: `crdrwtxeogkloxuathzh`
- URL: `https://crdrwtxeogkloxuathzh.supabase.co`
- Anon/publishable key (safe to embed client-side, RLS does the actual
  protection): `[REDACTED_ANON_KEY]`
- Org: "Propwoks" (free tier, $0/mo)
- Migrations live in `supabase/`, must be applied **in order** (schema.sql,
  schema-v2 through schema-v8 — check the directory for exact current list).
  All have already been applied to the live project directly via SQL during
  the chat session — they're in the repo for reference/reproducibility, not
  because they're pending.

### Edge Functions (already deployed, live on the Supabase project)

- `send-email` — generic transactional email (onboarding/maintenance-update/
  broadcast). Derives `owner_id` from the caller's own JWT server-side and
  requires role='owner' — do not revert to trusting a client-supplied
  owner_id, that was a real vulnerability that got fixed.
- `rent-reminder-check` — scheduled daily via pg_cron (13:00 UTC / 9am ET),
  requires an `x-cron-secret` header matching the `CRON_SECRET` secret.

### Secrets status (Supabase dashboard → Edge Functions → Secrets)

- `CRON_SECRET` — **already set** by Jeff, value:
  `[REDACTED_CRON_SECRET]`
- `RESEND_API_KEY` — **pending**. Jeff connected Resend but it was stuck on
  custom-domain DNS propagation. Check whether it's been added; if not,
  email sending will silently no-op (the functions handle a missing key
  gracefully, they don't crash).

## Deployment

**Currently:** manual — Claude built a zip, Jeff drag-and-dropped it onto
Netlify's Deploys page for the site `propertyworks-app`
(propertyworks-app.netlify.app). This is what you're being brought in to
replace with real CI.

**As of this handoff:** Netlify's free-tier operational credits were
exhausted after ~22 manual deploys in one session. The **live site is still
up and unaffected** — only *new* deploys are blocked until the credit cycle
resets or the team is upgraded. Confirm current status before assuming this
is still the case.

**Two build configs exist:**
- `vite.config.ts` — GitHub Pages target, base path `/propworks/`
- `vite.config.netlify.ts` — Netlify target, base path `/`

**Your task:** set up a GitHub repo + GitHub Actions workflow that builds
with `vite.config.netlify.ts` and deploys to Netlify on every push to main,
using a Netlify auth token + site ID Jeff will provide, plus
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` as build-time secrets (values
above). This removes the manual zip-upload step entirely going forward.

Also worth setting up: GitHub Pages deploy via `vite.config.ts` as a second
target, since that was the original intended host before the mobile-upload
problem forced the Netlify pivot — ask Jeff if he still wants both.

## Testing — run before every deploy, no exceptions

Seven pure-logic test suites in `scripts/`, run with `npx tsx scripts/<file>.ts`:
`persistence-test.ts`, `installment-test.ts`, `report-test.ts`,
`lease-template-test.ts`, `email-template-test.ts`, `overdue-test.ts`,
`maintenance-schedule-test.ts`. All 123 tests pass as of v22. Also run
`npx tsc -b` (must be clean) and `npm run build` before considering any
change done.

## Working conventions Jeff has been explicit about

- **Every form/modal must have a Cancel button.** He found and was
  genuinely frustrated by one missing instance — treat this as non-negotiable
  going forward, audit new forms as you build them.
- **Every piece of user-entered data must be editable after the fact**, not
  just create+delete. (Expenses were missing this; fixed in v19.)
- **Every account role must have complete login + logout + password-reset.**
  Confirmed complete for owner/co-owner/tenant/contractor as of v22 — don't
  regress this when adding new roles or nav changes.
- Bump `src/version.ts` (`APP_VERSION`) on every deploy — it's shown on the
  Login screen and the main app header specifically so version mismatches
  are debuggable from a screenshot.
- Security matters: a full audit (v19) found and fixed real RLS/auth holes
  (invite codes were publicly enumerable, cross-portfolio bid injection,
  spoofable owner_id in emails/requests). Think about entitlement boundaries
  on every new feature — who can read/write what, and could a
  tenant/contractor account abuse it against another portfolio.
- This is NOT the REBNY lease form and must never claim to be — the lease
  generator is Claude's own template, explicitly disclaimed as not legal
  advice.

## Known open items / not yet built

- Renovations and Buy-Sell Deals tracking (in the original app spec, never
  rebuilt)
- True push notifications while the app is fully closed (current
  implementation only notifies when the app is opened)
- SMS/Twilio (Jeff explicitly deferred this — email + in-app only for now)
- Bundle size has grown to ~660KB gzip total; jsPDF is already code-split,
  recharts/xlsx are not — worth revisiting if load time becomes a complaint

## People/accounts for reference

- Jeff and Lana share one portfolio (co-owner feature) — this was
  intentional, not a bug, after an early confusion where they had two
  separate empty portfolios.
- Known test accounts exist in the Supabase project from development
  (jeff.jdia@gmail.com, lana.jdia@gmail.com as owners; at least one pending
  contractor signup). Leave them — they're real accounts Jeff uses.
