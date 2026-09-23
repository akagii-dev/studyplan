import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { DEMO_KEY, settingsEnvelope } from '../settings-ui-baseline/after-fixtures.mjs';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
const url = 'http://127.0.0.1:4175/studyplan/';
async function start(kind, width) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 800 } });
  await context.addInitScript(([key, env]) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(env));
  }, [DEMO_KEY, settingsEnvelope(kind)]);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  return { context, page };
}
async function capture(caseName, stage, page, width) {
  results.push({ caseName, stage, width,
    text: await page.locator('main').innerText(),
    alerts: await page.locator('[role="alert"]').allInnerTexts(),
    focus: await page.evaluate(() => ({
      scrollY, tag: document.activeElement?.tagName,
      text: document.activeElement?.textContent?.trim().slice(0, 80),
      target: document.activeElement?.getAttribute('data-settings-target'),
      rect: document.activeElement?.getBoundingClientRect().toJSON(),
    })),
    saved: await page.evaluate((key) => {
      try { const x = JSON.parse(localStorage.getItem(key)); return { revision: x.revision, windows: x.data.settings.windows.length, scheduleAnswers: x.data.settings.scheduleAnswers }; }
      catch (e) { return String(e); }
    }, DEMO_KEY),
  });
}
const shot = (page, name) => page.screenshot({ path: fileURLToPath(new URL(name, import.meta.url)) });
for (const width of [390, 1280]) {
  for (const [kind, button] of [
    ['empty', '試験を追加'], ['partial', '教材を追加'], ['empty', '時間枠を設定'],
  ]) {
    const { context, page } = await start(kind, width);
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: button, exact: true }).click();
    await capture('direct-input', button, page, width);
    await shot(page, `direct-${kind}-${button}-${width}.png`);
    await context.close();
  }
  {
    const { context, page } = await start('ready-unconfirmed', width);
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: '時間枠を設定' }).click();
    await capture('delete', 'availability', page, width);
    const deleteButton = page.getByRole('button', { name: /夕方.*を削除/ }).first();
    await deleteButton.click();
    await capture('delete', 'prompt', page, width);
    await shot(page, `delete-prompt-${width}.png`);
    await page.getByRole('button', { name: 'やめる' }).click();
    await capture('delete', 'cancel', page, width);
    await page.reload({ waitUntil: 'networkidle' });
    await capture('delete', 'cancel reload', page, width);
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: '時間枠を設定' }).click();
    await page.getByRole('button', { name: /夕方.*を削除/ }).first().click();
    await page.getByRole('button', { name: '削除する' }).click();
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await capture('delete', 'confirmed settings', page, width);
    await shot(page, `delete-confirmed-${width}.png`);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await capture('delete', 'confirmed reload', page, width);
    await context.close();
  }
}
writeFileSync(new URL('regressions.json', import.meta.url), JSON.stringify(results, null, 2));
await browser.close();
