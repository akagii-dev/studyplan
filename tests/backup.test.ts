import { expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { backupJsonSchema } from '../src/domain/backupSchema';
import { parseBackup } from '../src/domain/backup';
import { initialState } from '../src/domain/model';
import { resetSetup, restoreReset } from '../src/domain/reset';

const packet = () => ({
  format: 'StudyPlanBackup',
  version: 1,
  createdAt: '2026-09-20T00:00:00.000Z',
  appVersion: '0.1.0',
  data: initialState(),
});
it('画面と保存側で同じバックアップ形式を使用する', () => {
  const schema = backupJsonSchema();
  if (process.env.UPDATE_BACKUP_SCHEMA === '1')
    writeFileSync('src/domain/backupSchema.json', JSON.stringify(schema, null, 2) + '\n');
  expect(JSON.parse(readFileSync('src/domain/backupSchema.json', 'utf8'))).toEqual(schema);
});
it('初期設定前・空欄の入力途中も保存できる', () => {
  const file = packet();
  file.data.draft.numberEdits = { 'setup/test': { text: '', base: '50' } };
  expect(parseBackup(JSON.stringify(file)).data).toEqual(file.data);
});
it('日別の確定基準・単位・承認日時をバックアップ往復で保持する', () => {
  const file = packet();
  file.data.studyDayBaselines = {
    '2026-09-24': { planId: 'approved', rows: [{ materialId: 'book', examId: 'exam', round: 0, name: '読書', unit: 'ページ', count: 20 }] },
  };
  file.data.plan = { id: 'approved', createdAt: '2026-09-24T01:00:00Z', approvedAt: '2026-09-24T02:00:00Z', from: '2026-09-24', sessions: [], capacities: [], shortfalls: [], conflicts: [] };
  expect(parseBackup(JSON.stringify(file))).toEqual(file);
  file.data.studyDayBaselines['2026-09-24'].rows[0].count = -1;
  expect(() => parseBackup(JSON.stringify(file))).toThrow();
});
it('壊れたJSON・他アプリ・新しいバージョンを拒否する', () => {
  for (const value of [
    '{',
    '{}',
    JSON.stringify({ ...packet(), version: 2 }),
    JSON.stringify({ ...packet(), format: 'Other' }),
  ])
    expect(() => parseBackup(value)).toThrow();
});
it('表示に使う型・計画・下書きの破損を拒否する', () => {
  for (const field of ['settings', 'plan', 'records', 'draft']) {
    const file = packet();
    (file.data as unknown as Record<string, unknown>)[field] = 'broken';
    expect(() => parseBackup(JSON.stringify(file))).toThrow();
  }
  const file = packet();
  file.data.draft.guided = { step: 'exam.name' };
  expect(() => parseBackup(JSON.stringify(file))).toThrow();
});
it('テーマと初期化の復元用データも保ち、原本は変更しない', () => {
  const file = packet();
  file.data.theme = 'sky';
  file.data.appearance = 'dark';
  file.data.sidebarCollapsed = true;
  file.data.windowSize = { width: 1040, height: 720 };
  file.data.calendarDensity = { month: 'compact', week: 'standard', list: 'detailed' };
  file.data.ignoredWarnings = {
    notice: { title: '注意', version: '1', ignoredAt: '2026-09-21T00:00:00Z' },
  };
  file.data.warningExpanded = { notice: false };
  file.data.settings.commute = {
    enabled: true,
    mode: 'weekdays',
    from: '2026-09-21',
    to: '2026-12-31',
    weekdays: [1, 2],
    outboundMinutes: 30,
    returnMinutes: 45,
    outboundStart: 480,
    returnStart: 1080,
  };
  file.data.resetBackup = initialState();
  file.data.resetBackup.appearance = 'system';
  const text = JSON.stringify(file);
  expect(parseBackup(text)).toEqual(file);
  expect(JSON.stringify(file)).toBe(text);
  expect(resetSetup(file.data, true).windowSize).toEqual({ width: 1040, height: 720 });
});

it('表示モードの旧設定との互換性・初期化保持・不正値の拒否', () => {
  expect(parseBackup(JSON.stringify(packet())).data.appearance).toBeUndefined();
  for (const appearance of ['light', 'dark', 'system'] as const) {
    const file = packet();
    file.data.appearance = appearance;
    expect(parseBackup(JSON.stringify(file)).data.appearance).toBe(appearance);
    const reset = resetSetup(file.data, true);
    expect(reset.appearance).toBe(appearance);
    expect(restoreReset(reset).appearance).toBe(appearance);
  }
  const file = packet();
  expect(() =>
    parseBackup(JSON.stringify({ ...file, data: { ...file.data, appearance: 'unknown' } })),
  ).toThrow();
});

it('ウィンドウサイズの旧設定との互換性と不正値の拒否', () => {
  expect(parseBackup(JSON.stringify(packet())).data.windowSize).toBeUndefined();
  const file = packet();
  file.data.windowSize = { width: 900, height: 650 };
  expect(parseBackup(JSON.stringify(file)).data.windowSize).toEqual(file.data.windowSize);
  for (const windowSize of [
    { width: 0, height: 650 },
    { width: 900.5, height: 650 },
    { width: 900, height: 100_001 },
  ])
    expect(() =>
      parseBackup(JSON.stringify({ ...file, data: { ...file.data, windowSize } })),
    ).toThrow();
});

it('試験・教材の追加下書きを保持し、壊れた追加下書きを拒否する', () => {
  for (const key of ['addExam', 'addMaterial']) {
    const file = packet();
    file.data.draft[key] = {
      step: key === 'addExam' ? 'exam.name' : 'material.total',
      trail: [],
      roundIndex: 0,
      exam: {
        id: 'new-e',
        name: '',
        start: '',
        target: '',
        priority: 2,
        color: '#287569',
        reviewDays: 0,
      },
      material: {
        id: 'new-m',
        examId: '',
        name: '',
        total: 100,
        order: 1,
        rounds: [{ completed: 0, minutes: 2 }],
      },
      window: {
        id: 'w',
        name: '',
        kind: 'study',
        from: '',
        to: '',
        weekdays: [1],
        start: 1080,
        end: 1260,
      },
      exception: { id: 'x', name: '', date: '', start: 0, end: 1440 },
      classFrom: '',
      classTo: '',
    };
    expect(parseBackup(JSON.stringify(file)).data.draft[key]).toEqual(file.data.draft[key]);
    (file.data.draft[key] as { step: string }).step = 'window.time';
    expect(() => parseBackup(JSON.stringify(file))).toThrow();
    file.data.draft[key] = { step: 'exam.name' };
    expect(() => parseBackup(JSON.stringify(file))).toThrow();
  }
});
