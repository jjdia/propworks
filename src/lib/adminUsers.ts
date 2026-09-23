import { supabase } from './supabase';
import type { Profile } from './types';

// ---------------------------------------------------------------------------
// Admin / user-management helpers. Profiles + invites are shared multi-party
// state (same as maintenance.ts) — talk to Supabase directly. Dexie is NOT
// involved here; do not put clearance/replace logic against local tables.
// ---------------------------------------------------------------------------

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured — user admin needs cloud sync turned on.');
  return supabase;
}

export type InviteKind = 'tenant' | 'contractor' | 'owner';

export interface PendingInvite {
  id: string;
  kind: InviteKind;
  code: string;
  created_at: string;
  tenant_id?: string | null;
}

/** Every portal login in this portfolio (RLS scopes to my_portfolio_id). */
export async function listPortfolioProfiles(): Promise<Profile[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Profile[];
}

export async function listPendingInvites(): Promise<PendingInvite[]> {
  const client = requireClient();
  const [tenants, contractors, owners] = await Promise.all([
    client.from('tenant_invites').select('id, code, created_at, tenant_id').is('used_at', null),
    client.from('contractor_invites').select('id, code, created_at').is('used_at', null),
    client.from('owner_invites').select('id, code, created_at').is('used_at', null),
  ]);
  if (tenants.error) throw tenants.error;
  if (contractors.error) throw contractors.error;
  if (owners.error) throw owners.error;

  const out: PendingInvite[] = [];
  for (const row of tenants.data ?? []) {
    out.push({ id: row.id, kind: 'tenant', code: row.code, created_at: row.created_at, tenant_id: row.tenant_id });
  }
  for (const row of contractors.data ?? []) {
    out.push({ id: row.id, kind: 'contractor', code: row.code, created_at: row.created_at });
  }
  for (const row of owners.data ?? []) {
    out.push({ id: row.id, kind: 'owner', code: row.code, created_at: row.created_at });
  }
  out.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return out;
}

export async function cancelPendingInvite(kind: InviteKind, id: string) {
  const client = requireClient();
  const table =
    kind === 'tenant' ? 'tenant_invites'
    : kind === 'contractor' ? 'contractor_invites'
    : 'owner_invites';
  const { error } = await client.from(table).delete().eq('id', id);
  if (error) throw error;
}

/**
 * Revoke portal access by deleting the profiles row. Does NOT delete the
 * auth.users row (that needs the Supabase Auth admin API / dashboard).
 * The person can be re-invited later with a fresh invite code.
 */
export async function removePortalProfile(profileId: string) {
  const client = requireClient();
  const { error } = await client.from('profiles').delete().eq('id', profileId);
  if (error) throw error;
}
