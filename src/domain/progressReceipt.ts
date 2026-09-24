import { AppState, Plan, Shortfall } from './model';

export type AdjustmentStatus =
  'applied' | 'unchanged' | 'unplaced' | 'review' | 'failed' | 'recorded';
export type ProgressAction = 'record' | 'correct' | 'cancel';

export interface PlanChange {
  date: string;
  beforeDate?: string;
  afterDate?: string;
  materialId: string;
  round: number;
  kind: 'study' | 'review';
  fixed: boolean;
  beforeCount: number;
  afterCount: number;
  beforeMinutes: number;
  afterMinutes: number;
  timeChanged: boolean;
  beforeSlots: string[];
  afterSlots: string[];
}

export interface ProgressReceipt {
  id: string;
  recordId: string;
  action: ProgressAction;
  timestamp: string;
  date: string;
  materialId: string;
  round: number;
  beforeCount: number | null;
  afterCount: number | null;
  status: AdjustmentStatus;
  detail?: string;
  changes: PlanChange[];
  shortfalls: Shortfall[];
  futureFrom: string;
}

type PlanAmount = Omit<
  PlanChange,
  | 'beforeCount'
  | 'afterCount'
  | 'beforeMinutes'
  | 'afterMinutes'
  | 'timeChanged'
  | 'beforeSlots'
  | 'afterSlots'
> & {
  count: number;
  minutes: number;
  slots: string[];
};

function amounts(plan: Plan | null, from: string) {
  const groups = new Map<string, PlanAmount>();
  for (const session of plan?.sessions ?? []) {
    if (session.date < from) continue;
    if (session.kind === 'study' && session.count === 0 && session.start === session.end) continue;
    const key = JSON.stringify([
      session.date,
      session.materialId,
      session.round,
      session.kind,
      session.fixed,
    ]);
    const previous = groups.get(key);
    groups.set(key, {
      date: session.date,
      materialId: session.materialId,
      round: session.round,
      kind: session.kind,
      fixed: session.fixed,
      count: (previous?.count ?? 0) + session.count,
      minutes: (previous?.minutes ?? 0) + session.end - session.start,
      slots: [...(previous?.slots ?? []), `${session.start}-${session.end}`].sort(),
    });
  }
  return groups;
}

/** Compare scheduled work, not regenerated session IDs or plan revision IDs. */
export function planChanges(before: Plan | null, after: Plan | null, from: string): PlanChange[] {
  const old = amounts(before, from);
  const next = amounts(after, from);
  const moves: PlanChange[] = [];
  const paired = new Set<string>();
  // A complete daily group moved to a different date is one placement change.
  // Partial transfers still change each affected day's quantity and remain separate.
  for (const [oldKey, a] of [...old.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (next.has(oldKey)) continue;
    const match = [...next.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .find(
        ([key, b]) =>
          !old.has(key) &&
          !paired.has(key) &&
          a.materialId === b.materialId &&
          a.round === b.round &&
          a.kind === b.kind &&
          a.fixed === b.fixed &&
          a.count === b.count &&
          a.minutes === b.minutes,
      );
    if (!match) continue;
    const [nextKey, b] = match;
    paired.add(oldKey);
    paired.add(nextKey);
    moves.push({
      date: b.date,
      beforeDate: a.date,
      afterDate: b.date,
      materialId: b.materialId,
      round: b.round,
      kind: b.kind,
      fixed: b.fixed,
      beforeCount: a.count,
      afterCount: b.count,
      beforeMinutes: a.minutes,
      afterMinutes: b.minutes,
      timeChanged: JSON.stringify(a.slots) !== JSON.stringify(b.slots),
      beforeSlots: a.slots,
      afterSlots: b.slots,
    });
  }
  const changes = [...new Set([...old.keys(), ...next.keys()])].sort().flatMap((key) => {
    if (paired.has(key)) return [];
    const a = old.get(key);
    const b = next.get(key);
    const item = a ?? b!;
    const beforeCount = a?.count ?? 0;
    const afterCount = b?.count ?? 0;
    const beforeMinutes = a?.minutes ?? 0;
    const afterMinutes = b?.minutes ?? 0;
    const timeChanged = JSON.stringify(a?.slots ?? []) !== JSON.stringify(b?.slots ?? []);
    if (beforeCount === afterCount && beforeMinutes === afterMinutes && !timeChanged) return [];
    return [
      {
        date: item.date,
        materialId: item.materialId,
        round: item.round,
        kind: item.kind,
        fixed: item.fixed,
        beforeCount,
        afterCount,
        beforeMinutes,
        afterMinutes,
        timeChanged,
        beforeSlots: a?.slots ?? [],
        afterSlots: b?.slots ?? [],
      },
    ];
  });
  return [...moves, ...changes].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.materialId.localeCompare(b.materialId) ||
      a.round - b.round ||
      a.kind.localeCompare(b.kind) ||
      Number(a.fixed) - Number(b.fixed),
  );
}

/** One changed daily task group; IDs and source array order are not groups. */
export function summarizePlanChanges(changes: PlanChange[]) {
  const quantity = changes.filter((c) =>
    c.kind === 'review' ? c.beforeMinutes !== c.afterMinutes : c.beforeCount !== c.afterCount,
  ).length;
  return {
    quantity,
    placement: changes.length - quantity,
    materials: new Set(changes.filter((c) => c.kind === 'study').map((c) => c.materialId)).size,
  };
}

export function progressReceipts(state: AppState): ProgressReceipt[] {
  const value = state.draft.progressReceipts;
  return Array.isArray(value)
    ? value.filter(
        (item): item is ProgressReceipt =>
          !!item &&
          typeof item === 'object' &&
          typeof item.id === 'string' &&
          typeof item.recordId === 'string' &&
          Array.isArray(item.changes) &&
          Array.isArray(item.shortfalls) &&
          typeof item.status === 'string',
      )
    : [];
}

export function latestReceipt(state: AppState, recordId?: string): ProgressReceipt | undefined {
  return [...progressReceipts(state)]
    .reverse()
    .find((item) => !recordId || item.recordId === recordId);
}

export function appendProgressReceipt(
  state: AppState,
  receipt: Omit<ProgressReceipt, 'id'>,
): AppState {
  const previous = progressReceipts(state);
  return {
    ...state,
    draft: {
      ...state.draft,
      progressReceipts: [
        ...previous,
        { ...receipt, id: `${receipt.recordId}/${previous.length + 1}` },
      ],
    },
  };
}
