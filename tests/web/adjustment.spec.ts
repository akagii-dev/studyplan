import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adjustmentFixture, adjustmentContext } from '../fixtures/adjustment';
import type { AppState } from '../../src/domain/model';
import { activePlanWork } from '../../src/domain/progressAllocation';

test('部分実績から追加・超過・訂正・取消まで、数量と変更詳細を維持する', async ({ page }, info) => {
  await page.clock.install({ time: new Date(adjustmentContext.timestamp) });
  await page.addInitScript((state) => {
    if (!localStorage.getItem('studyplan-demo-state-v1'))
      localStorage.setItem('studyplan-demo-state-v1', JSON.stringify({ revision: 1, data: state }));
  }, adjustmentFixture());
  await page.goto('./');
  const read = () =>
    page.evaluate(
      () => JSON.parse(localStorage.getItem('studyplan-demo-state-v1')!).data as AppState,
    );
  const row = page.locator('.daily-record-row').filter({ hasText: '対象問題集' });
  const result = page.locator('.daily-record-saved');
  for (const [additional, total, todayLeft, future] of [
    [4, 4, 2, 24],
    [2, 6, 0, 24],
    [2, 8, 0, 22],
  ]) {
    await row.getByRole('textbox').fill(String(additional));
    await row.getByRole('textbox').press('Enter');
    await expect(row).toContainText(`${total}/6問`);
    await expect(result).toContainText(total <= 6 ? '予定の変更なし' : '数量 1件');
    const stored = await read();
    const active = activePlanWork(stored, adjustmentContext.date).filter(
      (s) => s.materialId === 'book' && s.round === 0,
    );
    expect(
      active.filter((s) => s.date === adjustmentContext.date).reduce((n, s) => n + s.count, 0),
    ).toBe(todayLeft);
    expect(
      active.filter((s) => s.date > adjustmentContext.date).reduce((n, s) => n + s.count, 0),
    ).toBe(future);
    expect(stored.plan!.shortfalls).toEqual([]);
  }
  await result.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(result).toContainText('6 → 4問');
  await expect(result).not.toContainText('時間 ');
  await expect(result).not.toContainText('別問題集');
  await expect(result).toContainText('同じ教材・周回');
  expect(
    (
      await new AxeBuilder({ page })
        .include('main')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath('adjustment-details.png'), fullPage: true });
  const beforeReload = await read();
  await page.reload();
  expect((await read()).plan).toEqual(beforeReload.plan);
  await page.getByRole('button', { name: '記録履歴', exact: true }).click();
  const first = page.getByRole('row').filter({ hasText: '＋4問' });
  await first.getByRole('button', { name: '訂正', exact: true }).click();
  await page.getByLabel('訂正後の問題数').fill('0');
  await page.getByRole('button', { name: '訂正を保存', exact: true }).click();
  await expect
    .poll(async () => (await read()).records.reduce((n, r) => n + (r.cancelled ? 0 : r.count), 0))
    .toBe(4);
  const quantity = async () =>
    activePlanWork(await read(), adjustmentContext.date)
      .filter((s) => s.materialId === 'book' && s.round === 0)
      .reduce((n, s) => n + s.count, 0);
  expect(await quantity()).toBe(26);
  const zero = page.getByRole('row').filter({ hasText: '＋0問' });
  await zero.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '取消を確定', exact: true }).click();
  await expect.poll(async () => (await read()).records.some((r) => r.cancelled)).toBe(true);
  expect(await quantity()).toBe(26);
  await page.getByRole('button', { name: '今日', exact: true }).click();
  await expect(row).toContainText('4/6問');
  await page.screenshot({ path: info.outputPath('adjustment-corrected.png'), fullPage: true });
});
