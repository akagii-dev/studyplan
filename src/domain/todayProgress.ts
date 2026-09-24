import { calendarQuantity } from './calendarQuantity';
import { progressView } from './progressView';
import { AppState, today } from './model';

/** Shared daily quantities; no second interpretation of the current plan. */
export function todayStudyRows(state: AppState, date = today()) {
  return calendarQuantity(state, date, date).rows.map((row) => ({
    ...row,
    materialName: row.name,
    progress: progressView(row, date, date),
  }));
}
