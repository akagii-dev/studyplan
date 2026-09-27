import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adjustmentFixture, adjustmentContext, restartFixture } from '../fixtures/adjustment';
import type { AppState } from '../../src/domain/model';
import { addDays } from '../../src/domain/model';
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

test('未配置を含む残り26問を指定日から組み直し、破棄と承認を区別する', async ({ page }, info) => {
  if (info.project.name === 'narrow') await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: new Date(adjustmentContext.timestamp) });
  await page.addInitScript((state) => {
    if (!localStorage.getItem('studyplan-demo-state-v1'))
      localStorage.setItem('studyplan-demo-state-v1', JSON.stringify({ revision: 1, data: state }));
  }, restartFixture());
  await page.goto('./');
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('studyplan-demo-state-v1')!).data as AppState);
  const from = addDays(adjustmentContext.date, 3);
  await page.getByRole('button', { name: '今後の予定', exact: true }).click();
  await page.getByText('残量の内訳').click();
  await expect(page.locator('.future-work')).toContainText('残り 26問 = 予定 20問 + 未配置 6問');
  const open = page.getByRole('button', { name: '計画を仕切り直す' });
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('開始日')).toBeFocused();
  await page.getByRole('button', { name: 'やめる' }).click();
  await expect(open).toBeFocused();
  await open.click();
  await expect(page.getByLabel('開始日')).toBeFocused();
  await page.getByLabel('開始日').fill(from);
  await page.getByRole('button', { name: 'この日から案を作成' }).click();
  await expect(page.getByRole('heading', { name: '計画案', exact: true })).toBeVisible();
  await expect(page.locator('.replan-totals')).toContainText('予定 26問 · 未配置 6問 → 0問');
  await expect(page.locator('.impact-list')).toContainText(`${addDays(adjustmentContext.date, 1)}：10問 → 0問`);
  await expect(page.locator('.impact-list')).toContainText(`${addDays(adjustmentContext.date, 2)}：10問 → 0問`);
  let stored = await read();
  expect(stored.plan!.sessions.filter((s) => s.kind === 'study').reduce((sum, s) => sum + s.count, 0)).toBe(20);
  expect(stored.plan!.shortfalls[0].count).toBe(6);
  expect(stored.proposal?.plan.sessions.filter((s) => s.kind === 'study' && s.date >= from).reduce((sum, s) => sum + s.count, 0)).toBe(26);
  await page.screenshot({ path: info.outputPath('restart-proposal.png'), fullPage: true });
  await page.getByRole('button', { name: '案を破棄する' }).click();
  stored = await read();
  expect(stored.proposal).toBeNull();
  expect(stored.plan!.shortfalls[0].count).toBe(6);
  await page.getByRole('button', { name: '今後の予定', exact: true }).click();
  await page.getByRole('button', { name: '計画を仕切り直す' }).click();
  await page.getByLabel('開始日').fill(from);
  await page.getByRole('button', { name: 'この日から案を作成' }).click();
  await page.getByRole('button', { name: 'この内容で更新' }).click();
  await expect(page.getByText('計画を更新し、カレンダーに反映しました')).toBeVisible();
  stored = await read();
  expect(stored.plan?.allocationStart).toBe(from);
  expect(stored.plan?.shortfalls).toEqual([]);
  expect(stored.history).toHaveLength(1);
  expect(stored.records).toHaveLength(1);
  await page.reload();
  expect((await read()).plan?.allocationStart).toBe(from);
  expect((await read()).records).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect((await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
});

test('実績なしの読込と開き続けた翌日の調整を分けて表示する', async ({ page }) => {
  await page.clock.install({ time: new Date(adjustmentContext.timestamp) });
  await page.addInitScript((state) => {
    if (!localStorage.getItem('studyplan-demo-state-v1'))
      localStorage.setItem('studyplan-demo-state-v1', JSON.stringify({ revision: 1, data: state }));
  }, adjustmentFixture());
  await page.goto('./');
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('studyplan-demo-state-v1')!).data as AppState);
  expect((await read()).records).toEqual([]);
  await page.getByRole('button', { name: '今後の予定', exact: true }).click();
  await page.getByRole('button', { name: '前の週' }).click();
  await expect(page.locator('.future-day').filter({ hasText: '対象問題集' }).first()).toContainText('未報告');
  await page.clock.setFixedTime(new Date('2030-10-08T03:00:00.000Z'));
  await page.clock.runFor(60_001);
  await expect.poll(async () => (await read()).plan?.adjustmentBasis?.date).toBe('2030-10-08');
  const adjusted = await read();
  expect(adjusted.records).toEqual([]);
  const book = activePlanWork(adjusted, '2030-10-08').filter((s) => s.materialId === 'book' && s.round === 0);
  expect(book.filter((s) => s.date === '2030-10-08').reduce((sum, s) => sum + s.count, 0)).toBe(6);
  expect(book.filter((s) => s.date > '2030-10-08').reduce((sum, s) => sum + s.count, 0)).toBe(24);
  expect(adjusted.plan?.shortfalls.filter((s) => s.materialId === 'book' && s.round === 0)).toEqual([]);
  await expect(page.locator('.future-reconciliation')).toHaveText('未消化分を調整しました');
  await page.clock.runFor(60_001);
  const repeated = await read();
  expect(repeated.records).toEqual([]);
  expect(repeated.history.length).toBe(adjusted.history.length);
  expect(activePlanWork(repeated, '2030-10-08')).toEqual(activePlanWork(adjusted, '2030-10-08'));
});

