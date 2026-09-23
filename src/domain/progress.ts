import { AppState, Progress, remaining } from './model';
export function recordProgress(state: AppState, entry: Progress): AppState {
  if (state.records.some((r) => r.id === entry.id)) return state;
  validateEntry(state, entry);
  return { ...state, records: [...state.records, entry] };
}
function validateEntry(state: AppState, entry: Progress) {
  const m = state.settings.materials.find((m) => m.id === entry.materialId);
  if (!m || !m.rounds[entry.round]) throw new Error('教材と周回を選択してください。');
  if (!Number.isInteger(entry.count) || entry.count < 0)
    throw new Error('問題数は0以上の整数にしてください。');
  if (entry.count > remaining(state, entry.materialId, entry.round))
    throw new Error('残り問題数を超えています。');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) throw new Error('記録日を指定してください。');
}
export function correctProgress(
  state: AppState,
  id: string,
  count: number,
  cancelled = false,
  updatedAt = new Date().toISOString(),
): AppState {
  const old = state.records.find((r) => r.id === id);
  if (!old) throw new Error('記録がありません。');
  const without = { ...state, records: state.records.filter((r) => r.id !== id) };
  const entry = { ...old, count, cancelled, updatedAt };
  if (!cancelled) validateEntry(without, entry);
  return { ...state, records: state.records.map((r) => (r.id === id ? entry : r)) };
}
