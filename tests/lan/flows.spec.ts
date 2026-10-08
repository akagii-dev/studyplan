import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { adjustmentContext, adjustmentFixture, restartFixture } from '../fixtures/adjustment';
import { addDays, type Envelope } from '../../src/domain/model';
import { activePlanWork } from '../../src/domain/progressAllocation';

const base = 'http://127.0.0.1:4182';
const key = 'a'.repeat(64);
const headers = { Authorization: `Bearer ${key}`, Origin: base };
async function call<T>(request: APIRequestContext, method: string, data = {}) {
  const response = await request.post(`${base}/studyplan-lan/api/${method}`, { headers, data });
  const packet = await response.json();
  expect(response.ok(), JSON.stringify(packet)).toBe(true);
  return packet.value as T;
}
const stored = (request: APIRequestContext) => call<Envelope>(request, 'load_state');
async function seed(request: APIRequestContext) {
  const current = await stored(request);
  await call(request, 'restore_backup', { expected: current.revision, requestId: crypto.randomUUID(), text: JSON.stringify({ format: 'StudyPlanBackup', version: 1, createdAt: adjustmentContext.timestamp, appVersion: '0.5.1', data: adjustmentFixture() }) });
}
async function open(page: Page) {
  await page.clock.install({ time: new Date(adjustmentContext.timestamp) });
  await page.goto(`./#key=${key}`);
  await expect(page.getByRole('heading', { name: '今日', exact: true })).toBeVisible();
}
const book = (page: Page) => page.locator('.daily-record-row').filter({ hasText: '対象問題集' });
async function record(page: Page, count: number) {
  if (await book(page).locator('.daily-record-input').getAttribute('open') === null)
    await book(page).locator('.daily-record-input summary').press('Enter');
  await book(page).getByRole('textbox').fill(String(count));
  await book(page).getByRole('button', { name: '記録', exact: true }).click();
  await expect(page.locator('.save-status')).toContainText('Windowsに保存済み');
}
async function counts(request: APIRequestContext, actual: number, today: number, future: number) {
  const state = (await stored(request)).data;
  const records = state.records.filter((r) => r.materialId === 'book' && r.round === 0 && !r.cancelled);
  expect(records.reduce((n, r) => n + r.count, 0)).toBe(actual);
  const work = activePlanWork(state, adjustmentContext.date).filter((s) => s.materialId === 'book' && s.round === 0);
  expect(work.filter((s) => s.date === adjustmentContext.date).reduce((n, s) => n + s.count, 0)).toBe(today);
  expect(work.filter((s) => s.date > adjustmentContext.date).reduce((n, s) => n + s.count, 0)).toBe(future);
  expect(actual + today + future).toBe(30);
}

test.beforeEach(async ({ request }) => seed(request));
test('LAN画面から部分・追加・超過・訂正・取消とバックアップを同じSQLiteへ反映', async ({ page, request }, info) => {
  await open(page);
  for (const [n, actual, today, future] of [[4, 4, 2, 24], [2, 6, 0, 24], [2, 8, 0, 22]]) {
    await record(page, n);
    await expect(book(page)).toContainText(actual > 6 ? `追加${actual-6}問` : actual === 6 ? '完了' : `あと${6-actual}問`);
    await counts(request, actual, today, future);
  }
  await page.getByRole('button', { name: '記録履歴', exact: true }).click();
  const first = page.getByRole('row').filter({ hasText: '＋4問' });
  await first.getByRole('button', { name: '訂正', exact: true }).click();
  await page.getByLabel('訂正後の問題数').fill('0');
  await page.getByRole('button', { name: '訂正を保存', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: '＋0問' })).toBeVisible();
  await counts(request, 4, 2, 24);
  const zero = page.getByRole('row').filter({ hasText: '＋0問' });
  await zero.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '取消を確定', exact: true }).click();
  await expect(zero).toHaveCount(0);
  await counts(request, 4, 2, 24);
  await page.reload();
  await expect(book(page)).toContainText('あと2問');
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByRole('button', { name: 'バックアップ', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'バックアップを保存する', exact: true }).click();
  const file = await downloading;
  const packet = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(packet.data).toEqual((await stored(request)).data);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['studyplan-lan-access-key-v1']);
  expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('lan-backup.png'), fullPage: true });
});

