-- PropertyWorks v2 schema
-- Design goals (in priority order):
--   1. Never lose data. Every table is soft-delete (deleted_at) — nothing is
--      ever hard-deleted by sync logic, only by an explicit owner action that
--      sets deleted_at (and even then rows are kept, just filtered out).
--   2. Every row carries owner_id + updated_at so the client can do
--      last-write-wins, per-row merge sync instead of "replace whole table".
--   3. RLS is owner_id = auth.uid() on every table. No service-role use in
--      the browser, ever.
--
-- This intentionally does NOT try to be feature-complete with the old app on
-- day one. It covers: properties, rental units (apartments AND garages/
-- storage/parking unified), tenants, leases, rent charges (monthly
-- obligations), rent payments, and expenses. Maintenance, contractors,
-- documents, broadcasts, tax export come after persistence is proven solid.

create extension if not exists "pgcrypto";

-- Shared trigger: keep updated_at current on every write.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------- properties
create table if not exists properties (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id),
  name         text not null,          -- e.g. "62 Fillmore Street"
  address_line text,
  city         text,
  state        text,
  zip          text,
  property_type text,                  -- two-family / multi-family / condo / single-family
  entity_name  text,                   -- e.g. "55 Claradon Lane Irrevocable Trust"
  has_mortgage boolean default false,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create trigger trg_properties_updated_at before update on properties
  for each row execute function set_updated_at();

-- ------------------------------------------------------------- rental_units
-- Covers apartments/units AND garages/parking/storage — unified so income
-- reporting can aggregate everything under a property without a separate
-- "rental_spaces" table that's easy to forget to join.
create table if not exists rental_units (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id),
  property_id  uuid not null references properties(id),
  name         text not null,          -- "Unit 2A", "Fillmore Garage"
  unit_kind    text not null default 'apartment', -- apartment | garage | parking | storage | other
  status       text not null default 'vacant',    -- vacant | occupied | available | advertising
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create trigger trg_rental_units_updated_at before update on rental_units
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------- tenants
create table if not exists tenants (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null references auth.users(id),
  full_name            text not null,
  phone                text,
  email                text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  other_occupants      text,
  pets                 text,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);
create trigger trg_tenants_updated_at before update on tenants
  for each row execute function set_updated_at();

-- ------------------------------------------------------------------ leases
create table if not exists leases (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users(id),
  rental_unit_id    uuid not null references rental_units(id),
  tenant_id         uuid not null references tenants(id),
  lease_start       date,
  lease_end         date,
  total_monthly_rent numeric(10,2) not null default 0,
  subsidy_program   text,             -- Section 8 / CityFHEPS / Other Agency / none
  government_portion numeric(10,2) default 0,
  tenant_portion     numeric(10,2) default 0,
  rent_due_day       int default 1,
  security_deposit   numeric(10,2),
  status             text not null default 'active', -- active | ended | draft
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create trigger trg_leases_updated_at before update on leases
  for each row execute function set_updated_at();

-- --------------------------------------------------------------- rent_charges
-- One row per unit per month = the expected obligation. This replaces the
-- old "rent_obligations" as the single source of truth for expected rent.
create table if not exists rent_charges (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references auth.users(id),
  lease_id           uuid not null references leases(id),
  charge_month       date not null,    -- always the 1st of the month
  total_rent         numeric(10,2) not null default 0,
  government_portion numeric(10,2) default 0,
  tenant_portion     numeric(10,2) default 0,
  due_date           date,
  status             text not null default 'unknown', -- unknown | due | paid | late | partial
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  unique (lease_id, charge_month)
);
create trigger trg_rent_charges_updated_at before update on rent_charges
  for each row execute function set_updated_at();

-- -------------------------------------------------------------- rent_payments
-- Multiple payment lines can point at one rent_charge (split rent).
create table if not exists rent_payments (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users(id),
  rent_charge_id uuid not null references rent_charges(id),
  paid_date      date not null default current_date,
  amount         numeric(10,2) not null,
  source         text not null default 'tenant', -- tenant | section8 | cityfheps | other_agency
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create trigger trg_rent_payments_updated_at before update on rent_payments
  for each row execute function set_updated_at();

-- ------------------------------------------------------------------ expenses
create table if not exists expenses (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id),
  property_id  uuid not null references properties(id),
  expense_date date not null default current_date,
  category     text not null,
  paid_by      text not null default 'landlord', -- landlord | tenant | split_reimbursed
  frequency    text not null default 'one_time', -- one_time | monthly | quarterly | seasonal | annual
  vendor       text,
  amount       numeric(10,2) not null,
  billing_period text,
  description  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create trigger trg_expenses_updated_at before update on expenses
  for each row execute function set_updated_at();

-- ------------------------------------------------------------- RLS policies
alter table properties     enable row level security;
alter table rental_units   enable row level security;
alter table tenants        enable row level security;
alter table leases         enable row level security;
alter table rent_charges   enable row level security;
alter table rent_payments  enable row level security;
alter table expenses       enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['properties','rental_units','tenants','leases','rent_charges','rent_payments','expenses']
  loop
    execute format('
      create policy %I on %I
        for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
    ', t || '_owner_only', t);
  end loop;
end $$;

-- Helpful indexes for sync (pull-since-timestamp pattern).
create index if not exists idx_properties_owner_updated on properties (owner_id, updated_at);
create index if not exists idx_rental_units_owner_updated on rental_units (owner_id, updated_at);
create index if not exists idx_tenants_owner_updated on tenants (owner_id, updated_at);
create index if not exists idx_leases_owner_updated on leases (owner_id, updated_at);
create index if not exists idx_rent_charges_owner_updated on rent_charges (owner_id, updated_at);
create index if not exists idx_rent_payments_owner_updated on rent_payments (owner_id, updated_at);
create index if not exists idx_expenses_owner_updated on expenses (owner_id, updated_at);
