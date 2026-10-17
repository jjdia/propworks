// push-reminders — daily Web Push for rent-due (tenants), the landlord
// summary, and recurring-bill due days (V 34).
//
// Triggered by pg_cron (supabase/cron-push-reminders.sql) with the same
// x-cron-secret pattern as rent-reminder-check. Runs daily; does nothing for
// rent except on the 1st and 15th (America/New_York).
//
// Secrets (Supabase → Edge Functions → Secrets; set as a release step):
//   CRON_SECRET (already set), VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
//   VAPID_SUBJECT (e.g. mailto:jeff.jdia@gmail.com)
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
//
// Decision logic lives in the PURE shared modules (copied from src/lib by
// scripts/sync-edge-shared.mjs and unit-tested in scripts/*-test.ts).
// Idempotency: push_send_log.dedupe_key is UNIQUE and is inserted BEFORE
// sending, so a re-run sends at most one push per tenant per due date.
//
// Body (optional): { "dry_run": true, "today": "YYYY-MM-DD" } — dry_run
// returns the plan without sending or logging.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { planRentPushes, buildLandlordSummary } from '../_shared/rentPush.ts';
import { billsDueToday, RECURRING_CATEGORY_LABEL, periodOf } from '../_shared/recurringExpenses.ts';
import { fmtMoney } from '../_shared/chargeStatus.ts';

