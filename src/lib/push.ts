import { supabase } from './supabase';

// Web Push subscribe/unsubscribe (V 34). Standard Push API + VAPID, no paid
// service. The VAPID PUBLIC key is a client env var (safe to ship); the
// private key lives only in Supabase secrets. Subscriptions are stored in
// push_subscriptions (RLS: each user manages only their own rows).

const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '';

export type PushState = 'unsupported' | 'not_configured' | 'needs_install' | 'denied' | 'subscribed' | 'not_subscribed';

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function getPushState(): Promise<PushState> {
  // iOS only exposes PushManager to a Home Screen–installed PWA (16.4+).
  if (isIos() && !isStandalone()) return 'needs_install';
  if (!pushSupported()) return 'unsupported';
  if (!VAPID_PUBLIC_KEY || !supabase) return 'not_configured';
  if (Notification.permission === 'denied') return 'denied';
  return (await currentSubscription()) ? 'subscribed' : 'not_subscribed';
}

export async function subscribePush(): Promise<PushState> {
  if (!supabase || !VAPID_PUBLIC_KEY) return 'not_configured';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'not_subscribed';
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) }));
  const j = sub.toJSON();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Sign in first.');
  // Same device re-subscribing: replace our own row for this endpoint.
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  const { error } = await supabase.from('push_subscriptions').insert({
    user_id: auth.user.id,
    endpoint: sub.endpoint,
    p256dh: j.keys?.p256dh ?? '',
    auth: j.keys?.auth ?? '',
    user_agent: navigator.userAgent.slice(0, 300),
  });
  if (error) throw error;
  return 'subscribed';
}

export async function unsubscribePush(): Promise<PushState> {
  const sub = await currentSubscription();
  if (sub) {
    if (supabase) await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  }
  return 'not_subscribed';
}
