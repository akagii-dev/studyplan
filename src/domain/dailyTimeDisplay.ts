import { OutsideTime, Interval } from './model';
import { TimeKind, TimeSegment } from './dailyTime';

export type DisplayTimeKind = TimeKind | 'sleep' | 'bath';
export type DisplayTimeSegment = Omit<TimeSegment, 'kind'> & { kind: DisplayTimeKind };
export const outsideNames = { sleep: '睡眠', bath: '風呂' } as const;
function intervals(value?: { start: number; duration: number }): Interval[] {
  if (!value) return [];
  const end = value.start + value.duration;
  return end > 1440
    ? [
        [value.start, 1440],
        [0, end - 1440],
      ]
    : [[value.start, end]];
}
export function outsideTimeError(value: OutsideTime): string | undefined {
  for (const [key, time] of Object.entries(value)) {
    if (
      !time ||
      !Number.isInteger(time.start) ||
      time.start < 0 ||
      time.start >= 1440 ||
      !Number.isInteger(time.duration) ||
      time.duration < 1 ||
      time.duration >= 1440
    )
      return `${outsideNames[key as keyof OutsideTime]}の開始・終了時刻を確認してください。`;
  }
  if (
    intervals(value.sleep).some(([a, b]) => intervals(value.bath).some(([c, d]) => a < d && c < b))
  )
    return '睡眠と風呂の時間が重なっています。開始・終了時刻を修正してください。';
}

/** Split only outside segments. Original capacity, events and TimeKind stay unchanged. */
export function dailyTimeDisplay(segments: TimeSegment[], annotations: OutsideTime = {}) {
  const sleep = intervals(annotations.sleep),
    bath = intervals(annotations.bath);
  const result: DisplayTimeSegment[] = [];
  for (const segment of segments) {
    if (segment.kind !== 'outside') {
      result.push({ ...segment });
      continue;
    }
    const cuts = [...new Set([segment.start, segment.end, ...sleep.flat(), ...bath.flat()])]
      .filter((n) => segment.start <= n && n <= segment.end)
      .sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i++) {
      const start = cuts[i],
        end = cuts[i + 1];
      // Defensive precedence for imported overlapping annotations; never count twice.
      const kind = bath.some(([a, b]) => a <= start && start < b)
        ? 'bath'
        : sleep.some(([a, b]) => a <= start && start < b)
          ? 'sleep'
          : 'outside';
      const last = result.at(-1);
      if (last?.kind === kind && last.end === start) last.end = end;
      else result.push({ ...segment, start, end, kind });
    }
  }
  const totals: Record<DisplayTimeKind, number> = {
    available: 0,
    rest: 0,
    busy: 0,
    meal: 0,
    commute: 0,
    mealCommute: 0,
    sleep: 0,
    bath: 0,
    outside: 0,
  };
  for (const s of result) totals[s.kind] += s.end - s.start;
  return { segments: result, totals };
}
