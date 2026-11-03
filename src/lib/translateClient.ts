// Calls the owner-only `translate` Edge Function with the signed-in user's
// session (supabase.functions.invoke attaches the JWT). Anon key only.
import { supabase } from './supabase';

export class TranslationUnavailable extends Error {}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new TranslationUnavailable('Translation needs cloud sync (sign in).');
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new TranslationUnavailable('Offline — translation will be available when you reconnect.');
  const { data, error } = await supabase.functions.invoke('translate', { body });
  if (error) {
    let detail = '';
    try {
      const ctx = (error as { context?: Response }).context;
      const j = ctx ? await ctx.json() : null;
      if (j?.error === 'translation_not_configured') throw new TranslationUnavailable('Translation server is not set up yet.');
      if (j?.error === 'owner_only') throw new TranslationUnavailable('Only owners can translate messages.');
      detail = j?.message ?? j?.error ?? '';
    } catch (e) { if (e instanceof TranslationUnavailable) throw e; }
    throw new Error(detail || error.message);
  }
  return data as T;
}

export const detectLanguage = (q: string) => call<{ language: string; confidence: number }>({ action: 'detect', q });
export const translateText = (q: string, source: string, target: string) =>
  call<{ text: string; detected: string | null }>({ action: 'translate', q, source, target });
