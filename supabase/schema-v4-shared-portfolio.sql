-- PropertyWorks v2 — schema-v4-shared-portfolio.sql
-- Additive migration. Run after schema.sql, schema-v2-maintenance.sql,
-- schema-v3-payment-schedule.sql.
--
-- PROBLEM THIS SOLVES:
--   Every owner signup created its own fully isolated portfolio (keyed by
--   their own auth.uid()). Two people who both administer the SAME real
--   business (e.g. a married couple) got two separate, empty-looking
--   portfolios instead of one shared one.
--
-- DESIGN:
--   profiles.owner_id already meant "which portfolio does this login
--   belong to" for tenants and contractors. This migration extends that
--   same meaning to owner-role profiles too: a solo owner's profile has
--   owner_id = their own id (self), same as before. A co-owner who
--   accepts an invite gets their profile.owner_id repointed to the
--   ORIGINAL portfolio's id instead of their own — so every RLS check
--   that used to say "owner_id = auth.uid()" now says "owner_id = my
--   portfolio's id", via the my_portfolio_id() helper below. Nothing about
--   cross-portfolio isolation changes: two different portfolios (e.g. two
--   different customers if this app is ever resold) still can't see each
--   other, at all.

create or replace function my_portfolio_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select owner_id from profiles where id = auth.uid()
$$;

-- ---------------------------------------------------------- owner_invites
create table if not exists owner_invites (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id), -- the portfolio being shared
  code       text not null unique,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
alter table owner_invites enable row level security;
create policy owner_invites_owner_manage on owner_invites
  for all using (owner_id = my_portfolio_id()) with check (owner_id = my_portfolio_id());
create policy owner_invites_redeem on owner_invites
  for select using (used_at is null);

-- ---------------------------------------------------- re-point RLS policies
-- Every policy below moves from "owner_id = auth.uid()" (my own login) to
-- "owner_id = my_portfolio_id()" (my portfolio, which for a solo owner is
-- still just their own id — so this is a no-op for anyone who hasn't
-- shared their portfolio with a co-owner).

alter policy properties_owner_only on properties
  using (owner_id = my_portfolio_id()) with check (owner_id = my_portfolio_id());
alter policy rental_units_owner_only on rental_units
  using (owner_id = my_portfolio_id()) with check (owner_id = my_portfolio_id());
alter policy tenants_owner_only on tenants
  using (owner_id = my_portfolio_id()) with check (owner_id = my_portfolio_id());
alter policy leases_owner_only on leases
  using (owner_id = my_portfolio_id()) with check (owner_id = my_portfolio_id());
alter policy rent_charges_owner_only on rent_charges
  using (owner_id = my_portfolio_id()) with check (owner_id = my_portfolio_id());
alter policy rent_payments_owner_only on rent_payments
  using (owner_id = my_portfolio_id()) with check (owner_id = my_portfolio_id());
alter policy rent_installments_owner_only on rent_installments
  using (owner_id = my_portfolio_id()) with check (owner_id = my_portfolio_id());
alter policy expenses_owner_only on expenses
  using (owner_id = my_portfolio_id()) with check (owner_id = my_portfolio_id());

alter policy profiles_owner_manage on profiles
  using (owner_id = my_portfolio_id()) with check (owner_id = my_portfolio_id());
alter policy tenant_invites_owner_manage on tenant_invites
  using (owner_id = my_portfolio_id()) with check (owner_id = my_portfolio_id());
alter policy contractor_invites_owner_manage on contractor_invites
  using (owner_id = my_portfolio_id()) with check (owner_id = my_portfolio_id());
alter policy maintenance_owner_all on maintenance_requests
  using (owner_id = my_portfolio_id()) with check (owner_id = my_portfolio_id());
alter policy job_bids_owner_all on job_bids
  using (owner_id = my_portfolio_id()) with check (owner_id = my_portfolio_id());
alter policy job_completions_owner_all on job_completions
  using (owner_id = my_portfolio_id()) with check (owner_id = my_portfolio_id());

alter policy storage_owner_all on storage.objects
  using (
    bucket_id = 'maintenance-photos'
    and (storage.foldername(name))[1]::uuid in (
      select id from maintenance_requests where owner_id = my_portfolio_id()
    )
  );

-- Tenant/contractor read-side policies (properties_tenant_own_read etc.)
-- are unaffected — they scope by the caller's own tenant_id/contractor
-- approval, not by owner_id = auth.uid(), so they still work unchanged.
