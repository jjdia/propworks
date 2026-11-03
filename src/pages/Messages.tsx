import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { saveTenantMessage, softDelete, blankMeta } from '../lib/mutations';
import { useAppStore } from '../store/useAppStore';
import type { TenantMessage } from '../lib/types';
import {
  newIncoming, applyIncomingTranslation, applyIncomingFailure, tenantLanguage, newReplyDraft,
  applyReplyTranslation, editReply, approveReply, canSend, markSent, smsHref, languageLabel, LANGUAGE_LABEL,
} from '../lib/translation';
import { detectLanguage, translateText } from '../lib/translateClient';

const nowIso = () => new Date().toISOString();
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function translateIncoming(m: TenantMessage) {
  try {
    const d = await detectLanguage(m.body_original);
    const english = d.language === 'en' ? null : (await translateText(m.body_original, d.language, 'en')).text;
    await saveTenantMessage(applyIncomingTranslation(m, d.language, english));
  } catch (e) {
    await saveTenantMessage(applyIncomingFailure(m, errText(e)));
  }
}

async function translateDraft(m: TenantMessage) {
  if (!m.target_language || m.target_language === 'en') return;
  try {
    const t = await translateText(m.body_english ?? m.body_original, 'en', m.target_language);
    await saveTenantMessage(applyReplyTranslation(m, t.text));
  } catch (e) {
    await saveTenantMessage({ ...m, translation_state: 'failed', translation_error: errText(e) });
  }
}

export function Messages() {
  const ownerId = useAppStore((s) => s.ownerId) ?? 'local-owner';
  const tenants = useLiveQuery(() => db.tenants.filter((t) => !t.deleted_at).sortBy('full_name'), []);
  const messages = useLiveQuery(() => db.tenant_messages.filter((m) => !m.deleted_at).toArray(), []);
  const [tenantId, setTenantId] = useState('');
  const [logging, setLogging] = useState(false);

  if (!tenants || !messages) return null;
  const tenant = tenants.find((t) => t.id === tenantId) ?? null;
  const thread = messages
    .filter((m) => m.tenant_id === tenantId)
    .sort((a, b) => (a.received_at ?? a.created_at).localeCompare(b.received_at ?? b.created_at));
  const lang = tenantId ? tenantLanguage(messages, tenantId) : null;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Tenant messages</h1>
      <p className="text-xs text-slate-400">Paste a tenant's text to translate it to English. Replies are translated to the tenant's language and only go out after you approve the preview.</p>
      <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} className="w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm">
        <option value="">Choose a tenant…</option>
        {tenants.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
      </select>

      {tenant && (
        <>
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Language: {lang ? languageLabel(lang) : 'not detected yet'}</span>
            <button onClick={() => setLogging(true)} className="rounded-md bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white">+ Log incoming</button>
          </div>
          {logging && <IncomingForm ownerId={ownerId} tenantId={tenant.id} onClose={() => setLogging(false)} />}
          <ul className="space-y-2">
            {thread.map((m) => m.direction === 'incoming'
              ? <IncomingItem key={m.id} m={m} />
              : <OutgoingItem key={m.id} m={m} phone={tenant.phone} />)}
            {thread.length === 0 && <li className="text-xs text-slate-500">No messages yet.</li>}
          </ul>
          <ReplyComposer ownerId={ownerId} tenantId={tenant.id} defaultLang={lang} />
        </>
      )}
    </div>
  );
}

function IncomingForm({ ownerId, tenantId, onClose }: { ownerId: string; tenantId: string; onClose: () => void }) {
  const [text, setText] = useState('');
  const [channel, setChannel] = useState('sms');
  const save = async () => {
    if (!text.trim()) return;
    const rec: TenantMessage = { ...blankMeta(ownerId), ...newIncoming(tenantId, text.trim(), nowIso()), channel };
    const saved = await saveTenantMessage(rec);
    onClose();
    void translateIncoming(saved);
  };
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-3 space-y-2">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Paste the tenant's message (any language)" className="w-full rounded-md bg-slate-950 border border-slate-700 p-2 text-sm" />
      <select value={channel} onChange={(e) => setChannel(e.target.value)} className="rounded-md bg-slate-950 border border-slate-700 px-2 py-1 text-sm">
        <option value="sms">SMS</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="in_person">In person</option><option value="other">Other</option>
      </select>
      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="rounded-md border border-slate-600 px-3 py-1.5 text-sm">Cancel</button>
        <button onClick={save} disabled={!text.trim()} className="rounded-md bg-indigo-600 disabled:opacity-50 px-3 py-1.5 text-sm font-medium text-white">Save & translate</button>
      </div>
    </div>
  );
}