test('承認待ちの案がある調整未反映を未来画面で示す', async ({ page }) => {
  await page.clock.install({ time: new Date('2030-10-08T03:00:00.000Z') });
  const state = adjustmentFixture();
  state.proposal = {
    plan: structuredClone(state.plan!), basedOn: state.plan!.id,
    reason: '確認待ちの案', unreported: [],
  };
  await page.addInitScript((seed) => {
    if (!localStorage.getItem('studyplan-demo-state-v1'))
      localStorage.setItem('studyplan-demo-state-v1', JSON.stringify({ revision: 1, data: seed }));
  }, state);
  await page.goto('./');
  await page.getByRole('button', { name: '今後の予定', exact: true }).click();
  await expect(page.locator('.future-reconciliation')).toContainText('調整未反映');
  await expect(page.getByRole('button', { name: '計画案を確認' })).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('studyplan-demo-state-v1')!).data as AppState);
  expect(stored.records).toEqual([]);
  expect(stored.draft.planReconciliation).toMatchObject({ status: 'blocked', reason: 'pending-proposal' });
});

for (const { offset, expected } of [{ offset: 0, expected: 8 }, { offset: 1, expected: 0 }]) {
  test(`今日6問に4問記録後、${offset}日後から仕切り直して今日の残り${expected}問を入力へ引き継ぐ`, async ({ page }, info) => {
    if (info.project.name === 'narrow') await page.setViewportSize({ width: 390, height: 844 });
    const date = adjustmentContext.date;
    await page.clock.install({ time: new Date(`${date}T00:00:00+09:00`) });
    await page.addInitScript((state) => {
      if (!localStorage.getItem('studyplan-demo-state-v1'))
        localStorage.setItem('studyplan-demo-state-v1', JSON.stringify({ revision: 1, data: state }));
    }, adjustmentFixture());
    await page.goto('./');
    const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('studyplan-demo-state-v1')!).data as AppState);
    const row = page.locator('.daily-record-row').filter({ hasText: '対象問題集' }).filter({ hasText: '1周目' });
    await row.getByRole('textbox').fill('4');
    await row.getByRole('button', { name: '記録', exact: true }).click();
    await expect(row).toContainText('4/6問');
    await page.getByRole('button', { name: '今後の予定', exact: true }).click();
    await page.getByRole('button', { name: '計画を仕切り直す', exact: true }).click();
    await page.getByLabel('開始日', { exact: true }).fill(addDays(date, offset));
    await page.getByRole('button', { name: 'この日から案を作成', exact: true }).click();
    await page.getByRole('button', { name: 'この内容で更新', exact: true }).click();
    await expect(page.getByText('計画を更新し、カレンダーに反映しました')).toBeVisible();
    const approved = await read();
    expect(approved.records).toHaveLength(1);
    expect(approved.records[0].count).toBe(4);
    const work = activePlanWork(approved, date).filter((s) => s.materialId === 'book' && s.round === 0);
    expect(work.filter((s) => s.date === date).reduce((n, s) => n + s.count, 0)).toBe(expected);
    expect(work.reduce((n, s) => n + s.count, 0)).toBe(26);
    expect(approved.plan!.shortfalls.filter((s) => s.materialId === 'book' && s.round === 0)).toEqual([]);
    expect(approved.studyDayBaselines?.[date].rows.find((r) => r.materialId === 'book' && r.round === 0)?.count).toBe(6);
    await page.getByRole('button', { name: '今日', exact: true }).click();
    await expect(row).toContainText(`実績 4問 · 今日の残り ${expected}問`);
    await expect(row.locator('.daily-progress-ring')).toHaveCount(0);
    await page.getByRole('button', { name: '今後の予定', exact: true }).click();
    await page.getByRole('button', { name: '詳細カレンダーを見る', exact: true }).click();
    await page.locator('.calendar-toolbar').getByRole('button', { name: '今日', exact: true }).click();
    await page.getByRole('button', { name: '学習量', exact: true }).click();
    const detail = page.locator('.quantity-breakdown section').filter({ hasText: '対象問題集 · 1周目' });
    await expect(detail).toContainText(`今日の残り ${expected}問`);
    await detail.getByRole('button', { name: '記録を確認・追加' }).click();
    await expect(row.getByRole('textbox')).toBeFocused();
    await expect(row.getByRole('textbox')).toHaveValue(String(expected));
    expect((await read()).records).toEqual(approved.records);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath('restart-today.png'), fullPage: true });
    await page.reload();
    await expect(row).toContainText(`実績 4問 · 今日の残り ${expected}問`);
    expect((await read()).records).toEqual(approved.records);
  });
}
