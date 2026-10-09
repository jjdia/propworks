-- PropertyWorks v2 — schema-v7-security-hardening.sql
-- RECORDED FROM LIVE. Already applied to the live project via the Supabase
-- SQL editor; committed here for reference/reproducibility.
-- Source: supabase_migrations.schema_migrations in the live dump taken
-- 2026-10-08 20:54 ET. Entries (verbatim, except the redacted secret):
--   20260919171150  harden_function_search_path            (live-only, never in repo)
--   20260920051941  revoke_anon_execute_my_portfolio_id    (live-only, never in repo)
--   20260921024046  security_hardening_invites_and_scoping
--   20260921024233  rent_reminder_cron_auth                (x-cron-secret REDACTED)
--   20260921024308  security_hardening_revoke_anon
-- Run after schema-v6-notifications.sql.
--
-- SECRET HANDLING: the live cron job embeds the CRON_SECRET value. It is
-- NOT committed. If you ever re-run this file, replace <CRON_SECRET> with the
-- value from Supabase → Edge Functions → Secrets (CRON_SECRET) in the SQL
-- editor only — never commit the real value.

-- ---------------------------------------------- 20260919171150 harden_function_search_path
alter function public.set_updated_at() set search_path = public;

-- ---------------------------------------------- 20260920051941 revoke_anon_execute_my_portfolio_id
revoke execute on function public.my_portfolio_id() from public;
revoke execute on function public.my_portfolio_id() from anon;
grant execute on function public.my_portfolio_id() to authenticated;

-- ---------------------------------------------- 20260921024046 security_hardening_invites_and_scoping
-- ============================================================================
-- SECURITY FIX 1: invite codes were readable by ANY logged-in user.
-- The old policies were `for select using (used_at is null)` — with no
-- filter tying the read to a specific code the caller already knows, RLS
-- doesn't restrict this: any authenticated user could run
-- `select * from tenant_invites` and get every unredeemed invite code for
-- every portfolio on the whole system, then use one to hijack someone
-- else's tenant/contractor/co-owner slot. Fix: remove direct table access
-- for redemption entirely and replace it with SECURITY DEFINER functions
-- that look up by exact code, validate, and act atomically — the client
-- never gets to read the table, only call a function with a code it
-- already possesses.
-- ============================================================================

drop policy if exists tenant_invites_redeem on tenant_invites;
drop policy if exists contractor_invites_redeem on contractor_invites;
drop policy if exists owner_invites_redeem on owner_invites;

create or replace function redeem_tenant_invite(p_code text, p_full_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite tenant_invites;
begin
  select * into v_invite from tenant_invites where code = upper(p_code) and used_at is null;
  if not found then
    raise exception 'Invalid or already-used invite code';
  end if;

  insert into profiles (id, owner_id, role, tenant_id, full_name)
  values (auth.uid(), v_invite.owner_id, 'tenant', v_invite.tenant_id, p_full_name);

  update tenant_invites set used_at = now() where id = v_invite.id;
end;
$$;

create or replace function redeem_contractor_invite(p_code text, p_full_name text, p_trade text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite contractor_invites;
begin
  select * into v_invite from contractor_invites where code = upper(p_code) and used_at is null;
  if not found then
    raise exception 'Invalid or already-used invite code';
  end if;

  insert into profiles (id, owner_id, role, full_name, trade, contractor_status)
  values (auth.uid(), v_invite.owner_id, 'contractor', p_full_name, p_trade, 'pending');

  update contractor_invites set used_at = now() where id = v_invite.id;
end;
$$;

create or replace function redeem_owner_invite(p_code text, p_full_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite owner_invites;
begin
  select * into v_invite from owner_invites where code = upper(p_code) and used_at is null;
  if not found then
    raise exception 'Invalid or already-used invite code';
  end if;

  insert into profiles (id, owner_id, role, full_name)
  values (auth.uid(), v_invite.owner_id, 'owner', p_full_name);

  update owner_invites set used_at = now() where id = v_invite.id;
end;
$$;

revoke all on function redeem_tenant_invite(text, text) from public;
revoke all on function redeem_contractor_invite(text, text, text) from public;
revoke all on function redeem_owner_invite(text, text) from public;
grant execute on function redeem_tenant_invite(text, text) to authenticated;
grant execute on function redeem_contractor_invite(text, text, text) to authenticated;
grant execute on function redeem_owner_invite(text, text) to authenticated;

-- ============================================================================
-- SECURITY FIX 2: a contractor approved under ANY portfolio could insert a
-- bid on ANY other portfolio's approved_for_bidding request, as long as
-- they could learn/guess its UUID — the insert policy only checked the
-- request's status, not that it belonged to the contractor's own approved
-- network (the SELECT policy already did this correctly; INSERT did not
-- mirror it). Also enforce that the bid's own owner_id actually matches
-- the request it's bidding on, so it can't be set to something else.
-- ============================================================================

drop policy if exists job_bids_contractor_insert on job_bids;
create policy job_bids_contractor_insert on job_bids
  for insert with check (
    contractor_id = auth.uid()
    and maintenance_request_id in (
      select mr.id from maintenance_requests mr
      where mr.status = 'approved_for_bidding'
        and mr.owner_id in (
          select owner_id from profiles
          where id = auth.uid() and role = 'contractor' and contractor_status = 'approved'
        )
    )
    and owner_id = (select owner_id from maintenance_requests where id = maintenance_request_id)
  );

-- ============================================================================
-- SECURITY FIX 3: a tenant creating a maintenance request could set
-- owner_id to an arbitrary value instead of their own landlord's, letting
-- them inject a fabricated request into a completely different owner's
-- portfolio. Enforce owner_id must match the tenant's own actual owner.
-- ============================================================================

drop policy if exists maintenance_tenant_insert on maintenance_requests;
create policy maintenance_tenant_insert on maintenance_requests
  for insert with check (
    submitted_by = auth.uid()
    and tenant_id in (select tenant_id from profiles where id = auth.uid() and role = 'tenant')
    and owner_id = (select owner_id from tenants where id = tenant_id)
  );


-- ---------------------------------------------- 20260921024233 rent_reminder_cron_auth
select cron.unschedule('rent-reminder-check-daily');

select cron.schedule(
  'rent-reminder-check-daily',
  '0 13 * * *',
  $$
  select net.http_post(
    url := 'https://crdrwtxeogkloxuathzh.supabase.co/functions/v1/rent-reminder-check',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>')
  );
  $$
);


-- ---------------------------------------------- 20260921024308 security_hardening_revoke_anon
revoke execute on function redeem_tenant_invite(text, text) from anon;
revoke execute on function redeem_contractor_invite(text, text, text) from anon;
revoke execute on function redeem_owner_invite(text, text) from anon;
revoke execute on function my_portfolio_id() from anon;