function IncomingItem({ m }: { m: TenantMessage }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.body_original);
  return (
    <li className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-1 text-sm">
      <div className="text-xs text-slate-400">Tenant · {languageLabel(m.original_language)} · {new Date(m.received_at ?? m.created_at).toLocaleString()}</div>
      {editing ? (
        <div className="space-y-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="w-full rounded-md bg-slate-950 border border-slate-700 p-2 text-sm" />
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setText(m.body_original); setEditing(false); }} className="rounded-md border border-slate-600 px-3 py-1 text-xs">Cancel</button>
            <button onClick={async () => { const s = await saveTenantMessage({ ...m, body_original: text.trim(), translation_state: 'pending' }); setEditing(false); void translateIncoming(s); }} className="rounded-md bg-indigo-600 px-3 py-1 text-xs text-white">Save & re-translate</button>
          </div>
        </div>
      ) : <p className="whitespace-pre-wrap">{m.body_original}</p>}
      {m.translation_state === 'done' && <p className="whitespace-pre-wrap text-emerald-300"><span className="text-xs text-slate-500">English: </span>{m.body_english}</p>}
      {m.translation_state === 'pending' && <p className="text-xs text-slate-500">Translating…</p>}
      {m.translation_state === 'failed' && (
        <p className="text-xs text-amber-400">Translation unavailable{m.translation_error ? ` (${m.translation_error})` : ''}. <button className="underline" onClick={() => translateIncoming(m)}>Retry</button></p>
      )}
      {!editing && (
        <div className="flex gap-3 text-xs text-slate-400">
          <button onClick={() => setEditing(true)} className="underline">Edit</button>
          <button onClick={() => { if (confirm('Delete this message?')) void softDelete('tenant_messages', m.id); }} className="underline">Delete</button>
        </div>
      )}
    </li>
  );
}

