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
import {
  activePlanWork,
  allocateProgress,
  prepareAdjustment,
} from '../src/domain/progressAllocation';
import { calculateRestart } from '../src/domain/planRestart';
import { remainingWork } from '../src/domain/remainingWork';
import { addDays, completed, remaining, reported, type AppState } from '../src/domain/model';
import { calendarQuantity } from '../src/domain/calendarQuantity';
import { capacityForDate, capacityForWeek } from '../src/domain/planner/capacity';
import { startOfWeek } from '../src/domain/calendar';
import { createProgressBaseline, reflectProgress } from '../src/domain/progressReflection';
import { approve, propose } from '../src/domain/planner/proposal';
import { parseBackup } from '../src/domain/backup';
import { validateSettings } from '../src/domain/planner/validation';
import {
  adjustmentFixture,
  adjustmentContext,
  adjustmentReport,
  restartFixture,
} from './fixtures/adjustment';

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

it.each([1, 3])('実績なしで%d日経過しても未消化を再配置し、未報告・履歴を保持する', (elapsed) => {
  const source = tightFixture();
  const context = { ...adjustmentContext, date: addDays(day, elapsed) };
  const adjusted = {
    ...source,
    plan: allocateProgress(prepareAdjustment(source, context), context).plan,
  };
  conservation(adjusted, context.date);
  expect(adjusted.records).toEqual([]);
  expect(reported(adjusted, day, 'book', 0)).toBe(false);
  expect(adjusted.plan.sessions.filter((s) => s.date < context.date)).toEqual(
    source.plan!.sessions.filter((s) => s.date < context.date),
  );
  expect(remainingWork(adjusted, context.date)).toMatchObject([
    {
      total: 30,
      completed: 0,
      remaining: 30,
      allocated: 30 - elapsed * 6,
      unplaced: elapsed * 6,
      balanced: true,
    },
  ]);
  const repeated = allocateProgress(prepareAdjustment(adjusted, context), context).plan;
  expect(planChanges(adjusted.plan, repeated, context.date)).toEqual([]);
  expect(repeated.shortfalls).toEqual(adjusted.plan.shortfalls);
});

it('仕切り直しは30=初期2+実績2+有効26+未配置0とし、旧未配置6を再加算しない', () => {
  const source = restartFixture();
  expect(remainingWork(source, day)).toMatchObject([
    {
      total: 30,
      completed: 4,
      remaining: 26,
      allocated: 20,
      unplaced: 6,
      balanced: true,
    },
  ]);
  const snapshot = structuredClone(source);
  const from = addDays(day, 3);
  const plan = calculateRestart(source, from, adjustmentContext);
  const restarted = { ...source, plan };
  expect(plan.conflicts).toEqual([]);
  expect(plan.allocationStart).toBe(from);
  expect(plan.sessions.every((s) => s.date >= from)).toBe(true);
  expect(remainingWork(restarted, day)).toMatchObject([
    {
      total: 30,
      completed: 4,
      remaining: 26,
      allocated: 26,
      unplaced: 0,
      balanced: true,
    },
  ]);
  expect(source).toEqual(snapshot);
  expect(calculateRestart(source, from, adjustmentContext)).toEqual(plan);
  conservation(restarted);
  const recorded = recordAndAdjust(restarted, adjustmentReport(3), adjustmentContext);
  expect(recorded.plan!.sessions.every((s) => s.date >= from)).toBe(true);
  expect(remainingWork(recorded, day)).toMatchObject([
    {
      total: 30,
      completed: 7,
      remaining: 23,
      allocated: 23,
      unplaced: 0,
      balanced: true,
    },
  ]);
  const cancelled = correctAndAdjust(recorded, 'record', 3, true, adjustmentContext);
  conservation(cancelled);
  expect(cancelled.plan!.sessions.every((s) => s.date >= from)).toBe(true);
  expect(remainingWork(cancelled, day)).toMatchObject([
    { completed: 4, allocated: 26, unplaced: 0 },
  ]);
});

