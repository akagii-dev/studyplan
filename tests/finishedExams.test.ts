import { expect, it } from 'vitest';
import { removeFinishedExams } from '../src/domain/finishedExams';
import { addDays, type AppState } from '../src/domain/model';
import { calendarQuantity } from '../src/domain/calendarQuantity';
import { calendarDaySummary } from '../src/domain/calendarSummary';
import { samePlanningSettings } from '../src/domain/planAudit';
import { generatePlan } from '../src/domain/planner/generate';
import { recordAndAdjust, reconcilePlanning } from '../src/domain/progressAdjustment';
import { proposalUsesCurrentProgress } from '../src/domain/progressReflection';
import { assertRemainingBalance } from '../src/domain/remainingAllocation';
import { settleRewards, totalPoints } from '../src/domain/rewards';
import { studentFixture } from './fixtures/student';

const from = '2030-10-07';
const lawTarget = addDays(from, 28);
const context = (date: string) => ({ timestamp: `${date}T00:00:00.000Z`, date, minute: 0, idPrefix: 'test' });

/** 行政書士（law）と予備試験（essay）の承認済み計画に、初日の実績を1件ずつ持つ。 */
function studied(): AppState {
  let state = studentFixture(from);
  state.plan = generatePlan({ ...state, plan: null }, from, false, 0, 'balanced', context(from));
  for (const materialId of ['short', 'long'])
    state = recordAndAdjust(state, {
      id: `r-${materialId}`, date: from, materialId, round: 0, count: 2, cancelled: false,
      createdAt: `${from}T09:00:00.000Z`, updatedAt: `${from}T09:00:00.000Z`,
    }, context(from));
  return settleRewards(state, from);
}

it('目標日の当日までは試験を残し、何も変えない', () => {
  const state = studied();
  expect(removeFinishedExams(state, lawTarget)).toBe(state);
});

it('目標日を過ぎた試験は、教材・記録・予定ごと消え、カレンダーの過去日にも出ない', () => {
  const next = removeFinishedExams(studied(), addDays(lawTarget, 1));
  expect(next.settings.exams.map((e) => e.id)).toEqual(['essay']);
  expect(next.settings.materials.map((m) => m.id)).toEqual(['long']);
  expect(next.records.map((r) => r.id)).toEqual(['r-long']);
  expect(next.plan!.sessions.some((s) => s.examId === 'law')).toBe(false);
  expect(calendarQuantity(next, from, addDays(lawTarget, 1)).rows.map((r) => r.materialId)).toEqual(['long']);
  expect(calendarDaySummary(next, from).exams.map((e) => e.examId)).toEqual(['essay']);
});

it('削除後も残る試験の計画は設定・実績・残量と一致し、日付更新の調整結果を変えない', () => {
  const date = addDays(lawTarget, 1);
  const next = removeFinishedExams(studied(), date);
  expect(samePlanningSettings(next.plan!.settingsSnapshot!, next.settings)).toBe(true);
  expect(proposalUsesCurrentProgress(next.plan!, next.records)).toBe(true);
  expect(() => assertRemainingBalance(next, from)).not.toThrow();
  // 削除は、日付更新時の調整の可否（この架空データでは順序の確認待ち）を変えない。
  expect(reconcilePlanning(next, context(date)).draft.planReconciliation)
    .toEqual(reconcilePlanning(studied(), context(date)).draft.planReconciliation);
});

it('消えた試験の記録で得たポイントは、その後の記録でも減らない', () => {
  const before = studied();
  const next = settleRewards(removeFinishedExams(before, addDays(lawTarget, 1)), addDays(lawTarget, 1));
  expect(totalPoints(next)).toBe(totalPoints(before));
});
