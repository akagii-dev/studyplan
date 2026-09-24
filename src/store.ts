import { invoke, isTauri } from '@tauri-apps/api/core';
import { AppState, Envelope, initialState, uid } from './domain/model';
import { demoMode } from './demo';
import { loadDemoState, saveDemoState } from './demoStore';
import { pwaMode } from './pwa';
import { downloadText } from './fileSave';
import {
  exportPwaBackup,
  loadPwaRestorePoint,
  loadPwaState,
  restorePwaBackup,
  savePwaState,
  validatePwaBackup,
} from './pwaStore';
export async function loadState(): Promise<Envelope> {
  if (isTauri())
    return (await invoke<Envelope | null>('load_state')) ?? { revision: 0, data: initialState() };
  if (demoMode) return loadDemoState(localStorage);
  if (pwaMode) return loadPwaState();
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
  if (pwaMode) return savePwaState(data, expected, requestId);
  throw new Error('デスクトップ版が必要です。');
}
export async function exportBackup(path: string): Promise<void> {
  if (pwaMode && !isTauri()) {
    if (!path.toLowerCase().endsWith('.studyplan.json'))
      throw new Error('ファイル名の末尾を .studyplan.json にしてください。');
    downloadText(path, await exportPwaBackup(), 'application/json;charset=utf-8');
    return;
  }
  await invoke<void>('export_backup', { path });
}
export async function exportCalendar(path: string, text: string): Promise<void> {
  if (pwaMode && !isTauri()) {
    downloadText(path, text, 'text/calendar;charset=utf-8');
    return;
  }
  await invoke<void>('export_calendar', { path, text });
}
export async function exportMarkdown(path: string, text: string): Promise<void> {
  if (pwaMode && !isTauri()) {
    downloadText(path, text, 'text/markdown;charset=utf-8');
    return;
  }
  await invoke<void>('export_markdown', { path, text });
}
export async function validateBackup(text: string): Promise<void> {
  if (pwaMode && !isTauri()) return validatePwaBackup(text);
  await invoke<void>('validate_backup', { text });
}
export function loadRestorePoint(): Promise<{ data: AppState; savedAt: string } | null> {
  if (pwaMode && !isTauri()) return loadPwaRestorePoint();
  return invoke('load_restore_point');
}
export function restoreBackup(expected: number, text?: string): Promise<Envelope> {
  const requestId = uid();
  if (pwaMode && !isTauri()) return restorePwaBackup(expected, requestId, text);
  return invoke<Envelope>(text === undefined ? 'undo_restore' : 'restore_backup', {
    expected,
    text,
    requestId,
  });
}
