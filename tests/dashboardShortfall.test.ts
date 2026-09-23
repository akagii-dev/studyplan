import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Dashboard } from '../src/app/Dashboard';
import { initialState } from '../src/domain/model';

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