function OutgoingItem({ m, phone }: { m: TenantMessage; phone?: string }) {
  const [english, setEnglish] = useState(m.body_english ?? '');
  const [translated, setTranslated] = useState(m.body_translated ?? '');
  const [note, setNote] = useState('');
  // Keep local edit fields in step with the record when a translation lands.
  const [seen, setSeen] = useState(m.updated_at);
  if (seen !== m.updated_at) { setSeen(m.updated_at); setEnglish(m.body_english ?? ''); setTranslated(m.body_translated ?? ''); }

  if (m.status === 'sent') {
    return (
      <li className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-1 text-sm ml-6">
        <div className="text-xs text-slate-400">You · sent {m.sent_at ? new Date(m.sent_at).toLocaleString() : ''} · {languageLabel(m.target_language)}</div>
        <p className="whitespace-pre-wrap">{m.body_translated}</p>
        {m.target_language !== 'en' && <p className="whitespace-pre-wrap text-xs text-slate-400">English: {m.body_english}</p>}
      </li>
    );
  }

  const dirty = english !== (m.body_english ?? '') || translated !== (m.body_translated ?? '');
  const saveEdits = async () => {
    await saveTenantMessage(editReply(m, { english, translated }));
  };
  const retranslate = async () => {
    const d = await saveTenantMessage({ ...editReply(m, { english }), translation_state: 'pending' });
    void translateDraft(d);
  };
  const approve = async () => {
    const base = dirty ? editReply(m, { english, translated }) : m;
    await saveTenantMessage(approveReply(base, nowIso()));
  };
  // Every send path goes through markSent, which throws unless approved.
  const send = async (how: 'sms' | 'share' | 'copy') => {
    if (!canSend(m)) { setNote('Approve the preview first.'); return; }
    const text = m.approved_text as string;
    try {
      if (how === 'sms') window.location.href = smsHref(phone, text, navigator.userAgent);
      else if (how === 'share') await navigator.share({ text });
      else await navigator.clipboard.writeText(text);
    } catch (e) { setNote(errText(e)); return; }
    if (how === 'copy') setNote('Copied. Paste it into your messaging app.');
    await saveTenantMessage(markSent(m, nowIso()));
  };
  const approved = canSend(m) && !dirty;

  return (
    <li className="bg-slate-900 border border-indigo-800 rounded-xl p-3 space-y-2 text-sm ml-6">
      <div className="text-xs text-slate-400">Reply preview · {approved ? 'Approved' : 'Draft, not approved'}</div>
      <label className="block text-xs text-slate-400">Your English
        <textarea value={english} onChange={(e) => setEnglish(e.target.value)} rows={3} className="mt-1 w-full rounded-md bg-slate-950 border border-slate-700 p-2 text-sm text-slate-100" />
      </label>
      {m.target_language !== 'en' && (
        <label className="block text-xs text-slate-400">{languageLabel(m.target_language)} (what the tenant gets, editable)
          <textarea value={translated} onChange={(e) => setTranslated(e.target.value)} rows={3} className="mt-1 w-full rounded-md bg-slate-950 border border-slate-700 p-2 text-sm text-slate-100" />
        </label>
      )}
      {m.translation_state === 'pending' && <p className="text-xs text-slate-500">Translating…</p>}
      {m.translation_state === 'failed' && <p className="text-xs text-amber-400">Translation unavailable{m.translation_error ? ` (${m.translation_error})` : ''}. You can type the translation yourself or retry.</p>}
      {note && <p className="text-xs text-slate-300">{note}</p>}
      <div className="flex flex-wrap gap-2 justify-end">
        <button onClick={() => { if (confirm('Discard this draft?')) void softDelete('tenant_messages', m.id); }} className="rounded-md border border-slate-600 px-3 py-1.5 text-xs">Cancel draft</button>
        {m.target_language !== 'en' && <button onClick={retranslate} className="rounded-md border border-slate-600 px-3 py-1.5 text-xs">Re-translate</button>}
        {dirty && <button onClick={saveEdits} className="rounded-md border border-slate-600 px-3 py-1.5 text-xs">Save edits</button>}
        {!approved && <button onClick={approve} disabled={!translated.trim()} className="rounded-md bg-emerald-700 disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-white">Approve</button>}
        {approved && <>
          <button onClick={() => send('sms')} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white">Send via SMS</button>
          {typeof navigator.share === 'function' && <button onClick={() => send('share')} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white">Share…</button>}
          <button onClick={() => send('copy')} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white">Copy & mark sent</button>
        </>}
      </div>
    </li>
  );
}

function ReplyComposer({ ownerId, tenantId, defaultLang }: { ownerId: string; tenantId: string; defaultLang: string | null }) {
  const [text, setText] = useState('');
  const [target, setTarget] = useState<string>('');
  const lang = target || defaultLang || 'en';
  const start = async () => {
    if (!text.trim()) return;
    const saved = await saveTenantMessage({ ...blankMeta(ownerId), ...newReplyDraft(tenantId, text.trim(), lang) });
    setText('');
    void translateDraft(saved);
  };
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-3 space-y-2">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Write your reply in English" className="w-full rounded-md bg-slate-950 border border-slate-700 p-2 text-sm" />
      <div className="flex flex-wrap items-center gap-2 justify-end">
        <select value={lang} onChange={(e) => setTarget(e.target.value)} className="rounded-md bg-slate-950 border border-slate-700 px-2 py-1 text-sm">
          {Object.entries(LANGUAGE_LABEL).map(([c, l]) => <option key={c} value={c}>{l}</option>)}
          {!LANGUAGE_LABEL[lang] && <option value={lang}>{lang}</option>}
        </select>
        <button onClick={() => { setText(''); setTarget(''); }} className="rounded-md border border-slate-600 px-3 py-1.5 text-sm">Cancel</button>
        <button onClick={start} disabled={!text.trim()} className="rounded-md bg-indigo-600 disabled:opacity-50 px-3 py-1.5 text-sm font-medium text-white">Translate & preview</button>
      </div>
    </div>
  );
}
