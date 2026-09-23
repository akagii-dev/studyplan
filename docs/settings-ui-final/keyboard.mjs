import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { DEMO_KEY, settingsEnvelope } from '../settings-ui-baseline/after-fixtures.mjs';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const result = [];
for (const width of [320, 390, 1280]) {
  const fixture = settingsEnvelope('ready-unconfirmed');
  fixture.data.settings.windows[0].to = fixture.data.settings.exams[0].start;
  const context = await browser.newContext({ viewport: { width, height: width === 1280 ? 800 : 844 } });
  await context.addInitScript(([key, value]) => localStorage.setItem(key, JSON.stringify(value)), [DEMO_KEY, fixture]);
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4175/studyplan/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.locator('details').first().locator('summary').first().click();
  const keyboard = [];
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  for (let i = 0; i < 90; i++) {
    await page.keyboard.press('Tab');
    const active = await page.evaluate(() => {
      const e = document.activeElement;
      if (!e || !(e instanceof HTMLElement)) return null;
      const r = e.getBoundingClientRect();
      const c = getComputedStyle(e);
      return { tag: e.tagName, text: e.innerText?.trim().slice(0, 80) ?? '',
        focusVisible: e.matches(':focus-visible'), outline: c.outline, x: r.x, y: r.y, width: r.width, height: r.height };
    });
    if (active?.tag === 'SUMMARY') keyboard.push(active);
    if (active?.text === '期間と影響') {
      await page.screenshot({ path: fileURLToPath(new URL(`focus-period-${width}.png`, import.meta.url)) });
      await page.keyboard.press('Enter');
      break;
    }
  }
  const geometry = await page.evaluate(() => {
    const sel = [...document.querySelectorAll('.settings-row details summary')];
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
      periodOpen: [...document.querySelectorAll('details')].some((x) => x.querySelector('summary')?.textContent === '期間と影響' && x.open),
      footerTop: document.querySelector('.sidebar')?.getBoundingClientRect().top,
      period: sel.find((x) => x.textContent === '期間と影響')?.getBoundingClientRect().toJSON(),
      focus: document.activeElement?.textContent?.trim() };
  });
  await page.screenshot({ path: fileURLToPath(new URL(`period-${width}.png`, import.meta.url)), fullPage: true });
  result.push({ width, keyboard, geometry });
  await context.close();
}
writeFileSync(new URL('keyboard.json', import.meta.url), JSON.stringify(result, null, 2));
await browser.close();
