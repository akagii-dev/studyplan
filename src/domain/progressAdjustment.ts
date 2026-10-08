import { AppState, Progress, addDays } from './model';
import { retainStudyDayBaselines } from './calendarQuantity';
import { compactHistory } from './planHistory';
import { stalePlan } from './planAudit';
import { recordProgress, correctProgress } from './progress';
import { PlanningContext } from './planner/context';
import { allocateProgress, prepareAdjustment } from './progressAllocation';
import { samePlanningSettings } from './planAudit';
import {
  AdjustmentStatus,
  ProgressAction,
  appendProgressReceipt,
  planChanges,
} from './progressReceipt';

export interface ProgressAdjustmentResult {
  recordId: string;
  status: AdjustmentStatus;
  detail?: string;
  unplacedCount?: number;
  unplacedMinutes?: number;
}

export interface PlanReconciliation {
  asOf: string;
  status: 'applied' | 'unplaced' | 'blocked';
  reason?: 'pending-proposal' | 'stale-settings' | 'legacy-unknown' | 'fixed-conflict' | 'failed';
  detail?: string;
}

export function currentPlanReconciliation(state: AppState): PlanReconciliation | undefined {
  return state.draft.planReconciliation as PlanReconciliation | undefined;
}

/** Shared durable state for the future-plan surface. Receipts remain immutable history. */
export function currentPlanningStatus(state: AppState): PlanReconciliation | undefined {
  const reconciliation = currentPlanReconciliation(state);
  if (reconciliation) return reconciliation;
  const progress = currentProgressAdjustment(state);
  if (progress?.status === 'review')
    return {
      asOf: state.plan?.adjustmentBasis?.date ?? '',
      status: 'blocked',
      reason: state.proposal ? 'pending-proposal' : stalePlan(state.plan!, state.settings)
        ? 'stale-settings' : 'legacy-unknown',
      detail: progress.detail,
    };
  if (progress?.status === 'failed')
    return {
      asOf: state.plan?.adjustmentBasis?.date ?? '',
      status: 'blocked',
      reason: progress.detail?.includes('固定') ? 'fixed-conflict' : 'failed',
      detail: progress.detail,
    };
  if (progress?.status === 'unplaced')
    return {
      asOf: state.plan?.adjustmentBasis?.date ?? '',
      status: 'unplaced',
    };
  return undefined;
}

function withReconciliation(state: AppState, result: PlanReconciliation): AppState {
  const previous = currentPlanReconciliation(state);
  if (JSON.stringify(previous) === JSON.stringify(result)) return state;
  return { ...state, draft: { ...state.draft, planReconciliation: result } };
}

