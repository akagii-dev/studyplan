import { AppState, Progress, addDays, Plan } from './model';
import { stalePlan } from './planAudit';
import { recordProgress, correctProgress } from './progress';
import { createProgressBaseline } from './progressReflection';
import { PlanningContext } from './planner/context';
import { approve, propose } from './planner/proposal';

export interface ProgressAdjustmentResult {
  recordId: string;
  status: 'applied' | 'review' | 'recorded';
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
    const result: ProgressAdjustmentResult = {
      recordId,
      status: 'applied',
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
      status: 'review',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

export function recordAndAdjust(state: AppState, entry: Progress, context: PlanningContext) {
  const recorded = recordProgress(state, entry);
  if (recorded === state) return state;
  return adjustAfterProgress(recorded, entry.id, context);
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
  return adjustAfterProgress(correctProgress(state, id, count, cancelled, context.timestamp), id, context);
}

export function currentProgressAdjustment(state: AppState) {
  return state.draft.progressAdjustment as ProgressAdjustmentResult | undefined;
}
