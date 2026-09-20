import { Settings, Interval, weekday } from './model';
import { capacityForDate, mergeIntervals } from './planner';
import { unavailableEvents } from './planAudit';
export type TimeKind =
  'meal' | 'commute' | 'mealCommute' | 'busy' | 'available' | 'rest' | 'outside';
export interface TimeSegment {
  start: number;
  end: number;
  kind: TimeKind;
  commuteNames: string[];
}
export interface OverviewSegment extends Omit<TimeSegment, 'kind'> {
  kind: Exclude<TimeKind, 'available' | 'rest'> | 'studyWindow';
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
  const commutes = events.filter((e) => e.kind === 'commute');
  const commuteMinutes = mergeIntervals(commutes.map((e) => [e.start, e.end])).reduce(
    (sum, [start, end]) => sum + end - start,
    0,
  );
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
    const hasMeal = events.some((e) => e.kind === 'meal' && e.start <= mid && mid < e.end);
    const commuteNames = [
      ...new Set(commutes.filter((e) => e.start <= mid && mid < e.end).map((e) => e.name)),
    ];
    const kind: TimeKind =
      hasMeal && commuteNames.length
        ? 'mealCommute'
        : hasMeal
          ? 'meal'
          : commuteNames.length
            ? 'commute'
            : events.some((e) => e.start <= mid && mid < e.end)
              ? 'busy'
              : !contains(windows, mid)
                ? 'outside'
                : contains(capacity.slots, mid)
                  ? 'available'
                  : 'rest';
    const last = segments.at(-1);
    if (last?.kind === kind && last.commuteNames.join('/') === commuteNames.join('/'))
      last.end = end;
    else segments.push({ start, end, kind, commuteNames });
  }
  const totals = {
    commute: 0,
    mealCommute: 0,
    meal: 0,
    busy: 0,
    available: 0,
    rest: 0,
    outside: 0,
  };
  for (const s of segments) totals[s.kind] += s.end - s.start;
  const overview: OverviewSegment[] = [];
  for (const s of segments) {
    const kind = s.kind === 'available' || s.kind === 'rest' ? 'studyWindow' : s.kind;
    const last = overview.at(-1);
    if (last?.kind === kind && last.commuteNames.join('/') === s.commuteNames.join('/'))
      last.end = s.end;
    else overview.push({ ...s, kind });
  }
  return { capacity, segments, overview, totals, commutes, commuteMinutes };
}
