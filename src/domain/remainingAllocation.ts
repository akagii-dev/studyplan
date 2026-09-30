import {
  addDays,
  remaining,
  type AppState,
  type Plan,
  type Proposal,
  type RemainingAdjustmentTarget,
  type Session,
} from './model';
import {
  activePlanWork,
  workKey,
  remainingOccupiedSessions,
  restoreComparisonSessions,
} from './progressAllocation';
import { samePlanningSettings } from './planAudit';
import { fixedOrderIssue, fixedTimeIssue } from './planConstraints';
import { capacityForDate, capacityForWeek } from './planner/capacity';
import { type PlanningContext } from './planner/context';
import { generatePlan } from './planner/generate';
import { createProgressBaseline, recordTotals } from './progressReflection';
import { requirePlanningInputs } from './setupIssues';
import { PLAN_CALCULATION_VERSION } from './sessionPolicy';
import { startOfWeek } from './calendar';

const EPS = 1e-7;
type Boundary = Pick<PlanningContext, 'date' | 'minute'>;
type AdjustmentBasis = Extract<NonNullable<Proposal['basis']>, { kind: 'remaining-adjustment' }>;

/** Clock classification only; it neither consumes work nor changes reported status. */
export function isElapsedRemainingSession(session: Session, context: Boundary): boolean {
  return session.date < context.date ||
    (session.date === context.date && session.start < context.minute);
}

/** Explicit bulk selection uses effective outstanding work, never historical comparison slots. */
export function elapsedRemainingTargets(
  state: AppState,
  context: Boundary,
  sourceDate = context.date,
): Session[] {
  return activePlanWork(state, sourceDate).filter(
    (session) => !session.fixed && isElapsedRemainingSession(session, context),
  );
}

/** A pending proposal still refers to its unchanged committed source, even across midnight. */
export function remainingAdjustmentSourceDate(state: AppState, date: string): string {
  const basis = state.proposal?.basis;
  if (basis?.kind !== 'remaining-adjustment') return date;
  const ids = new Set(basis.targets.flatMap((target) => target.kind === 'session' ? [target.sessionId] : []));
  return [date, basis.date, ...(state.plan?.sessions ?? [])
    .filter((session) => ids.has(session.id)).map((session) => session.date)].sort()[0];
}

function sessionLabel(state: AppState, session: Session): string {
  const time = (minute: number) =>
    `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(Math.floor(minute % 60)).padStart(2, '0')}`;
  const material = state.settings.materials.find((item) => item.id === session.materialId);
  return `${session.date} ${time(session.start)}–${time(session.end)} ${material?.name ?? session.materialId} ${session.round + 1}周目`;
}

/** Do not turn unreadable reflection provenance into a newly established allocation basis. */
export function remainingBasisIssue(state: AppState): string | undefined {
  const plan = state.plan;
  if (!plan) return undefined;
  if (!plan.adjustmentBasis && !plan.progressBaseline)
    return '旧計画への実績の反映基準を確認できません。調整未反映として計画全体を確認してください。';
  try {
    for (const records of [plan.adjustmentBasis?.records, plan.progressBaseline?.records]) {
      if (records === undefined) continue;
      for (const [key, count] of Object.entries(records)) {
        const parts: unknown = JSON.parse(key);
        if (
          !Array.isArray(parts) ||
          parts.length !== 3 ||
          typeof parts[0] !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(parts[0]) ||
          !Number.isFinite(Date.parse(`${parts[0]}T12:00:00Z`)) ||
          new Date(`${parts[0]}T12:00:00Z`).toISOString().slice(0, 10) !== parts[0] ||
          typeof parts[1] !== 'string' ||
          !parts[1] ||
          !Number.isSafeInteger(parts[2]) ||
          parts[2] < 0 ||
          JSON.stringify(parts) !== key ||
          !Number.isSafeInteger(count) ||
          count < 0
        )
          return '実績の反映基準が壊れているため、配置を確定できません。調整未反映として内容を確認してください。';
      }
    }
  } catch {
    return '実績の反映基準が壊れているため、配置を確定できません。調整未反映として内容を確認してください。';
  }
  return undefined;
}
interface ValidationCache {
  sessions: Session[];
  date: string;
  minute: number;
  occupied: Session[];
  days: Map<string, ReturnType<typeof capacityForDate>>;
  weeks: Map<string, ReturnType<typeof capacityForWeek>>;
}
const validations = new WeakMap<AppState, ValidationCache>();
function validationCache(state: AppState, sessions: Session[], context: Boundary) {
  let cached = validations.get(state);
  if (
    !cached ||
    cached.sessions !== sessions ||
    cached.date !== context.date ||
    cached.minute !== context.minute
  ) {
    cached = {
      sessions,
      date: context.date,
      minute: context.minute,
      occupied: remainingOccupiedSessions(
        state,
        context,
        sessions.filter((s) => s.kind === 'study'),
      ),
      days: new Map(),
      weeks: new Map(),
    };
    validations.set(state, cached);
  }
  return cached;
}
const taskBudgets = (state: AppState) =>
  Object.fromEntries(
    state.settings.materials.flatMap((m) =>
      m.rounds.map((_, round) => [workKey(m.id, round), remaining(state, m.id, round)]),
    ),
  );
