-- PropertyWorks v2 — schema-v6-notifications.sql
-- RECORDED FROM LIVE. Already applied to the live project (crdrwtxeogkloxuathzh)
-- via the Supabase SQL editor; committed here for reference/reproducibility.
-- Source: supabase_migrations.schema_migrations in the live dump taken
-- 2026-10-08 20:54 ET. Statements are copied verbatim from these entries:
--   20260920225523  notifications_and_broadcasts
--   20260920225639  rent_reminder_cron   (superseded by v7's rent_reminder_cron_auth)
-- Run after schema-v5-documents.sql.
-- Requires pg_cron + pg_net (enabled from the Supabase dashboard on hosted).

-- ---------------------------------------------- 20260920225523 notifications_and_broadcasts
-- Notification log: records every email attempt (onboarding, rent reminder,
-- maintenance update, broadcast) for history/debugging, sent by Edge
-- Functions using the service role (RLS still restricts owner reads to
-- their own portfolio).
create table if not exists notification_log (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id),
  kind          text not null check (kind in ('onboarding', 'rent_reminder', 'maintenance_update', 'broadcast')),
  recipient_email text not null,
  tenant_id     uuid references tenants(id),
  related_id    uuid, -- rent_installment id, maintenance_request id, broadcast id, etc, depending on kind
  subject       text not null,
  status        text not null default 'sent' check (status in ('sent', 'failed')),
  error_message text,
  sent_at       timestamptz not null default now()
);
alter table notification_log enable row level security;
create policy notification_log_owner_read on notification_log
  for select using (owner_id = my_portfolio_id());
-- Only server-side (service role, via Edge Functions) inserts rows; no
-- client insert policy is granted.

create index if not exists idx_notification_log_owner_sent on notification_log (owner_id, sent_at);

-- Broadcasts / announcements (e.g. "pest control scheduled Tuesday").
create table if not exists broadcasts (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id),
  subject     text not null,
  body        text not null,
  target      text not null default 'all_tenants' check (target in ('all_tenants', 'property', 'selected_tenants')),
  property_id uuid references properties(id),
  created_at  timestamptz not null default now()
);
alter table broadcasts enable row level security;
create policy broadcasts_owner_all on broadcasts
  for all using (owner_id = my_portfolio_id()) with check (owner_id = my_portfolio_id());

create table if not exists broadcast_recipients (
  id            uuid primary key default gen_random_uuid(),
  broadcast_id  uuid not null references broadcasts(id) on delete cascade,
  tenant_id     uuid not null references tenants(id),
  email_status  text not null default 'pending' check (email_status in ('pending', 'sent', 'failed')),
  created_at    timestamptz not null default now()
);
alter table broadcast_recipients enable row level security;
create policy broadcast_recipients_owner_read on broadcast_recipients
  for select using (
    broadcast_id in (select id from broadcasts where owner_id = my_portfolio_id())
  );

create index if not exists idx_broadcast_recipients_broadcast on broadcast_recipients (broadcast_id);


-- ---------------------------------------------- 20260920225639 rent_reminder_cron
-- NOTE: this first version had no auth header; v7 replaces the job with
-- one that sends x-cron-secret. Kept for history.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'rent-reminder-check-daily',
  '0 13 * * *', -- 9am US Eastern (13:00 UTC), daily
  $$
  select net.http_post(
    url := 'https://crdrwtxeogkloxuathzh.supabase.co/functions/v1/rent-reminder-check',
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
  $$
);

