import { expect, it } from 'vitest';
import { initialState, Session } from '../src/domain/model';
import { capacityForDate, generatePlan, proposeSettings } from '../src/domain/planning';
import { fixedTimeIssue } from '../src/domain/planConstraints';
import { beginConstraintRepair, releaseFixedAndRefresh } from '../src/domain/repairPlan';
import { beginRevision, RevisionDraft } from '../src/domain/revision';
const date = '2026-09-21';
function fixture() {
  const s = initialState();
  s.settings.block = 50;
  s.settings.rest = 10;
  s.settings.buffer = 0.2;
  s.settings.exams = [
    {
      id: 'e',
      name: '資格',
      start: date,
      target: '2026-09-25',
      priority: 2,
      color: '#123456',
      reviewDays: 0,
    },
  ];
  s.settings.materials = [
    {
      id: 'm',
      examId: 'e',
      name: '問題集',
      total: 20,
      rounds: [{ completed: 0, minutes: 2 }],
      order: 1,
    },
  ];
  s.settings.windows = [
    {
      id: 'w',
      name: '学習枠',
      kind: 'study',
      from: date,
      to: '2026-09-25',
      weekdays: [1, 2, 3, 4, 5],
      start: 540,
      end: 720,
    },
  ];
  s.plan = generatePlan(s, date);
  return s;
}
const session = (start: number, end: number): Session => ({
  id: 'fixed',
  date,
  start,
  end,
  examId: 'e',
  materialId: 'm',
  count: 5,
  round: 0,
  fixed: true,
  kind: 'study',
});
it('授業間の移動に重なる固定予定を保持し、時間割の修正へ案内する', () => {
  const s = fixture();
  const base = s.settings.windows[0];
  s.settings.windows.push(
    { ...base, id: 'c1', kind: 'class', start: 540, end: 640 },
    { ...base, id: 'c2', kind: 'class', start: 650, end: 750 },
  );
  const fixed = session(640, 650);
  s.plan!.sessions = [fixed];
  expect(fixedTimeIssue(s.settings, fixed, capacityForDate(s.settings, date))).toMatchObject({
    topic: 'class',
    itemId: '',
  });
  const p = generatePlan(s, date, true, 0);
  expect(p.sessions).toContainEqual(fixed);
  expect(p.conflicts.join('')).toContain('授業間の移動');
});
it('授業・食事・枠の外・連続上限・休憩を区別し、以前の日別余裕時間も使える', () => {
  const s = fixture();
  const issue = (a: number, b: number) =>
    fixedTimeIssue(s.settings, session(a, b), capacityForDate(s.settings, date))!;
  expect(issue(500, 520)).toMatchObject({ topic: 'study' });
  expect(issue(540, 610).message).toContain('上限は50分');
  expect(issue(585, 600)).toMatchObject({ topic: 'focus', index: 1 });
  expect(issue(665, 685)).toBeNull();
  s.settings.windows.push({
    ...s.settings.windows[0],
    id: 'c',
    kind: 'class',
    name: '経済学',
    start: 550,
    end: 650,
  });
  expect(issue(540, 560)).toMatchObject({ topic: 'class', itemId: 'c' });
  expect(issue(540, 560).message).toContain('経済学（09:10〜10:50）');
  s.settings.windows.pop();
  s.settings.meals = { lunch: { start: 600, duration: 30 } };
  expect(issue(600, 620)).toMatchObject({ topic: 'meal', index: 2 });
});
it('開始済みの固定・未固定を残すが、新しい枠の違反として承認を妨げない', () => {
  const s = fixture();
  s.plan!.sessions = [
    session(1047, 1067),
    { ...session(1060, 1080), id: 'elapsed-unfixed', fixed: false },
  ];
  const before = structuredClone(s);
  const p = generatePlan(s, date, true, 1140);
  expect(p.conflicts).toEqual([]);
  expect(p.sessions.filter((x) => x.date === date)).toEqual(before.plan!.sessions);
  expect(s).toEqual(before);
});
it('将来の固定予定の違反は原因を表示し、17.45時ではなく17:27で表示する', () => {
  const s = fixture();
  s.plan!.sessions = [session(1047, 1067)];
  const p = generatePlan(s, date, true, 0);
  expect(p.conflicts[0]).toContain('17:27〜17:47');
  expect(p.conflicts[0]).toContain('学習可能枠');
  expect(p.conflicts[0]).not.toContain('17.45時');
});
it('固定解除は対象だけに適用し、候補条件と実績を保って新しい案を作る', () => {
  let s = fixture();
  s.plan!.sessions = [session(540, 550), { ...session(600, 610), id: 'keep' }];
  s.records = [
    {
      id: 'r',
      materialId: 'm',
      round: 0,
      date,
      count: 0,
      cancelled: false,
      createdAt: '',
      updatedAt: '',
    },
  ];
  const candidate = structuredClone(s.settings);
  candidate.buffer = 0.1;
  s = proposeSettings(s, candidate, date);
  const before = structuredClone(s);
  const after = releaseFixedAndRefresh(s, 'fixed', date);
  expect(after.plan!.sessions.find((x) => x.id === 'fixed')!.fixed).toBe(false);
  expect(after.plan!.sessions.find((x) => x.id === 'keep')).toEqual(before.plan!.sessions[1]);
  expect(after.proposal!.plan.settingsSnapshot!.buffer).toBe(0.1);
  expect(after.records).toEqual(before.records);
  expect(after.settings).toEqual(before.settings);
  expect(s).toEqual(before);
});
it('修正ボタンは対応する質問を開き、編集中の条件を保つ', () => {
  const s = beginRevision(fixture());
  const draft = s.draft.revision as RevisionDraft;
  draft.settings.rest = 15;
  const after = beginConstraintRepair(s, {
    topic: 'focus',
    index: 3,
    itemId: '',
    message: '余裕率',
  });
  expect(after.draft.revision).toMatchObject({
    id: draft.id,
    stage: 'question',
    topic: 'focus',
    index: 3,
    settings: { rest: 15 },
  });
  expect(after.settings.rest).toBe(10);
  expect(after.plan).toEqual(s.plan);
});
