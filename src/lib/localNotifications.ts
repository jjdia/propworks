// ---------------------------------------------------------------------------
// Uses the standard Notification API to pop an OS-level notification when
// the app is opened and something is overdue. This works while the PWA is
// running (foreground or just-backgrounded) — it is NOT the same as true
// push notifications while the app is fully closed, which would require a
// server-side scheduler and push subscriptions (a separate, larger build).
// Guarded to fire at most once per calendar day so opening the app
// repeatedly doesn't spam the same reminder.
// ---------------------------------------------------------------------------

const LAST_SHOWN_KEY = 'propertyworks_overdue_notif_last_shown';

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied';
  if (Notification.permission === 'granted' || Notification.permission === 'denied') return Notification.permission;
  return Notification.requestPermission();
}

export function maybeShowOverdueNotification(count: number, total: number, tenantCount: number) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  if (count === 0) return;

  const today = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem(LAST_SHOWN_KEY) === today) return; // already shown today

  const body = tenantCount === 1
    ? `1 tenant has ${count} unpaid rent installment${count === 1 ? '' : 's'} totaling $${total.toFixed(2)}.`
    : `${tenantCount} tenants have ${count} unpaid rent installments totaling $${total.toFixed(2)}.`;

  new Notification('PropertyWorks — Unpaid rent', { body, tag: 'overdue-rent' });
  localStorage.setItem(LAST_SHOWN_KEY, today);
}
