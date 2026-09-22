import {
  AppState,
  Plan,
  PlanProgressBaseline,
  Progress,
  ProgressReflectionNotice,
  Session,
  remaining,
  today,
} from './model';

const taskKey = (materialId: string, round: number) => JSON.stringify([materialId, round]);
const recordKey = (date: string, materialId: string, round: number) =>
  JSON.stringify([date, materialId, round]);
const parseTaskKey = (key: string) => JSON.parse(key) as [string, number];

export function recordTotals(records: Progress[]) {
  const totals: Record<string, number> = {};
  for (const record of records) {
    if (record.cancelled) continue;
    const key = recordKey(record.date, record.materialId, record.round);
    totals[key] = (totals[key] ?? 0) + record.count;
  }
  return totals;
}

const plannedFromHere = (session: Session, from: string, minute: number) =>
  session.kind === 'study' &&
  (session.date > from || (session.date === from && session.start >= minute));

export function createProgressBaseline(
  plan: Plan,
  records: Progress[],
  from = plan.from,
  minute = plan.notBefore ?? 0,
): PlanProgressBaseline {
  return {
    records: recordTotals(records),
    sessions: Object.fromEntries(
      plan.sessions
        .filter((session) => plannedFromHere(session, from, minute))
        .map((session) => [session.id, { count: session.count, end: session.end }]),
    ),
    shortfalls: Object.fromEntries(
      plan.shortfalls.map((shortfall) => [
        taskKey(shortfall.materialId, shortfall.round),
        { count: shortfall.count, minutes: shortfall.minutes, reason: shortfall.reason },
      ]),
    ),
  };
}

export function withProgressBaseline(
  state: AppState,
  from = today(),
  minute = new Date().getHours() * 60 + new Date().getMinutes(),
): AppState {
  if (!state.plan || state.plan.progressBaseline) return state;
  const baselineFrom = state.plan.from > from ? state.plan.from : from;
  const baselineMinute = baselineFrom === from ? minute : (state.plan.notBefore ?? 0);
  return {
    ...state,
    plan: {
      ...state.plan,
      progressBaseline: createProgressBaseline(
        state.plan,
        state.records,
        baselineFrom,
        baselineMinute,
      ),
    },
  };
}

export function proposalUsesCurrentProgress(plan: Plan, records: Progress[]) {
  if (!plan.progressBaseline) return false;
  const normalize = (value: Record<string, number>) =>
    JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  return normalize(plan.progressBaseline.records) === normalize(recordTotals(records));
}

export function originalSessionCount(plan: Plan | null, session: Session) {
  return plan?.progressBaseline?.sessions[session.id]?.count ?? session.count;
}

/** Only the approved plan can establish that the current records have been incorporated. */
export function pendingProgressReflection(state: AppState): ProgressReflectionNotice | undefined {
  if (!state.plan || proposalUsesCurrentProgress(state.plan, state.records)) return undefined;
  return state.draft.progressResult as ProgressReflectionNotice | undefined;
}

/**
 * Recompute, rather than incrementally patch, every reflected count. This makes the operation
 * idempotent across retries/restarts and reversible after corrections or cancellation.
 */