const allocationIssue = (session: Session, message?: string) =>
  session.fixed
    ? message
    : message
        ?.replaceAll('固定されています', '配置されています')
        .replaceAll('固定を解除して再配置してください', '残りの配置を調整してください')
        .replaceAll('固定枠', '予定枠')
        .replaceAll('固定予定', '予定');

function timeIssue(
  state: AppState,
  session: Session,
  context: Boundary,
  cached?: ValidationCache,
): string | undefined {
  if (isElapsedRemainingSession(session, context))
    return '開始時刻を過ぎた枠です。残りの配置を調整してください。';
  return sourceIssue(state, session, cached);
}

function sourceIssue(state: AppState, session: Session, cached?: ValidationCache): string | undefined {
  if (session.date < (state.plan?.allocationStart ?? '')) return '再配置の開始日より前の枠です。';
  const exam = state.settings.exams.find((e) => e.id === session.examId);
  const material = state.settings.materials.find((m) => m.id === session.materialId);
  if (
    !exam ||
    (session.kind === 'study' &&
      (!material || material.examId !== exam.id || !material.rounds[session.round]))
  )
    return '教材・周回・試験の条件を確認できません。';
  const reviewFrom = addDays(exam.target, -exam.reviewDays);
  if (
    session.kind === 'study'
      ? session.date < exam.start || session.date >= reviewFrom
      : !exam.reviewDays || session.date < reviewFrom || session.date >= exam.target
  )
    return '学習・復習の対象期間から外れています。';
  if (session.start >= session.end || session.end > 1440 || session.start < 0)
    return '枠の開始・終了時刻が無効です。';
  let capacity = cached?.days.get(session.date);
  if (!capacity) {
    capacity = capacityForDate(state.settings, session.date);
    cached?.days.set(session.date, capacity);
  }
  return allocationIssue(session, fixedTimeIssue(state.settings, session, capacity)?.message);
}

/** Shared by the quantity selector, explicit adjustment, and approval. Reports do not close a day. */
export function remainingSessionIssue(
  state: AppState,
  session: Session,
  context: Boundary,
  sessions: Session[] = activePlanWork(state, context.date),
): string | undefined {
  if (isElapsedRemainingSession(session, context))
    return '開始時刻を過ぎた枠です。残りの配置を調整してください。';
  return remainingSourceIssue(state, session, context, sessions);
}

/** Validate every non-clock condition so an expired conflict is not hidden as ordinary waiting work. */
export function remainingSourceIssue(
  state: AppState,
  session: Session,
  context: Boundary,
  sessions: Session[] = activePlanWork(state, context.date),
): string | undefined {
  const cached = validationCache(state, sessions, context);
  const invalid = sourceIssue(state, session, cached);
  if (invalid) return invalid;
  const occupied = cached.occupied;
  if (
    occupied.some(
      (s) =>
        s.id !== session.id &&
        s.date === session.date &&
        s.start < session.end - EPS &&
        session.start < s.end - EPS,
    )
  )
    return 'ほかの予定と重なっています。';
  const weekKey = startOfWeek(session.date);
  let week = cached.weeks.get(weekKey);
  if (!week) {
    week = capacityForWeek(state.settings, session.date, occupied);
    cached.weeks.set(weekKey, week);
  }
  if (week.used > week.limit + EPS) return '週の割当上限を超えています。';
  return allocationIssue(
    session,
    fixedOrderIssue(state, session, sessions, context.date, 0)?.message,
  );
}

/** No inferred shortfall: an inconsistent plan remains an explicit review condition. */
export function assertRemainingBalance(state: AppState, date: string): void {
  const sessions = activePlanWork(state, date);
  for (const [key, budget] of Object.entries(taskBudgets(state))) {
    const assigned = sessions
      .filter((s) => workKey(s.materialId, s.round) === key)
      .reduce((sum, s) => sum + s.count, 0);
    const unplaced = (state.plan?.shortfalls ?? [])
      .filter((s) => workKey(s.materialId, s.round) === key)
      .reduce((sum, s) => sum + s.count, 0);
    if (assigned + unplaced !== budget)
      throw new Error('残量と配置量・未配置量が一致しません。調整未反映の内容を確認してください。');
  }
}

