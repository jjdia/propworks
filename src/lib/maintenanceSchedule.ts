import type { MaintenanceFrequency } from './types';

// ---------------------------------------------------------------------------
// Given a completion date and a recurrence frequency, compute the next due
// date. Pure function — no I/O — so the recurrence math is testable on its
// own, same pattern as installments.ts and reportExport.ts.
// ---------------------------------------------------------------------------

const MONTHS_TO_ADD: Record<MaintenanceFrequency, number> = {
  weekly: 0, // handled separately (days, not months)
  monthly: 1,
  quarterly: 3,
  semi_annual: 6,
  annual: 12,
};

export function computeNextDueDate(fromDate: string, frequency: MaintenanceFrequency): string {
  const [y, m, d] = fromDate.split('-').map(Number);

  if (frequency === 'weekly') {
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + 7);
    return date.toISOString().slice(0, 10);
  }

  const monthsToAdd = MONTHS_TO_ADD[frequency];
  const totalMonths = (m - 1) + monthsToAdd;
  const newYear = y + Math.floor(totalMonths / 12);
  const newMonth = (totalMonths % 12) + 1;
  const lastDayOfNewMonth = new Date(newYear, newMonth, 0).getDate();
  const clampedDay = Math.min(d, lastDayOfNewMonth);

  return `${newYear}-${String(newMonth).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

export function isOverdue(dueDate: string, today: string): boolean {
  return dueDate < today;
}

export function isDueSoon(dueDate: string, today: string, withinDays = 7): boolean {
  const dueMs = new Date(dueDate).getTime();
  const todayMs = new Date(today).getTime();
  const diffDays = (dueMs - todayMs) / 86400000;
  return diffDays >= 0 && diffDays <= withinDays;
}
