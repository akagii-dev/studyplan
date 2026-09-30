import { validateSettings } from './validation';
import { startOfWeek } from '../calendar';
import { AppState, reported, Settings, type RemainingAdjustmentTarget } from '../model';
import { overlapsBusy, sameSettings } from '../planAudit';
import { fixedIssueMessage, fixedOrderIssue, fixedTimeIssue } from '../planConstraints';
import { sameRevisionBase, validateRevisedSettings } from '../revision';
import { PLAN_CALCULATION_VERSION } from '../sessionPolicy';
import { requirePlanningInputs } from '../setupIssues';
import { capacityForDate, capacityForWeek } from './capacity';
import { PlanningContext } from './context';
import { generatePlan } from './generate';
import { proposalUsesCurrentProgress, reflectProgressSafely } from '../progressReflection';
import { retainStudyDayBaselines } from '../calendarQuantity';
import { calculateRestart } from '../planRestart';
import {
  calculateRemainingAdjustment,
  remainingAdjustmentSourceDate,
  pastRemainingSourceDate,
  pastRemainingWork,
  validatePastRemainingAllocation,
  validateRemainingAllocation,
} from '../remainingAllocation';
import { remainingOccupiedSessions } from '../progressAllocation';
import { nonComparisonSessions } from '../planDisplay';
const EPS = 1e-7;

