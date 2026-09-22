import { describe, expect, it } from 'vitest';
import { AppState, Plan, Progress, Session, initialState } from '../src/domain/model';
import { correctProgress, recordProgress } from '../src/domain/progress';
import {
  createProgressBaseline,
  pendingProgressReflection,
  proposalUsesCurrentProgress,
  reflectProgress,
  reflectProgressSafely,
  withProgressBaseline,
} from '../src/domain/progressReflection';

const dates = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
const session = (
  id: string,
  date: string,
  materialId = 'a',
  round = 0,
  count = 20,
  fixed = false,
): Session => ({
  id,
  date,
  start: 600,
  end: 600 + count * 3,
  examId: 'exam',
  materialId,
  round,
  count,
  fixed,
  kind: 'study',
});
const progress = (
  id: string,
  date: string,
  count: number,
  materialId = 'a',
  round = 0,
): Progress => ({
  id,
  date,
  materialId,
  round,
  count,
  cancelled: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});
function fixture(sessions: Session[] = dates.slice(0, 3).map((date, i) => session(`s${i}`, date))) {
  const state = initialState();
  state.settings.exams = [
    {
      id: 'exam',
      name: '試験',
      start: dates[0],
      target: '2026-12-31',
      priority: 2,
      color: '#246b62',
      reviewDays: 0,
    },
  ];
  state.settings.materials = [
    {
      id: 'a',
      examId: 'exam',
      name: '教材A',
      total: 100,
      order: 1,
      rounds: [
        { completed: 0, minutes: 3 },
        { completed: 0, minutes: 3 },
      ],
    },
    {
      id: 'b',
      examId: 'exam',
      name: '教材B',
      total: 100,
      order: 2,
      rounds: [{ completed: 0, minutes: 3 }],
    },
  ];
  const plan: Plan = {
    id: 'plan',
    createdAt: '2026-09-30T00:00:00.000Z',
    calculationVersion: 11,
    settingsSnapshot: structuredClone(state.settings),
    from: dates[0],
    sessions,
    capacities: [],
    shortfalls: [],
    conflicts: [],
  };
  plan.progressBaseline = createProgressBaseline(plan, state.records);
  state.plan = plan;
  return state;
}
const counts = (state: AppState) => state.plan!.sessions.map((item) => item.count);

