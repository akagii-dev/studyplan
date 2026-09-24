import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Future } from '../src/app/Future';
import { TodayRecorder } from '../src/components/TodayRecorder';
import { addDays, initialState, today } from '../src/domain/model';

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

it('今日の教材ごとに予定・実績・追加分入力を分け、0問と予定外も示す', () => {
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
  expect(html).toContain('3/0問');
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
