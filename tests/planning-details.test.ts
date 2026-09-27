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
import { approve as approveWithContext, propose as proposeWithContext, proposeRestart as proposeRestartWithContext, restartSourceFingerprint } from '../src/domain/planner/proposal';
import { refreshProposal, releaseFixedAndRefresh } from '../src/domain/repairPlan';
import { restartFixture } from './fixtures/adjustment';
import { backupSchema } from '../src/domain/backupSchema';

const restartDay = '2030-10-07';
const restartContext = {
  date: restartDay,
  minute: 720,
  timestamp: '2030-10-07T03:00:00.000Z',
  idPrefix: 'restart',
};
describe('計画の仕切り直しと案の事前条件', () => {
  it('既存の未配置を重複計上せず、2+2実績後の26問を指定日から再配分する', () => {
    const source = restartFixture(restartDay);
    const from = addDays(restartDay, 3);
    const candidate = proposeRestartWithContext(source, from, restartContext);
    expect(candidate.records).toEqual(source.records);
    expect(candidate.plan).toEqual(source.plan);
    expect(candidate.proposal?.basis).toMatchObject({ date: restartDay, kind: 'restart' });
    expect(candidate.proposal?.plan.allocationStart).toBe(from);
    expect(candidate.proposal?.plan.sessions.filter((s) => s.kind === 'study' && s.date >= from).reduce((n, s) => n + s.count, 0)).toBe(26);
    expect(candidate.proposal?.plan.shortfalls.reduce((n, s) => n + s.count, 0)).toBe(0);
    expect(candidate.proposal?.plan.sessions.some((s) => !s.fixed && s.date < from)).toBe(false);
    const approved = approveWithContext(candidate, false, restartContext);
    expect(approved.plan?.allocationStart).toBe(from);
    expect(approved.history).toEqual([source.plan]);
    const ordinary = proposeWithContext(approved, addDays(restartDay, 1), '再確認', restartContext);
    expect(ordinary.proposal?.plan.allocationStart).toBe(from);
    expect(ordinary.proposal?.plan.from).toBe(from);
    expect(ordinary.proposal?.unreported).toEqual([]);
    expect(backupSchema.safeParse({ format: 'StudyPlanBackup', version: 1, createdAt: restartContext.timestamp, appVersion: 'test', data: approved }).success).toBe(true);
  });

  it('案の保存往復でキー順が変わっても同じ基準と判定する', () => {
    const state = restartFixture(restartDay);
    const expected = restartSourceFingerprint(state);
    const reorder = (value: unknown): unknown => Array.isArray(value)
      ? value.map(reorder)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)]))
        : value;
    expect(restartSourceFingerprint(reorder(state) as typeof state)).toBe(expected);
    const candidate = proposeRestartWithContext(state, addDays(restartDay, 3), restartContext);
    const loaded = reorder(JSON.parse(JSON.stringify(candidate))) as typeof candidate;
    expect(approveWithContext(loaded, false, restartContext).plan?.allocationStart).toBe(addDays(restartDay, 3));
  });

  it('仕切り直し後の通常再計画は新しいfromでも元のallocationStartを保存できる', () => {
    const from = addDays(restartDay, 3);
    const restarted = approveWithContext(
      proposeRestartWithContext(restartFixture(restartDay), from, restartContext),
      false,
      restartContext,
    );
    const later = addDays(restartDay, 5);
    const laterContext = { ...restartContext, date: later, minute: 0, timestamp: '2030-10-12T00:00:00.000Z' };
    const proposal = proposeWithContext(restarted, later, '通常の再計画', laterContext);
    const approved = approveWithContext(proposal, true, laterContext);
    expect(approved.plan?.from).toBe(later);
    expect(approved.plan?.allocationStart).toBe(from);
    expect(backupSchema.safeParse({
      format: 'StudyPlanBackup', version: 1, createdAt: laterContext.timestamp,
      appVersion: 'test', data: approved,
    }).success).toBe(true);
  });

  it('記録・設定・固定・元計画・日付が変われば古案を承認しない', () => {
    const candidate = proposeRestartWithContext(restartFixture(restartDay), addDays(restartDay, 3), restartContext);
    const variants = [
      { ...candidate, records: [{ ...candidate.records[0], count: 3 }] },
      { ...candidate, settings: { ...candidate.settings, buffer: candidate.settings.buffer + 0.1 } },
      { ...candidate, plan: { ...candidate.plan!, sessions: candidate.plan!.sessions.map((s, index) => index ? s : { ...s, fixed: true }) } },
      { ...candidate, plan: { ...candidate.plan!, shortfalls: [] } },
    ];
    for (const stale of variants)
      expect(() => approveWithContext(stale, false, restartContext)).toThrow('案を作り直してください');
    expect(() => approveWithContext(candidate, false, { ...restartContext, date: addDays(restartDay, 1) })).toThrow('案を作り直してください');
  });

  it('固定解除と再作成でも指定開始日・案種別を保つ', () => {
    const state = restartFixture(restartDay);
    state.plan!.sessions[0].fixed = true;
    const from = addDays(restartDay, 3);
    // The fixed slot before the start is an explicit conflict, not silently erased.
    const candidate = proposeRestartWithContext(state, from, restartContext);
    expect(candidate.proposal?.plan.conflicts.length).toBeGreaterThan(0);
    const released = releaseFixedAndRefresh(candidate, 'old-1', restartDay);
    expect(released.proposal?.basis?.kind).toBe('restart');
    expect(released.proposal?.plan.allocationStart).toBe(from);
    expect(released.proposal?.plan.conflicts).toEqual([]);
    expect(refreshProposal(released, restartDay).proposal?.plan.allocationStart).toBe(from);
  });
});

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
