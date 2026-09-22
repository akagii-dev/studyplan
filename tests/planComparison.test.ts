import { expect, it } from 'vitest';
import { Plan, Session } from '../src/domain/model';
import { comparePlans, mainDailyChanges } from '../src/domain/planComparison';

const session = (materialId: string, date: string, count = 20, round = 0): Session => ({
  id: materialId + date,
  examId: 'e',
  materialId,
  date,
  count,
  round,
  start: 600,
  end: 660,
  fixed: false,
  kind: 'study',
});
const plan = (sessions: Session[]): Plan => ({
  id: 'p',
  createdAt: '',
  from: '2026-10-01',
  sessions,
  capacities: [],
  shortfalls: [],
  conflicts: [],
});

it('同量の学習日移動・周回終了・他教材への波及を検出し、不変教材を省く', () => {
  const before = plan([
    session('a', '2026-10-02'),
    session('b', '2026-10-03'),
    session('c', '2026-10-04'),
  ]);
  const after = plan([
    session('a', '2026-10-03'),
    session('b', '2026-10-02'),
    session('c', '2026-10-04'),
  ]);
  const snapshot = structuredClone([before, after]);
  const changes = comparePlans(before, after);
  expect(changes.map((c) => c.materialId)).toEqual(['a', 'b']);
  expect(changes[0].rounds[0].before.end).toBe('2026-10-02 11:00');
  expect(changes[0].rounds[0].after.end).toBe('2026-10-03 11:00');
  expect(changes[0].total!.days).toEqual([
    { date: '2026-10-02', before: 20, after: 0 },
    { date: '2026-10-03', before: 0, after: 20 },
  ]);
  expect(comparePlans(before, after)).toEqual(changes);
  expect([before, after]).toEqual(snapshot);
  expect(comparePlans(before, before)).toEqual([]);
});

it('未配置の増減と新規配置、周回間の移動を保持する', () => {
  const before = plan([session('a', '2026-10-02')]);
  before.shortfalls = [{ materialId: 'b', round: 0, count: 30, minutes: 90, reason: '不足' }];
  const after = plan([session('a', '2026-10-02', 20, 1), session('b', '2026-10-04', 30)]);
  after.shortfalls = [{ materialId: 'c', round: 0, count: 5, minutes: 15, reason: '不足' }];
  const changes = comparePlans(before, after);
  expect(changes[0].total).toBeNull();
  expect(changes[0].rounds).toHaveLength(2);
  expect(changes[1].total).toMatchObject({
    before: { unplaced: 30, count: 0 },
    after: { unplaced: 0, count: 30 },
  });
  expect(changes[2].total).toMatchObject({ before: { unplaced: 0 }, after: { unplaced: 5 } });
});

it('同じ比較開始時刻を使い、0問と過去の予定を除く', () => {
  const before = plan([session('a', '2026-10-01'), session('b', '2026-10-02', 0)]);
  const after = plan([]);
  after.notBefore = 700;
  expect(comparePlans(before, after)).toEqual([]);
});

it('標準表示は変化の大きい3日、詳細用データは全日を保つ', () => {
  const days = [1, 2, 3, 4].map((n) => ({ date: `2026-10-0${n}`, before: 0, after: n * 10 }));
  expect(mainDailyChanges(days).map((d) => d.after)).toEqual([20, 30, 40]);
  expect(days).toHaveLength(4);
});
