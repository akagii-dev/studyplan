import { AppState, Envelope, initialState } from './domain/model';

export const DEMO_STORAGE_KEY = 'studyplan-demo-state-v1';

function isAppState(value: unknown): value is AppState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<AppState>;
  return (
    !!state.settings &&
    Array.isArray(state.settings.exams) &&
    Array.isArray(state.settings.materials) &&
    Array.isArray(state.settings.windows) &&
    Array.isArray(state.settings.exceptions) &&
    Array.isArray(state.records) &&
    Array.isArray(state.history) &&
    !!state.draft &&
    Number.isInteger(state.step)
  );
}

export function loadDemoState(storage: Pick<Storage, 'getItem'>): Envelope {
  const text = storage.getItem(DEMO_STORAGE_KEY);
  if (!text) return { revision: 0, data: initialState() };
  try {
    const value = JSON.parse(text) as Envelope;
    if (!Number.isInteger(value.revision) || value.revision < 0 || !isAppState(value.data))
      throw new Error('invalid envelope');
    return value;
  } catch {
    throw new Error(
      'ブラウザー内のデモデータを読み取れません。サイトデータを削除すると初期状態へ戻せます。',
    );
  }
}

export function saveDemoState(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  data: AppState,
  expected: number,
): Envelope {
  const current = loadDemoState(storage);
  if (current.revision !== expected)
    throw new Error('別の操作でデータが更新されました。ページを再読み込みしてやり直してください。');
  const next = { revision: current.revision + 1, data };
  storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(next));
  return next;
}
