import { chromium, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/studyplan/';
async function checkRecording(page) {
  await expect(page.locator('.sidebar-bottom')).toContainText(`StudyPlan v${version}`);
  const row = page.locator('.daily-record-row').filter({ hasText: '民法・問題集' });
  const amount = Number((await row.locator('.progress-value').innerText()).match(/あと(\d+)問/)[1]);
  const input = row.getByRole('textbox', { includeHidden: true });
  const summary = row.locator('.daily-record-input summary');
  for (const [index, count] of [amount, 1].entries()) {
    if (index === 1) await summary.press('Enter');
    await input.fill(String(count));
    await row.getByRole('button', { name: '記録', exact: true }).click();
    await expect(summary).toBeFocused();
    await expect(row.locator('.daily-record-input')).not.toHaveAttribute('open', '');
    await expect(input).toBeHidden();
    await expect(row.locator('.progress-value')).toHaveText(index === 0 ? '✅完了' : '✅追加1問');
  }
  await summary.press('Enter'); await input.fill('2'); await summary.press('Enter');
  await expect(input).toBeHidden(); await summary.press('Enter');
  await expect(input).toHaveValue('2');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await row.getByRole('button', { name: '記録', exact: true }).click();
  await expect(summary).toBeFocused(); await expect(input).toBeHidden();
  await expect(row.locator('.progress-value')).toHaveText('✅追加3問');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('studyplan-demo-state-v1')).data);
  await page.reload(); await expect(row.locator('.progress-value')).toHaveText('✅追加3問');
  await expect(input).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('studyplan-demo-state-v1')).data)).toEqual(saved);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto(url, { waitUntil: 'networkidle' });
  if (!response?.ok()) throw new Error(`Demo returned HTTP ${response?.status() ?? 'unknown'}`);
  if (!(await page.getByRole('heading', { name: '今日', level: 1 }).count()))
    throw new Error(`Demo did not initialize: ${await page.locator('body').innerText()}`);
  await expect(page.getByRole('heading', { name: '今日', level: 1 })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '公開デモです。' })).toBeVisible();
  const example = page.locator('.daily-record-row').filter({ hasText: '民法・問題集' });
  await expect(example).toBeVisible();
  await expect(example.locator('.progress-value')).toHaveText(/^あと[1-9]\d*問$/);
  await expect(example.getByRole('textbox', { name: '民法・問題集 1周目の今回解いた問題数（問）' })).toBeVisible();
  await expect(page.getByText('デモ・このブラウザーに保存', { exact: true })).toContainText('このブラウザーに保存');
  await expect(page.locator('nav').getByRole('button', { name: 'バックアップ' })).toHaveCount(0);
  for (const subject of ['民法・問題集', '行政法・問題集', '憲法・問題集']) await expect(page.locator('.daily-record-row').filter({ hasText: subject })).toBeVisible();
  await expect(page.getByLabel('次のターム：', { exact: true })).toHaveValue('民法：意思表示');
  await expect(page.getByLabel('メモ', { exact: true })).toHaveValue('行政法：行政手続法\n憲法：基本的人権');
  await checkRecording(page);
  mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/public-demo-today.png', fullPage: true });
  await page.locator('nav').getByRole('button', { name: '設定' }).click();
  await page.getByLabel('カラーテーマ').selectOption('sky');
  await expect(page.getByRole('status').filter({ hasText: '保存済み' })).toContainText('保存済み');
  await page.reload();
  await page.locator('nav').getByRole('button', { name: '設定' }).click();
  await expect(page.getByLabel('カラーテーマ')).toHaveValue('sky');
  await page.getByRole('button', { name: '週間レポート' }).click();
  await expect(page.getByRole('button', { name: 'デモでは書き出し不可' })).toBeDisabled();
  await page.screenshot({ path: 'test-results/public-demo.png', fullPage: true });
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mobile.on('pageerror', (error) => errors.push(error.message));
  await mobile.goto(url, { waitUntil: 'networkidle' });
  await expect(mobile.locator('.daily-record-row').filter({ hasText: '民法・問題集' })).toBeVisible();
  for (const subject of ['行政法・問題集', '憲法・問題集']) await expect(mobile.locator('.daily-record-row').filter({ hasText: subject })).toBeVisible();
  await expect(mobile.getByLabel('次のターム：', { exact: true })).toHaveValue('民法：意思表示');
  await checkRecording(mobile);
  await mobile.screenshot({ path: 'test-results/public-demo-mobile.png' });
  if (errors.length) throw new Error(`Demo runtime errors: ${errors.join('; ')}`);
  console.log(`Demo smoke passed: ${url}`);
} finally {
  await browser.close();
}
