import { AppState, Session, completed, remaining } from './model';
import { materialUnit } from './calendarQuantity';
import { activePlanWork, workKey } from './progressAllocation';
import { isElapsedRemainingSession, remainingSourceIssue, remainingBasisIssue, remainingSessionIssue, remainingAdjustmentSourceDate } from './remainingAllocation';
import { stalePlan } from './planAudit';
import { currentPlanningStatus } from './progressAdjustment';

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
  /** Executable destinations only; invalid stored slots are kept separately for review. */
  placements: Session[];
  pendingPlacements: Session[];
  pending: number;
  unavailable: { session: Session; reason: string; clockOnly: boolean }[];
  executable: number;
  reasons: string[];
  unplacedReasons: string[];
  needsReview: boolean;
}

/** Current quantities only. Historical shortages are comparisons, not new work. */
export function remainingWork(state: AppState, date: string, minute = 0): RemainingWorkRow[] {
  const sessions = activePlanWork(state, date);
  const allocated = new Map<string, number>();
  for (const session of sessions) {
    const key = workKey(session.materialId, session.round);
    allocated.set(key, (allocated.get(key) ?? 0) + session.count);
  }
  const basisIssue = remainingBasisIssue(state);
  const status = currentPlanningStatus(state);
  return state.settings.materials.flatMap((m) =>
    m.rounds.map((_, round) => {
      const count = allocated.get(workKey(m.id, round)) ?? 0;
      const unplaced = (state.plan?.shortfalls ?? [])
        .filter((s) => s.materialId === m.id && s.round === round)
        .reduce((sum, s) => sum + s.count, 0);
      const left = remaining(state, m.id, round);
      const matching = sessions.filter((s) => s.materialId === m.id && s.round === round);
      const reasons: string[] = [];
      if (basisIssue) reasons.push(basisIssue);
      if (state.plan && stalePlan(state.plan, state.settings))
        reasons.push('確定計画と現在の条件が一致していません。');
      if (status?.status === 'blocked')
        reasons.push(status.detail ?? '予定調整が反映されていません。');
      if (left !== count + unplaced)
        reasons.push(
          '記録上の残量と配置の内訳が一致していません。差分は未配置として確定していません。',
        );
      const placements: Session[] = [];
      const pendingPlacements: Session[] = [];
      const unavailable: RemainingWorkRow['unavailable'] = [];
      for (const session of matching) {
        const sourceIssue = remainingSourceIssue(state, session, { date, minute }, sessions);
        if (!reasons.length && !sourceIssue && !session.fixed && isElapsedRemainingSession(session, { date, minute })) {
          pendingPlacements.push(session);
          continue;
        }
        const issue = sourceIssue ?? remainingSessionIssue(state, session, { date, minute }, sessions);
        if (issue || reasons.length) unavailable.push({ session, reason: issue ?? reasons[0],
          clockOnly: !reasons.length && !sourceIssue && isElapsedRemainingSession(session, { date, minute }) });
        else placements.push(session);
      }
      const unplacedReasons = (state.plan?.shortfalls ?? [])
        .filter((s) => s.materialId === m.id && s.round === round && s.count > 0)
        .map((s) => s.reason);
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
        placements,
        pendingPlacements,
        pending: pendingPlacements.reduce((sum, session) => sum + session.count, 0),
        unavailable,
        executable: placements.reduce((sum, session) => sum + session.count, 0),
        reasons: [...new Set(reasons)],
        unplacedReasons: [...new Set(unplacedReasons)],
        needsReview: reasons.length > 0 || unavailable.length > 0,
      };
    }),
  );
}

/** Target quantities in a partial proposal, excluding the unrelated slots that it retains. */
export function remainingAdjustmentPreview(state: AppState) {
  const basis = state.proposal?.basis;
  if (basis?.kind !== 'remaining-adjustment') return undefined;
  const plan = state.proposal!.plan;
  const candidate = { ...state, plan };
  const work = activePlanWork(candidate, basis.date);
  const previousWork = activePlanWork(state, remainingAdjustmentSourceDate(state, basis.date));
  const byTime = (a: Session, b: Session) =>
    a.date.localeCompare(b.date) || a.start - b.start || a.id.localeCompare(b.id);
  const portion = (session: Session, count: number, offset = 0): Session => {
    const perUnit = (session.end - session.start) / session.count;
    return {
      ...session,
      count,
      start: session.start + offset * perUnit,
      end: session.start + (offset + count) * perUnit,
    };
  };
  const rows = basis.summary.map((target) => {
    const material = state.settings.materials.find((m) => m.id === target.materialId);
    const unrelated = new Set(
      (state.plan?.sessions ?? [])
        .filter(
          (s) => !target.sessionIds.includes(s.id) && !basis.affectedSessionIds.includes(s.id),
        )
        .map((s) => s.id),
    );
    const candidates = work
      .filter(
        (s) =>
          s.materialId === target.materialId && s.round === target.round && !unrelated.has(s.id),
      )
      .sort(
        (a, b) =>
          Number(target.sessionIds.includes(b.id)) - Number(target.sessionIds.includes(a.id)) ||
          byTime(a, b),
      );
    const relatedCount = previousWork
      .filter(
        (s) =>
          s.materialId === target.materialId &&
          s.round === target.round &&
          basis.affectedSessionIds.includes(s.id),
      )
      .reduce((sum, s) => sum + s.count, 0);
    const destinations: Session[] = [];
    const relatedDestinations: Session[] = [];
    let targetLeft = target.count;
    for (const session of candidates) {
      const take = Math.min(session.count, targetLeft);
      if (take > 0) destinations.push(portion(session, take));
      if (take < session.count)
        relatedDestinations.push(portion(session, session.count - take, take));
      targetLeft -= take;
    }
    destinations.sort(byTime);
    relatedDestinations.sort(byTime);
    const placed = destinations.reduce((sum, s) => sum + s.count, 0);
    const shortfalls = plan.shortfalls.filter(
      (s) => s.materialId === target.materialId && s.round === target.round,
    );
    const retainedUnplaced = target.includeUnplaced
      ? 0
      : (state.plan?.shortfalls ?? [])
          .filter((s) => s.materialId === target.materialId && s.round === target.round)
          .reduce((sum, s) => sum + s.count, 0);
    const availableUnplaced = shortfalls.reduce((sum, s) => sum + s.count, 0) - retainedUnplaced;
    const unplaced = Math.min(targetLeft, Math.max(0, availableUnplaced));
    const relatedUnplaced = availableUnplaced - unplaced;
    const combinedPlaced = candidates.reduce((sum, s) => sum + s.count, 0);
    return {
      ...target,
      name: material?.name ?? target.materialId,
      unit: materialUnit(material?.unit),
      destinations,
      placed,
      unplaced,
      reasons: shortfalls.map((s) => s.reason),
      relatedCount,
      relatedDestinations,
      relatedUnplaced,
      balanced:
        availableUnplaced >= 0 &&
        target.count === placed + unplaced &&
        combinedPlaced + availableUnplaced === target.count + relatedCount,
    };
  });
  return {
    rows,
    affected: previousWork.filter((s) => basis.affectedSessionIds.includes(s.id)),
  };
}
