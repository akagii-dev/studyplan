import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dailyFlowFixture } from '../../scripts/daily-flow-fixture.mjs';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const out = 'docs/ux-after-eval';
async function open(options, width = 1280) {
  const { state } = dailyFlowFixture(options);
  const context = await browser.newContext({ viewport: { width, height: 800 } });
  await context.addInitScript(({ value }) => {
    if (!localStorage.getItem('studyplan-demo-state-v1')) {
      localStorage.setItem('studyplan-demo-state-v1', value);
    }
  }, { value: JSON.stringify({ revision: 1, data: state }) });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/studyplan/', { waitUntil: 'networkidle' });
  return { page, context };
}
async function body(page) {
  return (await page.locator('body').innerText()).replaceAll('\n', ' / ');
}
async function recordFive(page) {
  await page.getByRole('textbox', { name: '民法過去問 1周目の実績（問）' }).fill('5');
  await page.getByRole('button', { name: '記録', exact: true }).click();
}
try {
  {
    const { page, context } = await open({ capacity: 20 });
    await recordFive(page);
    console.log('SINGLE_TODAY', await body(page));
    await page.screenshot({ path: `${out}/loop2-single-today.png`, fullPage: true });
    await page.getByRole('button', { name: '今後の予定', exact: true }).click();
    console.log('SINGLE_FUTURE', await body(page));
    await page.screenshot({ path: `${out}/loop2-single-future.png`, fullPage: true });
    await context.close();
  }
  {
    const { page, context } = await open({ capacity: 20, secondBook: true });
    await recordFive(page);
    console.log('MULTI_TODAY', await body(page));
    await page.screenshot({ path: `${out}/loop2-multi-today.png`, fullPage: true });
    await page.getByRole('button', { name: '今後の予定', exact: true }).click();
    console.log('MULTI_FUTURE', await body(page));
    await page.screenshot({ path: `${out}/loop2-multi-future.png`, fullPage: true });
    await context.close();
  }
  {
    const { page, context } = await open({ secondBook: true });
    await recordFive(page);
    console.log('NORMAL_TODAY', await body(page));
    await page.getByRole('button', { name: '今後の予定', exact: true }).click();
    console.log('NORMAL_FUTURE', await body(page));
    await page.screenshot({ path: `${out}/loop2-normal-future.png`, fullPage: true });
    await context.close();
  }
  {
    const { page, context } = await open({ capacity: 20, secondBook: true }, 320);
    await page.keyboard.press('Tab');
    console.log('MOBILE_FOCUS', await page.evaluate(() => ({ tag: document.activeElement?.tagName, aria: document.activeElement?.getAttribute('aria-label') })));
    await page.keyboard.type('5');
    await page.keyboard.press('Enter');
    console.log('MOBILE_TODAY', await body(page));
    console.log('MOBILE_WIDTH_TODAY', await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth })));
    console.log('MOBILE_AXE', (await new AxeBuilder({ page }).analyze()).violations.map((item) => item.id));
    await page.screenshot({ path: `${out}/loop2-mobile-today.png`, fullPage: true });
    await page.getByText('理由', { exact: true }).first().click();
    console.log('MOBILE_REASON', await body(page));
    await page.getByRole('button', { name: '予定を確認', exact: true }).click();
    console.log('MOBILE_REVIEW_REACHED', (await body(page)).includes('計画案の確認'));
    await page.getByRole('button', { name: '今日', exact: true }).click();
    await page.getByRole('button', { name: '今後の予定', exact: true }).click();
    console.log('MOBILE_FUTURE', await body(page));
    console.log('MOBILE_WIDTH_FUTURE', await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth })));
    await page.screenshot({ path: `${out}/loop2-mobile-future.png`, fullPage: true });
    await context.close();
  }
} finally {
  await browser.close();
}
