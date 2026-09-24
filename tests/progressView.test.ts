import { createElement, ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { initialState, today, addDays } from '../src/domain/model';
import { calendarQuantity } from '../src/domain/calendarQuantity';
import { progressView } from '../src/domain/progressView';
import { todayStudyRows } from '../src/domain/todayProgress';
import { Future } from '../src/app/Future';
import { CalendarQuantity } from '../src/components/CalendarQuantity';
import { CalendarDaySummary } from '../src/components/CalendarDaySummary';
import { TodayRecorder } from '../src/components/TodayRecorder';

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
