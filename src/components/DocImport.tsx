import { useState } from 'react';

// File picker that extracts text on-device (issue #14). pdf.js / tesseract.js
// load only when a file is picked. Calls onText; never saves anything.
export function DocImport({ label, accept, onText }: {
  label: string; accept: string; onText: (text: string, file: File) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handle(file?: File) {
    if (!file) return;
    setError(null);
    setBusy('Starting…');
    try {
      const { extractText } = await import('../lib/docExtract');
      const { text } = await extractText(file, setBusy);
      if (!text.trim()) setError('No text found in that file.');
      else onText(text, file);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="text-xs space-y-1">
      <label className={`inline-block rounded-md bg-slate-800 hover:bg-slate-700 px-2 py-1 cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
        📄 {label}
        <input type="file" accept={accept} className="hidden" onChange={(e) => { handle(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {busy && <p className="text-slate-400">{busy}</p>}
      {error && <p className="text-rose-400">{error}</p>}
      <p className="text-slate-500">Read on this device only, never uploaded. Check every value before saving.</p>
    </div>
  );
}

export function Suggestion({ label, value, onUse, note }: { label: string; value: string; onUse?: () => void; note?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-slate-400">{label}: <span className="text-slate-100">{value}</span>{note && <span className="text-amber-300"> · {note}</span>}</span>
      {onUse && <button type="button" onClick={onUse} className="rounded bg-indigo-700 hover:bg-indigo-600 px-1.5 py-0.5">Use</button>}
    </div>
  );
}
