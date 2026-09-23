import { chromium } from '@playwright/test';
import { dailyFlowFixture } from '../../scripts/daily-flow-fixture.mjs';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const out = 'docs/ux-after-eval';
async function open(options, change) {
  const fixture = dailyFlowFixture(options);
  if (change) change(fixture);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(({ value }) => {
    if (!localStorage.getItem('studyplan-demo-state-v1')) localStorage.setItem('studyplan-demo-state-v1', value);
  }, { value: JSON.stringify({ revision: 1, data: fixture.state }) });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/studyplan/', { waitUntil: 'networkidle' });
  return { page, context, ...fixture };
}
async function text(page) { return (await page.locator('body').innerText()).replaceAll('\n', ' / '); }
async function recordFive(page) {
  await page.getByRole('textbox', { name: '民法過去問 1周目の実績（問）' }).fill('5');
  await page.getByRole('button', { name: '記録', exact: true }).click();
}
try {
  {
    const { page, context } = await open({ capacity: 20 });
    await recordFive(page);
    console.log('CAPACITY_TODAY', await text(page));
    await page.getByText('理由', { exact: true }).click();
    console.log('CAPACITY_REASON', await text(page));
    await page.screenshot({ path: `${out}/loop3-capacity-reason.png`, fullPage: true });
    await page.getByRole('button', { name: '今後の予定', exact: true }).click();
    await page.getByText('理由', { exact: true }).click();
    console.log('CAPACITY_FUTURE', await text(page));
    await page.screenshot({ path: `${out}/loop3-capacity-future.png`, fullPage: true });
    await context.close();
  }
  {
    const { page, context } = await open({ capacity: 60 }, ({ state, date }) => {
      state.settings.exams[0].target = date;
      state.plan.settingsSnapshot = structuredClone(state.settings);
    });
    await recordFive(page);
    console.log('DEADLINE_TODAY', await text(page));
    await page.getByText('理由', { exact: true }).click();
    console.log('DEADLINE_REASON', await text(page));
    await page.screenshot({ path: `${out}/loop3-deadline-reason.png`, fullPage: true });
    await context.close();
  }
  {
    const { page, context } = await open({ secondBook: true });
    await recordFive(page);
    await page.getByRole('button', { name: '今後の予定', exact: true }).click();
    console.log('NORMAL_FUTURE', await text(page));
    await page.getByRole('button', { name: '設定', exact: true }).click();
    console.log('SETTINGS', await text(page));
    await page.screenshot({ path: `${out}/loop3-settings.png`, fullPage: true });
    await page.getByRole('button', { name: '今日の時間内訳', exact: true }).click();
    console.log('TIME_BREAKDOWN', await text(page));
    await page.screenshot({ path: `${out}/loop3-time-breakdown.png`, fullPage: true });
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: '使い方', exact: true }).click();
    console.log('TUTORIAL', await text(page));
    await page.screenshot({ path: `${out}/loop3-tutorial.png`, fullPage: true });
    await page.getByRole('button', { name: '進捗を記録', exact: true }).click();
    console.log('TUTORIAL_RECORD', await text(page));
    await page.screenshot({ path: `${out}/loop3-tutorial-record.png`, fullPage: true });
    await context.close();
  }
} finally { await browser.close(); }
