import { invoke, isTauri } from '@tauri-apps/api/core';
import { AppState, Envelope, initialState, uid } from './domain/model';
import { demoMode } from './demo';
import { loadDemoState, saveDemoState } from './demoStore';
import { lanMode } from './lan';
import { checkedEnvelope, lanCall, loadLanState, saveLanState } from './lanStore';
import { downloadText } from './fileSave';
/**
 * The state stored at `revision`, so desktop saves send only changed top-level keys.
 * Keys are compared by content; the large history is compared plan by plan by reference.
 */
let stored: { revision: number; data: AppState; json: Map<string, string> } | null = null;
const keyJson = (data: AppState) =>
  new Map(Object.entries(data).filter(([key, value]) => key !== 'history' && value !== undefined)
    .map(([key, value]) => [key, JSON.stringify(value)]));
const rememberStored = (envelope: Envelope) => {
  stored = isTauri() ? { ...envelope, json: keyJson(envelope.data) } : null;
};
async function commitDesktop(data: AppState, expected: number, requestId: string) {
  if (stored?.revision !== expected) {
    const current = await invoke<Envelope | null>('load_state');
    rememberStored(current ?? { revision: 0, data: {} as AppState });
  }
  const base = stored!;
  const json = keyJson(data);
  const changes: Record<string, unknown> = {};
  const removed: string[] = [];
  let historyPrefix: number | undefined;
  for (const key of new Set([...Object.keys(base.data), ...Object.keys(data)]) as Set<keyof AppState>) {
    const value = data[key];
    if (value === undefined) {
      if (base.data[key] !== undefined) removed.push(key);
    } else if (key === 'history') {
      if (value === base.data.history) continue;
      // History plans are replaced, never edited in place: send only the changed tail.
      const before = base.data.history ?? [];
      let kept = 0;
      while (kept < before.length && kept < data.history.length && data.history[kept] === before[kept]) kept++;
      changes.history = data.history.slice(kept);
      historyPrefix = kept;
    } else if (json.get(key) !== base.json.get(key)) changes[key] = value;
  }
  const revision = await invoke<number>('commit_state', { expected, requestId, changes, removed, historyPrefix });
  stored = { revision, data, json };
  return { revision, data };
}
export async function loadState(): Promise<Envelope> {
  if (isTauri()) {
    const envelope = await invoke<Envelope | null>('load_state');
    // Nothing is stored yet: the first save sends every key.
    rememberStored(envelope ?? { revision: 0, data: {} as AppState });
    return envelope ?? { revision: 0, data: initialState() };
  }
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
  if (isTauri()) return commitDesktop(data, expected, requestId);
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
  if (!isTauri() && lanMode) return checkedEnvelope(await lanCall<Envelope>(method, args));
  const envelope = await invoke<Envelope>(method, args);
  rememberStored(envelope);
  return envelope;
};
export const loadRevision = async (): Promise<number | null> => {
  if (isTauri()) return invoke<number>('revision');
  if (lanMode) return lanCall<number>('revision');
  return null;
};
export const isRevisionConflict = (error: unknown) =>
  String(error).includes('別の操作でデータが更新されました') ||
  (error instanceof Error && 'code' in error && error.code === 'conflict');
