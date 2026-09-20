import { Plan, Session, Settings, weekday, addDays, mealKeys, mealNames } from './model';
import { sessionPolicy, PLAN_CALCULATION_VERSION } from './sessionPolicy';
import { commuteEvents } from './commute';

export function sameSettings(a: Settings, b: Settings): boolean {
  const normalize = (s: Settings) =>
    JSON.stringify({
      classTransition: s.classTransition ?? 0,
      exams: s.exams,
      materials: s.materials,
      windows: s.windows,
      exceptions: s.exceptions,
      meals: s.meals ?? {},
      commute: s.commute?.enabled ? s.commute : null,
      block: s.block,
      sessionPolicy: sessionPolicy(s),
      rest: s.rest,
      buffer: s.buffer,
      periods: s.periods,
    });
  return normalize(a) === normalize(b);
}
export interface UnavailableEvent {
  id: string;
  name: string;
  kind: string;
  start: number;
  end: number;
}
export function blockingEvents(settings: Settings, date: string): UnavailableEvent[] {
  return [
    ...settings.windows
      .filter(
        (w) =>
          w.kind !== 'study' &&
          w.from <= date &&
          date <= w.to &&
          w.weekdays.includes(weekday(date)),
      )
      .map((w) => ({ id: w.id, name: w.name, kind: w.kind, start: w.start, end: w.end })),
    ...settings.exceptions.filter((e) => e.date === date).map((e) => ({ ...e, kind: 'exception' })),
  ];
}
export function overlapsBusy(settings: Settings, session: Session) {
  return unavailableEvents(settings, session.date).filter(
    (e) => session.start < e.end && e.start < session.end,
  );
}
export function unavailableEvents(settings: Settings, date: string) {
  const gap = settings.classTransition ?? 0;
  const events = blockingEvents(settings, date);
  events.push(...commuteEvents(settings, date));
  for (const key of mealKeys) {
    const meal = settings.meals?.[key];
    if (!meal) continue;
    events.push({
      id: 'meal-' + key,
      name: mealNames[key],
      kind: 'meal',
      start: meal.start,
      end: Math.min(1440, meal.start + meal.duration),
    });
    if (meal.start + meal.duration > 1440)
      events.push({
        id: 'meal-' + key + '-previous',
        name: mealNames[key] + '（前日から）',
        kind: 'meal',
        start: 0,
        end: meal.start + meal.duration - 1440,
      });
  }
  if (gap > 0)
    for (const offset of [-1, 0, 1]) {
      const day = addDays(date, offset);
      for (const c of blockingEvents(settings, day).filter((e) => e.kind === 'class')) {
        for (const [index, a, b] of [
          [0, c.start - gap, c.start],
          [1, c.end, c.end + gap],
        ]) {
          const start = Math.max(0, a + offset * 1440),
            end = Math.min(1440, b + offset * 1440);
          if (start < end)
            events.push({
              id: `${c.id}-gap-${day}-${index}`,
              name: '授業の移動・準備',
              kind: 'transition',
              start,
              end,
            });
        }
      }
    }
  return events.sort((a, b) => a.start - b.start || a.end - b.end);
}
export function stalePlan(plan: Plan | null, settings: Settings) {
  return (
    !!plan &&
    (plan.calculationVersion !== PLAN_CALCULATION_VERSION ||
      !plan.settingsSnapshot ||
      !sameSettings(plan.settingsSnapshot, settings))
  );
}
export const dateTime = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '記録なし（旧バージョンの設定）';
