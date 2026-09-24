import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProgressReceiptView, receiptOutcome } from '../src/components/ProgressReceiptView';
import {
  adjustAfterProgress,
  correctAndAdjust,
  currentProgressAdjustment,
  recordAndAdjust,
} from '../src/domain/progressAdjustment';
import { planChanges, latestReceipt, summarizePlanChanges } from '../src/domain/progressReceipt';
import { activePlanWork } from '../src/domain/progressAllocation';
import { addDays, completed, remaining, reported, type AppState } from '../src/domain/model';
import { calendarQuantity } from '../src/domain/calendarQuantity';
import { capacityForDate, capacityForWeek } from '../src/domain/planner/capacity';
import { startOfWeek } from '../src/domain/calendar';
import { createProgressBaseline } from '../src/domain/progressReflection';
import { approve, propose } from '../src/domain/planner/proposal';
import { parseBackup } from '../src/domain/backup';
import { validateSettings } from '../src/domain/planner/validation';
import { adjustmentFixture, adjustmentContext, adjustmentReport } from './fixtures/adjustment';

it('予定6に4問を追加しても、他の教材・周回と未来24問の配置を変えない', () => {
  const before = adjustmentFixture();
  expect(validateSettings(before.settings)).toEqual([]);
  const after = recordAndAdjust(before, adjustmentReport(4), adjustmentContext);
  const changes = planChanges(before.plan, after.plan, adjustmentContext.date);
  expect(summarizePlanChanges(changes)).toEqual({ quantity: 0, placement: 0, materials: 0 });
  expect(after.plan!.shortfalls).toEqual([]);
  expect(after.plan!.sessions).toEqual(before.plan!.sessions);
});

const day = adjustmentContext.date;

it.each(['unreported', 'zero', 'partial'] as const)(
  '前日%sの翌日に4・2問を記録し、画面と配分の今日残量を一致させる',
  (previous) => {
    let start = adjustmentFixture();
    const previousDone = previous === 'partial' ? 3 : 0;
    if (previous !== 'unreported')
      start = recordAndAdjust(start, adjustmentReport(previousDone, 'previous'), adjustmentContext);
    const nextDay = addDays(day, 1);
    const context = { ...adjustmentContext, date: nextDay, timestamp: `${nextDay}T03:00:00.000Z` };
    const report = (n: number, id: string) => ({ ...adjustmentReport(n, id), date: nextDay });
    const check = (s: AppState, todayDone: number) => {
      conservation(s, nextDay);
      const expectedToday = Math.max(0, 6 - todayDone);
      const effective = activePlanWork(s, nextDay).filter(
        (x) => x.materialId === 'book' && x.round === 0,
      );
      expect(
        calendarQuantity(s, nextDay, nextDay).rows.find(
          (r) => r.materialId === 'book' && r.round === 0,
        )?.remainder,
      ).toBe(expectedToday);
      expect(effective.filter((x) => x.date === nextDay).reduce((n, x) => n + x.count, 0)).toBe(
        expectedToday,
      );
      const future = effective.filter((x) => x.date > nextDay).reduce((n, x) => n + x.count, 0);
      const unplaced = s
        .plan!.shortfalls.filter((x) => x.materialId === 'book' && x.round === 0)
        .reduce((n, x) => n + x.count, 0);
      expect(future + unplaced).toBe(30 - previousDone - todayDone - expectedToday);
      expect(s.plan!.sessions.filter((x) => x.date < nextDay)).toEqual(
        start.plan!.sessions.filter((x) => x.date < nextDay),
      );
    };
    let split = recordAndAdjust(start, report(4, 'four'), context);
    check(split, 4); // 0 + 4 + 2 + 24 = 30; previous 3 instead leaves 21 in the future.
    split = recordAndAdjust(split, report(2, 'two'), context);
    check(split, 6);
    const bulk = recordAndAdjust(start, report(6, 'six'), context);
    check(bulk, 6);
    expect(planChanges(split.plan, bulk.plan, nextDay)).toEqual([]);
    expect(split.plan!.shortfalls).toEqual(bulk.plan!.shortfalls);
    expect(remaining(split, 'book', 0)).toBe(remaining(bulk, 'book', 0));
    split = correctAndAdjust(split, 'four', 6, false, context);
    check(split, 8);
    split = correctAndAdjust(split, 'four', 6, true, context);
    check(split, 2);
    const repeated = adjustAfterProgress(JSON.parse(JSON.stringify(split)), 'two', context);
    check(repeated, 2);
    expect(planChanges(split.plan, repeated.plan, nextDay)).toEqual([]);
  },
);

