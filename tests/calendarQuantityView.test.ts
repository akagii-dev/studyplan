import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CalendarQuantity } from '../src/components/CalendarQuantity';
import { initialState, today } from '../src/domain/model';

it('予定も記録もない日は予定なしと表示し、0問記録を生成しない', () => {
  const state = initialState();
  const before = structuredClone(state);
  const html = renderToStaticMarkup(
    createElement(CalendarQuantity, { state, date: today(), filter: 'all', onSelect: () => {} }),
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
    createElement(CalendarQuantity, { state, date: today(), filter: 'all', onSelect: () => {} }),
  );
  expect(html).toContain('未報告');
  expect(html).toContain('未報告 / 20問');
  expect(state.records).toHaveLength(0);
});
