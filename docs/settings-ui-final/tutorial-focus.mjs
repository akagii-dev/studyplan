import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const target = process.argv[2] === 'meals' ? 'meals' : 'study';
const result = [];
for (const width of [390, 1280]) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 800 } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4175/studyplan/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '設定', exact: true }).click();
  if (target === 'meals') {
    await page.locator('details').first().locator('summary').first().click();
    await page.getByRole('button', { name: '設定・確認' }).first().click();
  } else await page.getByRole('button', { name: '時間枠を設定' }).click();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByRole('button', { name: '使い方' }).click();
  await page.getByRole('button', { name: '勉強できる時間' }).click();
  await page.getByRole('button', { name: '時間枠・時間割へ' }).click();
  const sample = await page.evaluate(() => {
    const h = document.querySelector('h1');
    const r = h.getBoundingClientRect();
    return { scrollY, heading: h?.textContent, headingFocused: document.activeElement === h,
      headingRect: r.toJSON(), active: document.activeElement?.outerHTML.slice(0, 200),
      viewportHeight: innerHeight, viewportWidth: innerWidth };
  });
  result.push({ width, target, sample });
  await page.screenshot({ path: fileURLToPath(new URL(`tutorial-availability-${target}-${width}.png`, import.meta.url)) });
  await context.close();
}
writeFileSync(new URL(`tutorial-focus-${target}.json`, import.meta.url), JSON.stringify(result, null, 2));
await browser.close();
