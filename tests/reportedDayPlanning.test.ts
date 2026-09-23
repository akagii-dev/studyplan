import { expect, it } from 'vitest';
import { addDays, initialState, remaining, reported } from '../src/domain/model';
import { correctProgress, recordProgress } from '../src/domain/progress';
import { approve, propose } from '../src/domain/planner/proposal';
import { PlanningContext } from '../src/domain/planner/context';

const date = '2030-10-07';
const tomorrow = addDays(date, 1);
const context: PlanningContext = {
  date,
  minute: 720,
  timestamp: '2030-10-07T12:00:00+09:00',
  idPrefix: 'reported-day',
};

function fixture(tomorrowAvailable = true) {
  const state = initialState();
  state.settings.exams = [
    {
      id: 'exam',
      name: '試験',
      start: date,
      target: addDays(date, 2),
      priority: 2,
      color: '#287569',
      reviewDays: 0,
    },
  ];
  state.settings.materials = [
    {
      id: 'book',
      examId: 'exam',
      name: '問題集B',
      total: 15,
      order: 1,
      rounds: [{ completed: 0, minutes: 2 }],
    },
  ];
  state.settings.windows = [
    {
      id: 'evening',
      name: '夕方',
      kind: 'study',
      from: date,
      to: tomorrowAvailable ? tomorrow : date,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 1080,
      end: 1140,
    },
  ];
  state.settings.buffer = 0;
  state.settings.scheduleAnswers = { class: 'none', busy: 'none', exception: 'none' };
  state.plan = {
    id: 'approved',
    createdAt: '2030-10-07T06:00:00+09:00',
    from: date,
    sessions: [
      {
        id: 'original',
        date,
        start: 1080,
        end: 1110,
        examId: 'exam',
        materialId: 'book',
        round: 0,
        count: 15,
        fixed: false,
        kind: 'study',
      },
    ],
    capacities: [],
    conflicts: [],
    shortfalls: [],
  };
  return state;
}

const report = (count: number) => ({
  id: 'report',
  date,
  materialId: 'book',
  round: 0,
  count,
  cancelled: false,
  createdAt: context.timestamp,
  updatedAt: context.timestamp,
});
const bookCount = (state: ReturnType<typeof fixture>, day: string) =>
  (state.proposal?.plan.sessions ?? [])
    .filter((session) => session.date === day && session.materialId === 'book')
    .reduce((sum, session) => sum + session.count, 0);

it('昼に0問を報告した問題集は同日の未来枠へ戻さず、翌日の15問へ配分する', () => {
  const state = recordProgress(fixture(), report(0));
  const before = structuredClone(state);
  const proposed = propose(state, date, '実績から調整', context);
  expect(bookCount(proposed, date)).toBe(0);
  expect(bookCount(proposed, tomorrow)).toBe(15);
  expect(proposed.proposal!.plan.shortfalls).toEqual([]);
  expect(proposed.records).toEqual(before.records);
  expect(proposed.plan).toEqual(before.plan);
  expect(remaining(proposed, 'book', 0)).toBe(15);
});

it('翌日に空き枠がなければ15問を未配置として残す', () => {
  const state = propose(recordProgress(fixture(false), report(0)), date, '実績から調整', context);
  expect(bookCount(state, date)).toBe(0);
  expect(state.proposal!.plan.shortfalls).toMatchObject([
    { materialId: 'book', round: 0, count: 15, minutes: 30 },
  ]);
});

it('5問へ訂正すると翌日に10問、取消後は未報告として当日にも配分できる', () => {
  let state = recordProgress(fixture(), report(0));
  state = correctProgress(state, 'report', 5);
  state = propose(state, date, '訂正後', context);
  expect(bookCount(state, date)).toBe(0);
  expect(bookCount(state, tomorrow)).toBe(10);
  expect(remaining(state, 'book', 0)).toBe(10);
  state = correctProgress(state, 'report', 5, true);
  expect(reported(state, date, 'book', 0)).toBe(false);
  state = propose(state, date, '取消後', context);
  expect(bookCount(state, date)).toBe(15);
});

it('報告済みの組だけを翌日に送り、未報告の別問題集は当日へ配置する', () => {
  const state = fixture();
  state.settings.materials.unshift({
    id: 'other',
    examId: 'exam',
    name: '問題集A',
    total: 5,
    order: 1,
    rounds: [{ completed: 0, minutes: 2 }],
  });
  state.settings.materials[1].order = 2;
  const proposed = propose(recordProgress(state, report(0)), date, '実績から調整', context);
  expect(bookCount(proposed, date)).toBe(0);
  expect(
    proposed
      .proposal!.plan.sessions.filter(
        (session) => session.date === date && session.materialId === 'other',
      )
      .reduce((sum, session) => sum + session.count, 0),
  ).toBe(5);
});

it('開始済みの当日予定は履歴として保持し、未完了分は後日に置く', () => {
  const state = fixture();
  state.settings.materials[0].total = 20;
  state.plan!.sessions.unshift({
    ...state.plan!.sessions[0],
    id: 'elapsed',
    start: 600,
    end: 610,
    count: 5,
  });
  const proposed = propose(recordProgress(state, report(0)), date, '実績から調整', context);
  expect(proposed.proposal!.plan.sessions).toContainEqual(state.plan!.sessions[0]);
  expect(bookCount(proposed, tomorrow)).toBe(20);
});

it('固定予定は残し、承認と再生成を繰り返しても実績や残量を重複計上しない', () => {
  const fixed = fixture();
  fixed.plan!.sessions[0].fixed = true;
  const fixedProposal = propose(recordProgress(fixed, report(0)), date, '固定を保持', context);
  expect(fixedProposal.proposal!.plan.sessions).toContainEqual(fixed.plan!.sessions[0]);
  expect(bookCount(fixedProposal, tomorrow)).toBe(0);

  let state = propose(recordProgress(fixture(), report(0)), date, '実績から調整', context);
  state = approve(state, false, context);
  expect(remaining(state, 'book', 0)).toBe(15);
  expect(state.records).toEqual([report(0)]);
  state = propose(state, date, '再生成', context);
  expect(bookCount(state, date)).toBe(0);
  expect(bookCount(state, tomorrow)).toBe(15);
  expect(state.proposal!.plan.shortfalls).toEqual([]);
});
