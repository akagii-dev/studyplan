import { Plan, Session } from './model';

export interface ScheduleSummary {
  count: number;
  start: string | null;
  end: string | null;
  unplaced: number;
}
export interface DailyChange {
  date: string;
  before: number;
  after: number;
}
export interface ScheduleChange {
  materialId: string;
  round: number | null;
  before: ScheduleSummary;
  after: ScheduleSummary;
  days: DailyChange[];
}

/** Compare the same horizon in both plans; no clock, mutation or persisted UI state. */
export function comparePlans(before: Plan | null, after: Plan) {
  const eligible = (s: Session) =>
    s.kind === 'study' &&
    s.count > 0 &&
    (s.date > after.from || (s.date === after.from && s.start >= (after.notBefore ?? 0)));
  const oldSessions = (before?.sessions ?? []).filter(eligible);
  const newSessions = after.sessions.filter(eligible);
  const materialIds = [
    ...new Set([
      ...oldSessions.map((s) => s.materialId),
      ...newSessions.map((s) => s.materialId),
      ...(before?.shortfalls ?? []).map((s) => s.materialId),
      ...after.shortfalls.map((s) => s.materialId),
    ]),
  ].sort();
  const position = (s: Session, minute: number) =>
    `${s.date} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(Math.floor(minute % 60)).padStart(2, '0')}`;
  const summarize = (plan: Plan | null, sessions: Session[], id: string, round: number | null) => {
    const selected = sessions.filter(
      (s) => s.materialId === id && (round === null || s.round === round),
    );
    const starts = selected.map((s) => position(s, s.start)).sort();
    const ends = selected.map((s) => position(s, s.end)).sort();
    return {
      summary: {
        count: selected.reduce((n, s) => n + s.count, 0),
        start: starts[0] ?? null,
        end: ends.at(-1) ?? null,
        unplaced: (plan?.shortfalls ?? [])
          .filter((s) => s.materialId === id && (round === null || s.round === round))
          .reduce((n, s) => n + s.count, 0),
      },
      days: selected.reduce<Record<string, number>>((result, s) => {
        result[s.date] = (result[s.date] ?? 0) + s.count;
        return result;
      }, {}),
    };
  };
  const compare = (materialId: string, round: number | null): ScheduleChange | null => {
    const a = summarize(before, oldSessions, materialId, round);
    const b = summarize(after, newSessions, materialId, round);
    const days = [...new Set([...Object.keys(a.days), ...Object.keys(b.days)])]
      .sort()
      .map((date) => ({ date, before: a.days[date] ?? 0, after: b.days[date] ?? 0 }))
      .filter((day) => day.before !== day.after);
    return JSON.stringify(a.summary) === JSON.stringify(b.summary) && !days.length
      ? null
      : { materialId, round, before: a.summary, after: b.summary, days };
  };
  return materialIds.flatMap((materialId) => {
    const rounds = [
      ...new Set(
        [...oldSessions, ...newSessions, ...(before?.shortfalls ?? []), ...after.shortfalls]
          .filter((s) => s.materialId === materialId)
          .map((s) => s.round),
      ),
    ]
      .sort((a, b) => a - b)
      .map((round) => compare(materialId, round))
      .filter((x): x is ScheduleChange => x !== null);
    const total = compare(materialId, null);
    return total || rounds.length ? [{ materialId, total, rounds }] : [];
  });
}

export function mainDailyChanges(days: DailyChange[], limit = 3) {
  return [...days]
    .sort(
      (a, b) =>
        Math.abs(b.after - b.before) - Math.abs(a.after - a.before) || a.date.localeCompare(b.date),
    )
    .slice(0, limit)
    .sort((a, b) => a.date.localeCompare(b.date));
}
