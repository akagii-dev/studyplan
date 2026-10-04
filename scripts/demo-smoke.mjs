import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/studyplan/';
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
  const example = page.getByRole('listitem').filter({ hasText: 'サンプル問題集' });
  await expect(example).toBeVisible();
  await expect(example).toContainText(/未報告 \/ [1-9]\d*問/);
  await expect(example.getByRole('textbox', { name: 'サンプル問題集 1周目の実績（問）' })).toBeVisible();
  await expect(page.getByText('デモ・このブラウザーに保存', { exact: true })).toContainText('このブラウザーに保存');
  await expect(page.locator('nav').getByRole('button', { name: 'バックアップ' })).toHaveCount(0);
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
  await expect(mobile.getByRole('listitem').filter({ hasText: 'サンプル問題集' })).toBeVisible();
  await mobile.screenshot({ path: 'test-results/public-demo-mobile.png' });
  if (errors.length) throw new Error(`Demo runtime errors: ${errors.join('; ')}`);
  console.log(`Demo smoke passed: ${url}`);
} finally {
  await browser.close();
}
