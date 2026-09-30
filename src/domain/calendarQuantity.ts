import { AppState, Plan, StudyDayBaseline, today } from './model';
import { originalSessionCount, proposalUsesCurrentProgress } from './progressReflection';
import { activePlanWork, workKey } from './progressAllocation';
import { displayPlanSessions, isArchivedPlanDate } from './planDisplay';
import { samePlanningSettings } from './planAudit';
import { assertRemainingBalance, remainingBasisIssue } from './remainingAllocation';

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
  /** Current actionable work after a restart; distinct from the comparison denominator. */
  currentRemaining?: number;
  /** Display-only start-day allocation. Records before the restart are not its denominator. */
  restartPlanned?: number;
  /** Display-only evidence that this historical remainder is included in the approved allocation. */
  adjustment?: 'applied' | 'unplaced';
}
export interface QuantityTotal {
  unit: string;
  planned: number | null;
  actual: number;
  reported: boolean;
  partial: boolean;
  remainder: number | null;
  shortage: number | null;
  currentRemaining?: number;
  restartPlanned?: number;
  adjustment?: QuantityRow['adjustment'];
}
/** Historical shortage is confirmed only by an actual report, including an explicit zero. */
export const recordedShortage = (row: Pick<QuantityRow, 'planned' | 'actual' | 'reported'>) =>
  row.planned === null ? null : row.reported ? Math.max(0, row.planned - row.actual) : 0;

// Immutable state snapshots share the same balance check across all calendar days.
const adjustmentCache = new WeakMap<AppState, {
  plan: Plan;
  settings: AppState['settings'];
  records: AppState['records'];
  boundary: string;
  tasks?: Map<string, NonNullable<QuantityRow['adjustment']>>;
}>();

/** A draft, an old record snapshot, or a failed allocation cannot settle a historical remainder. */
function historicalAdjustments(state: AppState, date: string) {
  const plan = state.plan;
  const reconciliation = state.draft.planReconciliation as { status?: string } | undefined;
  const progress = state.draft.progressAdjustment as { status?: string } | undefined;
  if (!plan || reconciliation?.status === 'blocked' ||
    progress?.status === 'review' || progress?.status === 'failed' ||
    !plan.settingsSnapshot || !samePlanningSettings(plan.settingsSnapshot, state.settings) || remainingBasisIssue(state) ||
    !proposalUsesCurrentProgress(plan, state.records)) return undefined;
  const boundary = plan.adjustmentBasis?.date ?? plan.from;
  if (date >= boundary) return undefined;
  const cached = adjustmentCache.get(state);
  if (cached?.plan === plan && cached.settings === state.settings &&
    cached.records === state.records && cached.boundary === boundary) return cached.tasks;
  let tasks: Map<string, NonNullable<QuantityRow['adjustment']>> | undefined;
  try {
    assertRemainingBalance(state, boundary);
    tasks = new Map(state.settings.materials.flatMap((material) => material.rounds.map((_, round) => [
      workKey(material.id, round),
      plan.shortfalls.some((item) => item.materialId === material.id && item.round === round && item.count > 0)
        ? 'unplaced' as const : 'applied' as const,
    ] as const)));
  } catch {
    // An inconsistent snapshot is not evidence of a completed adjustment.
  }
  adjustmentCache.set(state, { plan, settings: state.settings, records: state.records, boundary, tasks });
  return tasks;
}

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
  const currentRemaining =
    date === reference && state.plan?.allocationStart !== undefined
      ? new Map<string, number>()
      : undefined;
  if (currentRemaining) {
    for (const session of activePlanWork(state, reference).filter((s) => s.date === date)) {
      if (filter !== 'all' && session.examId !== filter) continue;
      const key = workKey(session.materialId, session.round);
      currentRemaining.set(key, (currentRemaining.get(key) ?? 0) + session.count);
      if (
        [...rows.values()].some(
          (r) => r.materialId === session.materialId && r.round === session.round,
        )
      )
        continue;
      const m = state.settings.materials.find((m) => m.id === session.materialId);
      const unit = materialUnit(m?.unit);
      // A newly allocated task had no historical target that day. Keep that
      // comparison value independent from the new amount of actionable work.
      rows.set(keyOf(session.materialId, session.round, unit), {
        materialId: session.materialId,
        round: session.round,
        examId: session.examId,
        name: m?.name ?? session.materialId,
        unit,
        planned: baseline ? 0 : null,
        actual: 0,
        reported: false,
        remainder: baseline ? 0 : null,
      });
    }
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
  const adjustments = past ? historicalAdjustments(state, date) : undefined;
  for (const row of rows.values()) {
    row.remainder = row.planned === null ? null : Math.max(0, row.planned - row.actual);
    if (row.remainder !== null && row.remainder > 0) {
      const adjustment = adjustments?.get(workKey(row.materialId, row.round));
      if (adjustment) row.adjustment = adjustment;
    }
    if (currentRemaining)
      row.currentRemaining = currentRemaining.get(workKey(row.materialId, row.round)) ?? 0;
  }
  const quantities = [...rows.values()];
  return { date, past, known: !!baseline, rows: quantities, totals: quantityTotals(quantities) };
}

