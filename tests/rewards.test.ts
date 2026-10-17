import { expect, it } from 'vitest';
import { initialState, type AppState, type Progress } from '../src/domain/model';
import {
  FIRST_LEVEL_POINTS, levelCost, levelOf, loginStreak, settleRewards, totalPoints,
} from '../src/domain/rewards';
import { backupSchema } from '../src/domain/backupSchema';

const record = (id: string, date: string, count: number, cancelled = false): Progress => ({
  id, date, materialId: 'm', round: 0, count, cancelled, createdAt: `${date}T09:00:00.000Z`, updatedAt: `${date}T09:00:00.000Z`,
});
function state(records: Progress[], minutes = 25): AppState {
  const s = initialState();
  s.settings.materials = [{ id: 'm', examId: 'e', name: '問題集', total: 100, order: 0, rounds: [{ completed: 0, minutes }] }];
  s.records = records;
  return s;
}

it('レベル1は1週間分の半分（29,750pt）で、以降は1.2倍ずつ必要になる', () => {
  expect(FIRST_LEVEL_POINTS).toBe(29_750);
  expect(levelCost(1)).toBe(29_750);
  expect(levelCost(2)).toBe(35_700);
  expect(levelOf(0)).toMatchObject({ level: 0, current: 0, toNext: 29_750 });
  expect(levelOf(29_750)).toMatchObject({ level: 1, current: 0, cost: 35_700, toNext: 35_700 });
  expect(levelOf(30_000)).toMatchObject({ level: 1, current: 250, toNext: 35_450 });
});

it('記録は時給1200ptで換算し、その日最初の記録に100ptのログインボーナスを付ける', () => {
  const next = settleRewards(state([record('a', '2026-10-17', 6), record('b', '2026-10-17', 2)]), '2026-10-17');
  // 6問×25分＝150分→3,000pt、2問×25分＝50分→1,000pt、ログイン100pt
  expect(totalPoints(next)).toBe(4_100);
  expect(next.rewards?.entries.filter((e) => e.kind === 'login')).toHaveLength(1);
});

it('開始日より前の記録には付けず、訂正で差し引き、取消でログインボーナスも外す', () => {
  const start = settleRewards(state([record('old', '2026-10-16', 4), record('a', '2026-10-17', 6)]), '2026-10-17');
  expect(start.rewards?.since).toBe('2026-10-17');
  expect(totalPoints(start)).toBe(3_100);
  const corrected = settleRewards({ ...start, records: [start.records[0], { ...start.records[1], count: 3 }] });
  expect(totalPoints(corrected)).toBe(1_600);
  const cancelled = settleRewards({ ...corrected, records: [corrected.records[0], { ...corrected.records[1], cancelled: true }] });
  expect(totalPoints(cancelled)).toBe(0);
});

it('付与済みの記録は、後で教材の1問あたり時間を変えても点数を変えない', () => {
  const first = settleRewards(state([record('a', '2026-10-17', 6)]), '2026-10-17');
  const edited = structuredClone(first);
  edited.settings.materials[0].rounds[0].minutes = 60;
  edited.records.push(record('b', '2026-10-17', 1));
  const next = settleRewards(edited, '2026-10-17');
  expect(next.rewards?.entries.find((e) => e.recordId === 'a')?.points).toBe(3_000);
  expect(next.rewards?.entries.find((e) => e.recordId === 'b')?.points).toBe(1_200);
});

it('連続日数は今日（未記録なら昨日）から途切れるまで数える', () => {
  let s = settleRewards(state([record('a', '2026-10-15', 1)]), '2026-10-15');
  s = settleRewards({ ...s, records: [...s.records, record('b', '2026-10-16', 1)] });
  expect(loginStreak(s, '2026-10-17')).toBe(2);
  s = settleRewards({ ...s, records: [...s.records, record('c', '2026-10-17', 1)] });
  expect(loginStreak(s, '2026-10-17')).toBe(3);
  expect(loginStreak(s, '2026-10-19')).toBe(0);
});

it('報酬の記録はバックアップ形式で保持され、旧データ（報酬なし）も読み込める', () => {
  const s = settleRewards(state([record('a', '2026-10-17', 6)]), '2026-10-17');
  const backup = { format: 'StudyPlanBackup', version: 1, createdAt: '2026-10-17T00:00:00.000Z', appVersion: '0.17.0' };
  expect(backupSchema.parse({ ...backup, data: { ...initialState(), rewards: s.rewards } }).data.rewards).toEqual(s.rewards);
  expect(backupSchema.parse({ ...backup, data: initialState() }).data.rewards).toBeUndefined();
});
