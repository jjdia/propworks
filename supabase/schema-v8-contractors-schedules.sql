-- PropertyWorks v2 — schema-v8-contractors-schedules.sql
-- RECORDED FROM LIVE. Already applied to the live project via the Supabase
-- SQL editor; committed here for reference/reproducibility.
-- Source: supabase_migrations.schema_migrations in the live dump taken
-- 2026-10-08 20:54 ET. Entry (verbatim):
--   20260922022615  contractor_roster_and_scheduled_maintenance
-- Creates `contractors` and `maintenance_schedules` (both synced local-first
-- via src/lib/sync.ts TABLES) and relaxes maintenance_requests.tenant_id.
-- Run after schema-v7-security-hardening.sql.

-- Owner-initiated maintenance requests don't always have a specific tenant
-- (e.g. a common-area repair, or the owner just noticing something) —
-- relax the not-null constraint that assumed every request came from a
-- tenant portal submission.
alter table maintenance_requests alter column tenant_id drop not null;

-- ---------------------------------------------------------- contractor roster
-- A simple rolodex of contractors/handymen the owner works with, separate
-- from the portal login/approval flow (profiles + contractor_invites) —
-- this is the owner's OWN private reference data (name/trade/contact), so
-- it follows the local-first Dexie pattern like tenants/properties, not
-- the shared multi-party pattern maintenance_requests/job_bids use.
create table if not exists contractors (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id),
  full_name  text not null,
  trade      text,
  phone      text,
  email      text,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger trg_contractors_updated_at before update on contractors
  for each row execute function set_updated_at();
alter table contractors enable row level security;
create policy contractors_owner_only on contractors
  for all using (owner_id = my_portfolio_id()) with check (owner_id = my_portfolio_id());
create index if not exists idx_contractors_owner on contractors (owner_id, updated_at);

-- ------------------------------------------------------ scheduled maintenance
-- Recurring, routine maintenance (pest control monthly, HVAC service twice
-- a year, etc) tracked as its own simple list with a next-due date, rather
-- than forced through the tenant-request/bidding pipeline that's meant for
-- one-off repair requests.
create table if not exists maintenance_schedules (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references auth.users(id),
  property_id           uuid not null references properties(id),
  title                 text not null,
  description           text,
  frequency             text not null check (frequency in ('weekly', 'monthly', 'quarterly', 'semi_annual', 'annual')),
  next_due_date         date not null,
  last_completed_date   date,
  assigned_contractor_id uuid references contractors(id),
  status                text not null default 'active' check (status in ('active', 'paused')),
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);
create trigger trg_maintenance_schedules_updated_at before update on maintenance_schedules
  for each row execute function set_updated_at();
alter table maintenance_schedules enable row level security;
create policy maintenance_schedules_owner_only on maintenance_schedules
  for all using (owner_id = my_portfolio_id()) with check (owner_id = my_portfolio_id());
create index if not exists idx_maintenance_schedules_owner_due on maintenance_schedules (owner_id, next_due_date);

