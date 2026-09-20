import { AppState, today } from './model';
import { propose, proposeSettings } from './planner';
import { beginRevision, RevisionDraft, sameRevisionBase } from './revision';
import type { ConstraintIssue } from './planConstraints';

export function refreshProposal(state: AppState, from = today()): AppState {
  if (state.proposal?.settingsBase) {
    if (!sameRevisionBase(state.proposal.settingsBase, state.settings))
      throw new Error('設定が変わっています。現在の設定から見直してください。');
    return proposeSettings(state, state.proposal.plan.settingsSnapshot!, from);
  }
  return propose(state, from, '現在の時刻と残数で、計画案を更新しました。');
}
export function releaseFixedAndRefresh(
  state: AppState,
  sessionId: string,
  from = today(),
): AppState {
  if (!state.plan?.sessions.some((s) => s.id === sessionId && s.fixed))
    throw new Error('対象の固定予定が見つかりません。');
  return refreshProposal(
    {
      ...state,
      plan: {
        ...state.plan,
        sessions: state.plan.sessions.map((s) => (s.id === sessionId ? { ...s, fixed: false } : s)),
      },
    },
    from,
  );
}
export function beginConstraintRepair(state: AppState, issue?: ConstraintIssue): AppState {
  const existing = state.draft.revision as RevisionDraft | undefined;
  const next = beginRevision(state);
  const draft = next.draft.revision as RevisionDraft;
  if (existing && sameRevisionBase(existing.base, state.settings)) {
    draft.settings = structuredClone(existing.settings);
    draft.id = existing.id;
  } else if (
    state.proposal?.settingsBase &&
    sameRevisionBase(state.proposal.settingsBase, state.settings)
  )
    draft.settings = structuredClone(state.proposal.plan.settingsSnapshot!);
  if (issue) {
    draft.topic = issue.topic;
    draft.index = issue.index;
    draft.itemId = issue.itemId;
    if (issue.topic === 'focus' || issue.topic === 'meal') draft.stage = 'question';
    else if (
      issue.itemId &&
      [...draft.settings.windows, ...draft.settings.exceptions].some((x) => x.id === issue.itemId)
    ) {
      draft.stage = 'question';
      draft.index = issue.topic === 'exception' ? 2 : 4;
    } else draft.stage = 'item';
  }
  return next;
}
