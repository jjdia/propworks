-- PropertyWorks v2 — schema-v5-documents.sql
-- Additive migration. Run after schema-v4-shared-portfolio.sql.
-- Stores generated leases and other saved paperwork. Follows the same
-- owner-scoped, soft-delete pattern as properties/expenses/etc, and uses
-- my_portfolio_id() so co-owners share the same document set.

create table if not exists documents (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id),
  property_id uuid not null references properties(id),
  tenant_id   uuid references tenants(id),
  lease_id    uuid references leases(id),
  doc_type    text not null default 'lease' check (doc_type in ('lease', 'contract', 'notice', 'receipt', 'insurance', 'tax', 'other')),
  title       text not null,
  content     text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create trigger trg_documents_updated_at before update on documents
  for each row execute function set_updated_at();

alter table documents enable row level security;
create policy documents_owner_only on documents
  for all using (owner_id = my_portfolio_id()) with check (owner_id = my_portfolio_id());

create index if not exists idx_documents_owner_updated on documents (owner_id, updated_at);
