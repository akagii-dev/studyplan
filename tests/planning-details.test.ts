import { describe, it, expect } from 'vitest';
import { initialState, addDays } from '../src/domain/model';
import {
  approve,
  capacityForDate,
  freeIntervalsForDate,
  generatePlan,
  propose,
} from '../src/domain/planning';
import { overlapsBusy, stalePlan } from '../src/domain/planAudit';
import { parseNumberInput } from '../src/domain/numeric';

const date = '2026-10-05'; // Monday
function fixture() {
  const state = initialState();
  state.settingsUpdatedAt = '2026-09-20T10:30:00Z';
  state.settings.exams = [
    {
      id: 'exam',
      name: '試験',
      start: date,
      target: addDays(date, 7),
      priority: 2,
      color: '#287569',
      reviewDays: 0,
    },
  ];
  state.settings.materials = [
    {
      id: 'book',
      name: '教材',
      examId: 'exam',
      order: 1,
      total: 37,
      rounds: [{ completed: 0, minutes: 2 }],
    },
  ];
  state.settings.windows = [
    {
      id: 'study',
      name: '午前',
      kind: 'study',
      from: date,
      to: addDays(date, 30),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 540,
      end: 780,
    },
  ];
  return state;
}
describe('時間割の除外と計画の条件表示', () => {
  it('100分の授業と重複する予定を一度だけ除き、全セッションを学習枠内に置く', () => {
    const s = fixture();
    s.settings.windows.push(
      {
        ...s.settings.windows[0],
        id: 'class',
        kind: 'class',
        name: '授業',
        end: 640,
        weekdays: [1],
      },
      {
        ...s.settings.windows[0],
        id: 'busy',
        kind: 'busy',
        name: '移動',
        start: 600,
        end: 670,
        weekdays: [1],
      },
    );
    expect(freeIntervalsForDate(s.settings, date)).toEqual([[670, 780]]);
    expect(capacityForDate(s.settings, date).free).toBe(110);
    const plan = generatePlan(s, date);
    expect(plan.sessions.every((x) => !overlapsBusy(s.settings, x).length)).toBe(true);
    expect(
      plan.sessions.reduce((n, x) => n + x.count, 0) +
        plan.shortfalls.reduce((n, x) => n + x.count, 0),
    ).toBe(37);
    expect(freeIntervalsForDate(s.settings, addDays(date, 1))).toEqual([[540, 780]]);
    expect(plan.settingsSnapshot).toEqual(s.settings);
    expect(plan.settingsUpdatedAt).toBe(s.settingsUpdatedAt);
    s.settings.windows[0].end = 700;
    expect(plan.settingsSnapshot!.windows[0].end).toBe(780);
    expect(stalePlan(plan, s.settings)).toBe(true);
  });
  it('授業の適用期間の外は差し引かない', () => {
    const s = fixture();
    s.settings.windows.push({
      ...s.settings.windows[0],
      id: 'class',
      kind: 'class',
      end: 640,
      to: date,
    });
    expect(capacityForDate(s.settings, date).free).toBe(140);
    expect(capacityForDate(s.settings, addDays(date, 7)).free).toBe(240);
  });
  it('授業追加後の古い案は承認できず、新案では授業を避ける', () => {
    let s = propose(fixture(), date, 'test');
    s.settings.windows.push({ ...s.settings.windows[0], id: 'class', kind: 'class', end: 640 });
    expect(() => approve(s)).toThrow('設定が変わっています');
    s = propose(s, date, 'test');
    expect(approve(s).plan!.sessions.every((x) => !overlapsBusy(s.settings, x).length)).toBe(true);
  });
  it('0%参考計算は連続時間と授業・固定を守り、設定と実績を書き換えない', () => {
    const s = fixture();
    s.settings.focus = 60;
    s.settings.block = 60;
    s.settings.buffer = 0.3;
    s.settings.windows.push({ ...s.settings.windows[0], id: 'class', kind: 'class', end: 640 });
    s.plan = generatePlan(s, date);
    s.plan.sessions[0].fixed = true;
    const original = structuredClone(s);
    const reference = generatePlan(
      { ...s, settings: { ...s.settings, buffer: 0 } },
      date,
      true,
      0,
      'earliest',
    );
    expect(s).toEqual(original);
    expect(reference.sessions).toContainEqual(s.plan.sessions[0]);
    expect(reference.sessions.every((x) => !overlapsBusy(s.settings, x).length)).toBe(true);
    for (const c of reference.capacities)
      expect(
        reference.sessions
          .filter((x) => x.date === c.date)
          .reduce((n, x) => n + x.end - x.start, 0),
      ).toBeLessThanOrEqual(c.allocatable);
    expect(reference.shortfalls).toHaveLength(0);
    expect(reference.sessions.reduce((n, x) => n + x.count, 0)).toBe(37);
    expect(reference.sessions.at(-1)!.date).toBe(date);
    expect(s.plan.sessions.at(-1)!.date > date).toBe(true);
    expect(s.plan.sessions.at(-1)!.date < s.settings.exams[0].target).toBe(true);
  });
});
describe('Enter時の数値検証', () => {
  it.each(['', ' ', 'abc', '1e2', 'NaN', 'Infinity', '1.5'])(
    '整数として %j を確定できない',
    (text) => expect(() => parseNumberInput(text, 0)).toThrow(),
  );
  it('0・3・7と小数の所要時間を保持する', () => {
    for (const n of [0, 3, 7]) expect(parseNumberInput(String(n), 0, 7)).toBe(n);
    expect(parseNumberInput('1.3', 0.1, undefined, 0.1)).toBe(1.3);
    expect(() => parseNumberInput('8', 0, 7)).toThrow('7以下');
    expect(() => parseNumberInput('-1', 0)).toThrow('0以上');
  });
});
