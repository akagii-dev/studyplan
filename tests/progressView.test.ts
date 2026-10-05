import { createElement, ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { initialState, today, addDays } from '../src/domain/model';
import { calendarDisplayQuantity, calendarQuantity, quantityTotals } from '../src/domain/calendarQuantity';
import { progressView } from '../src/domain/progressView';
import { todayStudyRows } from '../src/domain/todayProgress';
import { Dashboard } from '../src/app/Dashboard';
import { Future } from '../src/app/Future';
import { CalendarQuantityDetails } from '../src/components/CalendarQuantity';
import { CalendarDaySummary } from '../src/components/CalendarDaySummary';
import { TodayRecorder } from '../src/components/TodayRecorder';
import {
  adjustmentContext,
  adjustmentFixture,
  adjustmentReport,
  remainingPlacementFixture,
  elapsedPlacementFixture,
} from './fixtures/adjustment';
import { recordAndAdjust, correctAndAdjust, reconcilePlanning } from '../src/domain/progressAdjustment';
import {
  approve,
  proposeRestart,
  proposeRemainingAdjustment,
} from '../src/domain/planner/proposal';
import { activePlanWork } from '../src/domain/progressAllocation';
import { remainingWork, remainingAdjustmentPreview } from '../src/domain/remainingWork';
import { createProgressBaseline } from '../src/domain/progressReflection';

it.each([undefined, 0, 2])(
  '未報告・0・部分(%s)の有効残量と配置先を分け、無効枠を未配置へ変換しない',
  (report) => {
    const state = remainingPlacementFixture(adjustmentContext.date, report);
    const before = structuredClone(state);
    const row = remainingWork(state, adjustmentContext.date, 530).find(
      (r) => r.materialId === 'b',
    )!;
    expect(row).toMatchObject({
      remaining: 10 - (report ?? 0),
      executable: 10 - (report ?? 0),
      unplaced: 0,
      needsReview: false,
    });
    expect(row.placements.map((s) => s.count)).toEqual([5 - (report ?? 0), 5]);
    const expired = remainingWork(state, adjustmentContext.date, 720).find(
      (r) => r.materialId === 'b',
    )!;
    expect(expired).toMatchObject({ executable: 5, pending: 5 - (report ?? 0), unplaced: 0, needsReview: false });
    expect(expired.pendingPlacements[0].count).toBe(5 - (report ?? 0));
    expect(expired.unavailable).toEqual([]);
    expect(state).toEqual(before);
    const failed = {
      ...state,
      draft: { progressAdjustment: { status: 'failed', detail: '計算を完了できません' } },
    };
    expect(remainingWork(failed, adjustmentContext.date)[1]).toMatchObject({
      unplaced: 0,
      needsReview: true,
    });
  },
);

it('160問の残量を保持し、固定や数量不整合を検出する', () => {
  const state = elapsedPlacementFixture();
  const before = structuredClone(state);
  const row = remainingWork(state, adjustmentContext.date, 720)[0];
  expect(row).toMatchObject({ remaining: 160, executable: 123, pending: 37, unplaced: 0, balanced: true, needsReview: false });
  expect(row.placements).toHaveLength(13);
  expect(row.pendingPlacements.map((s) => s.count)).toEqual([1, 12, 12, 12]);
  expect(state).toEqual(before);
  state.plan!.sessions[0].fixed = true;
  const fixed = remainingWork(state, adjustmentContext.date, 720)[0];
  expect(fixed).toMatchObject({ pending: 36, needsReview: true });
  expect(fixed.unavailable[0].session).toMatchObject({ fixed: true, count: 1 });
  expect(fixed.unavailable[0].clockOnly).toBe(true);
  state.plan!.sessions.at(-1)!.count += 1;
  const broken = remainingWork(state, adjustmentContext.date, 720)[0];
  expect(broken).toMatchObject({ balanced: false, needsReview: true, unplaced: 0 });
  expect(broken.reasons.join(' ')).toContain('一致していません');
  expect(broken.unavailable.every((item) => !item.clockOnly)).toBe(true);
});

it('部分案の表示はB全体10問と対象5問を混同せず、非対象の5問を結果へ加算しない', () => {
  const state = remainingPlacementFixture();
  const proposed = proposeRemainingAdjustment(
    state,
    [{ kind: 'session', sessionId: 'b-target' }],
    adjustmentContext.date,
    adjustmentContext,
  );
  const preview = remainingAdjustmentPreview(proposed)!;
  expect(preview.rows[0]).toMatchObject({ count: 5, placed: 5, unplaced: 0, balanced: true });
  expect(preview.rows[0].destinations.some((s) => s.id === 'b-keep')).toBe(false);
  expect(preview.affected).toEqual([]);
});

it.each(['kept', 'moved', 'unplaced'] as const)(
  '同じ教材の選択2問と順序で動く関連3問を分離する（%s）',
  (mode) => {
    const day = adjustmentContext.date;
    const state = remainingPlacementFixture();
    state.settings.materials.push({
      id: 'c',
      examId: 'a',
      name: '後続C',
      total: 5,
      order: 3,
      rounds: [{ completed: 0, minutes: 3 }],
    });
    state.plan!.sessions.push({
      ...state.plan!.sessions[2],
      id: 'c-other',
      materialId: 'c',
      count: 3,
      start: 555,
      end: 564,
    });
    state.plan!.sessions.push({
      ...state.plan!.sessions[2],
      id: 'c-target',
      materialId: 'c',
      date: addDays(day, mode === 'kept' ? 3 : 2),
      count: 2,
      start: 570,
      end: 576,
    });
    state.plan!.settingsSnapshot = structuredClone(state.settings);
    state.plan!.progressBaseline = createProgressBaseline(state.plan!, []);
    const proposed = proposeRemainingAdjustment(
      state,
      [
        { kind: 'session', sessionId: 'b-target' },
        { kind: 'session', sessionId: 'c-target' },
      ],
      addDays(day, mode === 'kept' ? 2 : mode === 'moved' ? 3 : 4),
      adjustmentContext,
    );
    const preview = remainingAdjustmentPreview(proposed)!;
    const row = preview.rows.find((r) => r.materialId === 'c')!;
    expect(preview.affected.filter((s) => s.materialId === 'c').reduce((sum, s) => sum + s.count, 0)).toBe(3);
    expect(row).toMatchObject({
      count: 2,
      placed: mode === 'unplaced' ? 0 : 2,
      unplaced: mode === 'unplaced' ? 2 : 0,
      relatedCount: 3,
      relatedUnplaced: mode === 'unplaced' ? 3 : 0,
      balanced: true,
    });
    expect(row.destinations.reduce((sum, s) => sum + s.count, 0)).toBe(row.placed);
    expect(row.relatedDestinations.reduce((sum, s) => sum + s.count, 0) + row.relatedUnplaced).toBe(
      3,
    );
    if (mode === 'kept') expect(row.destinations.map((s) => s.id)).toEqual(['c-target']);
    if (mode === 'moved') {
      expect(row.destinations).toHaveLength(1);
      expect(row.destinations[0].end - row.destinations[0].start).toBe(6);
      expect(row.relatedDestinations[0].start).toBe(row.destinations[0].end);
      expect(row.relatedDestinations[0].end - row.relatedDestinations[0].start).toBe(9);
    }
    const broken = structuredClone(proposed);
    const shortfall = broken.proposal!.plan.shortfalls.find((s) => s.materialId === 'c');
    if (shortfall) shortfall.count -= 1;
    else broken.proposal!.plan.sessions.find((s) => s.materialId === 'c')!.count -= 1;
    expect(
      remainingAdjustmentPreview(broken)!.rows.find((r) => r.materialId === 'c')!.balanced,
    ).toBe(false);
  },
);

for (const offset of [-1, 0, 1]) {
  it.each([undefined, 0, 3, 6, 10, 12])(`日区分${offset}の実績%sを画面間で統一する`, (count) => {
    const date = addDays(today(), offset);
    const state = initialState();
    state.settings.materials = [
      {
        id: 'm',
        examId: 'e',
        name: '問題集',
        total: 100,
        order: 1,
        rounds: [{ completed: 0, minutes: 2 }],
      },
    ];
    state.plan = {
      id: 'p',
      createdAt: `${addDays(date, -1)}T00:00:00+09:00`,
      from: date,
      sessions: [
        {
          id: 's',
          date,
          start: 600,
          end: 620,
          materialId: 'm',
          examId: 'e',
          round: 0,
          count: 10,
          kind: 'study',
          fixed: false,
        },
      ],
      capacities: [],
      conflicts: [],
      shortfalls: [],
    };
    if (count !== undefined)
      state.records = [
        {
          id: 'r',
          date,
          materialId: 'm',
          round: 0,
          count,
          cancelled: false,
          createdAt: '',
          updatedAt: '',
        },
      ];
    const before = structuredClone(state);
    const row = calendarQuantity(state, date).rows[0];
    const view = progressView(row, date, today());
    const expected = offset > 0 ? '10問' : count === undefined ? '未報告 / 10問' : `${count}/10問`;
    expect(view.text).toBe(expected);
    const renders: ReactElement[] = [
      createElement(Future, {
        state,
        initialWeek: date,
        update: async () => {},
        onCalendar: () => {},
        onProposal: () => {},
      }),
      createElement(CalendarQuantityDetails, { state, date, filter: 'all', onRecord: () => {} }),
      createElement(CalendarDaySummary, {
        state,
        date,
        filter: 'all',
        density: 'compact',
        onSelect: () => {},
      }),
    ];
    if (offset === 0) {
      renders.push(createElement(TodayRecorder, { state, update: async () => {} }));
      expect(todayStudyRows(state)[0].progress).toEqual(view);
    }
    for (const element of renders) {
      const html = renderToStaticMarkup(element);
      expect(html).toContain(expected);
      expect(html).not.toContain('基準なし');
      expect(html).not.toContain('実績あり');
      const shortage = offset < 0 && count !== undefined && count < 10;
      expect(html.includes('問不足')).toBe(shortage);
    }
    expect(state).toEqual(before);
  });
}
it('訂正・取消を反映し、比較不能と0予定の比率を作らない', () => {
  const row = { planned: 10, actual: 3, reported: true, unit: '問' };
  expect(progressView(row, '2026-01-01', '2026-01-02')).toMatchObject({
    deficit: 7,
    progressRatio: 0.3,
    prefill: 7,
  });
  expect(progressView({ ...row, actual: 12 }, '2026-01-01', '2026-01-02')).toMatchObject({
    deficit: 0,
    progressRatio: 1.2,
    prefill: 0,
  });
  for (const planned of [null, 0])
    expect(progressView({ ...row, planned }, '2026-01-01', '2026-01-02').progressRatio).toBeNull();
  expect(
    progressView({ ...row, planned: null, actual: 15 }, '2026-01-01', '2026-01-02'),
  ).toMatchObject({ text: '15問', deficit: null, comparisonAvailable: false });
  expect(
    progressView({ ...row, planned: null, actual: 0, reported: false }, '2026-01-01', '2026-01-02')
      .text,
  ).toBe('未報告');
});

it.each([
  { offset: 0, expected: 6 },
  { offset: 1, expected: 0 },
])(
  '今日6・実績4から$offset日後に仕切り直し、今日残り$expectedを画面と入力で共有する',
  ({ offset, expected }) => {
    const context = { ...adjustmentContext, minute: 0 };
    const original = recordAndAdjust(adjustmentFixture(), adjustmentReport(4), context);
    const state = approve(
      proposeRestart(original, addDays(context.date, offset), context),
      false,
      context,
    );
    const snapshot = structuredClone(state);
    const quantity = calendarQuantity(state, context.date, context.date);
    const row = quantity.rows.find((r) => r.materialId === 'book' && r.round === 0)!;
    expect(row).toMatchObject({ planned: 6, actual: 4, remainder: 2, currentRemaining: expected });
    expect(
      state.studyDayBaselines?.[context.date].rows.find(
        (r) => r.materialId === 'book' && r.round === 0,
      )?.count,
    ).toBe(6);
    const view = progressView(row, context.date, context.date);
    expect(view).toMatchObject({
      text: `実績 4問 · 今日の残り ${expected}問`,
      prefill: expected,
      progressRatio: null,
    });
    expect(
      todayStudyRows(state, context.date).find((r) => r.materialId === 'book' && r.round === 0)
        ?.progress,
    ).toEqual(view);
    if (offset === 1) expect(todayStudyRows(state, context.date)).toHaveLength(1);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(context.timestamp));
    try {
      for (const element of [
        createElement(TodayRecorder, { state, update: async () => {} }),
        createElement(Future, {
          state,
          update: async () => {},
          initialWeek: context.date,
          onCalendar: () => {},
          onProposal: () => {},
        }),
      ])
        expect(renderToStaticMarkup(element)).toContain(view.text);
      const filtered = calendarQuantity(state, context.date, context.date, 'a').totals[0];
      expect(filtered.currentRemaining).toBe(expected);
      expect(
        renderToStaticMarkup(
          createElement(CalendarQuantityDetails, {
            state,
            date: context.date,
            filter: 'a',
            onRecord: () => {},
          }),
        ),
      ).toContain(view.text);
    } finally {
      vi.useRealTimers();
    }
    const past = calendarQuantity(state, context.date, addDays(context.date, 1)).rows.find(
      (r) => r.materialId === 'book' && r.round === 0,
    )!;
    expect(past.currentRemaining).toBeUndefined();
    expect(progressView(past, context.date, addDays(context.date, 1))).toMatchObject({
      text: '4/6問',
      deficit: 2,
    });
    expect(state).toEqual(snapshot);
  },
);

