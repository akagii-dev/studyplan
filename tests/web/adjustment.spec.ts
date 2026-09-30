import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adjustmentFixture, adjustmentContext, restartFixture, legacyRestartFixture, remainingPlacementFixture, elapsedPlacementFixture, pastPlacementFixture } from '../fixtures/adjustment';
import type { AppState } from '../../src/domain/model';
import { addDays } from '../../src/domain/model';
import { activePlanWork } from '../../src/domain/progressAllocation';
import { remainingWork } from '../../src/domain/remainingWork';
import { proposeRemainingAdjustment } from '../../src/domain/planner/proposal';

test('今日の開始前・開始時刻・進行中・終了後を再配置対象にせず、実績入力と数量を保持する', async ({ page }) => {
  const source = elapsedPlacementFixture();
  await page.clock.install({ time: new Date(`${adjustmentContext.date}T08:59:00+09:00`) });
  await page.addInitScript((data) => {
    if (!localStorage.getItem('studyplan-demo-state-v1')) localStorage.setItem('studyplan-demo-state-v1', JSON.stringify({ revision: 1, data }));
  }, source);
  await page.goto('./');
  const row = page.locator('.daily-record-row').filter({ hasText: '対象問題集' });
  for (const time of ['08:59', '09:00', '09:20', '09:21', '09:32']) {
    await page.clock.setFixedTime(new Date(`${adjustmentContext.date}T${time}:00+09:00`));
    await page.clock.runFor(60_001);
    await expect(row).not.toContainText('再配置待ち');
    await expect(row).not.toContainText('配置先を確認');
    await expect(row.getByRole('button', { name: '残りの配置を調整', exact: true })).toHaveCount(0);
    await expect(row.getByRole('textbox')).toBeVisible();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('studyplan-demo-state-v1')!).data as AppState);
    expect(stored.plan).toEqual(source.plan);
    expect(stored.records).toEqual([]);
  }
  await page.getByRole('button', { name: '今後の予定', exact: true }).click();
  await expect(page.getByRole('button', { name: '残りの配置を調整', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '経過済みの未消化分をまとめて調整', exact: true })).toBeDisabled();
  await expect(page.getByText('昨日以前の未消化分は調整済み、またはありません。', { exact: true })).toBeVisible();
});

