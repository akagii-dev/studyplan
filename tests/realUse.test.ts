import { afterEach, expect, it, vi } from 'vitest';
import { studentFixture } from './fixtures/student';
import {
  generatePlan,
  proposeSettings,
  proposalAfterRecord,
  approve,
  capacityForDate,
  capacityForWeek,
} from '../src/domain/planning';
import { recordProgress, correctProgress } from '../src/domain/progress';
import { addDays } from '../src/domain/model';
import { overlapsBusy } from '../src/domain/planAudit';
import { fixedTimeIssue } from '../src/domain/planConstraints';
import { beginConstraintRepair } from '../src/domain/repairPlan';
import { RevisionDraft } from '../src/domain/revision';

const from = '2030-10-07';
afterEach(() => vi.useRealTimers());
it('同じ教材・周回の連続した新規予定は1枚にまとめ、休憩や固定枠はまたがない', () => {
  const s = studentFixture(from);
  s.settings.materials[1].rounds[0].minutes = 45;
  s.settings.buffer = 0.3;
  s.records = [
    {
      id: 'r',
      materialId: 'long',
      round: 0,
      date: from,
      count: 2,
      cancelled: false,
      createdAt: from + 'T00:00:00Z',
      updatedAt: from + 'T00:00:00Z',
    },
  ];
  const plan = generatePlan(s, from);
  for (const [i, x] of plan.sessions.entries()) {
    const previous = plan.sessions[i - 1];
    if (
      previous &&
      x.kind === 'study' &&
      previous.kind === 'study' &&
      x.date === previous.date &&
      x.materialId === previous.materialId &&
      x.round === previous.round
    )
      expect(x.start - previous.end).toBeGreaterThan(1e-7);
    expect(x.end - x.start).toBeLessThanOrEqual(s.settings.block + 1e-7);
  }
  const fixed = plan.sessions.find((x) => x.materialId === 'long')!;
  const a = { ...fixed, id: 'fixed-a', date: from, start: 810, end: 855, count: 1, fixed: true };
  const b = { ...a, id: 'fixed-b', start: 855, end: 900 };
  s.plan = { ...plan, sessions: [a, b] };
  const revised = generatePlan(s, from);
  expect(revised.sessions).toContainEqual(a);
  expect(revised.sessions).toContainEqual(b);
});
it('授業期間から休暇まで、負荷の違う教材を共通枠へ配置し、休憩・週上限・残数を維持する', () => {
  const s = studentFixture(from);
  const plan = generatePlan(s, from);
  expect(plan.conflicts).toEqual([]);
  expect(plan.shortfalls).toEqual([]);
  for (const m of s.settings.materials)
    for (const [round, r] of m.rounds.entries()) {
      const sessions = plan.sessions.filter((x) => x.materialId === m.id && x.round === round);
      expect(sessions.reduce((n, x) => n + x.count, 0)).toBe(m.total - r.completed);
      for (const x of sessions) expect(x.end - x.start).toBeCloseTo(x.count * r.minutes);
    }
  for (const [i, x] of plan.sessions.entries()) {
    expect(overlapsBusy(s.settings, x)).toEqual([]);
    const previous = plan.sessions[i - 1];
    if (previous?.date === x.date) expect(x.start).toBeGreaterThanOrEqual(previous.end - 1e-7);
    expect(
      capacityForDate(s.settings, x.date).slots.some(
        ([a, b]) => a <= x.start + 1e-7 && x.end <= b + 1e-7,
      ),
    ).toBe(true);
    const week = capacityForWeek(s.settings, x.date, plan.sessions);
    expect(week.used).toBeLessThanOrEqual(week.limit + 1e-7);
  }
  expect(
    plan.sessions.some((x) => x.materialId === 'long' && x.count <= 3 && x.end - x.start >= 30),
  ).toBe(true);
  expect(plan.sessions.some((x) => x.date > addDays(from, 20))).toBe(true);
  expect(capacityForDate(s.settings, addDays(from, 9)).focus).toBe(0);
});

it('承認待ちの条件変更は、記録・訂正・取消で消さず新しい残数に引き継ぐ', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(from + 'T06:00:00'));
  let s = studentFixture(from);
  s.plan = generatePlan(s, from);
  const settings = structuredClone(s.settings);
  settings.materials[1].rounds[0].minutes = 45;
  settings.buffer = 0.3;
  s = proposeSettings(s, settings, from);
  const entry = {
    id: 'progress',
    materialId: 'long',
    round: 0,
    date: from,
    count: 2,
    cancelled: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  for (const change of [
    () => recordProgress(s, entry),
    () => correctProgress(s, entry.id, 1),
    () => correctProgress(s, entry.id, 1, true),
  ]) {
    const before = s;
    const proposalId = before.proposal!.plan.id;
    s = proposalAfterRecord(change(), '記録の変更', before.proposal);
    expect(s.settings.buffer).toBe(0.2);
    expect(s.proposal?.plan.settingsSnapshot?.buffer).toBe(0.3);
    expect(s.proposal?.plan.settingsSnapshot?.materials[1].rounds[0].minutes).toBe(45);
    expect(s.proposal!.plan.id).toBe(proposalId);
  }
});

