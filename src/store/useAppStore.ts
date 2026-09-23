import { create } from 'zustand';
import type { SyncStatus } from '../lib/sync';
import type { Profile } from '../lib/types';

interface AppState {
  ownerId: string | null;
  email: string | null;
  profile: Profile | null;
  syncStatus: SyncStatus;
  localOnly: boolean; // true when no Supabase project is configured yet
  passwordRecoveryMode: boolean; // true right after clicking a reset-password email link
  setSession: (ownerId: string | null, email: string | null) => void;
  setProfile: (p: Profile | null) => void;
  setSyncStatus: (s: SyncStatus) => void;
  setLocalOnly: (v: boolean) => void;
  setPasswordRecoveryMode: (v: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  ownerId: null,
  email: null,
  profile: null,
  syncStatus: 'idle',
  localOnly: false,
  passwordRecoveryMode: false,
  setSession: (ownerId, email) => set({ ownerId, email }),
  setProfile: (profile) => set({ profile }),
  setSyncStatus: (s) => set({ syncStatus: s }),
  setLocalOnly: (v) => set({ localOnly: v }),
  setPasswordRecoveryMode: (v) => set({ passwordRecoveryMode: v }),
}));
