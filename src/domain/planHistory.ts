import { AppState, Plan } from './model';
import { baselineSourcePlan, retainStudyDayBaselines } from './calendarQuantity';

/**
 * Keep plan history only for what still reads it:
 * - the latest replaced plan, whole, for 「前の計画へ戻す」;
 * - plans that define the comparison basis of today or a later day not saved yet;
 * - the restart boundary (its start time), for schedule views.
 * Past days are saved in studyDayBaselines first, so their basis does not change.
 * Reduced plans are marked `compacted` and cannot be restored as a whole plan.
 */
export function compactHistory(state: AppState, today: string): AppState {
  if (state.history.length < 2) return state;
  const retained = retainStudyDayBaselines(state, today, false);
  const last = state.history.at(-1)!;
  const days = new Set<string>();
  for (const plan of state.history.slice(0, -1)) {
    for (const s of plan.sessions) if (s.date >= today) days.add(s.date);
    for (const c of plan.capacities) if (c.date >= today) days.add(c.date);
  }
  const needed = new Map<Plan, Set<string>>();
  for (const day of days) {
    if (retained.studyDayBaselines?.[day]) continue;
    const source = baselineSourcePlan(retained, day);
    if (source && source !== retained.plan && source !== last)
      needed.set(source, (needed.get(source) ?? new Set()).add(day));
  }
  const start = state.plan?.allocationStart;
  const boundary = start === undefined ? undefined :
    [...state.history, ...(state.plan ? [state.plan] : [])].reverse()
      .find((plan) => plan.allocationStart === start && plan.from === start);
  const history = state.history.flatMap((plan) => {
    if (plan === last) return [plan];
    const keep = needed.get(plan);
    return keep || plan === boundary ? [compactPlan(plan, keep ?? new Set())] : [];
  });
  if (history.length === state.history.length && history.every((plan, i) => plan === state.history[i]))
    return state;
  return { ...retained, history };
}

function compactPlan(plan: Plan, days: Set<string>): Plan {
  const sessions = plan.sessions.filter((s) => days.has(s.date));
  const capacities = plan.capacities.filter((c) => days.has(c.date));
  if (plan.compacted && sessions.length === plan.sessions.length && capacities.length === plan.capacities.length)
    return plan;
  const ids = new Set(sessions.map((s) => s.id));
  const original = plan.progressBaseline?.sessions;
  return {
    id: plan.id,
    createdAt: plan.createdAt,
    ...(plan.approvedAt ? { approvedAt: plan.approvedAt } : {}),
    from: plan.from,
    ...(plan.allocationStart ? { allocationStart: plan.allocationStart } : {}),
    ...(plan.notBefore !== undefined ? { notBefore: plan.notBefore } : {}),
    ...(plan.calculationVersion !== undefined ? { calculationVersion: plan.calculationVersion } : {}),
    ...(plan.settingsSnapshot ? { settingsSnapshot: plan.settingsSnapshot } : {}),
    ...(plan.settingsUpdatedAt ? { settingsUpdatedAt: plan.settingsUpdatedAt } : {}),
    sessions,
    capacities,
    shortfalls: [],
    conflicts: [],
    // Original quantities of the kept sessions define their comparison basis.
    ...(original ? {
      progressBaseline: {
        records: {},
        shortfalls: {},
        sessions: Object.fromEntries(Object.entries(original).filter(([id]) => ids.has(id))),
      },
    } : {}),
    compacted: true,
  };
}