it('日付越え後の部分4問で容量不足6問を隠さず、今日2・未来18・未配置6にする', () => {
  const source = tightFixture();
  const context = { ...adjustmentContext, date: addDays(day, 1) };
  const result = recordAndAdjust(source, { ...adjustmentReport(4), date: context.date }, context);
  conservation(result, context.date);
  expect(result.plan!.shortfalls).toMatchObject([
    { materialId: 'book', round: 0, count: 6, minutes: 18 },
  ]);
  expect(count(result, 'book', 0, addDays(day, 2))).toBe(18);
  expect(
    activePlanWork(result, context.date)
      .filter((s) => s.date === context.date)
      .reduce((n, s) => n + s.count, 0),
  ).toBe(2);
});
const count = (state: AppState, materialId: string, round: number, date = day) =>
  activePlanWork(state, date)
    .filter((s) => s.materialId === materialId && s.round === round)
    .reduce((n, s) => n + s.count, 0);
function conservation(state: AppState, date = day) {
  expect(currentProgressAdjustment(state)?.status).not.toBe('failed');
  for (const m of state.settings.materials)
    for (const round of m.rounds.keys()) {
      const unplaced = state
        .plan!.shortfalls.filter((s) => s.materialId === m.id && s.round === round)
        .reduce((n, s) => n + s.count, 0);
      expect(
        completed(state, m.id, round) + count(state, m.id, round, date) + unplaced,
        `${m.id}/${round}`,
      ).toBe(m.total);
    }
  const future = state.plan!.sessions.filter((s) => s.date > date);
  for (const session of future) {
    expect(
      capacityForDate(state.settings, session.date).slots.some(
        ([start, end]) => start <= session.start && end >= session.end,
      ),
    ).toBe(true);
    expect(
      future.some(
        (s) =>
          s.id !== session.id &&
          s.date === session.date &&
          s.start < session.end &&
          session.start < s.end,
      ),
    ).toBe(false);
  }
  for (const week of new Set(future.map((s) => startOfWeek(s.date)))) {
    const capacity = capacityForWeek(state.settings, week, state.plan!.sessions);
    expect(capacity.used).toBeLessThanOrEqual(capacity.limit);
  }
}

it('30問を4・2・2問と記録し、実績+今日の残り+未来+未配置を保存する', () => {
  let state = adjustmentFixture();
  const expected = [
    { add: 4, actual: 4, today: 2, future: 24, quantity: 0, materials: 0 },
    { add: 2, actual: 6, today: 0, future: 24, quantity: 0, materials: 0 },
    { add: 2, actual: 8, today: 0, future: 22, quantity: 1, materials: 1 },
  ];
  for (const [i, e] of expected.entries()) {
    state = recordAndAdjust(state, adjustmentReport(e.add, `r${i}`), adjustmentContext);
    conservation(state);
    expect(completed(state, 'book', 0)).toBe(e.actual);
    expect(activePlanWork(state, day).find((s) => s.id === 'book-0')?.count ?? 0).toBe(e.today);
    expect(count(state, 'book', 0, addDays(day, 1))).toBe(e.future);
    expect(summarizePlanChanges(latestReceipt(state)!.changes)).toEqual({
      quantity: e.quantity,
      placement: 0,
      materials: e.materials,
    });
    expect(
      calendarQuantity(state, day, day).rows.find((s) => s.materialId === 'book' && s.round === 0)
        ?.planned,
    ).toBe(6);
  }
  expect(state.plan!.sessions.filter((s) => s.materialId !== 'book' || s.round !== 0)).toEqual(
    adjustmentFixture()
      .plan!.sessions.filter((s) => s.materialId !== 'book' || s.round !== 0)
      .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start),
  );
});

