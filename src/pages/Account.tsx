import { useRef, useState } from 'react';
import { signOut } from '../lib/auth';
import {
  downloadBackupFile,
  getLatestBackup,
  restoreFromBackup,
} from '../lib/db';
import { useAppStore } from '../store/useAppStore';

export function Account() {
  const email = useAppStore((s) => s.email);
  const profile = useAppStore((s) => s.profile);
  const localOnly = useAppStore((s) => s.localOnly);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [pendingFileText, setPendingFileText] = useState<string | null>(null);

  async function handleDownload() {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await downloadBackupFile();
      setMessage('Backup downloaded. Store the JSON somewhere safe (Drive, email to yourself).');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setMessage(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object') throw new Error('Not a backup object');
        setPendingFileText(text);
        setConfirmRestore(true);
      } catch {
        setError('That file is not a valid PropWorks backup JSON.');
      }
    };
    reader.onerror = () => setError('Could not read that file.');
    reader.readAsText(file);
  }

  async function handleConfirmRestore() {
    if (!pendingFileText) return;
    setBusy(true);
    setError(null);
    try {
      await restoreFromBackup(pendingFileText);
      setConfirmRestore(false);
      setPendingFileText(null);
      setMessage('Backup merged into local data. Reloading…');
      window.setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRestoreLatestLocal() {
    const backup = getLatestBackup();
    if (!backup) {
      setError('No rolling localStorage backup found in this browser.');
      return;
    }
    setPendingFileText(backup);
    setConfirmRestore(true);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Account</h1>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1">
        {profile?.full_name && <div className="text-sm font-medium">{profile.full_name}</div>}
        {email && <div className="text-xs text-slate-400">{email}</div>}
        {profile?.role && <div className="text-xs text-slate-500 capitalize">{profile.role}{profile.trade ? ` · ${profile.trade}` : ''}</div>}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <div>
          <h2 className="text-sm font-medium">Data backup</h2>
          <p className="text-xs text-slate-500 mt-1">
            Download a full copy of this browser&apos;s portfolio (properties, units,
            tenants, leases, rent, expenses, documents, contractors, schedules).
            Restore merges by id — it never clears existing rows. See{' '}
            <span className="font-mono text-slate-400">ops/BACKUP.md</span> in the repo
            for server-side backups.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={handleDownload}
            className="w-full text-sm rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3 py-2"
          >
            {busy ? 'Working…' : 'Download backup JSON'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="w-full text-sm rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-50 px-3 py-2"
          >
            Restore from backup file…
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleRestoreLatestLocal}
            className="w-full text-sm rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-50 px-3 py-2"
          >
            Restore latest rolling local backup
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handlePickFile}
          />
        </div>
        {message && <p className="text-xs text-emerald-400">{message}</p>}
        {error && <p className="text-xs text-rose-400">{error}</p>}
      </div>

      {!localOnly && (
        <button onClick={() => signOut()} className="w-full text-sm rounded-md bg-slate-800 hover:bg-slate-700 px-3 py-2">
          Sign out
        </button>
      )}

      {confirmRestore && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-20">
          <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-5 space-y-3">
            <h2 className="text-lg font-semibold">Merge backup into local data?</h2>
            <p className="text-xs text-slate-400">
              Records in the backup are upserted by id. Rows that exist only in the
              app today are left alone — nothing is cleared. This cannot be undone
              from the UI except by restoring another backup.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => { setConfirmRestore(false); setPendingFileText(null); }}
                className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleConfirmRestore}
                className="flex-1 rounded-md bg-indigo-600 hover:bg-indigo-500 py-2 text-sm"
              >
                {busy ? 'Restoring…' : 'Merge & reload'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
