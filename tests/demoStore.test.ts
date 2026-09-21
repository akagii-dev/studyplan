import { describe, expect, it } from 'vitest';
import { DEMO_STORAGE_KEY, loadDemoState, saveDemoState } from '../src/demoStore';
import { initialState } from '../src/domain/model';

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
  it('未保存なら既存の初期状態を使い、保存後に同じ内容を読み込む', () => {
    const storage = memoryStorage();
    expect(loadDemoState(storage).revision).toBe(0);
    const state = { ...initialState(), theme: 'sky' as const };
    expect(saveDemoState(storage, state, 0)).toEqual({ revision: 1, data: state });
    expect(loadDemoState(storage)).toEqual({ revision: 1, data: state });
  });

  it('古い保存番号と壊れたブラウザーデータを拒否する', () => {
    const storage = memoryStorage();
    saveDemoState(storage, initialState(), 0);
    expect(() => saveDemoState(storage, initialState(), 0)).toThrow('別の操作');
    expect(() => loadDemoState(memoryStorage('{'))).toThrow('デモデータを読み取れません');
  });
});