/** Bounded, deterministic precondition for an explicit restart candidate. */
export function restartSourceFingerprint(state: AppState): string {
  const source = JSON.stringify(
    [state.plan, state.settings, state.records],
    (_key, value: unknown) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
        : value,
  );
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x85ebca6b);
  }
  return `${source.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}

export function restartProposalStaleReason(
  state: AppState,
  context: PlanningContext,
): string | undefined {
  const proposal = state.proposal;
  if (!proposal?.basis) return undefined;
  if (
    proposal.basis.date !== context.date ||
    proposal.basis.sourceFingerprint !== restartSourceFingerprint(state)
  )
    return '案の作成後に基準日・計画・設定・実績が変わりました。案を作り直してください。';
  if (
    proposal.plan.sessions.some(
      (session) =>
        !session.fixed &&
        session.date === context.date &&
        session.date >= proposal.plan.from &&
        session.start >= (proposal.plan.notBefore ?? 0) &&
        session.start < context.minute &&
        !state.plan?.sessions.some((old) => old.id === session.id),
    )
  )
    return '案の作成後に当日の予定時刻が過ぎました。案を作り直してください。';
  if (proposal.basis.kind === 'remaining-adjustment') {
    try {
      if (proposal.basis.purpose === 'past-only') {
        const past = pastRemainingWork(state, context.date);
        if (past.issue) throw new Error(past.issue);
        const ids = new Set(past.sessions.map((session) => session.id));
        const targets = proposal.basis.targets;
        if (!ids.size || targets.some((target) => target.kind !== 'session' || !ids.has(target.sessionId)) ||
          [...ids].some((id) => !targets.some((target) => target.kind === 'session' && target.sessionId === id)))
          throw new Error('過去分の調整対象が昨日以前の未消化予定と一致しません。今日以降の予定や既存の未配置分は対象にできません。');
        validatePastRemainingAllocation(state, proposal.plan, context);
      } else validateRemainingAllocation({ ...state, plan: proposal.plan }, context);
    } catch (error) {
      return `${error instanceof Error ? error.message : String(error)} 案を作り直してください。`;
    }
  }
  return undefined;
}

export function proposeRestart(state: AppState, from: string, context: PlanningContext): AppState {
  if (state.proposal)
    throw new Error('確認待ちの計画案があります。先にその案を確認または破棄してください。');
  const plan = calculateRestart(state, from, context);
  return {
    ...state,
    proposal: {
      plan,
      basedOn: state.plan?.id ?? null,
      reason: '指定日から現在の残量を再配分します。',
      unreported: [],
      basis: {
        kind: 'restart',
        date: context.date,
        sourceFingerprint: restartSourceFingerprint(state),
      },
    },
  };
}
export function proposeRemainingAdjustment(
  state: AppState,
  targets: RemainingAdjustmentTarget[],
  from: string,
  context: PlanningContext,
): AppState {
  if (state.proposal)
    throw new Error('確認待ちの計画案があります。先にその案を確認または破棄してください。');
  return buildRemainingProposal(state, targets, from, context, context.date);
}

export function proposePastRemainingAdjustment(state: AppState, from: string, context: PlanningContext): AppState {
  if (state.proposal) throw new Error('確認待ちの計画案があります。先にその案を確認または破棄してください。');
  const past = pastRemainingWork(state, context.date);
  if (past.issue) throw new Error(past.issue);
  if (!past.sessions.length) return state;
  return buildRemainingProposal(state,
    past.sessions.map((session) => ({ kind: 'session', sessionId: session.id })),
    from, context, pastRemainingSourceDate(state, context.date), true);
}

/** Refresh the pending selection without changing the committed plan or silently adding work. */
export function reproposeRemainingAdjustment(
  state: AppState,
  additionalTargets: RemainingAdjustmentTarget[],
  from: string,
  context: PlanningContext,
): AppState {
  const basis = state.proposal?.basis;
  if (basis?.kind !== 'remaining-adjustment') throw new Error('残りの配置の確認待ちの案がありません。');
  if (basis.sourceFingerprint !== restartSourceFingerprint(state))
    throw new Error('案の作成後に計画・設定・実績が変わりました。元の対象を保持したまま内容を確認してください。');
  const pastOnly = basis.purpose === 'past-only';
  const sourceDate = pastOnly ? pastRemainingSourceDate(state, context.date) : remainingAdjustmentSourceDate(state, context.date);
  return buildRemainingProposal(
    { ...state, proposal: null },
    [...basis.targets, ...additionalTargets],
    [from, basis.from, context.date, state.plan?.allocationStart ?? ''].sort().at(-1)!,
    context,
    sourceDate,
    pastOnly,
  );
}

function buildRemainingProposal(
  state: AppState,
  targets: RemainingAdjustmentTarget[],
  from: string,
  context: PlanningContext,
  sourceDate: string,
  pastOnly = false,
): AppState {
  const result = calculateRemainingAdjustment(state, targets, from, context, sourceDate, pastOnly);
  if (result.plan === state.plan) return state;
  return {
    ...state,
    proposal: {
      plan: result.plan,
      basedOn: state.plan?.id ?? null,
      reason: pastOnly ? '昨日以前の未消化分だけを配置します。今日以降の予定と実績は維持します。' : result.affectedSessionIds.length
        ? '選択した残量と、順序を守るために必要な後続の予定だけを調整します。'
        : '選択した残量だけを、実行可能な空き枠へ調整します。',
      unreported: [],
      basis: {
        kind: 'remaining-adjustment',
        ...(pastOnly ? { purpose: 'past-only' as const } : {}),
        date: context.date,
        sourceFingerprint: restartSourceFingerprint(state),
        from,
        targets: structuredClone(targets),
        summary: result.summary,
        affectedSessionIds: result.affectedSessionIds,
      },
    },
  };
}
export function propose(
  state: AppState,
  from: string,
  reason: string,
  context: PlanningContext,
): AppState {
  const effectiveFrom = [from, state.plan?.allocationStart ?? ''].sort().at(-1)!;
  const notBefore = effectiveFrom === context.date ? context.minute : 0;
  const unreported = [
    ...new Set(
      (state.plan?.sessions ?? [])
        .filter(
          (x) =>
            x.kind === 'study' &&
            x.date >= (state.plan?.allocationStart ?? '') &&
            (x.date < effectiveFrom || (x.date === effectiveFrom && x.start < notBefore)) &&
            !reported(state, x.date, x.materialId, x.round),
        )
        .map(
          (x) =>
            `${x.date}｜${state.settings.materials.find((m) => m.id === x.materialId)?.name}｜${x.round + 1}周目`,
        ),
    ),
  ];
  return {
    ...state,
    proposal: {
      plan: {
        ...generatePlan(state, effectiveFrom, true, notBefore, 'balanced', context),
        allocationStart: state.plan?.allocationStart,
      },
      basedOn: state.plan?.id ?? null,
      reason,
      unreported,
    },
  };
}
export function proposalAfterRecord(
  state: AppState,
  reason: string,
  previousProposal = state.proposal,
  context: PlanningContext,
): AppState {
  void reason;
  void previousProposal;
  void context;
  return reflectProgressSafely(state);
}
export function proposeSettings(
  state: AppState,
  settings: Settings,
  from: string,
  context: PlanningContext,
): AppState {
  requirePlanningInputs(settings, from);
  validateRevisedSettings(state, settings, from, from === context.date ? context.minute : 0);
  const candidate = propose(
    { ...state, settings, settingsUpdatedAt: context.timestamp },
    from,
    '対話で見直した条件を使い、残りの課題を再配分します。設定も承認時に反映します。',
    context,
  );
  return {
    ...state,
    proposal: { ...candidate.proposal!, settingsBase: structuredClone(state.settings) },
  };
}
export function approve(state: AppState, acknowledge: boolean, context: PlanningContext): AppState {
  const p = state.proposal;
  if (!p) throw new Error('再計画案がありません。');
  const restartStale = restartProposalStaleReason(state, context);
  if (restartStale) throw new Error(restartStale);
  if (p.plan.calculationVersion !== PLAN_CALCULATION_VERSION)
    throw new Error(
      '計算方式が更新されました。現在の条件と固定予定を確認して案を作り直してください。',
    );
  if (p.basedOn !== (state.plan?.id ?? null))
    throw new Error('計画が変更されました。案を作り直してください。');
  if (!proposalUsesCurrentProgress(p.plan, state.records))
    throw new Error('案の作成後に進捗が変わっています。現在の残数で案を作り直してください。');
  if (
    !p.plan.settingsSnapshot ||
    !(p.settingsBase
      ? sameRevisionBase(p.settingsBase, state.settings)
      : sameSettings(p.plan.settingsSnapshot, state.settings))
  )
    throw new Error('作成後に設定が変わっています。現在の設定で案を作り直してください。');
  const settings = p.plan.settingsSnapshot;
  const errors = validateSettings(settings);
  if (errors.length) throw new Error(errors.join(' '));
  requirePlanningInputs(settings, context.date);
  validateRevisedSettings(state, settings, context.date, context.minute);
  // An automatic progress proposal starts tomorrow. Earlier sessions are archived
  // verbatim and must not be revalidated or rewritten as future work.
  const validationFrom = p.plan.from > context.date ? p.plan.from : context.date;
  const minute = validationFrom === context.date ? context.minute : 0;
  const validationSessions =
    p.basis?.kind === 'remaining-adjustment'
      ? remainingOccupiedSessions({ ...state, plan: p.plan, settings }, context)
      : nonComparisonSessions(p.plan);
  for (const x of validationSessions.filter(
    (x) => x.fixed && (x.date > validationFrom || (x.date === validationFrom && x.start >= minute)),
  )) {
    const issue =
      fixedTimeIssue(settings, x, capacityForDate(settings, x.date)) ??
      fixedOrderIssue({ ...state, settings }, x, validationSessions, p.plan.from, p.plan.notBefore);
    if (issue) throw new Error(fixedIssueMessage(x, issue));
  }
  if (
    validationSessions.some(
      (x) =>
        (x.date > validationFrom || (x.date === validationFrom && x.start >= minute)) &&
        overlapsBusy(settings, x).length > 0,
    )
  )
    throw new Error('授業・予定と重複しています。固定予定や設定を確認して案を作り直してください。');
  for (const weekDate of new Set(
    validationSessions
      .filter((x) => x.date > validationFrom || (x.date === validationFrom && x.start >= minute))
      .map((x) => startOfWeek(x.date)),
  )) {
    const week = capacityForWeek(settings, weekDate, validationSessions);
    if (week.used > week.limit + EPS)
      throw new Error(
        `${week.from}〜${week.to}の週の割当上限を超えています。案を作り直してください。`,
      );
  }
  if (p.plan.conflicts.length)
    throw new Error('固定予定・週の割当上限・復習枠の競合を解消してください。');
  if (p.unreported.length && !acknowledge) throw new Error('未報告の扱いを確認してください。');
  const retained = retainStudyDayBaselines(state, context.date);
  return {
    ...retained,
    settings,
    settingsUpdatedAt: !sameSettings(state.settings, settings)
      ? context.timestamp
      : state.settingsUpdatedAt,
    plan: {
      ...p.plan,
      approvedAt: context.timestamp,
      settingsUpdatedAt: !sameSettings(state.settings, settings)
        ? context.timestamp
        : state.settingsUpdatedAt,
    },
    history: state.plan ? [...state.history, state.plan] : state.history,
    proposal: null,
    // Approval checks that this proposal includes the current records. A prior
    // progress-adjustment warning is resolved only at this successful boundary.
    draft: {
      ...state.draft,
      revision: undefined,
      progressAdjustment: undefined,
      planReconciliation: undefined,
    },
  };
}
export function undoPlan(state: AppState, date?: string): AppState {
  const previous = state.history.at(-1);
  if (!previous) throw new Error('戻せる計画がありません。');
  return {
    ...(date ? retainStudyDayBaselines(state, date) : state),
    plan: previous,
    history: state.history.slice(0, -1),
    proposal: null,
  };
}
