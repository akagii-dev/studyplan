import { expect, it } from 'vitest';
import { addDays, initialState, remaining, reported } from '../src/domain/model';
import { PLAN_CALCULATION_VERSION } from '../src/domain/sessionPolicy';
import { createProgressBaseline } from '../src/domain/progressReflection';
import {
  adjustAfterProgress,
  correctAndAdjust,
  currentProgressAdjustment,
  recordAndAdjust,
} from '../src/domain/progressAdjustment';
import { PlanningContext } from '../src/domain/planner/context';
import { approve, propose } from '../src/domain/planner/proposal';

const day = '2030-10-07';
const next = addDays(day, 1);
const context: PlanningContext = {
  date: day,
  minute: 720,
  timestamp: '2030-10-07T12:00:00+09:00',
  idPrefix: 'auto',
};

function fixture(nextEnd = 1140) {
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
      total: 20,
      order: 1,
      rounds: [{ completed: 0, minutes: 2 }],
    },
  ];
  state.settings.windows = [
    {
      id: 'today',
      name: '今日',
      kind: 'study',
      from: day,
      to: day,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 1080,
      end: 1140,
    },
    {
      id: 'tomorrow',
      name: '明日',
      kind: 'study',
      from: next,
      to: next,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 1080,
      end: nextEnd,
    },
  ];
  state.settings.buffer = 0;
  state.settings.scheduleAnswers = { class: 'none', busy: 'none', exception: 'none' };
  state.plan = {
    id: 'approved',
    createdAt: '2030-10-07T06:00:00+09:00',
    calculationVersion: PLAN_CALCULATION_VERSION,
    settingsSnapshot: structuredClone(state.settings),
    from: day,
    sessions: [
      {
        id: 'today',
        date: day,
        start: 1080,
        end: 1100,
        examId: 'exam',
        materialId: 'book',
        round: 0,
        count: 10,
        fixed: false,
        kind: 'study',
      },
      {
        id: 'tomorrow',
        date: next,
        start: 1080,
        end: 1100,
        examId: 'exam',
        materialId: 'book',
        round: 0,
        count: 10,
        fixed: false,
        kind: 'study',
      },
    ],
    capacities: [],
    shortfalls: [],
    conflicts: [],
  };
  state.plan.progressBaseline = createProgressBaseline(state.plan, state.records);
  return state;
}

const report = (count: number, id = 'report') => ({
  id,
  date: day,
  materialId: 'book',
  round: 0,
  count,
  cancelled: false,
  createdAt: context.timestamp,
  updatedAt: context.timestamp,
});
const future = (state: ReturnType<typeof fixture>) =>
  state
    .plan!.sessions.filter((session) => session.date === next && session.materialId === 'book')
    .reduce((sum, session) => sum + session.count, 0);
const today = (state: ReturnType<typeof fixture>) =>
  state
    .plan!.sessions.filter((session) => session.date === day && session.materialId === 'book')
    .reduce((sum, session) => sum + session.count, 0);

it.each([
  [0, 20],
  [5, 15],
  [10, 10],
  [15, 5],
])('今日%1問を記録すると過去の予定10問を保ち、翌日へ%2問を自動配置する', (done, expected) => {
  const original = fixture();
  const state = recordAndAdjust(original, report(done), context);
  expect(currentProgressAdjustment(state)?.status).toBe('applied');
  expect(today(state)).toBe(10);
  expect(future(state)).toBe(expected);
  expect(remaining(state, 'book', 0)).toBe(expected);
  expect(state.records).toEqual([report(done)]);
  expect(original.records).toEqual([]);
  expect(original.plan!.sessions).toHaveLength(2);
});

it('明示0と未入力を区別し、訂正8問・取消後も残量と未来を再算出する', () => {
  let state = fixture();
  expect(reported(state, day, 'book', 0)).toBe(false);
  state = recordAndAdjust(state, report(0), context);
  expect(reported(state, day, 'book', 0)).toBe(true);
  state = correctAndAdjust(state, 'report', 8, false, context);
  expect(future(state)).toBe(12);
  expect(remaining(state, 'book', 0)).toBe(12);
  state = correctAndAdjust(state, 'report', 8, true, context);
  expect(reported(state, day, 'book', 0)).toBe(false);
  expect(future(state)).toBe(20);
  expect(remaining(state, 'book', 0)).toBe(20);
  expect(state.records[0].cancelled).toBe(true);
  expect(today(state)).toBe(10);
});

it('翌日の容量不足を5問・10分の未配置として残す', () => {
  const state = recordAndAdjust(fixture(1100), report(5), context);
  expect(future(state)).toBe(10);
  expect(state.plan!.shortfalls).toMatchObject([
    { materialId: 'book', round: 0, count: 5, minutes: 10 },
  ]);
  expect(currentProgressAdjustment(state)).toMatchObject({
    status: 'applied',
    unplacedCount: 5,
    unplacedMinutes: 10,
  });
});

