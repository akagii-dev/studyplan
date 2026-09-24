import { isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { pwaMode } from './pwa';

/** Native file picker or a local browser download name. */
export async function selectSaveDestination(options: Parameters<typeof save>[0]): Promise<string | null> {
  if (isTauri()) return save(options);
  if (pwaMode) {
    if (!options?.defaultPath) throw new Error('保存するファイル名がありません。');
    return options.defaultPath;
  }
  throw new Error('この画面ではファイルを書き出せません。');
}

export function downloadText(filename: string, text: string, mimeType: string): void {
  if (!pwaMode || typeof document === 'undefined') throw new Error('ブラウザーで書き出せません。');
  const name = filename.split(/[\\/]/).pop();
  if (!name) throw new Error('保存するファイル名がありません。');
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
