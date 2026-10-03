import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Future } from '../src/app/Future';
import { Calendar } from '../src/components/Calendar';
import { CalendarQuantity } from '../src/components/CalendarQuantity';
import { addDays, initialState, today } from '../src/domain/model';
import { calendarQuantity } from '../src/domain/calendarQuantity';

function fixture(offset: number, count?: number) {
  const state = initialState();
  const date = addDays(today(), offset);
  state.settings.materials = [
    {
      id: 'book',
      examId: 'exam',
      name: '問題集',
      total: 100,
      order: 1,
      rounds: [{ completed: 0, minutes: 3 }],
    },
  ];
  state.plan = {
    id: 'p',
    createdAt: new Date().toISOString(),
    approvedAt: `${addDays(date, -1)}T00:00:00+09:00`,
    from: date,
    sessions: [
      {
        id: 's',
        date,
        materialId: 'book',
        examId: 'exam',
        round: 0,
        count: 10,
        start: 600,
        end: 630,
        kind: 'study',
        fixed: false,
      },
    ],
    capacities: [],
    shortfalls: [],
    conflicts: [],
  };
  if (count !== undefined)
    state.records.push({
      id: 'r',
      date,
      materialId: 'book',
      round: 0,
      count,
      cancelled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  return { state, date };
}
const future = ({ state, date }: ReturnType<typeof fixture>) =>
  renderToStaticMarkup(
    createElement(Future, {
      state,
      initialWeek: date,
      update: async () => {},
      onCalendar: () => {},
      onProposal: () => {},
    }),
  );

for (const offset of [-1, 0, 1]) {
  it.each([undefined, 0, 6, 10, 12])(`日区分${offset}：実績%sと不足・未報告の表示`, (count) => {
    const f = fixture(offset, count);
    const html = future(f);
    if (offset > 0) {
      expect(html).toContain('10問</strong>');
      expect(html).not.toContain('/10問');
      expect(html).not.toContain('未報告');
    } else {
      expect(html).toContain(count === undefined ? '未報告 / 10問' : `${count}/10問`);
      expect(html.includes('未報告')).toBe(count === undefined);
    }
    expect(html.includes('quantity-warning')).toBe(
      offset < 0 && (count === undefined || count < 10),
    );
    if (offset < 0 && count !== undefined && count < 10)
      expect(html).toContain(`${10 - count}問不足`);
    else expect(html).not.toContain('問不足');
    expect(html.includes('future-today')).toBe(offset === 0);
    if (offset < 0 && count !== undefined && count >= 10) {
      const calendar = renderToStaticMarkup(
        createElement(CalendarQuantity, {
          state: f.state,
          date: f.date,
          filter: 'all',
          onSelect: () => {},
        }),
      );
      expect(calendar).not.toContain('その日の不足');
    }
  });
}
it('分割・固定予定でも同じ実績を重複表示せず、訂正・取消を反映する', () => {
  const f = fixture(-1, 6);
  const first = f.state.plan!.sessions[0];
  first.count = 4;
  f.state.plan!.sessions.push({ ...first, id: 'fixed', count: 6, fixed: true });
  expect(future(f).match(/6\/10問/g)).toHaveLength(1);
  expect(future(f)).toContain('一部固定');
  f.state.records[0].count = 12;
  expect(future(f)).toContain('12/10問');
  expect(future(f)).not.toContain('問不足');
  f.state.records[0].cancelled = true;
  expect(future(f)).toContain('未報告 / 10問');
  expect(future(f)).toContain('未報告');
  expect(future(f)).not.toContain('問不足');
});
it('再配分で現計画から消えた過去日も履歴を基準に表示し、JSON再読込で維持する', () => {
  const f = fixture(-1, 6);
  f.state.history = [structuredClone(f.state.plan!)];
  f.state.plan!.from = addDays(today(), 1);
  f.state.plan!.sessions = [{ ...f.state.plan!.sessions[0], date: addDays(today(), 1), count: 4 }];
  const loaded = { ...f, state: JSON.parse(JSON.stringify(f.state)) };
  expect(future(loaded)).toContain('6/10問');
  expect(future(loaded)).toContain('4問不足');
  expect(calendarQuantity(loaded.state, addDays(today(), 1)).totals[0].planned).toBe(4);
});
it('基準なしの過去予定は不明と表示し、過去の未報告を確定不足にしない', () => {
  const f = fixture(-1);
  f.state.plan!.approvedAt = `${today()}T00:00:00+09:00`;
  expect(future(f)).not.toContain('基準なし');
  expect(future(f)).toContain('未報告');
  expect(future(f)).not.toContain('/10問');
  const html = renderToStaticMarkup(
    createElement(CalendarQuantity, {
      state: f.state,
      date: f.date,
      filter: 'all',
      onSelect: () => {},
    }),
  );
  expect(html).toContain('未報告');
  expect(calendarQuantity(f.state, f.date).totals[0].shortage).toBeNull();
});
it('不足は報告済み教材だけを合算し、未報告教材を不足確定へ混ぜない', () => {
  const f = fixture(-1, 6);
  f.state.plan!.sessions.push({
    ...f.state.plan!.sessions[0],
    id: 'unreported',
    materialId: 'other',
    count: 20,
  });
  expect(calendarQuantity(f.state, f.date).totals[0]).toMatchObject({
    actual: 6,
    remainder: 24,
    shortage: 4,
    partial: true,
  });
});
it('元の予定がない実績は数量のみ、取消後は未報告のみ表示する', () => {
  const f = fixture(-1, 15);
  f.state.plan!.approvedAt = `${today()}T00:00:00+09:00`;
  expect(future(f)).toContain('15問</strong>');
  expect(future(f)).not.toContain('基準なし');
  expect(future(f)).not.toContain('問不足');
  f.state.records[0].cancelled = true;
  expect(future(f)).toContain('未報告</strong>');
  expect(future(f)).not.toContain('15問');
});
it('詳細カレンダーは日付選択前に常設の日一覧・可処分時間を出さず、今日画面は維持する', () => {
  const f = fixture(0);
  const props = { state: f.state, update: async () => {}, onRecord: () => {}, onReplan: () => {} };
  const html = renderToStaticMarkup(createElement(Calendar, props));
  expect(html).not.toContain('day-panel');
  expect(html).not.toContain('daily-time');
  expect(html).not.toContain('capacity-panel');
  expect(html).toContain('calendar-grid');
  const todayHtml = renderToStaticMarkup(createElement(Calendar, { ...props, todayOnly: true }));
  expect(todayHtml).toContain('today-schedule');
  expect(todayHtml).toContain('daily-time');
});
it('標準表示は今日から7日で、前日に選んだ手動範囲は復元しない', () => {
  const { state } = fixture(0);
  const props = { state, update: async () => {}, onCalendar: () => {}, onProposal: () => {} };
  for (const selection of [null, { from: addDays(today(), 7), selectedOn: addDays(today(), -1) }]) {
    const html = renderToStaticMarkup(createElement(Future, { ...props, selection }));
    expect(html).toContain(`dateTime="${today()}"`);
    expect(html).toContain('future-today');
  }
  const selected = addDays(today(), 7);
  const html = renderToStaticMarkup(createElement(Future, { ...props, selection: { from: selected, selectedOn: today() } }));
  expect(html).toContain(`dateTime="${selected}"`);
  expect(html).toContain('今日から');
});

it('残量の内訳表示を廃止しても未配置量・理由と要確認を保持し、表示で状態を変えない', () => {
  const f = fixture(1);
  f.state.plan!.shortfalls = [{ materialId: 'book', round: 0, count: 90, minutes: 270, reason: '期限内の学習枠が足りません。' }];
  f.state.draft.planReconciliation = { status: 'blocked', asOf: today(), reason: 'fixed-conflict', detail: '固定予定と学習順序を確認してください。' };
  const before = structuredClone(f.state);
  const html = future(f);
  expect(html).not.toContain('残量の内訳');
  expect(html).not.toContain('future-work');
  expect(html).toContain('未配置 1件');
  expect(html).toContain('90問');
  expect(html).toContain('期限内の学習枠が足りません。');
  expect(html).toContain('調整未反映・要確認。現在の計画を保持しています。');
  expect(html).toContain('固定予定と学習順序を確認してください。');
  expect(html.indexOf('shortfall-summary')).toBeLessThan(html.indexOf('future-week'));
  expect(f.state).toEqual(before);
});
