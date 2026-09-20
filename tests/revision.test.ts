import { describe, it, expect } from 'vitest';
import { initialState, addDays, Settings, Session } from '../src/domain/model';
import {
  generatePlan,
  proposeSettings,
  approve,
  undoPlan,
  proposalAfterRecord,
  freeIntervalsForDate,
} from '../src/domain/planning';
import {
  beginRevision,
  RevisionDraft,
  validateRevisedSettings,
  revisionIsStale,
} from '../src/domain/revision';
import { overlapsBusy, unavailableEvents } from '../src/domain/planAudit';
const date = '2026-10-05';
function fixture() {
  const s = initialState();
  s.settings.exams = [
    {
      id: 'e',
      name: '試験',
      start: date,
      target: addDays(date, 14),
      priority: 2,
      color: '#287569',
      reviewDays: 0,
    },
  ];
  s.settings.materials = [
    {
      id: 'm',
      name: '問題集',
      examId: 'e',
      total: 37,
      order: 1,
      rounds: [{ completed: 0, minutes: 3 }],
    },
  ];
  s.settings.windows = [
    {
      id: 'study',
      name: '学習枠',
      kind: 'study',
      from: date,
      to: addDays(date, 30),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 540,
      end: 1080,
    },
  ];
  s.records = [
    {
      id: 'r',
      date: addDays(date, -1),
      materialId: 'm',
      round: 0,
      count: 3,
      cancelled: false,
      createdAt: '2026-09-20T01:00:00Z',
      updatedAt: '2026-09-20T01:00:00Z',
    },
  ];
  s.plan = generatePlan(s, date);
  return s;
}
function classes(settings: Settings) {
  for (const [i, start] of [540, 650, 790].entries())
    settings.windows.push({
      id: `class${i}`,
      name: `大学${i + 1}限`,
      kind: 'class',
      from: date,
      to: addDays(date, 30),
      weekdays: [1],
      start,
      end: start + 100,
    });
}
describe('対話での再計画', () => {
  it('予定の確認状況が別画面で変わっても、古い下書きで上書きしない', () => {
    let s = beginRevision(fixture());
    const draft = s.draft.revision as RevisionDraft;
    s.settings.scheduleAnswers = { busy: 'none' };
    expect(revisionIsStale(draft, s.settings)).toBe(true);
    s = proposeSettings(s, { ...s.settings, block: 240 }, date);
    s.settings.scheduleAnswers = { busy: 'deferred' };
    expect(() => approve(s)).toThrow('設定が変わっています');
  });
  it('全設定を独立した下書きへ引き継ぐ', () => {
    const s = fixture();
    classes(s.settings);
    const n = beginRevision(s),
      d = n.draft.revision as RevisionDraft;
    expect(d.settings).toEqual(s.settings);
    d.settings.exams[0].name = '変更';
    expect(s.settings.exams[0].name).toBe('試験');
    expect(n.plan).toBe(s.plan);
    expect(n.records).toBe(s.records);
  });
  it('案の作成・破棄では設定と実績と計画を変更せず、承認で設定と計画を反映する', () => {
    const s = fixture();
    const settings = structuredClone(s.settings);
    settings.block = 240;
    settings.exams[0].target = addDays(date, 21);
    classes(settings);
    const n = proposeSettings(s, settings, date);
    expect(n.settings).toEqual(s.settings);
    expect(n.plan).toEqual(s.plan);
    expect({ ...n, proposal: null }.settings).toEqual(s.settings);
    expect(n.proposal!.plan.settingsSnapshot).toEqual(settings);
    const accepted = approve(n);
    expect(accepted.settings).toEqual(settings);
    expect(accepted.records).toEqual(s.records);
    expect(accepted.plan!.sessions.every((x) => !overlapsBusy(settings, x).length)).toBe(true);
    expect(accepted.history.at(-1)).toEqual(s.plan);
    const undone = undoPlan(accepted);
    expect(undone.plan).toEqual(s.plan);
    expect(undone.records).toEqual(s.records);
    expect(undone.settings).toEqual(settings);
  });
  it('固定予定は保持し、授業と衝突する固定を無断移動しない', () => {
    const s = fixture();
    s.plan!.sessions[0].fixed = true;
    const fixed = structuredClone(s.plan!.sessions[0]);
    const settings = structuredClone(s.settings);
    classes(settings);
    const n = proposeSettings(s, settings, date);
    expect(n.proposal!.plan.sessions).toContainEqual(fixed);
    expect(n.proposal!.plan.conflicts.length).toBeGreaterThan(0);
    expect(() => approve(n)).toThrow();
    expect(n.records).toEqual(s.records);
  });
  it('編集中や案作成後に別画面で設定が変わった場合は上書きしない', () => {
    let s = beginRevision(fixture());
    const d = s.draft.revision as RevisionDraft;
    s.settings.block = 210;
    expect(revisionIsStale(d, s.settings)).toBe(true);
    s = proposeSettings(s, { ...s.settings, block: 240 }, date);
    s.settings.rest = 20;
    expect(() => approve(s)).toThrow('設定が変わっています');
  });
  it('進捗反映時も承認待ちの変更条件を引き継ぐ', () => {
    const s = fixture();
    const n = proposeSettings(s, { ...s.settings, block: 240 }, date);
    const updated = proposalAfterRecord(n, 'test');
    expect(updated.settings.block).toBe(s.settings.block);
    expect(updated.proposal!.plan.settingsSnapshot!.block).toBe(240);
    expect(updated.records).toEqual(s.records);
  });
  it('完了数・登録済み周回の削除・完了数を下回る問題数を拒否する', () => {
    const s = fixture(),
      candidate = structuredClone(s.settings);
    candidate.materials[0].total = 2;
    expect(() => validateRevisedSettings(s, candidate)).toThrow('完了数');
    candidate.materials[0].total = 37;
    candidate.materials[0].rounds[0].completed = 5;
    expect(() => validateRevisedSettings(s, candidate)).toThrow('完了数を変更');
    candidate.materials[0].rounds = [];
    expect(() => validateRevisedSettings(s, candidate)).toThrow('周回');
  });
});
describe('画像の時刻と授業の重複', () => {
  it('10:40の授業間移動と13:10の授業に重なる3件を検出し、再計画で解消する', () => {
    const s = fixture();
    classes(s.settings);
    const imageTimes = [
      [640, 649, 3],
      [750, 798, 16],
      [808, 838, 10],
    ];
    s.plan!.sessions = imageTimes.map(([start, end, count], i): Session => ({
      id: `image${i}`,
      date,
      start,
      end,
      count,
      materialId: 'm',
      examId: 'e',
      round: 0,
      fixed: false,
      kind: 'study',
    }));
    expect(s.plan!.sessions.map((x) => overlapsBusy(s.settings, x).length > 0)).toEqual([
      true,
      true,
      true,
    ]);
    const revised = approve(proposeSettings(s, s.settings, date));
    expect(
      revised.plan!.sessions.every((x) => overlapsBusy(revised.settings, x).length === 0),
    ).toBe(true);
    expect(revised.records).toEqual(s.records);
  });
  it('授業間の10分は常に除外し、指定した授業前後の移動も追加で除外する', () => {
    const s = fixture();
    classes(s.settings);
    expect(freeIntervalsForDate(s.settings, date)).not.toContainEqual([640, 650]);
    s.settings.classTransition = 10;
    expect(freeIntervalsForDate(s.settings, date)).toEqual([
      [760, 780],
      [900, 1080],
    ]);
    const plan = generatePlan(s, date);
    for (const x of plan.sessions) expect(overlapsBusy(s.settings, x)).toHaveLength(0);
    expect(unavailableEvents(s.settings, date).some((x) => x.kind === 'transition')).toBe(true);
  });
  it('日付をまたぐ授業前後も正しい日に除外する', () => {
    const s = fixture();
    s.settings.classTransition = 10;
    s.settings.windows[0].start = 0;
    s.settings.windows[0].end = 1440;
    s.settings.windows.push({
      id: 'late',
      name: '深夜授業',
      kind: 'class',
      from: addDays(date, -1),
      to: date,
      weekdays: [0, 1],
      start: 1380,
      end: 1440,
    });
    expect(freeIntervalsForDate(s.settings, date)[0][0]).toBe(10);
  });
});
