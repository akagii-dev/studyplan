import { startOfWeek } from '../calendar';
import { addDays, Capacity, Interval, Session, Settings, weekday } from '../model';
import { unavailableEvents } from '../planAudit';
import { weeklyCapacities } from '../weeklyCapacity';
import { subtractIntervals } from './intervals';
export function freeIntervalsForDate(settings: Settings, date: string): Interval[] {
  const rules = settings.windows.filter(
    (w) => w.from <= date && date <= w.to && w.weekdays.includes(weekday(date)),
  );
  return subtractIntervals(
    rules.filter((w) => w.kind === 'study').map((w) => [w.start, w.end]),
    unavailableEvents(settings, date).map((e) => [e.start, e.end]),
  );
}
export function capacityForDate(settings: Settings, date: string): Capacity {
  if (
    !Number.isInteger(settings.block) ||
    settings.block < 1 ||
    settings.block > 1440 ||
    !Number.isInteger(settings.rest) ||
    settings.rest < 1 ||
    settings.rest > 1440 ||
    !Number.isFinite(settings.buffer) ||
    settings.buffer < 0 ||
    settings.buffer >= 1
  )
    throw new Error('連続学習は1〜1440分、休憩は1〜1440分、余裕率は0〜99%で設定してください。');
  const free = freeIntervalsForDate(settings, date);
  const blocks: Interval[] = [];
  // Carry a conservative break across midnight; a date boundary does not reset continuous study.
  const previousEnd = freeIntervalsForDate(settings, addDays(date, -1)).at(-1)?.[1] ?? 0;
  let nextStart = Math.max(0, previousEnd + settings.rest - 1440);
  for (const [s, e] of free) {
    let cursor = Math.max(s, nextStart);
    while (cursor < e) {
      const end = Math.min(e, cursor + settings.block);
      blocks.push([cursor, end]);
      nextStart = end + settings.rest;
      cursor = nextStart;
    }
  }
  const focus = blocks.reduce((n, [s, e]) => n + e - s, 0);
  const slots = blocks.map(([a, b]): Interval => [a, b]);
  return {
    date,
    blocks,
    free: free.reduce((n, [s, e]) => n + e - s, 0),
    focus,
    allocatable: slots.reduce((n, [s, e]) => n + e - s, 0),
    slots,
  };
}
export function capacityForWeek(settings: Settings, date: string, sessions: Session[] = []) {
  const from = startOfWeek(date);
  return weeklyCapacities(
    Array.from({ length: 7 }, (_, i) => capacityForDate(settings, addDays(from, i))),
    settings.buffer,
    sessions,
  )[0];
}
