import { describe, expect, it } from 'vitest';
import { initialState } from '../src/domain/model';
import {
  answerSchedule,
  requirePlanningInputs,
  scheduleKinds,
  scheduleStatus,
  setupIssues,
} from '../src/domain/setupIssues';
import { approve, capacityForDate, propose } from '../src/domain/planning';
function ready() {
  const state = initialState();
  state.settings.exams = [
    {
      id: 'e',
      name: '試験',
      start: '2026-10-01',
      target: '2026-10-10',
      priority: 2,
      color: '#287569',
      reviewDays: 0,
    },
  ];
  state.settings.materials = [
    {
      id: 'm',
      examId: 'e',
      name: '問題集',
      total: 7,
      order: 1,
      rounds: [{ completed: 0, minutes: 2 }],
    },
  ];
  state.settings.windows = [
    {
      id: 'w',
      name: '学習',
      from: '2026-10-01',
      to: '2026-10-10',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 600,
      end: 780,
      kind: 'study',
    },
  ];
  return state;
}
describe('未設定情報による影響', () => {
  it('必須情報の不足は理由と解決方法付きのエラーになる', () => {
    const issues = setupIssues(initialState().settings);
    expect(issues.filter((i) => i.severity === 'error').map((i) => i.id)).toEqual([
      'exams',
      'materials',
      'study',
    ]);
    expect(() => requirePlanningInputs(initialState().settings)).toThrow('課題を置く時間枠がない');
    expect(issues.every((i) => i.impact && i.action)).toBe(true);
  });
  it('以前のデータで未回答の項目を「予定なし」とみなさない', () => {
    const s = ready();
    expect(scheduleStatus(s.settings, 'class')).toBe('unknown');
    expect(setupIssues(s.settings).filter((i) => i.severity === 'warning')).toHaveLength(4);
  });
  it('予定なしとあとで設定を区別する', () => {
    let s = answerSchedule(ready(), 'busy', 'none');
    expect(setupIssues(s.settings).some((i) => i.kind === 'busy')).toBe(false);
    s = answerSchedule(s, 'busy', 'deferred');
    expect(setupIssues(s.settings).find((i) => i.kind === 'busy')?.title).toContain('あとで設定');
  });
  it('各項目の具体的な影響を明示する', () => {
    const issues = setupIssues(ready().settings);
    expect(issues.find((i) => i.kind === 'class')?.impact).toContain('授業中に学習');
    expect(issues.find((i) => i.kind === 'busy')?.impact).toContain('毎週の予定と学習が重なる');
    expect(issues.find((i) => i.kind === 'exception')?.impact).toContain('勉強できない日や時間帯');
  });
  it('一部を入力しても明示的な延期は確認完了まで残る', () => {
    let s = answerSchedule(ready(), 'class', 'deferred');
    s.settings.windows.push({ ...s.settings.windows[0], id: 'class', kind: 'class' });
    expect(scheduleStatus(s.settings, 'class')).toBe('deferred');
    expect(() => answerSchedule(s, 'class', 'none')).toThrow();
    s = answerSchedule(s, 'class', 'registered');
    expect(setupIssues(s.settings).some((i) => i.kind === 'class')).toBe(false);
  });
  it('全項目で予定なしを確認したら注意を消せる', () => {
    let s = ready();
    for (const k of scheduleKinds) s = answerSchedule(s, k, 'none');
    expect(setupIssues(s.settings).map((i) => i.id)).toEqual(['meals']);
  });
  it('注意があっても容量を勝手に変えず計画を承認できる', () => {
    let s = ready();
    const before = capacityForDate(s.settings, '2026-10-01');
    s = answerSchedule(s, 'busy', 'deferred');
    expect(capacityForDate(s.settings, '2026-10-01')).toEqual(before);
    expect(approve(propose(s, '2026-10-01', '確認')).plan).not.toBeNull();
  });
  it('確認状況の変更は承認済み計画と実績を変更せず古い案だけ破棄する', () => {
    let s = approve(propose(ready(), '2026-10-01', '初回'));
    s = propose(s, '2026-10-01', '再計画');
    const next = answerSchedule(s, 'exception', 'none');
    expect(next.plan).toEqual(s.plan);
    expect(next.records).toEqual(s.records);
    expect(next.proposal).toBeNull();
  });
});
