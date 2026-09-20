import { describe, expect, it } from 'vitest';
import { addDays, initialState, Session } from '../src/domain/model';
import { startOfWeek } from '../src/domain/calendar';
import {
  capacityForDate,
  capacityForWeek,
  generatePlan,
  approve,
  propose,
  undoPlan,
} from '../src/domain/planning';
import { dailyTime } from '../src/domain/dailyTime';
const monday = '2030-10-07';
function fixture() {
  const s = initialState();
  s.settings.block = 120;
  s.settings.rest = 10;
  s.settings.buffer = 0.2;
  s.settings.exams = [
    {
      id: 'e',
      name: '試験',
      start: monday,
      target: addDays(monday, 6),
      priority: 1,
      color: '#287569',
      reviewDays: 0,
    },
  ];
  s.settings.materials = [
    {
      id: 'm',
      examId: 'e',
      name: '教材',
      total: 4000,
      rounds: [{ completed: 0, minutes: 1 }],
      order: 1,
    },
  ];
  s.settings.windows = [
    {
      id: 'w',
      kind: 'study',
      name: '学習',
      from: monday,
      to: addDays(monday, 30),
      weekdays: [1, 2, 3, 4, 5],
      start: 540,
      end: 920,
    },
  ];
  return s;
}
function session(date: string, start: number, end: number, fixed = true): Session {
  return {
    id: `${date}-${start}`,
    date,
    start,
    end,
    fixed,
    kind: 'study',
    count: end - start,
    examId: 'e',
    materialId: 'm',
    round: 0,
  };
}
describe('週全体の余裕率', () => {
  it('余裕率を変更しても日別の枠と休憩位置は変わらない', () => {
    const s = fixture();
    const daily = capacityForDate(s.settings, monday);
    for (const buffer of [0, 0.1, 0.3, 0.99])
      expect(capacityForDate({ ...s.settings, buffer }, monday)).toEqual(daily);
  });
  it('上限を超えた過去の予定を変更せず、その週に追加配置しない', () => {
    const s = fixture();
    s.settings.buffer = 0;
    s.plan = generatePlan(s, monday, false, 0, 'earliest');
    s.settings.buffer = 0.5;
    const before = s.plan.sessions.filter((x) => x.date < addDays(monday, 3));
    const p = generatePlan(s, addDays(monday, 3));
    expect(p.sessions).toEqual(before);
    expect(p.conflicts).toEqual([]);
    expect(p.shortfalls.length).toBeGreaterThan(0);
  });
  it('競合メッセージの欠落した案でも承認時に週上限を検証する', () => {
    const s = fixture();
    s.settings.buffer = 0;
    const n = propose(s, monday, 'test');
    n.settings.buffer = 0.2;
    n.proposal!.plan.settingsSnapshot!.buffer = 0.2;
    n.proposal!.plan.conflicts = [];
    expect(() => approve(n)).toThrow('週の割当上限');
  });
  it('30時間の週を24時間まで使い、日ごとの6時間を削らない', () => {
    const s = fixture();
    const c = capacityForDate(s.settings, monday);
    expect(c.focus).toBe(360);
    expect(c.slots).toEqual([
      [540, 660],
      [670, 790],
      [800, 920],
    ]);
    expect(c.allocatable).toBe(360);
    expect(capacityForWeek(s.settings, monday)).toMatchObject({ focus: 1800, limit: 1440 });
    const p = generatePlan(s, monday, false, 0, 'earliest');
    expect(capacityForWeek(s.settings, monday, p.sessions).used).toBe(1440);
    expect(
      p.sessions.filter((x) => x.date === monday).reduce((n, x) => n + x.end - x.start, 0),
    ).toBe(360);
    expect(p.sessions.some((x) => x.date === addDays(monday, 4))).toBe(false);
    expect(p.shortfalls.reduce((n, x) => n + x.count, 0)).toBe(2560);
    const d = dailyTime(s.settings, monday);
    expect(d.totals.rest).toBe(20);
    expect(d.totals.available).toBe(360);
    expect(Object.keys(d.totals)).not.toContain('buffer');
  });
  it('期限前の一日に日割り上限を超えて配置できる', () => {
    const s = fixture();
    s.settings.exams[0].target = addDays(monday, 1);
    s.settings.materials[0].total = 350;
    const p = generatePlan(s, monday);
    expect(p.shortfalls).toEqual([]);
    expect(p.sessions.every((x) => x.date === monday)).toBe(true);
    expect(p.sessions.reduce((n, x) => n + x.count, 0)).toBe(350);
  });
  it('日曜と月曜を別の週とし、週をまたぐ端数統合でも両方の上限を守る', () => {
    for (const minutes of [1, 3, 7, 30]) {
      const s = fixture();
      s.settings.exams[0].target = addDays(monday, 14);
      s.settings.windows[0].weekdays = [0, 1, 2, 3, 4, 5, 6];
      s.settings.materials[0].rounds = [{ completed: 0, minutes }];
      s.settings.materials[0].total = 701;
      const p = generatePlan(s, addDays(monday, 6));
      for (const week of new Set(p.sessions.map((x) => startOfWeek(x.date)))) {
        const w = capacityForWeek(s.settings, week, p.sessions);
        expect(w.used).toBeLessThanOrEqual(w.limit + 1e-7);
      }
      expect(
        p.sessions.reduce((n, x) => n + x.count, 0) + p.shortfalls.reduce((n, x) => n + x.count, 0),
      ).toBe(701);
    }
  });
  it('複数試験・別枠復習で同じ週上限を共有する', () => {
    const s = fixture();
    s.settings.exams.push({ ...s.settings.exams[0], id: 'e2', reviewDays: 2 });
    s.settings.materials.push({ ...s.settings.materials[0], id: 'm2', examId: 'e2' });
    const p = generatePlan(s, monday);
    const w = capacityForWeek(s.settings, monday, p.sessions);
    expect(p.sessions.some((x) => x.kind === 'review')).toBe(true);
    expect(w.used).toBeLessThanOrEqual(w.limit);
    for (const c of p.capacities)
      for (const x of p.sessions.filter((x) => x.date === c.date))
        expect(c.blocks!.some(([a, b]) => a <= x.start && x.end <= b + 1e-7)).toBe(true);
  });
  it('週途中の再計画で過去・当日開始済み・固定予定を使用済みとして数える', () => {
    const s = fixture();
    s.plan = generatePlan(s, monday, false, 0, 'earliest');
    s.plan.sessions = s.plan.sessions.filter((x) => x.date <= addDays(monday, 1));
    const current = session(addDays(monday, 2), 540, 660, false);
    const fixed = session(addDays(monday, 4), 800, 920);
    s.plan.sessions.push(current, fixed);
    const original = structuredClone(s);
    const p = generatePlan(s, addDays(monday, 2), true, 600);
    expect(p.sessions).toContainEqual(current);
    expect(p.sessions).toContainEqual(fixed);
    expect(capacityForWeek(s.settings, monday, p.sessions).used).toBeLessThanOrEqual(1440);
    expect(
      p.sessions
        .filter((x) => x.date >= addDays(monday, 2) && x.id !== current.id && x.id !== fixed.id)
        .reduce((n, x) => n + x.end - x.start, 0),
    ).toBeLessThanOrEqual(480);
    expect(s).toEqual(original);
  });
  it('週上限を超える固定予定を消さず競合とし、承認で拒否する', () => {
    const s = fixture();
    s.settings.buffer = 0;
    s.plan = generatePlan(s, monday, false, 0, 'earliest');
    s.plan.sessions.forEach((x) => (x.fixed = true));
    s.settings.buffer = 0.2;
    const n = propose(s, monday, 'test');
    expect(n.proposal!.plan.sessions).toEqual(s.plan.sessions);
    expect(n.proposal!.plan.conflicts.join('')).toContain('週の割当上限');
    expect(() => approve(n)).toThrow('週の割当上限');
  });
  it('承認後に戻しても記録を戻さず、未報告は0問に変えない', () => {
    let s = fixture();
    s.plan = generatePlan(s, monday);
    s.records = [
      {
        id: 'r',
        date: monday,
        materialId: 'm',
        round: 0,
        count: 7,
        cancelled: false,
        createdAt: 'now',
        updatedAt: 'now',
      },
    ];
    const before = structuredClone(s);
    s = approve(propose(s, addDays(monday, 2), 'test'), true);
    expect(s.records).toEqual(before.records);
    s = undoPlan(s);
    expect(s.plan).toEqual(before.plan);
    expect(s.records).toEqual(before.records);
  });
  it('1分未満の丸めを日ごとに繰り返さず週合計に一度だけ適用する', () => {
    const s = fixture();
    s.settings.windows[0].end = 541;
    expect(capacityForWeek(s.settings, monday)).toMatchObject({ focus: 5, limit: 4 });
  });
});
