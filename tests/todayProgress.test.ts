import { expect, it } from 'vitest';
import { initialState } from '../src/domain/model';
import { todayProgress } from '../src/domain/todayProgress';
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