test('過去の未消化5問だけを一括調整し、今日の開始済み予定・実績・履歴を保持する', async ({ page }, info) => {
  await page.clock.install({ time: new Date(adjustmentContext.timestamp) });
  const source = pastPlacementFixture();
  await page.addInitScript((data) => {
    if (!localStorage.getItem('studyplan-demo-state-v1')) localStorage.setItem('studyplan-demo-state-v1', JSON.stringify({ revision: 1, data }));
    const save = Storage.prototype.setItem;
    let failed = false;
    Storage.prototype.setItem = function (key, value) {
      if (!failed && key === 'studyplan-demo-state-v1') {
        failed = true;
        throw new Error('専用試験：自動反映の保存を一度だけ失敗');
      }
      return save.call(this, key, value);
    };
  }, source);
  await page.goto('./');
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('studyplan-demo-state-v1')!).data as AppState);
  await expect(page.getByRole('alert')).toContainText('専用試験：自動反映の保存を一度だけ失敗');
  const row = page.locator('.daily-record-row').filter({ hasText: '教材B' });
  await expect(row.getByRole('textbox')).toBeVisible();
  await expect(row).not.toContainText('配置先を確認');
  expect((await read()).plan).toEqual(source.plan);
  await page.getByRole('button', { name: '今後の予定', exact: true }).click();
  for (const name of ['計画を仕切り直す', '経過済みの未消化分をまとめて調整', '詳細カレンダーを見る'])
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '残りの配置を調整', exact: true })).toHaveCount(0);
  await expect(page.getByText('配置先を確認', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('future-three-actions.png'), fullPage: true });
  const open = page.getByRole('button', { name: '経過済みの未消化分をまとめて調整', exact: true });
  await open.focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('配置する開始日')).toBeFocused();
  await page.getByRole('button', { name: 'やめる', exact: true }).click();
  await expect(open).toBeFocused();
  await open.click();
  const targets = page.getByRole('list', { name: '調整する対象', exact: true });
  await expect(targets).toContainText('教材B');
  await expect(targets).toContainText('1周目');
  await expect(targets).toContainText('5問');
  await expect(targets).not.toContainText('教材A');
  await expect(page.locator('.remaining-adjustment').getByRole('checkbox')).toHaveCount(0);
  await expect(page.locator('.remaining-adjustment').getByRole('combobox')).toHaveCount(0);
  await page.getByRole('button', { name: '配置案を確認', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'やめる', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '配置案を確認', exact: true }).click();
  const proposal = page.getByRole('region', { name: '選択した残量の配置案' });
  await expect(proposal).toContainText('対象 5問');
  expect((await read()).plan).toEqual(source.plan);
  expect((await read()).records).toEqual(source.records);
  await page.getByRole('button', { name: '案を破棄する', exact: true }).click();
  expect((await read()).plan).toEqual(source.plan);
  await page.getByRole('button', { name: '今後の予定', exact: true }).click();
  await open.click();
  await page.getByRole('button', { name: '配置案を確認', exact: true }).click();
  await page.screenshot({ path: info.outputPath('past-remaining-proposal.png'), fullPage: true });
  expect((await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole('button', { name: 'この内容で更新', exact: true }).click();
  await expect(page.getByText('計画を更新し、カレンダーに反映しました')).toBeVisible();
  const approved = await read();
  expect(approved.records).toEqual(source.records);
  expect(approved.plan!.sessions.find((s) => s.id === 'b-keep')).toEqual(source.plan!.sessions.find((s) => s.id === 'b-keep'));
  expect(approved.plan!.sessions.find((s) => s.id === 'a-done')).toEqual(source.plan!.sessions.find((s) => s.id === 'a-done'));
  expect(remainingWork(approved, adjustmentContext.date).find((r) => r.materialId === 'b')).toMatchObject({ remaining: 10, allocated: 10, unplaced: 0, balanced: true });
  await page.getByRole('button', { name: '今後の予定', exact: true }).click();
  await expect(open).toBeDisabled();
  await expect(page.getByText('昨日以前の未消化分は調整済み、またはありません。', { exact: true })).toBeVisible();
  await page.reload();
  expect((await read()).plan).toEqual(approved.plan);
  expect((await read()).records).toEqual(source.records);
});
test('保存済みの対象5問の部分配置案も実績を作らず承認・再読込できる', async ({ page }, info) => {
  await page.clock.install({ time: new Date(adjustmentContext.timestamp) });
  const source = remainingPlacementFixture();
  source.settings.windows[0].to = addDays(adjustmentContext.date, 1);
  source.settings.windows[0].end = 564;
  source.plan!.settingsSnapshot = structuredClone(source.settings);
  const pending = proposeRemainingAdjustment(source, [{ kind: 'session', sessionId: 'b-target' }], adjustmentContext.date, adjustmentContext);
  await page.addInitScript((data) => {
    if (!localStorage.getItem('studyplan-demo-state-v1')) localStorage.setItem('studyplan-demo-state-v1', JSON.stringify({ revision: 1, data }));
  }, pending);
  await page.goto('./');
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('studyplan-demo-state-v1')!).data as AppState);
  const b = page.locator('.daily-record-row').filter({ hasText: '教材B' });
  await expect(b).toContainText('未報告');
  await expect(b).not.toContainText('配置先を確認');
  await page.getByRole('button', { name: '今後の予定', exact: true }).click();
  await page.getByRole('button', { name: '計画案を確認', exact: true }).click();
  const result = page.getByRole('region', { name: '選択した残量の配置案' });
  await expect(result).toContainText('対象 5問 · 配置 3問 · 未配置 2問');
  await expect(result).toContainText('2030-10-08 09:15〜09:24');
  await expect(result).toContainText('未配置');
  expect((await read()).plan).toEqual(source.plan);
  expect((await read()).records).toEqual(source.records);
  await page.screenshot({ path: info.outputPath('remaining-proposal.png'), fullPage: true });
  expect((await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole('button', { name: 'この内容で更新', exact: true }).click();
  await expect(page.getByText('計画を更新し、カレンダーに反映しました')).toBeVisible();
  const approved = await read();
  expect(approved.records).toEqual(source.records);
  expect(approved.plan!.sessions.find((s) => s.id === 'b-keep')).toEqual(source.plan!.sessions.find((s) => s.id === 'b-keep'));
  expect(remainingWork(approved, adjustmentContext.date).find((r) => r.materialId === 'b')).toMatchObject({ remaining: 10, allocated: 8, unplaced: 2, balanced: true });
  await page.getByRole('button', { name: '今後の予定', exact: true }).click();
  await page.getByText('残量の内訳', { exact: true }).click();
  await expect(page.locator('.future-work')).toContainText(/残り\s*10問.*未配置\s*2問/);
  await page.screenshot({ path: info.outputPath('remaining-destinations.png'), fullPage: true });
  await page.reload();
  expect((await read()).records).toEqual(source.records);
  expect((await read()).plan).toEqual(approved.plan);
});

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
  await expect(page.locator('.future-work')).toContainText(/残り\s*26問.*未配置\s*6問/);
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
  // Yesterday was reconciled; today's 09:00 slot remains today's work at 12:01.
  await expect(page.locator('.future-work')).not.toContainText('再配置待ち');
  await expect(page.getByText('配置先を確認', { exact: true })).toHaveCount(0);
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

