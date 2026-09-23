import { chromium } from '@playwright/test';
import { dailyFlowFixture } from '../../scripts/daily-flow-fixture.mjs';

const out = 'docs/ux-after-eval';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
async function setup(options) {
  const { state } = dailyFlowFixture(options);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(({ value }) => {
    if (!localStorage.getItem('studyplan-demo-state-v1')) {
      localStorage.setItem('studyplan-demo-state-v1', value);
    }
  }, { value: JSON.stringify({ revision: 1, data: state }) });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/studyplan/', { waitUntil: 'networkidle' });
  return { context, page };
}
function tail(page, n = 1200) {
  return page.locator('body').innerText().then((s) => s.slice(-n).replaceAll('\n', ' / '));
}
try {
  {
    const { context, page } = await setup({ secondBook: true });
    await page.screenshot({ path: `${out}/home.png`, fullPage: true });
    await page.getByRole('textbox', { name: '民法過去問 1周目の実績（問）' }).fill('5');
    await page.getByRole('button', { name: '記録', exact: true }).click();
    console.log('PARTIAL', await tail(page));
    await page.screenshot({ path: `${out}/partial.png`, fullPage: true });
    await page.getByRole('button', { name: '今後の予定', exact: true }).click();
    console.log('PARTIAL_FUTURE', await tail(page));
    await page.screenshot({ path: `${out}/partial-future.png`, fullPage: true });
    await page.getByRole('button', { name: '記録履歴', exact: true }).click();
    await page.getByRole('button', { name: '訂正', exact: true }).click();
    await page.getByRole('textbox', { name: '訂正後の問題数' }).fill('3');
    await page.getByRole('button', { name: '訂正を保存' }).click();
    console.log('CORRECTED', await tail(page));
    await page.getByRole('button', { name: '今後の予定', exact: true }).click();
    console.log('CORRECTED_FUTURE', await tail(page));
    await page.getByRole('button', { name: '記録履歴', exact: true }).click();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '取消を確定' }).click();
    console.log('CANCELLED', await tail(page));
    await page.reload({ waitUntil: 'networkidle' });
    console.log('RELOADED_TODAY', await tail(page));
    await page.getByRole('button', { name: '今後の予定', exact: true }).click();
    console.log('RELOADED_FUTURE', await tail(page));
    await context.close();
  }
  {
    const { context, page } = await setup({ secondBook: true });
    await page.getByText('予定外の学習を記録').click();
    await page.screenshot({ path: `${out}/unplanned-form.png`, fullPage: true });
    await page.getByLabel('問題集').selectOption({ label: '英語読解' });
    await page.getByLabel('追加問数').fill('4');
    await page.getByRole('button', { name: '記録', exact: true }).last().click();
    console.log('UNPLANNED', await tail(page));
    await page.screenshot({ path: `${out}/unplanned-saved.png`, fullPage: true });
    await context.close();
  }
  {
    const { context, page } = await setup({ capacity: 20 });
    await page.getByRole('textbox', { name: '民法過去問 1周目の実績（問）' }).fill('5');
    await page.getByRole('button', { name: '記録', exact: true }).click();
    console.log('CAPACITY_TODAY', await tail(page));
    await page.getByRole('button', { name: '今後の予定', exact: true }).click();
    console.log('CAPACITY_FUTURE', await tail(page));
    await page.screenshot({ path: `${out}/capacity-future.png`, fullPage: true });
    await page.getByText('未配置 1件・10分').click();
    console.log('CAPACITY_DETAIL', await tail(page));
    await page.screenshot({ path: `${out}/capacity-detail.png`, fullPage: true });
    await context.close();
  }
} finally {
  await browser.close();
}
