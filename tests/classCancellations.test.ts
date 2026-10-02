import { expect, it } from 'vitest';
import { ClassCancellation, Session, addDays, initialState } from '../src/domain/model';
import { classCancellationErrors, classesForDate } from '../src/domain/classCancellations';
import { blockingEvents, samePlanningSettings, sameSettings, unavailableEvents } from '../src/domain/planAudit';
import { capacityForDate, capacityForWeek, freeIntervalsForDate } from '../src/domain/planner/capacity';
import { commuteEvents, commuteScheduleErrors, defaultCommute } from '../src/domain/commute';
import { fixedTimeIssue } from '../src/domain/planConstraints';
import { calendarEvents } from '../src/domain/icalendar';
import { settingChanges } from '../src/domain/revision';
import { parseBackup } from '../src/domain/backup';

const day = '2030-10-07';
function fixture() {
  const state = initialState();
  state.settings.block = 1440;
  state.settings.rest = 1;
  state.settings.buffer = 0.2;
  state.settings.windows = [
    { id: 'study', name: '学習', kind: 'study', from: day, to: addDays(day, 20), weekdays: [1], start: 540, end: 840 },
    { id: 'a', name: '授業A', kind: 'class', from: day, to: addDays(day, 20), weekdays: [1], start: 600, end: 700 },
    { id: 'b', name: '授業B', kind: 'class', from: day, to: addDays(day, 20), weekdays: [1], start: 705, end: 805 },
  ];
  return state;
}
const cancel = (id = 'off', classIds?: string[]): ClassCancellation => ({ id, from: day, to: day, ...(classIds ? { classIds } : {}) });

it('単日・期間両端・授業コマ指定・全授業を和集合で解除し、取消で定義どおり戻る', () => {
  const { settings } = fixture();
  const windows = structuredClone(settings.windows);
  settings.classCancellations = [cancel('one', ['a']), { ...cancel('two', ['b']), to: addDays(day, 7) }];
  expect(classesForDate(settings, day)).toEqual([]);
  expect(classesForDate(settings, addDays(day, 7)).map((item) => item.id)).toEqual(['a']);
  expect(classesForDate(settings, addDays(day, 14)).map((item) => item.id)).toEqual(['a', 'b']);
  settings.classCancellations.push(cancel('all'));
  settings.classCancellations = settings.classCancellations.filter((item) => item.id !== 'one');
  expect(classesForDate(settings, day)).toEqual([]);
  settings.classCancellations = settings.classCancellations.filter((item) => item.id !== 'all');
  expect(classesForDate(settings, day).map((item) => item.id)).toEqual(['a']);
  settings.classCancellations = [];
  expect(classesForDate(settings, day).map((item) => item.id)).toEqual(['a', 'b']);
  expect(settings.windows).toEqual(windows);
});

it('授業間の移動・授業前後準備を解除しても、食事・定期予定・既存学習時間帯を守る', () => {
  const { settings } = fixture();
  settings.classTransition = 10;
  settings.windows.push({ ...settings.windows[1], id: 'busy', kind: 'busy', start: 650, end: 675 });
  settings.meals = { lunch: { start: 720, duration: 30 } };
  expect(unavailableEvents(settings, day).some((item) => item.kind === 'classBreak')).toBe(true);
  settings.classCancellations = [cancel()];
  expect(blockingEvents(settings, day).map((item) => item.id)).toEqual(['busy']);
  expect(unavailableEvents(settings, day).map((item) => item.kind)).toEqual(['busy', 'meal']);
  expect(freeIntervalsForDate(settings, day)).toEqual([[540, 650], [675, 720], [750, 840]]);
  settings.windows[0].start = 900;
  settings.windows[0].end = 960;
  expect(freeIntervalsForDate(settings, day)).toEqual([[900, 960]]);
  settings.windows = settings.windows.filter((item) => item.kind !== 'study');
  expect(capacityForDate(settings, day).free).toBe(0);
});

it('一部の休講では通学を残し、全休講だけ授業日の通学を外し、曜日通学を保持する', () => {
  const { settings } = fixture();
  settings.commute = { ...defaultCommute(), enabled: true, from: day, to: addDays(day, 20), departureTimesConfirmed: true, outboundStart: 510, returnStart: 810 };
  settings.classCancellations = [cancel('one', ['a'])];
  expect(commuteEvents(settings, day)).toHaveLength(2);
  settings.classCancellations.push(cancel('two', ['b']));
  expect(commuteEvents(settings, day)).toEqual([]);
  expect(commuteEvents(settings, addDays(day, 7))).toHaveLength(2);
  settings.commute.mode = 'weekdays';
  settings.commute.weekdays = [1];
  expect(commuteEvents(settings, day)).toHaveLength(2);
});

it('初週が休講でも授業再開後の通学と食事の競合を見落とさない', () => {
  const { settings } = fixture();
  settings.commute = { ...defaultCommute(), enabled: true, from: day, to: addDays(day, 20), departureTimesConfirmed: true, outboundStart: 510, returnStart: 810 };
  settings.meals = { dinner: { start: 820, duration: 30 } };
  settings.classCancellations = [{ ...cancel(), to: addDays(day, 6) }];
  expect(commuteScheduleErrors(settings).join('')).toContain(addDays(day, 7));
  settings.classCancellations[0].to = addDays(day, 20);
  expect(commuteScheduleErrors(settings)).toEqual([]);
});

