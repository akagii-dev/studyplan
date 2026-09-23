import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { settingsEnvelope, DEMO_KEY } from '../settings-ui-baseline/after-fixtures.mjs';

const url = 'http://127.0.0.1:4175/studyplan/';
const out = new URL('./', import.meta.url);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
async function contextFor(width, kind = 'empty') {
  const context = await browser.newContext({
    viewport: { width, height: width === 390 ? 844 : 800 },
    isMobile: width === 390, hasTouch: width === 390,
  });
  if (kind !== 'empty') {
    await context.addInitScript(([key, value]) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
    }, [DEMO_KEY, settingsEnvelope(kind)]);
  }
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  return { context, page };
}
async function metrics(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1), bottom: +r.bottom.toFixed(1) };
    };
    return {
      mainText: main?.innerText,
      mainTextChars: main?.innerText.length,
      buttons: [...main.querySelectorAll('button')].map((b) => ({ text: b.innerText.trim(), rect: rect(b) })),
      headings: [...main.querySelectorAll('h1,h2,h3')].map((h) => ({ text: h.innerText, rect: rect(h) })),
      details: [...main.querySelectorAll('details')].map((d) => ({ text: d.querySelector('summary')?.innerText, rect: rect(d.querySelector('summary')), fontSize: getComputedStyle(d.querySelector('summary')).fontSize })),
      alerts: [...document.querySelectorAll('[role="alert"]')].map((a) => a.innerText),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      navTop: rect(document.querySelector('.sidebar'))?.y,
    };
  });
}
function screenshot(page, name, fullPage = false) {
  return page.screenshot({ path: fileURLToPath(new URL(name, out)), fullPage });
}
for (const width of [390, 1280]) {
  for (const kind of ['empty', 'partial', 'ready-unconfirmed', 'schedule-none', 'invalid-block']) {
    const { context, page } = await contextFor(width, kind);
    const first = await metrics(page);
    await screenshot(page, `${kind}-${width}-home.png`);
    await page.getByRole('button', { name: '設定', exact: true }).click();
    const settings = await metrics(page);
    await screenshot(page, `${kind}-${width}-settings.png`);
    await screenshot(page, `${kind}-${width}-settings-full.png`, true);
    results.push({ width, kind, first, settings });
    await context.close();
  }
}
writeFileSync(new URL('audit.json', out), JSON.stringify(results, null, 2));
await browser.close();
