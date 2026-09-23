import { expect, it } from 'vitest';
import { initialState } from '../src/domain/model';
import { todayProgress, todayStudyRows } from '../src/domain/todayProgress';
const date = '2030-10-07';
function fixture() {
  const s = initialState();
  s.settings.materials = [
    {
      id: 'm',
      name: '教材',
      examId: 'e',
      total: 100,
      order: 1,
      rounds: [{ completed: 30, minutes: 3 }],
    },
  ];
  const session = {
    id: 's',
    date,
    start: 600,
    end: 660,
    examId: 'e',
    materialId: 'm',
    round: 0,
    count: 10,
    fixed: false,
    kind: 'study' as const,
  };
  s.plan = {
    id: 'p',
    createdAt: '2030-10-07T00:00:00Z',
    from: date,
    sessions: [session, { ...session, id: 's2', start: 700, end: 730, count: 5 }],
    capacities: [],
    conflicts: [],
    shortfalls: [],
  };
  return s;
}
const record = (count: number, extra = {}) => ({
  id: 'r',
  date,
  materialId: 'm',
  round: 0,
  count,
  cancelled: false,
  createdAt: '2030-10-07T00:00:00Z',
  updatedAt: '2030-10-07T00:00:00Z',
  ...extra,
});
it('同日の承認済み予定を合算し、実績を一度だけ照合する', () => {
  const s = fixture();
  s.records = [record(7)];
  expect(todayProgress(s, date)).toMatchObject({
    planned: 15,
    actual: 7,
    matched: 7,
    remaining: 8,
    reported: true,
  });
});
it('予定なしでも実績数は表示し、達成率を0%や100%と決めない', () => {
  const s = initialState();
  s.records = [record(7)];
  expect(todayProgress(s, date)).toMatchObject({
    actual: 7,
    planned: 0,
    percent: null,
    reported: true,
  });
});
it('他教材・別周回・予定超過を未着手の達成に流用しない', () => {
  const s = fixture();
  s.plan!.sessions.push({ ...s.plan!.sessions[0], id: 'other', materialId: 'm2' });
  s.records = [
    record(20),
    record(7, { id: 'round', round: 1 }),
    record(5, { id: 'other', materialId: 'm3' }),
  ];
  expect(todayProgress(s, date)).toMatchObject({
    planned: 25,
    actual: 32,
    matched: 15,
    remaining: 10,
    percent: 60,
  });
});
it('0問・未報告・予定なしを区別し、過去日・取消・別枠復習を除く', () => {
  const s = fixture();
  expect(todayProgress(s, date).reported).toBe(false);
  s.records = [
    record(0),
    record(9, { id: 'past', date: '2030-10-06' }),
    record(9, { id: 'cancel', cancelled: true }),
  ];
  s.plan!.sessions.push({ ...s.plan!.sessions[0], id: 'review', kind: 'review' });
  expect(todayProgress(s, date)).toMatchObject({
    reported: true,
    actual: 0,
    matched: 0,
    planned: 15,
  });
  s.plan = null;
  expect(todayProgress(s, date)).toMatchObject({ percent: null, reported: true });
});
it('計画案と初期完了数は今日の実績に混ぜず、訂正・取消を反映する', () => {
  const s = fixture();
  s.proposal = { plan: { ...s.plan!, sessions: [] }, basedOn: 'p', reason: '案', unreported: [] };
  s.records = [record(3)];
  expect(todayProgress(s, date).matched).toBe(3);
  s.records[0].count = 7;
  expect(todayProgress(s, date).matched).toBe(7);
  s.records[0].cancelled = true;
  expect(todayProgress(s, date)).toMatchObject({ planned: 15, matched: 0, reported: false });
});

it('問題集と周回ごとに予定・実績を分け、予定外と未入力を区別する', () => {
  const s = fixture();
  s.settings.materials.push(
    {
      id: 'b',
      name: '問題集B',
      examId: 'e',
      total: 50,
      order: 2,
      rounds: [{ completed: 0, minutes: 2 }],
    },
    {
      id: 'c',
      name: '問題集C',
      examId: 'e',
      total: 50,
      order: 3,
      rounds: [{ completed: 0, minutes: 2 }],
    },
  );
  s.plan!.sessions = [
    { ...s.plan!.sessions[0], count: 10 },
    { ...s.plan!.sessions[0], id: 'b', materialId: 'b', count: 10 },
  ];
  s.records = [record(15), record(3, { id: 'c', materialId: 'c' })];
  expect(todayStudyRows(s, date)).toEqual([
    { materialId: 'm', materialName: '教材', round: 0, planned: 10, actual: 15, reported: true },
    { materialId: 'b', materialName: '問題集B', round: 0, planned: 10, actual: 0, reported: false },
    { materialId: 'c', materialName: '問題集C', round: 0, planned: 0, actual: 3, reported: true },
  ]);
  s.records.push(record(0, { id: 'zero', materialId: 'b' }));
  expect(todayStudyRows(s, date)[1]).toMatchObject({ actual: 0, reported: true });
  s.records[2].cancelled = true;
  expect(todayStudyRows(s, date)[1]).toMatchObject({ actual: 0, reported: false });
  s.records[0].count = 8;
  expect(todayStudyRows(s, date)[0]).toMatchObject({ actual: 8 });
});

it('前倒し後の現在予定を示し、同じ問題集の周回を混ぜない', () => {
  const s = fixture();
  s.settings.materials[0].rounds.push({ completed: 0, minutes: 3 });
  s.plan!.sessions = [
    { ...s.plan!.sessions[0], count: 6 },
    { ...s.plan!.sessions[0], id: 'second-round', round: 1, count: 4 },
  ];
  s.plan!.progressBaseline = {
    records: {},
    sessions: { s: { count: 10, end: 660 } },
    shortfalls: {},
  };
  s.records = [record(7), record(0, { id: 'second-round-report', round: 1 })];
  expect(todayStudyRows(s, date)).toEqual([
    { materialId: 'm', materialName: '教材', round: 0, planned: 6, actual: 7, reported: true },
    { materialId: 'm', materialName: '教材', round: 1, planned: 4, actual: 0, reported: true },
  ]);
});
