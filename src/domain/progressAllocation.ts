import { addDays, remaining, type AppState, type Plan, type Session } from './model';
import { recordTotals, createProgressBaseline } from './progressReflection';
import { generatePlan } from './planner/generate';
import type { PlanningContext } from './planner/context';
import { fixedOrderIssue } from './planConstraints';
import { requirePlanningInputs } from './setupIssues';
import { validateRevisedSettings } from './revision';

export const workKey = (materialId: string, round: number) => JSON.stringify([materialId, round]);
const bySlot = (a: Session, b: Session) =>
  a.date.localeCompare(b.date) || a.start - b.start || a.id.localeCompare(b.id);
const totalFor = (records: Record<string, number>, id: string, round: number) =>
  Object.entries(records).reduce((sum, [key, count]) => {
    const [, materialId, r] = JSON.parse(key) as [string, string, number];
    return sum + (materialId === id && r === round ? count : 0);
  }, 0);
const resize = (session: Session, count: number): Session => ({
  ...session,
  count,
  end:
    session.start + (session.count ? ((session.end - session.start) * count) / session.count : 0),
});

function basisRemainders(state: AppState, basis: NonNullable<Plan['adjustmentBasis']>) {
  const current = recordTotals(state.records);
  const consumed = new Map<string, number>();
  return [...basis.sessions].sort(bySlot).map((session) => {
    const key = workKey(session.materialId, session.round);
    if (!consumed.has(key))
      consumed.set(
        key,
        Math.max(
          0,
          totalFor(current, session.materialId, session.round) -
            totalFor(basis.records, session.materialId, session.round),
        ),
      );
    const take = Math.min(session.count, consumed.get(key)!);
    consumed.set(key, consumed.get(key)! - take);
    return resize(session, session.count - take);
  });
}

function todayRemainders(
  state: AppState,
  date: string,
  basis: NonNullable<Plan['adjustmentBasis']>,
) {
  const used = new Map<string, number>();
  const current = recordTotals(state.records);
  const quantities = new Map<string, number>();
  // Legacy reflection can consume a future slot before it becomes today's
  // work. The saved zero/reduced slot remains the upper bound at day rollover.
  const original = basis.sessions
    .filter((s) => s.date === date)
    .map((s) =>
      resize(
        s,
        Math.min(s.count, state.plan?.sessions.find((current) => current.id === s.id)?.count ?? 0),
      ),
    );
  for (const session of original) {
    const key = workKey(session.materialId, session.round);
    quantities.set(key, (quantities.get(key) ?? 0) + session.count);
  }
  // The basis contains outstanding work when allocation was established. A
  // historical daily denominator can differ after an explicit restart.
  for (const [key, count] of quantities) {
    const [materialId, round] = JSON.parse(key) as [string, number];
    const recordKey = JSON.stringify([date, materialId, round]);
    const added = Math.max(0, (current[recordKey] ?? 0) - (basis.records[recordKey] ?? 0));
    quantities.set(key, Math.max(0, count - added));
  }
  return [...original]
    .sort(bySlot)
    .filter((s) => s.date === date)
    .map((s) => {
      const key = workKey(s.materialId, s.round);
      const count = Math.min(
        s.count,
        Math.max(
          0,
          Math.min(remaining(state, s.materialId, s.round), quantities.get(key) ?? 0) -
            (used.get(key) ?? 0),
        ),
      );
      used.set(key, (used.get(key) ?? 0) + count);
      return resize(s, count);
    });
}

/** Effective work, unlike the historical denominator, excludes consumed and expired quantities. */
export function activePlanWork(state: AppState, date: string): Session[] {
  if (!state.plan) return [];
  const plan = state.plan;
  const comparisons = new Set(plan.comparisonSessionIds ?? []);
  const basis =
    plan.adjustmentBasis ??
    (plan.progressBaseline
      ? {
          date,
          records: plan.progressBaseline.records,
          sessions: plan.sessions.flatMap((s) => {
            const original = plan.progressBaseline!.sessions[s.id];
            return original ? [{ ...s, ...original }] : [];
          }),
        }
      : undefined);
  const today = new Map(basis ? todayRemainders(state, date, basis).map((s) => [s.id, s]) : []);
  return state.plan.sessions
    .filter(
      (s) =>
        !comparisons.has(s.id) &&
        s.kind === 'study' &&
        s.date >= date &&
        s.date >= (plan.allocationStart ?? date),
    )
    .map((s) => {
      if (s.date === date && basis && date === basis.date) return today.get(s.id) ?? resize(s, 0);
      return s;
    })
    .filter((s) => s.count > 0);
}

