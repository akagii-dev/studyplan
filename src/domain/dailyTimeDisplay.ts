import { OutsideTime, OutsideLabel, Interval, AppState } from './model';
import { dailyTime } from './dailyTime';
import { TimeKind, TimeSegment } from './dailyTime';

export type DisplayTimeKind = TimeKind | 'sleep' | 'bath';
export type DisplayTimeSegment = Omit<TimeSegment, 'kind'> & {
  kind: DisplayTimeKind;
  title?: string;
};
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
export function dailyTimeDisplay(
  segments: TimeSegment[],
  annotations: OutsideTime = {},
  labels: OutsideLabel[] = [],
) {
  const sleep = intervals(annotations.sleep),
    bath = intervals(annotations.bath);
  const result: DisplayTimeSegment[] = [];
  for (const segment of segments) {
    if (segment.kind !== 'outside') {
      result.push({ ...segment });
      continue;
    }
    const cuts = [
      ...new Set([
        segment.start,
        segment.end,
        ...sleep.flat(),
        ...bath.flat(),
        ...labels.flatMap((x) => [x.start, x.end]),
      ]),
    ]
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
      const title =
        kind === 'outside'
          ? labels.find((x) => x.start <= start && end <= x.end)?.title
          : undefined;
      if (last?.kind === kind && last.end === start && last.title === title) last.end = end;
      else result.push({ ...segment, start, end, kind, ...(title ? { title } : {}) });
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

/** A date-specific display label. Never edits planning settings or actual progress. */
export function renameOutsideRange(
  state: AppState,
  date: string,
  start: number,
  end: number,
  title: string | null,
): AppState {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 1440 || start >= end)
    throw new Error('時間帯を確認してください。');
  const trimmed = title?.trim();
  if (title !== null && (!trimmed || trimmed.length > 120))
    throw new Error('名前は1〜120文字で入力してください。');
  const day = dailyTimeDisplay(dailyTime(state.settings, date).segments, state.outsideTime);
  if (!day.segments.some((x) => x.kind === 'outside' && x.start <= start && end <= x.end))
    throw new Error('時間の設定が変わりました。内訳を確認してから編集してください。');
  const labels = (state.outsideLabels?.[date] ?? []).flatMap((x) => {
    if (x.end <= start || end <= x.start) return [x];
    return [
      ...(x.start < start ? [{ ...x, end: start }] : []),
      ...(end < x.end ? [{ ...x, start: end }] : []),
    ];
  });
  if (trimmed) labels.push({ start, end, title: trimmed });
  labels.sort((a, b) => a.start - b.start);
  const outsideLabels = { ...state.outsideLabels, [date]: labels };
  if (!labels.length) delete outsideLabels[date];
  return { ...state, outsideLabels };
}
