-- PropertyWorks v2 — schema-v10-push-and-recurring.sql   (V 34)
-- Web Push rent reminders + recurring-expense (bill) reminders.
-- Run after schema-v9-payer-setups.sql.
--
-- ADDITIVE ONLY: three new tables + nullable columns expenses.recurring_expense_id
-- and leases.hra_recert_due_on.
-- No drops, no constraint changes on existing columns, no data rewrites.
-- Safe to re-run (if not exists everywhere; policies guarded by DO blocks).
--
-- NOT APPLIED TO LIVE. Release step: take + verify a backup, then apply this
-- in the SQL editor BEFORE merging the V 34 UI (pushOutbox stops on the first
-- rejected upsert, and V 34 writes recurring_expenses and
-- expenses.recurring_expense_id).
--
-- The daily cron job is NOT in this file (it must embed the real
-- CRON_SECRET). See supabase/cron-push-reminders.sql.

-- ------------------------------------------------------- push_subscriptions
-- One row per browser/device Web Push subscription. Every role (owner,
-- tenant) manages ONLY its own rows. The push-reminders Edge Function reads
-- them with the service role.
create table if not exists push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'push_subscriptions' and policyname = 'push_subscriptions_own_rows') then
    create policy push_subscriptions_own_rows on push_subscriptions
      for all to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end $$;
revoke all on push_subscriptions from anon;
create index if not exists idx_push_subscriptions_user on push_subscriptions (user_id);

-- ------------------------------------------------------------ push_send_log
-- Idempotency + history for pushes. notification_log (v6) does not fit:
-- its kind CHECK only allows the 4 email kinds and recipient_email is NOT
-- NULL, and changing that constraint would not be additive.
-- dedupe_key is UNIQUE: the function inserts it BEFORE sending, so a re-run
-- (or a double cron fire) can send at most one push per tenant per due date.
create table if not exists push_send_log (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id),
  kind        text not null check (kind in ('rent_due', 'tenant_portion_15th', 'landlord_summary', 'bill_due', 'hra_recert')),
  dedupe_key  text not null unique,
  tenant_id   uuid references tenants(id),
  user_id     uuid references auth.users(id),
  related_id  uuid, -- lease id / recurring_expense id
  due_date    date,
  title       text not null,
  body        text,
  devices_sent   int not null default 0,
  devices_failed int not null default 0,
  status      text not null default 'pending' check (status in ('pending', 'sent', 'no_devices', 'failed')),
  error_message text,
  created_at  timestamptz not null default now()
);
alter table push_send_log enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'push_send_log' and policyname = 'push_send_log_owner_read') then
    create policy push_send_log_owner_read on push_send_log
      for select using (owner_id = my_portfolio_id());
  end if;
end $$;
-- Only the Edge Function (service role) writes. No client insert policy.
revoke all on push_send_log from anon;
create index if not exists idx_push_send_log_owner_created on push_send_log (owner_id, created_at);

-- ------------------------------------------------------ recurring_expenses
-- Owner-private (Dexie + outbox, synced via src/lib/sync.ts TABLES).
-- amount and due_day are nullable on purpose: seeded rows start blank and
-- Jeff fills them in. Nothing is hardcoded.
create table if not exists recurring_expenses (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users(id),
  property_id    uuid not null references properties(id),
  rental_unit_id uuid references rental_units(id),
  category       text not null check (category in ('mortgage', 'property_tax', 'insurance', 'hoa', 'water_sewer', 'gas', 'electric', 'internet', 'other')),
  payee          text,
  amount         numeric(10,2),
  due_day        int check (due_day between 1 and 31),
  frequency      text not null default 'monthly' check (frequency in ('monthly', 'quarterly', 'semiannual', 'annual')),
  anchor_month   int check (anchor_month between 1 and 12),
  active         boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_recurring_expenses_updated_at') then
    create trigger trg_recurring_expenses_updated_at before update on recurring_expenses
      for each row execute function set_updated_at();
  end if;
end $$;
alter table recurring_expenses enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'recurring_expenses' and policyname = 'recurring_expenses_owner_only') then
    create policy recurring_expenses_owner_only on recurring_expenses
      for all using (owner_id = my_portfolio_id()) with check (owner_id = my_portfolio_id());
  end if;
end $$;
revoke all on recurring_expenses from anon;
create index if not exists idx_recurring_expenses_owner_updated on recurring_expenses (owner_id, updated_at);

-- --------------------------------------------- expenses.recurring_expense_id
-- Stamped by "Pay & log" together with the existing billing_period column
-- (YYYY-MM) so that occurrence shows as logged. No FK on purpose (same
-- reason as leases.hra_proof_document_id: the outbox pushes one row at a
-- time and an FK could reject the expense if it arrives before its bill).
alter table expenses add column if not exists recurring_expense_id uuid;

-- ------------------------------------------------ leases.hra_recert_due_on
-- Optional explicit yearly HRA recertification date (setup 3). NULL means
-- hra_approved_on + 1 year. No default, no backfill. Owner-only via the
-- existing leases_owner_only policy.
alter table leases add column if not exists hra_recert_due_on date;
