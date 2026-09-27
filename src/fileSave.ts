import { isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { lanMode } from './lan';

/** Native picker on desktop; a browser download filename on LAN. */
export async function selectSaveDestination(options: Parameters<typeof save>[0]): Promise<string | null> {
  if (isTauri()) return save(options);
  if (lanMode) {
    const name = options?.defaultPath?.split(/[\\/]/).pop();
    if (!name) throw new Error('保存するファイル名がありません。');
    return name;
  }
  throw new Error('この画面ではファイルを書き出せません。');
}

export function downloadBlob(filename: string, blob: Blob): void {
  if (!lanMode || typeof document === 'undefined') throw new Error('ブラウザーで書き出せません。');
  const name = filename.split(/[\\/]/).pop();
  if (!name) throw new Error('保存するファイル名がありません。');
  const url = URL.createObjectURL(blob);
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

export function downloadText(filename: string, text: string, mimeType: string): void {
  downloadBlob(filename, new Blob([text], { type: mimeType }));
}