it('固定予定の所要時間が不足したら、予定を保存したまま承認を止めて教材修正へ案内する', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(from + 'T06:00:00'));
  const s = studentFixture(from);
  s.plan = generatePlan(s, from);
  const fixed = s.plan.sessions.find((x) => x.materialId === 'long')!;
  fixed.fixed = true;
  const settings = structuredClone(s.settings);
  settings.materials[1].rounds[fixed.round].minutes = 100;
  const next = proposeSettings(s, settings, from);
  expect(next.proposal!.plan.sessions).toContainEqual(fixed);
  expect(next.proposal!.plan.conflicts.join('')).toContain('推定所要時間');
  expect(() => approve(next)).toThrow();
  next.proposal!.plan.conflicts = [];
  expect(() => approve(next)).toThrow('推定所要時間');
  const issue = fixedTimeIssue(settings, fixed, capacityForDate(settings, fixed.date));
  expect(issue).toMatchObject({ topic: 'material', itemId: 'long', index: 3 + fixed.round });
  const repaired = beginConstraintRepair(next, issue!);
  expect(repaired.draft.revision as RevisionDraft).toMatchObject({
    stage: 'question',
    topic: 'material',
    itemId: 'long',
    index: 3 + fixed.round,
  });
});

it('後の周回を先に固定した場合は、前の周回を後日に押し出した案を承認させない', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(from + 'T06:00:00'));
  const s = studentFixture(from);
  s.plan = generatePlan(s, from);
  const fixed = s.plan.sessions.find((x) => x.materialId === 'long' && x.round === 1)!;
  Object.assign(fixed, { date: from, start: 810, end: 850, count: 1, fixed: true });
  const p = generatePlan(s, from);
  expect(p.sessions).toContainEqual(fixed);
  expect(p.conflicts.join('')).toContain('取り組む順序');
  const candidate = proposeSettings(s, s.settings, from);
  candidate.proposal!.plan.conflicts = [];
  expect(() => approve(candidate)).toThrow('取り組む順序');
});

it('完了済み先行周回・短くした推定時間は固定予定の承認を妨げない', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(from + 'T06:00:00'));
  const s = studentFixture(from);
  s.plan = generatePlan(s, from);
  const fixed = s.plan.sessions.find((x) => x.materialId === 'long' && x.round === 1)!;
  Object.assign(fixed, { date: from, start: 810, end: 850, count: 1, fixed: true });
  s.settings.materials[1].rounds[0].completed = 37;
  s.settings.materials[1].rounds[1].minutes = 30;
  const proposed = proposeSettings(s, s.settings, from);
  expect(proposed.proposal!.plan.conflicts).toEqual([]);
  expect(approve(proposed).plan!.sessions).toContainEqual(fixed);
});

it('負荷変更後も開始済みの固定予定を時間不足として扱わず、過去を保つ', () => {
  const s = studentFixture(from);
  s.plan = generatePlan(s, from);
  const fixed = s.plan.sessions.find((x) => x.materialId === 'long')!;
  fixed.fixed = true;
  s.settings.materials[1].rounds[fixed.round].minutes = 100;
  const plan = generatePlan(s, addDays(fixed.date, 1));
  expect(plan.sessions).toContainEqual(fixed);
  expect(plan.conflicts).toEqual([]);
});

it('記録で候補の総問題数を超えても、実績を保存して未承認の候補を適用しない', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(from + 'T06:00:00'));
  let s = studentFixture(from);
  s.plan = generatePlan(s, from);
  const candidate = structuredClone(s.settings);
  candidate.materials[1].total = 8;
  s = proposeSettings(s, candidate, from);
  const entry = {
    id: 'large',
    materialId: 'long',
    round: 0,
    date: from,
    count: 5,
    cancelled: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const next = proposalAfterRecord(recordProgress(s, entry), '記録', s.proposal);
  expect(next.records).toContainEqual(entry);
  expect(next.settings.materials[1].total).toBe(37);
  expect(next.proposal!.plan.settingsSnapshot!.materials[1].total).toBe(8);
  expect(() => approve(next)).toThrow('進捗が変わっています');
});
