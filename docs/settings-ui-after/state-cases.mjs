import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { DEMO_KEY, settingsEnvelope } from '../settings-ui-baseline/after-fixtures.mjs';

const url = 'http://127.0.0.1:4175/studyplan/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const result = [];
const shot = (page, name) => page.screenshot({ path: fileURLToPath(new URL(name, import.meta.url)), fullPage: false });
async function start(kind, width = 390, fault = null) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const envelope = settingsEnvelope(kind === 'study-gap' ? 'ready-unconfirmed' : kind);
  if (kind === 'study-gap') {
    envelope.data.settings.windows[0].to = envelope.data.settings.exams[0].start;
  }
  await context.addInitScript(([key, value]) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
  }, [DEMO_KEY, envelope]);
  if (fault) await context.addInitScript(([key, fault]) => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === key && fault === 'save') throw new Error('UX test save failure');
      return set.call(this, k, v);
    };
  }, [DEMO_KEY, fault]);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  return { context, page };
}
async function state(caseName, stage, page) {
  result.push({ caseName, stage, text: await page.locator('main').innerText(),
    alerts: await page.locator('[role="alert"]').allInnerTexts(),
    pageWidth: await page.evaluate(() => document.documentElement.scrollWidth),
    storage: await page.evaluate((key) => {
      try { const s = JSON.parse(localStorage.getItem(key)); return { revision: s.revision, windows: s.data.settings.windows.length, answers: s.data.settings.scheduleAnswers, ignored: Object.keys(s.data.ignoredWarnings ?? {}) }; }
      catch(e) { return { error: String(e) }; }
    }, DEMO_KEY) });
}
{
  const { context, page } = await start('ready-unconfirmed');
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.locator('details').first().locator('summary').first().click();
  await page.getByRole('button', { name: '予定なし' }).first().click();
  await state('schedule-none-button', 'after', page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.locator('details').first().locator('summary').first().click();
  await state('schedule-none-button', 'reload', page);
  await shot(page, 'schedule-none-after-reload.png');
  await context.close();
}
{
  const { context, page } = await start('ready-unconfirmed');
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByRole('button', { name: '計画案を作成' }).click();
  await page.getByRole('button', { name: '通知を非表示' }).first().click();
  await state('notification', 'after hide', page);
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.locator('details').first().locator('summary').first().click();
  await state('notification', 'settings hidden', page);
  await shot(page, 'notification-settings-hidden.png');
  await page.getByRole('button', { name: '通知の管理' }).click();
  await state('notification', 'notification management', page);
  await shot(page, 'notification-management.png');
  await page.getByRole('button', { name: /を再表示/ }).first().click();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.locator('details').first().locator('summary').first().click();
  await state('notification', 'redisplayed reload', page);
  await context.close();
}
{
  const { context, page } = await start('ready-unconfirmed');
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByRole('button', { name: '時間枠を設定' }).click();
  await state('delete-window', 'availability', page);
  const deleteButton = page.getByRole('button', { name: '削除', exact: true }).first();
  page.on('dialog', async (dialog) => { result.push({ caseName: 'delete-window', stage: 'dialog', text: dialog.message() }); await dialog.accept(); });
  await deleteButton.click();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await state('delete-window', 'after', page);
  await shot(page, 'delete-window-settings.png');
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await state('delete-window', 'reload', page);
  await context.close();
}
{
  const { context, page } = await start('ready-unconfirmed', 390, 'save');
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.locator('details').first().locator('summary').first().click();
  await page.getByRole('button', { name: '予定なし' }).first().click();
  await state('save-error', 'after change', page);
  await shot(page, 'save-error.png');
  await context.close();
}
{
  const { context, page } = await start('study-gap');
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.locator('details').first().locator('summary').first().click();
  await state('study-gap', 'open', page);
  const rows = await page.locator('.settings-row details summary').evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    const css = getComputedStyle(el);
    return { text: el.textContent, x: r.x, y: r.y, width: r.width, height: r.height, fontSize: css.fontSize, lineHeight: css.lineHeight, outline: css.outline, color: css.color, background: css.backgroundColor };
  }));
  result.push({ caseName: 'study-gap', stage: 'summary geometry', rows });
  await page.getByText('期間と影響', { exact: true }).click();
  await state('study-gap', 'period impact open', page);
  await shot(page, 'study-gap-impact.png');
  await context.close();
}
writeFileSync(new URL('state-cases.json', import.meta.url), JSON.stringify(result, null, 2));
await browser.close();