/** Aggregate only the supplied rows; comparison and display projections share the same unit rules. */
export function quantityTotals(rows: readonly QuantityRow[]): QuantityTotal[] {
  const totals = new Map<string, QuantityTotal>();
  for (const row of rows) {
    const total = totals.get(row.unit) ?? {
      unit: row.unit,
      planned: 0,
      actual: 0,
      reported: false,
      partial: false,
      remainder: 0,
      shortage: 0,
      ...(row.currentRemaining === undefined ? {} : { currentRemaining: 0 }),
    };
    total.planned = total.planned === null || row.planned === null ? null : total.planned + row.planned;
    total.remainder = total.remainder === null || row.remainder === null ? null : total.remainder + row.remainder;
    const shortage = recordedShortage(row);
    total.shortage = total.shortage === null || shortage === null ? null : total.shortage + shortage;
    if (total.currentRemaining !== undefined) total.currentRemaining += row.currentRemaining ?? 0;
    if (row.restartPlanned !== undefined)
      total.restartPlanned = (total.restartPlanned ?? 0) + row.restartPlanned;
    total.actual += row.actual;
    total.reported ||= row.reported;
    total.partial ||= !row.reported && (row.planned === null || row.planned > 0);
    totals.set(row.unit, total);
  }
  return [...totals.values()].map((total) => {
    const attention = rows.filter((row) => row.unit === total.unit &&
      (!row.reported || (row.restartPlanned !== undefined && row.actual < row.restartPlanned) ||
        (recordedShortage(row) ?? 0) > 0));
    if (attention.length && attention.every((row) => row.adjustment))
      total.adjustment = attention.some((row) => row.adjustment === 'unplaced') ? 'unplaced' : 'applied';
    return total;
  });
}

/** Ordinary schedule views omit archived plans and today's removed, unreported tasks.
 * Valid records remain visible; historical comparisons stay in calendarQuantity and saved baselines.
 */
export function calendarDisplayQuantity(
  state: AppState,
  date: string,
  reference = today(),
  filter = 'all',
) {
  const quantity = calendarQuantity(state, date, reference, filter);
  if (isArchivedPlanDate(state, date, reference)) {
    const rows = quantity.rows.filter((row) => row.reported)
      .map((row) => ({ ...row, planned: null, remainder: null }));
    return { ...quantity, known: false, rows, totals: quantityTotals(rows) };
  }
  if (date < reference && date === state.plan?.allocationStart) {
    // The old daily baseline describes work before the restart. Keep all valid
    // records, but show the approved replacement slots as a separate quantity.
    const adjustments = historicalAdjustments(state, date);
    const rows = new Map<string, QuantityRow>(quantity.rows.filter((row) => row.reported)
      .map((row) => [keyOf(row.materialId, row.round, row.unit),
        { ...row, planned: null, remainder: null, adjustment: undefined }]));
    const source = snapshot(state, { ...state.plan, sessions: displayPlanSessions(state, reference) }, date, true);
    for (const item of source.rows) {
      if (item.count <= 0 || (filter !== 'all' && item.examId !== filter)) continue;
      const key = keyOf(item.materialId, item.round, item.unit);
      const row = rows.get(key) ?? {
        materialId: item.materialId,
        round: item.round,
        examId: item.examId,
        name: item.name,
        unit: item.unit,
        planned: null,
        actual: 0,
        reported: false,
        remainder: null,
      };
      rows.set(key, { ...row, restartPlanned: item.count,
        adjustment: !row.reported || row.actual < item.count
          ? adjustments?.get(workKey(item.materialId, item.round)) : undefined });
    }
    const displayed = [...rows.values()];
    return { ...quantity, known: false, rows: displayed, totals: quantityTotals(displayed) };
  }
  if (date !== reference) return quantity;
  const rows = quantity.rows.filter(
    (row) => row.currentRemaining === undefined || row.currentRemaining > 0 || row.reported,
  );
  return rows.length === quantity.rows.length ? quantity :
    { ...quantity, rows, totals: quantityTotals(rows) };
}