it('休講日の容量も共有週上限に入り、固定・復習が先に使用した量を残す', () => {
  const { settings } = fixture();
  const fixed: Session = { id: 'fixed', date: day, start: 600, end: 660, count: 20, examId: 'e', materialId: 'm', round: 0, kind: 'study', fixed: true };
  const review: Session = { ...fixed, id: 'review', date: addDays(day, 6), start: 800, end: 830, kind: 'review', count: 0 };
  expect(fixedTimeIssue(settings, fixed, capacityForDate(settings, day))).not.toBeNull();
  settings.classCancellations = [cancel()];
  expect(fixedTimeIssue(settings, fixed, capacityForDate(settings, day))).toBeNull();
  expect(capacityForWeek(settings, day, [fixed, review])).toMatchObject({ focus: 300, limit: 240, used: 90, remaining: 150 });
  settings.classCancellations = [];
  expect(fixedTimeIssue(settings, fixed, capacityForDate(settings, day))).not.toBeNull();
  expect(fixed).toMatchObject({ fixed: true, date: day, start: 600, end: 660, count: 20 });
});

it('ICSは休講の授業だけを除外し、確定学習・固定・復習・翌週の授業を保持する', () => {
  const state = fixture();
  state.plan = { id: 'p', from: day, createdAt: `${day}T00:00:00Z`, sessions: [
    { id: 'fixed', date: day, start: 600, end: 660, count: 20, examId: 'e', materialId: 'm', round: 0, kind: 'study', fixed: true },
    { id: 'review', date: day, start: 810, end: 840, count: 0, examId: 'e', materialId: '', round: 0, kind: 'review', fixed: false },
  ], shortfalls: [], capacities: [], conflicts: [] };
  state.settings.classCancellations = [cancel()];
  const before = structuredClone(state);
  const events = calendarEvents(state, { from: day, to: addDays(day, 7), study: true, classes: true, examId: 'all' });
  expect(events.filter((item) => item.kind === 'class').map((item) => item.date)).toEqual([addDays(day, 7), addDays(day, 7)]);
  expect(events.filter((item) => item.kind === 'study')).toHaveLength(2);
  expect(state).toEqual(before);
});

it('削除済み授業IDは全授業を解除せず、休講の変更は再計画の設定差分になる', () => {
  const { settings } = fixture();
  expect(sameSettings(settings, { ...settings, classCancellations: [] })).toBe(true);
  expect(samePlanningSettings(settings, { ...settings, classCancellations: [] })).toBe(true);
  const changed = { ...settings, classCancellations: [cancel('deleted', ['deleted-class'])] };
  expect(classesForDate(changed, day)).toHaveLength(2);
  expect(classCancellationErrors(changed)).toEqual([]);
  expect(sameSettings(settings, changed)).toBe(false);
  expect(samePlanningSettings(settings, changed)).toBe(false);
  expect(settingChanges(settings, changed)[0]).toContain('休講を追加');
  expect(settingChanges(changed, settings)[0]).toContain('休講を取消');
});

it('旧保存互換・休講下書き・計画履歴の休講・平準化の承認意図をバックアップ往復する', () => {
  const state = fixture();
  const packet = () => JSON.stringify({ format: 'StudyPlanBackup', version: 1, appVersion: '0.6.9', createdAt: '2030-10-07T00:00:00Z', data: state });
  expect(parseBackup(packet()).data.settings.classCancellations).toBeUndefined();
  state.settings.classCancellations = [cancel()];
  state.draft.classCancellation = { id: '', from: '', to: '', range: true, scope: 'selected', classIds: [] };
  state.plan = { id: 'p', from: day, createdAt: `${day}T00:00:00Z`, sessions: [], capacities: [], shortfalls: [], conflicts: [], settingsSnapshot: structuredClone(state.settings), dailyBalanceMaterialIds: ['m'] };
  state.history = [structuredClone(state.plan)];
  state.proposal = { plan: structuredClone(state.plan), basedOn: 'p', reason: '平準化', unreported: [], basis: {
    kind: 'remaining-adjustment', purpose: 'balance-future', date: day, from: day, sourceFingerprint: 'synthetic', balanceMaterialIds: ['m'], allowLowerPriorityReduction: true,
    targets: [{ kind: 'shortfall', materialId: 'm', round: 0 }], summary: [], affectedSessionIds: [],
  } };
  expect(parseBackup(packet()).data).toEqual(state);
  state.history[0].settingsSnapshot!.classCancellations![0].to = addDays(day, -1);
  expect(() => parseBackup(packet())).toThrow('休講');
});

it.each([
  { from: '' }, { from: '2030-02-30' }, { to: '2030-10-06' }, { classIds: [] },
  { classIds: ['a', 'a'] }, { classIds: [''] }, { id: '' },
])('不正な休講条件を入力とバックアップの両方で拒否する %j', (patch) => {
  const state = fixture();
  state.settings.classCancellations = [{ ...cancel(), ...patch }];
  expect(classCancellationErrors(state.settings)).not.toEqual([]);
  expect(() => parseBackup(JSON.stringify({ format: 'StudyPlanBackup', version: 1, appVersion: '0.6.9', createdAt: '2030-10-07T00:00:00Z', data: state }))).toThrow();
});
