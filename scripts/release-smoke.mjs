import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Release builds ignore STUDYPLAN_TEST_DATA_DIR. Run only in a separate Windows test account.
if (process.env.STUDYPLAN_ISOLATED_WINDOWS_PROFILE !== '1')
  throw new Error('配布版は通常のSQLite保存先を使います。隔離したWindowsテストアカウントでのみSTUDYPLAN_ISOLATED_WINDOWS_PROFILE=1を指定してください。');
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
mkdirSync('.test-data', { recursive: true });
const child = spawn(resolve(process.argv[2] ?? 'release/StudyPlan.exe'), [], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9224',
    WEBVIEW2_USER_DATA_FOLDER: mkdtempSync(resolve('.test-data/release-webview-')),
  },
  windowsHide: true,
  stdio: 'ignore',
});
let browser;
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      browser = await chromium.connectOverCDP('http://127.0.0.1:9224');
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!browser) throw new Error('Release WebView2 did not start.');
  let page;
  for (let attempt = 0; attempt < 60; attempt++) {
    page = browser.contexts().flatMap((c) => c.pages())[0];
    if (page && page.url() !== 'about:blank') break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await expect(page.getByRole('heading', { name: '今日', level: 1 })).toBeVisible();
  await expect(page).toHaveTitle('StudyPlan');
  await expect(page.locator('.brand')).toHaveText('StudyPlan');
  await expect(page.locator('.brand small')).toHaveCount(0);
  await expect(page.locator('.sidebar')).toContainText(`StudyPlan v${version}`);
  const windowTitle = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke('plugin:window|title', { label: 'main' }),
  );
  expect(windowTitle).toBe('StudyPlan');
  if (page.url().includes(':1420')) throw new Error('Release is using the development server.');
  await page.locator('nav').getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.getByRole('region', { name: '基本設定' })).toContainText('0/3');
  await expect(page.getByRole('button', { name: '試験を追加', exact: true })).toBeVisible();
  mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/release-settings.png', fullPage: true });
  await expect(page.getByLabel('表示モード').locator('option')).toHaveText([
    'ライト',
    'ダーク',
    'システム',
  ]);
  const url = page.url();
  await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' }),
  );
  await expect.poll(() => child.exitCode, { timeout: 15000 }).not.toBeNull();
  console.log(
    `Release smoke passed: ${url} (bundled frontend + native SQLite load + normal window close)`,
  );
} finally {
  if (browser) await browser.close();
  if (child.exitCode === null) child.kill();
}
