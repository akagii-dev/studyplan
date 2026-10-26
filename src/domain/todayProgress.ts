import { calendarDisplayQuantity } from './calendarQuantity';
import { displayPlanSessions } from './planDisplay';
import { studyProgressView } from './studyProgress';
import { AppState, DateKey, today } from './model';

/** A planned row of one day that the user chose to cover with extra work done on other rows that day. */
export interface DayOffset {
  materialId: string;
  round: number;
}

const sameRow = (a: DayOffset, b: DayOffset) => a.materialId === b.materialId && a.round === b.round;

/**
 * Today input rows require planned work; actual-only rows remain in shared totals/history.
 * Offsets are a game UI choice: the Fresh UI passes `offsets = false` and shows plain progress.
 */
export function todayStudyRows(state: AppState, date = today(), offsets = true) {
  const planned = new Set(displayPlanSessions(state, date)
    .filter(session => session.date === date && session.kind === 'study')
    .map(session => JSON.stringify([session.materialId, session.round])));
  const rows = calendarDisplayQuantity(state, date, date)
    .rows.filter(row => planned.has(JSON.stringify([row.materialId, row.round])) ||
      (row.planned ?? 0) > 0 || (row.currentRemaining ?? 0) > 0)
    .map((row) => ({
      ...row,
      materialName: row.name,
      progress: studyProgressView(state, row, date, date),
    }));
  return applyOffsets(rows, offsets ? state.dayOffsets?.[date] ?? [] : []);
}

/**
 * Extra work beyond a cleared row's target may cover another row's shortfall of the same unit, only
 * where the user chose so. It changes the day's clear only: records, remaining amounts and the plan
 * stay as they are, so the covered work is still owed.
 */
export function applyOffsets<Row extends { materialId: string; round: number; unit: string; progress: ReturnType<typeof studyProgressView> }>(
  rows: Row[], chosen: DayOffset[],
) {
  const pool = new Map<string, number>();
  for (const row of rows) {
    const { complete, recorded, target } = row.progress;
    if (complete && target !== null && recorded > target)
      pool.set(row.unit, (pool.get(row.unit) ?? 0) + recorded - target);
  }
  const covered = new Map<Row, number>();
  for (const choice of chosen) {
    const row = rows.find((r) => sameRow(r, choice));
    const left = row && !row.progress.complete ? row.progress.left ?? 0 : 0;
    if (!row || left <= 0 || (pool.get(row.unit) ?? 0) < left) continue;
    pool.set(row.unit, pool.get(row.unit)! - left);
    covered.set(row, left);
  }
  return rows.map((row) => {
    const offset = covered.get(row);
    const left = row.progress.left ?? 0;
    const offsetChosen = chosen.some((c) => sameRow(c, row));
    // The surplus left after the chosen offsets, which could still cover this row.
    const offsetAvailable = !row.progress.complete && !offsetChosen && left > 0 && (pool.get(row.unit) ?? 0) >= left;
    if (offset === undefined) return { ...row, offset: 0, offsetChosen, offsetAvailable };
    return { ...row, offset, offsetChosen, offsetAvailable: false,
      progress: { ...row.progress, complete: true, text: '相殺でクリア', supplement: `ほかの追加分${offset}${row.unit}` } };
  });
}

/** Chooses, or stops choosing, to cover a row's shortfall on `date` with that day's extra work. */
export function setDayOffset(state: AppState, date: DateKey, row: DayOffset, on: boolean): AppState {
  const current = (state.dayOffsets?.[date] ?? []).filter((c) => !sameRow(c, row));
  const next = on ? [...current, { materialId: row.materialId, round: row.round }] : current;
  const { [date]: _, ...others } = state.dayOffsets ?? {};
  const dayOffsets = next.length ? { ...others, [date]: next } : others;
  return { ...state, dayOffsets: Object.keys(dayOffsets).length ? dayOffsets : undefined };
}
