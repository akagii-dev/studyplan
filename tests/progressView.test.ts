import { createElement, ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { initialState, today, addDays } from '../src/domain/model';
import { calendarQuantity } from '../src/domain/calendarQuantity';
import { progressView } from '../src/domain/progressView';
import { todayStudyRows } from '../src/domain/todayProgress';
import { Future } from '../src/app/Future';
import { CalendarQuantity, CalendarQuantityDetails } from '../src/components/CalendarQuantity';
import { CalendarDaySummary } from '../src/components/CalendarDaySummary';
import { TodayRecorder } from '../src/components/TodayRecorder';
import { adjustmentContext, adjustmentFixture, adjustmentReport } from './fixtures/adjustment';
import { recordAndAdjust, correctAndAdjust } from '../src/domain/progressAdjustment';
import { approve, proposeRestart } from '../src/domain/planner/proposal';
import { activePlanWork } from '../src/domain/progressAllocation';
import { remainingWork } from '../src/domain/remainingWork';

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
      createElement(CalendarQuantity, { state, date, filter: 'all', onSelect: () => {} }),
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
  { offset: 0, expected: 8 },
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
          createElement(CalendarQuantity, {
            state,
            date: context.date,
            filter: 'a',
            onSelect: () => {},
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
  check(5, 7);
  state = correctAndAdjust(state, 'extra', 3, false, context);
  check(7, 5);
  state = correctAndAdjust(state, 'extra', 3, true, context);
  check(4, 8);
  state = correctAndAdjust(state, 'record', 4, true, context);
  check(0, 8);
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
        if (report === 'cancelled')
          source = correctAndAdjust(source, 'record', 4, true, context);
      }
      const state = approve(proposeRestart(source, addDays(context.date, offset), context), false, context);
      const before = structuredClone(state);
      const hasReport = report === 'zero' || report === 'recorded';
      const actual = report === 'recorded' ? 4 : 0;
      expect(activePlanWork(state, context.date).filter((s) => s.date === context.date)).toEqual([]);
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
            state, update: async () => {}, initialWeek: addDays(context.date, -6),
            onCalendar: () => {}, onProposal: () => {},
          }),
          createElement(CalendarQuantity, { state, date: context.date, filter: 'all', onSelect: () => {} }),
          createElement(CalendarQuantityDetails, { state, date: context.date, filter: 'all', onRecord: () => {} }),
          createElement(CalendarDaySummary, {
            state, date: context.date, filter: 'all', density: 'standard', onSelect: () => {},
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
