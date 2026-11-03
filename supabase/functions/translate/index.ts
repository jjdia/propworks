// translate — owner-only proxy to a self-hosted LibreTranslate server (V 35).
//
// POST { action: 'detect', q }                       → { language, confidence }
// POST { action: 'translate', q, source?, target }   → { text, detected }
//
// Auth: requires the caller's Supabase JWT (deployed WITH JWT verification,
// i.e. no --no-verify-jwt). The function then reads the caller's OWN profile
// with the anon key + their JWT (RLS applies) and requires role = 'owner'.
// Tenants and contractors get 403. No service_role key is used anywhere.
//
// Secrets (Supabase → Edge Functions → Secrets; see docs/translation-server.md):
//   LIBRETRANSLATE_URL      e.g. https://translate.example.com  (required)
//   LIBRETRANSLATE_API_KEY  optional; sent as api_key when set
// If LIBRETRANSLATE_URL is unset the function answers 503
// { error: 'translation_not_configured' } and the app degrades gracefully
// (messages are still saved with their original text).
//
// Validation/parsing is PURE and shared: ../_shared/translation.ts
// (copied from src/lib/translation.ts by scripts/sync-edge-shared.mjs).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { parseTranslateRequest, libreRequest, parseDetectResponse, parseTranslateResponse } from '../_shared/translation.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'unauthorized' });

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await sb.auth.getUser(authHeader.slice(7));
  if (userErr || !userData?.user) return json(401, { error: 'unauthorized' });
  const { data: profile } = await sb.from('profiles').select('role').eq('id', userData.user.id).maybeSingle();
  if (profile?.role !== 'owner') return json(403, { error: 'owner_only' });

  let body: unknown;
  try { body = await req.json(); } catch { return json(400, { error: 'invalid_json' }); }
  const parsed = parseTranslateRequest(body);
  if (!parsed.ok) return json(400, { error: 'bad_request', message: parsed.error });

  const base = (Deno.env.get('LIBRETRANSLATE_URL') ?? '').trim().replace(/\/+$/, '');
  if (!base) return json(503, { error: 'translation_not_configured', message: 'LIBRETRANSLATE_URL is not set.' });
  const apiKey = Deno.env.get('LIBRETRANSLATE_API_KEY') || null;

  const { path, body: form } = libreRequest(parsed.req, apiKey);
  let upstream: Response;
  try {
    upstream = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    return json(502, { error: 'translation_unreachable', message: e instanceof Error ? e.message : String(e) });
  }
  const upstreamJson = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    const msg = (upstreamJson as { error?: string } | null)?.error ?? `HTTP ${upstream.status}`;
    return json(502, { error: 'translation_failed', message: msg });
  }

  if (parsed.req.action === 'detect') {
    const d = parseDetectResponse(upstreamJson);
    return d ? json(200, d) : json(502, { error: 'translation_failed', message: 'Unexpected detect response.' });
  }
  const t = parseTranslateResponse(upstreamJson);
  return t ? json(200, t) : json(502, { error: 'translation_failed', message: 'Unexpected translate response.' });
});