it.each([
  { capacity: 24, allocated: 24, unplaced: 2 },
  { capacity: 18, allocated: 18, unplaced: 8 },
  { capacity: 0, allocated: 0, unplaced: 26 },
])(
  '仕切り直しの容量$capacity問ではA=$allocated U=$unplacedを隠さず保存する',
  ({ capacity, allocated, unplaced }) => {
    const source = restartFixture();
    const from = addDays(day, 3);
    source.settings.exams[0].target = addDays(from, 1);
    source.settings.buffer = 0;
    source.settings.block = 1440;
    source.settings.windows[0] = {
      ...source.settings.windows[0],
      from,
      to: from,
      start: 540,
      end: 540 + Math.max(1, capacity * 3),
    };
    source.plan!.settingsSnapshot = structuredClone(source.settings);
    const plan = calculateRestart(source, from, adjustmentContext);
    expect(plan.conflicts).toEqual([]);
    const restarted = { ...source, plan };
    expect(remainingWork(restarted, day)).toMatchObject([
      {
        total: 30,
        completed: 4,
        allocated,
        unplaced,
        remaining: 26,
        balanced: true,
      },
    ]);
    conservation(restarted);
    if (unplaced) expect(plan.shortfalls[0].reason.length).toBeGreaterThan(0);
  },
);

it('仕切り直し開始前の固定はそのまま保持して競合にし、開始後の固定は維持する', () => {
  const source = restartFixture();
  source.plan!.sessions[0].fixed = true;
  const rejected = calculateRestart(source, addDays(day, 3), adjustmentContext);
  expect(rejected.conflicts.some((m) => m.includes('固定予定が再配分の開始前'))).toBe(true);
  expect(rejected.sessions.find((s) => s.id === 'old-1')).toEqual(source.plan!.sessions[0]);
  const accepted = calculateRestart(source, addDays(day, 1), adjustmentContext);
  expect(accepted.conflicts).toEqual([]);
  expect(accepted.sessions.find((s) => s.id === 'old-1')).toEqual(source.plan!.sessions[0]);
  conservation({ ...source, plan: accepted });
});

it('部分記録後に本日から仕切り直しても、再配置量から新しい実績だけを差し引く', () => {
  const context = { ...adjustmentContext, minute: 0 };
  const source = recordAndAdjust(restartFixture(), adjustmentReport(4), context);
  source.studyDayBaselines = {
    [day]: {
      planId: source.plan!.id,
      rows: [
        { materialId: 'book', round: 0, examId: 'a', name: '対象問題集', unit: '問', count: 6 },
      ],
    },
  };
  const plan = calculateRestart(source, day, context);
  const current = { ...source, plan };
  const todayCount = plan.sessions
    .filter((s) => s.date === day)
    .reduce((sum, s) => sum + s.count, 0);
  expect(todayCount).toBeGreaterThan(0);
  conservation(current);
  expect(remainingWork(current, day)).toMatchObject([
    { completed: 8, allocated: 22, balanced: true },
  ]);
  const added = recordAndAdjust(current, adjustmentReport(1, 'one-more'), context);
  conservation(added);
  expect(
    activePlanWork(added, day)
      .filter((s) => s.date === day)
      .reduce((sum, s) => sum + s.count, 0),
  ).toBe(todayCount - 1);
  expect(calendarQuantity(added, day, day).rows[0].planned).toBe(6);
});

it.each(['2030-10-06', '2030-02-30', '', 'not-a-date'])(
  '仕切り直しの不正開始日 %s を拒否する',
  (from) => {
    expect(() => calculateRestart(restartFixture(), from, adjustmentContext)).toThrow('開始日');
  },
);

it('当日開始済み固定は未消化がある場合だけ競合とし、完了した枠を再計上しない', () => {
  const initial = tightFixture();
  initial.plan!.sessions[0].fixed = true;
  initial.plan!.progressBaseline = createProgressBaseline(initial.plan!, []);
  const partial = recordAndAdjust(initial, adjustmentReport(4), adjustmentContext);
  const rejected = calculateRestart(partial, day, adjustmentContext);
  expect(rejected.conflicts.some((reason) => reason.includes('固定予定が再配分の開始前'))).toBe(
    true,
  );
  const done = recordAndAdjust(initial, adjustmentReport(6), adjustmentContext);
  const plan = calculateRestart(done, day, adjustmentContext);
  expect(plan.conflicts).toEqual([]);
  expect(plan.sessions.find((s) => s.id === initial.plan!.sessions[0].id)).toEqual(
    initial.plan!.sessions[0],
  );
  expect(remainingWork({ ...done, plan }, day)).toMatchObject([
    {
      total: 30,
      completed: 6,
      allocated: 24,
      unplaced: 0,
      balanced: true,
    },
  ]);
});

