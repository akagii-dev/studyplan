import { chromium } from '@playwright/test';
import { dailyFlowFixture } from '../../scripts/daily-flow-fixture.mjs';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const { state } = dailyFlowFixture();
state.proposal = {
  basedOn: state.plan.id,
  reason: '編集中の条件変更',
  unreported: [],
  settingsBase: structuredClone(state.settings),
  plan: structuredClone(state.plan),
};
state.proposal.plan.settingsSnapshot.buffer = 0.1;
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.addInitScript(({ value }) => {
  if (!localStorage.getItem('studyplan-demo-state-v1')) localStorage.setItem('studyplan-demo-state-v1', value);
}, { value: JSON.stringify({ revision: 1, data: state }) });
const page = await context.newPage();
const body = async () => (await page.locator('body').innerText()).replaceAll('\n', ' / ');
try {
  await page.goto('http://127.0.0.1:4173/studyplan/', { waitUntil: 'networkidle' });
  console.log('INITIAL', await body());
  await page.getByRole('textbox', { name: '民法過去問 1周目の実績（問）' }).fill('5');
  await page.getByRole('button', { name: '記録', exact: true }).click();
  console.log('AFTER_RECORD', await body());
  await page.screenshot({ path: 'docs/ux-after-eval/loop3-proposal-record.png', fullPage: true });
  await page.getByRole('button', { name: '計画案を確認', exact: true }).click();
  console.log('PROPOSAL', await body());
  await page.screenshot({ path: 'docs/ux-after-eval/loop3-proposal-old.png', fullPage: true });
  await page.getByRole('button', { name: '現在の残数から案を作り直す', exact: true }).click();
  console.log('REFRESHED_PROPOSAL', await body());
  await page.screenshot({ path: 'docs/ux-after-eval/loop3-proposal-refreshed.png', fullPage: true });
  await page.getByRole('button', { name: 'この内容で更新', exact: true }).click();
  console.log('APPROVED', await body());
  await page.screenshot({ path: 'docs/ux-after-eval/loop3-proposal-approved.png', fullPage: true });
  await page.getByRole('button', { name: '今日', exact: true }).click();
  console.log('BACK_TODAY', await body());
  await page.screenshot({ path: 'docs/ux-after-eval/loop3-proposal-resolved-today.png', fullPage: true });
  await page.reload({ waitUntil: 'networkidle' });
  console.log('RELOADED_TODAY', await body());
} finally {
  await context.close();
  await browser.close();
}
