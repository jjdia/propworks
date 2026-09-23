import { supabase, supabaseConfigured } from './supabase';
import type { Session } from '@supabase/supabase-js';
import { createOwnerProfile, redeemTenantInvite, redeemContractorInvite, redeemOwnerInvite } from './maintenance';

export { supabaseConfigured };

export async function signInWithPassword(email: string, password: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

// role/invite is only relevant on first signup — an existing account
// signing in again already has its profile row.
export type SignUpRole =
  | 'owner'
  | { role: 'owner_invite'; code: string }
  | { role: 'tenant'; code: string }
  | { role: 'contractor'; code: string; trade?: string };

export async function signUpWithPassword(email: string, password: string, fullName: string, role: SignUpRole) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  const userId = data.user?.id;
  if (!userId) {
    // Email confirmation is required before a session/user id is usable —
    // profile creation happens on first sign-in instead in that case.
    return data.session;
  }
  if (role === 'owner') {
    await createOwnerProfile(userId, fullName);
  } else if (role.role === 'owner_invite') {
    await redeemOwnerInvite(userId, role.code, fullName);
  } else if (role.role === 'tenant') {
    await redeemTenantInvite(userId, role.code, fullName);
  } else {
    await redeemContractorInvite(userId, role.code, fullName, role.trade);
  }
  return data.session;
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

// Sends a reset-password email with a recovery link. The link, once
// clicked, logs the browser into a special short-lived recovery session
// and Supabase fires a 'PASSWORD_RECOVERY' auth event (see onAuthChange
// below and App.tsx) — that's what triggers the "set a new password"
// screen, rather than a dedicated route. Prefer the auth event over
// parsing recovery tokens from the URL (hash/query fragment handling
// varies by redirect host and is easy to get wrong).
export async function resetPasswordForEmail(email: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
  if (error) throw error;
}

export async function updatePassword(newPassword: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(cb: (session: Session | null, event: string) => void) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event, session) => cb(session, event));
  return () => data.subscription.unsubscribe();
}
