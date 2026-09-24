import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { dailyFlowFixture, showFutureWeek } from './daily-flow-fixture.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/studyplan/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const output = 'test-results/navigation-result-loop2';
mkdirSync(output, { recursive: true });

async function openFixture(width = 390, hash = '', options = {}) {
  const fixture = dailyFlowFixture(options);
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  await context.addInitScript((state) => {
    if (!localStorage.getItem('studyplan-demo-state-v1'))
      localStorage.setItem('studyplan-demo-state-v1', JSON.stringify({ revision: 1, data: state }));
  }, fixture.state);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(`${url}${hash}`, { waitUntil: 'networkidle' });
  return { context, page, fixture };
}

try {
  {
    const { context, page, fixture } = await openFixture();
    await page.getByRole('button', { name: '今後の予定', exact: true }).click();
    await showFutureWeek(page, dailyFlowFixture().tomorrow);
    await page.getByRole('button', { name: new RegExp(`^${fixture.tomorrow} `) }).click();
    await expect(page.getByRole('heading', { name: '詳細カレンダー' })).toBeVisible();
    await expect(page.locator('.day-panel')).toContainText('10問');
    await expect.poll(async () => {
      const bounds = await page.locator('.day-panel').boundingBox();
      return !!bounds && bounds.y < 844 && bounds.y >= -100;
    }).toBe(true);
    const backBounds = await page.locator('.detail-back').boundingBox();
    assert(backBounds && backBounds.y >= 0 && backBounds.y < 844, 'calendar back is visible');
    await expect(page.getByRole('heading', { name: '詳細カレンダー' })).toBeFocused();
    const headingBounds = await page.getByRole('heading', { name: '詳細カレンダー' }).boundingBox();
    console.log(JSON.stringify({ width: 390, calendar: { scrollY: await page.evaluate(() => window.scrollY), headingY: headingBounds?.y, backY: backBounds.y, dayY: (await page.locator('.day-panel').boundingBox())?.y } }));
    await page.screenshot({ path: `${output}/calendar-390.png` });
    await page.getByRole('button', { name: '今後の予定へ戻る' }).click();
    await expect(page.getByRole('heading', { name: '今後の予定' })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(`^${fixture.tomorrow} `) })).toBeFocused();
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: '使い方' }).click();
    await page.getByRole('button', { name: '次の項目' }).click();
    await page.getByRole('button', { name: '次の項目' }).click();
    await expect(page.locator('.tutorial-lesson .eyebrow')).toContainText('3 /');
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: '使い方' }).click();
    await expect(page.locator('.tutorial-lesson .eyebrow')).toContainText('3 /');
    await page.getByRole('button', { name: '設定へ戻る' }).click();
    await expect(page.getByRole('heading', { name: '設定', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '使い方' })).toBeFocused();
    const settingsFocus = await page.getByRole('button', { name: '使い方' }).boundingBox();
    console.log(JSON.stringify({ width: 390, settingsReturn: { scrollY: await page.evaluate(() => window.scrollY), focusY: settingsFocus?.y } }));
    await page.screenshot({ path: `${output}/settings-return-390.png` });
    await context.close();
    console.log('PASS origin navigation, date focus, tutorial state');
  }
  {
    const { context, page, fixture } = await openFixture(1280);
    await page.getByRole('button', { name: '今後の予定', exact: true }).click();
    await showFutureWeek(page, dailyFlowFixture().tomorrow);
    await page.getByRole('button', { name: new RegExp(`^${fixture.tomorrow} `) }).click();
    const panel = await page.locator('.day-panel').boundingBox();
    const back = await page.locator('.detail-back').boundingBox();
    assert(panel && panel.y >= 0 && panel.y < 800, 'desktop selected day is visible');
    assert(back && back.y >= 0 && back.y < 800, 'desktop back is visible');
    const heading = await page.getByRole('heading', { name: '詳細カレンダー' }).boundingBox();
    console.log(JSON.stringify({ width: 1280, calendar: { scrollY: await page.evaluate(() => window.scrollY), headingY: heading?.y, backY: back.y, dayY: panel.y } }));
    await page.screenshot({ path: `${output}/calendar-1280.png` });
    await page.getByRole('button', { name: '今後の予定へ戻る' }).click();
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: '週間レポート' }).click();
    await page.getByRole('button', { name: '設定へ戻る' }).click();
    await expect(page.getByRole('button', { name: '週間レポート' })).toBeFocused();
    const settingsFocus = await page.getByRole('button', { name: '週間レポート' }).boundingBox();
    console.log(JSON.stringify({ width: 1280, settingsReturn: { scrollY: await page.evaluate(() => window.scrollY), focusY: settingsFocus?.y } }));
    await page.screenshot({ path: `${output}/settings-return-1280.png` });
    await context.close();
    console.log('PASS desktop selected day and back visible together');
  }
  {
    const { context, page } = await openFixture(390, '#calendar');
    await expect(page.getByRole('heading', { name: '詳細カレンダー' })).toBeVisible();
    await page.getByRole('button', { name: '今後の予定へ戻る' }).click();
    await expect(page.getByRole('heading', { name: '今後の予定' })).toBeVisible();
    await context.close();
    console.log('PASS direct detail fallback');
  }
  {
    const { context, page } = await openFixture(390, '#today');
    await page.getByRole('button', { name: '今日へ戻る' }).click();
    await expect(page.getByRole('heading', { name: '今日', exact: true })).toBeVisible();
    await context.close();
    console.log('PASS direct today fallback');
  }
  {
    const { context, page, fixture } = await openFixture();
    const target = page.getByRole('listitem').filter({ hasText: '民法過去問' });
    await target.getByRole('textbox').fill('5');
    await target.getByRole('button', { name: '記録', exact: true }).click();
    await expect(page.locator('.daily-record-saved')).toContainText('明日以降を調整 1件');
    const detail = page.locator('.daily-record-saved details');
    await expect(detail).not.toHaveAttribute('open', '');
    await detail.locator('summary').click();
    await expect(detail).toContainText('10 → 15問');
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '今後の予定', exact: true }).click();
    await showFutureWeek(page, dailyFlowFixture().tomorrow);
    await page.getByText('実績による予定調整の履歴').click();
    const receipt = page.locator('.plan-change-history details').first();
    await receipt.locator('summary').click();
    await expect(receipt).toContainText('10 → 15問');
    await page.getByRole('button', { name: '記録履歴', exact: true }).click();
    await page.getByRole('button', { name: '訂正', exact: true }).click();
    await page.getByLabel('訂正後の問題数').fill('8');
    await page.getByRole('button', { name: '訂正を保存' }).click();
    await expect(page.locator('table')).toContainText('＋8問');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '取消を確定' }).click();
    await expect(page.locator('table')).toHaveCount(0);
    await expect(page.locator('.cancelled-records')).toHaveCount(0);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '記録履歴', exact: true }).click();
    await expect(page.locator('table')).toHaveCount(0);
    await expect(page.locator('.cancelled-records')).toHaveCount(0);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('studyplan-demo-state-v1')).data);
    assert.equal(saved.records.length, 1);
    assert.equal(saved.records[0].cancelled, true);
    assert.deepEqual(saved.draft.progressReceipts.map((item) => item.action), ['record', 'correct', 'cancel']);
    assert.deepEqual(saved.draft.progressReceipts.map((item) => item.changes[0].afterCount), [15, 12, 20]);
    assert.equal(saved.plan.sessions.filter((session) => session.date === fixture.tomorrow).reduce((sum, item) => sum + item.count, 0), 20);
    await context.close();
    console.log('PASS saved plan receipts, correction, cancellation archive');
  }
  {
    const { context, page, fixture } = await openFixture(390, '', { fixed: true });
    const target = page.getByRole('listitem').filter({ hasText: '民法過去問' });
    await target.getByRole('textbox').fill('15');
    await target.getByRole('button', { name: '記録', exact: true }).click();
    await expect(page.locator('.daily-adjustment')).toContainText('予定調整に失敗');
    await expect(page.locator('.daily-adjustment')).not.toContainText('計画案を確認');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('studyplan-demo-state-v1')).data);
    assert.equal(saved.records[0].count, 15);
    assert.equal(saved.plan.sessions.find((item) => item.date === fixture.tomorrow).fixed, true);
    assert.equal(saved.draft.progressReceipts[0].status, 'failed');
    await page.locator('.daily-adjustment').getByRole('button', { name: '今後の予定を確認' }).click();
    await expect(page.getByRole('heading', { name: '今後の予定' })).toBeVisible();
    await context.close();
    console.log('PASS adjustment failure is distinct and actionable');
  }
  {
    const { context, page } = await openFixture(390, '#progress');
    await page.locator('.count-choices button').filter({ hasText: '5' }).first().click();
    await page.getByRole('button', { name: '記録する' }).click();
    await expect(page.locator('.progress-result')).toContainText('＋5問を記録');
    await page.locator('.count-choices button').filter({ hasText: '5' }).first().click();
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'studyplan-demo-state-v1') throw new Error('隔離テストの保存失敗');
        return original.call(this, key, value);
      };
    });
    await page.getByRole('button', { name: '記録する' }).click();
    await expect(page.locator('.progress-result')).toContainText('隔離テストの保存失敗');
    await expect(page.locator('.progress-result .progress-receipt')).toHaveCount(0);
    await context.close();
    console.log('PASS a failed save clears the preceding success receipt');
  }
  {
    const { context, page } = await openFixture();
    const target = page.getByRole('listitem').filter({ hasText: '民法過去問' });
    await target.getByRole('textbox').fill('5');
    await target.getByRole('button', { name: '記録', exact: true }).click();
    await page.getByRole('button', { name: '記録履歴', exact: true }).click();
    await page.getByRole('button', { name: '訂正', exact: true }).click();
    await page.getByLabel('訂正後の問題数').fill('8');
    await page.getByRole('button', { name: '訂正を保存' }).click();
    await expect(page.locator('.history-result')).toContainText('記録を訂正');
    await page.getByRole('button', { name: '訂正', exact: true }).click();
    await page.getByLabel('訂正後の問題数').fill('9');
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'studyplan-demo-state-v1') throw new Error('隔離テストの保存失敗');
        return original.call(this, key, value);
      };
    });
    await page.getByRole('button', { name: '訂正を保存' }).click();
    await expect(page.locator('.history-result')).toHaveCount(0);
    await expect(page.getByRole('alert').first()).toContainText('入力し直してください');
    await context.close();
    console.log('PASS a failed correction clears the preceding success message');
  }
  {
    const { context, page, fixture } = await openFixture();
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: '週間レポート' }).click();
    await page.getByRole('button', { name: fixture.date, exact: true }).click();
    await expect(page.getByRole('heading', { name: fixture.date })).toBeFocused();
    await expect(page.locator('.detail-back')).toHaveCount(0);
    await page.getByRole('button', { name: '週間レポートへ戻る' }).click();
    await expect(page.getByRole('button', { name: fixture.date, exact: true })).toBeFocused();
    await page.getByRole('button', { name: '設定へ戻る' }).click();
    await expect(page.getByRole('heading', { name: '設定', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '週間レポート' })).toBeFocused();
    await context.close();
    console.log('PASS report day detail and focus return');
  }
} finally {
  await browser.close();
}
