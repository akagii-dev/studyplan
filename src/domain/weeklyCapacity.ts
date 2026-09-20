import { Capacity, Session, addDays } from './model';
import { startOfWeek } from './calendar';

export interface WeeklyCapacity {
  from: string;
  to: string;
  free: number;
  focus: number;
  limit: number;
  used: number;
  remaining: number;
  unallocated: number;
}

/** A shared weekly ceiling, never a reservation on individual dates. */
export function weeklyCapacities(capacities: Capacity[], buffer: number, sessions: Session[] = []) {
  const weeks = new Map<string, WeeklyCapacity>();
  for (const c of capacities) {
    const from = startOfWeek(c.date);
    const week = weeks.get(from) ?? {
      from,
      to: addDays(from, 6),
      free: 0,
      focus: 0,
      limit: 0,
      used: 0,
      remaining: 0,
      unallocated: 0,
    };
    week.free += c.free;
    week.focus += c.focus;
    weeks.set(from, week);
  }
  for (const s of sessions) {
    const week = weeks.get(startOfWeek(s.date));
    if (week) week.used += s.end - s.start;
  }
  for (const week of weeks.values()) {
    week.limit = Math.floor(week.focus * (1 - buffer) + 1e-7);
    week.remaining = Math.max(0, week.limit - week.used);
    week.unallocated = Math.max(0, week.focus - week.used);
  }
  return [...weeks.values()];
}
