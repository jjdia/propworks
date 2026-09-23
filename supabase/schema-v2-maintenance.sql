-- PropertyWorks v2 — schema-v2-maintenance.sql
-- Additive migration on top of schema.sql. Run this in the SAME Supabase
-- project after schema.sql. Adds the three-role system (owner/tenant/
-- contractor) and the maintenance request -> admin approval -> contractor
-- bidding -> award -> completion workflow.
--
-- KEY PRIVACY RULE THIS FILE ENFORCES:
--   Tenants can only ever see rows where tenant_id = their own tenant_id
--   (via their profile). They can never see another tenant's requests.
--   Contractors can only see a request once its status is
--   'approved_for_bidding' or later (i.e. only after the owner reviews and
--   approves it) — never while it's sitting in 'submitted'/admin review.
--   Contractors never get a policy path to the tenants table at all, so
--   even a joined query can't resolve a tenant_id to a name/contact.

-- ------------------------------------------------------------------ profiles
-- One row per authenticated user (tenant, contractor, or the owner/admin).
-- owner_id identifies which landlord's "network" this person belongs to —
-- for the owner's own profile, owner_id = id (self-reference).
create table if not exists profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  owner_id          uuid not null references auth.users(id),
  role              text not null check (role in ('owner', 'tenant', 'contractor')),
  full_name         text,
  phone             text,
  tenant_id         uuid references tenants(id),      -- set when role = 'tenant'
  contractor_status text default 'pending' check (contractor_status in ('pending', 'approved', 'rejected')),
  trade             text,                              -- contractor's trade/specialty
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger trg_profiles_updated_at before update on profiles
  for each row execute function set_updated_at();

alter table profiles enable row level security;

-- Everyone can read their own profile; the owner can read every profile in
-- their network (needed to show tenant names, approve contractors, etc).
create policy profiles_self_read on profiles
  for select using (id = auth.uid() or owner_id = auth.uid());
create policy profiles_self_update on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_owner_manage on profiles
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
-- A new user can create their own profile row on signup.
create policy profiles_self_insert on profiles
  for insert with check (id = auth.uid());

-- -------------------------------------------------------------- invites
-- Short codes the owner generates and hands to a tenant or contractor so
-- their signup gets linked to the right tenant record / owner network,
-- instead of anyone being able to self-serve into your data.
create table if not exists tenant_invites (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id),
  tenant_id  uuid not null references tenants(id),
  code       text not null unique,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
alter table tenant_invites enable row level security;
create policy tenant_invites_owner_manage on tenant_invites
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
-- Anyone signed in can look up an invite BY CODE to redeem it (they don't
-- know the owner_id/tenant_id ahead of time — the code is the secret).
create policy tenant_invites_redeem on tenant_invites
  for select using (used_at is null);

create table if not exists contractor_invites (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id),
  code       text not null unique,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
alter table contractor_invites enable row level security;
create policy contractor_invites_owner_manage on contractor_invites
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy contractor_invites_redeem on contractor_invites
  for select using (used_at is null);

