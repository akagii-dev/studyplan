import { expect, it } from 'vitest';
import { initialState } from '../src/domain/model';
import { latestReceipt, progressReceipts, type ProgressReceipt } from '../src/domain/progressReceipt';
import { visibleProgressReceipts } from '../src/domain/progressReceiptDisplay';

it('正常な空結果だけを未来表示から除き、実変更・警告・元履歴を保持する', () => {
  const state = initialState();
  const make = (id: string, status: ProgressReceipt['status']): ProgressReceipt => ({
    id, status, recordId: id, action: 'record', date: '2026-10-02', timestamp: '2026-10-02T12:00:00Z',
    materialId: 'book', round: 0, beforeCount: null, afterCount: 0, futureFrom: '2026-10-03', changes: [], shortfalls: [],
  });
  const changed = make('changed', 'applied');
  changed.changes.push({ date: '2026-10-03', materialId: 'book', round: 0, kind: 'study', fixed: false,
    beforeCount: 10, afterCount: 9, beforeMinutes: 20, afterMinutes: 18, timeChanged: false,
    beforeSlots: ['600-620'], afterSlots: ['600-618'] });
  const warning = make('warning', 'unchanged');
  warning.shortfalls.push({ materialId: 'book', round: 0, count: 1, minutes: 2, reason: '空き時間不足' });
  state.draft.progressReceipts = [changed, make('failed', 'failed'), make('review', 'review'), make('unplaced', 'unplaced'), warning,
    make('recorded', 'recorded'), make('unchanged', 'unchanged')];
  const before = JSON.stringify(state);
  expect(visibleProgressReceipts(state).map((receipt) => receipt.id)).toEqual(['changed', 'failed', 'review', 'unplaced', 'warning']);
  expect(progressReceipts(state)).toHaveLength(7);
  expect(latestReceipt(state)?.id).toBe('unchanged');
  expect(JSON.stringify(state)).toBe(before);
});
