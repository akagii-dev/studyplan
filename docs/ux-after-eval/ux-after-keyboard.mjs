import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dailyFlowFixture } from '../../scripts/daily-flow-fixture.mjs';

const { state } = dailyFlowFixture({ secondBook: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 320, height: 800 } });
  await context.addInitScript(({ value }) => {
    if (!localStorage.getItem('studyplan-demo-state-v1')) {
      localStorage.setItem('studyplan-demo-state-v1', value);
    }
  }, { value: JSON.stringify({ revision: 1, data: state }) });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/studyplan/', { waitUntil: 'networkidle' });
  console.log('WIDTHS', await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth })));
  await page.screenshot({ path: 'test-results/ux-after/home-320.png', fullPage: true });
  const axe = await new AxeBuilder({ page }).analyze();
  console.log('AXE', axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target) })));
  const tabs = [];
  for (let i = 0; i < 15; i += 1) {
    await page.keyboard.press('Tab');
    const active = await page.evaluate(() => {
      const a = document.activeElement;
      return { tag: a?.tagName, text: a?.textContent?.trim().slice(0, 45), aria: a?.getAttribute('aria-label') };
    });
    tabs.push(active);
    if (active.aria?.includes('民法過去問')) {
      await page.keyboard.type('5');
      await page.keyboard.press('Enter');
      break;
    }
  }
  console.log('TAB_ORDER', tabs);
  console.log('AFTER_ENTER', (await page.locator('body').innerText()).slice(-900));
  await page.screenshot({ path: 'test-results/ux-after/keyboard-enter-320.png', fullPage: true });
  await page.getByRole('button', { name: '今後の予定', exact: true }).click();
  console.log('FUTURE_320', (await page.locator('body').innerText()).slice(-900));
  console.log('FUTURE_WIDTHS', await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth })));
  await page.screenshot({ path: 'test-results/ux-after/future-320.png', fullPage: true });
  await page.getByRole('button', { name: '記録履歴', exact: true }).click();
  console.log('HISTORY_WIDTHS', await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth })));
  await page.screenshot({ path: 'test-results/ux-after/history-320.png', fullPage: true });
} finally {
  await browser.close();
}
