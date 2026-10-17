import { expect, it } from 'vitest';
import { initialState } from '../src/domain/model';
import { resetSetup } from '../src/domain/reset';
import { backupSchema } from '../src/domain/backupSchema';

const backup = { format: 'StudyPlanBackup', version: 1, createdAt: '2026-10-17T00:00:00.000Z', appVersion: '1.0.0' };

it('UI強化は未指定でオン扱いのまま読み込み、外した選択は初期化とバックアップで保つ', () => {
  expect(initialState().enhancedUi).toBeUndefined();
  const off = { ...initialState(), enhancedUi: false };
  expect(resetSetup(off, true).enhancedUi).toBe(false);
  expect(backupSchema.parse({ ...backup, data: off }).data.enhancedUi).toBe(false);
  expect(backupSchema.parse({ ...backup, data: initialState() }).data.enhancedUi).toBeUndefined();
});
