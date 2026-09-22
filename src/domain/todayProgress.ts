import { AppState, today } from './model';
import { originalSessionCount } from './progressReflection';

/** Compare today's saved reports with today's approved plan, grouped by material and round. */
export function todayProgress(state: AppState, date = today()) {
  const tasks = new Map<string, { planned: number; actual: number }>();
  const key = (materialId: string, round: number) => JSON.stringify([materialId, round]);
  for (const session of state.plan?.sessions ?? []) {
    if (session.date !== date || session.kind !== 'study') continue;
    const id = key(session.materialId, session.round);
    const task = tasks.get(id) ?? { planned: 0, actual: 0 };
    task.planned += originalSessionCount(state.plan, session);
    tasks.set(id, task);
  }
  const records = state.records.filter((r) => r.date === date && !r.cancelled);
  let actual = 0,
    matched = 0,
    planned = 0;
  for (const record of records) {
    actual += record.count;
    const task = tasks.get(key(record.materialId, record.round));
    if (task) task.actual += record.count;
  }
  for (const task of tasks.values()) {
    planned += task.planned;
    matched += Math.min(task.planned, task.actual);
  }
  return {
    planned,
    actual,
    matched,
    remaining: planned - matched,
    reported: records.length > 0,
    percent: planned ? (matched / planned) * 100 : null,
  };
}
