import { expect, it } from 'vitest';
import { addDays, initialState } from '../src/domain/model';
import { generatePlan } from '../src/domain/planner/generate';
import { PlanningContext } from '../src/domain/planner/context';

const day = '2030-10-07';
const tomorrow = addDays(day, 1);
const context: PlanningContext = {
  date: day,
  minute: 720,
  timestamp: '2030-10-07T12:00:00+09:00',
  idPrefix: 'reason',
};

function fixture(minutes = 2, total = 15, slotMinutes = 20) {
  const state = initialState();
  state.settings.exams = [
    {
      id: 'exam',
      name: '試験',
      start: day,
      target: addDays(day, 2),
      priority: 2,
      color: '#287569',
      reviewDays: 0,
    },
  ];
  state.settings.materials = [
    {
      id: 'book',
      examId: 'exam',
      name: '問題集',
      total,
      order: 1,
      rounds: [{ completed: 0, minutes }],
    },
  ];
  state.settings.windows = slotMinutes
    ? [
        {
          id: 'window',
          name: '明日の枠',
          kind: 'study',
          from: tomorrow,
          to: tomorrow,
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          start: 1080,
          end: 1080 + slotMinutes,
        },
      ]
    : [];
  state.settings.buffer = 0;
  return state;
}

function plan(state: ReturnType<typeof fixture>) {
  return generatePlan(state, tomorrow, false, 0, 'balanced', context);
}

it('期限後は全15問・30分を未配置とし、期限を原因として示す', () => {
  const state = fixture();
  state.settings.exams[0].target = tomorrow;
  const result = plan(state);
  expect(result.sessions.filter((session) => session.kind === 'study')).toEqual([]);
  expect(result.shortfalls).toMatchObject([
    { materialId: 'book', round: 0, count: 15, minutes: 30 },
  ]);
  expect(result.shortfalls[0].reason).toContain('学習期限');
  expect(result.shortfalls[0].reason).toContain(day);
});

it('期限内に学習枠がなければ時間枠なしと示す', () => {
  const result = plan(fixture(2, 15, 0));
  expect(result.shortfalls[0]).toMatchObject({ count: 15, minutes: 30 });
  expect(result.shortfalls[0].reason).toContain('学習可能枠がありません');
});

it('20分の枠へ2分×10問だけ置き、未配置5問・10分を空き枠不足と示す', () => {
  const result = plan(fixture());
  expect(
    result.sessions
      .filter((session) => session.kind === 'study')
      .reduce((sum, session) => sum + session.count, 0),
  ).toBe(10);
  expect(result.shortfalls[0]).toMatchObject({ count: 5, minutes: 10 });
  expect(result.shortfalls[0].reason).toContain('空き枠は0分');
  expect(result.shortfalls[0].reason).toContain('必要時間は10分');
});

it('1問2分に対し連続枠が1分なら配分せず連続枠不足を示す', () => {
  const state = fixture();
  state.settings.block = 1;
  state.settings.rest = 1;
  const result = plan(state);
  expect(result.sessions.filter((session) => session.kind === 'study')).toEqual([]);
  expect(result.shortfalls[0]).toMatchObject({ count: 15, minutes: 30 });
  expect(result.shortfalls[0].reason).toContain('1問に必要な2分の連続学習枠');
});

it('20分枠でも週上限10分なら5問だけ置き、上限を原因として示す', () => {
  const state = fixture();
  state.settings.buffer = 0.5;
  const result = plan(state);
  expect(
    result.sessions
      .filter((session) => session.kind === 'study')
      .reduce((sum, session) => sum + session.count, 0),
  ).toBe(5);
  expect(result.shortfalls[0]).toMatchObject({ count: 10, minutes: 20 });
  expect(result.shortfalls[0].reason).toContain('週の割当上限');
});

it('先行教材が1問も置けないとき後続教材を飛ばさず、順序の根拠を示す', () => {
  const state = fixture(3, 1, 2);
  state.settings.materials.push({
    id: 'later',
    examId: 'exam',
    name: '後続',
    total: 1,
    order: 2,
    rounds: [{ completed: 0, minutes: 1 }],
  });
  const result = plan(state);
  expect(result.sessions.filter((session) => session.kind === 'study')).toEqual([]);
  expect(result.shortfalls.find((item) => item.materialId === 'later')).toMatchObject({
    count: 1,
    minutes: 1,
  });
  expect(result.shortfalls.find((item) => item.materialId === 'later')?.reason).toContain(
    '先行する「問題集」1周目',
  );
});