it('一括8と4+4、JSON再起動・同一ID再送・繰返し調整で残量と配置が一致する', () => {
  const bulk = recordAndAdjust(adjustmentFixture(), adjustmentReport(8), adjustmentContext);
  let split = recordAndAdjust(adjustmentFixture(), adjustmentReport(4), adjustmentContext);
  split = recordAndAdjust(
    JSON.parse(JSON.stringify(split)),
    adjustmentReport(4, 'second'),
    adjustmentContext,
  );
  expect(split.plan!.sessions).toEqual(bulk.plan!.sessions);
  const retried = recordAndAdjust(split, adjustmentReport(4, 'second'), adjustmentContext);
  expect(retried).toBe(split);
  const repeated = adjustAfterProgress(retried, 'second', {
    ...adjustmentContext,
    idPrefix: 'different',
  });
  expect(repeated.plan).toEqual(split.plan);
  expect(repeated.history).toEqual(split.history);
  expect(currentProgressAdjustment(repeated)?.status).toBe('unchanged');
  conservation(repeated);
});

it('0は報告だけを変え、訂正・再訂正・取消で同じ配置と数量へ復元する', () => {
  const source = adjustmentFixture();
  let state = recordAndAdjust(source, adjustmentReport(0), adjustmentContext);
  expect(reported(state, day, 'book', 0)).toBe(true);
  expect(state.plan!.sessions).toEqual(source.plan!.sessions);
  expect(latestReceipt(state)?.changes).toEqual([]);
  for (const amount of [8, 4, 12, 0]) {
    state = correctAndAdjust(state, 'record', amount, false, adjustmentContext);
    conservation(state);
    expect(count(state, 'book', 0)).toBe(30 - amount);
  }
  state = correctAndAdjust(state, 'record', 0, true, adjustmentContext);
  conservation(state);
  expect(reported(state, day, 'book', 0)).toBe(false);
  expect(planChanges(source.plan, state.plan, day)).toEqual([]);
});

it('全30問の実績は複数予定を消化し、別の周回・教材へ振り替えない', () => {
  const state = recordAndAdjust(adjustmentFixture(), adjustmentReport(30), adjustmentContext);
  conservation(state);
  expect(count(state, 'book', 0)).toBe(0);
  expect(count(state, 'book', 1)).toBe(30);
  expect(count(state, 'other', 0)).toBe(45);
  expect(remaining(state, 'book', 0)).toBe(0);
  expect(() => recordAndAdjust(state, adjustmentReport(1, 'overflow'), adjustmentContext)).toThrow(
    '残り問題数',
  );
});

function tightFixture(twoRounds = false) {
  const s = adjustmentFixture();
  s.settings.materials = [s.settings.materials[0]];
  if (!twoRounds) s.settings.materials[0].rounds = [s.settings.materials[0].rounds[0]];
  const days = twoRounds ? 10 : 5;
  s.settings.exams = [{ ...s.settings.exams[0], target: addDays(day, days) }];
  s.settings.buffer = 0;
  s.settings.windows[0].end = 558;
  s.settings.windows[0].to = addDays(day, days - 1);
  s.plan!.sessions = s.plan!.sessions.filter(
    (x) => x.materialId === 'book' && (twoRounds || x.round === 0),
  );
  s.plan!.settingsSnapshot = structuredClone(s.settings);
  s.plan!.capacities = Array.from({ length: days }, (_, i) =>
    capacityForDate(s.settings, addDays(day, i)),
  );
  s.plan!.progressBaseline = createProgressBaseline(s.plan!, []);
  expect(validateSettings(s.settings)).toEqual([]);
  return s;
}

