import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { DEMO_KEY, settingsEnvelope } from '../settings-ui-baseline/after-fixtures.mjs';

const url = 'http://127.0.0.1:4175/studyplan/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
const shot = (page, name) => page.screenshot({ path: fileURLToPath(new URL(name, import.meta.url)) });
async function capture(caseName, stage, page) {
  results.push({ caseName, stage, text: await page.locator('main').innerText(),
    alerts: await page.locator('[role="alert"]').allInnerTexts(),
    buttons: await page.getByRole('button').allInnerTexts(),
    storage: await page.evaluate((key) => { try { const x = JSON.parse(localStorage.getItem(key)); return { revision: x.revision, answers: x.data.settings.scheduleAnswers }; } catch (e) { return String(e); } }, DEMO_KEY),
  });
}
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(([key, env]) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(env));
    window.__uxFailRead = true;
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function(k) { if (k === key && window.__uxFailRead) throw new Error('UX read failure'); return original.call(this, k); };
  }, [DEMO_KEY, settingsEnvelope('partial')]);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await capture('read', 'startup error', page);
  await shot(page, 'read-error.png');
  await page.evaluate(() => { window.__uxFailRead = false; });
  await page.getByRole('button', { name: 'もう一度読み込む' }).click();
  await capture('read', 'retry succeeded', page);
  await shot(page, 'read-retried.png');
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await capture('read', 'saved partial after retry', page);
  await context.close();
}
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(([key, env]) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(env));
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(k, v) { if (k === key) throw new Error('UX save failure'); return original.call(this, k, v); };
  }, [DEMO_KEY, settingsEnvelope('ready-unconfirmed')]);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.locator('details').first().locator('summary').first().click();
  await page.getByRole('button', { name: '予定なし' }).first().click();
  await capture('save', 'change rejected', page);
  await shot(page, 'save-error.png');
  await context.close();
}
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript((key) => localStorage.setItem(key, '{broken'), DEMO_KEY);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await capture('invalid envelope', 'startup error', page);
  await shot(page, 'invalid-envelope.png');
  await context.close();
}
writeFileSync(new URL('faults.json', import.meta.url), JSON.stringify(results, null, 2));
await browser.close();