test('仕切り直し後の旧未報告教材が今後の予定とカレンダーへ戻らない', async ({ page }, info) => {
  await page.setViewportSize({ width: info.project.name === 'narrow' ? 390 : 1280, height: info.project.name === 'narrow' ? 844 : 800 });
  const date = adjustmentContext.date;
  await page.clock.install({ time: new Date(adjustmentContext.timestamp) });
  await page.addInitScript((state) => {
    if (!localStorage.getItem('studyplan-demo-state-v1'))
      localStorage.setItem('studyplan-demo-state-v1', JSON.stringify({ revision: 1, data: state }));
  }, adjustmentFixture());
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('studyplan-demo-state-v1')!).data as AppState);
  await page.goto('./');
  await page.getByRole('button', { name: '今後の予定', exact: true }).click();
  await page.getByRole('button', { name: '計画を仕切り直す', exact: true }).click();
  await page.getByLabel('開始日', { exact: true }).fill(addDays(date, 1));
  await page.getByRole('button', { name: 'この日から案を作成', exact: true }).click();
  await page.getByRole('button', { name: 'この内容で更新', exact: true }).click();
  await expect(page.getByText('計画を更新し、カレンダーに反映しました')).toBeVisible();
  const approved = await read();
  expect(remainingWork(approved, date)).toMatchObject([
    { total: 30, completed: 0, allocated: 30, unplaced: 0, balanced: true },
    { total: 30, completed: 0, allocated: 30, unplaced: 0, balanced: true },
    { total: 45, completed: 0, allocated: 45, unplaced: 0, balanced: true },
  ]);
  expect(approved.studyDayBaselines?.[date].rows.map((r) => r.count)).toEqual([6, 9]);
  expect(approved.records).toEqual([]);
  await page.getByRole('button', { name: '今後の予定', exact: true }).click();
  await page.getByRole('button', { name: '前の週', exact: true }).click();
  await page.screenshot({ path: info.outputPath('restart-future.png'), fullPage: true });
  const oldFutureRows = await page.locator('.future-day').filter({ hasText: '今日' }).locator('li').count();
  await page.getByRole('button', { name: '詳細カレンダーを見る', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.locator('.calendar-toolbar').getByRole('button', { name: '今日', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '選択した日の学習詳細' });
  await page.screenshot({ path: info.outputPath('restart-calendar-content.png'), fullPage: true });
  const oldContentRows = await panel.locator('.quantity-breakdown section').count();
  const oldSummary = await page.locator('.day.today .calendar-event').count();
  await page.getByRole('button', { name: '学習量', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.screenshot({ path: info.outputPath('restart-calendar-quantity.png'), fullPage: true });
  expect.soft(oldFutureRows).toBe(0);
  expect.soft(oldContentRows).toBe(0);
  expect.soft(oldSummary).toBe(0);
  await expect.soft(panel.locator('.quantity-breakdown section')).toHaveCount(0);
  await expect.soft(page.locator('.day.today .calendar-quantity')).toHaveText('予定なし');
  // Future work remains actionable; only the retired comparison row disappears.
  const nextDay = page.locator('.day').filter({ has: page.getByRole('button', { name: `${addDays(date, 1)}を表示`, exact: false }) });
  await expect(nextDay).not.toContainText('予定なし');
  expect((await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const shown = await read();
  expect(shown.plan).toEqual(approved.plan);
  expect(shown.records).toEqual(approved.records);
  expect(shown.history).toEqual(approved.history);
  expect(shown.studyDayBaselines).toEqual(approved.studyDayBaselines);
  await page.reload();
  await expect(page.locator('.daily-record-row')).toHaveCount(0);
  await page.getByRole('button', { name: '今後の予定', exact: true }).click();
  await page.getByRole('button', { name: '詳細カレンダーを見る', exact: true }).click();
  await page.locator('.calendar-toolbar').getByRole('button', { name: '今日', exact: true }).click();
  await page.getByRole('button', { name: '学習量', exact: true }).click();
  await expect(page.locator('.day.today .calendar-quantity')).toHaveText('予定なし');
  expect((await read()).plan).toEqual(approved.plan);
});

test('旧形式の過去予定は仕切り直し後に非表示となり、4問と明示0の実績は残る', async ({ page }, info) => {
  await page.setViewportSize({width: info.project.name === 'narrow' ? 390 : 1280, height: info.project.name === 'narrow' ? 844 : 800});
  const date = adjustmentContext.date;
  const past = addDays(date,-2), recorded = addDays(date,-1);
  const source = legacyRestartFixture();
  await page.clock.install({time:new Date(adjustmentContext.timestamp)});
  await page.addInitScript((state)=> {
    if (!localStorage.getItem('studyplan-demo-state-v1')) localStorage.setItem('studyplan-demo-state-v1',JSON.stringify({revision:1,data:state}));
  },source);
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('studyplan-demo-state-v1')!).data as AppState);
  await page.goto('./');
  await page.getByRole('button',{name:'今後の予定',exact:true}).click();
  await page.getByRole('button',{name:'計画を仕切り直す',exact:true}).click();
  await page.getByLabel('開始日',{exact:true}).fill(date);
  await page.getByRole('button',{name:'この日から案を作成',exact:true}).click();
  await page.getByRole('button',{name:'この内容で更新',exact:true}).click();
  await expect(page.getByText('計画を更新し、カレンダーに反映しました')).toBeVisible();
  const approved=await read();
  expect(approved.records).toEqual(source.records);
  expect(remainingWork(approved,date)).toMatchObject([
    {total:30,completed:4,allocated:26,unplaced:0,balanced:true},
    {total:30,completed:0,allocated:30,unplaced:0,balanced:true},
    {total:45,completed:0,allocated:45,unplaced:0,balanced:true},
  ]);
  await page.getByRole('button',{name:'今後の予定',exact:true}).click();
  for(let i=0;i<3 && (await page.locator('.future-week time').getAttribute('datetime'))! > past;i++)
    await page.getByRole('button',{name:'前の週',exact:true}).click();
  await expect(page.locator('.future-day').filter({has:page.getByRole('button',{name:new RegExp(`^${past} `)})})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('restart-past-future.png'),fullPage:true});
  await page.getByRole('button',{name:'詳細カレンダーを見る',exact:true}).click();
  await page.getByRole('button',{name:`${past}を表示`,exact:true}).click();
  const panel=page.getByRole('complementary',{name:'選択した日の学習詳細'});
  await expect(panel.locator('.session-detail')).toHaveCount(0);
  await expect(panel.locator('.quantity-breakdown section')).toHaveCount(0);
  await expect(panel).toContainText('学習予定はありません');
  await page.screenshot({path:info.outputPath('restart-past-content.png'),fullPage:true});
  await page.getByRole('button',{name:'学習量',exact:true}).focus();
  await page.keyboard.press('Enter');
  await expect(panel).toContainText('予定なし');
  await page.getByRole('button',{name:new RegExp(`^${recorded}を表示`)}).click();
  await expect(panel.locator('.quantity-breakdown section')).toHaveCount(2);
  await expect(panel.locator('.quantity-breakdown section').filter({hasText:'対象問題集'})).toContainText('4問');
  await expect(panel.locator('.quantity-breakdown section').filter({hasText:'別問題集'})).toContainText('0問');
  await expect(panel).not.toContainText('不足');
  await expect(panel).not.toContainText('/6問');
  await page.screenshot({path:info.outputPath('restart-past-records.png'),fullPage:true});
  await page.getByRole('button',{name:'一覧',exact:true}).click();
  await expect(page.locator('.calendar-list')).not.toContainText(past);
  await expect(page.locator('.calendar-list')).toContainText(recorded);
  expect((await new AxeBuilder({page}).include('main').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.reload();
  const reloaded=await read();
  expect(reloaded.plan).toEqual(approved.plan);
  expect(reloaded.records).toEqual(approved.records);
  expect(reloaded.history).toEqual(approved.history);
  expect(reloaded.studyDayBaselines).toEqual(approved.studyDayBaselines);
  await page.getByRole('button',{name:'今後の予定',exact:true}).click();
  await page.getByRole('button',{name:'詳細カレンダーを見る',exact:true}).click();
  await page.locator('.calendar-toolbar').getByRole('button',{name:'今日',exact:true}).click();
  await page.getByRole('button',{name:'学習量',exact:true}).click();
  await page.getByRole('button',{name:new RegExp(`^${past}を表示`)}).click();
  await expect(panel.locator('.quantity-breakdown section')).toHaveCount(0);
  // The restart's first day also becomes historical; it must not revive the old baseline.
  await page.clock.setSystemTime(new Date(`${addDays(date,1)}T03:00:00.000Z`));
  await page.reload();
  await page.getByRole('button',{name:'今後の予定',exact:true}).click();
  await page.getByRole('button',{name:'詳細カレンダーを見る',exact:true}).click();
  await page.locator('.calendar-toolbar').getByRole('button',{name:'今日',exact:true}).click();
  await page.getByRole('button',{name:'学習量',exact:true}).click();
  await page.getByRole('button',{name:new RegExp(`^${date}を表示`)}).click();
  await expect(panel.locator('.quantity-breakdown section')).toHaveCount(0);
  expect((await read()).records).toEqual(source.records);
});