it('仕切り直し後の追加・訂正・取消は今日の有効量へ反映し、旧比較値6を保持する', () => {
  const context = { ...adjustmentContext, minute: 0 };
  const original = recordAndAdjust(adjustmentFixture(), adjustmentReport(4), context);
  let state = approve(proposeRestart(original, context.date, context), false, context);
  state = recordAndAdjust(state, adjustmentReport(1, 'extra'), context);
  const check = (actual: number, left: number) => {
    const row = calendarQuantity(state, context.date, context.date).rows.find(
      (r) => r.materialId === 'book' && r.round === 0,
    )!;
    expect(row).toMatchObject({ planned: 6, actual, currentRemaining: left });
    expect(progressView(row, context.date, context.date).prefill).toBe(left);
    expect(
      activePlanWork(state, context.date)
        .filter((s) => s.date === context.date && s.materialId === 'book' && s.round === 0)
        .reduce((n, s) => n + s.count, 0),
    ).toBe(left);
  };
  check(5, 5);
  state = correctAndAdjust(state, 'extra', 3, false, context);
  check(7, 3);
  state = correctAndAdjust(state, 'extra', 3, true, context);
  check(4, 6);
  state = correctAndAdjust(state, 'record', 4, true, context);
  check(0, 6);
});

for (const offset of [0, 1]) {
  it.each(['unreported', 'zero', 'recorded', 'cancelled'] as const)(
    `${offset}日後から仕切り直した当日の%sは有効な予定・実績だけを全予定画面に表示する`,
    (report) => {
      // At noon today's 09:00–11:00 slot has elapsed. Both starts move all
      // outstanding work forward, without inventing a report for the old day.
      const context = adjustmentContext;
      let source = adjustmentFixture();
      if (report !== 'unreported') {
        source = recordAndAdjust(source, adjustmentReport(report === 'zero' ? 0 : 4), context);
        if (report === 'cancelled') source = correctAndAdjust(source, 'record', 4, true, context);
      }
      const state = approve(
        proposeRestart(source, addDays(context.date, offset), context),
        false,
        context,
      );
      const before = structuredClone(state);
      const hasReport = report === 'zero' || report === 'recorded';
      const actual = report === 'recorded' ? 4 : 0;
      expect(activePlanWork(state, context.date).filter((s) => s.date === context.date)).toEqual(
        [],
      );
      expect(remainingWork(state, context.date)).toMatchObject([
        { total: 30, completed: actual, allocated: 30 - actual, unplaced: 0, balanced: true },
        { total: 30, completed: 0, allocated: 30, unplaced: 0, balanced: true },
        { total: 45, completed: 0, allocated: 45, unplaced: 0, balanced: true },
      ]);
      const comparison = calendarQuantity(state, context.date, context.date);
      expect(comparison.rows).toMatchObject([
        { materialId: 'book', planned: 6, actual, reported: hasReport, currentRemaining: 0 },
        { materialId: 'other', planned: 9, actual: 0, reported: false, currentRemaining: 0 },
      ]);
      expect(state.history.at(-1)).toEqual(source.plan);
      vi.useFakeTimers();
      vi.setSystemTime(new Date(context.timestamp));
      try {
        for (const element of [
          createElement(Future, {
            state,
            update: async () => {},
            initialWeek: context.date,
            onCalendar: () => {},
            onProposal: () => {},
          }),
          createElement(CalendarQuantityDetails, {
            state,
            date: context.date,
            filter: 'all',
            onRecord: () => {},
          }),
          createElement(CalendarDaySummary, {
            state,
            date: context.date,
            filter: 'all',
            density: 'standard',
            onSelect: () => {},
          }),
        ]) {
          const html = renderToStaticMarkup(element);
          expect(html).not.toContain('未報告 · 今日の残り 0問');
          expect(html).not.toContain('未報告あり');
          expect(html).not.toContain('進捗を記録');
          if (hasReport) expect(html).toContain(`実績 ${actual}問 · 今日の残り 0問`);
        }
      } finally {
        vi.useRealTimers();
      }
      expect(todayStudyRows(state, context.date)).toHaveLength(hasReport ? 1 : 0);
      const past = calendarQuantity(state, context.date, addDays(context.date, 1));
      expect(past.rows).toMatchObject([
        { materialId: 'book', planned: 6, actual, reported: hasReport },
        { materialId: 'other', planned: 9, actual: 0, reported: false },
      ]);
      expect(state).toEqual(before);
    },
  );
}

