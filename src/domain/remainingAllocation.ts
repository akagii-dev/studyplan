import {
  addDays,
  isDateKey,
  remaining,
  type AppState,
  type Session,
} from './model';
import {
  activePlanWork,
  workKey,
  remainingOccupiedSessions,
} from './progressAllocation';
import { fixedOrderIssue, fixedTimeIssue } from './planConstraints';
import { capacityForDate, capacityForWeek } from './planner/capacity';
import { type PlanningContext } from './planner/context';
import { startOfWeek } from './calendar';

const EPS = 1e-7;
type Boundary = Pick<PlanningContext, 'date' | 'minute'>;

/** Clock classification only; it neither consumes work nor changes reported status. */
export function isElapsedRemainingSession(session: Session, context: Boundary): boolean {
  return session.date < context.date ||
    (session.date === context.date && session.start < context.minute);
}

/** The day a saved remaining-adjustment proposal was based on (an older proposal kind). */
export function remainingAdjustmentSourceDate(state: AppState, date: string): string {
  const basis = state.proposal?.basis;
  if (basis?.kind !== 'remaining-adjustment') return date;
  const ids = new Set(basis.targets.flatMap((target) => target.kind === 'session' ? [target.sessionId] : []));
  return [date, basis.date, ...(state.plan?.sessions ?? [])
    .filter((session) => ids.has(session.id)).map((session) => session.date)].sort()[0];
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
          !isDateKey(parts[0]) ||
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
  /** Occupied minutes per week, summed in one pass over `occupied`. */
  usedByWeek?: Map<string, number>;
  /** `occupied` grouped by date, in the original order. */
  occupiedByDate?: Map<string, Session[]>;
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
  if (!cached.occupiedByDate) {
    cached.occupiedByDate = new Map();
    for (const s of occupied) {
      const list = cached.occupiedByDate.get(s.date);
      if (list) list.push(s);
      else cached.occupiedByDate.set(s.date, [s]);
    }
  }
  if (
    (cached.occupiedByDate.get(session.date) ?? []).some(
      (s) =>
        s.id !== session.id &&
        s.start < session.end - EPS &&
        session.start < s.end - EPS,
    )
  )
    return 'ほかの予定と重なっています。';
  const weekKey = startOfWeek(session.date);
  let week = cached.weeks.get(weekKey);
  if (!week) {
    if (!cached.usedByWeek) {
      cached.usedByWeek = new Map();
      for (const s of occupied) {
        const key = startOfWeek(s.date);
        cached.usedByWeek.set(key, (cached.usedByWeek.get(key) ?? 0) + s.end - s.start);
      }
    }
    week = capacityForWeek(state.settings, session.date);
    week.used = cached.usedByWeek.get(weekKey) ?? 0;
    week.remaining = Math.max(0, week.limit - week.used);
    week.unallocated = Math.max(0, week.focus - week.used);
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
