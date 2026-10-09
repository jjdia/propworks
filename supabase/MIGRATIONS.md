# Supabase migration inventory

Live project: `crdrwtxeogkloxuathzh`. Every file below has **already been
applied** to live via the Supabase SQL editor (which records each run in
`supabase_migrations.schema_migrations`). Files are kept for
reference/reproducibility and must be applied **in order** on a fresh project.

| Repo file | Live `schema_migrations` entries (version · name) |
|---|---|
| `schema.sql` | 20260919171055 · core_schema |
| `schema-v2-maintenance.sql` | 20260919171119 · maintenance_multi_role |
| `schema-v3-payment-schedule.sql` | 20260919194344 · payment_schedule_installments; 20260919194939 · installment_unknown_status (folded in) |
| `schema-v4-shared-portfolio.sql` | 20260919204114 · shared_portfolio |
| `schema-v5-documents.sql` | 20260920203320 · documents_table |
| `schema-v6-notifications.sql` | 20260920225523 · notifications_and_broadcasts; 20260920225639 · rent_reminder_cron |
| `schema-v7-security-hardening.sql` | 20260919171150 · harden_function_search_path; 20260920051941 · revoke_anon_execute_my_portfolio_id; 20260921024046 · security_hardening_invites_and_scoping; 20260921024233 · rent_reminder_cron_auth; 20260921024308 · security_hardening_revoke_anon |
| `schema-v8-contractors-schedules.sql` | 20260922022615 · contractor_roster_and_scheduled_maintenance |
| `schema-v9-payer-setups.sql` | issue #10 — see HANDOFF "Payer setups" for live-apply status |

Next free number: **v10**.

## Verification (2026-10-08)

v6–v8 were recovered verbatim from `supabase_migrations.schema_migrations`
in the live dump `propworks-live-20261008-205438.dump` (taken 2026-10-08
20:54 ET, pg 17.6). Replaying `schema.sql` + v2–v8 on an empty Postgres 17
(with stub `auth.users` / `auth.uid()`) produces a `public` schema whose
columns, constraints, indexes, RLS policies and functions match the live
dump exactly (only Supabase platform pieces — `storage.*`, `pg_cron`,
`pg_net` — can't be replayed off-platform).

## Secrets

`schema-v7-security-hardening.sql` contains the cron job that calls
`rent-reminder-check`. The live job embeds the real `CRON_SECRET`; the repo
copy has the placeholder `<CRON_SECRET>`. Never commit the real value.

## Adding a migration

1. Take and verify a live backup first (see `ops/BACKUP.md`); record path,
   timestamp, size and sha256 in the PR description and `HANDOFF.md`.
2. Additive only (`add column if not exists`, `create table if not exists`).
3. Apply to live **before** merging/deploying any UI that writes the new
   columns — `pushOutbox()` stops on the first rejected upsert.
4. Add a row to the table above.
