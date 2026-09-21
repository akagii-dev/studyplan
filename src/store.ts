import { invoke, isTauri } from '@tauri-apps/api/core';
import { AppState, Envelope, initialState, uid } from './domain/model';
import { demoMode } from './demo';
import { loadDemoState, saveDemoState } from './demoStore';
export async function loadState(): Promise<Envelope> {
  if (isTauri())
    return (await invoke<Envelope | null>('load_state')) ?? { revision: 0, data: initialState() };
  if (demoMode) return loadDemoState(localStorage);
  throw new Error(
    'このアプリはデスクトップ版で起動してください。開発時は pnpm desktop を実行します。',
  );
}
export async function saveState(
  data: AppState,
  expected: number,
  requestId = uid(),
): Promise<Envelope> {
  if (isTauri()) return invoke('commit_state', { data, expected, requestId });
  if (demoMode) return saveDemoState(localStorage, data, expected);
  throw new Error('デスクトップ版が必要です。');
}
export const exportBackup = (path: string) => invoke<void>('export_backup', { path });
export const exportCalendar = (path: string, text: string) =>
  invoke<void>('export_calendar', { path, text });
export const exportMarkdown = (path: string, text: string) =>
  invoke<void>('export_markdown', { path, text });
export const validateBackup = (text: string) => invoke<void>('validate_backup', { text });
export const loadRestorePoint = () =>
  invoke<{ data: AppState; savedAt: string } | null>('load_restore_point');
export const restoreBackup = (expected: number, text?: string) =>
  invoke<Envelope>(text === undefined ? 'undo_restore' : 'restore_backup', {
    expected,
    text,
    requestId: uid(),
  });