/** An explicit load, recovery or date boundary. Never invents a progress record. */
export function reconcilePlanning(state: AppState, context: PlanningContext): AppState {
  const source = state.plan;
  if (!source) return state;
  const basisDate = source.adjustmentBasis?.date;
  const expired = source.sessions.some((s) => s.kind === 'study' && s.count > 0 && s.date < context.date);
  const pendingProgress = ['review', 'failed'].includes(currentProgressAdjustment(state)?.status ?? '');
  if ((!basisDate || basisDate >= context.date) && !expired && !pendingProgress) return state;
  if (basisDate === context.date && !pendingProgress) return state;
  const blocked = (reason: NonNullable<PlanReconciliation['reason']>, detail: string) =>
    withReconciliation(state, { asOf: context.date, status: 'blocked', reason, detail });
  if (state.proposal)
    return blocked('pending-proposal', '確認待ちの計画案があります。');
  if (!source.settingsSnapshot || !samePlanningSettings(source.settingsSnapshot, state.settings))
    return blocked('stale-settings', '計画と現在の設定が一致していません。');
  if (!source.adjustmentBasis && !source.progressBaseline)
    return blocked('legacy-unknown', '旧計画への実績の反映状況を確認できません。');
  try {
    const prepared = prepareAdjustment(state, context);
    if (!prepared.plan?.adjustmentBasis || prepared.plan.adjustmentBasis.date !== context.date)
      return blocked('legacy-unknown', '旧計画への実績の反映状況を確認できません。');
    const { plan, reason } = allocateProgress(prepared, context);
    const from = addDays(context.date, 1);
    const changes = planChanges(source, plan, from);
    const quantities = (items: typeof plan.shortfalls) => JSON.stringify(items
      .map(({ materialId, round, count, minutes }) => [materialId, round, count, minutes])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    const shortfallsChanged = quantities(source.shortfalls) !== quantities(plan.shortfalls);
    const conflictsChanged = JSON.stringify(source.conflicts) !== JSON.stringify(plan.conflicts);
    const hasChange = !!changes.length || shortfallsChanged || conflictsChanged;
    const retained = retainStudyDayBaselines(state, context.date, false);
    const next = compactHistory({
      ...retained,
      plan: hasChange
        ? plan
        : { ...source, shortfalls: plan.shortfalls, adjustmentBasis: plan.adjustmentBasis, progressBaseline: plan.progressBaseline },
      history: hasChange ? [...state.history, source] : state.history,
      draft: pendingProgress
        ? { ...state.draft, progressAdjustment: undefined }
        : state.draft,
    }, context.date);
    if (!hasChange && currentPlanReconciliation(state)?.status !== 'blocked') return next;
    return withReconciliation(next, {
      asOf: context.date,
      status: plan.shortfalls.length ? 'unplaced' : 'applied',
      detail: hasChange ? reason : '現在の残量を確認しました。',
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return blocked(detail.includes('固定') ? 'fixed-conflict' : 'failed', detail);
  }
}

function withResult(state: AppState, result: ProgressAdjustmentResult): AppState {
  return {
    ...state,
    draft: {
      ...state.draft,
      progressResult: undefined,
      progressAdjustment: result,
      planReconciliation: undefined,
    },
  };
}

/** A saved report is the source of truth. Replanning may fail without rolling the report back. */
export function adjustAfterProgress(
  changed: AppState,
  recordId: string,
  context: PlanningContext,
  beforeProgress: AppState = changed,
): AppState {
  if (!changed.plan) return withResult(changed, { recordId, status: 'recorded' });
  if (changed.proposal)
    return withResult(changed, {
      recordId,
      status: 'review',
      detail: '確認待ちの計画案があります。',
    });
  if (stalePlan(changed.plan, changed.settings))
    return withResult(changed, {
      recordId,
      status: 'review',
      detail: '計画と現在の設定が一致していません。',
    });

  try {
    const from = addDays(context.date, 1);
    const prepared = { ...changed, plan: prepareAdjustment(beforeProgress, context).plan };
    if (!prepared.plan?.adjustmentBasis)
      return withResult(changed, {
        recordId,
        status: 'review',
        detail:
          '旧計画への実績の反映状況を確認できません。計画全体の見直しで現在の残量を確認してください。',
      });
    const { plan, reason } = allocateProgress(prepared, context);
    const changes = planChanges(changed.plan, plan, from);
    const result: ProgressAdjustmentResult = {
      recordId,
      status: plan.shortfalls.length ? 'unplaced' : changes.length ? 'applied' : 'unchanged',
      unplacedCount: plan.shortfalls.reduce((sum, item) => sum + item.count, 0),
      unplacedMinutes: plan.shortfalls.reduce((sum, item) => sum + item.minutes, 0),
      ...(changes.length ? { detail: reason } : {}),
    };
    const sortedShortfalls = (items: typeof plan.shortfalls) =>
      [...items].sort((a, b) => a.materialId.localeCompare(b.materialId) || a.round - b.round);
    if (
      !changes.length &&
      JSON.stringify(sortedShortfalls(changed.plan.shortfalls)) ===
        JSON.stringify(sortedShortfalls(plan.shortfalls)) &&
      JSON.stringify(changed.plan.conflicts) === JSON.stringify(plan.conflicts)
    ) {
      return withResult(
        {
          ...changed,
          plan: {
            ...changed.plan,
            progressBaseline: plan.progressBaseline,
            adjustmentBasis: plan.adjustmentBasis,
          },
        },
        result,
      );
    }
    return withResult(
      compactHistory({ ...changed, plan, history: [...changed.history, changed.plan] }, context.date),
      result,
    );
  } catch (error) {
    return withResult(changed, {
      recordId,
      status: 'failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function withReceipt(
  before: AppState,
  after: AppState,
  recordId: string,
  action: ProgressAction,
  timestamp: string,
  beforeCount: number | null,
  afterCount: number | null,
  date: string,
  materialId: string,
  round: number,
  context: PlanningContext,
) {
  const result = currentProgressAdjustment(after);
  return appendProgressReceipt(after, {
    recordId,
    action,
    timestamp,
    date,
    materialId,
    round,
    beforeCount,
    afterCount,
    status: result?.status ?? 'recorded',
    detail: result?.detail,
    changes: planChanges(before.plan, after.plan, addDays(context.date, 1)),
    shortfalls: structuredClone(after.plan?.shortfalls ?? []),
    futureFrom: addDays(context.date, 1),
  });
}

export function recordAndAdjust(state: AppState, entry: Progress, context: PlanningContext) {
  const recorded = recordProgress(state, entry);
  if (recorded === state) return state;
  const retained = retainStudyDayBaselines(state, context.date);
  return withReceipt(
    state,
    adjustAfterProgress(
      {
        ...recorded,
        studyDayBaselines: retained.studyDayBaselines,
      },
      entry.id,
      context,
      state,
    ),
    entry.id,
    'record',
    entry.updatedAt,
    null,
    entry.count,
    entry.date,
    entry.materialId,
    entry.round,
    context,
  );
}

export function correctAndAdjust(
  state: AppState,
  id: string,
  count: number,
  cancelled: boolean,
  context: PlanningContext,
) {
  const old = state.records.find((record) => record.id === id);
  if (old && old.count === count && old.cancelled === cancelled) return state;
  const corrected = correctProgress(state, id, count, cancelled, context.timestamp);
  const record = corrected.records.find((item) => item.id === id)!;
  const retained = retainStudyDayBaselines(state, context.date);
  return withReceipt(
    state,
    adjustAfterProgress(
      {
        ...corrected,
        studyDayBaselines: retained.studyDayBaselines,
      },
      id,
      context,
      state,
    ),
    id,
    cancelled ? 'cancel' : 'correct',
    context.timestamp,
    old?.cancelled ? null : (old?.count ?? null),
    cancelled ? null : count,
    record.date,
    record.materialId,
    record.round,
    context,
  );
}

export function currentProgressAdjustment(state: AppState) {
  return state.draft.progressAdjustment as ProgressAdjustmentResult | undefined;
}