/** Future comparison-only study slots consume neither free time nor weekly capacity. */
export function remainingOccupiedSessions(
  state: AppState,
  context: Pick<PlanningContext, 'date' | 'minute'>,
  work = activePlanWork(state, context.date),
): Session[] {
  const active = new Map(work.map((session) => [session.id, session]));
  const comparisons = new Set(state.plan?.comparisonSessionIds ?? []);
  return (state.plan?.sessions ?? []).flatMap((session) => {
    if (comparisons.has(session.id)) return [];
    if (
      session.kind === 'review' ||
      session.date < context.date ||
      (session.date === context.date && session.start < context.minute)
    )
      return [session];
    const effective = active.get(session.id);
    return effective ? [effective] : [];
  });
}

/** Keep comparison data verbatim without passing it back through allocation or capacity. */
export function restoreComparisonSessions(
  plan: Plan,
  comparisons: Session[],
  releasedIds: string[] = [],
): Plan {
  const ids = new Set(comparisons.map((session) => session.id));
  const comparisonSessionIds = [...new Set(releasedIds)].filter((id) => ids.has(id));
  return {
    ...plan,
    ...(comparisonSessionIds.length ? { comparisonSessionIds } : {}),
    sessions: [
      ...plan.sessions.filter((session) => !ids.has(session.id)),
      ...structuredClone(comparisons),
    ].sort(bySlot),
  };
}

/** Capture before editing records. A new day expires yesterday's still-effective work. */
export function prepareAdjustment(state: AppState, context: PlanningContext): AppState {
  const plan = state.plan;
  if (!plan) return state;
  for (const key of Object.keys(plan.adjustmentBasis?.records ?? {})) {
    const parts: unknown = JSON.parse(key);
    if (
      !Array.isArray(parts) ||
      parts.length !== 3 ||
      typeof parts[0] !== 'string' ||
      typeof parts[1] !== 'string' ||
      !Number.isInteger(parts[2])
    )
      throw new Error('調整基準の実績を読み取れません。');
  }
  if (plan.adjustmentBasis?.date === context.date) return state;
  let sessions: Session[];
  let records: Record<string, number>;
  if (plan.adjustmentBasis) {
    sessions = activePlanWork(state, plan.adjustmentBasis.date);
    records = recordTotals(state.records);
  } else if (plan.progressBaseline) {
    sessions = plan.sessions.flatMap((s) => {
      const original = plan.progressBaseline!.sessions[s.id];
      return s.kind === 'study' && original ? [{ ...s, ...original }] : [];
    });
    records = plan.progressBaseline.records;
  } else {
    // Missing reflection provenance is not evidence that stored quantities
    // already include the saved records. Explicit restart establishes a basis.
    return state;
  }
  return {
    ...state,
    plan: {
      ...plan,
      adjustmentBasis: {
        date: context.date,
        records: structuredClone(records),
        sessions: structuredClone(sessions),
      },
    },
  };
}

