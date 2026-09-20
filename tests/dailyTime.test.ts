import { describe, it, expect } from 'vitest';
import { initialState, defaultMeals } from '../src/domain/model';
import {
  capacityForDate,
  generatePlan,
  freeIntervalsForDate,
  validateSettings,
  propose,
  approve,
  proposeSettings,
  undoPlan,
} from '../src/domain/planner';
import { dailyTime } from '../src/domain/dailyTime';
import { overlapsBusy, stalePlan } from '../src/domain/planAudit';
import { settingChanges } from '../src/domain/revision';
const date = '2026-10-05';
function fixture() {
  const s = initialState();
  s.settings.exams = [
    {
      id: 'e',
      name: '試験',
      start: date,
      target: '2026-10-12',
      priority: 2,
      color: '#287569',
      reviewDays: 0,
    },
  ];
  s.settings.materials = [
    {
      id: 'm',
      examId: 'e',
      name: '教材',
      total: 137,
      order: 1,
      rounds: [{ completed: 0, minutes: 3 }],
    },
  ];
  s.settings.windows = [
    {
      id: 'w',
      kind: 'study',
      name: '日中',
      from: date,
      to: '2026-10-12',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 480,
      end: 1260,
    },
  ];
  s.settings.meals = structuredClone(defaultMeals);
  return s;
}
describe('食事・連続学習・1日の可処分時間', () => {
  it('時刻の内訳は学習・休憩をまとめ、予定をまたいで結合しない', () => {
    const s = fixture();
    const d = dailyTime(s.settings, date);
    expect(d.overview.filter((x) => x.kind === 'studyWindow').length).toBeLessThan(
      d.segments.filter((x) => ['available', 'rest'].includes(x.kind)).length,
    );
    expect(
      d.overview.filter((x) => x.kind === 'studyWindow').reduce((n, x) => n + x.end - x.start, 0),
    ).toBe(d.capacity.free);
    expect(d.overview.reduce((n, x) => n + x.end - x.start, 0)).toBe(1440);
    expect(d.overview.some((x) => x.kind === 'meal')).toBe(true);
  });
  it.each([5, 10, 11, 60])('授業間%d分のうち10分以下だけを移動として除く', (gap) => {
    const s = fixture();
    s.settings.meals = {};
    const base = s.settings.windows[0];
    s.settings.windows.push(
      { ...base, id: 'c1', kind: 'class', start: 540, end: 640 },
      { ...base, id: 'c1-duplicate', kind: 'class', start: 600, end: 640 },
      { ...base, id: 'c2', kind: 'class', start: 640 + gap, end: 740 + gap },
    );
    expect(capacityForDate(s.settings, date).free).toBe(780 - 200 - (gap <= 10 ? gap : 0));
    expect(freeIntervalsForDate(s.settings, date)).toContainEqual([740 + gap, 1260]);
    expect(
      freeIntervalsForDate(s.settings, date).some(([a, b]) => a === 640 && b === 640 + gap),
    ).toBe(gap > 10);
  });
  it('授業間の移動・授業前後の余白・他の予定を重複して差し引かない', () => {
    const s = fixture();
    s.settings.meals = {};
    s.settings.classTransition = 10;
    const base = s.settings.windows[0];
    s.settings.windows.push(
      { ...base, id: 'c1', kind: 'class', start: 540, end: 640 },
      { ...base, id: 'c2', kind: 'class', start: 650, end: 750 },
      { ...base, id: 'b', kind: 'busy', start: 640, end: 650 },
    );
    expect(freeIntervalsForDate(s.settings, date)).toEqual([
      [480, 530],
      [760, 1260],
    ]);
  });
  it('朝昼夜の食事を除外し、授業と重なっても一度だけ差し引く', () => {
    const s = fixture();
    s.settings.windows.push({
      ...s.settings.windows[0],
      id: 'c',
      kind: 'class',
      start: 700,
      end: 760,
    });
    expect(capacityForDate(s.settings, date).free).toBe(625);
    const plan = generatePlan(s, date);
    expect(plan.sessions.every((x) => overlapsBusy(s.settings, x).length === 0)).toBe(true);
    expect(
      plan.sessions.reduce((n, x) => n + x.count, 0) +
        plan.shortfalls.reduce((n, x) => n + x.count, 0),
    ).toBe(137);
  });
  it('最長120分＋休憩30分を繰り返し、旧日次60分上限を無視する', () => {
    const s = fixture();
    s.settings.meals = {};
    s.settings.windows[0].start = 540;
    s.settings.windows[0].end = 960;
    s.settings.block = 120;
    s.settings.rest = 30;
    s.settings.focus = 60;
    s.settings.buffer = 0.2;
    const c = capacityForDate(s.settings, date);
    expect(c.blocks).toEqual([
      [540, 660],
      [690, 810],
      [840, 960],
    ]);
    expect(c.focus).toBe(360);
    expect(c.allocatable).toBe(360);
  });
  it('日付をまたぐ食事を翌日の学習枠からも除く', () => {
    const s = fixture();
    s.settings.windows[0].start = 0;
    s.settings.windows[0].end = 1440;
    s.settings.meals = { dinner: { start: 1425, duration: 60 } };
    expect(freeIntervalsForDate(s.settings, date)).toEqual([[45, 1425]]);
    expect(dailyTime(s.settings, date).totals.meal).toBe(60);
  });
  it('24時間の内訳に日別余裕を作らず、可処分・休憩の関係が一致する', () => {
    const s = fixture();
    s.settings.windows.push({ ...s.settings.windows[0], id: 'duplicate' });
    s.settings.exceptions = [{ id: 'x', name: '昼の外出', date, start: 710, end: 770 }];
    const d = dailyTime(s.settings, date);
    expect(Object.values(d.totals).reduce((n, x) => n + x, 0)).toBe(1440);
    expect(d.totals.available + d.totals.rest).toBe(d.capacity.free);
    expect(d.totals.available).toBe(d.capacity.allocatable);
    expect(d.totals.available).toBe(d.capacity.focus);
    for (let i = 1; i < d.segments.length; i++)
      expect(d.segments[i].start).toBe(d.segments[i - 1].end);
  });
  it('休憩0分では連続時間の上限を守れないため案を作らない', () => {
    const s = fixture();
    s.settings.rest = 0;
    expect(() => generatePlan(s, date)).toThrow('休憩は1〜1440分');
  });
  it('日付の境界でも前日の学習枠から休憩を確保する', () => {
    const s = fixture();
    s.settings.meals = {};
    s.settings.block = 120;
    s.settings.rest = 30;
    s.settings.buffer = 0;
    s.settings.windows = [
      { ...s.settings.windows[0], start: 1380, end: 1440 },
      { ...s.settings.windows[0], id: 'morning', start: 0, end: 180 },
    ];
    const c = capacityForDate(s.settings, '2026-10-06');
    expect(c.blocks![0]).toEqual([30, 150]);
    expect(c.blocks!.every(([a, b]) => b - a <= 120)).toBe(true);
    expect(dailyTime(s.settings, '2026-10-06').totals.rest).toBe(60);
  });
  it('未設定の時間を可処分時間として数えない', () => {
    const s = initialState().settings;
    const d = dailyTime(s, date);
    expect(d.capacity.free).toBe(0);
    expect(d.totals.outside).toBe(1440);
  });
  it.each([29, 61, 30.5, NaN])('食事の長さ %s 分を拒否する', (duration) => {
    const s = fixture().settings;
    s.meals = { breakfast: { start: 480, duration } };
    expect(validateSettings(s).join('')).toContain('30〜60分');
  });
  it('以前の計算方式の計画・案は再計算を求める', () => {
    const s = propose(fixture(), date, 'test');
    delete s.proposal!.plan.calculationVersion;
    expect(stalePlan(s.proposal!.plan, s.settings)).toBe(true);
    expect(() => approve(s)).toThrow('計算方式');
  });
  it('食事の修正は承認まで反映せず、固定と記録を保持し、取消も実績を戻さない', () => {
    let s = approve(propose(fixture(), date, 'initial'));
    s.plan!.sessions[0].fixed = true;
    s.records = [
      {
        id: 'r',
        materialId: 'm',
        round: 0,
        date: '2026-10-04',
        count: 3,
        cancelled: false,
        createdAt: 'now',
        updatedAt: 'now',
      },
    ];
    const original = structuredClone(s);
    const settings = structuredClone(s.settings);
    settings.meals!.dinner = { start: 1200, duration: 60 };
    expect(settingChanges(s.settings, settings).join('')).toContain('夕食');
    s = proposeSettings(s, settings, date);
    expect(s.settings).toEqual(original.settings);
    s = approve(s);
    expect(s.settings.meals!.dinner).toEqual({ start: 1200, duration: 60 });
    expect(s.plan!.sessions).toContainEqual(original.plan!.sessions[0]);
    expect(s.records).toEqual(original.records);
    s = undoPlan(s);
    expect(s.plan).toEqual(original.plan);
    expect(s.records).toEqual(original.records);
  });
});