it('残量を超える固定予定は保持し、実績を保存して案を確認待ちにする', () => {
  const state = fixture();
  state.plan!.sessions[1].fixed = true;
  const changed = recordAndAdjust(state, report(15), context);
  expect(changed.records).toEqual([report(15)]);
  expect(changed.plan!.sessions[1]).toEqual(state.plan!.sessions[1]);
  expect(changed.proposal).toBeNull();
  expect(currentProgressAdjustment(changed)?.status).toBe('review');
  const recovered = correctAndAdjust(changed, 'report', 5, false, context);
  expect(currentProgressAdjustment(recovered)?.status).toBe('applied');
  expect(recovered.plan!.sessions.find((session) => session.id === 'tomorrow')?.count).toBe(10);
  expect(recovered.records[0].count).toBe(5);
});

it('保留案・設定変更を守り、実績だけは保存する', () => {
  const pending = fixture();
  pending.proposal = {
    plan: structuredClone(pending.plan!),
    basedOn: 'approved',
    reason: '設定変更',
    unreported: [],
  };
  const preserved = recordAndAdjust(pending, report(5), context);
  expect(preserved.proposal).toEqual(pending.proposal);
  expect(preserved.records).toEqual([report(5)]);
  expect(currentProgressAdjustment(preserved)?.status).toBe('review');
  const stale = fixture();
  stale.settings.buffer = 0.2;
  const result = recordAndAdjust(stale, report(5), context);
  expect(result.plan).toEqual(stale.plan);
  expect(result.records).toEqual([report(5)]);
  expect(currentProgressAdjustment(result)?.status).toBe('review');
});

it('保留案の破棄だけでは確認待ちを残し、現在の実績を含む案の承認で解消する', () => {
  const pending = fixture();
  pending.proposal = {
    plan: structuredClone(pending.plan!),
    basedOn: 'approved',
    reason: '設定案',
    unreported: [],
  };
  const recorded = recordAndAdjust(pending, report(5), context);
  expect(currentProgressAdjustment(recorded)?.status).toBe('review');
  const discarded = { ...recorded, proposal: null };
  expect(currentProgressAdjustment(discarded)?.status).toBe('review');
  const current = propose(discarded, next, '現在の残量から作り直す', context);
  const approved = approve(current, true, context);
  expect(approved.records).toEqual([report(5)]);
  expect(future(approved)).toBe(15);
  expect(currentProgressAdjustment(approved)).toBeUndefined();
});

it('同じ報告IDの再送と同条件での再算出は予定・残量・履歴を重複させない', () => {
  let state = recordAndAdjust(fixture(), report(5), context);
  const once = structuredClone(state);
  state = recordAndAdjust(state, report(5), context);
  expect(state).toEqual(once);
  state = adjustAfterProgress(state, 'report', context);
  expect(future(state)).toBe(15);
  expect(remaining(state, 'book', 0)).toBe(15);
  expect(state.records).toEqual([report(5)]);
  expect(state.history).toEqual(once.history);
  expect(JSON.parse(JSON.stringify(state)).records).toEqual([report(5)]);
});

it('自動調整しても途中の設定見直し下書きを消さない', () => {
  const state = fixture();
  state.draft.revision = { step: 'material.minutes', materialId: 'book' };
  const nextState = recordAndAdjust(state, report(5), context);
  expect(currentProgressAdjustment(nextState)?.status).toBe('applied');
  expect(nextState.draft.revision).toEqual(state.draft.revision);
});

it('今日が最終学習日なら今日の固定・可動・旧0問予定を残し、全残量を未配置にする', () => {
  const state = fixture();
  state.settings.exams[0].target = next;
  state.plan!.settingsSnapshot = structuredClone(state.settings);
  state.plan!.sessions.push({
    ...state.plan!.sessions[0],
    id: 'today-zero',
    count: 0,
    start: 1000,
    end: 1000,
    fixed: true,
  });
  state.plan!.sessions.push({
    ...state.plan!.sessions[0],
    id: 'today-fixed',
    count: 0,
    start: 1200,
    end: 1200,
    fixed: true,
  });
  const expectedToday = structuredClone(state.plan!.sessions.filter((session) => session.date === day));
  const changed = recordAndAdjust(state, report(5), context);
  expect(changed.plan!.sessions.filter((session) => session.date === day)).toEqual(expectedToday);
  expect(changed.plan!.shortfalls).toMatchObject([
    { materialId: 'book', round: 0, count: 15, minutes: 30 },
  ]);
  expect(future(changed)).toBe(0);
  expect(changed.records).toEqual([report(5)]);
});

it('保存形式のJSON往復で実績・計画・設定を維持する', () => {
  const changed = recordAndAdjust(fixture(), report(5), context);
  const reloaded = JSON.parse(JSON.stringify(changed));
  expect(reloaded.records).toEqual(changed.records);
  expect(reloaded.plan).toEqual(changed.plan);
  expect(reloaded.settings).toEqual(changed.settings);
  expect(future(reloaded)).toBe(15);
});
