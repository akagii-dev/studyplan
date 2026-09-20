import { describe, expect, it } from 'vitest';
import { initialState, addDays } from '../src/domain/model';
import { defaultCommute, commuteEvents, commuteErrors } from '../src/domain/commute';
import {
  capacityForDate,
  freeIntervalsForDate,
  generatePlan,
  proposeSettings,
  approve,
  undoPlan,
} from '../src/domain/planner';
import { overlapsBusy, sameSettings } from '../src/domain/planAudit';
import { dailyTime } from '../src/domain/dailyTime';
import { fixedTimeIssue } from '../src/domain/planConstraints';
const day = '2030-10-07'; // Monday, future date keeps approval tests independent of local time.
function fixture() {
  const s = initialState();
  s.settings.exams = [
    {
      id: 'e',
      name: '試験',
      start: day,
      target: addDays(day, 10),
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
      total: 80,
      order: 1,
      rounds: [{ completed: 0, minutes: 3 }],
    },
  ];
  s.settings.windows = [
    {
      id: 'w',
      name: '学習',
      kind: 'study',
      from: day,
      to: addDays(day, 10),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 480,
      end: 1200,
    },
    {
      id: 'c',
      name: '授業',
      kind: 'class',
      from: day,
      to: addDays(day, 5),
      weekdays: [1, 3],
      start: 600,
      end: 700,
    },
  ];
  s.settings.commute = {
    ...defaultCommute(),
    enabled: true,
    from: day,
    to: addDays(day, 10),
    outboundMinutes: 45,
    returnMinutes: 30,
  };
  return s;
}
describe('通学時間', () => {
  it('授業日の最初と最後に往復を確保し、授業のない日は除外しない', () => {
    const s = fixture();
    s.settings.windows.push({ ...s.settings.windows[1], id: 'late', start: 900, end: 1000 });
    expect(commuteEvents(s.settings, day).map((e) => [e.start, e.end])).toEqual([
      [555, 600],
      [1000, 1030],
    ]);
    expect(commuteEvents(s.settings, addDays(day, 1))).toEqual([]);
    expect(commuteEvents(s.settings, addDays(day, 7))).toEqual([]);
  });
  it('授業・移動準備・定期予定との重複を一度だけ差し引く', () => {
    const s = fixture();
    s.settings.classTransition = 10;
    s.settings.windows.push({
      ...s.settings.windows[1],
      kind: 'busy',
      id: 'b',
      start: 560,
      end: 620,
    });
    expect(freeIntervalsForDate(s.settings, day)).toEqual([
      [480, 555],
      [730, 1200],
    ]);
    expect(capacityForDate(s.settings, day).free).toBe(545);
    expect(Object.values(dailyTime(s.settings, day).totals).reduce((a, b) => a + b, 0)).toBe(1440);
  });
  it('曜日指定では授業がなくても指定した往路と復路だけを除く', () => {
    const s = fixture();
    Object.assign(s.settings.commute!, {
      mode: 'weekdays',
      weekdays: [2],
      outboundStart: 480,
      returnStart: 1080,
    });
    expect(commuteEvents(s.settings, day)).toEqual([]);
    expect(freeIntervalsForDate(s.settings, addDays(day, 1))).toEqual([
      [525, 1080],
      [1110, 1200],
    ]);
  });
  it('適用期間外・無効・0分は枠を消費しない', () => {
    const s = fixture();
    expect(commuteEvents(s.settings, addDays(day, -1))).toEqual([]);
    s.settings.commute!.outboundMinutes = 0;
    s.settings.commute!.returnMinutes = 0;
    expect(commuteEvents(s.settings, day)).toEqual([]);
    s.settings.commute!.enabled = false;
    expect(sameSettings(s.settings, { ...s.settings, commute: undefined })).toBe(true);
  });
  it('日をまたぐ往路・復路を前後の日へ切り分ける', () => {
    const s = fixture();
    s.settings.windows[1].start = 20;
    s.settings.windows[1].weekdays = [1];
    s.settings.windows[1].end = 1430;
    expect(commuteEvents(s.settings, addDays(day, -1)).map((e) => [e.start, e.end])).toEqual([
      [1415, 1440],
    ]);
    expect(commuteEvents(s.settings, addDays(day, 1)).map((e) => [e.start, e.end])).toEqual([
      [0, 20],
    ]);
  });
  it('不正な期間・曜日・長さ・時刻を拒否する', () => {
    for (const change of [
      { from: '2030-02-30' },
      { to: '2020-01-01' },
      { outboundMinutes: -1 },
      { returnMinutes: 1.5 },
      { returnMinutes: 361 },
      { mode: 'weekdays', weekdays: [] },
      { outboundStart: 1440 },
    ])
      expect(
        commuteErrors({ ...fixture().settings.commute!, ...change } as never).length,
      ).toBeGreaterThan(0);
  });
  it('共有枠・連続上限・余裕率を守り、通学に配置しない', () => {
    const s = fixture();
    s.settings.exams.push({ ...s.settings.exams[0], id: 'e2' });
    s.settings.materials.push({ ...s.settings.materials[0], id: 'm2', examId: 'e2' });
    const p = generatePlan(s, day, false);
    for (const x of p.sessions) {
      expect(overlapsBusy(s.settings, x)).toEqual([]);
      expect(x.end - x.start).toBeLessThanOrEqual(s.settings.block);
    }
    for (const c of p.capacities)
      expect(
        p.sessions.filter((x) => x.date === c.date).reduce((n, x) => n + x.end - x.start, 0),
      ).toBeLessThanOrEqual(c.allocatable);
    for (let i = 0; i < p.sessions.length; i++)
      for (let j = i + 1; j < p.sessions.length; j++) {
        const a = p.sessions[i],
          b = p.sessions[j];
        expect(a.date === b.date && a.start < b.end && b.start < a.end).toBe(false);
      }
  });
  it('通学変更は承認まで保留し、承認・計画取消で実績を保持する', () => {
    const s = fixture();
    s.settings.commute!.enabled = false;
    s.plan = generatePlan(s, day, false);
    const settings = { ...s.settings, commute: { ...s.settings.commute!, enabled: true } };
    const p = proposeSettings(s, settings, day);
    expect(p.settings.commute!.enabled).toBe(false);
    const approved = approve(p);
    expect(approved.settings.commute!.enabled).toBe(true);
    expect(approved.records).toEqual(s.records);
    expect(undoPlan(approved).records).toEqual(s.records);
  });
  it('固定予定と通学の競合を示し、承認で破壊しない', () => {
    const s = fixture();
    s.settings.commute!.enabled = false;
    s.plan = generatePlan(s, day, false);
    const fixed = { ...s.plan.sessions[0], start: 555, end: 585, count: 10, fixed: true };
    s.plan.sessions = [fixed];
    const settings = { ...s.settings, commute: { ...s.settings.commute!, enabled: true } };
    expect(fixedTimeIssue(settings, fixed, capacityForDate(settings, fixed.date))?.topic).toBe(
      'commute',
    );
    const p = proposeSettings(s, settings, day);
    expect(p.proposal!.plan.sessions.find((x) => x.id === fixed.id)).toEqual(fixed);
    expect(() => approve(p)).toThrow();
  });
});
