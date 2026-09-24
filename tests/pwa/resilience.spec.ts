import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { adjustmentDay, adjustmentFixture } from '../fixtures/adjustment';
import { startPwaServer, type PwaServer } from './server';

const channel = process.env.PLAYWRIGHT_CHANNEL || undefined;
const fixtureBackup = JSON.stringify({
  format: 'StudyPlanBackup', version: 1, createdAt: `${adjustmentDay}T03:00:00.000Z`,
  appVersion: 'pwa-e2e', data: adjustmentFixture(),
});

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

async function backupPage(page: Page) {
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByRole('button', { name: 'バックアップ', exact: true }).click();
}

async function restore(page: Page, text: string) {
  await page.getByLabel('復元するバックアップ').setInputFiles({
    name: '架空の学習.studyplan.json', mimeType: 'application/json', buffer: Buffer.from(text),
  });
  const confirm = page.getByRole('region', { name: 'バックアップ復元の確認' });
  await confirm.getByLabel('置き換える内容を確認しました').check();
  await confirm.getByRole('button', { name: 'この内容で復元する' }).click();
  await expect(page.getByText('復元しました。', { exact: true })).toBeVisible();
}

async function record(page: Page, count: number) {
  await page.getByRole('button', { name: '今日', exact: true }).click();
  const row = page.locator('.daily-record-row').filter({ hasText: '対象問題集' });
  await row.getByRole('textbox').fill(String(count));
  await row.getByRole('textbox').press('Enter');
  return row;
}

test('無効なバックアップを拒否し、復元取り消しで記録を戻す', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium');
  let server: PwaServer | undefined;
  let context: BrowserContext | undefined;
  try {
    server = await startPwaServer();
    let page: Page;
    ({ context, page } = await open(info.outputPath('profile-undo'), info.project.name === 'narrow' ? 390 : 1280, server.url));
    await backupPage(page);
    await restore(page, fixtureBackup);
    const row = await record(page, 4);
    await expect(row).toContainText('4/6問');
    await backupPage(page);
    await page.getByLabel('復元するバックアップ').setInputFiles({
      name: '壊れた学習.studyplan.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"StudyPlanBackup"}'),
    });
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('region', { name: 'バックアップ復元の確認' })).toHaveCount(0);
    await page.getByRole('button', { name: '今日', exact: true }).click();
    await expect(row).toContainText('4/6問');
    await backupPage(page);
    await restore(page, fixtureBackup); // zero records; previous state stays as undo point
    await page.getByRole('button', { name: '今日', exact: true }).click();
    await expect(row).toContainText('未報告');
    await backupPage(page);
    await page.getByRole('button', { name: '前回の復元前に戻す' }).click();
    const confirm = page.getByRole('region', { name: 'バックアップ復元の確認' });
    await expect(confirm).toContainText('有効な記録 1件');
    await confirm.getByLabel('置き換える内容を確認しました').check();
    await confirm.getByRole('button', { name: 'この内容で復元する' }).click();
    await page.reload();
    await page.getByRole('button', { name: '今日', exact: true }).click();
    await expect(page.locator('.daily-record-row').filter({ hasText: '対象問題集' })).toContainText('4/6問');
    await page.screenshot({ path: info.outputPath('undo-restored.png') });
  } finally {
    await context?.close();
    await server?.stop();
  }
});

test('2タブ競合で古い画面の記録が新しい記録を上書きしない', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium');
  let server: PwaServer | undefined;
  let context: BrowserContext | undefined;
  try {
    server = await startPwaServer();
    let first: Page;
    ({ context, page: first } = await open(info.outputPath('profile-conflict'), info.project.name === 'narrow' ? 390 : 1280, server.url));
    await backupPage(first);
    await restore(first, fixtureBackup);
    const second = await context.newPage();
    await second.clock.install({ time: new Date(`${adjustmentDay}T12:00:00+09:00`) });
    await second.goto(server.url);
    await expect(second.locator('.daily-record-row').filter({ hasText: '対象問題集' })).toContainText('未報告');
    await record(first, 4);
    await expect(first.locator('.daily-record-row').filter({ hasText: '対象問題集' })).toContainText('4/6問');
    await record(second, 2);
    await expect(second.locator('.daily-record-row').filter({ hasText: '対象問題集' }).getByRole('alert'))
      .toContainText('別の操作でデータが更新されました');
    await second.reload();
    await expect(second.locator('.daily-record-row').filter({ hasText: '対象問題集' })).toContainText('4/6問');
    await first.reload();
    await expect(first.locator('.daily-record-row').filter({ hasText: '対象問題集' })).toContainText('4/6問');
    await first.screenshot({ path: info.outputPath('conflict-preserved.png') });
  } finally {
    await context?.close();
    await server?.stop();
  }
});
