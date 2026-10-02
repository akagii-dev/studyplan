import { remaining, type AppState, type RemainingAdjustmentTarget } from './model';
import { activePlanWork, workKey } from './progressAllocation';
import { calculateRemainingAdjustment, isElapsedRemainingSession } from './remainingAllocation';
import type { PlanningContext } from './planner/context';

const total = (state: AppState, ids: Set<string>) => (state.plan?.shortfalls ?? [])
  .filter(s => ids.has(s.materialId)).reduce((n, s) => n + s.minutes, 0);

/** An explicit scope: today's started work, fixed slots and all other tasks are protected. */
export function calculateFutureBalance(
  state: AppState, materialIds: string[], from: string, context: PlanningContext,
  allowLowerPriorityReduction = false,
) {
  const primary = new Set(materialIds);
  if (!primary.size || [...primary].some(id => !state.settings.materials.some(m => m.id === id)))
    throw new Error('均等に配分する教材を選んでください。');
  const active = activePlanWork(state, context.date);
  const movable = active.filter(s => !s.fixed && s.date >= from && !isElapsedRemainingSession(s, context));
  const selected = movable.filter(s => primary.has(s.materialId));
  const targets: RemainingAdjustmentTarget[] = selected.map(s => ({ kind: 'session', sessionId: s.id }));
  for (const short of state.plan?.shortfalls ?? [])
    if (primary.has(short.materialId)) targets.push({ kind: 'shortfall', materialId: short.materialId, round: short.round });
  if (!targets.length) throw new Error('選択した教材に変更可能な未来の残量がありません。');
  const run = (scope: RemainingAdjustmentTarget[], reserve: Record<string, number> = {}) => {
    const result = calculateRemainingAdjustment(state, scope, from, context, context.date, false, true, reserve);
    return { ...result, targets: scope, plan: { ...result.plan,
      dailyBalanceMaterialIds: [...new Set([...(state.plan?.dailyBalanceMaterialIds ?? []), ...primary])].sort() } };
  };
  const first = run(targets);
  if (!total({ ...state, plan: first.plan }, primary) || !allowLowerPriorityReduction) return first;
  const minimumPriority = Math.min(...state.settings.materials.filter(m => primary.has(m.id))
    .map(m => state.settings.exams.find(e => e.id === m.examId)!.priority));
  const donors = movable.filter(s => !primary.has(s.materialId) &&
    state.settings.exams.find(e => e.id === s.examId)!.priority < minimumPriority);
  if (!donors.length) return first;
  const scope: RemainingAdjustmentTarget[] = [...targets, ...donors.map(s => ({ kind: 'session' as const, sessionId: s.id }))];
  const donorIds = new Set(donors.map(s => s.materialId));
  const before = new Map((state.plan?.shortfalls ?? []).map(s => [workKey(s.materialId, s.round), 0]));
  for (const short of state.plan?.shortfalls ?? []) {
    const key = workKey(short.materialId, short.round);
    before.set(key, (before.get(key) ?? 0) + short.count);
  }
  const losses = (plan: typeof first.plan) => {
    const counts = new Map<string, number>();
    for (const short of plan.shortfalls) {
      const key = workKey(short.materialId, short.round);
      counts.set(key, (counts.get(key) ?? 0) + short.count);
    }
    let minutes = 0;
    const materials = new Set<string>();
    for (const [key, count] of counts) {
      const [id, round] = JSON.parse(key) as [string, number];
      const loss = Math.max(0, count - (before.get(key) ?? 0));
      if (donorIds.has(id) && loss) {
        minutes += loss * state.settings.materials.find(m => m.id === id)!.rounds[round].minutes;
        materials.add(id);
      }
    }
    return { minutes, materials: materials.size };
  };
  // First attempt preserves all quantities. Only actual additional shortfalls count as loss.
  const rearranged = run(scope);
  if (!total({ ...state, plan: rearranged.plan }, primary) && !losses(rearranged.plan).minutes) return rearranged;
  const categories = [...new Set(donors.map(s => workKey(s.materialId, s.round)))].sort().map(key => {
    const [materialId, round] = JSON.parse(key) as [string, number];
    return { key, materialId, minutes: state.settings.materials.find(m => m.id === materialId)!.rounds[round].minutes,
      count: donors.filter(s => workKey(s.materialId, s.round) === key).reduce((n,s) => n + s.count, 0) };
  });
  let best: typeof rearranged | undefined = total({ ...state, plan: rearranged.plan }, primary) ? undefined : rearranged;
  let bestLoss = best ? losses(best.plan) : { minutes: donors.reduce((n,s) => n+s.end-s.start,0), materials: donorIds.size };
  const frontier = [{ counts: categories.map(() => 0), cost: 0 }];
  const visited = new Set<string>([JSON.stringify(frontier[0].counts)]);
  let evaluated = 0;
  while (frontier.length) {
    frontier.sort((a,b) => a.cost - b.cost ||
      new Set(a.counts.flatMap((n,i) => n ? [categories[i].materialId] : [])).size -
      new Set(b.counts.flatMap((n,i) => n ? [categories[i].materialId] : [])).size ||
      JSON.stringify(a.counts).localeCompare(JSON.stringify(b.counts)));
    const node = frontier.shift()!;
    if (node.cost > bestLoss.minutes + 1e-7) break;
    // This is a computation limit, never a policy threshold for acceptable loss.
    // Without completed minimality verification keep the original no-reduction proposal.
    if (++evaluated > 1500) return first;
    const reserve = Object.fromEntries(node.counts.flatMap((n,i) => n ? [[categories[i].key,n]] : []));
    const candidate = node.cost ? run(scope, reserve) : rearranged;
    if (!total({ ...state, plan: candidate.plan }, primary)) {
      const loss = losses(candidate.plan);
      if (loss.minutes < bestLoss.minutes || (loss.minutes === bestLoss.minutes && loss.materials < bestLoss.materials)) {
        best = candidate; bestLoss = loss;
      }
    }
    for (let i = 0; i < categories.length; i++) {
      if (node.counts[i] >= categories[i].count) continue;
      const counts = [...node.counts]; counts[i]++;
      const cost = node.cost + categories[i].minutes;
      const key = JSON.stringify(counts);
      if (cost <= bestLoss.minutes + 1e-7 && !visited.has(key)) {
        visited.add(key); frontier.push({ counts, cost });
      }
    }
  }
  // Quantity loss is explicit in existing shortfalls; do not subtract completed work or totals.
  for (const material of state.settings.materials)
    for (const round of material.rounds.keys())
      if (remaining(state, material.id, round) < 0) throw new Error('残量が無効です。');
  return best ?? first;
}
