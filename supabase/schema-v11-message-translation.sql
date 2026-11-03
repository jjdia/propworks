-- PropertyWorks v2 — schema-v11-message-translation.sql   (V 35)
-- Tenant-message translation (self-hosted LibreTranslate via the `translate`
-- Edge Function). Run after schema-v10-push-and-recurring.sql.
--
-- ADDITIVE ONLY: one new owner-private table, tenant_messages.
-- No drops, no changes to existing tables/columns/constraints, no data rewrites.
-- Safe to re-run (if not exists everywhere; policy/trigger guarded by DO blocks).
--
-- NOT APPLIED TO LIVE. Release step: take + verify a backup (HANDOFF backup
-- gate), then apply this BEFORE merging/deploying the V 35 UI — pushOutbox
-- stops on the first rejected upsert, and V 35 writes tenant_messages.
--
-- Owner-private (Dexie table tenant_messages, Dexie v6, synced via
-- src/lib/sync.ts TABLES). Tenants/contractors have NO access: the policy
-- matches owner_id = my_portfolio_id() AND requires the caller's profile
-- role = 'owner' (a tenant profile's owner_id is the landlord's portfolio,
-- so the role check is what keeps tenants out).

create table if not exists tenant_messages (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references auth.users(id),
  tenant_id          uuid not null, -- no FK on purpose (outbox pushes one row at a time)
  direction          text not null check (direction in ('incoming', 'outgoing')),
  channel            text,
  body_original      text not null,          -- exactly what was written
  original_language  text,                   -- detected (incoming) / 'en' (outgoing)
  body_english       text,                   -- English text
  body_translated    text,                   -- outgoing: text in tenant's language
  target_language    text,
  translation_state  text not null default 'pending' check (translation_state in ('pending', 'done', 'failed', 'not_needed')),
  translation_error  text,
  status             text not null check (status in ('received', 'draft', 'approved', 'sent')),
  approved_text      text,
  approved_at        timestamptz,
  sent_at            timestamptz,
  received_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  -- Defense in depth for "nothing sends without approval".
  constraint tenant_messages_sent_requires_approval
    check (status <> 'sent' or (direction = 'outgoing' and approved_at is not null and approved_text is not null))
);

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_tenant_messages_updated_at') then
    create trigger trg_tenant_messages_updated_at before update on tenant_messages
      for each row execute function set_updated_at();
  end if;
end $$;

alter table tenant_messages enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'tenant_messages' and policyname = 'tenant_messages_owner_only') then
    create policy tenant_messages_owner_only on tenant_messages
      for all to authenticated
      using (owner_id = my_portfolio_id()
             and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner'))
      with check (owner_id = my_portfolio_id()
             and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner'));
  end if;
end $$;
revoke all on tenant_messages from anon;
create index if not exists idx_tenant_messages_owner_updated on tenant_messages (owner_id, updated_at);
create index if not exists idx_tenant_messages_tenant on tenant_messages (tenant_id);
