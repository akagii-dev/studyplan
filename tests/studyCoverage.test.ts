import { describe, expect, it } from 'vitest';
import { initialState } from '../src/domain/model';
import { studyCoverageGaps, isLongTermStudyGap } from '../src/domain/studyCoverage';
import { setupIssues } from '../src/domain/setupIssues';
import { beginStudyCoverageRepair, beginStudyGoalReview } from '../src/domain/repairPlan';
import {
  RevisionDraft,
  minimumRetainedRounds,
  validateRevisedSettings,
} from '../src/domain/revision';
import { generatePlan, proposeSettings, approve } from '../src/domain/planner';
import { createWeeklyReport } from '../src/domain/weeklyReport';

function fixture() {
  const s = initialState();
  s.settings.exams = [
    {
      id: 'e',
      name: '試験B',
      start: '2026-09-21',
      target: '2027-06-30',
      priority: 2,
      color: '#287569',
      reviewDays: 0,
    },
  ];
  s.settings.materials = [
    {
      id: 'm',
      examId: 'e',
      name: '論述教材',
      total: 240,
      order: 1,
      rounds: [{ completed: 0, minutes: 30 }],
    },
  ];
  s.settings.windows = [
    {
      id: 'w',
      kind: 'study' as const,
      name: '授業期間の学習',
      from: '2026-09-21',
      to: '2027-02-28',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 540,
      end: 780,
    },
  ];
  s.settings.block = 60;
  return s;
}

describe('目標日までの学習枠の適用期間', () => {
  it('2月末で枠が終わると3月から目標日前日までを明示する', () => {
    const s = fixture();
    s.settings.exams.push({
      ...s.settings.exams[0],
      id: 'early',
      name: '試験A',
      target: '2026-11-08',
    });
    const gaps = studyCoverageGaps(s.settings, '2026-09-20');
    expect(gaps).toEqual([
      { examId: 'e', examName: '試験B', from: '2027-03-01', to: '2027-06-29' },
    ]);
    const issue = setupIssues(s.settings, '2026-09-20').find((i) => i.studyGap);
    expect(issue?.impact).toContain('登録済みの期間に学習が集中');
    expect(issue?.severity).toBe('warning');
  });

  it('重複・隣接期間は結合し、曜日の休みは未登録と判定しない', () => {
    const s = fixture();
    const base = s.settings.windows[0];
    s.settings.windows = [
      { ...base, weekdays: [1], to: '2027-01-31' },
      { ...base, id: 'overlap', from: '2026-12-01', to: '2027-02-28' },
      { ...base, id: 'nested', from: '2026-12-10', to: '2027-01-01' },
      { ...base, id: 'spring', from: '2027-03-01', to: '2027-03-31' },
      { ...base, id: 'summer', from: '2027-05-01', to: '2027-07-01' },
    ];
    expect(studyCoverageGaps(s.settings, '2026-09-20').map((g) => [g.from, g.to])).toEqual([
      ['2027-04-01', '2027-04-30'],
    ]);
    s.settings.windows.push({
      ...base,
      id: 'april',
      from: '2027-04-01',
      to: '2027-04-30',
      weekdays: [1],
    });
    expect(studyCoverageGaps(s.settings, '2026-09-20')).toEqual([]);
  });

  it('授業・定期予定は学習枠の登録期間を延長しない。復習期間も確認する', () => {
    const s = fixture();
    s.settings.windows.push({
      ...s.settings.windows[0],
      id: 'class',
      kind: 'class',
      to: '2027-06-30',
    });
    s.settings.exams[0].reviewDays = 20;
    expect(studyCoverageGaps(s.settings, '2026-09-20')[0].to).toBe('2027-06-29');
    expect(studyCoverageGaps(s.settings, '2027-04-01')[0].from).toBe('2027-04-01');
    expect(studyCoverageGaps(s.settings, '2027-06-30')).toEqual([]);
    s.settings.exams[0].target = '';
    expect(studyCoverageGaps(s.settings, '2026-09-20')).toEqual([]);
  });

  it('不足期間の追加は下書きだけに保存し、既存の授業・固定・実績を承認まで維持する', () => {
    const s = fixture();
    s.settings.windows.push({
      ...s.settings.windows[0],
      id: 'class',
      name: '授業',
      kind: 'class',
      start: 600,
      end: 700,
    });
    s.plan = generatePlan(s, '2026-09-21');
    s.plan.sessions[0].fixed = true;
    s.records.push({
      id: 'zero',
      date: '2026-09-20',
      materialId: 'm',
      round: 0,
      count: 0,
      cancelled: false,
      createdAt: '2026-09-20T01:00:00Z',
      updatedAt: '2026-09-20T01:00:00Z',
    });
    const before = structuredClone(s);
    const gap = studyCoverageGaps(s.settings, '2026-09-20')[0];
    const edit = beginStudyCoverageRepair(s, gap, '2026-09-20');
    const d = edit.draft.revision as RevisionDraft;
    expect(s).toEqual(before);
    expect(edit.plan).toEqual(before.plan);
    expect(edit.settings).toEqual(before.settings);
    expect(edit.records).toEqual(before.records);
    expect(d.stage).toBe('question');
    expect(d.settings.windows.at(-1)).toMatchObject({ from: gap.from, to: gap.to, kind: 'study' });
    const resumed = beginStudyCoverageRepair(edit, gap, '2026-09-20').draft
      .revision as RevisionDraft;
    expect(resumed.settings.windows).toEqual(d.settings.windows); // no duplicate on repeat
    const proposed = proposeSettings(edit, d.settings, '2026-09-21');
    expect(proposed.plan).toEqual(before.plan);
    const applied = approve(proposed);
    expect(applied.records).toEqual(before.records);
    expect(applied.plan!.sessions.find((x) => x.id === before.plan!.sessions[0].id)).toEqual(
      before.plan!.sessions[0],
    );
    expect(applied.settings.windows.find((w) => w.id === 'class')).toEqual(
      before.settings.windows[1],
    );
  });

  it('2月までへの集中を再現し、春休み以降を登録すると残量を後の日にも分配する', () => {
    const s = fixture();
    const before = generatePlan(s, '2026-09-21');
    expect(before.shortfalls).toEqual([]);
    expect(before.sessions.at(-1)!.date <= '2027-02-28').toBe(true);
    const edit = beginStudyCoverageRepair(
      s,
      studyCoverageGaps(s.settings, '2026-09-20')[0],
      '2026-09-20',
    );
    const settings = (edit.draft.revision as RevisionDraft).settings;
    const after = generatePlan({ ...s, settings }, '2026-09-21');
    expect(after.shortfalls).toEqual([]);
    expect(after.sessions.some((x) => x.date > '2027-02-28')).toBe(true);
    expect(after.sessions.reduce((n, x) => n + x.count, 0)).toBe(240);
    expect(studyCoverageGaps(settings, '2026-09-20')).toEqual([]);
  });

  it('修正途中の条件を引き継ぎ、レポートは承認済み計画の未登録期間を使う', () => {
    const s = fixture();
    s.plan = generatePlan(s, '2026-09-21');
    const candidate = structuredClone(s.settings);
    candidate.rest = 15;
    const proposed = proposeSettings(s, candidate, '2026-09-21');
    const gap = studyCoverageGaps(s.settings, '2026-09-20')[0];
    const edit = beginStudyCoverageRepair(proposed, gap, '2026-09-20');
    const draft = edit.draft.revision as RevisionDraft;
    expect(draft.settings.rest).toBe(15);
    const now = new Date(2026, 8, 20, 23, 15);
    const report = createWeeklyReport({ ...edit, settings: draft.settings }, '2026-09-20', now);
    expect(report.studyCoverageGaps).toEqual([gap]);
    expect(report.markdown).toContain('2027-03-01〜2027-06-29');
    expect(report.markdown).toContain('登録済みの期間に学習が集中');
  });
});

