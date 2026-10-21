import { expect, it } from 'vitest';
import { initialState } from '../src/domain/model';
import { applyOffsets, setDayOffset } from '../src/domain/todayProgress';
import { backupSchema } from '../src/domain/backupSchema';

const DATE = '2026-10-21';
// A minimal progress view: only the fields the offset reads, plus the display text it replaces.
function row(materialId: string, target: number, recorded: number, unit = '問') {
  const complete = recorded >= target;
  return {
    materialId, round: 0, unit,
    progress: { complete, target, recorded, left: Math.max(0, target - recorded), text: complete ? '完了' : `あと${target - recorded}${unit}`, supplement: '' },
  } as unknown as Parameters<typeof applyOffsets>[0][number];
}

it('相殺は選んだ行だけに効き、選ぶまではクリアにしない', () => {
  const rows = [row('math', 10, 15), row('english', 10, 6)];
  const [, untouched] = applyOffsets(rows, []);
  expect(untouched.progress.complete).toBe(false);
  expect(untouched).toMatchObject({ offsetAvailable: true, offsetChosen: false, offset: 0 });

  const [math, english] = applyOffsets(rows, [{ materialId: 'english', round: 0 }]);
  expect(english.progress).toMatchObject({ complete: true, text: '相殺でクリア', supplement: 'ほかの追加分4問', left: 4, recorded: 6 });
  expect(english).toMatchObject({ offset: 4, offsetChosen: true });
  // The row that gave its extra keeps its own record and view.
  expect(math.progress).toEqual(rows[0].progress);
});

it('追加分が足りない・単位が違う場合は相殺しない', () => {
  const short = applyOffsets([row('math', 10, 12), row('english', 10, 6)], [{ materialId: 'english', round: 0 }]);
  expect(short[1]).toMatchObject({ offset: 0, offsetChosen: true, offsetAvailable: false });
  expect(short[1].progress.complete).toBe(false);
  const pages = applyOffsets([row('math', 10, 20), row('reading', 10, 6, 'ページ')], [{ materialId: 'reading', round: 0 }]);
  expect(pages[1].progress.complete).toBe(false);
  expect(pages[1].offsetAvailable).toBe(false);
});

it('同じ追加分を二度使わない', () => {
  const rows = [row('math', 10, 15), row('english', 10, 7), row('physics', 10, 7)];
  const [, english, physics] = applyOffsets(rows, [{ materialId: 'english', round: 0 }]);
  expect(english.progress.complete).toBe(true);
  // 5 extra, 3 used: the remaining 2 cannot cover physics' 3.
  expect(physics).toMatchObject({ offsetAvailable: false });
  const both = applyOffsets(rows, [{ materialId: 'english', round: 0 }, { materialId: 'physics', round: 0 }]);
  expect(both.map((r) => r.progress.complete)).toEqual([true, true, false]);
});

it('相殺の選択は日ごとに保存され、取り消すと消え、保存形式に入る', () => {
  const english = { materialId: 'english', round: 0 };
  const on = setDayOffset(initialState(), DATE, english, true);
  expect(on.dayOffsets).toEqual({ [DATE]: [english] });
  expect(setDayOffset(on, DATE, english, true).dayOffsets).toEqual({ [DATE]: [english] });
  expect(setDayOffset(on, DATE, english, false).dayOffsets).toBeUndefined();
  const backup = { format: 'StudyPlanBackup', version: 1, createdAt: '2026-10-21T00:00:00.000Z', appVersion: '1.0.1' };
  expect(backupSchema.parse({ ...backup, data: on }).data.dayOffsets).toEqual(on.dayOffsets);
});
