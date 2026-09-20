import { addDays, weekday } from './model';

export const startOfWeek = (date: string) => addDays(date, -((weekday(date) + 6) % 7));

/** Keep the selected day when possible, clamping month-end dates instead of overflowing. */
export function moveCalendarDate(date: string, view: 'month' | 'week' | 'list', direction: number) {
  if (view === 'week') return addDays(date, direction * 7);
  const next = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + direction);
  const last = new Date(next);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  next.setUTCDate(Math.min(Number(date.slice(8)), last.getUTCDate()));
  return next.toISOString().slice(0, 10);
}