describe('今日の教材・周回別進捗', () => {
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
      {
        materialId: 'b',
        materialName: '問題集B',
        round: 0,
        planned: 10,
        actual: 0,
        reported: false,
      },
    ]);
    expect(calendarQuantity(s, date, date).rows.find(row => row.materialId === 'c')).toMatchObject({ planned: 0, actual: 3, reported: true });
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
});

describe('ホームの未配置表示', () => {
  it('承認済み未配置の理由をホームで問題集・周回ごとに直接開ける', () => {
    const state = initialState();
    state.settings.materials = [
      {
        id: 'a',
        examId: 'exam',
        name: '問題集A',
        total: 20,
        order: 1,
        rounds: [{ completed: 0, minutes: 3 }],
      },
      {
        id: 'b',
        examId: 'exam',
        name: '問題集B',
        total: 20,
        order: 2,
        rounds: [
          { completed: 0, minutes: 3 },
          { completed: 0, minutes: 3 },
        ],
      },
    ];
    state.plan = {
      id: 'approved',
      createdAt: '2030-10-07T00:00:00Z',
      from: '2030-10-07',
      sessions: [],
      capacities: [],
      conflicts: [],
      shortfalls: [
        { materialId: 'a', round: 0, count: 15, minutes: 30, reason: '学習枠がありません。' },
        { materialId: 'b', round: 1, count: 20, minutes: 40, reason: '期限内に収まりません。' },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(Dashboard, {
        state,
        update: async () => {},
        navigate: () => {},
        onReview: () => {},
      }),
    );
    expect(html).toContain('<section class="shortfall-summary"');
    expect(html).toContain('<h2>未配置 2件・1時間10分</h2>');
    expect(html).toContain('問題集A · 1周目</span><strong>15問</strong>');
    expect(html).toContain('<summary>理由</summary>');
    expect(html).toContain('学習枠がありません。');
    expect(html).toContain('問題集B · 2周目</span><strong>20問</strong>');
    expect(html).toContain('期限内に収まりません。');
    expect(html).not.toContain('理由を確認');
  });
});

describe('カレンダーの予定なし・未報告表示', () => {
  it('予定も記録もない日は予定なしと表示し、0問記録を生成しない', () => {
    const state = initialState();
    const before = structuredClone(state);
    const html = renderToStaticMarkup(
      createElement(CalendarQuantityDetails, { state, date: today(), filter: 'all', onRecord: () => {} }),
    );
    expect(html).toContain('予定なし');
    expect(html).not.toContain('未記録');
    expect(html).not.toContain('基準なし');
    expect(state).toEqual(before);
  });

  it('未報告の予定量は残して表示する', () => {
    const state = initialState();
    state.plan = {
      id: 'p',
      createdAt: new Date().toISOString(),
      from: today(),
      sessions: [
        {
          id: 's',
          materialId: 'm',
          examId: 'e',
          date: today(),
          round: 0,
          count: 20,
          start: 600,
          end: 660,
          kind: 'study',
          fixed: false,
        },
      ],
      capacities: [],
      conflicts: [],
      shortfalls: [],
    };
    const html = renderToStaticMarkup(
      createElement(CalendarQuantityDetails, { state, date: today(), filter: 'all', onRecord: () => {} }),
    );
    expect(html).toContain('未報告');
    expect(html).toContain('未報告 / 20問');
    expect(state.records).toHaveLength(0);
  });
});

describe('今日の記録と今後の予定', () => {
  function fixture() {
    const state = initialState();
    const date = today();
    state.settings.exams = [
      {
        id: 'exam',
        name: '試験',
        start: date,
        target: addDays(date, 3),
        priority: 1,
        color: '#287569',
        reviewDays: 1,
      },
    ];
    state.settings.materials = [
      {
        id: 'a',
        examId: 'exam',
        name: '問題集A',
        total: 30,
        order: 1,
        rounds: [{ completed: 0, minutes: 2 }],
      },
      {
        id: 'b',
        examId: 'exam',
        name: '問題集B',
        total: 30,
        order: 2,
        rounds: [{ completed: 0, minutes: 3 }],
      },
      {
        id: 'c',
        examId: 'exam',
        name: '問題集C',
        total: 30,
        order: 3,
        rounds: [{ completed: 0, minutes: 4 }],
      },
    ];
    state.plan = {
      id: 'plan',
      createdAt: date,
      from: date,
      sessions: [
        {
          id: 'a-today',
          date,
          start: 900,
          end: 920,
          examId: 'exam',
          materialId: 'a',
          round: 0,
          count: 10,
          fixed: false,
          kind: 'study',
        },
        {
          id: 'b-today',
          date,
          start: 930,
          end: 960,
          examId: 'exam',
          materialId: 'b',
          round: 0,
          count: 10,
          fixed: false,
          kind: 'study',
        },
        {
          id: 'a-fixed',
          date: addDays(date, 1),
          start: 900,
          end: 920,
          examId: 'exam',
          materialId: 'a',
          round: 0,
          count: 10,
          fixed: true,
          kind: 'study',
        },
        {
          id: 'a-free',
          date: addDays(date, 1),
          start: 1000,
          end: 1010,
          examId: 'exam',
          materialId: 'a',
          round: 0,
          count: 5,
          fixed: false,
          kind: 'study',
        },
        {
          id: 'review',
          date: addDays(date, 2),
          start: 1000,
          end: 1030,
          examId: 'exam',
          materialId: '',
          round: 0,
          count: 0,
          fixed: false,
          kind: 'review',
        },
      ],
      capacities: [],
      shortfalls: [],
      conflicts: [],
    };
    state.records = [
      {
        id: 'a-report',
        date,
        materialId: 'a',
        round: 0,
        count: 15,
        cancelled: false,
        createdAt: date,
        updatedAt: date,
      },
      {
        id: 'b-zero',
        date,
        materialId: 'b',
        round: 0,
        count: 0,
        cancelled: false,
        createdAt: date,
        updatedAt: date,
      },
    ];
    return state;
  }

  it('今日の予定行と予定外の入口を分け、0問の報告も示す', () => {
    const state = fixture();
    state.records.push({
      id: 'outside',
      date: today(),
      materialId: 'c',
      round: 0,
      count: 3,
      cancelled: false,
      createdAt: today(),
      updatedAt: today(),
    });
    const html = renderToStaticMarkup(
      createElement(TodayRecorder, { state, update: async () => {} }),
    );
    expect(html).toContain('問題集A');
    expect(html).toContain('15/10問');
    expect(html).toContain('150%');
    expect(html).toContain('0/10問');
    expect(html).toContain('問題集C');
    expect(html).not.toContain('3/0問');
    expect(html).not.toContain('Infinity');
    expect(html).toContain('予定外の学習を記録');
    expect(html).toContain('問題集A 1周目の追加分（問）');
  });

  it('将来の同じ教材でも固定10問と可動5問を区別し、復習を残す', () => {
    const html = renderToStaticMarkup(
      createElement(Future, {
        initialWeek: today(),
        state: fixture(),
        update: async () => {},
        onCalendar: () => {},
        onProposal: () => {},
      }),
    );
    expect(html).toContain('10問</strong><span class="future-fixed">固定</span>');
    expect(html).toContain('5問</strong>');
    expect(html).toContain('試験 · 復習');
    expect(html).not.toContain('15問</strong><span class="future-fixed">固定</span>');
  });

  it('全量未配置でも今後の予定に教材別問数を常時示し、理由だけ開いて確認できる', () => {
    const state = fixture();
    state.plan!.sessions = state.plan!.sessions.filter((session) => session.date === today());
    state.plan!.shortfalls = [
      { materialId: 'a', round: 0, count: 5, minutes: 10, reason: 'Aの学習枠がありません。' },
      { materialId: 'b', round: 0, count: 2, minutes: 6, reason: 'Bの期限を過ぎました。' },
    ];
    const html = renderToStaticMarkup(
      createElement(Future, {
        // Inspect the next week, which excludes today on every weekday.
        initialWeek: addDays(today(), 7),
        state,
        update: async () => {},
        onCalendar: () => {},
        onProposal: () => {},
      }),
    );
    expect(html).toContain('この週に配置済み予定はありません');
    expect(html).toContain('未配置 2件・16分');
    expect(html).toContain('問題集A · 1周目</span><strong>5問</strong>');
    expect(html).toContain('問題集B · 1周目</span><strong>2問</strong>');
    expect(html).toContain('<summary>理由</summary>');
    expect(html).not.toContain('未配置 7問');
  });
});


describe('過去分の調整済み表示', () => {
  const date = adjustmentContext.date;
  const reference = addDays(date, 1);
  function reflected(count?: number) {
    const initial = adjustmentFixture();
    const source = count === undefined ? initial : recordAndAdjust(initial, adjustmentReport(count), adjustmentContext);
    return reconcilePlanning(source, {
      ...adjustmentContext, date: reference, minute: 0, timestamp: reference + 'T00:00:00+09:00',
    });
  }
  const rowOf = (state: ReturnType<typeof reflected>) =>
    calendarQuantity(state, date, reference).rows.find((row) => row.materialId === 'book' && row.round === 0)!;

  it.each([undefined, 0, 2])('確定計画へ繰り越した実績%sの不足・未報告を残し、調整済みを共有表示する', (count) => {
    const state = reflected(count);
    const before = structuredClone(state);
    const row = rowOf(state);
    expect(state.plan!.shortfalls).toEqual([]);
    expect(row).toMatchObject({ planned: 6, actual: count ?? 0, reported: count !== undefined, adjustment: 'applied' });
    const view = progressView(row, date, reference);
    expect(view).toMatchObject({
      text: count === undefined ? '未報告 / 6問' : String(count) + '/6問',
      deficit: count === undefined ? null : 6 - count,
      warning: false,
      adjustment: 'applied',
    });
    expect(view.supplement).toContain('調整済み');
    if (count !== undefined) expect(view.supplement).toContain(String(6 - count) + '問不足');
    expect(calendarQuantity(state, date, reference).totals[0].adjustment).toBe('applied');
    vi.useFakeTimers();
    vi.setSystemTime(new Date(reference + 'T12:00:00'));
    try {
      for (const element of [
        createElement(CalendarQuantityDetails, { state, date, filter: 'all', onRecord: () => {} }),
        createElement(CalendarDaySummary, { state, date, filter: 'all', density: 'compact', onSelect: () => {} }),
      ]) {
        const html = renderToStaticMarkup(element);
        expect(html).toContain('調整済み');
        expect(html).toContain('未報告');
        expect(html).not.toContain('quantity-warning');
      }
    } finally {
      vi.useRealTimers();
    }
    expect(state).toEqual(before);
  });

  it.each(['blocked', 'review', 'failed', 'corrected', 'cancelled', 'same-day', 'unknown', 'broken', 'unbalanced', 'changed-settings'] as const)(
    '反映根拠が成立しない%sを調整済みにしない', (reason) => {
      const previous = reflected(2);
      expect(rowOf(previous).adjustment).toBe('applied');
      const state = structuredClone(previous);
      if (reason === 'blocked') state.draft.planReconciliation = { asOf: reference, status: 'blocked', reason: 'pending-proposal' };
      if (reason === 'review' || reason === 'failed') state.draft.progressAdjustment = { recordId: 'record', status: reason };
      if (reason === 'corrected') state.records[0].count = 1;
      if (reason === 'cancelled') state.records[0].cancelled = true;
      if (reason === 'same-day') state.plan!.adjustmentBasis!.date = date;
      if (reason === 'unknown') { delete state.plan!.adjustmentBasis; delete state.plan!.progressBaseline; }
      if (reason === 'broken') state.plan!.adjustmentBasis!.records = { invalid: 2 };
      if (reason === 'unbalanced') state.plan!.sessions.find((session) => session.date > reference && session.kind === 'study')!.count += 1;
      if (reason === 'changed-settings') state.settings.buffer = 0.1;
      const before = structuredClone(state);
      const row = rowOf(state);
      expect(row.adjustment).toBeUndefined();
      expect(progressView(row, date, reference).warning).toBe(true);
      expect(progressView(row, date, reference).supplement).not.toContain('調整済み');
      expect(state).toEqual(before);
    },
  );

  it('案だけでは済みにせず、確定済みの根拠は別案や計算版の変更だけでは失わない', () => {
    const approved = reflected(2);
    const initial = adjustmentFixture();
    initial.proposal = { plan: approved.plan!, basedOn: initial.plan!.id, reason: '未承認の案', unreported: [] };
    expect(rowOf(initial).adjustment).toBeUndefined();
    approved.proposal = initial.proposal;
    approved.plan!.calculationVersion = 1;
    expect(rowOf(approved).adjustment).toBe('applied');
    expect(progressView(rowOf(approved), reference, reference).supplement).not.toContain('調整済み');
    expect(progressView(rowOf(approved), addDays(reference, 1), reference).supplement).not.toContain('調整済み');
  });

  it('未配置が残る調整と、未反映行が混じる合計を完了扱いしない', () => {
    const state = reflected(2);
    const session = state.plan!.sessions.find((item) => item.date > reference && item.materialId === 'book' && item.round === 0)!;
    session.count -= 1;
    session.end -= 3;
    state.plan!.shortfalls.push({ materialId: 'book', round: 0, count: 1, minutes: 3, reason: '学習枠が不足しています。' });
    state.plan!.progressBaseline = createProgressBaseline(state.plan!, state.records, reference);
    const row = rowOf(state);
    expect(row.adjustment).toBe('unplaced');
    expect(progressView(row, date, reference)).toMatchObject({
      deficit: 4, warning: true, supplement: '4問不足 · 調整済み・未配置あり',
    });
    expect(calendarQuantity(state, date, reference).totals[0].adjustment).toBe('unplaced');
    expect(quantityTotals([row, { ...row, materialId: 'unreflected', adjustment: undefined }])[0].adjustment).toBeUndefined();
  });

  it.each([undefined, 2, 6])('仕切り直し開始日の実績%sを旧分母へ戻さず、未完了分だけ後日の反映済みを示す', (count) => {
    const state = reflected(count);
    state.plan!.allocationStart = date;
    state.plan!.from = reference;
    const before = structuredClone(state);
    const displayed = calendarDisplayQuantity(state, date, reference);
    const row = displayed.rows.find((item) => item.materialId === 'book' && item.round === 0)!;
    const adjustment = count === 6 ? undefined : 'applied';
    expect(row).toMatchObject({ planned: null, actual: count ?? 0, restartPlanned: 6, adjustment });
    expect(progressView(row, date, reference)).toMatchObject({
      text: count === undefined ? '予定 6問 · 未報告' : '予定 6問 · 実績 ' + count + '問',
      deficit: null, progressRatio: null, warning: false, supplement: count === 6 ? '' : '調整済み',
    });
    expect(displayed.totals[0].adjustment).toBe('applied');
    expect(calendarQuantity(state, date, reference).rows.find((item) => item.materialId === 'book')!.planned).toBe(6);
    expect(state).toEqual(before);
  });
});
