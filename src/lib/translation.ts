// V 35 tenant-message translation — PURE logic (no Dexie, no fetch, no DOM).
// Shared with the `translate` Edge Function via scripts/sync-edge-shared.mjs
// and unit-tested in scripts/translation-test.ts.
//
// Rules this file enforces:
//  - Incoming tenant messages keep the ORIGINAL text, the DETECTED language
//    and the ENGLISH text together on one record.
//  - An outgoing reply is a draft until Jeff approves the exact text shown in
//    the preview. Any edit after approval drops the approval. canSend() is the
//    single gate: nothing is sent (opened in SMS/share/copy) without it.

export type MessageDirection = 'incoming' | 'outgoing';
export type MessageStatus = 'received' | 'draft' | 'approved' | 'sent';
export type TranslationState = 'pending' | 'done' | 'failed' | 'not_needed';

/** Language label for common NYC tenant languages; unknown codes show as-is. */
export const LANGUAGE_LABEL: Record<string, string> = {
  en: 'English', es: 'Spanish', zh: 'Chinese', ru: 'Russian', ar: 'Arabic',
  bn: 'Bengali', ht: 'Haitian Creole', fr: 'French', pl: 'Polish', ko: 'Korean',
  it: 'Italian', ur: 'Urdu', pt: 'Portuguese', uk: 'Ukrainian', hi: 'Hindi',
};

export function languageLabel(code: string | null | undefined): string {
  if (!code) return 'Unknown';
  const c = normalizeLang(code);
  return (c && LANGUAGE_LABEL[c]) || code;
}

/** 'ES', 'es-MX', ' es ' → 'es'. Returns null for anything that isn't a code. */
export function normalizeLang(code: string | null | undefined): string | null {
  if (!code) return null;
  const m = /^\s*([A-Za-z]{2,3})(?:[-_][A-Za-z0-9]+)*\s*$/.exec(code);
  return m ? m[1].toLowerCase() : null;
}

export const MAX_TRANSLATE_CHARS = 5000;

export type TranslateRequest =
  | { action: 'detect'; q: string }
  | { action: 'translate'; q: string; source: string; target: string };

/** Validates an Edge Function body. Returns an error string or the clean request. */
export function parseTranslateRequest(body: unknown): { ok: true; req: TranslateRequest } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Body must be a JSON object.' };
  const b = body as Record<string, unknown>;
  const q = typeof b.q === 'string' ? b.q.trim() : '';
  if (!q) return { ok: false, error: 'Text (q) is required.' };
  if (q.length > MAX_TRANSLATE_CHARS) return { ok: false, error: `Text is longer than ${MAX_TRANSLATE_CHARS} characters.` };
  if (b.action === 'detect') return { ok: true, req: { action: 'detect', q } };
  if (b.action === 'translate') {
    const target = normalizeLang(typeof b.target === 'string' ? b.target : null);
    if (!target) return { ok: false, error: 'A target language code is required.' };
    const rawSource = typeof b.source === 'string' ? b.source.trim().toLowerCase() : 'auto';
    const source = rawSource === 'auto' ? 'auto' : normalizeLang(rawSource);
    if (!source) return { ok: false, error: 'Invalid source language code.' };
    return { ok: true, req: { action: 'translate', q, source, target } };
  }
  return { ok: false, error: "action must be 'detect' or 'translate'." };
}

/** LibreTranslate request (path + form body) for a validated request. */
export function libreRequest(req: TranslateRequest, apiKey?: string | null): { path: string; body: Record<string, string> } {
  const key: Record<string, string> = apiKey ? { api_key: apiKey } : {};
  if (req.action === 'detect') return { path: '/detect', body: { q: req.q, ...key } };
  return { path: '/translate', body: { q: req.q, source: req.source, target: req.target, format: 'text', ...key } };
}

/** LibreTranslate /detect → best language (highest confidence). */
export function parseDetectResponse(json: unknown): { language: string; confidence: number } | null {
  if (!Array.isArray(json) || json.length === 0) return null;
  let best: { language: string; confidence: number } | null = null;
  for (const r of json) {
    const lang = normalizeLang((r as { language?: string })?.language);
    const conf = Number((r as { confidence?: number })?.confidence ?? 0);
    if (lang && (!best || conf > best.confidence)) best = { language: lang, confidence: conf };
  }
  return best;
}

/** LibreTranslate /translate → { text, detected? }. */
export function parseTranslateResponse(json: unknown): { text: string; detected: string | null } | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as { translatedText?: unknown; detectedLanguage?: { language?: string } };
  if (typeof j.translatedText !== 'string') return null;
  return { text: j.translatedText, detected: normalizeLang(j.detectedLanguage?.language) };
}

// ------------------------------------------------------------ message model

