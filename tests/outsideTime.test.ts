import { expect, it } from 'vitest';
import { dailyTimeDisplay, outsideTimeError } from '../src/domain/dailyTimeDisplay';
import { dailyTime } from '../src/domain/dailyTime';
import { initialState, OutsideTime } from '../src/domain/model';
import { studentFixture } from './fixtures/student';
import { generatePlan } from '../src/domain/planner/generate';
import { parseBackup } from '../src/domain/backup';
import { resetSetup, restoreReset } from '../src/domain/reset';

const date = '2030-10-07';
it('未指定なら元の全区間と分類を維持する', () => {
  const day = dailyTime(studentFixture(date).settings, date);
  const display = dailyTimeDisplay(day.segments);
  expect(display.segments).toEqual(day.segments);
  expect(display.totals).toEqual({ ...day.totals, sleep: 0, bath: 0 });
});
it('日またぎの睡眠と風呂を未設定内だけで分け、24時間を維持する', () => {
  const s = studentFixture(date);
  const day = dailyTime(s.settings, date),
    before = structuredClone(day);
  const display = dailyTimeDisplay(day.segments, {
    sleep: { start: 1380, duration: 480 },
    bath: { start: 1330, duration: 30 },
  });
  expect(display.totals.sleep).toBe(480);
  expect(display.totals.bath).toBe(30);
  expect(display.totals.outside + display.totals.sleep + display.totals.bath).toBe(
    day.totals.outside,
  );
  expect(Object.values(display.totals).reduce((a, b) => a + b, 0)).toBe(1440);
  expect(display.segments.filter((x) => !['outside', 'sleep', 'bath'].includes(x.kind))).toEqual(
    day.segments.filter((x) => x.kind !== 'outside'),
  );
  expect(day).toEqual(before);
});
it('授業・食事・通学・学習・休憩には睡眠や風呂を重ねない', () => {
  const day = dailyTime(studentFixture(date).settings, date);
  const result = dailyTimeDisplay(day.segments, { sleep: { start: 600, duration: 600 } });
  for (const kind of ['available', 'rest', 'busy', 'meal', 'commute', 'mealCommute'] as const)
    expect(result.totals[kind]).toBe(day.totals[kind]);
  expect(result.totals.sleep).toBe(0);
});
it('重なる睡眠・風呂は入力時に拒否し、読込済みの重複も二重計上しない', () => {
  const value = { sleep: { start: 1380, duration: 480 }, bath: { start: 30, duration: 30 } };
  expect(outsideTimeError(value)).toContain('重なっています');
  const result = dailyTimeDisplay(dailyTime(initialState().settings, date).segments, value);
  expect(result.totals.sleep).toBe(450);
  expect(result.totals.bath).toBe(30);
  expect(Object.values(result.totals).reduce((a, b) => a + b)).toBe(1440);
  expect(outsideTimeError({ ...value, bath: { start: 1350, duration: 30 } })).toBeUndefined();
});
it.each([
  { start: -1, duration: 60 },
  { start: 1440, duration: 60 },
  { start: 0, duration: 0 },
  { start: 0, duration: 1440 },
  { start: 0, duration: 1.5 },
])('不正な時刻や長さを拒否する：%j', (sleep) => {
  expect(outsideTimeError({ sleep })).toBeTruthy();
});
it('表示設定の保存・解除で計画結果や固定・実績は変化しない', () => {
  const s = studentFixture(date);
  const context = { date, minute: 0, timestamp: date + 'T00:00:00Z', idPrefix: 'same' };
  const before = generatePlan(s, date, false, 0, 'balanced', context);
  s.outsideTime = { sleep: { start: 1380, duration: 480 } };
  expect(generatePlan(s, date, false, 0, 'balanced', context)).toEqual(before);
  const reset = resetSetup(s, true);
  expect(reset.outsideTime).toBeUndefined();
  expect(restoreReset(reset).outsideTime).toEqual(s.outsideTime);
});
it('旧バックアップ・任意設定・入力途中を保存し、不正値は拒否する', () => {
  const packet = {
    format: 'StudyPlanBackup',
    version: 1,
    createdAt: date + 'T00:00:00Z',
    appVersion: '0.4.7',
    data: initialState(),
  };
  expect(parseBackup(JSON.stringify(packet)).data.outsideTime).toBeUndefined();
  packet.data.outsideTime = { sleep: { start: 1380, duration: 480 } };
  packet.data.draft['outside-bath'] = { phase: 'start', start: '', end: '' };
  expect(parseBackup(JSON.stringify(packet)).data).toEqual(packet.data);
  packet.data.outsideTime = { sleep: { start: 0, duration: -1 } } as OutsideTime;
  expect(() => parseBackup(JSON.stringify(packet))).toThrow();
});
