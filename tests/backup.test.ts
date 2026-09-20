import { expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { backupJsonSchema } from '../src/domain/backupSchema';
import { parseBackup } from '../src/domain/backup';
import { initialState } from '../src/domain/model';

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
  file.data.resetBackup = initialState();
  const text = JSON.stringify(file);
  expect(parseBackup(text)).toEqual(file);
  expect(JSON.stringify(file)).toBe(text);
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
