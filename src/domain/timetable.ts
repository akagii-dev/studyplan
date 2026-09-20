import type { WindowRule } from './model';

export const sortedWeekdays = (days: number[]) =>
  [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
export function sortedClasses(windows: WindowRule[], from?: string, to?: string) {
  return windows
    .filter((w) => w.kind === 'class' && (!from || w.from === from) && (!to || w.to === to))
    .map((w) => ({ ...w, weekdays: sortedWeekdays(w.weekdays) }))
    .sort(
      (a, b) =>
        (((a.weekdays[0] ?? 1) + 6) % 7) - (((b.weekdays[0] ?? 1) + 6) % 7) ||
        a.start - b.start ||
        a.end - b.end ||
        a.from.localeCompare(b.from) ||
        a.to.localeCompare(b.to) ||
        a.id.localeCompare(b.id),
    );
}
