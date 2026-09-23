import { AppState, Plan, Shortfall } from './model';

export type AdjustmentStatus = 'applied' | 'unchanged' | 'unplaced' | 'review' | 'failed' | 'recorded';
export type ProgressAction = 'record' | 'correct' | 'cancel';

export interface PlanChange {
  date: string;
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

type PlanAmount = Omit<PlanChange, 'beforeCount' | 'afterCount' | 'beforeMinutes' | 'afterMinutes' | 'timeChanged' | 'beforeSlots' | 'afterSlots'> & {
  count: number;
  minutes: number;
  slots: string[];
};

function amounts(plan: Plan | null, from: string) {
  const groups = new Map<string, PlanAmount>();
  for (const session of plan?.sessions ?? []) {
    if (session.date < from) continue;
    const key = JSON.stringify([session.date, session.materialId, session.round, session.kind, session.fixed]);
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
  return [...new Set([...old.keys(), ...next.keys()])]
    .sort()
    .flatMap((key) => {
      const a = old.get(key);
      const b = next.get(key);
      const item = a ?? b!;
      const beforeCount = a?.count ?? 0;
      const afterCount = b?.count ?? 0;
      const beforeMinutes = a?.minutes ?? 0;
      const afterMinutes = b?.minutes ?? 0;
      const timeChanged = JSON.stringify(a?.slots ?? []) !== JSON.stringify(b?.slots ?? []);
      if (beforeCount === afterCount && beforeMinutes === afterMinutes && !timeChanged) return [];
      return [{
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
      }];
    });
}

export function progressReceipts(state: AppState): ProgressReceipt[] {
  const value = state.draft.progressReceipts;
  return Array.isArray(value)
    ? value.filter((item): item is ProgressReceipt =>
        !!item && typeof item === 'object' && typeof item.id === 'string' &&
        typeof item.recordId === 'string' && Array.isArray(item.changes) &&
        Array.isArray(item.shortfalls) && typeof item.status === 'string')
    : [];
}

export function latestReceipt(state: AppState, recordId?: string): ProgressReceipt | undefined {
  return [...progressReceipts(state)].reverse().find((item) => !recordId || item.recordId === recordId);
}

export function appendProgressReceipt(state: AppState, receipt: Omit<ProgressReceipt, 'id'>): AppState {
  const previous = progressReceipts(state);
  return {
    ...state,
    draft: {
      ...state.draft,
      progressReceipts: [...previous, { ...receipt, id: `${receipt.recordId}/${previous.length + 1}` }],
    },
  };
}
