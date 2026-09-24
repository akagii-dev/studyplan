import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../src/pwa', () => ({ pwaMode: true }));

import { downloadText, selectSaveDestination } from '../src/fileSave';

afterEach(() => vi.unstubAllGlobals());

it('PWAではネイティブの保存ダイアログを使わずファイル名を返す', async () => {
  expect(await selectSaveDestination({ defaultPath: 'StudyPlan-2026-09-25.studyplan.json' }))
    .toBe('StudyPlan-2026-09-25.studyplan.json');
});

it('HTTPでも端末内のBlobをダウンロードし、URLを解放する', async () => {
  let blob: Blob | undefined;
  let downloaded = '';
  let clicked = false;
  const revoke = vi.fn();
  vi.stubGlobal('URL', {
    createObjectURL: (value: Blob) => { blob = value; return 'blob:studyplan-test'; },
    revokeObjectURL: revoke,
  });
  vi.stubGlobal('window', { setTimeout: (callback: () => void) => { callback(); return 1; } });
  vi.stubGlobal('document', {
    createElement: () => ({
      href: '',
      hidden: false,
      set download(value: string) { downloaded = value; },
      click: () => { clicked = true; },
      remove: () => {},
    }),
    body: { append: () => {} },
  });
  downloadText('folder\\StudyPlan.studyplan.json', '{"data":true}', 'application/json;charset=utf-8');
  expect(downloaded).toBe('StudyPlan.studyplan.json');
  expect(clicked).toBe(true);
  expect(blob?.type).toBe('application/json;charset=utf-8');
  expect(await blob?.text()).toBe('{"data":true}');
  expect(revoke).toHaveBeenCalledWith('blob:studyplan-test');
});
