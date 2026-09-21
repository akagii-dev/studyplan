import { validateSettings } from './validation';
import { startOfWeek } from '../calendar';
import { AppState, reported, Settings } from '../model';
import { overlapsBusy, sameSettings } from '../planAudit';
import { fixedIssueMessage, fixedOrderIssue, fixedTimeIssue } from '../planConstraints';
import { RevisionDraft, sameRevisionBase, validateRevisedSettings } from '../revision';
import { PLAN_CALCULATION_VERSION } from '../sessionPolicy';
import { requirePlanningInputs } from '../setupIssues';
import { capacityForDate, capacityForWeek } from './capacity';
import { PlanningContext } from './context';
import { generatePlan } from './generate';
const EPS = 1e-7;
export function propose(
  state: AppState,
  from: string,
  reason: string,
  context: PlanningContext,
): AppState {
  const notBefore = from === context.date ? context.minute : 0;
  const unreported = [
    ...new Set(
      (state.plan?.sessions ?? [])
        .filter(
          (x) =>
            x.kind === 'study' &&
            (x.date < from || (x.date === from && x.start < notBefore)) &&
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
      plan: generatePlan(state, from, true, notBefore, 'balanced', context),
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
  if (!state.plan) return state;
  const candidateSettings =
    previousProposal?.settingsBase &&
    sameRevisionBase(previousProposal.settingsBase, state.settings)
      ? previousProposal.plan.settingsSnapshot
      : undefined;
  try {
    const candidate = candidateSettings
      ? proposeSettings(state, candidateSettings, context.date, context)
      : propose(state, context.date, reason, context);
    return { ...candidate, draft: { ...state.draft, replanError: '' } };
  } catch (error) {
    // A new record may make a proposed total/round count invalid. Keep those edits as
    // an editable draft, never as an approvable plan or a replacement for actuals.
    let draft = state.draft;
    if (candidateSettings && !draft.revision) {
      const revision: RevisionDraft = {
        id: context.idPrefix + '-revision',
        base: structuredClone(state.settings),
        settings: structuredClone(candidateSettings),
        stage: 'review',
        topic: 'focus',
        itemId: '',
        index: 0,
      };
      draft = {
        ...draft,
        revision: { ...revision, settings: structuredClone(candidateSettings), stage: 'review' },
      };
    }
    return {
      ...state,
      proposal: null,
      draft: {
        ...draft,
        replanError: `記録は保存しました。再計画は設定を確認してから作成してください。${String(error)}`,
      },
    };
  }
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
  if (p.plan.calculationVersion !== PLAN_CALCULATION_VERSION)
    throw new Error(
      '計算方式が更新されました。現在の条件と固定予定を確認して案を作り直してください。',
    );
  if (p.basedOn !== (state.plan?.id ?? null))
    throw new Error('計画が変更されました。案を作り直してください。');
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
  const minute = context.minute;
  for (const x of p.plan.sessions.filter(
    (x) => x.fixed && (x.date > context.date || (x.date === context.date && x.start >= minute)),
  )) {
    const issue =
      fixedTimeIssue(settings, x, capacityForDate(settings, x.date)) ??
      fixedOrderIssue({ ...state, settings }, x, p.plan.sessions, p.plan.from, p.plan.notBefore);
    if (issue) throw new Error(fixedIssueMessage(x, issue));
  }
  if (
    p.plan.sessions.some(
      (x) =>
        (x.date > context.date || (x.date === context.date && x.start >= minute)) &&
        overlapsBusy(settings, x).length > 0,
    )
  )
    throw new Error('授業・予定と重複しています。固定予定や設定を確認して案を作り直してください。');
  for (const weekDate of new Set(
    p.plan.sessions
      .filter((x) => x.date > context.date || (x.date === context.date && x.start >= minute))
      .map((x) => startOfWeek(x.date)),
  )) {
    const week = capacityForWeek(settings, weekDate, p.plan.sessions);
    if (week.used > week.limit + EPS)
      throw new Error(
        `${week.from}〜${week.to}の週の割当上限を超えています。案を作り直してください。`,
      );
  }
  if (p.plan.conflicts.length)
    throw new Error('固定予定・週の割当上限・復習枠の競合を解消してください。');
  if (p.unreported.length && !acknowledge) throw new Error('未報告の扱いを確認してください。');
  return {
    ...state,
    settings,
    settingsUpdatedAt: !sameSettings(state.settings, settings)
      ? context.timestamp
      : state.settingsUpdatedAt,
    plan: {
      ...p.plan,
      settingsUpdatedAt: !sameSettings(state.settings, settings)
        ? context.timestamp
        : state.settingsUpdatedAt,
    },
    history: state.plan ? [...state.history, state.plan] : state.history,
    proposal: null,
    draft: { ...state.draft, revision: undefined },
  };
}
export function undoPlan(state: AppState): AppState {
  const previous = state.history.at(-1);
  if (!previous) throw new Error('戻せる計画がありません。');
  return { ...state, plan: previous, history: state.history.slice(0, -1), proposal: null };
}
