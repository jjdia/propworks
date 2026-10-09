-- PropertyWorks v2 — schema-v9-payer-setups.sql
-- Issue #10: three payer setups (self-pay / gov + tenant / gov + HRA),
-- per-payer Partial/Full tracking, HRA proof fields.
-- Run after schema-v8-contractors-schedules.sql.
--
-- ADDITIVE ONLY: no new tables, no drops, no constraint changes on existing
-- columns, no data rewrites. Safe to re-run (if not exists everywhere).
--
-- - leases.tenant_payment_frequency has NO default on purpose. NULL means
--   "the payer's default": HRA tenant share → 2 checks (15th/30th); tenant
--   paying directly → 1 check on rent_due_day. That is exactly how
--   installments were built before this migration, so existing leases keep
--   their schedule. A 'monthly' default would silently move HRA leases to
--   one check.
-- - leases.hra_proof_document_id points at documents.id but deliberately has
--   NO foreign key: the outbox pushes one row at a time, and an FK could
--   reject the lease if it reached the server before its document, which
--   would stall the whole queue.
-- - rent_charges.marked_full_at is stamped when Jeff taps "Mark Full" on a
--   gov-setup month. NULL on existing rows; existing 'paid' months still
--   display as Full.
-- - RLS: covered by the existing leases_owner_only / rent_charges_owner_only
--   policies (my_portfolio_id()). hra_case_number is personal data and stays
--   on owner-only rows.

alter table leases
  add column if not exists tenant_payment_frequency text
    check (tenant_payment_frequency in ('monthly', 'twice_monthly')),
  add column if not exists hra_case_number       text,
  add column if not exists hra_approved_on       date,
  add column if not exists hra_proof_document_id uuid;

alter table rent_charges
  add column if not exists marked_full_at timestamptz;
