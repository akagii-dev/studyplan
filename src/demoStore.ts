import { AppState, Envelope, addDays, defaultMeals, initialState, today } from './domain/model';
import { generatePlan } from './domain/planner/generate';

export const DEMO_STORAGE_KEY = 'studyplan-demo-state-v1';

/** A fictional, dated example for first-time demo visitors. Existing browser data wins. */
export function demoInitialState(date = today()): AppState {
  const state = initialState();
  const target = addDays(date, 21);
  state.settings.exams = [{
    id: 'demo-exam',
    name: 'サンプル試験',
    start: date,
    target,
    priority: 2,
    color: '#287569',
    reviewDays: 1,
  }];
  state.settings.materials = [{
    id: 'demo-material',
    examId: 'demo-exam',
    name: 'サンプル問題集',
    total: 60,
    order: 1,
    rounds: [{ completed: 0, minutes: 3 }],
  }];
  state.settings.windows = [{
    id: 'demo-study-window',
    name: '毎日の学習時間',
    from: date,
    to: target,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    start: 420,
    end: 1380,
    kind: 'study',
  }];
  state.settings.meals = structuredClone(defaultMeals);
  state.settings.scheduleAnswers = { class: 'none', busy: 'none', exception: 'none' };
  state.plan = generatePlan(state, date, false, 0, 'balanced', {
    date,
    minute: 0,
    timestamp: `${date}T00:00:00.000Z`,
    idPrefix: `demo-${date}`,
  });
  return state;
}

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
  if (!text) return { revision: 0, data: demoInitialState() };
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
