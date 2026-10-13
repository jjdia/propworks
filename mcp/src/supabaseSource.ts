// Supabase-backed ReadSource. SELECT only. Auth is the OWNER'S session (anon
// key + user login / refresh token), so Postgres RLS limits rows to that
// owner's portfolio. service_role keys are refused.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RangeFilter, ReadSource, ReadTable } from './handlers';
import { READ_TABLES } from './handlers';

export function jwtRole(key: string): string | null {
  try {
    const part = key.split('.')[1];
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).role ?? null;
  } catch { return null; }
}

export function checkEnv(env: NodeJS.ProcessEnv): { url: string; anonKey: string } {
  const url = env.PROPWORKS_SUPABASE_URL, anonKey = env.PROPWORKS_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('Set PROPWORKS_SUPABASE_URL and PROPWORKS_SUPABASE_ANON_KEY (the public anon key).');
  if (/^sb_secret_/.test(anonKey) || jwtRole(anonKey) === 'service_role') throw new Error('Refusing to run with a service_role/secret key. Use the anon (publishable) key; RLS must apply.');
  if (!env.PROPWORKS_REFRESH_TOKEN && !(env.PROPWORKS_EMAIL && env.PROPWORKS_PASSWORD)) {
    throw new Error('Set PROPWORKS_REFRESH_TOKEN, or PROPWORKS_EMAIL + PROPWORKS_PASSWORD, to sign in as the owner.');
  }
  return { url, anonKey };
}

export async function connect(env: NodeJS.ProcessEnv = process.env): Promise<SupabaseClient> {
  const { url, anonKey } = checkEnv(env);
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: true } });
  const { error } = env.PROPWORKS_REFRESH_TOKEN
    ? await client.auth.refreshSession({ refresh_token: env.PROPWORKS_REFRESH_TOKEN })
    : await client.auth.signInWithPassword({ email: env.PROPWORKS_EMAIL!, password: env.PROPWORKS_PASSWORD! });
  if (error) throw new Error(`Sign-in failed: ${error.message}`);
  return client;
}

const PAGE = 1000, HARD_LIMIT = 20000;

export function supabaseSource(client: SupabaseClient): ReadSource {
  return {
    async select(table: ReadTable, range?: RangeFilter) {
      if (!READ_TABLES.includes(table)) throw new Error(`Table not allowed: ${table}`);
      const out: Record<string, unknown>[] = [];
      for (let from = 0; from < HARD_LIMIT; from += PAGE) {
        let q = client.from(table).select('*').is('deleted_at', null);
        if (range?.gte) q = q.gte(range.column, range.gte);
        if (range?.lte) q = q.lte(range.column, range.lte);
        const { data, error } = await q.order('id').range(from, from + PAGE - 1);
        if (error) throw new Error(`${table}: ${error.message}`);
        out.push(...(data ?? []));
        if (!data || data.length < PAGE) break;
      }
      return out;
    },
  };
}
