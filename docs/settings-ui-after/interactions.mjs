import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { settingsEnvelope, DEMO_KEY } from '../settings-ui-baseline/after-fixtures.mjs';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const output = [];
const url = 'http://127.0.0.1:4175/studyplan/';
const shot = (page, name) => page.screenshot({ path: fileURLToPath(new URL(name, import.meta.url)), fullPage: false });
async function start(kind = 'empty', width = 390, fault = null) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 800 } });
  if (kind !== 'empty') await context.addInitScript(([key, value]) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
  }, [DEMO_KEY, settingsEnvelope(kind)]);
  if (fault) await context.addInitScript(([key, fault]) => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (k) { if (k === key && fault === 'read') throw new Error('UX test read failure'); return get.call(this, k); };
    Storage.prototype.setItem = function (k, v) { if (k === key && fault === 'save') throw new Error('UX test save failure'); return set.call(this, k, v); };
  }, [DEMO_KEY, fault]);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  return { context, page };
}
function record(caseName, stage, page) {
  return page.evaluate(() => ({
    text: document.querySelector('main')?.innerText,
    alerts: [...document.querySelectorAll('[role="alert"]')].map((e) => e.innerText),
    headings: [...document.querySelectorAll('h1,h2,h3')].map((e) => e.innerText),
    width: document.documentElement.scrollWidth,
  })).then((data) => output.push({ caseName, stage, ...data }));
}

{
  const { context, page } = await start();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByRole('button', { name: '計画案を作成' }).click();
  await record('empty', 'plan guard', page);
  await shot(page, 'empty-plan-guard.png');
  for (const name of ['試験を追加', '先に試験を追加', '時間枠を設定']) {
    await page.getByRole('button', { name, exact: true }).click();
    await record('empty', `${name} destination`, page);
    await page.getByRole('button', { name: '設定', exact: true }).click();
  }
  const details = page.locator('details').first();
  await details.locator('summary').first().click();
  await record('empty', 'disclosure open', page);
  await shot(page, 'empty-disclosure.png');
  await context.close();
}
for (const kind of ['ready-unconfirmed', 'schedule-none', 'invalid-block']) {
  const { context, page } = await start(kind);
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.locator('details').first().locator('summary').first().click();
  await record(kind, 'disclosure open', page);
  await shot(page, `${kind}-disclosure.png`);
  await page.getByRole('button', { name: '計画案を作成' }).click();
  await record(kind, 'plan action', page);
  await shot(page, `${kind}-plan-action.png`);
  if (kind === 'invalid-block') {
    await page.getByRole('button', { name: '修正する' }).click();
    await record(kind, 'fix destination', page);
    await shot(page, 'invalid-block-fix-destination.png');
  }
  await context.close();
}
{
  const { context, page } = await start('ready-unconfirmed');
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.locator('details').first().locator('summary').first().click();
  const before = await page.locator('details').first().innerText();
  const dismiss = page.getByRole('button', { name: /無視|非表示/ }).first();
  output.push({ caseName: 'dismiss', stage: 'before', text: before, buttons: await page.locator('details').first().locator('button').allInnerTexts() });
  if (await dismiss.count()) {
    await dismiss.click();
    await record('dismiss', 'after', page);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await record('dismiss', 'after reload', page);
    await shot(page, 'dismiss-after-reload.png');
  }
  await context.close();
}
for (const fault of ['read', 'save']) {
  const { context, page } = await start('empty', 390, fault);
  await record(fault, 'startup', page);
  if (fault === 'save') {
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await record(fault, 'settings', page);
  } else {
    await page.getByText('エラーの詳細').click();
    await record(fault, 'expanded error', page);
  }
  await shot(page, `fault-${fault}.png`);
  await context.close();
}
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript((key) => localStorage.setItem(key, '{broken'), DEMO_KEY);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByText('エラーの詳細').click();
  await record('invalid-envelope', 'expanded error', page);
  await shot(page, 'fault-invalid-envelope.png');
  await context.close();
}
writeFileSync(new URL('interactions.json', import.meta.url), JSON.stringify(output, null, 2));
await browser.close();