type Json = Record<string, unknown>;
const json = (b: Json, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

function todayInNewYork(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

interface Sub { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }
interface LogRow { owner_id: string; kind: string; dedupe_key: string; tenant_id?: string | null; user_id?: string | null; related_id?: string | null; due_date?: string | null; title: string; body: string }

async function sendLogged(sb: SupabaseClient, row: LogRow, subs: Sub[], url: string, dryRun: boolean) {
  if (dryRun) return { key: row.dedupe_key, devices: subs.length, dryRun: true };
  // Claim the dedupe key first. If it already exists, this push already went out.
  const { data: claimed, error } = await sb.from('push_send_log')
    .upsert({ ...row, status: 'pending' }, { onConflict: 'dedupe_key', ignoreDuplicates: true })
    .select('id');
  if (error) return { key: row.dedupe_key, error: error.message };
  if (!claimed || claimed.length === 0) return { key: row.dedupe_key, skipped: 'already_sent' };
  const logId = claimed[0].id as string;
  if (subs.length === 0) {
    await sb.from('push_send_log').update({ status: 'no_devices' }).eq('id', logId);
    return { key: row.dedupe_key, devices: 0 };
  }
  let ok = 0, failed = 0; const errs: string[] = [];
  const payload = JSON.stringify({ title: row.title, body: row.body, url, tag: row.dedupe_key });
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24 });
      ok++;
    } catch (e) {
      failed++;
      const code = (e as { statusCode?: number }).statusCode;
      errs.push(String(code ?? (e as Error).message));
      // Subscription gone/expired → remove it so we stop trying.
      if (code === 404 || code === 410) await sb.from('push_subscriptions').delete().eq('id', s.id);
    }
  }
  await sb.from('push_send_log').update({
    devices_sent: ok, devices_failed: failed,
    status: ok > 0 ? 'sent' : 'failed', error_message: errs.length ? errs.join(', ').slice(0, 500) : null,
  }).eq('id', logId);
  return { key: row.dedupe_key, devices: ok, failed };
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json({ error: 'unauthorized' }, 401);

  const pub = Deno.env.get('VAPID_PUBLIC_KEY');
  const priv = Deno.env.get('VAPID_PRIVATE_KEY');
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';
  if (!pub || !priv) return json({ error: 'VAPID keys not configured' }, 500);
  webpush.setVapidDetails(subject, pub, priv);

  let body: Json = {};
  try { body = await req.json(); } catch { /* cron sends no body */ }
  const dryRun = body.dry_run === true;
  const today = typeof body.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : todayInNewYork();
  const month = `${today.slice(0, 7)}-01`;
  const appUrl = Deno.env.get('APP_URL') ?? 'https://jjdia.github.io/propworks/';

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const { data: profiles, error: pErr } = await sb.from('profiles').select('id, owner_id, role, tenant_id');
  if (pErr) return json({ error: pErr.message }, 500);
  const portfolios = [...new Set((profiles ?? []).filter((p) => p.role === 'owner').map((p) => p.owner_id as string))];
  const results: Json[] = [];

  for (const ownerId of portfolios) {
    const ownerUsers = (profiles ?? []).filter((p) => p.role === 'owner' && p.owner_id === ownerId).map((p) => p.id as string);
    const tenantUsers = new Map<string, string[]>();
    for (const p of profiles ?? []) {
      if (p.role === 'tenant' && p.owner_id === ownerId && p.tenant_id) tenantUsers.set(p.tenant_id, [...(tenantUsers.get(p.tenant_id) ?? []), p.id]);
    }
    const allUsers = [...ownerUsers, ...[...tenantUsers.values()].flat()];
    const { data: subs } = await sb.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', allUsers);
    const subsFor = (users: string[]) => (subs ?? []).filter((s) => users.includes(s.user_id)) as Sub[];

    const out: Json = { ownerId, today };
    const day = Number(today.slice(8, 10));
    if (day === 1 || day === 15) {
      const [{ data: leases }, { data: charges }, { data: tenants }] = await Promise.all([
        sb.from('leases').select('*').eq('owner_id', ownerId).is('deleted_at', null),
        sb.from('rent_charges').select('*').eq('owner_id', ownerId).eq('charge_month', month).is('deleted_at', null),
        sb.from('tenants').select('id, full_name').eq('owner_id', ownerId),
      ]);
      const chargeIds = (charges ?? []).map((c) => c.id);
      const { data: installments } = chargeIds.length
        ? await sb.from('rent_installments').select('*').in('rent_charge_id', chargeIds).is('deleted_at', null)
        : { data: [] };
      const input = { today, leases: leases ?? [], charges: charges ?? [], installments: installments ?? [], tenants: tenants ?? [] };
      const plan = planRentPushes(input);
      const sent: Json[] = [];
      for (const d of plan.decisions) {
        sent.push(await sendLogged(sb, {
          owner_id: ownerId, kind: d.kind, dedupe_key: d.dedupeKey, tenant_id: d.tenantId,
          related_id: d.leaseId, due_date: d.dueDate, title: d.title, body: d.body,
        }, subsFor(tenantUsers.get(d.tenantId) ?? []), appUrl, dryRun));
      }
      const reachable = new Set([...tenantUsers.entries()].filter(([, u]) => subsFor(u).length > 0).map(([t]) => t));
      const summary = buildLandlordSummary(plan, input, reachable);
      const landlord = await sendLogged(sb, {
        owner_id: ownerId, kind: 'landlord_summary', dedupe_key: `landlord:${ownerId}:${today}`,
        due_date: today, title: summary.title, body: summary.body,
      }, subsFor(ownerUsers), `${appUrl}rent`, dryRun);
      Object.assign(out, { tenantPushes: sent, skipped: plan.skipped, landlord, summary });
    }

    // Recurring bills due today → push to the owner users.
    const [{ data: bills }, { data: logged }] = await Promise.all([
      sb.from('recurring_expenses').select('*').eq('owner_id', ownerId).eq('active', true).is('deleted_at', null),
      sb.from('expenses').select('id, recurring_expense_id, billing_period, deleted_at').eq('owner_id', ownerId).eq('billing_period', periodOf(today)).not('recurring_expense_id', 'is', null),
    ]);
    const { data: props } = await sb.from('properties').select('id, name').eq('owner_id', ownerId);
    const billPushes: Json[] = [];
    for (const { occurrence: o, dedupeKey } of billsDueToday(bills ?? [], logged ?? [], today)) {
      const prop = (props ?? []).find((p) => p.id === o.bill.property_id)?.name ?? 'Property';
      const label = RECURRING_CATEGORY_LABEL[o.bill.category];
      billPushes.push(await sendLogged(sb, {
        owner_id: ownerId, kind: 'bill_due', dedupe_key: dedupeKey, related_id: o.bill.id, due_date: o.dueDate,
        title: `${label} due today`,
        body: `${prop}${o.bill.payee ? ` · ${o.bill.payee}` : ''}${o.bill.amount != null ? ` · ${fmtMoney(Number(o.bill.amount))}` : ''}. Tap to pay & log.`,
      }, subsFor(ownerUsers), `${appUrl}bills`, dryRun));
    }
    out.billPushes = billPushes;
    results.push(out);
  }
  return json({ ok: true, dryRun, today, results });
});
