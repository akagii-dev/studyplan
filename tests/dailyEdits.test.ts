import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CalendarDaySummary } from '../src/components/CalendarDaySummary';
import { initialState, addDays } from '../src/domain/model';
import { dailyTime } from '../src/domain/dailyTime';
import { dailyTimeDisplay, renameOutsideRange } from '../src/domain/dailyTimeDisplay';
import { calendarDaySummary } from '../src/domain/calendarSummary';
import { initialWizard } from '../src/components/guided-setup/model';
import {
  advanceQuestion,
  beginItemEdit,
  moveTo,
  saveAnswer,
} from '../src/components/guided-setup/transitions';
import { studentFixture } from './fixtures/student';
import { generatePlan } from '../src/domain/planner/generate';
import { parseBackup } from '../src/domain/backup';
import { resetSetup, restoreReset } from '../src/domain/reset';

const date = '2030-10-07';
it('6試験の日合計を省略せず、分割した枠と復習を同じ試験へまとめる', () => {
  const s = studentFixture(date);
  s.plan = generatePlan(s, date, false, 0, 'balanced', {
    date,
    minute: 0,
    timestamp: date + 'T00:00:00Z',
    idPrefix: 'many',
  });
  const template = s.plan.sessions[0];
  s.settings.exams = Array.from({ length: 6 }, (_, i) => ({
    ...s.settings.exams[0],
    id: `e${i}`,
    name: `試験${i}`,
  }));
  s.plan.sessions = s.settings.exams.flatMap((e, i) => [
    {
      ...template,
      id: `${i}-a`,
      examId: e.id,
      materialId: `m${i}`,
      date,
      start: 800 + i * 40,
      end: 810 + i * 40,
      count: 3,
      kind: 'study' as const,
    },
    {
      ...template,
      id: `${i}-b`,
      examId: e.id,
      materialId: `m${i}`,
      date,
      start: 810 + i * 40,
      end: 820 + i * 40,
      count: 7,
      kind: 'study' as const,
    },
    {
      ...template,
      id: `${i}-r`,
      examId: e.id,
      date,
      start: 820 + i * 40,
      end: 830 + i * 40,
      count: 0,
      kind: 'review' as const,
    },
  ]);
  const summary = calendarDaySummary(s, date);
  expect(summary.exams).toHaveLength(6);
  for (const e of summary.exams) {
    expect(e.quantities[0].planned).toBe(10);
    expect(e.minutes).toBe(30);
    expect(e.reviewMinutes).toBe(10);
  }
  const html = renderToStaticMarkup(
    createElement(CalendarDaySummary, {
      state: s,
      date,
      filter: 'all',
      density: 'compact',
      onSelect: () => {},
    }),
  );
  expect(html.match(/data-exam=/g)).toHaveLength(6);
  expect(html.match(/10問<\/strong>/g)).toHaveLength(6);
});
it('日付と区間ごとの名前を保存・解除し、他の日や学習量を変更しない', () => {
  const original = initialState();
  const a = renameOutsideRange(original, date, 0, 60, '家事');
  const b = renameOutsideRange(a, date, 60, 120, '読書');
  const c = renameOutsideRange(b, date, 30, 90, ' 自由時間 ');
  expect(c.outsideLabels?.[date]).toEqual([
    { start: 0, end: 30, title: '家事' },
    { start: 30, end: 90, title: '自由時間' },
    { start: 90, end: 120, title: '読書' },
  ]);
  const day = dailyTime(c.settings, date);
  const view = dailyTimeDisplay(day.segments, c.outsideTime, c.outsideLabels?.[date]);
  expect(view.totals).toEqual({ ...day.totals, sleep: 0, bath: 0 });
  expect(view.segments.slice(0, 3).map((x) => x.title)).toEqual(['家事', '自由時間', '読書']);
  expect(c.outsideLabels?.[addDays(date, 1)]).toBeUndefined();
  expect(c.settings).toEqual(original.settings);
  expect(c.plan).toEqual(original.plan);
  expect(c.records).toEqual(original.records);
  expect(renameOutsideRange(c, date, 30, 90, null).outsideLabels?.[date]).toHaveLength(2);
  expect(original.outsideLabels).toBeUndefined();
});
it('設定変更後は学習・睡眠・風呂へ独自の名前を流用しない', () => {
  let s = renameOutsideRange(initialState(), date, 0, 120, '外出');
  s = { ...s, outsideTime: { sleep: { start: 0, duration: 60 } } };
  const view = dailyTimeDisplay(
    dailyTime(s.settings, date).segments,
    s.outsideTime,
    s.outsideLabels?.[date],
  );
  expect(view.segments[0]).toMatchObject({ kind: 'sleep' });
  expect(view.segments[0].title).toBeUndefined();
  expect(view.segments[1]).toMatchObject({ kind: 'outside', title: '外出', start: 60, end: 120 });
  expect(() => renameOutsideRange(s, date, 0, 120, '名前')).toThrow('設定が変わりました');
  expect(() => renameOutsideRange(s, date, 120, 180, ' ')).toThrow('1〜120文字');
  expect(() => renameOutsideRange(s, date, 120, 180, 'x'.repeat(121))).toThrow('1〜120文字');
});
it('表示名をバックアップと初期化の復元に含める', () => {
  const s = renameOutsideRange(initialState(), date, 0, 120, '<家事>');
  const backup = {
    format: 'StudyPlanBackup',
    version: 1,
    createdAt: date + 'T00:00:00Z',
    appVersion: '0.4.9',
    data: s,
  };
  expect(parseBackup(JSON.stringify(backup)).data.outsideLabels).toEqual(s.outsideLabels);
  expect(restoreReset(resetSetup(s, true)).outsideLabels).toEqual(s.outsideLabels);
  expect(resetSetup(s, true).outsideLabels).toBeUndefined();
});
it.each([
  ['exam.name', 'window.period'],
  ['material.exam', 'buffer'],
  ['window.period', 'class.ask'],
  ['class.ask', 'busy.ask'],
  ['busy.ask', 'exception.ask'],
  ['exception.ask', 'meals'],
  ['meals', 'outside.sleep'],
  ['outside.sleep', 'focus.block'],
  ['focus.block', 'material.exam'],
  ['buffer', 'finish'],
] as const)('選んだ項目 %s の外 %s へ進むと修正を終了する', (from, to) => {
  const w = beginItemEdit(initialWizard(initialState()), from);
  expect(moveTo(w, to).step).toBe('edit.saved');
  expect(w.trail).toEqual([]);
  const restored = JSON.parse(JSON.stringify(w));
  expect(moveTo(restored, to).step).toBe('edit.saved');
});
it('試験だけを保存し、他の設定と計画・実績を変更せず、通常の初期設定も維持する', () => {
  const s = studentFixture(date);
  const w = beginItemEdit(initialWizard(s), 'exam.name', {
    exam: { ...s.settings.exams[0], name: '新しい目標' },
  });
  const next = saveAnswer(s, w, 'guided', 'exam', 'window.period');
  expect(next.draft.guided).toMatchObject({ step: 'edit.saved', editScope: 'exam' });
  expect(next.settings.exams[0].name).not.toBe(s.settings.exams[0].name);
  expect(next.settings.materials).toEqual(s.settings.materials);
  expect(next.settings.windows).toEqual(s.settings.windows);
  expect(next.plan).toEqual(s.plan);
  expect(next.records).toEqual(s.records);
  const focus = { ...beginItemEdit(initialWizard(s), 'focus.block'), step: 'focus.rest' as const };
  expect(advanceQuestion(s, focus, 'guided').draft.guided).toMatchObject({ step: 'edit.saved' });
  expect(moveTo(initialWizard(s), 'window.period').step).toBe('window.period');
});
it('日合計は複数の予定を試験別にまとめ、実績と重複授業を二重計上しない', () => {
  const s = studentFixture(date);
  s.plan = generatePlan(s, date, false, 0, 'balanced', {
    date,
    minute: 0,
    timestamp: date + 'T00:00:00Z',
    idPrefix: 'summary',
  });
  const first = s.plan.sessions.find((x) => x.kind === 'study')!;
  const c = s.settings.windows.find((x) => x.kind === 'class')!;
  s.settings.windows.push({ ...c, id: 'duplicate' });
  const day = first.date;
  s.plan.sessions.push({ ...first, id: 'duplicate-study', start: 1320, end: 1329, count: 3 });
  s.records = [
    {
      id: 'r',
      date: day,
      materialId: first.materialId,
      round: first.round,
      count: 0,
      cancelled: false,
      createdAt: day,
      updatedAt: day,
    },
  ];
  const summary = calendarDaySummary(s, day);
  const exam = summary.exams.find((x) => x.examId === first.examId)!;
  expect(exam.quantities[0].planned).toBe(
    s.plan.sessions
      .filter((x) => x.date === day && x.examId === first.examId)
      .reduce((n, x) => n + x.count, 0),
  );
  expect(exam.quantities[0].actual).toBe(0);
  expect(exam.quantities[0].reported).toBe(true);

  expect(calendarDaySummary(s, day, first.examId).exams).toHaveLength(1);
  expect(summary.classMinutes).toBeLessThan(
    summary.classes.reduce((n, x) => n + x.end - x.start, 0),
  );
  s.records[0].cancelled = true;
  expect(calendarDaySummary(s, day).exams.find((x) => x.examId === first.examId)!.quantities[0].reported).toBe(
    false,
  );
});
