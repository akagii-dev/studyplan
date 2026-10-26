import { beforeEach, expect, it, vi } from 'vitest';
import { initialState, type AppState } from '../src/domain/model';

// A day is cleared unless it is listed here; the real rows come from todayStudyRows.
const missed = new Set<string>();
vi.mock('../src/domain/todayProgress', () => ({
  todayStudyRows: (_state: AppState, date: string) =>
    missed.has(date) ? [{ progress: { complete: false } }] : [{ progress: { complete: true } }],
}));
const { confirmCode, generateCode, isObviousCode, issueCode, lockView, sundayUnlocks } = await import('../src/domain/screenTime');
const { backupSchema } = await import('../src/domain/backupSchema');

beforeEach(() => missed.clear());
// 2026-10-12 is a Monday, 2026-10-18 the Sunday after it.
const MONDAY = '2026-10-12';
const SUNDAY = '2026-10-18';
const NEXT_MONDAY = '2026-10-19';
function locked(setOn = MONDAY): AppState {
  return { ...initialState(), screenTime: { enabled: true, code: '5830', issuedOn: setOn, pending: false, setOn } };
}

it('同じ数字・連番・2桁の繰り返し・西暦らしい番号は使わない', () => {
  for (const code of ['0000', '7777', '1234', '6789', '4321', '3210', '1212', '0909', '1998', '2026'])
    expect(isObviousCode(code), code).toBe(true);
  for (const code of ['5830', '0417', '9152', '2187']) expect(isObviousCode(code), code).toBe(false);
  // Obvious draws are skipped, and a new code never repeats the old one.
  const draws = [0.0, 0.1234, 0.5830, 0.5830, 0.9152];
  expect(generateCode(undefined, () => draws.shift()!)).toBe('5830');
  const next = [0.5830, 0.9152];
  expect(generateCode('5830', () => next.shift()!)).toBe('9152');
});

it('月〜土をすべてクリアした週の日曜だけ表示し、月曜以降は隠す', () => {
  const state = locked();
  expect(sundayUnlocks(state, SUNDAY)).toBe(true);
  expect(lockView(state, SUNDAY)).toEqual({ kind: 'unlocked', code: '5830', from: 1 });
  expect(lockView(state, '2026-10-17').kind).toBe('locked');
  // The Monday after a revealed Sunday offers a new code instead of showing the old one.
  expect(lockView(state, NEXT_MONDAY).kind).toBe('renew');
});

it('1日でも未達成の週は日曜も表示せず、同じパスコードのまま続く', () => {
  missed.add('2026-10-14');
  const state = locked();
  expect(sundayUnlocks(state, SUNDAY)).toBe(false);
  expect(lockView(state, SUNDAY).kind).toBe('locked');
  expect(lockView(state, NEXT_MONDAY).kind).toBe('locked');
  expect(state.screenTime?.code).toBe('5830');
});

it('週の途中で設定したパスコードは、設定した日から土曜までをクリアすればその週の日曜に表示する', () => {
  // Set on Tuesday: Monday is not counted, Tuesday to Saturday are.
  missed.add(MONDAY);
  expect(sundayUnlocks(locked('2026-10-13'), SUNDAY)).toBe(true);
  expect(lockView(locked('2026-10-13'), SUNDAY)).toEqual({ kind: 'unlocked', code: '5830', from: 2 });
  const week = lockView(locked('2026-10-13'), '2026-10-15');
  expect(week).toMatchObject({ kind: 'locked', startsNextWeek: false, from: 2 });
  expect(week.kind === 'locked' && week.week.map((day) => day.status)).toEqual(['before', 'cleared', 'cleared', 'cleared', 'upcoming', 'upcoming']);
  // A missed day after setting still keeps the Sunday locked.
  missed.add('2026-10-16');
  expect(sundayUnlocks(locked('2026-10-13'), SUNDAY)).toBe(false);
});

it('日曜に設定したパスコードは翌週から数える', () => {
  expect(sundayUnlocks(locked(SUNDAY), SUNDAY)).toBe(false);
  expect(lockView(locked(SUNDAY), SUNDAY)).toMatchObject({ kind: 'locked', startsNextWeek: true });
  expect(sundayUnlocks(locked(SUNDAY), '2026-10-25')).toBe(true);
});

it('発行した番号は「設定した」まで表示し、再発行では旧パスコードも並べる', () => {
  const issued = issueCode(locked(), NEXT_MONDAY, () => 0.9152);
  expect(lockView(issued, NEXT_MONDAY)).toEqual({ kind: 'pending', code: '9152', previous: '5830' });
  const confirmed = confirmCode(issued, NEXT_MONDAY);
  expect(lockView(confirmed, NEXT_MONDAY).kind).toBe('locked');
  expect(confirmed.screenTime).toMatchObject({ code: '9152', pending: false, setOn: NEXT_MONDAY });
  expect(confirmed.screenTime?.previous).toBeUndefined();
  // Set on that Monday, the week still counts toward its Sunday.
  expect(sundayUnlocks(confirmed, '2026-10-25')).toBe(true);
});

it('既定はオフで、保存形式に入る', () => {
  expect(lockView(initialState(), SUNDAY).kind).toBe('off');
  const backup = { format: 'StudyPlanBackup', version: 1, createdAt: '2026-10-18T00:00:00.000Z', appVersion: '1.0.0' };
  const state = locked();
  expect(backupSchema.parse({ ...backup, data: state }).data.screenTime).toEqual(state.screenTime);
});
