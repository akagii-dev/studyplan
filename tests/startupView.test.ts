import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }));
vi.mock('../src/demo', () => ({ demoMode: true }));

import { Startup } from '../src/components/Startup';

it('デモの読込失敗は原因と再試行を示し、デスクトップ案内に置き換えない', () => {
  const html = renderToStaticMarkup(createElement(Startup, {
    error: 'ブラウザー内のデモデータを読み取れません。',
    loading: false,
    retry: () => {},
  }));
  expect(html).toContain('学習データを開けませんでした');
  expect(html).toContain('ブラウザー内のデモデータを読み取れません。');
  expect(html).toContain('もう一度読み込む');
  expect(html).not.toContain('デスクトップ版で開いてください');
});
