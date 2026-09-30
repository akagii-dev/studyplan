import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProgressReceiptView, receiptOutcome } from '../src/components/ProgressReceiptView';
import {
  adjustAfterProgress,
  correctAndAdjust,
  currentProgressAdjustment,
  reconcilePlanning,
  recordAndAdjust,
} from '../src/domain/progressAdjustment';
import { planChanges, latestReceipt, summarizePlanChanges } from '../src/domain/progressReceipt';
import {
  activePlanWork,
  allocateProgress,
  prepareAdjustment,
  remainingOccupiedSessions,
} from '../src/domain/progressAllocation';
import { calculateRestart } from '../src/domain/planRestart';
import { displayPlanSessions } from '../src/domain/planDisplay';
import { comparePlans } from '../src/domain/planComparison';
import { remainingWork } from '../src/domain/remainingWork';
import { addDays, completed, remaining, reported, type AppState } from '../src/domain/model';
import { calendarQuantity } from '../src/domain/calendarQuantity';
import { capacityForDate, capacityForWeek } from '../src/domain/planner/capacity';
import { startOfWeek } from '../src/domain/calendar';
import { createProgressBaseline, reflectProgress } from '../src/domain/progressReflection';
import { approve, propose, proposeRemainingAdjustment, reproposeRemainingAdjustment, proposeRestart } from '../src/domain/planner/proposal';
import {
  remainingSessionIssue,
  remainingBasisIssue,
  elapsedRemainingTargets,
  isElapsedRemainingSession,
  remainingAdjustmentSourceDate,
  remainingSourceIssue,
  validateRemainingAllocation,
} from '../src/domain/remainingAllocation';
import { parseBackup } from '../src/domain/backup';
import { validateSettings } from '../src/domain/planner/validation';
import {
  adjustmentFixture,
  adjustmentContext,
  adjustmentReport,
  restartFixture,
  remainingPlacementFixture,
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

const partialAllocationFixture = (report?: number) => remainingPlacementFixture(day, report);
const targetB = [{ kind: 'session' as const, sessionId: 'b-target' }];
const beforeStudy = { ...adjustmentContext, minute: 530 };

function multipleElapsedFixture(report?: number) {
  const state = partialAllocationFixture(report);
  state.settings.windows[0].end = 660;
  const first = state.plan!.sessions.find((s) => s.id === 'b-target')!;
  Object.assign(first, { count: 2, end: 576 });
  state.plan!.sessions.push({ ...first, id: 'b-second', count: 3, start: 580, end: 589 });
  state.settings.exams.push({ ...state.settings.exams[0], id: 'c-exam' });
  state.settings.materials.push({
    id: 'c', examId: 'c-exam', name: '教材C', total: 2, order: 1,
    rounds: [{ completed: 0, minutes: 2 }, { completed: 0, minutes: 2 }],
  });
  state.plan!.sessions.push(...[0, 1].map((round) => ({
    ...first, id: `c-${round}`, examId: 'c-exam', materialId: 'c', round,
    count: 2, start: 560 + round * 5, end: 564 + round * 5,
  })));
  state.plan!.settingsSnapshot = structuredClone(state.settings);
  state.plan!.progressBaseline = createProgressBaseline(state.plan!, []);
  return state;
}

it.each([undefined, 0, 1])('複数枠・教材・周回の経過残量を明示追加して当日に再配置する（実績%s）', (report) => {
  const source = multipleElapsedFixture(report);
  const context = { ...adjustmentContext, minute: 590 };
  const snapshot = JSON.stringify(source);
  const elapsed = elapsedRemainingTargets(source, context);
  expect(elapsed.map((s) => [s.id, s.count])).toEqual([
    ['b-target', 2], ['b-second', 3 - (report ?? 0)], ['c-0', 2], ['c-1', 2],
  ]);
  expect(() => proposeRemainingAdjustment(source, targetB, day, context))
    .toThrow('経過済みの未消化分をまとめて調整');
  const targets = elapsed.map((s) => ({ kind: 'session' as const, sessionId: s.id }));
  const candidate = proposeRemainingAdjustment(source, targets, day, context);
  expect(JSON.stringify(source)).toBe(snapshot);
  expect(candidate.plan).toBe(source.plan);
  expect(candidate.records).toEqual(source.records);
  expect(candidate.proposal!.basis).toMatchObject({ summary: [
    { materialId: 'b', round: 0, count: 5 - (report ?? 0), sessionIds: ['b-target', 'b-second'] },
    { materialId: 'c', round: 0, count: 2 },
    { materialId: 'c', round: 1, count: 2 },
  ] });
  let approved = restoreAllocation(approve(candidate, false, context));
  validateRemainingAllocation(approved, context);
  expect(elapsedRemainingTargets(approved, context)).toEqual([]);
  expect(approved.records).toEqual(source.records);
  expect(approved.plan!.sessions.find((s) => s.id === 'b-keep'))
    .toEqual(source.plan!.sessions.find((s) => s.id === 'b-keep'));
  expect(approved.plan!.sessions.find((s) => s.id === 'a-done')).toEqual(source.plan!.sessions[0]);
  expect(activePlanWork(approved, day).some((s) => s.date === day && s.start >= 590)).toBe(true);
  const assert = (date = day) => {
    conservation(approved, date);
    expect(approved.records.find((r) => r.id === 'a-record')).toEqual(source.records[0]);
    expect(activePlanWork(approved, date).some((s) => elapsed.some((old) => s.id === old.id))).toBe(false);
  };
  assert();
  approved = recordAndAdjust(approved, { ...adjustmentReport(1, 'bulk-add'), materialId: 'b' }, context);
  assert();
  approved = correctAndAdjust(approved, 'bulk-add', 2, false, context);
  assert();
  approved = correctAndAdjust(approved, 'bulk-add', 2, true, context);
  assert();
  const tomorrow = { ...context, date: addDays(day, 1), minute: 530 };
  approved = reconcilePlanning(restoreAllocation(approved), tomorrow);
  assert(tomorrow.date);
  expect(elapsedRemainingTargets(approved, tomorrow)).toEqual([]);
  expect(reconcilePlanning(approved, tomorrow)).toBe(approved);
});

it('開始前・開始ちょうど・進行中・終了後を区別し、固定の経過残量は明示解除まで止める', () => {
  const source = partialAllocationFixture();
  const session = source.plan!.sessions.find((s) => s.id === 'b-target')!;
  for (const [minute, elapsed] of [[569, false], [570, false], [571, true], [585, true]] as const) {
    const context = { ...adjustmentContext, minute };
    expect(isElapsedRemainingSession(session, context)).toBe(elapsed);
    expect(elapsedRemainingTargets(source, context).map((s) => s.id)).toEqual(elapsed ? ['b-target'] : []);
    expect(source.plan!.sessions.find((s) => s.id === 'b-target')).toBe(session);
    expect(reported(source, day, 'b', 0)).toBe(false);
  }
  session.fixed = true;
  expect(elapsedRemainingTargets(source, adjustmentContext)).toEqual([]);
  for (const targets of [targetB, [{ kind: 'session' as const, sessionId: 'b-keep' }]]) {
    expect(() => proposeRemainingAdjustment(source, targets, day, adjustmentContext))
      .toThrow(`${day} 09:30–09:45 教材B 1周目の固定予定`);
    expect(() => proposeRemainingAdjustment(source, targets, day, adjustmentContext)).toThrow('固定を解除');
  }
  session.fixed = false;
  session.end = session.start;
  expect(remainingSourceIssue(source, session, adjustmentContext)).toContain('開始・終了時刻が無効');
  // A malformed old slot is still selectable for repair; it never becomes an execution destination.
  expect(elapsedRemainingTargets(source, adjustmentContext).map((s) => s.id)).toEqual(['b-target']);
  for (const issue of ['overlap', 'weekly', 'order'] as const) {
    const invalid = partialAllocationFixture();
    const old = invalid.plan!.sessions.find((s) => s.id === 'b-target')!;
    if (issue === 'overlap') invalid.plan!.sessions.push({ ...old, id: 'overlap', fixed: true });
    if (issue === 'weekly') invalid.settings.buffer = 0.95;
    if (issue === 'order') {
      invalid.records = [];
      invalid.plan!.sessions[0].date = addDays(day, 2);
    }
    expect(remainingSourceIssue(invalid, old, adjustmentContext)).toContain(
      issue === 'overlap' ? '重なって' : issue === 'weekly' ? '週の割当上限' : '順序',
    );
  }
});

it('案の確認中に保持枠が経過したら承認を止め、対象を明示追加して再生成できる', () => {
  const source = multipleElapsedFixture();
  const context = { ...adjustmentContext, minute: 578 };
  const firstTargets = elapsedRemainingTargets(source, context)
    .map((s) => ({ kind: 'session' as const, sessionId: s.id }));
  const candidate = proposeRemainingAdjustment(source, firstTargets, day, context);
  const later = { ...context, minute: 590 };
  expect(() => approve(candidate, false, later)).toThrow('案を作り直してください');
  expect(candidate.plan).toBe(source.plan);
  const extra = elapsedRemainingTargets(source, later)
    .filter((s) => !firstTargets.some((target) => target.sessionId === s.id));
  expect(extra.map((s) => [s.id, s.count])).toEqual([['b-second', 3]]);
  const refreshed = reproposeRemainingAdjustment(candidate,
    extra.map((s) => ({ kind: 'session' as const, sessionId: s.id })), day, later);
  const approved = approve(refreshed, false, later);
  validateRemainingAllocation(approved, later);
  expect(approved.records).toEqual(source.records);
  conservation(approved);
  let pending = refreshed;
  for (const offset of [1, 2]) {
    const next = { ...context, date: addDays(day, offset), minute: 530 };
    const blocked = reconcilePlanning(restoreAllocation(pending), next);
    expect(blocked.plan).toEqual(source.plan);
    expect(() => approve(blocked, false, next)).toThrow('変わりました');
    const basis = blocked.proposal!.basis!;
    expect(basis.kind).toBe('remaining-adjustment');
    if (basis.kind !== 'remaining-adjustment') throw new Error('Unexpected basis');
    const sourceDate = remainingAdjustmentSourceDate(blocked, next.date);
    expect(sourceDate).toBe(day);
    const additional = elapsedRemainingTargets(blocked, next, sourceDate)
      .filter((s) => !basis.targets.some((target) => target.kind === 'session' && target.sessionId === s.id))
      .map((s) => ({ kind: 'session' as const, sessionId: s.id }));
    pending = reproposeRemainingAdjustment(blocked, additional, next.date, next);
    expect(pending.plan).toEqual(source.plan);
    expect(pending.records).toEqual(source.records);
    const result = approve(restoreAllocation(pending), false, next);
    validateRemainingAllocation(result, next);
    conservation(result, next.date);
    expect(activePlanWork(result, next.date).every((s) =>
      s.date > next.date || s.start >= next.minute)).toBe(true);
  }
  const changed = structuredClone(pending);
  changed.records[0].count = 9;
  const retainedTargets = structuredClone(changed.proposal!.basis);
  expect(() => reproposeRemainingAdjustment(changed, [], addDays(day, 2), context)).toThrow('変わりました');
  expect(changed.proposal!.basis).toEqual(retainedTargets);
});

it.each([undefined, 0, 2])(
  '未報告・0・部分(%s)でも有効な対象配置を維持し、変更不要なら同一state',
  (report) => {
    const source = partialAllocationFixture(report);
    const active = activePlanWork(source, day);
    const selected = active.find((s) => s.id === 'b-target')!;
    expect(selected.count).toBe(5 - (report ?? 0));
    expect(remainingSessionIssue(source, selected, beforeStudy, active)).toBeUndefined();
    expect(proposeRemainingAdjustment(source, targetB, day, beforeStudy)).toBe(source);
    expect(source.records.filter((r) => r.materialId === 'b')).toHaveLength(
      report === undefined ? 0 : 1,
    );
  },
);

it.each([undefined, 0, 2])(
  '明示操作で対象5問の未消化分(%s)だけを配置し、AとBの別枠を保護',
  (report) => {
    const source = partialAllocationFixture(report);
    source.plan!.sessions.push({
      ...source.plan!.sessions[0],
      id: 'historical-review',
      kind: 'review',
      materialId: '',
      count: 0,
      start: 630,
      end: 650,
    });
    const candidate = proposeRemainingAdjustment(source, targetB, day, adjustmentContext);
    expect(candidate.plan).toBe(source.plan);
    expect(candidate.records).toEqual(source.records);
    expect(candidate.proposal!.basis).toMatchObject({
      kind: 'remaining-adjustment',
      summary: [{ materialId: 'b', round: 0, count: 5 - (report ?? 0), sessionIds: ['b-target'] }],
    });
    const approved = approve(candidate, false, adjustmentContext);
    expect(approved.records).toEqual(source.records);
    expect(approved.plan!.sessions.find((s) => s.id === 'a-done')).toEqual(
      source.plan!.sessions.find((s) => s.id === 'a-done'),
    );
    expect(approved.plan!.adjustmentBasis!.sessions.some((s) => s.id === 'a-done')).toBe(false);
    expect(approved.plan!.progressBaseline!.sessions['a-done']).toBeUndefined();
    expect(approved.plan!.sessions.find((s) => s.id === 'b-target')).toBeUndefined();
    expect(approved.plan!.sessions.find((s) => s.id === 'b-keep')).toEqual(
      source.plan!.sessions.find((s) => s.id === 'b-keep'),
    );
    expect(
      approved
        .plan!.sessions.filter((s) => s.materialId === 'b' && s.id !== 'b-keep')
        .reduce((sum, s) => sum + s.count, 0),
    ).toBe(5 - (report ?? 0));
    expect(
      activePlanWork(approved, day)
        .filter((s) => s.materialId === 'b')
        .reduce((sum, s) => sum + s.count, 0),
    ).toBe(10 - (report ?? 0));
    expect(
      calendarQuantity(approved, day, day).rows.find((r) => r.materialId === 'b')?.planned,
    ).toBe(5);
    expect(restoreAllocation(approved).plan).toEqual(approved.plan);
  },
);

function restoreAllocation(state: AppState) {
  return parseBackup(
    JSON.stringify({
      format: 'StudyPlanBackup',
      version: 1,
      createdAt: adjustmentContext.timestamp,
      appVersion: '0.6.5',
      data: state,
    }),
  ).data;
}

it('報告済みの当日にも配置でき、開始日の指定だけで選択枠を後ろへ移す', () => {
  const source = partialAllocationFixture(2);
  const today = approve(
    proposeRemainingAdjustment(source, targetB, day, { ...adjustmentContext, minute: 571 }),
    false,
    { ...adjustmentContext, minute: 571 },
  );
  expect(activePlanWork(today, day).some((s) => s.materialId === 'b' && s.date === day)).toBe(true);
  const later = approve(
    proposeRemainingAdjustment(source, targetB, addDays(day, 2), beforeStudy),
    false,
    beforeStudy,
  );
  expect(later.plan!.sessions.find((s) => s.id === 'b-keep')).toEqual(
    source.plan!.sessions.find((s) => s.id === 'b-keep'),
  );
  expect(
    activePlanWork(later, day)
      .filter((s) => s.materialId === 'b' && s.id !== 'b-keep')
      .every((s) => s.date >= addDays(day, 2)),
  ).toBe(true);
});

it.each([3, 0])('部分配置・配置不能でも選択5問を保存し、未配置理由を示す（空き%s問）', (room) => {
  const source = partialAllocationFixture();
  source.settings.exams[0].target = addDays(day, 2);
  source.settings.windows[0].to = addDays(day, 1);
  source.settings.windows.push({
    ...source.settings.windows[0],
    id: 'restrict-tomorrow',
    kind: 'busy',
    from: addDays(day, 1),
    start: 555 + room * 3,
    end: 600,
  });
  source.plan!.settingsSnapshot = structuredClone(source.settings);
  const approved = approve(
    proposeRemainingAdjustment(source, targetB, day, adjustmentContext),
    false,
    adjustmentContext,
  );
  expect(approved.records).toEqual(source.records);
  expect(
    activePlanWork(approved, day)
      .filter((s) => s.materialId === 'b')
      .reduce((sum, s) => sum + s.count, 0),
  ).toBe(5 + room);
  expect(approved.plan!.shortfalls).toMatchObject([
    { materialId: 'b', count: 5 - room, reason: expect.any(String) },
  ]);
  expect(remaining(approved, 'b', 0)).toBe(10);
});

it('部分再配置後の追加・訂正・取消・再読込・同一ID再送で二重消化も移動元の復活も起きない', () => {
  const source = partialAllocationFixture(2);
  let state = approve(
    proposeRemainingAdjustment(source, targetB, day, adjustmentContext),
    false,
    adjustmentContext,
  );
  const assert = () => {
    expect(state.records.find((r) => r.id === 'a-record')).toEqual(source.records[0]);
    expect(state.plan!.sessions.find((s) => s.id === 'b-target')).toBeUndefined();
    const work = activePlanWork(state, day)
      .filter((s) => s.materialId === 'b')
      .reduce((sum, s) => sum + s.count, 0);
    const unplaced = state
      .plan!.shortfalls.filter((s) => s.materialId === 'b')
      .reduce((sum, s) => sum + s.count, 0);
    expect(work + unplaced).toBe(remaining(state, 'b', 0));
  };
  const added = { ...adjustmentReport(2, 'b-add'), materialId: 'b' };
  state = recordAndAdjust(state, added, adjustmentContext);
  assert();
  expect(recordAndAdjust(state, added, adjustmentContext)).toBe(state);
  state = restoreAllocation(state);
  assert();
  state = correctAndAdjust(state, 'b-record', 0, false, adjustmentContext);
  assert();
  state = correctAndAdjust(state, 'b-add', 2, true, adjustmentContext);
  assert();
  const correctedA = correctAndAdjust(state, 'a-record', 9, false, adjustmentContext);
  conservation(correctedA);
  expect(correctedA.plan!.sessions.find((s) => s.id === 'a-done')).toEqual(
    source.plan!.sessions[0],
  );
  expect(activePlanWork(correctedA, day).some((s) => s.id === 'a-done')).toBe(false);
  const cancelledA = correctAndAdjust(correctedA, 'a-record', 9, true, adjustmentContext);
  conservation(cancelledA);
  expect(activePlanWork(cancelledA, day).some((s) => s.id === 'a-done')).toBe(false);
});

it('部分再配置案の古い前提・無効な候補枠・固定・基準不明・数量不整合を承認しない', () => {
  const source = partialAllocationFixture();
  const candidate = proposeRemainingAdjustment(source, targetB, day, adjustmentContext);
  const changed = structuredClone(candidate);
  changed.plan!.sessions[2].start += 1;
  expect(() => approve(changed, false, adjustmentContext)).toThrow('変わりました');
  const invalid = structuredClone(candidate);
  invalid.proposal!.plan.sessions.find((s) => s.materialId === 'b' && s.id !== 'b-keep')!.start = 0;
  expect(() => approve(invalid, false, adjustmentContext)).toThrow();
  expect(() => approve(candidate, false, { ...adjustmentContext, date: addDays(day, 1) })).toThrow(
    '変わりました',
  );
  const fixed = structuredClone(source);
  fixed.plan!.sessions[1].fixed = true;
  expect(() => proposeRemainingAdjustment(fixed, targetB, day, adjustmentContext)).toThrow('固定');
  const unknown = structuredClone(source);
  delete unknown.plan!.progressBaseline;
  expect(() => proposeRemainingAdjustment(unknown, targetB, day, adjustmentContext)).toThrow(
    '反映基準',
  );
  const mismatch = structuredClone(source);
  mismatch.plan!.sessions[2].count = 6;
  expect(() => proposeRemainingAdjustment(mismatch, targetB, day, adjustmentContext)).toThrow(
    '一致',
  );
  for (const field of ['adjustmentBasis', 'progressBaseline'] as const) {
    for (const [key, count] of [
      ['not-json', 1],
      [`[ "${day}","b",0 ]`, 1],
      ['["2030-02-30","b",0]', 1],
      [JSON.stringify([day, 'b', -1]), 1],
      [JSON.stringify([day, 'b', 0]), -1],
      [JSON.stringify([day, 'b', 0]), 0.5],
    ] as [string, number][]) {
      const broken = structuredClone(source);
      if (field === 'adjustmentBasis')
        broken.plan!.adjustmentBasis = { date: day, records: {}, sessions: [] };
      broken.plan![field]!.records[key] = count;
      expect(remainingBasisIssue(broken)).toContain('反映基準が壊れて');
      expect(() => proposeRemainingAdjustment(broken, targetB, day, adjustmentContext)).toThrow(
        '反映基準が壊れて',
      );
    }
  }
  expect(remainingBasisIssue(source)).toBeUndefined();
});

it('開始前に完了した比較枠は空き枠や週上限を塞がず、実績・比較量と開始済み枠の占有を保護する', () => {
  const source = partialAllocationFixture();
  source.settings.exams.push({ ...source.settings.exams[0], id: 'a-exam' });
  source.settings.materials[0].examId = 'a-exam';
  Object.assign(source.plan!.sessions[0], { examId: 'a-exam', start: 600, end: 620 });
  const window = source.settings.windows[0];
  source.settings.windows = [
    { ...window, to: day, end: 620 },
    { ...window, id: 'tomorrow-only', from: addDays(day, 1), to: addDays(day, 1), end: 555 },
  ];
  source.settings.exams.forEach((exam) => {
    exam.target = addDays(day, 2);
  });
  source.settings.buffer = 0.6;
  source.plan!.settingsSnapshot = structuredClone(source.settings);
  source.plan!.progressBaseline = createProgressBaseline(source.plan!, []);
  const context = { ...adjustmentContext, minute: 590 };
  let state = approve(proposeRemainingAdjustment(source, targetB, day, context), false, context);
  const check = () => {
    expect(state.records.find((r) => r.id === 'a-record')).toEqual(source.records[0]);
    expect(state.plan!.sessions.find((s) => s.id === 'a-done')).toEqual(source.plan!.sessions[0]);
    expect(state.plan!.adjustmentBasis!.sessions.some((s) => s.id === 'a-done')).toBe(false);
    expect(state.plan!.shortfalls).toEqual([]);
    expect(activePlanWork(state, day).some((s) => s.id === 'a-done')).toBe(false);
    const b = activePlanWork(state, day).filter((s) => s.materialId === 'b');
    expect(b.reduce((sum, s) => sum + s.count, 0)).toBe(remaining(state, 'b', 0));
    expect(
      b.every(
        (s) => remainingSessionIssue(state, s, context, activePlanWork(state, day)) === undefined,
      ),
    ).toBe(true);
    expect(currentProgressAdjustment(state)?.status).not.toBe('failed');
  };
  check();
  expect(displayPlanSessions(state, day).some((s) => s.id === 'a-done')).toBe(false);
  expect(calendarQuantity(state, day, day).rows.find((row) => row.materialId === 'a'))
    .toMatchObject({ planned: 10, actual: 10 });
  // Whole-plan operations must keep a released comparison out of capacity too.
  for (const fixed of [false, true]) {
    const withComparison = structuredClone(state);
    withComparison.plan!.sessions.find((s) => s.id === 'a-done')!.fixed = fixed;
    const withoutComparison = structuredClone(withComparison);
    withoutComparison.plan!.sessions = withoutComparison.plan!.sessions.filter((s) => s.id !== 'a-done');
    for (const boundary of [context, { ...context, date: addDays(day, 1), minute: 530 }]) {
      for (const make of [
        (value: AppState) => proposeRestart(value, boundary.date, boundary),
        (value: AppState) => propose(value, boundary.date, '配置の見直し', boundary),
      ]) {
        const candidate = make(withComparison);
        const expected = make(withoutComparison).proposal!.plan;
        expect(candidate.proposal!.plan.shortfalls).toEqual(expected.shortfalls);
        expect(candidate.proposal!.plan.conflicts).toEqual(expected.conflicts);
        expect(comparePlans(withComparison.plan, candidate.proposal!.plan, boundary.date)
          .some((change) => change.materialId === 'a')).toBe(false);
        const approved = approve(candidate, true, boundary);
        expect(approved.records).toEqual(state.records);
        expect(activePlanWork(approved, boundary.date).some((s) => s.id === 'a-done')).toBe(false);
      }
    }
  }
  expect(
    activePlanWork(state, day).find((s) => s.materialId === 'b' && s.date === day),
  ).toMatchObject({ start: 600, end: 615, count: 5 });
  state = recordAndAdjust(state, { ...adjustmentReport(2, 'b-added'), materialId: 'b' }, context);
  check();
  state = correctAndAdjust(state, 'b-added', 1, false, context);
  check();
  state = correctAndAdjust(state, 'b-added', 1, true, context);
  check();
  expect(state.plan!.comparisonSessionIds).toEqual(['a-done']);
  for (const minute of [601, 630]) {
    const later = { ...context, minute };
    state = restoreAllocation(state);
    const future = activePlanWork(state, day).find((s) => s.id === 'b-keep')!;
    expect(remainingSessionIssue(state, future, later)).toBeUndefined();
    expect(remainingOccupiedSessions(state, later).some((s) => s.id === 'a-done')).toBe(false);
    state = recordAndAdjust(state, { ...adjustmentReport(1, `later-${minute}`), materialId: 'b' }, later);
    expect(currentProgressAdjustment(state)?.status).not.toBe('failed');
    state = correctAndAdjust(state, `later-${minute}`, 1, true, later);
    expect(currentProgressAdjustment(state)?.status).not.toBe('failed');
    expect(state.records.find((r) => r.id === 'a-record')).toEqual(source.records[0]);
  }
  const tomorrow = { ...context, date: addDays(day, 1), minute: 530 };
  state = reconcilePlanning(restoreAllocation(state), tomorrow);
  expect(state.plan!.comparisonSessionIds).toEqual(['a-done']);
  expect(remainingOccupiedSessions(state, tomorrow).some((s) => s.id === 'a-done')).toBe(false);
  expect(activePlanWork(state, tomorrow.date).filter((s) => s.materialId === 'b').reduce((n, s) => n + s.count, 0) +
    state.plan!.shortfalls.filter((s) => s.materialId === 'b').reduce((n, s) => n + s.count, 0)).toBe(remaining(state, 'b', 0));
  const kept = activePlanWork(source, day).find((s) => s.id === 'b-keep')!;
  expect(
    remainingSessionIssue(source, kept, { ...context, minute: 610 }, activePlanWork(source, day)),
  ).toContain('週の割当上限');
});

it('選択5問を3問と2問の実行可能枠へ分け、未選択の未配置2問は埋めない', () => {
  const source = partialAllocationFixture();
  source.settings.materials[1].total = 12;
  source.settings.exams[0].target = addDays(day, 3);
  source.settings.windows = [
    { ...source.settings.windows[0], to: day },
    {
      ...source.settings.windows[0],
      id: 'next',
      from: addDays(day, 1),
      to: addDays(day, 1),
      end: 564,
    },
    {
      ...source.settings.windows[0],
      id: 'last',
      from: addDays(day, 2),
      to: addDays(day, 2),
      end: 546,
    },
  ];
  source.plan!.shortfalls = [
    { materialId: 'b', round: 0, count: 2, minutes: 6, reason: '既存の未配置' },
  ];
  source.plan!.settingsSnapshot = structuredClone(source.settings);
  const result = approve(
    proposeRemainingAdjustment(source, targetB, day, adjustmentContext),
    false,
    adjustmentContext,
  );
  expect(
    result
      .plan!.sessions.filter((s) => s.materialId === 'b' && s.id !== 'b-keep')
      .map((s) => [s.date, s.count]),
  ).toEqual([
    [addDays(day, 1), 3],
    [addDays(day, 2), 2],
  ]);
  expect(result.plan!.shortfalls).toEqual(source.plan!.shortfalls);
  expect(remaining(result, 'b', 0)).toBe(12);
  const again = proposeRemainingAdjustment(
    result,
    [{ kind: 'shortfall', materialId: 'b', round: 0 }],
    day,
    adjustmentContext,
  );
  expect(again).toBe(result);
});

it.each([false, true])(
  '順序依存だけを影響範囲へ含め、後続の固定=%sでは黙って動かさない',
  (fixed) => {
    const source = partialAllocationFixture();
    source.settings.materials.push({
      id: 'c',
      examId: 'a',
      name: '後続C',
      total: 2,
      order: 3,
      rounds: [{ completed: 0, minutes: 3 }],
    });
    source.plan!.sessions.push({
      ...source.plan!.sessions[2],
      id: 'c-follow',
      materialId: 'c',
      count: 2,
      start: 555,
      end: 561,
      fixed,
    });
    source.plan!.settingsSnapshot = structuredClone(source.settings);
    source.plan!.progressBaseline = createProgressBaseline(source.plan!, []);
    if (fixed) {
      expect(() =>
        proposeRemainingAdjustment(source, targetB, addDays(day, 2), adjustmentContext),
      ).toThrow('固定・順序');
    } else {
      const candidate = proposeRemainingAdjustment(
        source,
        targetB,
        addDays(day, 2),
        adjustmentContext,
      );
      expect(candidate.proposal!.basis).toMatchObject({ affectedSessionIds: ['c-follow'] });
      const result = approve(candidate, false, adjustmentContext);
      expect(result.plan!.sessions.find((s) => s.id === 'b-keep')).toEqual(
        source.plan!.sessions[2],
      );
      expect(result.plan!.sessions.some((s) => s.id === 'c-follow')).toBe(false);
      const b = result.plan!.sessions.filter((s) => s.materialId === 'b');
      for (const c of result.plan!.sessions.filter((s) => s.materialId === 'c'))
        expect(b.every((s) => s.date < c.date || (s.date === c.date && s.end <= c.start))).toBe(
          true,
        );
    }
  },
);