describe('予定を超えた実績の前倒し反映', () => {
  it.each([false, true])(
    '訂正・取消後の導線は承認済み基準への取り込みで消える（取消=%s）',
    (cancel) => {
      let state = reflectProgress(recordProgress(fixture(), progress('r', dates[0], 30)));
      // A cancellation of an already incorporated record must also require review.
      if (cancel) state.plan!.progressBaseline = createProgressBaseline(state.plan!, state.records);
      state = reflectProgress(correctProgress(state, 'r', 25, cancel));
      expect(pendingProgressReflection(state)).toBeDefined();
      if (!cancel) {
        state = reflectProgress(correctProgress(state, 'r', 28));
        expect(pendingProgressReflection(state)).toBeDefined();
      }
      const candidate = structuredClone(state.plan!);
      candidate.id = 'new';
      candidate.progressBaseline = createProgressBaseline(candidate, state.records);
      state.proposal = { plan: candidate, basedOn: state.plan!.id, reason: 'test', unreported: [] };
      expect(pendingProgressReflection(state)).toBeDefined();
      state.proposal = null;
      expect(pendingProgressReflection(state)).toBeDefined();
      state.plan = candidate;
      expect(pendingProgressReflection(state)).toBeUndefined();
      expect(pendingProgressReflection(JSON.parse(JSON.stringify(state)))).toBeUndefined();
    },
  );
  it('予定20問に実績30問なら次の同一教材・同一周回だけを10問減らす', () => {
    let state = fixture();
    state = reflectProgress(recordProgress(state, progress('r1', dates[0], 30)), 'r1');
    expect(counts(state)).toEqual([20, 10, 20]);
    expect(state.records).toEqual([progress('r1', dates[0], 30)]);
    expect((state.draft.progressResult as { applied: number }).applied).toBe(10);
  });

  it('20問予定に10問、次の20問予定に30問なら累計どおりで先を減らさない', () => {
    let state = fixture();
    state = recordProgress(state, progress('r1', dates[0], 10));
    state = recordProgress(state, progress('r2', dates[1], 30));
    state = reflectProgress(state);
    expect(counts(state)).toEqual([20, 20, 20]);
    expect((state.draft.progressResult as { applied: number }).applied).toBe(0);
  });

  it('別教材・別周回・固定予定から引かない', () => {
    const sessions = [
      session('a0', dates[0]),
      session('fixed', dates[1], 'a', 0, 20, true),
      session('a1', dates[1], 'a', 1),
      session('b0', dates[1], 'b', 0),
    ];
    let state = fixture(sessions);
    state = reflectProgress(recordProgress(state, progress('r1', dates[0], 30)));
    expect(counts(state)).toEqual([20, 20, 20, 20]);
    const result = state.draft.progressResult as { fixedSessionIds: string[] };
    expect(result.fixedSessionIds).toEqual(['fixed']);
    expect(state.plan!.sessions.find((item) => item.id === 'fixed')!.fixed).toBe(true);
  });

  it('複数予定にまたがって反映し、周回完了と配置先なしを区別する', () => {
    let state = fixture();
    state = reflectProgress(recordProgress(state, progress('r1', dates[0], 55)));
    expect(counts(state)).toEqual([20, 0, 5]);
    expect((state.draft.progressResult as { applied: number }).applied).toBe(35);

    state = fixture([session('only', dates[0])]);
    state.settings.materials[0].total = 100;
    state.plan!.settingsSnapshot = structuredClone(state.settings);
    state = reflectProgress(recordProgress(state, progress('r2', dates[0], 30)));
    expect((state.draft.progressResult as { unplaced: unknown[] }).unplaced).toHaveLength(1);

    state = fixture([session('all', dates[0], 'a', 0, 100)]);
    state = reflectProgress(recordProgress(state, progress('r3', dates[0], 100)));
    expect((state.draft.progressResult as { completed: unknown[] }).completed).toHaveLength(1);
  });

  it('訂正・取消・同一ID再送・JSON再読込で二重に控除しない', () => {
    let state = fixture();
    const entry = progress('same', dates[0], 30);
    state = reflectProgress(recordProgress(state, entry));
    expect(counts(state)).toEqual([20, 10, 20]);
    state = reflectProgress(recordProgress(state, entry));
    expect(counts(state)).toEqual([20, 10, 20]);
    state = reflectProgress(correctProgress(state, 'same', 20));
    expect(counts(state)).toEqual([20, 20, 20]);
    state = reflectProgress(correctProgress(state, 'same', 20, true));
    expect(counts(state)).toEqual([20, 20, 20]);
    state = reflectProgress(JSON.parse(JSON.stringify(state)) as AppState);
    expect(counts(state)).toEqual([20, 20, 20]);
  });

  it('再計画に取り込み済みの記録は再度控除しない', () => {
    const state = fixture();
    state.records = [progress('already', dates[0], 30)];
    const plan = structuredClone(state.plan!);
    plan.progressBaseline = createProgressBaseline(plan, state.records);
    state.plan = plan;
    expect(counts(reflectProgress(state))).toEqual([20, 20, 20]);
    expect(proposalUsesCurrentProgress(plan, state.records)).toBe(true);
  });

  it('旧計画へ基準を補うとき、開始済みの予定を将来控除の対象にしない', () => {
    const state = fixture();
    delete state.plan!.progressBaseline;
    const prepared = withProgressBaseline(state, dates[1], 650);
    expect(Object.keys(prepared.plan!.progressBaseline!.sessions)).toEqual(['s2']);
  });

  it('未承認の周回数変更を保持し、自動承認しない', () => {
    let state = fixture();
    const candidate = structuredClone(state.settings);
    candidate.materials[0].rounds.push({ completed: 0, minutes: 3 });
    const proposalPlan = structuredClone(state.plan!);
    proposalPlan.id = 'proposal';
    proposalPlan.settingsSnapshot = candidate;
    state.proposal = {
      plan: proposalPlan,
      settingsBase: structuredClone(state.settings),
      basedOn: state.plan!.id,
      reason: '周回数変更',
      unreported: [],
    };
    const proposalBefore = structuredClone(state.proposal);
    state = withProgressBaseline(state);
    state = reflectProgress(recordProgress(state, progress('r1', dates[0], 30)));
    expect(state.settings.materials[0].rounds).toHaveLength(2);
    expect(state.proposal).toEqual(proposalBefore);
    expect(proposalUsesCurrentProgress(state.proposal!.plan, state.records)).toBe(false);
  });

  it('前倒し反映に失敗しても、保存可能な実績を失わない', () => {
    let state = fixture();
    state.plan!.progressBaseline!.records['壊れた基準'] = 1;
    const saved = recordProgress(state, progress('kept', dates[0], 30));
    state = reflectProgressSafely(saved, 'kept');
    expect(state.records).toContainEqual(progress('kept', dates[0], 30));
    expect((state.draft.progressResult as { error: string }).error).toContain(
      '予定への前倒し反映に失敗しました',
    );
  });
});
