import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { adjustmentDay, adjustmentFixture } from '../fixtures/adjustment';
import { startPwaServer, type PwaServer } from './server';

const browserChannel = process.env.PLAYWRIGHT_CHANNEL || undefined;
const backup = () => JSON.stringify({
  format: 'StudyPlanBackup',
  version: 1,
  createdAt: `${adjustmentDay}T03:00:00.000Z`,
  appVersion: 'pwa-e2e',
  data: adjustmentFixture(),
});

async function openProfile(profile: string, width: number, url: string) {
  const context = await chromium.launchPersistentContext(profile, {
    channel: browserChannel,
    headless: true,
    viewport: { width, height: width === 390 ? 844 : 800 },
    timezoneId: 'Asia/Tokyo',
    serviceWorkers: 'allow',
    acceptDownloads: true,
  });
  const page = context.pages()[0] ?? await context.newPage();
  await page.clock.install({ time: new Date(`${adjustmentDay}T12:00:00+09:00`) });
  await page.goto(url);
  return { context, page };
}

async function importBackup(page: Page, text = backup()) {
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByRole('button', { name: 'バックアップ', exact: true }).click();
  await page.getByLabel('復元するバックアップ').setInputFiles({
    name: '架空の学習.studyplan.json',
    mimeType: 'application/json',
    buffer: Buffer.from(text),
  });
  const confirm = page.getByRole('region', { name: 'バックアップ復元の確認' });
  await expect(confirm).toContainText('教材 2件');
  await confirm.getByLabel('置き換える内容を確認しました').check();
  await confirm.getByRole('button', { name: 'この内容で復元する' }).click();
  await expect(page.getByText('復元しました。', { exact: true })).toBeVisible();
  await expect(page.locator('.save-status')).toContainText('保存済み');
}

async function recordFour(page: Page) {
  await page.getByRole('button', { name: '今日', exact: true }).click();
  const row = page.locator('.daily-record-row').filter({ hasText: '対象問題集' });
  await expect(row).toContainText('6問');
  await row.getByRole('textbox').fill('4');
  await row.getByRole('textbox').press('Enter');
  await expect(row).toContainText('4/6問');
  await expect(page.locator('.save-status')).toContainText('保存済み');
  return row;
}

async function correctAndCancel(page: Page) {
  await page.getByRole('button', { name: '記録履歴', exact: true }).click();
  const record = page.getByRole('row').filter({ hasText: '対象問題集' });
  await record.getByRole('button', { name: '訂正', exact: true }).click();
  await page.getByRole('textbox', { name: '訂正後の問題数' }).fill('2');
  await page.getByRole('button', { name: '訂正を保存' }).click();
  await expect(record).toContainText('＋2問');
  await record.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '取消を確定' }).click();
  await expect(page.getByRole('row').filter({ hasText: '対象問題集' })).toHaveCount(0);
  await expect(page.locator('.save-status')).toContainText('保存済み');
}

async function remainingBookCount(page: Page) {
  return page.evaluate(async (date) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('studyplan-pwa-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const envelope = await new Promise<{ data: { plan: { sessions: { kind: string; materialId: string; date: string; count: number }[] } } }>((resolve, reject) => {
        const request = db.transaction('state', 'readonly').objectStore('state').get('current');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return envelope.data.plan.sessions.filter((session) =>
        session.kind === 'study' && session.materialId === 'book' && session.date > date,
      ).reduce((sum, session) => sum + session.count, 0);
    } finally { db.close(); }
  }, adjustmentDay);
}

test('配信停止中に記録・訂正・取消・書出・復元し、再起動後も残量が正しい', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium');
  let server: PwaServer | undefined;
  let context: BrowserContext | undefined;
  const profile = info.outputPath('profile-offline-actions');
  const width = info.project.name === 'narrow' ? 390 : 1280;
  try {
    server = await startPwaServer();
    const port = server.port;
    let page: Page;
    ({ context, page } = await openProfile(profile, width, server.url));
    await importBackup(page);
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByText('端末とオフライン', { exact: true }).click();
    await expect(page.getByText('オフライン利用の準備ができました')).toBeVisible();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await context.setOffline(true);
    await server.stop();
    server = undefined;

    await recordFour(page);
    // 今日の未実施2問は今日の予定として残る。未来は元の60問−今日予定6問。
    expect(await remainingBookCount(page)).toBe(54);
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: 'バックアップ', exact: true }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'バックアップを保存する' }).click(),
    ]);
    const savedPath = await download.path();
    expect(savedPath).not.toBeNull();
    const saved = readFileSync(savedPath!, 'utf8');
    expect(JSON.parse(saved).data.records.filter((record: { cancelled: boolean }) => !record.cancelled)).toHaveLength(1);

    await page.getByRole('button', { name: '記録履歴', exact: true }).click();
    const record = page.getByRole('row').filter({ hasText: '対象問題集' });
    await record.getByRole('button', { name: '訂正', exact: true }).click();
    await page.getByRole('textbox', { name: '訂正後の問題数' }).fill('2');
    await page.getByRole('button', { name: '訂正を保存' }).click();
    await expect(record).toContainText('＋2問');
    expect(await remainingBookCount(page)).toBe(54);
    await record.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '取消を確定' }).click();
    await expect(page.getByRole('row').filter({ hasText: '対象問題集' })).toHaveCount(0);
    expect(await remainingBookCount(page)).toBe(54);

    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: 'バックアップ', exact: true }).click();
    await page.getByLabel('復元するバックアップ').setInputFiles({
      name: '配信停止中の保存.studyplan.json', mimeType: 'application/json', buffer: Buffer.from(saved),
    });
    const confirm = page.getByRole('region', { name: 'バックアップ復元の確認' });
    await confirm.getByLabel('置き換える内容を確認しました').check();
    await confirm.getByRole('button', { name: 'この内容で復元する' }).click();
    await expect(page.getByText('復元しました。', { exact: true })).toBeVisible();
    expect(await remainingBookCount(page)).toBe(54);
    await page.reload();
    await page.getByRole('button', { name: '今日', exact: true }).click();
    await expect(page.locator('.daily-record-row').filter({ hasText: '対象問題集' })).toContainText('4/6問');
    await page.screenshot({ path: info.outputPath('offline-restored-today.png') });
    await context.close();
    context = undefined;
    ({ context, page } = await openProfile(profile, width, `http://127.0.0.1:${port}/studyplan-pwa/`));
    await expect(page.locator('.daily-record-row').filter({ hasText: '対象問題集' })).toContainText('4/6問');
    expect(await remainingBookCount(page)).toBe(54);
  } finally {
    await context?.close();
    await server?.stop();
  }
});

