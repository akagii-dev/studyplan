import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { adjustmentDay, adjustmentFixture } from '../fixtures/adjustment';
import { startPwaServer, type PwaServer } from './server';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const channel = process.env.PLAYWRIGHT_CHANNEL || undefined;
const widthFor = (name: string) => name === 'narrow' ? 390 : 1280;
const demoRoot = resolve(process.env.PWA_TEST_DEMO_ROOT ?? 'dist');

async function open(profile: string, width: number, url: string) {
  const context = await chromium.launchPersistentContext(profile, {
    channel, headless: true, viewport: { width, height: width === 390 ? 844 : 800 },
    timezoneId: 'Asia/Tokyo', serviceWorkers: 'allow', acceptDownloads: true,
  });
  const page = context.pages()[0] ?? await context.newPage();
  await page.clock.install({ time: new Date(`${adjustmentDay}T12:00:00+09:00`) });
  await page.goto(url);
  return { context, page };
}

async function importAndRecord(page: Page) {
  const backup = JSON.stringify({
    format: 'StudyPlanBackup', version: 1, createdAt: `${adjustmentDay}T03:00:00.000Z`,
    appVersion: 'pwa-e2e', data: adjustmentFixture(),
  });
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByRole('button', { name: 'バックアップ', exact: true }).click();
  await page.getByLabel('復元するバックアップ').setInputFiles({
    name: '架空の学習.studyplan.json', mimeType: 'application/json', buffer: Buffer.from(backup),
  });
  const confirm = page.getByRole('region', { name: 'バックアップ復元の確認' });
  await confirm.getByLabel('置き換える内容を確認しました').check();
  await confirm.getByRole('button', { name: 'この内容で復元する' }).click();
  await expect(page.getByText('復元しました。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '今日', exact: true }).click();
  const row = page.locator('.daily-record-row').filter({ hasText: '対象問題集' });
  await row.getByRole('textbox').fill('4');
  await row.getByRole('textbox').press('Enter');
  await expect(row).toContainText('4/6問');
  await expect(page.locator('.save-status')).toContainText('保存済み');
}

async function pwaDetails(page: Page) {
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByText('端末とオフライン', { exact: true }).click();
  await expect(page.getByText('オフライン利用の準備ができました')).toBeVisible();
}

test('キャッシュ欠損を検出し、配信復帰後に修復する', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium');
  let server: PwaServer | undefined;
  let context: BrowserContext | undefined;
  try {
    server = await startPwaServer(0, { demoRoot });
    let page: Page;
    ({ context, page } = await open(info.outputPath('profile-integrity'), widthFor(info.project.name), server.url));
    await importAndRecord(page);
    await pwaDetails(page);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const port = server.port;
    await context.setOffline(true);
    await server.stop();
    server = undefined;
    await page.getByRole('button', { name: '接続・オフラインを再確認' }).click();
    await expect(page.getByText('配信PC：接続できません')).toBeVisible();
    const removed = await page.evaluate(async () => {
      const key = (await caches.keys()).find((name) => name.startsWith('studyplan-pwa-shell-v1-'));
      if (!key) return false;
      const cache = await caches.open(key);
      return cache.delete(new URL('icon-512.png', location.href).href);
    });
    expect(removed).toBe(true);
    const directStatus = await page.evaluate(async () => {
      const key = (await caches.keys()).find((name) => name.startsWith('studyplan-pwa-shell-v1-'))!;
      const cache = await caches.open(key);
      const missing = !(await cache.match(new URL('icon-512.png', location.href).href));
      const ready = await new Promise<boolean>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => resolve(event.data.ready === true);
        navigator.serviceWorker.controller!.postMessage({ type: 'CHECK_OFFLINE' }, [channel.port2]);
      });
      return { missing, ready, online: navigator.onLine };
    });
    expect(directStatus).toEqual({ missing: true, ready: false, online: false });
    await page.getByRole('button', { name: '接続・オフラインを再確認' }).click();
    await expect(page.getByText(/オフライン準備未完了/)).toBeVisible();
    await page.screenshot({ path: info.outputPath('cache-incomplete.png') });
    await context.setOffline(false);
    server = await startPwaServer(port, { demoRoot });
    await page.getByRole('button', { name: '接続・オフラインを再確認' }).click();
    await expect(page.getByText('オフライン利用の準備ができました')).toBeVisible();

    await page.reload();
    await page.getByRole('button', { name: '今日', exact: true }).click();
    await expect(page.locator('.daily-record-row').filter({ hasText: '対象問題集' })).toContainText('4/6問');
  } finally {
    await context?.close();
    await server?.stop();
  }
});

