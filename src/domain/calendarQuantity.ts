import { AppState, Plan, StudyDayBaseline, today } from './model';
import { originalSessionCount } from './progressReflection';

const keyOf = (id: string, round: number, unit: string) => JSON.stringify([id, round, unit]);
export const materialUnit = (unit?: string) => unit?.trim() || '問';
const localDay = (timestamp: string) => {
  const d = new Date(timestamp);
  if (!Number.isFinite(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const covers = (plan: Plan, date: string) =>
  plan.from <= date &&
  (plan.capacities.some((c) => c.date === date) || plan.sessions.some((s) => s.date === date));

function snapshot(state: AppState, plan: Plan, date: string, original: boolean): StudyDayBaseline {
  const rows = new Map<string, StudyDayBaseline['rows'][number]>();
  for (const s of plan.sessions.filter((s) => s.date === date && s.kind === 'study')) {
    const material =
      plan.settingsSnapshot?.materials.find((m) => m.id === s.materialId) ??
      state.settings.materials.find((m) => m.id === s.materialId);
    const unit = materialUnit(material?.unit);
    const key = keyOf(s.materialId, s.round, unit);
    const count = original ? originalSessionCount(plan, s) : s.count;
    const prior = rows.get(key);
    rows.set(key, {
      materialId: s.materialId,
      round: s.round,
      examId: s.examId,
      name: material?.name ?? s.materialId,
      unit,
      count: (prior?.count ?? 0) + count,
    });
  }
  return { planId: plan.id, rows: [...rows.values()] };
}

/** Read approved storage only; proposals never establish a historical denominator. */
export function historicalDayBaseline(state: AppState, date: string): StudyDayBaseline | null {
  const saved = state.studyDayBaselines?.[date];
  if (saved) return saved;
  const plans = [...state.history, ...(state.plan ? [state.plan] : [])];
  const source = plans
    .filter(
      (p) =>
        localDay(p.approvedAt ?? p.createdAt) &&
        localDay(p.approvedAt ?? p.createdAt)! <= date &&
        covers(p, date),
    )
    .at(-1);
  if (source) return snapshot(state, source, date, true);
  // Replanning keeps sessions before `from` verbatim. They are saved historical
  // work, not newly generated work covered by the new plan's approval date.
  const retained = plans.find(
    (p) => date < p.from && p.sessions.some((s) => s.date === date && s.kind === 'study'),
  );
  return retained ? snapshot(state, retained, date, true) : null;
}

/** Called at data-changing boundaries, never while changing a display mode. Undo keeps this archive. */
export function retainStudyDayBaselines(
  state: AppState,
  date: string,
  includeToday = true,
): AppState {
  const saved = { ...state.studyDayBaselines };
  const days = new Set(
    [...state.history, ...(state.plan ? [state.plan] : [])]
      .flatMap((p) => [...p.sessions.map((s) => s.date), ...p.capacities.map((c) => c.date)])
      .filter((d) => d < date),
  );
  for (const day of [...days].sort()) {
    const baseline = historicalDayBaseline(state, day);
    if (baseline && !saved[day]) saved[day] = baseline;
  }
  // Observing the current approved plan today is evidence even for legacy plans.
  if (
    includeToday &&
    !saved[date] &&
    state.plan &&
    (covers(state.plan, date) || state.plan.sessions.some((s) => s.date === date))
  )
    saved[date] = snapshot(state, state.plan, date, true);
  return { ...state, studyDayBaselines: saved };
}

export interface QuantityRow {
  materialId: string;
  round: number;
  examId: string;
  name: string;
  unit: string;
  planned: number | null;
  actual: number;
  reported: boolean;
  remainder: number | null;
}
export interface QuantityTotal {
  unit: string;
  planned: number | null;
  actual: number;
  reported: boolean;
  partial: boolean;
  remainder: number | null;
  shortage: number | null;
}
/** Historical shortage is confirmed only by an actual report, including an explicit zero. */
export const recordedShortage = (row: Pick<QuantityRow, 'planned' | 'actual' | 'reported'>) =>
  row.planned === null ? null : row.reported ? Math.max(0, row.planned - row.actual) : 0;
export function calendarQuantity(
  state: AppState,
  date: string,
  reference = today(),
  filter = 'all',
) {
  const past = date < reference;
  const baseline = past
    ? historicalDayBaseline(state, date)
    : date === reference && state.studyDayBaselines?.[date]
      ? state.studyDayBaselines[date]
      : state.plan && (covers(state.plan, date) || state.plan.sessions.some((s) => s.date === date))
        ? snapshot(state, state.plan, date, date === reference)
        : null;
  const rows = new Map<string, QuantityRow>();
  const sourceRows =
    baseline?.rows ?? (state.plan ? snapshot(state, state.plan, date, false).rows : []);
  for (const row of sourceRows) {
    if (filter !== 'all' && row.examId !== filter) continue;
    rows.set(keyOf(row.materialId, row.round, row.unit), {
      ...row,
      planned: baseline ? row.count : null,
      actual: 0,
      reported: false,
      remainder: baseline ? row.count : null,
    });
  }
  for (const record of state.records.filter((r) => !r.cancelled && r.date === date)) {
    const m = state.settings.materials.find((m) => m.id === record.materialId);
    const matched = [...rows.values()].find(
      (r) => r.materialId === record.materialId && r.round === record.round,
    );
    const examId = matched?.examId ?? m?.examId ?? '';
    if (filter !== 'all' && examId !== filter) continue;
    const unit = matched?.unit ?? materialUnit(m?.unit);
    const key = keyOf(record.materialId, record.round, unit);
    const row = rows.get(key) ?? {
      materialId: record.materialId,
      round: record.round,
      examId,
      name: m?.name ?? record.materialId,
      unit,
      planned: baseline ? 0 : null,
      actual: 0,
      reported: false,
      remainder: baseline ? 0 : null,
    };
    row.actual += record.count;
    row.reported = true;
    rows.set(key, row);
  }
  const totals = new Map<string, QuantityTotal>();
  for (const row of rows.values()) {
    row.remainder = row.planned === null ? null : Math.max(0, row.planned - row.actual);
    const total = totals.get(row.unit) ?? {
      unit: row.unit,
      planned: baseline ? 0 : null,
      actual: 0,
      reported: false,
      partial: false,
      remainder: baseline ? 0 : null,
      shortage: baseline ? 0 : null,
    };
    if (total.planned !== null) total.planned += row.planned ?? 0;
    if (total.remainder !== null) total.remainder += row.remainder ?? 0;
    if (total.shortage !== null) total.shortage += recordedShortage(row) ?? 0;
    total.actual += row.actual;
    total.reported ||= row.reported;
    total.partial ||= !row.reported && (row.planned === null || row.planned > 0);
    totals.set(row.unit, total);
  }
  return { date, past, known: !!baseline, rows: [...rows.values()], totals: [...totals.values()] };
}