test('同revisionの保存競合で他端末の実績と入力途中の値を失わない', async ({ page, context, request }, info) => {
  await open(page);
  const other = await context.newPage();
  await open(other);
  await book(other).getByRole('textbox').fill('3');
  await record(page, 4);
  await book(other).getByRole('button', { name: '記録', exact: true }).click();
  const recovery = other.getByRole('dialog', { name: '保存状態の確認' });
  await expect(recovery).toContainText('別の端末で更新されました');
  await expect(book(other).getByRole('textbox')).toHaveValue('3');
  await counts(request, 4, 2, 24);
  await other.screenshot({ path: info.outputPath('lan-conflict.png'), fullPage: true });
  await recovery.getByRole('button', { name: '最新の保存内容を読み込む' }).click();
  await expect(recovery).not.toBeVisible();
  await expect(book(other)).toContainText('あと2問');
  await expect(book(other).getByRole('textbox')).toHaveValue('3');
  await record(other, 2);
  await counts(request, 6, 0, 24);
  await book(page).getByRole('textbox').fill('1');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: '最新を読み込む', exact: true })).toBeVisible();
  await expect(book(page).getByRole('textbox')).toHaveValue('1');
  await expect(book(page)).toContainText('あと2問');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '最新を読み込む', exact: true }).click();
  await expect(book(page)).toContainText('完了');
  await expect(book(page).getByRole('textbox', { includeHidden: true })).toBeHidden();
  await book(page).locator('.daily-record-input summary').press('Enter');
  await expect(book(page).getByRole('textbox')).toHaveValue('1');
  await other.close();
});

test('通信断は保存済みにせず、入力とSQLiteを保持し復旧後に読み直せる', async ({ page, context, request }) => {
  await open(page);
  await context.setOffline(true);
  await book(page).getByRole('textbox').fill('4');
  await book(page).getByRole('button', { name: '記録', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '保存状態の確認' })).toBeVisible();
  await expect(page.locator('.save-status')).toHaveText('保存未確認');
  await expect(book(page).getByRole('textbox')).toHaveValue('4');
  expect((await stored(request)).data.records).toHaveLength(0);
  await context.setOffline(false);
  await page.getByRole('button', { name: '最新の保存内容を読み込む' }).click();
  await expect(page.getByRole('dialog', { name: '保存状態の確認' })).not.toBeVisible();
  await record(page, 4);
  await counts(request, 4, 2, 24);
  await page.reload();
  await expect(book(page)).toContainText('あと2問');
});

test('直接カレンダーと戻る導線を狭幅・広幅・キーボードで利用できる', async ({ page }, info) => {
  await open(page);
  await page.goto('./#calendar');
  await expect(page.getByRole('heading', { name: '詳細カレンダー', exact: true })).toBeVisible();
  const back = page.getByRole('button', { name: /^週間予定$/ });
  await back.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '今後の予定', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'カレンダー表示' }).click();
  await expect(back).toBeVisible();
  await back.click();
  await page.clock.runFor(350);
  await page.locator('.page-transition').evaluateAll(elements =>
    Promise.allSettled(elements.flatMap(element => element.getAnimations().map(animation => animation.finished))));
  expect((await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('lan-future.png'), fullPage: true });
});