it.each([false, true])(
  '日付を越えた残り2問を繰越し、容量不足と周回順序を守る（後続周回=%s）',
  (twoRounds) => {
    let state = recordAndAdjust(tightFixture(twoRounds), adjustmentReport(4), adjustmentContext);
    expect(state.plan!.shortfalls).toEqual([]);
    const tomorrow = {
      ...adjustmentContext,
      date: addDays(day, 1),
      timestamp: '2030-10-08T03:00:00.000Z',
    };
    state = recordAndAdjust(
      state,
      { ...adjustmentReport(0, 'zero'), date: tomorrow.date },
      tomorrow,
    );
    conservation(state, tomorrow.date);
    expect(state.plan!.shortfalls).toMatchObject([
      { materialId: 'book', round: twoRounds ? 1 : 0, count: 2, minutes: 6 },
    ]);
    expect(calendarQuantity(state, day, tomorrow.date).rows[0]).toMatchObject({
      planned: 6,
      actual: 4,
      remainder: 2,
    });
    const first = state.plan!.sessions.filter((s) => s.date > tomorrow.date && s.round === 0);
    const second = state.plan!.sessions.filter((s) => s.date > tomorrow.date && s.round === 1);
    for (const a of first)
      for (const b of second)
        expect(a.date < b.date || (a.date === b.date && a.end <= b.start)).toBe(true);
    const repeated = adjustAfterProgress(state, 'zero', tomorrow);
    expect(repeated.plan).toEqual(state.plan);
    conservation(repeated, tomorrow.date);
  },
);

it('日付越えの繰越先に空きがあれば他教材の配置を維持する', () => {
  let state = recordAndAdjust(
    adjustmentFixture(),
    { ...adjustmentReport(9, 'other-done'), materialId: 'other' },
    adjustmentContext,
  );
  state = recordAndAdjust(state, adjustmentReport(4), adjustmentContext);
  const tomorrow = { ...adjustmentContext, date: addDays(day, 1) };
  state = recordAndAdjust(state, { ...adjustmentReport(0, 'zero'), date: tomorrow.date }, tomorrow);
  conservation(state, tomorrow.date);
  expect(state.plan!.shortfalls).toEqual([]);
  const before = adjustmentFixture().plan!.sessions.filter(
    (s) => s.materialId === 'other' && s.date > tomorrow.date,
  );
  expect(
    state.plan!.sessions.filter((s) => s.materialId === 'other' && s.date > tomorrow.date),
  ).toEqual(before);
  expect(calendarQuantity(state, day, tomorrow.date).rows[0]).toMatchObject({
    planned: 6,
    actual: 4,
    remainder: 2,
  });
  expect(adjustAfterProgress(state, 'zero', { ...tomorrow, idPrefix: 'retry' }).plan).toEqual(
    state.plan,
  );
});

it('IDと配列順だけの差分は0、実時刻の移動だけを配置変更に数える', () => {
  const state = adjustmentFixture();
  const reordered = structuredClone(state.plan!);
  reordered.sessions.reverse().forEach((s, i) => (s.id = `new-${i}`));
  expect(planChanges(state.plan, reordered, day)).toEqual([]);
  const moved = structuredClone(state.plan!);
  moved.sessions[1].start += 3;
  moved.sessions[1].end += 3;
  const diff = planChanges(state.plan, moved, day);
  expect(summarizePlanChanges(diff)).toEqual({ quantity: 0, placement: 1, materials: 1 });
  expect(diff[0]).toMatchObject({ beforeCount: 6, afterCount: 6, timeChanged: true });
});

