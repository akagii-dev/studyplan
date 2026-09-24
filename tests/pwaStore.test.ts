import { beforeEach, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initialState } from '../src/domain/model';
import { demoInitialState } from '../src/demoStore';
import {
  exportPwaBackup,
  loadPwaRestorePoint,
  loadPwaState,
  restorePwaBackup,
  savePwaState,
  validatePwaBackup,
} from '../src/pwaStore';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

const packet = (data: ReturnType<typeof initialState>) => JSON.stringify({
  format: 'StudyPlanBackup',
  version: 1,
  createdAt: '2026-09-25T00:00:00.000Z',
  appVersion: '0.4.20',
  data,
});

it('空の端末だけ初期状態を返し、保存と再読込で同じ状態を返す', async () => {
  expect(await loadPwaState()).toEqual({ revision: 0, data: initialState() });
  const state = initialState();
  state.theme = 'sky';
  expect(await savePwaState(state, 0, 'write-1')).toEqual({ revision: 1, data: state });
  expect(await loadPwaState()).toEqual({ revision: 1, data: state });
  const backup = JSON.parse(await exportPwaBackup());
  expect(backup.format).toBe('StudyPlanBackup');
  expect(backup.version).toBe(1);
  expect(backup.data).toEqual(state);
});

it('試験・教材・承認済み計画を含む現行保存形式を保持する', async () => {
  const state = demoInitialState('2026-09-25');
  const saved = await savePwaState(state, 0, 'planned');
  expect(saved.data.plan?.sessions.length).toBeGreaterThan(0);
  expect((await loadPwaState()).data).toEqual(state);
  expect(JSON.parse(await exportPwaBackup()).data).toEqual(state);
});

it('同じrequestIdの再送を二重保存せず、競合する改版を拒否する', async () => {
  const first = initialState();
  first.theme = 'sky';
  await savePwaState(first, 0, 'request-1');
  const ignored = initialState();
  ignored.theme = 'lime';
  expect(await savePwaState(first, 0, 'request-1')).toEqual({ revision: 1, data: first });
  await expect(savePwaState(ignored, 0, 'request-1')).rejects.toThrow('異なる内容');
  await expect(savePwaState(ignored, 0, 'request-2')).rejects.toThrow('別の操作');
  expect(await loadPwaState()).toEqual({ revision: 1, data: first });
});

it('異なる画面からの同時保存を単一リビジョンに直列化する', async () => {
  const sky = initialState();
  sky.theme = 'sky';
  const lime = initialState();
  lime.theme = 'lime';
  const results = await Promise.allSettled([
    savePwaState(sky, 0, 'tab-a'),
    savePwaState(lime, 0, 'tab-b'),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  expect((await loadPwaState()).revision).toBe(1);
});

it('完全検証に失敗した保存・復元では正本を変更しない', async () => {
  const state = initialState();
  await savePwaState(state, 0, 'valid');
  const invalid = initialState();
  invalid.records = [{
    id: 'orphan', date: '2026-09-25', materialId: 'missing', round: 0, count: 1,
    cancelled: false, createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z',
  }];
  await expect(savePwaState(invalid, 1, 'invalid')).rejects.toThrow('記録の教材');
  expect(() => validatePwaBackup(packet(invalid))).toThrow('記録の教材');
  await expect(restorePwaBackup(1, 'restore-invalid', packet(invalid))).rejects.toThrow('記録の教材');
  expect(await loadPwaState()).toEqual({ revision: 1, data: state });
  expect(await loadPwaRestorePoint()).toBeNull();
});

it('バックアップ復元と取り消しを正本・復元前の控えと同時に確定する', async () => {
  const original = initialState();
  original.theme = 'sky';
  await savePwaState(original, 0, 'original');
  const imported = initialState();
  imported.theme = 'lime';
  const text = packet(imported);
  validatePwaBackup(text);
  await restorePwaBackup(1, 'restore-1', text);
  expect(await loadPwaState()).toEqual({ revision: 2, data: imported });
  expect((await loadPwaRestorePoint())?.data).toEqual(original);
  await expect(restorePwaBackup(1, 'stale-undo')).rejects.toThrow('別の操作');
  expect((await loadPwaRestorePoint())?.data).toEqual(original);
  await restorePwaBackup(2, 'undo-1');
  expect(await loadPwaState()).toEqual({ revision: 3, data: original });
  expect((await loadPwaRestorePoint())?.data).toEqual(imported);
  expect((await restorePwaBackup(2, 'undo-1')).revision).toBe(3);
});

it('保存済みデータ破損を初期状態と取り違えず、読込エラーにする', async () => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open('studyplan-pwa-v1', 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore('state');
      open.result.createObjectStore('operations');
      open.result.createObjectStore('restore_points');
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => resolve(open.result);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('state', 'readwrite');
    tx.objectStore('state').put({ revision: 9, data: { broken: true } }, 'current');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  await expect(loadPwaState()).rejects.toThrow('保存データの形式が不正');
});
