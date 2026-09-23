import { computeNextDueDate, isOverdue, isDueSoon } from '../src/lib/maintenanceSchedule';

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`);
  if (cond) pass++; else fail++;
}

check('weekly adds 7 days', computeNextDueDate('2026-01-01', 'weekly') === '2026-01-08');
check('monthly adds 1 month', computeNextDueDate('2026-01-15', 'monthly') === '2026-02-15');
check('quarterly adds 3 months', computeNextDueDate('2026-01-15', 'quarterly') === '2026-04-15');
check('semi_annual adds 6 months', computeNextDueDate('2026-01-15', 'semi_annual') === '2026-07-15');
check('annual adds 12 months', computeNextDueDate('2026-01-15', 'annual') === '2027-01-15');
check('monthly rolls over year boundary', computeNextDueDate('2026-12-15', 'monthly') === '2027-01-15');
check('monthly clamps Jan 31 -> Feb 28 (2026 not a leap year)', computeNextDueDate('2026-01-31', 'monthly') === '2026-02-28');
check('quarterly from Nov 30 -> Feb 28', computeNextDueDate('2026-11-30', 'quarterly') === '2027-02-28');
check('annual on Feb 29 leap day rolls to non-leap Feb 28', computeNextDueDate('2024-02-29', 'annual') === '2025-02-28');

check('isOverdue true for a past date', isOverdue('2026-06-01', '2026-06-15'));
check('isOverdue false for today', !isOverdue('2026-06-15', '2026-06-15'));
check('isOverdue false for a future date', !isOverdue('2026-06-20', '2026-06-15'));

check('isDueSoon true within the window', isDueSoon('2026-06-20', '2026-06-15', 7));
check('isDueSoon true for today exactly', isDueSoon('2026-06-15', '2026-06-15', 7));
check('isDueSoon false just past the window', !isDueSoon('2026-06-23', '2026-06-15', 7));
check('isDueSoon false for a past-due date (that is overdue, not "soon")', !isDueSoon('2026-06-01', '2026-06-15', 7));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
