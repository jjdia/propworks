import { signOut } from '../lib/auth';
import { useAppStore } from '../store/useAppStore';

export function Account() {
  const email = useAppStore((s) => s.email);
  const profile = useAppStore((s) => s.profile);
  const localOnly = useAppStore((s) => s.localOnly);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Account</h1>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1">
        {profile?.full_name && <div className="text-sm font-medium">{profile.full_name}</div>}
        {email && <div className="text-xs text-slate-400">{email}</div>}
        {profile?.role && <div className="text-xs text-slate-500 capitalize">{profile.role}{profile.trade ? ` · ${profile.trade}` : ''}</div>}
      </div>

      {!localOnly && (
        <button onClick={() => signOut()} className="w-full text-sm rounded-md bg-slate-800 hover:bg-slate-700 px-3 py-2">
          Sign out
        </button>
      )}
    </div>
  );
}
