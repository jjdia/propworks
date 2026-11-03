import {
  normalizeLang, languageLabel, parseTranslateRequest, libreRequest, parseDetectResponse, parseTranslateResponse,
  newIncoming, applyIncomingTranslation, applyIncomingFailure, tenantLanguage, newReplyDraft, applyReplyTranslation,
  editReply, approveReply, canSend, markSent, smsHref, MAX_TRANSLATE_CHARS,
} from '../src/lib/translation';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`);
  if (cond) pass++; else fail++;
}
const T = '2026-11-03T12:00:00.000Z';

// language codes
check('normalize es-MX → es', normalizeLang('es-MX') === 'es');
check('normalize garbage → null', normalizeLang('not a code') === null);
check('label', languageLabel('ES') === 'Spanish' && languageLabel(null) === 'Unknown');

// request validation (Edge Function input)
check('detect ok', parseTranslateRequest({ action: 'detect', q: ' hola ' }).ok);
check('empty q rejected', !parseTranslateRequest({ action: 'detect', q: '  ' }).ok);
check('too long rejected', !parseTranslateRequest({ action: 'detect', q: 'x'.repeat(MAX_TRANSLATE_CHARS + 1) }).ok);
check('translate needs target', !parseTranslateRequest({ action: 'translate', q: 'hi' }).ok);
check('unknown action rejected', !parseTranslateRequest({ action: 'x', q: 'hi' }).ok);
const tr = parseTranslateRequest({ action: 'translate', q: 'hi', target: 'ES' });
check('translate source defaults to auto, target normalized', tr.ok && tr.req.action === 'translate' && tr.req.source === 'auto' && tr.req.target === 'es');
check('non-object rejected', !parseTranslateRequest(null).ok);

// LibreTranslate mapping
if (tr.ok) {
  const r = libreRequest(tr.req, 'k');
  check('translate → /translate with api_key + format text', r.path === '/translate' && r.body.api_key === 'k' && r.body.format === 'text');
  check('no api_key when unset', !('api_key' in libreRequest(tr.req, null).body));
}
check('detect picks highest confidence', parseDetectResponse([{ language: 'pt', confidence: 40 }, { language: 'es', confidence: 92 }])?.language === 'es');
check('detect empty → null', parseDetectResponse([]) === null && parseDetectResponse({}) === null);
check('translate response parsed', parseTranslateResponse({ translatedText: 'Hello', detectedLanguage: { language: 'es' } })?.detected === 'es');
check('bad translate response → null', parseTranslateResponse({ error: 'x' }) === null);

// incoming: original + detected + English stored together
const inc = newIncoming('t1', 'La calefacción no funciona', T);
check('incoming starts pending, status received', inc.translation_state === 'pending' && inc.status === 'received');
const done = applyIncomingTranslation(inc, 'es', 'The heating does not work');
check('incoming keeps original', done.body_original === 'La calefacción no funciona');
check('incoming stores detected + English', done.original_language === 'es' && done.body_english === 'The heating does not work' && done.translation_state === 'done');
const en = applyIncomingTranslation(newIncoming('t1', 'Heat is out', T), 'en', null);
check('English incoming → not_needed, English = original', en.translation_state === 'not_needed' && en.body_english === 'Heat is out');
const failed = applyIncomingFailure(inc, 'translation_not_configured');
check('failure keeps original text', failed.translation_state === 'failed' && failed.body_original === inc.body_original);

// tenant language
const msgs = [
  { ...done, created_at: '', deleted_at: null, received_at: '2026-11-01T00:00:00Z' },
  { ...applyIncomingTranslation(newIncoming('t1', '...', ''), 'ru', 'x'), created_at: '', deleted_at: null, received_at: '2026-11-02T00:00:00Z' },
  { ...applyIncomingTranslation(newIncoming('t2', 'x', ''), 'zh', 'x'), created_at: '', deleted_at: null, received_at: '2026-11-03T00:00:00Z' },
];
check('tenant language = latest incoming for that tenant', tenantLanguage(msgs, 't1') === 'ru');
check('no messages → null', tenantLanguage(msgs, 't9') === null);

// outgoing: approval gate
const draft = newReplyDraft('t1', 'A technician comes tomorrow at 10.', 'es');
check('draft is not sendable', !canSend(draft) && draft.status === 'draft');
check('markSent throws on draft', (() => { try { markSent(draft, T); return false; } catch { return true; } })());
check('cannot approve empty translation', approveReply(draft, T).status === 'draft');
const translated = applyReplyTranslation(draft, 'Un técnico viene mañana a las 10.');
check('translation alone does not approve', !canSend(translated));
const approved = approveReply(translated, T);
check('approved → sendable, approved_text = preview', canSend(approved) && approved.approved_text === 'Un técnico viene mañana a las 10.');
const edited = editReply(approved, { translated: 'Un técnico viene mañana a las 11.' });
check('edit after approval drops approval', !canSend(edited) && edited.status === 'draft' && edited.approved_at === null);
check('tampered body_translated not sendable', !canSend({ ...approved, body_translated: 'otra cosa' }));
check('re-translation drops approval', !canSend(applyReplyTranslation(approved, 'x')));
check('incoming never sendable', !canSend({ ...done, status: 'approved', approved_at: T, approved_text: done.body_original, body_translated: done.body_original }));
const sent = markSent(approved, T);
check('markSent stamps sent', sent.status === 'sent' && sent.sent_at === T);
check('sent message cannot be edited', editReply(sent, { translated: 'x' }) === sent);
const enDraft = newReplyDraft('t1', 'See you soon', null);
check('English-only tenant: translation not needed but still needs approval', enDraft.body_translated === 'See you soon' && !canSend(enDraft) && canSend(approveReply(enDraft, T)));

// sms link (iPhone vs Android)
check('iOS sms uses &body', smsHref('(718) 555-0100', 'hola', 'Mozilla iPhone') === 'sms:7185550100&body=hola');
check('Android sms uses ?body', smsHref('+17185550100', 'a b', 'Mozilla Android') === 'sms:+17185550100?body=a%20b');

// Dexie + migration invariants
const dbSrc = readFileSync('src/lib/db.ts', 'utf8');
check('Dexie v6 adds tenant_messages', /version\(6\)\.stores\(\{\s*tenant_messages:/.test(dbSrc));
check('Dexie never clears', !/\.clear\(\)/.test(dbSrc.replace(/\/\/.*$/gm, '')));
check('tenant_messages in backups', dbSrc.includes("'tenant_messages',"));
check('synced', readFileSync('src/lib/sync.ts', 'utf8').includes("'tenant_messages'"));
const sql = readFileSync('supabase/schema-v11-message-translation.sql', 'utf8').toLowerCase().replace(/--.*$/gm, '');
check('v11 additive (no drop/truncate/delete/alter column type)', !/\b(drop|truncate|delete\s+from|alter\s+column)\b/.test(sql));
check('v11 RLS + owner role', sql.includes('enable row level security') && sql.includes("p.role = 'owner'"));
const fn = readFileSync('supabase/functions/translate/index.ts', 'utf8');
check('edge fn has no service role', !/SERVICE_ROLE/.test(fn.replace(/^\/\/.*$/gm, '')));
check('edge fn requires owner role', fn.includes("profile?.role !== 'owner'"));
check('edge fn graceful when unset', fn.includes('translation_not_configured'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
