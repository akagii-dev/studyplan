import { Settings, Interval, weekday } from './model';
import { capacityForDate, mergeIntervals } from './planner';
import { unavailableEvents } from './planAudit';
export type TimeKind = 'meal' | 'busy' | 'available' | 'buffer' | 'rest' | 'outside';
export interface TimeSegment {
  start: number;
  end: number;
  kind: TimeKind;
}
export function dailyTime(settings: Settings, date: string) {
  const capacity = capacityForDate(settings, date);
  const windows = mergeIntervals(
    settings.windows
      .filter(
        (w) =>
          w.kind === 'study' &&
          w.from <= date &&
          date <= w.to &&
          w.weekdays.includes(weekday(date)),
      )
      .map((w) => [w.start, w.end]),
  );
  const events = unavailableEvents(settings, date);
  const boundaries = [
    ...new Set([
      0,
      1440,
      ...windows.flat(),
      ...events.flatMap((e) => [e.start, e.end]),
      ...(capacity.blocks ?? []).flat(),
      ...capacity.slots.flat(),
    ]),
  ].sort((a, b) => a - b);
  const contains = (intervals: Interval[], t: number) =>
    intervals.some(([a, b]) => a <= t && t < b);
  const segments: TimeSegment[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i],
      end = boundaries[i + 1],
      mid = (start + end) / 2;
    const kind: TimeKind = events.some((e) => e.kind === 'meal' && e.start <= mid && mid < e.end)
      ? 'meal'
      : events.some((e) => e.start <= mid && mid < e.end)
        ? 'busy'
        : !contains(windows, mid)
          ? 'outside'
          : contains(capacity.slots, mid)
            ? 'available'
            : contains(capacity.blocks ?? [], mid)
              ? 'buffer'
              : 'rest';
    const last = segments.at(-1);
    if (last?.kind === kind) last.end = end;
    else segments.push({ start, end, kind });
  }
  const totals = { meal: 0, busy: 0, available: 0, buffer: 0, rest: 0, outside: 0 };
  for (const s of segments) totals[s.kind] += s.end - s.start;
  return { capacity, segments, totals };
}
