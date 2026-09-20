import { Interval, addDays } from '../model';
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [start, end] of [...intervals].sort((a, b) => a[0] - b[0])) {
    if (end <= start) continue;
    const last = out.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}
export function subtractIntervals(available: Interval[], busy: Interval[]): Interval[] {
  let out = mergeIntervals(available);
  for (const [bs, be] of mergeIntervals(busy))
    out = out.flatMap(([s, e]): Interval[] =>
      be <= s || bs >= e
        ? [[s, e]]
        : ([...(s < bs ? [[s, bs]] : []), ...(be < e ? [[be, e]] : [])] as Interval[]),
    );
  return out;
}
export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    dates.push(d);
    if (dates.length > 3660) throw new Error('計画期間は10年以内にしてください。');
  }
  return dates;
}
