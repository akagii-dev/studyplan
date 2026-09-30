import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { addDays } from '../src/domain/model';
import { approve, proposeRestart, undoPlan } from '../src/domain/planner/proposal';
import { calendarQuantity, calendarDisplayQuantity } from '../src/domain/calendarQuantity';
import { createWeeklyReport } from '../src/domain/weeklyReport';
import { remainingWork } from '../src/domain/remainingWork';
import { progressView } from '../src/domain/progressView';
import { recordAndAdjust, reconcilePlanning } from '../src/domain/progressAdjustment';
import { Future } from '../src/app/Future';
import { Calendar } from '../src/components/Calendar';
import { adjustmentContext, adjustmentFixture, adjustmentReport, legacyRestartFixture } from './fixtures/adjustment';

it('旧形式から仕切り直すと過去予定は通常表示から外れ、実績・比較履歴・数量は保持する', () => {
  const context = adjustmentContext;
  const source = legacyRestartFixture();
  const state = approve(proposeRestart(source, addDays(context.date, 1), context), false, context);
  const before = structuredClone(state);
  const unreported = addDays(context.date, -2);
  const recorded = addDays(context.date, -1);
  expect(calendarDisplayQuantity(state, unreported, context.date).rows).toEqual([]);
  expect(calendarDisplayQuantity(state, recorded, context.date).rows).toMatchObject([
    { materialId: 'book', planned: null, remainder: null, actual: 4, reported: true },
    { materialId: 'other', planned: null, remainder: null, actual: 0, reported: true },
  ]);
  expect(calendarQuantity(state, unreported, context.date).rows.map((r) => r.planned)).toEqual([6, 9]);
  expect(calendarQuantity(state, recorded, context.date).rows.map((r) => r.planned)).toEqual([6, 9]);
  expect(createWeeklyReport(state, recorded, new Date(context.timestamp)).unreported.some((r) => r.date === unreported)).toBe(true);
  expect(state.records).toEqual(source.records);
  expect(state.history.at(-1)).toEqual(source.plan);
  expect(state.plan!.sessions.filter((s) => s.date < context.date)).toEqual(source.plan!.sessions.filter((s) => s.date < context.date).sort((a,b) => a.date.localeCompare(b.date) || a.start-b.start));
  expect(remainingWork(state, context.date)).toMatchObject([
    { total: 30, completed: 4, allocated: 26, unplaced: 0, balanced: true },
    { total: 30, completed: 0, allocated: 30, unplaced: 0, balanced: true },
    { total: 45, completed: 0, allocated: 45, unplaced: 0, balanced: true },
  ]);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(context.timestamp));
  try {
    const future = renderToStaticMarkup(createElement(Future, { state, update: async()=>{}, initialWeek: addDays(unreported,-6), onCalendar:()=>{}, onProposal:()=>{} }));
    expect(future).not.toContain('class="future-day"');
    for (const initialMode of ['content','quantity'] as const) {
      const html = renderToStaticMarkup(createElement(Calendar, {
        state, update: async()=>{}, onRecord:()=>{}, onReplan:()=>{},
        initialDate: unreported, initialMode, revealDay: true,
      }));
      expect(html).not.toContain('未報告 / 6問');
      expect(html).not.toContain('未報告 / 9問');
      expect(html).not.toContain('まとめの復習');
    }
  } finally { vi.useRealTimers(); }
  expect(state).toEqual(before);
});

it('未承認・破棄・旧形式・計画を戻した状態では過去の予定を勝手に除外しない', () => {
  const source = legacyRestartFixture();
  const context = adjustmentContext;
  const date = addDays(context.date,-2);
  const proposal = proposeRestart(source, addDays(context.date,1), context);
  for (const state of [source, proposal, {...proposal,proposal:null}, undoPlan(approve(proposal,false,context))])
    expect(calendarDisplayQuantity(state,date,context.date)).toEqual(calendarQuantity(state,date,context.date));
});

it('当日開始の仕切り直しで旧未報告項目は翌日に復活しない', () => {
  const context=adjustmentContext;
  const approved=approve(proposeRestart(adjustmentFixture(),context.date,context),false,context);
  expect(calendarDisplayQuantity(approved,context.date,context.date).rows).toEqual([]);
  const next={...context,date:addDays(context.date,1),timestamp:`${addDays(context.date,1)}T03:00:00Z`};
  const state=reconcilePlanning(approved,next);
  expect(calendarDisplayQuantity(state,context.date,next.date).rows).toEqual([]);
  expect(calendarQuantity(state,context.date,next.date).rows.map((r)=>r.planned)).toEqual([6,9]);
  expect(remainingWork(state,next.date).every((r)=>r.balanced)).toBe(true);
});

it('開始日へ新配置した6問は翌日も残し、仕切り直し前実績4を比率や不足へ流用しない', () => {
  const context={...adjustmentContext,minute:0};
  const source=recordAndAdjust(adjustmentFixture(),adjustmentReport(4),context);
  const approved=approve(proposeRestart(source,context.date,context),false,context);
  const next={...context,date:addDays(context.date,1),timestamp:`${addDays(context.date,1)}T00:00:00Z`};
  const state=reconcilePlanning(approved,next);
  const row=calendarDisplayQuantity(state,context.date,next.date).rows.find((r)=>r.materialId==='book' && r.round===0)!;
  expect(row).toMatchObject({planned:null,actual:4,remainder:null,restartPlanned:6});
  expect(progressView(row,context.date,next.date)).toMatchObject({text:'予定 6問 · 実績 4問',progressRatio:null,deficit:null,prefill:0});
  expect(calendarQuantity(state,context.date,next.date).rows.find((r)=>r.materialId==='book')?.planned).toBe(6);
  expect(state.records).toEqual(source.records);
  expect(remainingWork(state,next.date).every((r)=>r.balanced)).toBe(true);
});

it('開始時刻より前の完了fixedは保存し、翌日の通常表示へ復活させない', () => {
  const context=adjustmentContext;
  const source=adjustmentFixture();
  source.plan!.sessions[0].fixed=true;
  const recorded=recordAndAdjust(source,adjustmentReport(6),context);
  const approved=approve(proposeRestart(recorded,context.date,context),false,context);
  const next={...context,date:addDays(context.date,1),timestamp:`${addDays(context.date,1)}T03:00:00Z`};
  const state=reconcilePlanning(approved,next);
  expect(state.plan!.sessions.some((s)=>s.id==='book-0' && s.fixed)).toBe(true);
  const row=calendarDisplayQuantity(state,context.date,next.date).rows.find((r)=>r.materialId==='book')!;
  expect(row).toMatchObject({actual:6,planned:null,remainder:null});
  expect(row.restartPlanned).toBeUndefined();
  expect(remainingWork(state,next.date).every((r)=>r.balanced)).toBe(true);
});

it('開始日の新予定でも試験の絞り込みを維持する', () => {
  const context={...adjustmentContext,minute:0};
  const state=approve(proposeRestart(adjustmentFixture(),context.date,context),false,context);
  const reference=addDays(context.date,1);
  const all=calendarDisplayQuantity(state,context.date,reference).rows;
  expect(all.some((r)=>r.examId==='a')).toBe(true);
  expect(all.some((r)=>r.examId==='b')).toBe(true);
  for (const exam of ['a','b'])
    expect(calendarDisplayQuantity(state,context.date,reference,exam).rows).toEqual(all.filter((r)=>r.examId===exam));
});