it('仕切り直しでも教材・周回順序、週の余裕率と休憩枠を守る', () => {
  const source = adjustmentFixture();
  source.settings.exams = [source.settings.exams[0]];
  source.settings.materials[1].examId = 'a';
  source.settings.materials[1].order = 2;
  source.plan!.settingsSnapshot = structuredClone(source.settings);
  source.plan!.sessions.forEach((s) => {
    s.examId = 'a';
  });
  const plan = calculateRestart(source, addDays(day, 1), adjustmentContext);
  const restarted = { ...source, plan };
  conservation(restarted);
  expect(plan.conflicts).toEqual([]);
  expect(remainingWork(restarted, day)).toMatchObject([
    { materialId: 'book', round: 0, completed: 0, allocated: 30, unplaced: 0 },
    { materialId: 'book', round: 1, completed: 0, allocated: 30, unplaced: 0 },
    { materialId: 'other', round: 0, completed: 0, allocated: 45, unplaced: 0 },
  ]);
  const first = plan.sessions.filter((s) => s.materialId === 'book' && s.round === 0);
  const second = plan.sessions.filter((s) => s.materialId === 'book' && s.round === 1);
  const last = plan.sessions.filter((s) => s.materialId === 'other');
  for (const [before, after] of [
    [first, second],
    [second, last],
  ])
    for (const a of before)
      for (const b of after)
        expect(a.date < b.date || (a.date === b.date && a.end <= b.start)).toBe(true);
  expect(source.settings.buffer).toBe(0.2);
});

it('仕切り直しで復習期間を再確保し、学習を復習日へ混入させない', () => {
  const source = restartFixture();
  source.settings.exams[0].reviewDays = 2;
  source.plan!.settingsSnapshot = structuredClone(source.settings);
  const plan = calculateRestart(source, addDays(day, 1), adjustmentContext);
  const study = plan.sessions.filter((s) => s.kind === 'study');
  const reviews = plan.sessions.filter((s) => s.kind === 'review');
  expect(plan.conflicts).toEqual([]);
  expect(reviews).toHaveLength(4);
  expect(reviews.every((s) => s.date >= addDays(day, 8) && s.date < addDays(day, 10))).toBe(true);
  expect(study.every((s) => s.date < addDays(day, 8))).toBe(true);
  conservation({ ...source, plan });
});

it('旧形式で前倒し消化済みの0問予定を、日付越えだけで有効予定へ戻さない', () => {
  const initial = adjustmentFixture();
  initial.records = [adjustmentReport(12)];
  const legacy = reflectProgress(initial);
  expect(legacy.plan!.sessions.find((s) => s.id === 'book-1')!.count).toBe(0);
  const context = { ...adjustmentContext, date: addDays(day, 1) };
  const plan = allocateProgress(prepareAdjustment(legacy, context), context).plan;
  const adjusted = { ...legacy, plan };
  conservation(adjusted, context.date);
  expect(
    activePlanWork(adjusted, context.date).filter(
      (s) => s.materialId === 'book' && s.round === 0 && s.date === context.date,
    ),
  ).toEqual([]);
  expect(
    plan.sessions.filter((s) => s.materialId === 'book' && s.round === 0 && s.date > context.date),
  ).toEqual(
    legacy.plan!.sessions.filter(
      (s) => s.materialId === 'book' && s.round === 0 && s.date > context.date,
    ),
  );
});

it('基準不明の旧形式は量が一致していても推測せず、明示仕切り直しで復旧する', () => {
  const source = restartFixture();
  delete source.plan!.progressBaseline;
  const recorded = recordAndAdjust(source, adjustmentReport(1), adjustmentContext);
  expect(currentProgressAdjustment(recorded)?.status).toBe('review');
  expect(recorded.plan).toEqual(source.plan);
  expect(recorded.records).toHaveLength(2);
  const plan = calculateRestart(recorded, addDays(day, 1), adjustmentContext);
  expect(plan.conflicts).toEqual([]);
  expect(remainingWork({ ...recorded, plan }, day)).toMatchObject([
    { total: 30, completed: 5, remaining: 25, allocated: 25, unplaced: 0, balanced: true },
  ]);
  expect(plan.progressBaseline).toBeDefined();
  conservation({ ...recorded, draft: {}, plan });
});
