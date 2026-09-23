import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { DEMO_KEY, settingsEnvelope } from '../settings-ui-baseline/after-fixtures.mjs';
import { writeFileSync } from 'node:fs';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = [];
for (const width of [320, 390, 1280]) {
  const context = await browser.newContext({ viewport: { width, height: width === 1280 ? 800 : 844 } });
  await context.addInitScript(([key, value]) => localStorage.setItem(key, JSON.stringify(value)), [DEMO_KEY, settingsEnvelope('ready-unconfirmed')]);
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4175/studyplan/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.locator('details').first().locator('summary').first().click();
  const result = await new AxeBuilder({ page }).analyze();
  report.push({ width, violations: result.violations.map((v) => ({ id: v.id, impact: v.impact, description: v.description, nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })) })) });
  await context.close();
}
writeFileSync(new URL('axe.json', import.meta.url), JSON.stringify(report, null, 2));
await browser.close();