test('同じ配信元のデモはPWAのSWと保存を共有しない', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium');
  let server: PwaServer | undefined;
  let context: BrowserContext | undefined;
  try {
    server = await startPwaServer(0, { demoRoot });
    let page: Page;
    ({ context, page } = await open(info.outputPath('profile-demo-separate'), widthFor(info.project.name), server.url));
    await importAndRecord(page);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const demo = await context.newPage();
    await demo.goto(`http://127.0.0.1:${server.port}/studyplan/`);
    await expect(demo.locator('body')).toContainText('StudyPlan');
    expect(await demo.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null)).toBeNull();
    expect(await demo.evaluate(() => location.pathname)).toBe('/studyplan/');
    await demo.screenshot({ path: info.outputPath('same-origin-demo.png') });
    await page.reload();
    await page.getByRole('button', { name: '今日', exact: true }).click();
    await expect(page.locator('.daily-record-row').filter({ hasText: '対象問題集' })).toContainText('4/6問');
  } finally {
    await context?.close();
    await server?.stop();
  }
});

async function releaseV2(source: string, destination: string) {
  await cp(source, destination, { recursive: true });
  const htmlPath = resolve(destination, 'index.html');
  const workerPath = resolve(destination, 'sw.js');
  const manifestPath = resolve(destination, 'release-files.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    buildId: string; files: { path: string; sha256: string }[];
  };
  const htmlEntry = manifest.files.find((entry) => entry.path === 'index.html');
  const workerEntry = manifest.files.find((entry) => entry.path === 'sw.js');
  if (!htmlEntry || !workerEntry) throw new Error('Release manifest is incomplete');
  const originalHtml = await readFile(htmlPath, 'utf8');
  const newHtml = originalHtml.replace('</head>', '<meta name="test-release" content="2"/></head>');
  const nextHtmlHash = sha256(newHtml);
  let worker = await readFile(workerPath, 'utf8');
  if (!worker.includes(htmlEntry.sha256) || !worker.includes(manifest.buildId))
    throw new Error('SW does not match release manifest');
  const nextBuild = sha256(`${manifest.buildId}:pwa-e2e-second-release`);
  worker = worker.replace(htmlEntry.sha256, nextHtmlHash).replace(manifest.buildId, nextBuild);
  htmlEntry.sha256 = nextHtmlHash;
  workerEntry.sha256 = sha256(worker);
  manifest.buildId = nextBuild;
  await writeFile(htmlPath, newHtml);
  await writeFile(workerPath, worker);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return nextBuild;
}

test('更新版SWを待機後に全タブを閉じて開き直しても記録を保持する', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium');
  let server: PwaServer | undefined;
  let context: BrowserContext | undefined;
  const source = resolve('dist-pwa');
  const first = info.outputPath('release-v1');
  const second = info.outputPath('release-v2');
  const profile = info.outputPath('profile-update');
  await cp(source, first, { recursive: true });
  const nextBuild = await releaseV2(source, second);
  try {
    server = await startPwaServer(0, { root: first });
    const port = server.port;
    let page: Page;
    ({ context, page } = await open(profile, widthFor(info.project.name), server.url));
    await importAndRecord(page);
    await pwaDetails(page);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await server.stop();
    server = await startPwaServer(port, { root: second });
    await page.getByRole('button', { name: '接続・オフラインを再確認' }).click();
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration('/studyplan-pwa/'))?.waiting);
    await expect(page.getByText(/更新があります/)).toBeVisible();
    await page.screenshot({ path: info.outputPath('update-waiting.png') });
    await context.close();
    context = undefined;
    ({ context, page } = await open(profile, widthFor(info.project.name), server.url));
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await expect(page.locator('meta[name="test-release"]')).toHaveAttribute('content', '2');
    await expect(page.locator('.daily-record-row').filter({ hasText: '対象問題集' })).toContainText('4/6問');
    const keys = await page.evaluate(() => caches.keys());
    expect(keys.filter((name) => name.startsWith('studyplan-pwa-shell-v1-'))).toEqual([`studyplan-pwa-shell-v1-${nextBuild}`]);
    await page.screenshot({ path: info.outputPath('updated-data-preserved.png') });
  } finally {
    await context?.close();
    await server?.stop();
  }
});
