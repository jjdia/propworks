import { createClient } from '@supabase/supabase-js';

// NEVER put a service-role key here. Only the public anon/publishable key,
// which is safe to ship in client code because RLS (owner_id = auth.uid())
// is what actually protects the data.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase = supabaseConfigured
  ? createClient(url as string, anonKey as string)
  : null;
