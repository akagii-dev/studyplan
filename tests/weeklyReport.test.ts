import { expect, it } from 'vitest';
import { AppState, initialState, Session } from '../src/domain/model';
import { createWeeklyReport, dailyReportDetails, reportRate } from '../src/domain/weeklyReport';
const asOf = new Date(2026, 8, 27, 12, 0, 0);
function fixture(): AppState {
  const s = initialState();
  s.settings.exams = ['e1', 'e2'].map((id) => ({
    id,
    name: `試験${id}`,
    start: '2026-09-01',
    target: '2026-10-30',
    priority: 2,
    color: '#287569',
    reviewDays: 0,
  }));
  s.settings.materials = [
    {
      id: 'm1',
      examId: 'e1',
      name: '問題集A',
      total: 37,
      order: 1,
      rounds: [
        { completed: 2, minutes: 3 },
        { completed: 1, minutes: 4 },
      ],
    },
    {
      id: 'm2',
      examId: 'e2',
      name: '問題集B',
      total: 20,
      order: 1,
      rounds: [{ completed: 0, minutes: 1 }],
    },
  ];
  const session = (
    id: string,
    date: string,
    materialId: string,
    round: number,
    count: number,
    start = 540,
  ): Session => ({
    id,
    date,
    materialId,
    examId: materialId === 'm1' ? 'e1' : 'e2',
    round,
    count,
    start,
    end: start + count * 3,
    kind: 'study',
    fixed: false,
  });
  s.plan = {
    id: 'p',
    from: '2026-09-01',
    createdAt: '2026-09-20T00:00:00Z',
    conflicts: [],
    capacities: [],
    shortfalls: [],
    sessions: [
      session('s1', '2026-09-21', 'm1', 0, 3),
      session('s2', '2026-09-21', 'm1', 0, 7, 600),
      session('s3', '2026-09-22', 'm2', 0, 5),
      session('s4', '2026-09-23', 'm1', 1, 7),
      session('s5', '2026-09-27', 'm2', 0, 5, 1000),
      { ...session('review', '2026-09-24', '', 0, 0), kind: 'review', end: 600 },
      session('outside', '2026-09-28', 'm1', 0, 5),
    ],
  };
  s.records = [
    ['before', '2026-09-20', 'm1', 0, 3, false],
    ['r1', '2026-09-21', 'm1', 0, 7, false],
    ['r2', '2026-09-21', 'm1', 0, 3, false],
    ['zero', '2026-09-22', 'm2', 0, 0, false],
    ['cancelled', '2026-09-23', 'm1', 1, 7, true],
    ['after', '2026-09-28', 'm1', 0, 5, false],
  ].map(([id, date, materialId, round, count, cancelled]) => ({
    id: id as string,
    date: date as string,
    materialId: materialId as string,
    round: round as number,
    count: count as number,
    cancelled: cancelled as boolean,
    createdAt: '2026-09-21T00:00:00Z',
    updatedAt: '2026-09-26T00:00:00Z',
  }));
  return s;
}
it('Monday–Sunday aggregates all exams and rounds without rounding 3/7 questions or duplicating split sessions', () => {
  const s = fixture(),
    before = structuredClone(s);
  const r = createWeeklyReport(s, '2026-09-24', asOf);
  expect([r.from, r.to]).toEqual(['2026-09-21', '2026-09-27']);
  expect(r.totals).toEqual({
    total: 94,
    done: 16,
    remaining: 78,
    weekDone: 10,
    weekPlanned: 27,
    recordCount: 3,
  });
  expect(r.rounds.map((m) => m.done)).toEqual([15, 1, 0]);
  expect(r.exams[0].total).toBe(74);
  expect(r.markdown).toContain('| この週の記録が全体の総問題数に占める割合 | 10.6% |');
  expect(s).toEqual(before);
});
it('zero reports, cancelled-only reports, unreported groups and future sessions stay distinct', () => {
  const r = createWeeklyReport(fixture(), '2026-09-21', asOf);
  expect(r.days[1]).toMatchObject({ done: 0, status: '0問報告 1件' });
  expect(r.days[2]).toMatchObject({ done: null, status: '未報告 1件' });
  expect(r.days[6]).toMatchObject({ done: null, status: 'これから 1件' });
  expect(r.unreported).toHaveLength(1);
  expect(r.unreported[0]).toMatchObject({ material: '問題集A', round: 2, planned: 7 });
  expect(r.markdown).toContain('| 問題集A | 2周目 | 記録なし |');
});
it('日別詳細は教材・周回ごとに予定と有効な実績を分け、明示0と取消を区別する', () => {
  const state = fixture();
  expect(dailyReportDetails(state, '2026-09-21')).toEqual([
    { materialId: 'm1', round: 0, planned: 10, done: 10 },
  ]);
  expect(dailyReportDetails(state, '2026-09-22')).toEqual([
    { materialId: 'm2', round: 0, planned: 5, done: 0 },
  ]);
  expect(dailyReportDetails(state, '2026-09-23')).toEqual([
    { materialId: 'm1', round: 1, planned: 7, done: null },
  ]);
});
it('reports on an earlier week compare against current totals and reflect corrections/cancellations', () => {
  const s = fixture();
  s.records.find((r) => r.id === 'r1')!.count = 5;
  s.records.find((r) => r.id === 'r2')!.cancelled = true;
  const r = createWeeklyReport(s, '2026-09-21', new Date(2026, 9, 1, 12));
  expect(r.totals).toMatchObject({ done: 16, weekDone: 5, remaining: 78 });
  expect(r.markdown).toContain('過去の週を選んでも、全体の進捗は出力時点です');
  expect(r.markdown).toContain('出力日時：2026-10-01 12:00:00');
});
it('unapproved proposals do not replace approved schedules and old plan settings are disclosed', () => {
  const s = fixture();
  s.plan!.settingsSnapshot = structuredClone(s.settings);
  s.settings.materials[0].total = 40;
  s.proposal = {
    plan: { ...s.plan!, sessions: [] },
    basedOn: 'p',
    unreported: [],
    reason: 'pending',
  };
  const r = createWeeklyReport(s, '2026-09-21', asOf);
  expect(r.totals.weekPlanned).toBe(27);
  expect(r.settingsChanged).toBe(true);
  expect(r.markdown).toContain('現在の設定と承認済み計画が一致していません');
});
it('an old approved plan retains questions for rounds removed from the current settings', () => {
  const s = fixture();
  s.settings.materials[0].rounds.pop();
  expect(createWeeklyReport(s, '2026-09-21', asOf).totals.weekPlanned).toBe(27);
});
it('empty state and records without a plan export without inventing completion ratios', () => {
  const empty = createWeeklyReport(initialState(), '2026-09-21', asOf);
  expect(empty.markdown).toContain('| 週間の追加完了数 | 記録なし |');
  expect(empty.markdown).not.toMatch(/NaN|Infinity/);
  const s = fixture();
  s.plan = null;
  const r = createWeeklyReport(s, '2026-09-21', asOf);
  expect(r.totals.weekDone).toBe(10);
  expect(r.markdown).toContain('| 週間予定に対する記録割合 | — |');
  expect(reportRate(7, 5)).toBe('140.0%');
});
it('escapes user names so Markdown tables and HTML cannot be injected', () => {
  const s = fixture();
  s.settings.materials[0].name = '問題|集\n<script> [link](https://example.com) `code`';
  const r = createWeeklyReport(s, '2026-09-21', asOf);
  expect(r.markdown).toContain('問題\\|集 &lt;script&gt; \\[link\\]');
  expect(r.markdown).not.toContain('<script>');
  expect(r.markdown).not.toContain('\n<script>');
});
it('handles week/year boundaries and rejects empty, impossible and future dates', () => {
  const s = initialState();
  const r = createWeeklyReport(s, '2027-01-01', new Date(2027, 0, 1));
  expect([r.from, r.to]).toEqual(['2026-12-28', '2027-01-03']);
  for (const date of ['', '2026-02-30', '2026-09-28', 'no-date'])
    expect(() => createWeeklyReport(s, date, asOf)).toThrow();
});