test('架空バックアップ→記録・訂正・取消をオフラインと実サーバー停止後に保持する', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium');
  let server: PwaServer | undefined;
  let context: BrowserContext | undefined;
  const profile = info.outputPath('profile-offline');
  const width = info.project.name === 'narrow' ? 390 : 1280;
  try {
    server = await startPwaServer();
    const port = server.port;
    let page: Page;
    ({ context, page } = await openProfile(profile, width, server.url));
    await importBackup(page);
    await recordFour(page);
    await correctAndCancel(page);
    await page.getByRole('button', { name: '今日', exact: true }).click();
    const row = page.locator('.daily-record-row').filter({ hasText: '対象問題集' });
    await expect(row).toContainText('未報告');
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByText('端末とオフライン').click();
    await expect(page.getByText('オフライン利用の準備ができました')).toBeVisible();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await context.setOffline(true);
    await page.reload();
    await page.getByRole('button', { name: '今日', exact: true }).click();
    await expect(row).toContainText('未報告');
    await page.screenshot({ path: info.outputPath('offline-today.png') });
    await context.setOffline(false);
    await context.close();
    context = undefined;
    await server.stop();
    server = undefined;
    ({ context, page } = await openProfile(profile, width, `http://127.0.0.1:${port}/studyplan-pwa/`));
    await expect(page.getByRole('heading', { name: '今日', exact: true })).toBeVisible();
    await expect(page.locator('.daily-record-row').filter({ hasText: '対象問題集' })).toContainText('未報告');
    await page.screenshot({ path: info.outputPath('server-stopped-restart.png') });
    await context.close();
    context = undefined;
    server = await startPwaServer(port);
    ({ context, page } = await openProfile(profile, width, server.url));
    await expect(page.locator('.daily-record-row').filter({ hasText: '対象問題集' })).toContainText('未報告');
    await expect(page.locator('.save-status')).toContainText('保存済み');
  } finally {
    await context?.close();
    await server?.stop();
  }
});

test('バックアップを書き出して変更前の状態へ復元し、詳細直リンクから戻れる', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium');
  let server: PwaServer | undefined;
  let context: BrowserContext | undefined;
  const width = info.project.name === 'narrow' ? 390 : 1280;
  try {
    server = await startPwaServer();
    let page: Page;
    ({ context, page } = await openProfile(info.outputPath('profile-backup'), width, server.url));
    await importBackup(page);
    await recordFour(page);
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: 'バックアップ', exact: true }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'バックアップを保存する' }).click(),
    ]);
    const path = await download.path();
    expect(path).not.toBeNull();
    const saved = readFileSync(path!, 'utf8');
    const packet = JSON.parse(saved);
    expect(packet.format).toBe('StudyPlanBackup');
    expect(packet.data.records.filter((record: { cancelled: boolean }) => !record.cancelled)).toHaveLength(1);
    expect(packet.data.records[0].count).toBe(4);
    await correctAndCancel(page);
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: 'バックアップ', exact: true }).click();
    await page.getByLabel('復元するバックアップ').setInputFiles({
      name: '書き出した学習.studyplan.json', mimeType: 'application/json', buffer: Buffer.from(saved),
    });
    const confirm = page.getByRole('region', { name: 'バックアップ復元の確認' });
    await confirm.getByLabel('置き換える内容を確認しました').check();
    await confirm.getByRole('button', { name: 'この内容で復元する' }).click();
    await page.getByRole('button', { name: '今日', exact: true }).click();
    await expect(page.locator('.daily-record-row').filter({ hasText: '対象問題集' })).toContainText('4/6問');
    await page.goto(`${server.url}#calendar`);
    await expect(page.getByRole('heading', { name: '詳細カレンダー' })).toBeVisible();
    await page.getByRole('button', { name: /今後の予定へ戻る/ }).click();
    await expect(page.getByRole('heading', { name: '今後の予定' })).toBeVisible();
    await page.screenshot({ path: info.outputPath('backup-restored-calendar-return.png') });
  } finally {
    await context?.close();
    await server?.stop();
  }
});
