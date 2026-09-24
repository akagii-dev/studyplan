import { version as appVersion } from '../package.json';
import { BackupFile, MAX_BACKUP_BYTES, parseBackup } from './domain/backup';
import { backupSchema } from './domain/backupSchema';
import { AppState, Envelope, initialState } from './domain/model';

const DB_NAME = 'studyplan-pwa-v1';
const CURRENT = 'current';
const RESTORE = 'latest';
const STATE = 'state';
const OPERATIONS = 'operations';
const RESTORE_POINTS = 'restore_points';

type RestorePoint = { data: AppState; savedAt: string };
type Operation = { revision: number; expected: number; restore: boolean; fingerprint: string };

function fingerprint(data: AppState | undefined): string {
  if (data === undefined) return 'undo';
  const text = JSON.stringify(data);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${text.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}

function errorMessage(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined')
    return Promise.reject(new Error('このブラウザーでは端末内保存を利用できません。'));
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(STATE);
      db.createObjectStore(OPERATIONS);
      db.createObjectStore(RESTORE_POINTS);
    };
    request.onerror = () => reject(request.error ?? new Error('保存先を開けませんでした。'));
    request.onblocked = () => {
      blocked = true;
      reject(new Error('別の画面が保存先を使用中です。閉じて再試行してください。'));
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
  });
}

function requestValue<T>(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).get(key);
    let value: T | undefined;
    request.onsuccess = () => { value = request.result as T | undefined; };
    tx.oncomplete = () => resolve(value);
    tx.onabort = () => reject(tx.error ?? new Error('保存データを読み取れませんでした。'));
    tx.onerror = () => reject(tx.error ?? new Error('保存データを読み取れませんでした。'));
  });
}

function uniqueIds(items: { id: string }[], label: string): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (!item.id || ids.has(item.id)) throw new Error(`${label}のIDが空か重複しています。`);
    ids.add(item.id);
  }
}

/** Apply the shared backup schema and the reference checks used by the desktop store. */
function validateState(data: AppState): void {
  const packet = {
    format: 'StudyPlanBackup', version: 1, createdAt: new Date().toISOString(), appVersion, data,
  };
  const parsed = backupSchema.safeParse(packet);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path.join('.') || 'ファイル全体';
    throw new Error(`保存データの形式が不正です（${path}）。現在のデータは変更していません。`);
  }
  const checkSettings = (settings: AppState['settings']) => {
    uniqueIds(settings.exams, '試験');
    uniqueIds(settings.materials, '教材');
    uniqueIds(settings.windows, '時間枠');
    uniqueIds(settings.exceptions, '特定日');
    for (const material of settings.materials) {
      if (!settings.exams.some((exam) => exam.id === material.examId))
        throw new Error('教材に対応する試験がありません。');
    }
  };
  const checkPlan = (plan: AppState['plan']) => {
    if (!plan) return;
    const settings = plan.settingsSnapshot ?? data.settings;
    checkSettings(settings);
    uniqueIds(plan.sessions, '予定');
    for (const session of plan.sessions) {
      if (session.end <= session.start) throw new Error('学習予定の開始・終了時刻が不正です。');
      if (!settings.exams.some((exam) => exam.id === session.examId))
        throw new Error('学習予定に対応する試験がありません。');
      if (session.kind === 'study') {
        const material = settings.materials.find((item) => item.id === session.materialId);
        if (!material || material.examId !== session.examId || !material.rounds[session.round])
          throw new Error('学習予定の試験・教材・周回が一致しません。');
      }
    }
  };
  checkSettings(data.settings);
  uniqueIds(data.records, '記録');
  for (const record of data.records) {
    const material = data.settings.materials.find((item) => item.id === record.materialId);
    if (!material || !material.rounds[record.round]) throw new Error('記録の教材・周回が不正です。');
  }
  for (const material of data.settings.materials) {
    for (const [roundIndex, round] of material.rounds.entries()) {
      const count = data.records.reduce((sum, record) =>
        sum + (!record.cancelled && record.materialId === material.id && record.round === roundIndex ? record.count : 0), 0);
      if (round.completed + count > material.total)
        throw new Error('完了数が総問題数を超えています。');
    }
  }
  checkPlan(data.plan);
  data.history.forEach(checkPlan);
  checkPlan(data.proposal?.plan ?? null);
  if (data.resetBackup) validateState(data.resetBackup);
}

function envelope(value: unknown): Envelope {
  if (!value || typeof value !== 'object') throw new Error('保存済みの学習データを読み取れません。');
  const stored = value as Envelope;
  if (!Number.isSafeInteger(stored.revision) || stored.revision < 0)
    throw new Error('保存済みのリビジョンが不正です。');
  validateState(stored.data);
  return stored;
}

