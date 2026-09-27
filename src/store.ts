import { invoke, isTauri } from '@tauri-apps/api/core';
import { AppState, Envelope, initialState, uid } from './domain/model';
import { demoMode } from './demo';
import { loadDemoState, saveDemoState } from './demoStore';
import { lanMode } from './lan';
import { checkedEnvelope, lanCall, loadLanState, saveLanState } from './lanStore';
import { downloadText } from './fileSave';
export async function loadState(): Promise<Envelope> {
  if (isTauri())
    return (await invoke<Envelope | null>('load_state')) ?? { revision: 0, data: initialState() };
  if (demoMode) return loadDemoState(localStorage);
  if (lanMode) return loadLanState();
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
  if (lanMode) return saveLanState(data, expected, requestId);
  throw new Error('デスクトップ版が必要です。');
}
export const exportBackup = async (path: string) => {
  if (!isTauri() && lanMode) {
    const packet = await lanCall<unknown>('export_backup');
    downloadText(path, JSON.stringify(packet, null, 2), 'application/json');
  } else await invoke<void>('export_backup', { path });
};
export const exportCalendar = async (path: string, text: string) => {
  if (!isTauri() && lanMode) downloadText(path, text, 'text/calendar;charset=utf-8');
  else await invoke<void>('export_calendar', { path, text });
};
export const exportMarkdown = async (path: string, text: string) => {
  if (!isTauri() && lanMode) downloadText(path, text, 'text/markdown;charset=utf-8');
  else await invoke<void>('export_markdown', { path, text });
};
export const validateBackup = (text: string) => !isTauri() && lanMode
  ? lanCall<void>('validate_backup', { text }) : invoke<void>('validate_backup', { text });
export const loadRestorePoint = () => !isTauri() && lanMode
  ? lanCall<{ data: AppState; savedAt: string } | null>('load_restore_point')
  : invoke<{ data: AppState; savedAt: string } | null>('load_restore_point');
export const restoreBackup = async (expected: number, text?: string) => {
  const method = text === undefined ? 'undo_restore' : 'restore_backup';
  const args = { expected, text, requestId: uid() };
  return !isTauri() && lanMode
    ? checkedEnvelope(await lanCall<Envelope>(method, args)) : invoke<Envelope>(method, args);
};
export const loadRevision = async (): Promise<number | null> => {
  if (isTauri()) return invoke<number>('revision');
  if (lanMode) return lanCall<number>('revision');
  return null;
};
export const isRevisionConflict = (error: unknown) =>
  String(error).includes('別の操作でデータが更新されました') ||
  (error instanceof Error && 'code' in error && error.code === 'conflict');
