import { AppState, ScheduleAnswer, ScheduleKind, Settings, mealKeys, mealNames } from './model';
import { studyCoverageGaps, StudyCoverageGap, isLongTermStudyGap } from './studyCoverage';

export const scheduleKinds: ScheduleKind[] = ['class', 'busy', 'exception'];
export const scheduleInfo: Record<ScheduleKind, { label: string; impact: string }> = {
  class: {
    label: '大学の授業',
    impact:
      '未登録の授業は学習可能枠から除かれません。授業中に学習が入り、勉強できる時間を多く見積もる可能性があります。',
  },
  busy: {
    label: '授業以外の定期予定',
    impact:
      '未登録のアルバイトやサークルなどの時間は学習可能枠から除かれません。毎週の予定と学習が重なる可能性があります。',
  },
  exception: {
    label: '勉強できない特定の日・時間',
    impact:
      '未登録の旅行や外出などは計画に反映されません。勉強できない日や時間帯にも学習が入る可能性があります。',
  },
};
export function scheduleCount(s: Settings, kind: ScheduleKind): number {
  return kind === 'exception'
    ? s.exceptions.length
    : s.windows.filter((w) => w.kind === kind).length;
}
export function scheduleStatus(s: Settings, kind: ScheduleKind): ScheduleAnswer | 'unknown' {
  const answer = s.scheduleAnswers?.[kind];
  if (answer === 'deferred') return answer;
  // An explicit deferral remains visible even when only part of the data has been entered.
  if (scheduleCount(s, kind) > 0) return 'registered';
  if (answer === 'none') return answer;
  return 'unknown';
}
export interface SetupIssue {
  id: string;
  severity: 'error' | 'warning';
  title: string;
  impact: string;
  action: string;
  kind?: ScheduleKind;
  studyGap?: StudyCoverageGap;
  longTerm?: boolean;
}
export function setupIssues(s: Settings, from?: string): SetupIssue[] {
  const issues: SetupIssue[] = [];
  if (!s.exams.length)
    issues.push({
      id: 'exams',
      severity: 'error',
      title: '試験・目標が未登録です',
      impact: '期限と対象の試験が決まらないため、計画を作成できません。',
      action: '「試験・目標」で試験名と日付を登録してください。',
    });
  if (!s.materials.length)
    issues.push({
      id: 'materials',
      severity: 'error',
      title: '教材が未登録です',
      impact: '残り問題数と必要な学習量を計算できないため、計画を作成できません。',
      action: '「教材・進捗」で教材と問題数・推定時間を登録してください。',
    });
  if (!s.windows.some((w) => w.kind === 'study'))
    issues.push({
      id: 'study',
      severity: 'error',
      title: '勉強できる時間が未登録です',
      impact: '課題を置く時間枠がないため、計画を作成できません。',
      action: '「時間枠・時間割」で「勉強できる時間」を1件以上登録してください。',
    });
  const missingMeals = mealKeys.filter((key) => !s.meals?.[key]);
  if (s.windows.some((w) => w.kind === 'study'))
    for (const gap of studyCoverageGaps(s, from))
      issues.push({
        id: `study-period/${gap.examId}/${gap.from}/${gap.to}`,
        severity: 'warning',
        title: `${gap.examName}：${gap.from}〜${gap.to} の学習枠が未登録です`,
        impact: 'この期間は計算から除外され、登録済みの期間に学習が集中します。',
        action: isLongTermStudyGap(s, gap, from)
          ? '長期計画の一部が未設定です。登録済みの枠だけで全周回を配置するため、学習枠・周回数・目標日を見直してください。'
          : '春休みなどの学習枠を追加してください。意図して勉強しない期間なら、そのまま進められます。',
        studyGap: gap,
        longTerm: isLongTermStudyGap(s, gap, from),
      });
  if (missingMeals.length)
    issues.push({
      id: 'meals',
      severity: 'warning',
      title: '食事時間が未設定です',
      impact:
        missingMeals.map((key) => mealNames[key]).join('・') +
        'の時間を除外できず、可処分時間を多く見積もる可能性があります。',
      action: '「時間枠・時間割」の食事の質問に回答するか、対話式の再計画で設定してください。',
    });
  for (const kind of scheduleKinds) {
    const status = scheduleStatus(s, kind);
    if (status === 'deferred' || status === 'unknown')
      issues.push({
        id: kind,
        kind,
        severity: 'warning',
        title: `${scheduleInfo[kind].label}：${status === 'deferred' ? 'あとで設定' : '未確認'}`,
        impact: scheduleInfo[kind].impact,
        action:
          '計画は登録済みの情報だけで作成します。「時間枠・時間割」で入力・確認したあと、計画案を作り直してください。',
      });
  }
  return issues;
}
export function requirePlanningInputs(s: Settings) {
  const errors = setupIssues(s).filter((i) => i.severity === 'error');
  if (errors.length)
    throw new Error(errors.map((i) => `${i.title}。${i.impact}\n${i.action}`).join('\n'));
}
export function answerSchedule(
  state: AppState,
  kind: ScheduleKind,
  answer: ScheduleAnswer,
): AppState {
  if (answer === 'none' && scheduleCount(state.settings, kind) > 0)
    throw new Error('登録済みの予定があります。「登録内容を確認済みにする」を選んでください。');
  return {
    ...state,
    settings: {
      ...state.settings,
      scheduleAnswers: { ...state.settings.scheduleAnswers, [kind]: answer },
    },
    proposal: null,
  };
}
