-- PropertyWorks v2 — schema-v3-payment-schedule.sql
-- Additive migration. Run after schema.sql and schema-v2-maintenance.sql.
--
-- Adds:
--   - leases.government_payment_frequency, leases.tenant_payment_method
--     (subsidy_program already existed as free text; the app now
--     constrains it to none/section8/cityfheps/hra in the UI)
--   - rent_installments: the actual due sub-payments within a month's
--     rent_charge. HRA is always paid on the 15th and 30th; CityFHEPS can
--     be monthly or twice-monthly per tenant; a tenant's own portion can
--     be paid directly or routed through HRA (also 15th/30th in that case).

alter table leases
  add column if not exists government_payment_frequency text default 'monthly'
    check (government_payment_frequency in ('monthly', 'twice_monthly')),
  add column if not exists tenant_payment_method text default 'direct'
    check (tenant_payment_method in ('direct', 'hra'));

create table if not exists rent_installments (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users(id),
  rent_charge_id uuid not null references rent_charges(id),
  portion        text not null check (portion in ('government', 'tenant')),
  payer          text not null, -- 'section8' | 'cityfheps' | 'hra' | 'tenant'
  amount         numeric(10,2) not null,
  due_date       date not null,
  status         text not null default 'due' check (status in ('unknown', 'due', 'paid', 'late', 'partial')),
  paid_date      date,
  paid_amount    numeric(10,2),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create trigger trg_rent_installments_updated_at before update on rent_installments
  for each row execute function set_updated_at();

alter table rent_installments enable row level security;
create policy rent_installments_owner_only on rent_installments
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create index if not exists idx_rent_installments_owner_due on rent_installments (owner_id, due_date);
create index if not exists idx_rent_installments_charge on rent_installments (rent_charge_id);