export function reflectProgress(state: AppState, recordId?: string): AppState {
  const prepared = withProgressBaseline(state);
  const plan = prepared.plan;
  if (!plan?.progressBaseline) return prepared;
  const baseline = plan.progressBaseline;
  const currentRecords = recordTotals(prepared.records);
  const sessions = plan.sessions.map((session) => {
    const original = baseline.sessions[session.id];
    return original ? { ...session, count: original.count, end: original.end } : { ...session };
  });
  const shortfalls = Object.entries(baseline.shortfalls).map(([key, original]) => {
    const [materialId, round] = parseTaskKey(key);
    return { materialId, round, ...original };
  });
  const allocations: ProgressReflectionNotice['allocations'] = [];
  const fixedSessionIds = new Set<string>();
  const unplaced = new Map<string, number>();
  const completed: ProgressReflectionNotice['completed'] = [];
  const keys = new Set<string>();
  for (const key of [...Object.keys(baseline.records), ...Object.keys(currentRecords)]) {
    const [, materialId, round] = JSON.parse(key) as [string, string, number];
    keys.add(taskKey(materialId, round));
  }

  for (const key of keys) {
    const [materialId, round] = parseTaskKey(key);
    const candidates = sessions
      .filter(
        (session) =>
          !!baseline.sessions[session.id] &&
          session.materialId === materialId &&
          session.round === round,
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
    const consumed = new Map<string, number>();
    const dates = new Set<string>();
    for (const record of prepared.records)
      if (!record.cancelled && record.materialId === materialId && record.round === round)
        dates.add(record.date);
    for (const baselineKey of Object.keys(baseline.records)) {
      const [date, id, r] = JSON.parse(baselineKey) as [string, string, number];
      if (id === materialId && r === round) dates.add(date);
    }
    let blocked = false;
    for (const date of [...dates].sort()) {
      const delta =
        (currentRecords[recordKey(date, materialId, round)] ?? 0) -
        (baseline.records[recordKey(date, materialId, round)] ?? 0);
      let units = Math.max(0, delta);
      for (const session of candidates) {
        if (!units || blocked) break;
        const original = baseline.sessions[session.id];
        const used = consumed.get(session.id) ?? 0;
        const room = Math.max(0, original.count - used);
        if (!room) continue;
        const amount = Math.min(room, units);
        if (session.date > date && session.fixed) {
          fixedSessionIds.add(session.id);
          blocked = true;
          break;
        }
        consumed.set(session.id, used + amount);
        units -= amount;
        if (session.date > date) {
          session.count -= amount;
          const perUnit = original.count ? (original.end - session.start) / original.count : 0;
          session.end = session.start + session.count * perUnit;
          allocations.push({ date: session.date, materialId, round, count: amount });
        }
      }
      if (units && !blocked) {
        const shortfall = shortfalls.find(
          (item) => item.materialId === materialId && item.round === round,
        );
        if (shortfall) {
          const amount = Math.min(shortfall.count, units);
          const perUnit = shortfall.count ? shortfall.minutes / shortfall.count : 0;
          shortfall.count -= amount;
          shortfall.minutes -= amount * perUnit;
          units -= amount;
        }
      }
      if (units) unplaced.set(key, (unplaced.get(key) ?? 0) + units);
    }
    const baselineTotal = Object.entries(baseline.records)
      .filter(([entry]) => {
        const [, id, r] = JSON.parse(entry) as [string, string, number];
        return id === materialId && r === round;
      })
      .reduce((sum, [, count]) => sum + count, 0);
    const currentTotal = prepared.records
      .filter(
        (record) => !record.cancelled && record.materialId === materialId && record.round === round,
      )
      .reduce((sum, record) => sum + record.count, 0);
    if (currentTotal < baselineTotal)
      unplaced.set(key, (unplaced.get(key) ?? 0) + baselineTotal - currentTotal);
    if (remaining(prepared, materialId, round) === 0) completed.push({ materialId, round });
  }

  const notice: ProgressReflectionNotice = {
    recordId,
    applied: allocations.reduce((sum, allocation) => sum + allocation.count, 0),
    allocations,
    fixedSessionIds: [...fixedSessionIds],
    unplaced: [...unplaced].map(([key, count]) => {
      const [materialId, round] = parseTaskKey(key);
      return { materialId, round, count };
    }),
    completed,
  };
  return {
    ...prepared,
    plan: {
      ...plan,
      sessions,
      shortfalls: shortfalls.filter((shortfall) => shortfall.count > 0),
    },
    draft: { ...prepared.draft, progressResult: notice },
  };
}

/** Keep the already validated progress edit even if an old/corrupt plan cannot be adjusted. */
export function reflectProgressSafely(state: AppState, recordId?: string): AppState {
  try {
    return reflectProgress(state, recordId);
  } catch (error) {
    return {
      ...state,
      draft: {
        ...state.draft,
        progressResult: {
          recordId,
          error: `予定への前倒し反映に失敗しました。${String(error)}`,
          applied: 0,
          allocations: [],
          fixedSessionIds: [],
          unplaced: [],
          completed: [],
        } satisfies ProgressReflectionNotice,
      },
    };
  }
}