it('問数が変わる予定の詳細は時刻を列挙せず、配置だけの変更では時刻を示す', () => {
  const source = adjustmentFixture();
  const adjusted = recordAndAdjust(source, adjustmentReport(8), adjustmentContext);
  const quantityReceipt = latestReceipt(adjusted)!;
  expect(quantityReceipt.changes).toMatchObject([
    { beforeCount: 6, afterCount: 4, timeChanged: true },
  ]);
  const quantityHtml = renderToStaticMarkup(
    createElement(ProgressReceiptView, { state: adjusted, receipt: quantityReceipt }),
  );
  expect(quantityHtml).toContain('6 → 4問');
  expect(quantityHtml).not.toContain('時間 ');

  const moved = structuredClone(source.plan!);
  moved.sessions[1].start += 3;
  moved.sessions[1].end += 3;
  const placementReceipt = {
    ...quantityReceipt,
    changes: planChanges(source.plan, moved, day),
  };
  const placementHtml = renderToStaticMarkup(
    createElement(ProgressReceiptView, { state: source, receipt: placementReceipt }),
  );
  expect(placementHtml).toContain('6問 · 配置変更');
  expect(placementHtml).toContain('時間 ');
});

it('同じ量の日付移動は配置1件、IDや配列順を変えても同じ差分になる', () => {
  const before = adjustmentFixture().plan!;
  const after = structuredClone(before);
  after.sessions.find((s) => s.id === 'other-4')!.date = addDays(day, 5);
  const changes = planChanges(before, after, day);
  expect(summarizePlanChanges(changes)).toEqual({ quantity: 0, placement: 1, materials: 1 });
  expect(changes).toMatchObject([
    { beforeDate: addDays(day, 4), afterDate: addDays(day, 5), beforeCount: 9, afterCount: 9 },
  ]);
  after.sessions.reverse().forEach((s, i) => (s.id = `regenerated-${i}`));
  expect(planChanges(before, after, day)).toEqual(changes);
  const receipt = {
    ...latestReceipt(recordAndAdjust(adjustmentFixture(), adjustmentReport(0), adjustmentContext))!,
    status: 'applied' as const,
    changes,
  };
  expect(receiptOutcome(receipt)).toContain('配置のみ 1件');
  const html = renderToStaticMarkup(
    createElement(ProgressReceiptView, { state: adjustmentFixture(), receipt }),
  );
  expect(html).toContain('9問 · 配置変更');
  expect(html).not.toContain('9 → 9');
  expect(html).toContain(`${addDays(day, 4)} → ${addDays(day, 5)}`);
});

it('初期完了6も同じ式に含め、実績4と未消化20で総数30を保存する', () => {
  const s = adjustmentFixture();
  s.settings.materials[0].rounds[0].completed = 6;
  s.plan!.sessions = s.plan!.sessions.filter((x) => x.id !== 'book-4');
  s.plan!.settingsSnapshot = structuredClone(s.settings);
  s.plan!.progressBaseline = createProgressBaseline(s.plan!, []);
  const state = recordAndAdjust(s, adjustmentReport(4), adjustmentContext);
  conservation(state);
  expect(count(state, 'book', 0)).toBe(20);
  expect(latestReceipt(state)?.changes).toEqual([]);
});

