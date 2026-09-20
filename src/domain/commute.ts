import { Commute, Settings, addDays, today, weekday } from './model';

export const defaultCommute = (): Commute => ({
  enabled: false,
  from: today(),
  to: addDays(today(), 180),
  mode: 'classDays',
  weekdays: [1, 2, 3, 4, 5],
  outboundMinutes: 30,
  returnMinutes: 30,
  outboundStart: 480,
  returnStart: 1080,
});
export function commuteErrors(c?: Commute): string[] {
  if (!c) return [];
  const validDate = (v: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v;
  if (
    typeof c.enabled !== 'boolean' ||
    !validDate(c.from) ||
    !validDate(c.to) ||
    c.to < c.from ||
    !['classDays', 'weekdays'].includes(c.mode) ||
    !Array.isArray(c.weekdays) ||
    c.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
    (c.enabled && c.mode === 'weekdays' && !c.weekdays.length) ||
    [c.outboundMinutes, c.returnMinutes].some((n) => !Number.isInteger(n) || n < 0 || n > 360) ||
    [c.outboundStart, c.returnStart].some((n) => !Number.isInteger(n) || n < 0 || n >= 1440)
  )
    return ['通学の適用期間・曜日・出発時刻と、往路・復路の長さ（0〜360分）を確認してください。'];
  return [];
}
export function commuteEvents(settings: Settings, date: string) {
  const c = settings.commute;
  if (!c?.enabled) return [];
  const errors = commuteErrors(c);
  if (errors.length) throw new Error(errors[0]);
  const events: { id: string; name: string; kind: string; start: number; end: number }[] = [];
  for (const offset of [-1, 0, 1]) {
    const day = addDays(date, offset);
    if (day < c.from || day > c.to) continue;
    const classes = settings.windows.filter(
      (w) =>
        w.kind === 'class' && w.from <= day && day <= w.to && w.weekdays.includes(weekday(day)),
    );
    if (c.mode === 'classDays' ? !classes.length : !c.weekdays.includes(weekday(day))) continue;
    const outbound =
      c.mode === 'classDays'
        ? Math.min(...classes.map((w) => w.start)) - c.outboundMinutes
        : c.outboundStart;
    const returning =
      c.mode === 'classDays' ? Math.max(...classes.map((w) => w.end)) : c.returnStart;
    for (const [key, name, start, length] of [
      ['outbound', '通学（往路）', outbound, c.outboundMinutes],
      ['return', '通学（復路）', returning, c.returnMinutes],
    ] as const) {
      const a = Math.max(0, start + offset * 1440),
        b = Math.min(1440, start + length + offset * 1440);
      if (a < b)
        events.push({ id: `commute-${day}-${key}`, name, kind: 'commute', start: a, end: b });
    }
  }
  return events;
}
