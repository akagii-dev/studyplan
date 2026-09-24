import { describe, expect, it } from 'vitest';
import { calendarQuantity, retainStudyDayBaselines } from '../src/domain/calendarQuantity';
import { progressState } from '../src/domain/progressView';
import { correctProgress } from '../src/domain/progress';
import { validateSettings } from '../src/domain/planner/validation';
import { todayStudyRows } from '../src/domain/todayProgress';
import { createWeeklyReport, dailyReportDetails } from '../src/domain/weeklyReport';
import {
  contractCases,
  contractDay,
  contractPast,
  contractFuture,
  progressContractFixture,
} from './fixtures/progressContract';

const now = new Date(`${contractDay}T12:00:00+09:00`);
const read = (state = progressContractFixture(), date = contractPast, id = 'partial') =>
  progressState(
    calendarQuantity(state, date, contractDay).rows.find((r) => r.materialId === id)!,
    date,
    contractDay,
  );

describe('進捗のプロダクト契約（表示文言に依存しない）', () => {
  it('共有fixtureは通常利用と同じ設定検証を満たす', () => {
    expect(validateSettings(progressContractFixture().settings)).toEqual([]);
  });
  it.each(contractCases)('$id: 実績の有無と過去の不足を区別する', (c) => {
    expect(read(undefined, contractPast, c.id)).toMatchObject({
      planned: 10,
      actual: c.actual ?? 0,
      hasReport: c.actual !== null,
      deficit: c.deficit,
      progressRatio: (c.actual ?? 0) / 10,
      comparisonAvailable: true,
      period: 'past',
      reportStatus: c.actual === null ? 'unreported' : 'reported',
    });
  });
  it.each(contractCases)('$id: 今日と未来は過去の不足として扱わない', (c) => {
    const state = progressContractFixture();
    expect(read(state, contractDay, c.id)).toMatchObject({
      period: 'today',
      deficit: null,
      warning: false,
    });
    expect(read(state, contractFuture, c.id)).toMatchObject({
      period: 'future',
      deficit: null,
      warning: false,
      reportStatus: 'scheduled',
    });
    expect(
      todayStudyRows(state, contractDay).find((r) => r.materialId === c.id)?.progress,
    ).toMatchObject(read(state, contractDay, c.id));
  });
  it('計画が今日を対象にしていなければ予定0と捏造しない', () => {
    const s = progressContractFixture();
    s.plan!.from = contractFuture;
    s.plan!.sessions = s.plan!.sessions.filter((r) => r.date === contractFuture);
    expect(read(s, contractDay)).toMatchObject({
      planned: null,
      actual: 6,
      comparisonAvailable: false,
      deficit: null,
      progressRatio: null,
    });
  });
  it('履歴を持たない旧データは実績のみ・比較不能であり、不足を作らない', () => {
    const s = progressContractFixture();
    s.plan!.createdAt = new Date(`${contractDay}T12:00:00`).toISOString();
    expect(read(s)).toMatchObject({
      actual: 6,
      hasReport: true,
      planned: null,
      comparisonAvailable: false,
      deficit: null,
      progressRatio: null,
    });
    expect(read(s, contractPast, 'missing')).toMatchObject({
      hasReport: false,
      planned: null,
      deficit: null,
    });
  });
  it('訂正・取消・再読込を日別、今日、週間レポートへ一貫して反映する', () => {
    let s = progressContractFixture();
    for (const cancelled of [false, true]) {
      s = correctProgress(
        s,
        `${contractDay}-partial`,
        3,
        cancelled,
        `${contractDay}T12:00:00+09:00`,
      );
      s = JSON.parse(JSON.stringify(s));
      const expected = { actual: cancelled ? 0 : 3, hasReport: !cancelled, planned: 10 };
      expect(read(s, contractDay)).toMatchObject(expected);
      expect(
        todayStudyRows(s, contractDay).find((r) => r.materialId === 'partial')?.progress,
      ).toMatchObject(expected);
      expect(
        dailyReportDetails(s, contractDay, contractDay).find((r) => r.materialId === 'partial')
          ?.progress,
      ).toMatchObject(expected);
    }
  });
  it('再配分後の過去予定は日別保存・計画履歴から取得し、現在残量へ不足を加算しない', () => {
    const s = progressContractFixture();
    s.history.push(structuredClone(s.plan!));
    s.plan = {
      ...s.plan!,
      id: 'new',
      from: contractDay,
      createdAt: `${contractDay}T00:00:00+09:00`,
      sessions: s.plan!.sessions.filter((r) => r.date >= contractDay),
    };
    const before = structuredClone(s);
    expect(read(s)).toMatchObject({ planned: 10, actual: 6, deficit: 4 });
    const report = createWeeklyReport(s, contractDay, now);
    expect(report.days.find((d) => d.date === contractPast)?.quantities).toEqual(
      calendarQuantity(s, contractPast, contractDay).totals,
    );
    expect(report.rounds.find((r) => r.material === '一部の教材')).toMatchObject({
      done: 12,
      remaining: 88,
      weekPlanned: 30,
    });
    expect(read(retainStudyDayBaselines(s, contractDay))).toEqual(read(s));
    expect(s).toEqual(before);
  });
  it('別教材の超過で不足を相殺せず、問・ページ・周回の対応を保つ', () => {
    const s = progressContractFixture();
    s.settings.materials.find((m) => m.id === 'over')!.unit = 'ページ';
    s.plan!.settingsSnapshot = structuredClone(s.settings);
    s.settings.materials.find((m) => m.id === 'partial')!.rounds.push({ completed: 0, minutes: 2 });
    s.records.push({
      ...s.records[0],
      id: 'another-round',
      materialId: 'partial',
      round: 1,
      count: 40,
    });
    expect(read(s)).toMatchObject({ actual: 6, deficit: 4 });
    const totals = calendarQuantity(s, contractPast, contractDay).totals;
    expect(totals.find((t) => t.unit === '問')).toMatchObject({ shortage: 14 });
    expect(totals.find((t) => t.unit === 'ページ')).toMatchObject({ actual: 12, shortage: 0 });
    expect([...new Set(todayStudyRows(s, contractDay).map((r) => r.unit))].sort()).toEqual([
      'ページ',
      '問',
    ]);
    const report = createWeeklyReport(s, contractDay, now);
    expect(report.totals.map((r) => r.unit).sort()).toEqual(['ページ', '問']);
    expect(report.totals.find((r) => r.unit === 'ページ')).toMatchObject({
      weekDone: 24,
      weekPlanned: 30,
    });
  });
});