test('LAN画面の仕切り直し承認で旧未配置を重複させずSQLiteへ保存する', async ({ page, request }) => {
  const before = await stored(request);
  await call(request, 'restore_backup', {
    expected: before.revision, requestId: crypto.randomUUID(),
    text: JSON.stringify({ format: 'StudyPlanBackup', version: 1, createdAt: adjustmentContext.timestamp,
      appVersion: '0.5.1', data: restartFixture() }),
  });
  await open(page);
  const from = addDays(adjustmentContext.date, 3);
  await page.getByRole('button', { name: '今後の予定', exact: true }).click();
  await page.getByText('計画を仕切り直す', { exact: true }).click();
  await page.getByLabel('開始日').fill(from);
  await page.getByRole('button', { name: 'この日から案を作成' }).click();
  await expect(page.locator('.replan-totals')).toContainText('予定 26問 · 未配置 6問 → 0問');
  const preview = (await stored(request)).data;
  expect(preview.plan?.shortfalls[0].count).toBe(6);
  expect(preview.records).toHaveLength(1);
  await page.getByRole('button', { name: 'この内容で更新' }).click();
  await expect(page.getByText('計画を更新し、カレンダーに反映しました')).toBeVisible();
  const approved = (await stored(request)).data;
  expect(approved.plan?.allocationStart).toBe(from);
  expect(approved.plan?.shortfalls).toEqual([]);
  expect(approved.plan?.sessions.filter((s) => s.kind === 'study' && s.date >= from).reduce((n, s) => n + s.count, 0)).toBe(26);
  expect(approved.records).toEqual(preview.records);
  expect(approved.history).toHaveLength(1);
  await page.reload();
  expect((await stored(request)).data.plan?.allocationStart).toBe(from);
});

test('localhostのService Workerは表示ファイルだけを保持しAPIを保存しない', async ({ page, context }) => {
  await open(page);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/studyplan-lan/');
    return !!registration?.active;
  }), { timeout: 15_000 }).toBe(true);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const cached = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith('studyplan-lan-shell-v1-'));
    const paths = (await Promise.all(names.map(async (name) =>
      (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname)))).flat();
    return { names, paths };
  });
  expect(cached.names).toHaveLength(1);
  expect(cached.paths).toContain('/studyplan-lan/index.html');
  expect(cached.paths.some((path) => path.includes('/api/') || path.endsWith('release-files.json'))).toBe(false);
  await context.setOffline(true);
  expect(await page.evaluate(async () => {
    try {
      await fetch('/studyplan-lan/api/load_state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      return false;
    } catch { return true; }
  })).toBe(true);
  await context.setOffline(false);
});

async function holdRecordResponse(page: Page, count: number) {
  let release!: () => void;
  let committed!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { committed = resolve; });
  let held = false;
  await page.route('**/api/commit_state', async (route) => {
    const args = route.request().postDataJSON();
    if (held || !args.data.records.some((entry: { materialId: string; count: number }) => entry.materialId === 'book' && entry.count === count)) {
      await route.continue();
      return;
    }
    held = true;
    const response = await route.fetch();
    committed();
    await gate;
    await route.fulfill({ response });
  });
  return { ready, release };
}

