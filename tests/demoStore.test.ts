import { describe, expect, it } from 'vitest';
import { DEMO_STORAGE_KEY, demoInitialState, loadDemoState, saveDemoState } from '../src/demoStore';
import { initialState } from '../src/domain/model';
import { validateSettings } from '../src/domain/planning';

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: (key: string) => (key === DEMO_STORAGE_KEY ? value : null),
    setItem: (key: string, next: string) => {
      if (key === DEMO_STORAGE_KEY) value = next;
    },
  };
}

describe('公開デモのブラウザー保存', () => {
  it('初回だけ架空の試験・問題集・今日の予定を示し、保存後は本人の内容を優先する', () => {
    const storage = memoryStorage();
    const first = loadDemoState(storage);
    expect(first.revision).toBe(0);
    expect(first.data.settings.exams[0]?.name).toBe('サンプル試験');
    expect(first.data.settings.materials[0]?.name).toBe('サンプル問題集');
    expect(first.data.plan?.sessions.some((session) => session.date === first.data.plan?.from && session.count > 0)).toBe(true);
    const state = { ...initialState(), theme: 'sky' as const };
    expect(saveDemoState(storage, state, 0)).toEqual({ revision: 1, data: state });
    expect(loadDemoState(storage)).toEqual({ revision: 1, data: state });
  });

  it('同じ日付から同じ有効なサンプル予定を作る', () => {
    const first = demoInitialState('2030-10-07');
    expect(validateSettings(first.settings)).toEqual([]);
    expect(demoInitialState('2030-10-07')).toEqual(first);
    expect(first.plan?.shortfalls).toEqual([]);
  });

  it('古い保存番号と壊れたブラウザーデータを拒否する', () => {
    const storage = memoryStorage();
    saveDemoState(storage, initialState(), 0);
    expect(() => saveDemoState(storage, initialState(), 0)).toThrow('別の操作');
    expect(() => loadDemoState(memoryStorage('{'))).toThrow('デモデータを読み取れません');
  });
});
