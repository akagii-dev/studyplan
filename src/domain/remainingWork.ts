import { AppState, completed, remaining } from './model';
import { materialUnit } from './calendarQuantity';
import { activePlanWork, workKey } from './progressAllocation';

export interface RemainingWorkRow {
  materialId: string;
  round: number;
  name: string;
  unit: string;
  total: number;
  completed: number;
  remaining: number;
  allocated: number;
  unplaced: number;
  /** False is evidence of a pending or inconsistent allocation, never extra shortfall. */
  balanced: boolean;
}

/** Current quantities only. Historical shortages are comparisons, not new work. */
export function remainingWork(state: AppState, date: string): RemainingWorkRow[] {
  const allocated = new Map<string, number>();
  for (const session of activePlanWork(state, date)) {
    const key = workKey(session.materialId, session.round);
    allocated.set(key, (allocated.get(key) ?? 0) + session.count);
  }
  return state.settings.materials.flatMap((m) =>
    m.rounds.map((_, round) => {
      const count = allocated.get(workKey(m.id, round)) ?? 0;
      const unplaced = (state.plan?.shortfalls ?? [])
        .filter((s) => s.materialId === m.id && s.round === round)
        .reduce((sum, s) => sum + s.count, 0);
      const left = remaining(state, m.id, round);
      return {
        materialId: m.id,
        round,
        name: m.name,
        unit: materialUnit(m.unit),
        total: m.total,
        completed: completed(state, m.id, round),
        remaining: left,
        allocated: count,
        unplaced,
        balanced: !!state.plan && left === count + unplaced,
      };
    }),
  );
}
