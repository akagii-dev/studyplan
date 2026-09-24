import { expect, it } from 'vitest';
import { adjustmentFixture, adjustmentContext, adjustmentReport } from './fixtures/adjustment';
import { validateMaterialChanges, MAX_MINUTES_PER_UNIT } from '../src/domain/materialConstraints';
import { minimumRetainedRounds, validateRevisedSettings } from '../src/domain/revision';
import { validateSettings } from '../src/domain/planner/validation';
import { backupSchema } from '../src/domain/backupSchema';
import { parseBackup } from '../src/domain/backup';

it.each(['initial', 'record', 'zero', 'cancelled', 'started', 'fixed', 'unused'])(
  '周回保持は一覧・対話・確定保存で共通（%s）',
  (kind) => {
    const s = adjustmentFixture();
    const session = s.plan!.sessions.find((x) => x.materialId === 'book' && x.round === 1)!;
    if (kind === 'initial') s.settings.materials[0].rounds[1].completed = 7;
    if (['record', 'zero', 'cancelled'].includes(kind))
      s.records = [
        { ...adjustmentReport(kind === 'zero' ? 0 : 7), round: 1, cancelled: kind === 'cancelled' },
      ];
    if (kind === 'started') session.date = adjustmentContext.date;
    if (kind === 'fixed') session.fixed = true;
    const original = structuredClone(s);
    const candidate = structuredClone(s.settings);
    candidate.materials[0].rounds.pop();
    expect(minimumRetainedRounds(s, 'book', adjustmentContext.date, adjustmentContext.minute)).toBe(
      kind === 'unused' ? 1 : 2,
    );
    for (const check of [validateMaterialChanges, validateRevisedSettings]) {
      const save = () => check(s, candidate, adjustmentContext.date, adjustmentContext.minute);
      if (kind === 'unused') expect(save).not.toThrow();
      else expect(save).toThrow('周回');
    }
    expect(s).toEqual(original);
  },
);

it('編集開始後に追加された初期完了も確定時の最新状態で保護する', () => {
  const latest = adjustmentFixture();
  const draft = structuredClone(latest.settings);
  draft.materials[0].rounds.pop();
  latest.settings.materials[0].rounds[1].completed = 7;
  expect(() => validateMaterialChanges(latest, draft, adjustmentContext.date, 720)).toThrow('周回');
});

it.each([0, 0.1, 1440, 1440.1, 2000])(
  '推定分数%sの入力・確定・バックアップ判定を一致させる',
  (minutes) => {
    const s = adjustmentFixture();
    s.settings.materials[0].rounds[0].minutes = minutes;
    const valid = minutes > 0 && minutes <= MAX_MINUTES_PER_UNIT;
    const packet = {
      format: 'StudyPlanBackup',
      version: 1,
      createdAt: adjustmentContext.timestamp,
      appVersion: '0.4.20',
      data: s,
    };
    expect(validateSettings(s.settings).length === 0).toBe(valid);
    expect(backupSchema.safeParse(packet).success).toBe(valid);
    if (valid) {
      expect(() =>
        validateMaterialChanges(s, s.settings, adjustmentContext.date, 720),
      ).not.toThrow();
      expect(parseBackup(JSON.stringify(packet)).data).toEqual(s);
    } else
      expect(() => validateMaterialChanges(s, s.settings, adjustmentContext.date, 720)).toThrow(
        '分',
      );
  },
);
