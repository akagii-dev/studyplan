import { AppState, type Plan, today } from './model';

/** Preserved comparison slots are neither scheduled work nor occupied capacity. */
export function nonComparisonSessions(plan: Plan | null | undefined) {
  const ids = new Set(plan?.comparisonSessionIds ?? []);
  return (plan?.sessions ?? []).filter((session) => !ids.has(session.id));
}

/** A restart archives older dates for ordinary schedule views, never for stored comparisons. */
export function isArchivedPlanDate(state: AppState, date: string, reference = today()): boolean {
  const start = state.plan?.allocationStart;
  return start !== undefined && date < reference && date < start;
}

/** The approved restart that set the current allocation start, if any. */
function restartBoundaryPlan(state: AppState) {
  const start = state.plan?.allocationStart;
  return start === undefined ? undefined :
    [...state.history, ...(state.plan ? [state.plan] : [])].reverse()
      .find((plan) => plan.allocationStart === start && plan.from === start);
}

/** A restart from today kept today's passed slots, so its start day reads as an ordinary day. */
export const restartKeepsToday = (state: AppState) =>
  !!(state.plan?.keepsTodayBeforeStart || restartBoundaryPlan(state)?.keepsTodayBeforeStart);

/** Keep historical/fixed/review sessions in storage while displaying the approved restart boundary. */
export function displayPlanSessions(state: AppState, reference = today()) {
  const start = state.plan?.allocationStart;
  const boundaryPlan = restartBoundaryPlan(state);
  const minute = boundaryPlan?.keepsTodayBeforeStart ? 0 : boundaryPlan?.notBefore ?? 0;
  return nonComparisonSessions(state.plan).filter(
    (session) => !isArchivedPlanDate(state, session.date, reference) &&
      !(session.date === start && session.start < minute),
  );
}
