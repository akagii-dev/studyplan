import { describe, expect, it } from 'vitest';
import { initialState, AppState, Plan, Session } from '../src/domain/model';
import { calendarQuantity, retainStudyDayBaselines } from '../src/domain/calendarQuantity';
import { upcomingSunday, weekRangeLabel } from '../src/domain/calendar';
import { undoPlan } from '../src/domain/planner/proposal';

const date = '2026-09-24';
const session = (id: string, count: number, round = 0): Session => ({
  id,
  materialId: id,
  examId: 'e',
  count,
  round,
  date,
  start: 600,
  end: 660,
  fixed: false,
  kind: 'study',
});
const plan = (sessions: Session[]): Plan => ({
  id: 'p',
  createdAt: '2026-09-23T01:00:00Z',
  approvedAt: '2026-09-23T02:00:00Z',
  from: date,
  sessions,
  capacities: [],
  shortfalls: [],
  conflicts: [],
});
function fixture() {
  const s = initialState();
  s.settings.materials = [
    {
      id: 'a',
      examId: 'e',
      name: '民法',
      total: 100,
      rounds: [{ completed: 0, minutes: 3 }],
      order: 1,
    },
    {
      id: 'b',
      examId: 'e',
      name: '刑法',
      total: 100,
      rounds: [{ completed: 0, minutes: 3 }],
      order: 2,
    },
    {
      id: 'c',
      examId: 'e',
      name: '読書',
      unit: 'ページ',
      total: 100,
      rounds: [{ completed: 0, minutes: 3 }],
      order: 3,
    },
  ];
  s.plan = plan([session('a', 20), session('b', 10), session('c', 5)]);
  return s;
}
function record(s: AppState, materialId: string, count: number, cancelled = false, round = 0) {
  s.records.push({
    id: `${materialId}-${s.records.length}`,
    date,
    materialId,
    round,
    count,
    cancelled,
    createdAt: '2026-09-24T02:00:00Z',
    updatedAt: '2026-09-24T02:00:00Z',
  });
}
describe('カレンダーの学習量', () => {
  it('教材・周回を照合し、別教材の超過で不足を相殺せず、単位を分ける', () => {
    const s = fixture();
    record(s, 'a', 12);
    record(s, 'b', 30);
    record(s, 'c', 2);
    record(s, 'a', 90, true);
    record(s, 'a', 8, false, 1);
    const before = structuredClone(s);
    expect(calendarQuantity(s, date, date).totals).toEqual([
      { unit: '問', planned: 30, actual: 50, remainder: 8, reported: true, partial: false },
      { unit: 'ページ', planned: 5, actual: 2, remainder: 3, reported: true, partial: false },
    ]);
    expect(s).toEqual(before);
  });
  it('未記録と明示0、部分記録、訂正と取消を区別する', () => {
    const s = fixture();
    expect(calendarQuantity(s, date, date).totals[0].reported).toBe(false);
    record(s, 'a', 0);
    expect(calendarQuantity(s, date, date).totals[0]).toMatchObject({
      actual: 0,
      reported: true,
      partial: true,
      remainder: 30,
    });
    s.records[0].count = 12;
    expect(calendarQuantity(s, date, date).totals[0].remainder).toBe(18);
    s.records[0].cancelled = true;
    expect(calendarQuantity(s, date, date).totals[0]).toMatchObject({
      reported: false,
      remainder: 30,
    });
  });
  it('再配分後も過去20問対12問の不足8問を保ち、未来に二重加算しない', () => {
    let s = fixture();
    s.plan!.sessions = [session('a', 20)];
    s = retainStudyDayBaselines(s, date);
    record(s, 'a', 12);
    const old = s.plan!;
    s.history.push(old);
    s.plan = {
      ...plan([{ ...session('a', 8), date: '2026-09-25' }]),
      id: 'new',
      from: '2026-09-25',
      approvedAt: '2026-09-24T03:00:00Z',
    };
    expect(calendarQuantity(s, date, '2026-09-25').totals[0]).toMatchObject({
      planned: 20,
      actual: 12,
      remainder: 8,
    });
    expect(calendarQuantity(s, '2026-09-25', '2026-09-25').totals[0].planned).toBe(8);
    const undone = undoPlan(s, '2026-09-25');
    expect(
      calendarQuantity(JSON.parse(JSON.stringify(undone)), date, '2026-09-25').totals[0].remainder,
    ).toBe(8);
  });
  it('承認日時なし・後日承認・候補だけの計画から過去量を推測しない', () => {
    const s = fixture();
    delete s.plan!.approvedAt;
    record(s, 'a', 12);
    expect(calendarQuantity(s, date, '2026-09-25').totals[0]).toMatchObject({
      planned: null,
      actual: 12,
      remainder: null,
    });
    s.proposal = { plan: plan([session('a', 20)]), basedOn: 'p', reason: '', unreported: [] };
    expect(calendarQuantity(s, date, '2026-09-25').known).toBe(false);
    s.plan!.approvedAt = '2026-09-26T02:00:00Z';
    expect(calendarQuantity(s, date, '2026-09-27').known).toBe(false);
  });
  it('確定履歴から復元し、後日のfromを持つ過去コピーは選ばない', () => {
    const s = fixture();
    s.history = [s.plan!];
    s.plan = {
      ...s.plan!,
      id: 'later',
      approvedAt: '2026-09-24T01:00:00Z',
      from: '2026-09-25',
      sessions: [session('a', 1)],
    };
    expect(calendarQuantity(s, date, '2026-09-26').totals[0].planned).toBe(30);
  });
  it('承認日の判定に端末の現地日付を使う', () => {
    const s = fixture();
    s.plan!.approvedAt = new Date(2026, 8, 24, 0, 30).toISOString();
    expect(calendarQuantity(s, date, '2026-09-25').known).toBe(true);
    s.plan!.approvedAt = new Date(2026, 8, 25, 0, 30).toISOString();
    expect(calendarQuantity(s, date, '2026-09-25').known).toBe(false);
  });
});
it.each([
  ['2026-09-27', '2026-09-27'],
  ['2026-09-26', '2026-09-27'],
  ['2026-09-28', '2026-10-04'],
  ['2026-12-31', '2027-01-03'],
])('基準日%s以降の日曜日は%s', (from, expected) => expect(upcomingSunday(from)).toBe(expected));
it('年を跨ぐ週の範囲を省略せず表示する', () =>
  expect(weekRangeLabel('2026-12-27')).toBe('2026 12/27–2027 1/2'));
