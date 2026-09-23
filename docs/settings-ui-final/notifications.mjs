import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { DEMO_KEY, settingsEnvelope } from '../settings-ui-baseline/after-fixtures.mjs';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(([key, value]) => {
  if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
}, [DEMO_KEY, settingsEnvelope('ready-unconfirmed')]);
const page = await context.newPage();
await page.goto('http://127.0.0.1:4175/studyplan/', { waitUntil: 'networkidle' });
const result = [];
async function record(stage) {
  result.push({ stage, text: await page.locator('main').innerText(), storage: await page.evaluate((key) => {
    const { revision, data } = JSON.parse(localStorage.getItem(key));
    return { revision, ignored: Object.keys(data.ignoredWarnings ?? {}), answers: data.settings.scheduleAnswers };
  }, DEMO_KEY) });
}
await page.getByRole('button', { name: '設定', exact: true }).click();
await page.locator('details').first().locator('summary').first().click();
await page.getByRole('button', { name: '予定なし' }).first().click();
await record('one explicit none');
await page.getByRole('button', { name: '計画案を作成' }).click();
await page.getByRole('button', { name: '通知を非表示' }).first().click();
await page.getByRole('button', { name: '設定', exact: true }).click();
await page.locator('details').first().locator('summary').first().click();
await record('notification hidden');
await page.getByRole('button', { name: '通知の管理' }).click();
await page.getByRole('button', { name: /を再表示/ }).first().click();
await page.reload({ waitUntil: 'networkidle' });
await page.getByRole('button', { name: '設定', exact: true }).click();
await page.locator('details').first().locator('summary').first().click();
await record('redisplayed after reload');
writeFileSync(new URL('notifications.json', import.meta.url), JSON.stringify(result, null, 2));
await context.close();
await browser.close();