it('他教材の未配置を空いた枠へ自動充填せず、消化済みIDを新規予定へ流用しない', () => {
  const s = adjustmentFixture();
  s.plan!.sessions.find((x) => x.id === 'book-1')!.id = 'adjust-0';
  s.plan!.sessions = s.plan!.sessions.filter((x) => x.id !== 'other-4');
  s.plan!.shortfalls = [
    { materialId: 'other', round: 0, count: 9, minutes: 27, reason: '保存済みの未配置' },
  ];
  s.plan!.progressBaseline = createProgressBaseline(s.plan!, []);
  let state = recordAndAdjust(s, adjustmentReport(12), adjustmentContext);
  conservation(state);
  expect(state.plan!.shortfalls).toEqual(s.plan!.shortfalls);
  expect(state.plan!.sessions.filter((x) => x.materialId === 'other')).toEqual(
    s.plan!.sessions.filter((x) => x.materialId === 'other'),
  );
  state = recordAndAdjust(
    state,
    { ...adjustmentReport(1, 'other'), materialId: 'other' },
    adjustmentContext,
  );
  conservation(state);
  expect(state.plan!.sessions.some((x) => x.id === 'adjust-0')).toBe(false);
  expect(state.plan!.shortfalls).toEqual([]);
  state = correctAndAdjust(state, 'record', 4, false, adjustmentContext);
  conservation(state);
  expect(state.plan!.sessions.find((x) => x.id === 'adjust-0')).toMatchObject({
    materialId: 'book',
    round: 0,
    count: 6,
  });
});

it('前日の未達3と翌日の超過3が相殺され、さらに先の予定を減らさない', () => {
  let state = recordAndAdjust(tightFixture(), adjustmentReport(3), adjustmentContext);
  const tomorrow = { ...adjustmentContext, date: addDays(day, 1) };
  state = recordAndAdjust(state, { ...adjustmentReport(9, 'next'), date: tomorrow.date }, tomorrow);
  conservation(state, tomorrow.date);
  expect(count(state, 'book', 0, addDays(day, 2))).toBe(18);
  expect(latestReceipt(state)?.changes).toEqual([]);
  expect(calendarQuantity(state, day, tomorrow.date).rows[0]).toMatchObject({
    actual: 3,
    planned: 6,
    remainder: 3,
  });
});

it('明示的な再計画で取り込み直した実績を再控除せず、基準以前の訂正も失わない', () => {
  let state = recordAndAdjust(adjustmentFixture(), adjustmentReport(4), adjustmentContext);
  state = approve(
    propose(state, addDays(day, 1), '明示的に全体を見直す', adjustmentContext),
    true,
    adjustmentContext,
  );
  const before = structuredClone(state.plan);
  state = adjustAfterProgress(state, 'record', adjustmentContext);
  expect(planChanges(before, state.plan, addDays(day, 1))).toEqual([]);
  expect(count(state, 'book', 0)).toBe(26);
  state = correctAndAdjust(state, 'record', 2, false, adjustmentContext);
  conservation(state);
  expect(count(state, 'book', 0)).toBe(28);
  const restored = parseBackup(
    JSON.stringify({
      format: 'StudyPlanBackup',
      version: 1,
      createdAt: adjustmentContext.timestamp,
      appVersion: '0.4.19',
      data: state,
    }),
  ).data;
  expect(adjustAfterProgress(restored, 'record', adjustmentContext).plan).toEqual(state.plan);
});

it('記録基準がない旧計画は過剰な配分を推測補正せず、実績を残して見直しへ案内する', () => {
  const source = adjustmentFixture();
  delete source.plan!.progressBaseline;
  source.records = [adjustmentReport(4, 'legacy')];
  const state = recordAndAdjust(source, adjustmentReport(2), adjustmentContext);
  expect(state.records.reduce((n, r) => n + r.count, 0)).toBe(6);
  expect(currentProgressAdjustment(state)?.status).toBe('review');
  expect(state.plan).toEqual(source.plan);
});

it('調整基準の復元に失敗しても、検証済みの追加実績は保存対象に残す', () => {
  const source = adjustmentFixture();
  source.plan!.adjustmentBasis = {
    date: addDays(day, -1),
    records: { broken: 1 },
    sessions: structuredClone(source.plan!.sessions),
  };
  const state = recordAndAdjust(source, adjustmentReport(4), adjustmentContext);
  expect(state.records).toEqual([adjustmentReport(4)]);
  expect(state.plan).toEqual(source.plan);
  expect(currentProgressAdjustment(state)?.status).toBe('failed');
  expect(latestReceipt(state)?.changes).toEqual([]);
});