export interface MessageFields {
  direction: MessageDirection;
  tenant_id: string;
  body_original: string;          // exactly what the tenant wrote / what Jeff wrote
  original_language: string | null; // detected (incoming) or 'en' (outgoing)
  body_english: string | null;    // incoming: English translation (= original if en)
  body_translated: string | null; // outgoing: text in tenant's language (editable)
  target_language: string | null; // outgoing: tenant's language
  translation_state: TranslationState;
  translation_error?: string | null;
  status: MessageStatus;
  approved_text?: string | null;  // exact text approved; must equal body_translated
  approved_at?: string | null;
  sent_at?: string | null;
  received_at?: string | null;
}

/** New incoming record, before translation runs. */
export function newIncoming(tenantId: string, text: string, receivedAt: string): MessageFields {
  return {
    direction: 'incoming', tenant_id: tenantId, body_original: text, original_language: null,
    body_english: null, body_translated: null, target_language: 'en',
    translation_state: 'pending', status: 'received', received_at: receivedAt,
  };
}

/** Apply detect+translate results to an incoming message. */
export function applyIncomingTranslation<T extends MessageFields>(m: T, detected: string | null, english: string | null): T {
  const lang = normalizeLang(detected);
  if (lang === 'en') return { ...m, original_language: 'en', body_english: m.body_original, translation_state: 'not_needed', translation_error: null };
  if (english == null) return { ...m, original_language: lang, translation_state: 'failed' };
  return { ...m, original_language: lang, body_english: english, translation_state: 'done', translation_error: null };
}

export function applyIncomingFailure<T extends MessageFields>(m: T, error: string): T {
  return { ...m, translation_state: 'failed', translation_error: error };
}

/** The tenant's language: latest non-English incoming detected language, else null. */
export function tenantLanguage(messages: Array<Pick<MessageFields, 'direction' | 'tenant_id' | 'original_language' | 'received_at'> & { created_at?: string; deleted_at?: string | null }>, tenantId: string): string | null {
  const incoming = messages
    .filter((m) => !m.deleted_at && m.tenant_id === tenantId && m.direction === 'incoming' && normalizeLang(m.original_language))
    .sort((a, b) => (b.received_at ?? b.created_at ?? '').localeCompare(a.received_at ?? a.created_at ?? ''));
  return incoming.length ? normalizeLang(incoming[0].original_language) : null;
}

/** New outgoing draft from Jeff's English text. Never approved. */
export function newReplyDraft(tenantId: string, english: string, targetLang: string | null): MessageFields {
  const target = normalizeLang(targetLang) ?? 'en';
  const same = target === 'en';
  return {
    direction: 'outgoing', tenant_id: tenantId, body_original: english, original_language: 'en',
    body_english: english, body_translated: same ? english : null, target_language: target,
    translation_state: same ? 'not_needed' : 'pending', status: 'draft',
    approved_text: null, approved_at: null, sent_at: null,
  };
}

/** Store the machine translation into the draft (resets any approval). */
export function applyReplyTranslation<T extends MessageFields>(m: T, translated: string): T {
  return { ...m, body_translated: translated, translation_state: 'done', translation_error: null, status: 'draft', approved_text: null, approved_at: null };
}

/** Jeff edits either side of the preview → back to draft, approval dropped. */
export function editReply<T extends MessageFields>(m: T, patch: { english?: string; translated?: string }): T {
  if (m.status === 'sent') return m;
  const next = { ...m, status: 'draft' as MessageStatus, approved_text: null, approved_at: null };
  if (patch.english !== undefined) { next.body_original = patch.english; next.body_english = patch.english; }
  if (patch.translated !== undefined) next.body_translated = patch.translated;
  return next;
}

/** Approve exactly the text currently in the preview. */
export function approveReply<T extends MessageFields>(m: T, at: string): T {
  if (m.direction !== 'outgoing' || m.status === 'sent') return m;
  const text = (m.body_translated ?? '').trim();
  if (!text) return m;
  return { ...m, status: 'approved', approved_text: m.body_translated, approved_at: at };
}

/** THE send gate. Only an approved outgoing reply whose text is unchanged. */
export function canSend(m: MessageFields): boolean {
  return m.direction === 'outgoing'
    && m.status === 'approved'
    && !!m.approved_at
    && typeof m.approved_text === 'string'
    && m.approved_text.trim().length > 0
    && m.approved_text === m.body_translated;
}

/** Mark sent. Throws if not approved — callers must never bypass canSend. */
export function markSent<T extends MessageFields>(m: T, at: string): T {
  if (!canSend(m)) throw new Error('Reply must be approved before it can be sent.');
  return { ...m, status: 'sent', sent_at: at };
}

/** sms: link that works on iOS and Android (body param separator differs). */
export function smsHref(phone: string | null | undefined, text: string, ua: string): string {
  const digits = (phone ?? '').replace(/[^\d+]/g, '');
  const sep = /iPhone|iPad|iPod|Macintosh/.test(ua) ? '&' : '?';
  return `sms:${digits}${sep}body=${encodeURIComponent(text)}`;
}
