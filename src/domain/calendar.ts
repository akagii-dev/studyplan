import { addDays, weekday } from './model';

export const startOfWeek = (date: string) => addDays(date, -((weekday(date) + 6) % 7));

/** Upcoming week, never the nearest (possibly past) Sunday. Date keys use the app's local day. */
export const upcomingSunday = (date: string) => addDays(date, (7 - weekday(date)) % 7);
export const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
export const shortDayLabel = (date: string) =>
  `${shortDate(date)}（${['日', '月', '火', '水', '木', '金', '土'][weekday(date)]}）`;
export const weekRangeLabel = (from: string) => {
  const to = addDays(from, 6);
  return `${from.slice(0, 4)} ${shortDate(from)}–${from.slice(0, 4) === to.slice(0, 4) ? '' : `${to.slice(0, 4)} `}${shortDate(to)}`;
};

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
