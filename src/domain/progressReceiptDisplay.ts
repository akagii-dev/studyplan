import { progressReceipts, type ProgressReceipt } from './progressReceipt';
import type { AppState } from './model';

/** Hide only normal empty outcomes; recorded audit entries remain untouched. */
export function visibleProgressReceipts(state: AppState): ProgressReceipt[] {
  return progressReceipts(state).filter((item) =>
    !['unchanged', 'recorded'].includes(item.status) || item.changes.length > 0 || item.shortfalls.length > 0,
  );
}
