import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';

// Read-only smoke check of the bundled release; no test backend or development server.
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
  await expect(page.getByRole('heading', { name: '学びを、日々の暮らしに。' })).toBeVisible();
  if (page.url().includes(':1420')) throw new Error('Release is using the development server.');
  await page.locator('nav').getByRole('button', { name: '対話式の初期設定', exact: true }).click();
  await expect(page.locator('.question-card')).toBeVisible();
  mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/release-initial-setup.png', fullPage: true });
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
