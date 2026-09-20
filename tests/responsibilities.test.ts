import { describe, expect, it, vi } from 'vitest';
import * as model from '../src/domain/model';
import { initialWizard } from '../src/components/guided-setup/model';
import {
  advanceQuestion,
  moveTo,
  previousQuestion,
  skipRemaining,
} from '../src/components/guided-setup/transitions';
import { generatePlan } from '../src/domain/planner/generate';
import { proposeSettings, approve } from '../src/domain/planner/proposal';
import { PlanningContext } from '../src/domain/planner/context';
import { studentFixture } from './fixtures/student';
import { mealEvents } from '../src/domain/mealEvents';
import { commuteEvents } from '../src/domain/commute';
import { addDays } from '../src/domain/model';

const date = '2030-10-07';
const context: PlanningContext = {
  date,
  minute: 360,
  timestamp: date + 'T06:00:00+09:00',
  idPrefix: 'test',
};
describe('責任分離後の純粋な計算・遷移', () => {
  it('提案と承認は依存先を含め端末の現在日・ランダムIDを取得しない', () => {
    const state = studentFixture(date);
    const fail = () => {
      throw new Error('環境依存の値を計算から取得しています');
    };
    vi.spyOn(model, 'today').mockImplementation(fail);
    vi.spyOn(model, 'uid').mockImplementation(fail);
    try {
      const p = proposeSettings(state, state.settings, date, context);
      expect(approve(p, true, context).plan).not.toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });
  it('同じ入力と日時・IDで同一の計画・承認結果になり、入力は変更しない', () => {
    const state = studentFixture(date);
    const before = structuredClone(state);
    const a = generatePlan(state, date, false, 360, 'balanced', context);
    expect(generatePlan(state, date, false, 360, 'balanced', context)).toEqual(a);
    const p = proposeSettings(state, state.settings, date, context);
    expect(approve(p, true, context)).toEqual(approve(p, true, context));
    expect(state).toEqual(before);
    expect(new Set(a.sessions.map((s) => s.id)).size).toBe(a.sessions.length);
  });
  it('周回質問は全周を進んでから次へ進み、戻ると周回も戻る', () => {
    let state = studentFixture(date);
    let w = { ...initialWizard(state), step: 'material.completed' as const };
    state = advanceQuestion(state, w, 'guided');
    const second = state.draft.guided as typeof w;
    expect(second.step).toBe('material.completed');
    expect(second.roundIndex).toBe(1);
    expect(previousQuestion(second)).toEqual(w);
    state = advanceQuestion(state, second, 'guided');
    expect(state.draft.guided).toMatchObject({ step: 'material.minutes', roundIndex: 0 });
    w = { ...w, roundIndex: 0 };
    expect(moveTo(w, 'material.order').trail.at(-1)).toEqual({
      step: 'material.completed',
      roundIndex: 0,
    });
  });
  it('一括スキップで変更した教材だけを保存し、未変更の設定・実績・計画は維持する', () => {
    const state = studentFixture(date);
    state.plan = generatePlan(state, date, false, 360, 'balanced', context);
    const w = initialWizard(state);
    w.step = 'material.name';
    w.material = { ...w.material, name: '変更した名前' };
    const result = skipRemaining(state, w);
    expect(result.settings).toEqual({
      ...state.settings,
      materials: state.settings.materials.map((m, i) => (i ? m : { ...m, name: '変更した名前' })),
    });
    expect(result.plan).toEqual(state.plan);
    expect(result.records).toEqual(state.records);
    expect(result.draft.guided).toMatchObject({ step: 'finish' });
    expect(state.settings.materials[0].name).not.toBe('変更した名前');
    expect(() => skipRemaining(state, { ...w, material: { ...w.material, total: 0 } })).toThrow();
  });
  it('授業期間の修正は遷移時にだけ当該期間へ適用する', () => {
    const state = studentFixture(date),
      w = initialWizard(state);
    const rule = state.settings.windows.find((x) => x.kind === 'class')!;
    Object.assign(w, {
      step: 'class.period',
      classFrom: rule.from,
      classTo: addDays(rule.to, 3),
      classEditingPeriod: { from: rule.from, to: rule.to },
    });
    const next = advanceQuestion(state, w, 'guided');
    expect(
      next.settings.windows.filter((x) => x.kind === 'class').every((x) => x.to === w.classTo),
    ).toBe(true);
    expect(next.settings.windows.filter((x) => x.kind !== 'class')).toEqual(
      state.settings.windows.filter((x) => x.kind !== 'class'),
    );
    expect((next.draft.guided as typeof w).step).toBe('class.times');
  });
});
describe('通学と食事の両立不可', () => {
  it('日またぎの復路にも食事が重ならず、食事の長さを削らない', () => {
    const s = studentFixture(date).settings;
    Object.assign(s.commute!, {
      mode: 'weekdays',
      weekdays: [1],
      from: date,
      to: date,
      returnStart: 1430,
      returnMinutes: 50,
    });
    s.meals = { dinner: { start: 1420, duration: 60 } };
    expect(mealEvents(s, date).filter((m) => m.id === 'meal-dinner')).toEqual([]);
    expect(mealEvents(s, addDays(date, 1))).toContainEqual(
      expect.objectContaining({ start: 40, end: 100, adjusted: true }),
    );
    for (const d of [date, addDays(date, 1)])
      for (const m of mealEvents(s, d))
        expect(commuteEvents(s, d).some((c) => c.start < m.end && m.start < c.end)).toBe(false);
  });
  it('食事同士に調整が波及しても、各食事を全て確保する', () => {
    const s = studentFixture(date).settings;
    s.meals = { lunch: { start: 750, duration: 60 }, dinner: { start: 810, duration: 30 } };
    const meals = mealEvents(s, date);
    expect(meals.map((m) => [m.start, m.end])).toEqual([
      [800, 860],
      [860, 890],
    ]);
  });
  it('授業のない日・通学無効・重ならない食事は設定時刻を維持する', () => {
    const s = studentFixture(date).settings;
    s.meals = { lunch: { start: 750, duration: 60 } };
    expect(mealEvents(s, addDays(date, 5))[0]).toMatchObject({
      start: 750,
      end: 810,
      adjusted: false,
    });
    s.commute!.enabled = false;
    expect(mealEvents(s, date)[0]).toMatchObject({ start: 750, end: 810, adjusted: false });
  });
});