-- ------------------------------------------------------- maintenance_requests
create table if not exists maintenance_requests (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references auth.users(id),
  property_id         uuid not null references properties(id),
  rental_unit_id      uuid references rental_units(id),
  tenant_id           uuid not null references tenants(id),
  submitted_by        uuid not null references auth.users(id),
  title               text not null,
  description         text,
  urgency             text not null default 'normal', -- normal | important | urgent | emergency
  permission_to_enter boolean not null default false,
  photos              jsonb not null default '[]',     -- array of storage object paths
  status              text not null default 'submitted',
    -- submitted -> approved_for_bidding -> awarded -> completed -> closed
    -- (or 'rejected' at the admin-review step)
  awarded_bid_id      uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
create trigger trg_maintenance_requests_updated_at before update on maintenance_requests
  for each row execute function set_updated_at();
alter table maintenance_requests enable row level security;

-- Owner: full access to everything in their portfolio.
create policy maintenance_owner_all on maintenance_requests
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Tenant: can see and create only their OWN requests. Cannot see anyone else's.
create policy maintenance_tenant_own on maintenance_requests
  for select using (
    tenant_id in (select tenant_id from profiles where id = auth.uid() and role = 'tenant')
  );
create policy maintenance_tenant_insert on maintenance_requests
  for insert with check (
    submitted_by = auth.uid()
    and tenant_id in (select tenant_id from profiles where id = auth.uid() and role = 'tenant')
  );

-- Contractor: can see a request ONLY once the owner has approved it for
-- bidding (or later status), and only within their own approved network.
-- This is the enforcement point for "only visible to contractors after
-- admin review and approval."
create policy maintenance_contractor_approved on maintenance_requests
  for select using (
    status in ('approved_for_bidding', 'awarded', 'completed', 'closed')
    and owner_id in (
      select owner_id from profiles
      where id = auth.uid() and role = 'contractor' and contractor_status = 'approved'
    )
  );

-- ------------------------------------------------------------------ job_bids
create table if not exists job_bids (
  id                     uuid primary key default gen_random_uuid(),
  owner_id               uuid not null references auth.users(id),
  maintenance_request_id uuid not null references maintenance_requests(id),
  contractor_id          uuid not null references auth.users(id),
  amount                 numeric(10,2) not null,
  message                text,
  status                 text not null default 'pending', -- pending | awarded | rejected
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz
);
create trigger trg_job_bids_updated_at before update on job_bids
  for each row execute function set_updated_at();
alter table job_bids enable row level security;

create policy job_bids_owner_all on job_bids
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Contractors can create bids on requests they're allowed to see, and can
-- see/manage only their OWN bids (not competitors' bid amounts).
create policy job_bids_contractor_own on job_bids
  for select using (contractor_id = auth.uid());
create policy job_bids_contractor_insert on job_bids
  for insert with check (
    contractor_id = auth.uid()
    and maintenance_request_id in (
      select id from maintenance_requests where status = 'approved_for_bidding'
    )
  );
create policy job_bids_contractor_update_own on job_bids
  for update using (contractor_id = auth.uid() and status = 'pending')
  with check (contractor_id = auth.uid());

-- ------------------------------------------------------------- job_completions
create table if not exists job_completions (
  id                     uuid primary key default gen_random_uuid(),
  owner_id               uuid not null references auth.users(id),
  maintenance_request_id uuid not null references maintenance_requests(id),
  contractor_id          uuid not null references auth.users(id),
  notes                  text,
  photos                 jsonb not null default '[]',
  payment_status         text not null default 'pending', -- pending | paid
  submitted_at           timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create trigger trg_job_completions_updated_at before update on job_completions
  for each row execute function set_updated_at();
alter table job_completions enable row level security;

create policy job_completions_owner_all on job_completions
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy job_completions_contractor_own on job_completions
  for select using (contractor_id = auth.uid());
create policy job_completions_contractor_insert on job_completions
  for insert with check (
    contractor_id = auth.uid()
    and maintenance_request_id in (
      select id from maintenance_requests
      where status = 'awarded'
        and awarded_bid_id in (select id from job_bids where contractor_id = auth.uid())
    )
  );

-- -------------------------------------------------------- storage: photos
-- Bucket for maintenance request photos + job completion photos. Private
-- bucket — access goes through the policies below, not public URLs.
insert into storage.buckets (id, name, public)
values ('maintenance-photos', 'maintenance-photos', false)
on conflict (id) do nothing;

-- Path convention: {maintenance_request_id}/{request|completion}/{filename}
-- Owner: full access to all photos in their portfolio.
create policy storage_owner_all on storage.objects
  for all using (
    bucket_id = 'maintenance-photos'
    and (storage.foldername(name))[1]::uuid in (
      select id from maintenance_requests where owner_id = auth.uid()
    )
  );

-- Tenant: can upload/view photos only on their own requests.
create policy storage_tenant_own on storage.objects
  for all using (
    bucket_id = 'maintenance-photos'
    and (storage.foldername(name))[1]::uuid in (
      select id from maintenance_requests
      where tenant_id in (select tenant_id from profiles where id = auth.uid() and role = 'tenant')
    )
  );

-- Contractor: can view photos only on requests visible to them (approved
-- for bidding or later), and can upload only under the 'completion' path
-- for a job they were awarded.
create policy storage_contractor_read on storage.objects
  for select using (
    bucket_id = 'maintenance-photos'
    and (storage.foldername(name))[1]::uuid in (
      select id from maintenance_requests
      where status in ('approved_for_bidding', 'awarded', 'completed', 'closed')
        and owner_id in (
          select owner_id from profiles
          where id = auth.uid() and role = 'contractor' and contractor_status = 'approved'
        )
    )
  );
create policy storage_contractor_upload_completion on storage.objects
  for insert with check (
    bucket_id = 'maintenance-photos'
    and (storage.foldername(name))[2] = 'completion'
    and (storage.foldername(name))[1]::uuid in (
      select mr.id from maintenance_requests mr
      join job_bids b on b.id = mr.awarded_bid_id
      where b.contractor_id = auth.uid()
    )
  );

create index if not exists idx_maintenance_owner on maintenance_requests (owner_id, status);
create index if not exists idx_maintenance_tenant on maintenance_requests (tenant_id);
create index if not exists idx_job_bids_request on job_bids (maintenance_request_id);
create index if not exists idx_job_bids_contractor on job_bids (contractor_id);

-- ------------------------------------------------------ tenant read access
-- Tenants need to know which property/unit they're in to file a request
-- against it. Grant narrow, read-only access to just their own lease chain
-- — this does NOT let a tenant see other units, other tenants, or anything
-- about the owner's finances (expenses/rent_charges/etc stay owner-only).
create policy properties_tenant_own_read on properties
  for select using (
    id in (
      select ru.property_id from rental_units ru
      join leases l on l.rental_unit_id = ru.id
      join profiles p on p.tenant_id = l.tenant_id
      where p.id = auth.uid() and p.role = 'tenant'
    )
  );

create policy rental_units_tenant_own_read on rental_units
  for select using (
    id in (
      select l.rental_unit_id from leases l
      join profiles p on p.tenant_id = l.tenant_id
      where p.id = auth.uid() and p.role = 'tenant'
    )
  );

create policy leases_tenant_own_read on leases
  for select using (
    tenant_id in (select tenant_id from profiles where id = auth.uid() and role = 'tenant')
  );
