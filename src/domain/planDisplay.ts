import { AppState, today } from './model';

/** A restart archives older dates for ordinary schedule views, never for stored comparisons. */
export function isArchivedPlanDate(state: AppState, date: string, reference = today()): boolean {
  const start = state.plan?.allocationStart;
  return start !== undefined && date < reference && date < start;
}

/** Keep historical/fixed/review sessions in storage while displaying the approved restart boundary. */
export function displayPlanSessions(state: AppState, reference = today()) {
  const start = state.plan?.allocationStart;
  const boundaryPlan = start === undefined ? undefined :
    [...state.history, ...(state.plan ? [state.plan] : [])].reverse()
      .find((plan) => plan.allocationStart === start && plan.from === start);
  const minute = boundaryPlan?.notBefore ?? 0;
  return (state.plan?.sessions ?? []).filter(
    (session) => !isArchivedPlanDate(state, session.date, reference) &&
      !(session.date === start && session.start < minute),
  );
}
