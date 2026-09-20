import { AppState, today, uid } from './model';
import { propose, proposeSettings } from './planner';
import { beginRevision, RevisionDraft, sameRevisionBase } from './revision';
import type { ConstraintIssue } from './planConstraints';
import { studyCoverageGaps, StudyCoverageGap } from './studyCoverage';

export function beginStudyGoalReview(
  state: AppState,
  gap: StudyCoverageGap,
  topic: 'material' | 'exam',
): AppState {
  const next = beginConstraintRepair(state);
  const draft = next.draft.revision as RevisionDraft;
  const materials = draft.settings.materials.filter((m) => m.examId === gap.examId);
  draft.topic = topic;
  draft.itemId = topic === 'exam' ? gap.examId : materials.length === 1 ? materials[0].id : '';
  draft.index = topic === 'exam' ? 1 : 2;
  draft.stage = draft.itemId ? 'question' : 'item';
  return next;
}

export function beginStudyCoverageRepair(
  state: AppState,
  gap: StudyCoverageGap,
  from = today(),
): AppState {
  const next = beginConstraintRepair(state);
  const draft = next.draft.revision as RevisionDraft;
  const missing = studyCoverageGaps(draft.settings, from).find(
    (g) => g.examId === gap.examId && g.from <= gap.to && g.to >= gap.from,
  );
  draft.topic = 'study';
  draft.index = 0;
  draft.itemId = '';
  draft.stage = 'item';
  if (!missing) return next;
  const previous = draft.settings.windows
    .filter((w) => w.kind === 'study' && w.to < missing.from)
    .sort((a, b) => b.to.localeCompare(a.to))[0];
  const id = uid();
  draft.settings.windows.push({
    id,
    name: '追加の学習可能枠',
    kind: 'study',
    from: missing.from,
    to: missing.to,
    weekdays: previous ? [...previous.weekdays] : [1, 2, 3, 4, 5],
    start: previous?.start ?? 1080,
    end: previous?.end ?? 1260,
  });
  draft.itemId = id;
  draft.stage = 'question';
  return next;
}

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
    if (issue.topic === 'focus' || issue.topic === 'meal' || issue.topic === 'commute') draft.stage = 'question';
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
