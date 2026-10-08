import { beforeEach, expect, it, vi } from 'vitest';
import { initialState, type AppState } from '../src/domain/model';

const calls: { command: string; args?: Record<string, unknown> }[] = [];
let stored: { revision: number; data: AppState } | null = null;
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    if (command === 'load_state') return stored && structuredClone(stored);
    if (command === 'commit_state') {
      const { changes, removed } = args as { changes: Record<string, unknown>; removed: string[] };
      const data = { ...(stored?.data ?? {}), ...structuredClone(changes) } as Record<string, unknown>;
      for (const key of removed) delete data[key];
      stored = { revision: (stored?.revision ?? 0) + 1, data: data as unknown as AppState };
      return stored.revision;
    }
    throw new Error(command);
  },
}));
const { loadState, saveState } = await import('../src/store');

beforeEach(() => {
  calls.length = 0;
  stored = null;
});
const commits = () => calls.filter((call) => call.command === 'commit_state').map((call) => call.args!);

it('デスクトップ保存は変更した項目だけを送り、保存結果は全体保存と同じになる', async () => {
  const first = await loadState();
  const state = { ...first.data, sidebarCollapsed: true };
  expect((await saveState(state, 0, 'a')).revision).toBe(1);
  // Nothing was stored: the first save sends every key.
  expect(Object.keys(commits()[0].changes as object).sort()).toEqual(Object.keys(state).sort());
  const next: AppState = { ...state, records: [...state.records], step: 2 };
  delete next.sidebarCollapsed;
  await saveState(next, 1, 'b');
  // Records are equal by content, so only the step and the removal are sent.
  expect(commits()[1]).toMatchObject({ changes: { step: 2 }, removed: ['sidebarCollapsed'], expected: 1 });
  expect(stored!.data).toEqual(next);
});

it('履歴は参照で比べ、その他の項目は書き換えられても内容で検出する', async () => {
  stored = { revision: 3, data: { ...initialState(), history: [] } };
  const loaded = (await loadState()).data;
  const appended = { ...loaded, history: [...loaded.history] };
  await saveState(appended, 3, 'same-history-content');
  expect(Object.keys(commits()[0].changes as object)).toEqual(['history']);
  // An in-place edit of an unchanged reference is still saved.
  appended.settings.block = 30;
  await saveState(appended, 4, 'in-place');
  expect(commits()[1].changes).toEqual({ settings: appended.settings });
  expect(stored!.data).toEqual(appended);
});

it('基準の版が一致しない場合は保存済みの内容を読み直してから差分を作る', async () => {
  stored = { revision: 9, data: initialState() };
  const state = { ...initialState(), step: 1 };
  await saveState(state, 9, 'without-load');
  expect(calls[0].command).toBe('load_state');
  expect(commits()[0].changes).toMatchObject({ step: 1 });
  expect(stored!.data).toEqual(state);
});