test('LAN記録の応答待ちに画面を往復しても共有busyと入力の保存完了を引き継ぐ', async ({ page, request }) => {
  await open(page);
  await book(page).getByRole('textbox').fill('4');
  const hold = await holdRecordResponse(page, 4);
  try {
    await book(page).getByRole('button', { name: '記録', exact: true }).click();
    await hold.ready;
    expect((await stored(request)).data.records).toHaveLength(1);
    await page.getByRole('button', { name: '記録履歴', exact: true }).click();
    await page.getByRole('button', { name: '過去日の学習を記録' }).click();
    await expect(page.getByLabel('今回解いた問題数')).toBeDisabled();
    await expect(page.getByRole('button', { name: '保存中…', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '今日', exact: true }).click();
    await expect(book(page).getByRole('textbox')).toHaveValue('4');
    await expect(book(page).getByRole('textbox')).toBeDisabled();
    hold.release();
    await expect(book(page).getByRole('textbox')).toBeEnabled();
    await expect(book(page).getByRole('textbox')).toHaveValue('');
    await record(page, 2);
    await counts(request, 6, 0, 24);
    expect((await stored(request)).data.records).toHaveLength(2);
  } finally { hold.release(); }
});

test('LAN過去日記録の応答待ちに別日の対象へ移っても旧完了callbackで対象を戻さない', async ({ page, request }) => {
  const current = await stored(request);
  const firstDay = addDays(adjustmentContext.date, -2);
  const nextDay = addDays(adjustmentContext.date, -1);
  await call(request, 'restore_backup', { expected: current.revision, requestId: crypto.randomUUID(),
    text: JSON.stringify({ format: 'StudyPlanBackup', version: 1, createdAt: adjustmentContext.timestamp,
      appVersion: '0.5.1', data: adjustmentFixture(firstDay) }) });
  await open(page);
  await page.getByRole('button', { name: '記録履歴', exact: true }).click();
  await page.getByRole('button', { name: '過去日の学習を記録' }).click();
  await page.getByLabel('記録対象日').fill(firstDay);
  await page.getByLabel('今回解いた問題数').fill('3');
  await expect(page.locator('.save-status')).toContainText('Windowsに保存済み');
  const hold = await holdRecordResponse(page, 3);
  try {
    await page.getByRole('button', { name: '記録する', exact: true }).click();
    await hold.ready;
    await page.getByRole('button', { name: '今後の予定', exact: true }).click();
    await page.getByRole('button', { name: 'カレンダー表示' }).click();
    await page.getByRole('button', { name: `${nextDay}を表示`, exact: true }).click();
    await page.locator('.day-panel .session-detail').filter({ hasText: '別問題集' }).getByRole('button', { name: '進捗を記録', exact: true }).click();
    hold.release();
    await expect(page.getByRole('heading', { name: '進捗の記録', exact: true })).toBeVisible();
    await expect(page.getByLabel('記録対象日')).toHaveValue(nextDay);
    await expect(page.getByLabel('教材', { exact: true })).toHaveValue('other');
    await expect(page.getByLabel('今回解いた問題数')).toHaveValue('');
    await page.getByLabel('今回解いた問題数').fill('2');
    await page.getByRole('button', { name: '記録する', exact: true }).click();
    await expect(page.locator('.progress-result')).toContainText('＋2問を記録しました');
    const records = (await stored(request)).data.records;
    expect(records).toHaveLength(2);
    expect(records.map(({ date, materialId, count }) => ({ date, materialId, count }))).toEqual([
      { date: firstDay, materialId: 'book', count: 3 }, { date: nextDay, materialId: 'other', count: 2 },
    ]);
  } finally { hold.release(); }
});

test('ターム・メモをLANとSQLiteで共有し、通信断・復元・日付跨ぎでも保持する', async ({ page, context, request }) => {
  await open(page);
  const before = (await stored(request)).data;
  const form = page.getByRole('form', { name: 'ターム・メモ' });
  const memo = form.getByLabel('メモ', { exact: true });
  const note = { nextTerm: '', memo: '判例を確認\n次は錯誤' };
  await memo.fill(note.memo); await form.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(async () => (await stored(request)).data.studyNote).toEqual(note);
  const saved = (await stored(request)).data; delete saved.studyNote; expect(saved).toEqual(before);
  const packet = await call<{ data: Envelope['data'] }>(request, 'export_backup'); expect(packet.data.studyNote).toEqual(note);
  const other = await context.newPage(); await open(other); await expect(other.getByLabel('メモ', { exact: true })).toHaveValue(note.memo); await other.close();
  await context.setOffline(true); await memo.fill('通信断でも保持'); await form.getByRole('button', { name: '保存', exact: true }).click();
  const recovery = page.getByRole('dialog', { name: '保存状態の確認' }); await expect(recovery).toBeVisible();
  await expect(memo).toHaveValue('通信断でも保持'); expect((await stored(request)).data.studyNote).toEqual(note);
  await context.setOffline(false); await recovery.getByRole('button', { name: '最新の保存内容を読み込む' }).click();
  await expect(recovery).toBeHidden(); await expect(memo).toHaveValue('通信断でも保持');
  await form.getByRole('button', { name: '保存', exact: true }).click(); await expect.poll(async () => (await stored(request)).data.studyNote?.memo).toBe('通信断でも保持');
  const current = await stored(request);
  await call(request, 'restore_backup', { expected: current.revision, requestId: crypto.randomUUID(), text: JSON.stringify(packet) });
  await page.reload(); await expect(memo).toHaveValue(note.memo);
  await page.clock.setSystemTime(new Date(`${addDays(adjustmentContext.date, 1)}T12:00:00+09:00`));
  await page.reload(); await expect(memo).toHaveValue(note.memo);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['studyplan-lan-access-key-v1']);
});
