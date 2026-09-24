import { AppState, Progress, addDays } from './model';
import { retainStudyDayBaselines } from './calendarQuantity';
import { stalePlan } from './planAudit';
import { recordProgress, correctProgress } from './progress';
import { PlanningContext } from './planner/context';
import { allocateProgress, prepareAdjustment } from './progressAllocation';
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

function withResult(state: AppState, result: ProgressAdjustmentResult): AppState {
  return {
    ...state,
    draft: { ...state.draft, progressResult: undefined, progressAdjustment: result },
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
    return withResult({ ...changed, plan, history: [...changed.history, changed.plan] }, result);
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
