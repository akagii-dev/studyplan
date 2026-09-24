import { AppState, Progress, addDays, Plan } from './model';
import { retainStudyDayBaselines } from './calendarQuantity';
import { stalePlan } from './planAudit';
import { recordProgress, correctProgress } from './progress';
import { createProgressBaseline } from './progressReflection';
import { PlanningContext } from './planner/context';
import { approve, propose } from './planner/proposal';
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

function plannedWork(plan: Plan) {
  return JSON.stringify({
    sessions: plan.sessions.map(({ id: _id, ...session }) => session),
    shortfalls: plan.shortfalls,
    conflicts: plan.conflicts,
  });
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
    let candidate = propose(changed, from, '実績から残りの予定を調整', context);
    // Past and today are immutable plan history, including legacy zero-count sessions.
    // The general generator may normalize such sessions, so restore them here exactly.
    candidate = {
      ...candidate,
      proposal: {
        ...candidate.proposal!,
        plan: {
          ...candidate.proposal!.plan,
          sessions: [
            ...changed.plan.sessions.filter((session) => session.date < from),
            ...candidate.proposal!.plan.sessions.filter((session) => session.date >= from),
          ],
        },
      },
    };
    // Explicit user authorization for automatic adjustment covers still-unreported work.
    // No report is fabricated: remaining() continues to derive only from saved records.
    const approved = approve(candidate, true, context);
    approved.draft = { ...approved.draft, revision: changed.draft.revision };
    const plan = approved.plan!;
    const changes = planChanges(changed.plan, plan, from);
    const result: ProgressAdjustmentResult = {
      recordId,
      status: plan.shortfalls.length ? 'unplaced' : changes.length ? 'applied' : 'unchanged',
      unplacedCount: plan.shortfalls.reduce((sum, item) => sum + item.count, 0),
      unplacedMinutes: plan.shortfalls.reduce((sum, item) => sum + item.minutes, 0),
    };
    if (changed.plan && plannedWork(changed.plan) === plannedWork(plan)) {
      // Refresh the incorporated record basis without creating an identical plan revision.
      return withResult(
        {
          ...changed,
          plan: {
            ...changed.plan,
            progressBaseline: createProgressBaseline(changed.plan, changed.records),
          },
        },
        result,
      );
    }
    return withResult(approved, result);
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
      { ...recorded, studyDayBaselines: retained.studyDayBaselines },
      entry.id,
      context,
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
      { ...corrected, studyDayBaselines: retained.studyDayBaselines },
      id,
      context,
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
