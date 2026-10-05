import { calendarDisplayQuantity } from './calendarQuantity';
import { displayPlanSessions } from './planDisplay';
import { progressView } from './progressView';
import { AppState, today } from './model';

/** Today input rows require planned work; actual-only rows remain in shared totals/history. */
export function todayStudyRows(state: AppState, date = today()) {
  const planned = new Set(displayPlanSessions(state, date)
    .filter(session => session.date === date && session.kind === 'study')
    .map(session => JSON.stringify([session.materialId, session.round])));
  return calendarDisplayQuantity(state, date, date)
    .rows.filter(row => planned.has(JSON.stringify([row.materialId, row.round])) ||
      (row.planned ?? 0) > 0 || (row.currentRemaining ?? 0) > 0)
    .map((row) => ({
      ...row,
      materialName: row.name,
      progress: progressView(row, date, date),
    }));
}
