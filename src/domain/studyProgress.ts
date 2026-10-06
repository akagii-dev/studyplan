import { type AppState } from './model';
import { progressView } from './progressView';
import { displayPlanSessions } from './planDisplay';
import { recordTotals } from './progressReflection';

/** Schedule-only presentation; recording, comparisons and review time retain their own contracts. */
export function studyProgressView(state: AppState, value: Parameters<typeof progressView>[0] &
  { materialId: string; round: number }, date: string, reference: string) {
  const progress = progressView(value, date, reference);
  let target = value.planned;
  let recorded = value.actual;
  if (progress.currentRemaining !== undefined) {
    const plan = state.plan;
    const visible = new Set(displayPlanSessions(state, reference).map(session => session.id));
    const basis = plan?.adjustmentBasis;
    const sessions = basis?.sessions ?? plan?.sessions.map(session => ({ ...session,
      count: plan.progressBaseline?.sessions[session.id]?.count ?? session.count })) ?? [];
    target = sessions.filter(session => visible.has(session.id) && session.kind === 'study' &&
      session.date === date && session.materialId === value.materialId && session.round === value.round)
      .reduce((sum, session) => sum + session.count, 0);
    const key = JSON.stringify([date, value.materialId, value.round]);
    const before = (basis?.records ?? plan?.progressBaseline?.records)?.[key] ?? 0;
    recorded = Math.max(0, (recordTotals(state.records)[key] ?? 0) - before);
  }
  const known = progress.restartPlanned === undefined && target !== null && target > 0;
  const complete = date <= reference && known && value.reported && recorded >= target!;
  const left = progress.currentRemaining ?? (known ? Math.max(0, target! - recorded) : null);
  const text = complete ? (recorded > target! ? `✅追加${recorded - target!}${value.unit}` : '✅完了') : left !== null && left > 0 ? `あと${left}${value.unit}` :
    progress.restartPlanned !== undefined ? `予定 ${progress.restartPlanned}${value.unit}` :
    !known ? (value.reported ? `${value.actual}${value.unit}を記録` : target === null ? '未報告' : '予定なし') : '予定の残りなし';
  const plotTarget = known && (progress.currentRemaining === undefined || complete || recorded + (left ?? 0) === target) ? target : null;
  return { ...progress, text, complete, target: plotTarget, recorded, left, supplement: progress.adjustment === 'applied' ? '調整済み' :
    progress.adjustment === 'unplaced' ? '調整済み・未配置あり' : '' };
}

export const studyInputLabel = (unit: string) => unit === '問' ? '今回解いた問題数' : `今回進めた量（${unit}）`;