export async function loadPwaState(): Promise<Envelope> {
  const db = await openDatabase();
  try {
    const stored = await requestValue<Envelope>(db, STATE, CURRENT);
    return stored === undefined ? { revision: 0, data: initialState() } : envelope(stored);
  } finally { db.close(); }
}

export async function loadPwaRestorePoint(): Promise<RestorePoint | null> {
  const db = await openDatabase();
  try {
    const point = await requestValue<RestorePoint>(db, RESTORE_POINTS, RESTORE);
    if (point === undefined) return null;
    if (!point || typeof point.savedAt !== 'string') throw new Error('復元前のデータを読み取れません。');
    validateState(point.data);
    return point;
  } finally { db.close(); }
}

function parsePwaBackup(text: string): BackupFile {
  const backup = parseBackup(text);
  validateState(backup.data);
  return backup;
}

export function validatePwaBackup(text: string): void {
  parsePwaBackup(text);
}

async function commit(
  data: AppState | undefined,
  expected: number,
  requestId: string,
  restore: boolean,
): Promise<Envelope> {
  if (!Number.isSafeInteger(expected) || expected < 0 || !requestId)
    throw new Error('保存要求の形式が不正です。');
  const content = fingerprint(data);
  if (data !== undefined) validateState(data);
  const db = await openDatabase();
  try {
    return await new Promise<Envelope>((resolve, reject) => {
      const tx = db.transaction([STATE, OPERATIONS, RESTORE_POINTS], 'readwrite');
      let result: Envelope | undefined;
      let failure: Error | undefined;
      const abort = (reason: unknown) => {
        failure = errorMessage(reason);
        tx.abort();
      };
      tx.oncomplete = () => result ? resolve(result) : reject(new Error('保存結果を確認できません。'));
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('端末内へ保存できませんでした。'));
      tx.onerror = () => reject(failure ?? tx.error ?? new Error('端末内へ保存できませんでした。'));
      tx.objectStore(OPERATIONS).get(requestId).onsuccess = (operationEvent) => {
        const operation = (operationEvent.target as IDBRequest).result as Operation | undefined;
        tx.objectStore(STATE).get(CURRENT).onsuccess = (stateEvent) => {
          try {
            const stored = (stateEvent.target as IDBRequest).result;
            const current = stored === undefined ? { revision: 0, data: initialState() } : envelope(stored);
            if (operation !== undefined) {
              if (operation.expected !== expected || operation.restore !== restore || operation.fingerprint !== content)
                throw new Error('同じ保存要求IDで異なる内容が送られました。再読み込みしてやり直してください。');
              result = current;
              return;
            }
            if (current.revision !== expected)
              throw new Error('別の操作でデータが更新されました。再読み込みしてやり直してください。');
            const write = (replacement: AppState) => {
              validateState(replacement);
              const next = { revision: expected + 1, data: replacement };
              if (restore) tx.objectStore(RESTORE_POINTS).put({ data: current.data, savedAt: new Date().toISOString() }, RESTORE);
              tx.objectStore(STATE).put(next, CURRENT);
              tx.objectStore(OPERATIONS).put({ revision: next.revision, expected, restore, fingerprint: content }, requestId);
              result = next;
            };
            if (data !== undefined) write(data);
            else {
              tx.objectStore(RESTORE_POINTS).get(RESTORE).onsuccess = (pointEvent) => {
                try {
                  const point = (pointEvent.target as IDBRequest).result as RestorePoint | undefined;
                  if (!point) throw new Error('復元前のデータがありません。');
                  write(point.data);
                } catch (error) { abort(error); }
              };
            }
          } catch (error) { abort(error); }
        };
      };
    });
  } finally { db.close(); }
}

export const savePwaState = (data: AppState, expected: number, requestId: string) =>
  commit(data, expected, requestId, false);

export async function restorePwaBackup(expected: number, requestId: string, text?: string): Promise<Envelope> {
  const data = text === undefined ? undefined : parsePwaBackup(text).data;
  return commit(data, expected, requestId, true);
}

export async function exportPwaBackup(): Promise<string> {
  const current = await loadPwaState();
  if (current.revision === 0) throw new Error('保存済みの学習データがありません。');
  const backup: BackupFile = {
    format: 'StudyPlanBackup', version: 1, createdAt: new Date().toISOString(), appVersion,
    data: current.data,
  };
  const text = JSON.stringify(backup, null, 2);
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES)
    throw new Error('データが50MBを超えるため、バックアップを書き出せません。');
  parsePwaBackup(text);
  return text;
}