export function allocateProgress(
  state: AppState,
  context: PlanningContext,
): { plan: Plan; reason: string } {
  requirePlanningInputs(state.settings, context.date);
  validateRevisedSettings(state, state.settings, context.date, context.minute);
  const source = state.plan!;
  const comparisonIds = new Set(source.comparisonSessionIds ?? []);
  const basis = source.adjustmentBasis!;
  const from = [addDays(context.date, 1), source.allocationStart ?? ''].sort().at(-1)!;
  const residual = basisRemainders(state, basis);
  const records = recordTotals(state.records);
  const previousRecords = source.progressBaseline?.records ?? basis.records;
  const unchanged = (session: Session) =>
    totalFor(records, session.materialId, session.round) ===
    totalFor(previousRecords, session.materialId, session.round);
  const budgets: Record<string, number> = {};
  for (const m of state.settings.materials)
    for (const round of m.rounds.keys())
      budgets[workKey(m.id, round)] = remaining(state, m.id, round);
  // Today's unperformed part is still actionable, even after a partial or zero report.
  // Its display denominator remains in the saved day baseline and original session.
  for (const s of todayRemainders(state, context.date, basis)) {
    const key = workKey(s.materialId, s.round);
    budgets[key] = Math.max(0, budgets[key] - s.count);
  }
  const left = { ...budgets };
  const future: Session[] = [];
  // An extension may have merged into a retained session under the same ID.
  // For unchanged work keep that whole allocation, not only its older basis
  // quantity; a report for another material must not redistribute its tail.
  const retained = residual.filter((s) => s.date >= from);
  let capacityReleased = false;
  for (const [index, session] of retained.entries()) {
    if (!unchanged(session)) continue;
    const current = source.sessions.find((s) => s.id === session.id && !comparisonIds.has(s.id));
    if (!current) {
      retained[index] = resize(session, 0);
      continue;
    }
    const overlap = retained.some(
      (other) =>
        other.id !== session.id &&
        other.count > 0 &&
        other.date === current.date &&
        other.start < current.end &&
        current.start < other.end,
    );
    if (overlap && current.fixed) throw new Error(`${current.date}の固定予定の確認が必要です。`);
    if (!overlap) retained[index] = current;
    else capacityReleased = true;
  }
  for (const s of retained) {
    const original = basis.sessions.find((x) => x.id === s.id) ?? s;
    if (s.fixed && s.count !== original.count)
      throw new Error(
        `${s.date}の固定予定（${state.settings.materials.find((m) => m.id === s.materialId)?.name}・${s.round + 1}周目）の残量が変わります。計画全体の見直しで確認してください。`,
      );
    const key = workKey(s.materialId, s.round);
    const count = Math.min(s.count, left[key] ?? 0);
    if (s.fixed && count !== s.count)
      throw new Error(`${s.date}の固定予定が現在の残量を超えています。`);
    if (count > 0) future.push(resize(s, count));
    left[key] -= count;
  }
  // Keep earlier incremental placements too. Restore the original slots first on correction;
  // additions may only occupy the capacity that is still free.
  const originalIds = new Set(basis.sessions.map((s) => s.id));
  for (const s of [...source.sessions]
    .sort(bySlot)
    .filter(
      (s) =>
        s.kind === 'study' && s.date >= from && !originalIds.has(s.id) && !comparisonIds.has(s.id),
    )) {
    const key = workKey(s.materialId, s.round);
    const count = Math.min(s.count, left[key] ?? 0);
    const kept = resize(s, count);
    const overlap = future.some(
      (x) => x.date === kept.date && x.start < kept.end && kept.start < x.end,
    );
    if (s.fixed && (count !== s.count || overlap))
      throw new Error(`${s.date}の固定予定の確認が必要です。`);
    if (count > 0 && !overlap) {
      future.push(kept);
      left[key] -= count;
    }
    if (count > 0 && overlap) capacityReleased = true;
  }
  const occupied = remainingOccupiedSessions(state, context);
  const comparisons = source.sessions.filter((s) => s.date < from || comparisonIds.has(s.id));
  const history = occupied.filter((s) => s.date < from);
  const reviews = source.sessions.filter((s) => s.date >= from && s.kind === 'review');
  const reserved: Record<string, number> = {};
  const unchangedShortfalls = source.shortfalls.flatMap((short) => {
    if (
      totalFor(records, short.materialId, short.round) !==
      totalFor(previousRecords, short.materialId, short.round)
    )
      return [];
    const key = workKey(short.materialId, short.round);
    const count = Math.min(short.count, Math.max(0, (left[key] ?? 0) - (reserved[key] ?? 0)));
    if (!count) return [];
    reserved[key] = (reserved[key] ?? 0) + count;
    return [
      {
        ...short,
        count,
        minutes:
          count *
          state.settings.materials.find((m) => m.id === short.materialId)!.rounds[short.round]
            .minutes,
      },
    ];
  });
  const allocatable = Object.fromEntries(
    Object.entries(budgets).map(([key, value]) => [key, value - (reserved[key] ?? 0)]),
  );
  const precedes = (a: Session | { materialId: string; round: number }, b: Session) => {
    const ma = state.settings.materials.find((m) => m.id === a.materialId);
    const mb = state.settings.materials.find((m) => m.id === b.materialId);
    return (
      ma &&
      mb &&
      ma.examId === mb.examId &&
      (ma.order < mb.order ||
        (ma.order === mb.order && (ma.id < mb.id || (ma.id === mb.id && a.round < b.round))))
    );
  };
  let kept = future;
  let expanded = false;
  let plan: Plan;
  // Reuse balanced allocation only for missing quantities, with real retained slots occupied.
  // If a missing predecessor cannot fit before a kept successor, release just those successors.
  for (;;) {
    plan = generatePlan(state, from, true, 0, 'balanced', context, {
      sessions: [...history, ...reviews, ...kept],
      remaining: allocatable,
      unplaced: reserved,
    });
    for (const short of unchangedShortfalls) {
      const generated = plan.shortfalls.find(
        (s) => s.materialId === short.materialId && s.round === short.round,
      );
      if (generated) {
        generated.reason = `${short.count}問の未配置を保持。今回の追加分：${generated.reason}`;
        generated.count += short.count;
        generated.minutes += short.minutes;
      } else plan.shortfalls.push({ ...short });
    }
    const blocked = kept.filter(
      (s) =>
        plan.shortfalls.some((short) => precedes(short, s)) ||
        fixedOrderIssue(state, s, plan.sessions, from, 0, budgets),
    );
    if (!blocked.length) break;
    if (blocked.some((s) => s.fixed))
      throw new Error(
        '先行する教材・周回を固定予定の前に配置できません。計画全体の見直しで確認してください。',
      );
    const ids = new Set(blocked.map((s) => s.id));
    kept = kept.filter((s) => !ids.has(s.id));
    expanded = true;
  }
  if (plan.conflicts.length) throw new Error(plan.conflicts.join(' '));
  plan = restoreComparisonSessions(plan, comparisons, source.comparisonSessionIds);
  // Preserve IDs for unchanged content, regardless of generation-pass ordering.
  const identity = ({ id: _id, ...s }: Session) =>
    JSON.stringify(Object.entries(s).sort(([a], [b]) => a.localeCompare(b)));
  const ids = new Map(
    source.sessions.filter((s) => !comparisonIds.has(s.id)).map((s) => [identity(s), s.id]),
  );
  plan.sessions = plan.sessions.map((s) =>
    comparisonIds.has(s.id) ? s : { ...s, id: ids.get(identity(s)) ?? s.id },
  );
  plan.from = source.from;
  plan.notBefore = source.notBefore;
  plan.allocationStart = source.allocationStart;
  plan.adjustmentBasis = basis;
  plan.progressBaseline = createProgressBaseline(plan, state.records, from);
  plan.approvedAt = context.timestamp;
  for (const [key, budget] of Object.entries(budgets)) {
    const planned = plan.sessions
      .filter(
        (s) =>
          !comparisonIds.has(s.id) &&
          s.kind === 'study' &&
          s.date >= from &&
          workKey(s.materialId, s.round) === key,
      )
      .reduce((n, s) => n + s.count, 0);
    const unplaced = plan.shortfalls
      .filter((s) => workKey(s.materialId, s.round) === key)
      .reduce((n, s) => n + s.count, 0);
    if (planned + unplaced !== budget)
      throw new Error('予定量と残量が一致しないため、実績のみ保存しました。');
  }
  return {
    plan,
    reason: expanded
      ? '先行する教材・周回の未消化分を配置するため、後続の予定を調整しました。'
      : capacityReleased
        ? '訂正で元の枠を戻すため、重なる追加予定を再配置しました。'
        : residual.some((s) => s.date < context.date && s.count > 0)
          ? '日付を過ぎた未消化分を、既存の予定を残して配分しました。'
          : '同じ教材・周回の実績に合わせて残量を更新しました。',
  };
}
