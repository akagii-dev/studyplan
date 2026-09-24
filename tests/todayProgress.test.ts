import { expect, it } from 'vitest';
import { initialState } from '../src/domain/model';
import { todayStudyRows } from '../src/domain/todayProgress';
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
  expect(todayStudyRows(s, date)).toMatchObject([
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

it('前倒し前の当日予定を他画面と揃え、同じ問題集の周回を混ぜない', () => {
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
  expect(todayStudyRows(s, date)).toMatchObject([
    { materialId: 'm', materialName: '教材', round: 0, planned: 10, actual: 7, reported: true },
    { materialId: 'm', materialName: '教材', round: 1, planned: 4, actual: 0, reported: true },
  ]);
});
