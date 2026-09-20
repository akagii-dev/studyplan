import { describe, it, expect } from 'vitest';
import { initialState, addDays, AppState } from '../src/domain/model';
import { generatePlan, capacityForDate } from '../src/domain/planner';
import { overlapsBusy } from '../src/domain/planAudit';
import { resetSetup, restoreReset } from '../src/domain/reset';
import { sessionPolicy, sessionUnitCount } from '../src/domain/sessionPolicy';
import { approve, propose, validateSettings } from '../src/domain/planner';
import { sameSettings, stalePlan } from '../src/domain/planAudit';
const date = '2026-10-05';
function fixture(total = 37, minutes = 2, days = 30): AppState {
  const s = initialState();
  s.settings.exams = [
    {
      id: 'e',
      name: '試験',
      start: date,
      target: addDays(date, days),
      priority: 2,
      color: '#287569',
      reviewDays: 0,
    },
  ];
  s.settings.materials = [
    { id: 'm', examId: 'e', name: '教材', total, order: 1, rounds: [{ completed: 0, minutes }] },
  ];
  s.settings.windows = [
    {
      id: 'w',
      name: '学習',
      kind: 'study',
      from: date,
      to: addDays(date, days),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 540,
      end: 720,
    },
  ];
  return s;
}
function invariant(s: AppState) {
  const p = generatePlan(s, date);
  for (const m of s.settings.materials)
    for (let r = 0; r < m.rounds.length; r++) {
      const fixed = p.sessions
        .filter((x) => x.materialId === m.id && x.round === r)
        .reduce((n, x) => n + x.count, 0);
      const missing = p.shortfalls
        .filter((x) => x.materialId === m.id && x.round === r)
        .reduce((n, x) => n + x.count, 0);
      expect(fixed + missing).toBe(m.total - m.rounds[r].completed);
    }
  for (const x of p.sessions) {
    expect(overlapsBusy(s.settings, x)).toEqual([]);
    expect(x.end - x.start).toBeLessThanOrEqual(s.settings.block + 1e-6);
    expect(
      p.capacities
        .find((c) => c.date === x.date)!
        .slots.some(([a, b]) => x.start >= a - 1e-6 && x.end <= b + 1e-6),
    ).toBe(true);
    if (x.kind === 'study' && x.end - x.start < sessionPolicy(s.settings).minimum - 1e-6)
      expect(x.allocationReason).toBeTruthy();
    else if (x.kind === 'study') expect(x.allocationReason).toBeUndefined();
    if (x.kind === 'study')
      expect(x.end - x.start).toBeCloseTo(
        x.count * s.settings.materials.find((m) => m.id === x.materialId)!.rounds[x.round].minutes,
      );
  }
  for (let i = 1; i < p.sessions.length; i++)
    if (p.sessions[i].date === p.sessions[i - 1].date)
      expect(p.sessions[i].start).toBeGreaterThanOrEqual(p.sessions[i - 1].end - 1e-6);
  return p;
}
describe('まとまりを優先する学習計画', () => {
  it('37問を30日に数分ずつばらまかず、時間のまとまりを保つ', () => {
    const p = invariant(fixture());
    expect(p.shortfalls).toEqual([]);
    expect(p.sessions.every((x) => x.end - x.start >= 10)).toBe(true);
    expect(new Set(p.sessions.map((x) => x.date)).size).toBeGreaterThan(1);
  });
  it('教材の7問を5問と2問の新セッションに分けない', () => {
    expect(invariant(fixture(7)).sessions.map((x) => x.count)).toEqual([7]);
  });
  it('普通の5問が数分にしかならない教材も10分以上を優先する', () => {
    const p = invariant(fixture(200, 0.2, 10));
    expect(p.sessions.every((x) => x.end - x.start >= 10 - 1e-6)).toBe(true);
  });
  it('最終30問の推定が6分なら完了例外にし、見直し時間を水増ししない', () => {
    const p = invariant(fixture(30, 0.2, 10));
    expect(p.sessions.map((x) => x.count)).toEqual([30]);
    expect(p.sessions[0].end - p.sessions[0].start).toBe(6);
    expect(p.sessions[0].allocationReason).toBe('final-remainder');
  });
  it('3問分しかない枠は使わず、翌日の十分な枠へ繰り越す', () => {
    const s = fixture(20, 2, 2);
    s.settings.buffer = 0;
    s.settings.windows = [
      { ...s.settings.windows[0], to: date, end: 546 },
      { ...s.settings.windows[0], id: 'next', from: addDays(date, 1), end: 590 },
    ];
    const p = invariant(s);
    expect(p.sessions.every((x) => x.date === addDays(date, 1))).toBe(true);
    expect(p.sessions.map((x) => x.count)).toEqual([20]);
  });
  it('最後の3問だけなら例外として残し、残数を失わない', () => {
    const p = invariant(fixture(3));
    expect(p.sessions.map((x) => [x.count, x.allocationReason])).toEqual([[3, 'final-remainder']]);
  });
  it('期限までに短い枠しかないときは理由付きで例外を許可する', () => {
    const s = fixture(8, 2, 1);
    s.settings.buffer = 0;
    s.settings.windows = [
      { ...s.settings.windows[0], end: 546 },
      { ...s.settings.windows[0], id: 'second', start: 600, end: 606 },
      { ...s.settings.windows[0], id: 'third', start: 660, end: 664 },
    ];
    const p = invariant(s);
    expect(p.shortfalls).toEqual([]);
    expect(p.sessions.map((x) => x.count)).toEqual([3, 3, 2]);
    expect(p.sessions[0].allocationReason).toBe('deadline');
  });
  it('隣接する端数は同じ枠の先行セッションへ統合する', () => {
    const s = fixture(29, 2, 1);
    s.settings.buffer = 0;
    s.settings.block = 60;
    s.settings.windows[0].end = 598;
    const p = invariant(s);
    expect(p.sessions.map((x) => x.count)).toEqual([29]);
  });
  it.each([
    [20, 3],
    [2, 30],
  ])('60分の枠に %i問 × %i分を通常の予定として配置する', (count, minutes) => {
    const s = fixture(count, minutes, 1);
    s.settings.block = 60;
    s.settings.buffer = 0;
    s.settings.windows[0].end = 600;
    const p = invariant(s);
    expect(p.sessions.map((x) => [x.count, x.end - x.start, x.allocationReason])).toEqual([
      [count, 60, undefined],
    ]);
    expect(p.shortfalls).toEqual([]);
  });
  it.each([
    [1, 30],
    [3, 4],
    [4, 3],
  ])('少ない問題数でも %i問 × %i分なら時間だけで判断する', (count, minutes) => {
    const p = invariant(fixture(count, minutes));
    expect(p.sessions).toHaveLength(1);
    expect(p.sessions[0].allocationReason).toBeUndefined();
    expect(p.shortfalls).toEqual([]);
  });
  it('問題数を5の倍数へ丸めず、17分の枠に3分の問題を5問置く', () => {
    expect(sessionUnitCount(100, 3, 17, 17, { minimum: 10, preferred: 30 })).toBe(5);
    expect(sessionUnitCount(100, 3, 23, 23, { minimum: 10, preferred: 30 })).toBe(7);
    expect(sessionUnitCount(100, 30, 60, 60, { minimum: 10, preferred: 30 })).toBe(2);
  });
  it('前の枠に統合できない端数は、次の十分な枠に本体ごとまとめる', () => {
    const s = fixture(7, 3, 2);
    s.settings.buffer = 0;
    s.settings.block = 60;
    s.settings.windows = [
      { ...s.settings.windows[0], to: date, end: 558 },
      { ...s.settings.windows[0], id: 'next', from: addDays(date, 1), end: 600 },
    ];
    const p = invariant(s);
    expect(p.sessions.map((x) => [x.date, x.count, x.allocationReason])).toEqual([
      [addDays(date, 1), 7, undefined],
    ]);
  });
  it('目安を変えると時間のまとまりが変わり、連続上限は超えない', () => {
    const s = fixture(60, 3, 10);
    s.settings.block = 60;
    s.settings.buffer = 0;
    s.settings.preferredSessionMinutes = 30;
    const a = invariant(s);
    s.settings.preferredSessionMinutes = 60;
    const b = invariant(s);
    expect(b.sessions.length).toBeLessThan(a.sessions.length);
    expect(b.sessions.every((x) => x.end - x.start <= 60)).toBe(true);
  });
  it('1問が連続上限より長ければ、問を分割せず未配置にする', () => {
    const p = invariant(fixture(2, 120, 1));
    expect(p.sessions).toEqual([]);
    expect(p.shortfalls[0].count).toBe(2);
  });
  it('周回ごとの推定時間で重さを変え、同じ教材も時間から問題数を計算する', () => {
    const s = fixture(4, 30, 6);
    s.settings.block = 60;
    s.settings.buffer = 0;
    s.settings.materials[0].rounds.push({ completed: 0, minutes: 3 });
    const p = invariant(s);
    expect(p.sessions.filter((x) => x.round === 0).every((x) => !x.allocationReason)).toBe(true);
    expect(p.sessions.filter((x) => x.round === 1).map((x) => x.count)).toEqual([4]);
    expect(p.sessions.filter((x) => x.round === 1)[0].start).toBeGreaterThanOrEqual(540);
  });
  it('旧設定には初期値を補い、旧案は自動適用せず再作成を求める', () => {
    const s = fixture();
    expect(sessionPolicy(s.settings)).toEqual({ minimum: 10, preferred: 30 });
    expect(
      sameSettings(s.settings, {
        ...s.settings,
        minimumSessionMinutes: 10,
        preferredSessionMinutes: 30,
      }),
    ).toBe(true);
    const proposed = propose(s, date, 'test');
    proposed.proposal!.plan.calculationVersion = 3;
    expect(() => approve(proposed, true)).toThrow('計算方式');
    expect(stalePlan(proposed.proposal!.plan, s.settings)).toBe(true);
    expect(sameSettings(s.settings, { ...s.settings, preferredSessionMinutes: 60 })).toBe(false);
  });
  it.each([
    { minimumSessionMinutes: 0 },
    { preferredSessionMinutes: 9 },
    { minimumSessionMinutes: 1.5 },
    { preferredSessionMinutes: 1441 },
  ])('不正な時間設定を拒否する %j', (override) => {
    const s = fixture();
    Object.assign(s.settings, override);
    expect(validateSettings(s.settings).join()).toContain('予定の下限');
  });
  it('固定予定と実績を書き換えず、足りない分は不足に残す', () => {
    const s = fixture(101, 2, 1);
    s.plan = generatePlan(s, date);
    s.plan.sessions[0].fixed = true;
    const before = structuredClone(s);
    const p = generatePlan(s, date);
    expect(p.sessions).toContainEqual(s.plan.sessions[0]);
    expect(s).toEqual(before);
    expect(p.shortfalls.length).toBeGreaterThan(0);
  });
  it('複数試験・周回・細い枠の組合せでも共有枠と順序と総問題数を維持する', () => {
    for (let i = 1; i <= 30; i++) {
      const s = fixture(7 + i, (i % 3) + 0.5, 4);
      s.settings.block = 20 + i;
      s.settings.buffer = (i % 3) / 10;
      s.settings.exams.push({ ...s.settings.exams[0], id: 'e2', priority: 3 });
      s.settings.materials.push({
        ...s.settings.materials[0],
        id: 'other',
        examId: 'e2',
        total: 11 + i,
      });
      s.settings.materials.push({ ...s.settings.materials[0], id: 'later', order: 2, total: 13 });
      s.settings.windows.push({
        ...s.settings.windows[0],
        id: 'class',
        kind: 'class',
        start: 560,
        end: 597,
      });
      const p = invariant(s);
      const prev = p.sessions.filter((x) => x.materialId === 'm').at(-1),
        next = p.sessions.find((x) => x.materialId === 'later');
      if (prev && next)
        expect(
          prev.date < next.date || (prev.date === next.date && prev.end <= next.start + 1e-6),
        ).toBe(true);
      for (const c of p.capacities)
        expect(
          p.sessions.filter((x) => x.date === c.date).reduce((n, x) => n + x.end - x.start, 0),
        ).toBeLessThanOrEqual(capacityForDate(s.settings, c.date).allocatable + 1e-6);
    }
  });
});
describe('警告後に実行する初期化と復元', () => {
  it('質問だけ戻す場合は設定・計画・実績を維持する', () => {
    const s = fixture();
    s.plan = generatePlan(s, date);
    s.draft = {
      guided: { step: 'finish' },
      numberEdits: { 'setup/x': { text: '' }, 'progress/x': { text: '7' } },
    };
    const n = resetSetup(s);
    expect(n.settings).toEqual(s.settings);
    expect(n.plan).toEqual(s.plan);
    expect(n.records).toEqual(s.records);
    expect(n.draft.guided).toBeUndefined();
    expect(n.draft.numberEdits).toEqual({ 'progress/x': { text: '7' } });
  });
  it('全初期化の前の状態を1世代保存し、独立したコピーで復元する', () => {
    const s = fixture();
    s.plan = generatePlan(s, date);
    s.records = [
      {
        id: 'r',
        date,
        materialId: 'm',
        round: 0,
        count: 3,
        cancelled: false,
        createdAt: 'now',
        updatedAt: 'now',
      },
    ];
    const n = resetSetup(s, true);
    expect(n.settings.exams).toEqual([]);
    expect(n.plan).toBeNull();
    expect(n.records).toEqual([]);
    expect(restoreReset(n)).toEqual(s);
    n.resetBackup!.settings.exams[0].name = 'changed';
    expect(s.settings.exams[0].name).toBe('試験');
  });
  it('繰り返し初期化してもバックアップを入れ子に増やさない', () => {
    const n = resetSetup(resetSetup(fixture(), true), true);
    expect(n.resetBackup!.resetBackup).toBeUndefined();
  });
});
