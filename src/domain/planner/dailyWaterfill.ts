/** Integer water filling. Daily room and a shared weekly ceiling are independent limits. */
export interface WaterfillDay {
  date: string;
  week: string;
  base: number;
  capacity: number;
}

export function dailyWaterfill(
  quantity: number,
  days: WaterfillDay[],
  weeklyLimits: ReadonlyMap<string, number>,
): Map<string, number> {
  const rows = days.map((day) => ({
    ...day,
    base: Math.max(0, Math.floor(day.base)),
    capacity: Math.max(0, Math.floor(day.capacity)),
  }));
  const groups = new Map<string, typeof rows>();
  for (const row of rows) groups.set(row.week, [...(groups.get(row.week) ?? []), row]);
  const limit = (week: string) => Math.max(0, Math.floor(weeklyLimits.get(week) ?? Infinity));
  const at = (row: (typeof rows)[number], level: number) =>
    Math.min(row.capacity, Math.max(0, level - row.base));
  const totalAt = (level: number) => [...groups].reduce((sum, [week, group]) =>
    sum + Math.min(limit(week), group.reduce((n, row) => n + at(row, level), 0)), 0);
  const quantityLimit = [...groups].reduce((sum, [week, group]) =>
    sum + Math.min(limit(week), group.reduce((n, row) => n + row.capacity, 0)), 0);
  const wanted = Math.min(Math.max(0, Math.floor(quantity)), quantityLimit);
  const findLevel = (maximum: number, evaluate: (level: number) => number, wanted: number) => {
    let lo = 0, hi = maximum;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (evaluate(mid) <= wanted) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const maximum = rows.reduce((n, row) => Math.max(n, row.base + row.capacity), 0);
  const level = findLevel(maximum, totalAt, wanted);
  const result = new Map<string, number>();
  const used = new Map<string, number>();
  for (const [week, group] of groups) {
    const budget = limit(week);
    const groupLevel = findLevel(level,
      (value) => group.reduce((sum, row) => sum + at(row, value), 0), budget);
    for (const row of group) {
      const count = at(row, groupLevel);
      result.set(row.date, count);
      used.set(week, (used.get(week) ?? 0) + count);
    }
    // A saturated week can have a fractional water level of its own.
    for (const row of [...group].sort((a, b) =>
      a.base + result.get(a.date)! - b.base - result.get(b.date)! || a.date.localeCompare(b.date))) {
      if ((used.get(week) ?? 0) >= budget) break;
      const count = result.get(row.date)!;
      if (row.base + count >= level || count >= row.capacity) continue;
      result.set(row.date, count + 1);
      used.set(week, (used.get(week) ?? 0) + 1);
    }
  }
  let left = wanted - [...result.values()].reduce((sum, count) => sum + count, 0);
  for (const row of [...rows].sort((a, b) =>
    a.base + result.get(a.date)! - b.base - result.get(b.date)! || a.date.localeCompare(b.date))) {
    if (!left) break;
    const count = result.get(row.date)!;
    if (count >= row.capacity || (used.get(row.week) ?? 0) >= limit(row.week)) continue;
    result.set(row.date, count + 1);
    used.set(row.week, (used.get(row.week) ?? 0) + 1);
    left--;
  }
  return result;
}
