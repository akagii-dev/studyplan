import { AppState, Plan, remaining } from './model';
import { activePlanWork, workKey } from './progressAllocation';
import { PlanningContext } from './planner/context';
import { generatePlan } from './planner/generate';
import { requirePlanningInputs } from './setupIssues';
import { validateRevisedSettings } from './revision';

/** Rebuild all remaining work. The caller owns proposal, approval and history. */
export function calculateRestart(state: AppState, from: string, context: PlanningContext): Plan {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !Number.isFinite(Date.parse(`${from}T12:00:00Z`)) ||
    new Date(`${from}T12:00:00Z`).toISOString().slice(0, 10) !== from
  )
    throw new Error('開始日を正しい日付で入力してください。');
  if (from < context.date) throw new Error('開始日は今日以降を指定してください。');
  requirePlanningInputs(state.settings, from);
  validateRevisedSettings(state, state.settings, context.date, context.minute);
  const notBefore = from === context.date ? context.minute : 0;
  // Keep actual historical slots; upcoming non-fixed slots before the new start
  // belong only in the caller's archived plan, never in both active allocations.
  const comparisonIds = new Set(state.plan?.comparisonSessionIds ?? []);
  const sessions = (state.plan?.sessions ?? []).filter((s) => s.date < context.date || s.fixed);
  const budgets = Object.fromEntries(
    state.settings.materials.flatMap((m) =>
      m.rounds.map((_, round) => [workKey(m.id, round), remaining(state, m.id, round)]),
    ),
  );
  const plan = generatePlan(state, from, true, notBefore, 'balanced', context, {
    sessions,
    remaining: budgets,
    rebuildReviews: true,
    allowReportedDay: true,
  });
  plan.allocationStart = from;
  const active = new Map(activePlanWork(state, context.date).map((s) => [s.id, s.count]));
  for (const fixed of sessions.filter(
    (s) =>
      s.fixed &&
      s.date >= context.date &&
      (s.kind === 'review' || active.has(s.id)) &&
      (s.date < from || (s.date === from && s.start < notBefore)),
  )) {
    plan.conflicts.push(
      `${fixed.date}の固定予定が再配分の開始前にあります。開始日を戻すか、固定予定を確認してください。`,
    );
  }
  for (const fixed of sessions.filter(
    (s) =>
      s.fixed &&
      !comparisonIds.has(s.id) &&
      s.kind === 'study' &&
      (s.date > from || (s.date === from && s.start >= notBefore)) &&
      (active.get(s.id) ?? 0) !== s.count,
  ))
    plan.conflicts.push(
      `${fixed.date}の固定予定には実施済みの量が含まれます。固定予定を確認してから作り直してください。`,
    );
  plan.conflicts = [...new Set(plan.conflicts)];
  // Only valid candidates promise R=A+U. A fixed conflict remains an explicit,
  // unapprovable candidate rather than deleting or silently moving fixed work.
  if (!plan.conflicts.length) {
    for (const [key, budget] of Object.entries(budgets)) {
      const allocated = plan.sessions
        .filter(
          (s) =>
            s.kind === 'study' &&
            !comparisonIds.has(s.id) &&
            (s.date > from || (s.date === from && s.start >= notBefore)) &&
            workKey(s.materialId, s.round) === key,
        )
        .reduce((sum, s) => sum + s.count, 0);
      const unplaced = plan.shortfalls
        .filter((s) => workKey(s.materialId, s.round) === key)
        .reduce((sum, s) => sum + s.count, 0);
      if (allocated + unplaced !== budget)
        throw new Error('予定量と現在残量が一致しません。計画を確定できません。');
    }
  }
  return plan;
}