it('90日以上の残り期間と未登録期間がある場合に周回・目標日の見直しを案内する', () => {
  const s = fixture();
  const gap = studyCoverageGaps(s.settings, '2026-09-20')[0];
  expect(isLongTermStudyGap(s.settings, gap, '2026-09-20')).toBe(true);
  expect(isLongTermStudyGap(s.settings, gap, '2027-06-01')).toBe(false);
  expect(setupIssues(s.settings, '2026-09-20').find((i) => i.studyGap)?.action).toContain(
    '周回数・目標日',
  );
  const edit = beginStudyGoalReview(s, gap, 'material').draft.revision as RevisionDraft;
  expect([edit.topic, edit.itemId, edit.index, edit.stage]).toEqual([
    'material',
    'm',
    2,
    'question',
  ]);
  const exam = beginStudyGoalReview(s, gap, 'exam').draft.revision as RevisionDraft;
  expect([exam.topic, exam.itemId, exam.index, exam.stage]).toEqual(['exam', 'e', 1, 'question']);
  s.settings.windows[0].to = '2027-06-30';
  expect(setupIssues(s.settings, '2026-09-20').some((i) => i.longTerm)).toBe(false);
});

it('未着手の末尾の周回を減らす案を承認でき、実績を残す', () => {
  const s = fixture();
  s.settings.materials[0].rounds.push({ completed: 0, minutes: 20 }, { completed: 0, minutes: 20 });
  s.settings.materials[0].rounds[0].completed = 12;
  const candidate = structuredClone(s.settings);
  candidate.materials[0].rounds = candidate.materials[0].rounds.slice(0, 1);
  const proposal = proposeSettings(s, candidate, '2026-09-21');
  expect(proposal.settings.materials[0].rounds).toHaveLength(3);
  expect(proposal.proposal!.plan.sessions.every((x) => x.round === 0)).toBe(true);
  expect(approve(proposal).settings.materials[0].rounds).toEqual([{ completed: 12, minutes: 30 }]);
});

it.each(['initial', 'zero', 'cancelled', 'fixed', 'elapsed'])(
  '周回を減らす際も%sを壊さない',
  (kind) => {
    const s = fixture();
    s.settings.materials[0].rounds.push({ completed: 0, minutes: 20 });
    if (kind === 'initial') s.settings.materials[0].rounds[1].completed = 1;
    if (kind === 'zero' || kind === 'cancelled')
      s.records.push({
        id: 'record',
        materialId: 'm',
        round: 1,
        count: 0,
        cancelled: kind === 'cancelled',
        date: '2026-09-20',
        createdAt: '',
        updatedAt: '',
      });
    if (kind === 'fixed' || kind === 'elapsed') {
      s.plan = generatePlan(s, '2026-09-21');
      s.plan.sessions = [
        {
          id: 'kept',
          date: kind === 'elapsed' ? '2026-09-19' : '2026-10-01',
          start: 540,
          end: 560,
          kind: 'study',
          examId: 'e',
          materialId: 'm',
          round: 1,
          count: 1,
          fixed: kind === 'fixed',
        },
      ];
    }
    const candidate = structuredClone(s.settings);
    candidate.materials[0].rounds.pop();
    expect(minimumRetainedRounds(s, 'm', '2026-09-21')).toBe(2);
    expect(() => validateRevisedSettings(s, candidate, '2026-09-21')).toThrow('周回は減らせません');
  },
);