export function validateRemainingAllocation(state: AppState, context: Boundary): void {
  const basisIssue = remainingBasisIssue(state);
  if (basisIssue) throw new Error(basisIssue);
  assertRemainingBalance(state, context.date);
  const work = activePlanWork(state, context.date);
  const sessions = [
    ...work,
    ...(state.plan?.sessions ?? []).filter(
      (s) =>
        s.kind === 'review' &&
        (s.date > context.date || (s.date === context.date && s.start >= context.minute)),
    ),
  ];
  for (const session of sessions) {
    const issue = remainingSessionIssue(state, session, context, sessions);
    if (issue) throw new Error(`${sessionLabel(state, session)}の${session.fixed ? '固定' : ''}予定：${issue}`);
  }
}

export function calculateRemainingAdjustment(
  state: AppState,
  targets: RemainingAdjustmentTarget[],
  from: string,
  context: PlanningContext,
  sourceDate = context.date,
): { plan: Plan; summary: AdjustmentBasis['summary']; affectedSessionIds: string[] } {
  const source = state.plan;
  if (!source) throw new Error('確定した計画がありません。');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !Number.isFinite(Date.parse(`${from}T12:00:00Z`)) ||
    new Date(`${from}T12:00:00Z`).toISOString().slice(0, 10) !== from
  )
    throw new Error('開始日を正しい日付で入力してください。');
  if (from < context.date || from < (source.allocationStart ?? ''))
    throw new Error('開始日は今日と再配置の開始日以降を指定してください。');
  const basisIssue = remainingBasisIssue(state);
  if (basisIssue) throw new Error(basisIssue);
  if (
    source.calculationVersion !== PLAN_CALCULATION_VERSION ||
    !source.settingsSnapshot ||
    !samePlanningSettings(source.settingsSnapshot, state.settings)
  )
    throw new Error(
      '計画と現在の設定・計算方式が一致していません。調整未反映の内容を確認してください。',
    );
  requirePlanningInputs(state.settings, context.date);
  assertRemainingBalance(state, sourceDate);
  const active = activePlanWork(state, sourceDate);
  const selected = new Set<string>();
  const selectedShortfalls = new Set<string>();
  const summary = new Map<string, AdjustmentBasis['summary'][number]>();
  const add = (materialId: string, round: number, count: number, sessionId?: string) => {
    const key = workKey(materialId, round);
    const row = summary.get(key) ?? {
      materialId,
      round,
      count: 0,
      sessionIds: [],
      includeUnplaced: false,
    };
    row.count += count;
    if (sessionId) row.sessionIds.push(sessionId);
    else row.includeUnplaced = true;
    summary.set(key, row);
  };
  for (const target of targets) {
    if (target.kind === 'session') {
      if (selected.has(target.sessionId)) continue;
      const session = active.find((s) => s.id === target.sessionId);
      if (!session)
        throw new Error('選択した予定の未消化量が変わりました。対象を選び直してください。');
      selected.add(session.id);
      add(session.materialId, session.round, session.count, session.id);
    } else {
      const key = workKey(target.materialId, target.round);
      if (selectedShortfalls.has(key)) continue;
      const count = source.shortfalls
        .filter((s) => workKey(s.materialId, s.round) === key)
        .reduce((sum, s) => sum + s.count, 0);
      if (!count) throw new Error('選択した未配置量が変わりました。対象を選び直してください。');
      selectedShortfalls.add(key);
      add(target.materialId, target.round, count);
    }
  }
  if (!summary.size) throw new Error('配置を調整する対象を選んでください。');
  const released = new Set<string>();
  for (const session of active) {
    const invalid = timeIssue(state, session, context);
    const move =
      selected.has(session.id) &&
      (session.date < from || !!remainingSessionIssue(state, session, context, active));
    if (move) {
      if (session.fixed)
        throw new Error(`${sessionLabel(state, session)}の固定予定は移動できません。元の予定の固定を解除してから、調整対象を選び直してください。`);
      released.add(session.id);
    } else if (invalid) {
      if (session.fixed)
        throw new Error(`${sessionLabel(state, session)}の固定予定は実行できません。元の予定の固定を解除してから、調整対象を選び直してください。${invalid}`);
      throw new Error(
        isElapsedRemainingSession(session, context)
          ? `${sessionLabel(state, session)}に再配置待ちの残量があります。「経過済みの未消化分をまとめて調整」で追加対象を確認してください。`
          : `${sessionLabel(state, session)}の予定は実行できません。調整対象に含めてください。${invalid}`,
      );
    }
  }
  // Valid selected slots remain where they are unless the explicit start boundary excludes them.
  if (!released.size && !selectedShortfalls.size) {
    validateRemainingAllocation(state, context);
    return { plan: source, summary: [...summary.values()], affectedSessionIds: [] };
  }
  const activeIds = new Set(active.map((s) => s.id));
  const historical = new Map(
    source.sessions
      .filter((s) => s.date < context.date || (!activeIds.has(s.id) && s.kind === 'study'))
      .map((s) => [s.id, s]),
  );
  const occupied = remainingOccupiedSessions(state, context, active);
  const occupiedIds = new Set(occupied.map((s) => s.id));
  const history = occupied
    .filter((s) => historical.has(s.id))
    .map((s) => (s.date < context.date ? s : { ...s, count: 0 }));
  const reviews = source.sessions.filter((s) => s.kind === 'review' && s.date >= context.date);
  const budgets = taskBudgets(state);
  const retainedShortfalls = source.shortfalls.filter(
    (s) => !selectedShortfalls.has(workKey(s.materialId, s.round)),
  );
  const reserved: Record<string, number> = {};
  for (const short of retainedShortfalls) {
    const key = workKey(short.materialId, short.round);
    reserved[key] = (reserved[key] ?? 0) + short.count;
  }
  const affectedSessionIds: string[] = [];
  let plan: Plan;
  for (;;) {
    const kept = active.filter((s) => !released.has(s.id));
    const earlier: Record<string, number> = {};
    for (const session of kept.filter((s) => s.date < from)) {
      const key = workKey(session.materialId, session.round);
      earlier[key] = (earlier[key] ?? 0) + session.count;
    }
    const allocatable = Object.fromEntries(
      Object.entries(budgets).map(([key, count]) => [
        key,
        count - (reserved[key] ?? 0) - (earlier[key] ?? 0),
      ]),
    );
    plan = generatePlan(
      state,
      from,
      true,
      from === context.date ? context.minute : 0,
      'balanced',
      context,
      {
        sessions: [...history, ...reviews, ...kept],
        remaining: allocatable,
        unplaced: reserved,
        allowReportedDay: true,
        preserveSessionBoundaries: true,
      },
    );
    const blocked = kept.filter(
      (s) => !!fixedOrderIssue(state, s, plan.sessions, context.date, 0, budgets),
    );
    if (!blocked.length) break;
    const fixed = blocked.filter((s) => s.fixed);
    if (fixed.length)
      throw new Error(
        `${fixed.map((s) => sessionLabel(state, s)).join('、')}の固定予定が先行する残量と競合しています。固定・順序を確認し、必要な予定の固定を解除してください。`,
      );
    for (const session of blocked) {
      released.add(session.id);
      if (!selected.has(session.id)) affectedSessionIds.push(session.id);
    }
  }
  if (plan.conflicts.length) throw new Error(plan.conflicts.join(' '));
  for (const short of retainedShortfalls) {
    const generated = plan.shortfalls.find(
      (s) => s.materialId === short.materialId && s.round === short.round,
    );
    if (generated) {
      generated.count += short.count;
      generated.minutes += short.minutes;
      generated.reason = `${short.count}問の未配置を保持。追加分：${generated.reason}`;
    } else plan.shortfalls.push({ ...short });
  }
  plan.from = source.from;
  plan.notBefore = source.notBefore;
  plan.allocationStart = source.allocationStart;
  plan = restoreComparisonSessions(plan, [...historical.values()], [
    ...(source.comparisonSessionIds ?? []),
    ...[...historical.values()].filter((s) => s.kind === 'study' && !occupiedIds.has(s.id)).map((s) => s.id),
  ]);
  // The new baseline contains only the new outstanding allocation, never a released source slot.
  // Corrections can add outstanding work but cannot resurrect the old placement.
  plan.adjustmentBasis = {
    date: context.date,
    records: recordTotals(state.records),
    sessions: structuredClone(
      plan.sessions.filter(
        (s) => s.kind === 'study' && s.date >= context.date && s.count > 0 && !historical.has(s.id),
      ),
    ),
  };
  plan.progressBaseline = createProgressBaseline(plan, state.records, context.date, 0);
  for (const id of historical.keys()) delete plan.progressBaseline.sessions[id];
  validateRemainingAllocation({ ...state, plan }, context);
  const content = (work: Session[], candidate: Plan) =>
    JSON.stringify([
      [...work].sort((a, b) => a.id.localeCompare(b.id)),
      candidate.shortfalls
        .map(({ materialId, round, count }) => [materialId, round, count])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ]);
  const oldContent = content(active, source);
  const newContent = content(activePlanWork({ ...state, plan }, context.date), plan);
  return {
    plan: oldContent === newContent ? source : plan,
    summary: [...summary.values()],
    affectedSessionIds,
  };
}
