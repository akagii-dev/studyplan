import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/studyplan/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.error(`Demo page error: ${error}`));
  const response = await page.goto(url, { waitUntil: 'networkidle' });
  if (!response?.ok()) throw new Error(`Demo returned HTTP ${response?.status() ?? 'unknown'}`);
  if (!(await page.getByRole('heading', { name: 'ホーム', level: 1 }).count()))
    throw new Error(`Demo did not initialize: ${await page.locator('body').innerText()}`);
  await expect(page.getByRole('heading', { name: 'ホーム', level: 1 })).toBeVisible();
  await expect(page.getByText('公開デモです。')).toBeVisible();
  await expect(page.locator('.local-indicator')).toContainText('このブラウザーに保存');
  await expect(page.locator('nav').getByRole('button', { name: 'バックアップ' })).toHaveCount(0);
  await page.getByLabel('カラーテーマ').selectOption('sky');
  await expect(page.locator('.save-status')).toContainText('保存済み');
  await page.reload();
  await expect(page.getByLabel('カラーテーマ')).toHaveValue('sky');
  await page.locator('nav').getByRole('button', { name: '週間レポート' }).click();
  await expect(page.getByRole('button', { name: 'デモでは書き出し不可' })).toBeDisabled();
  mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/public-demo.png', fullPage: true });
  console.log(`Demo smoke passed: ${url}`);
} finally {
  await browser.close();
}
