import { test, expect, Page, Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  contractCases,
  contractDay,
  contractPast,
  contractFuture,
  progressContractFixture,
} from '../fixtures/progressContract';

async function navigate(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click();
}
async function futureWeek(page: Page) {
  await navigate(page, '今後の予定');
  if ((await page.locator('.future-week time').getAttribute('datetime')) !== '2026-09-20')
    await navigate(page, '前の週');
}
const dayList = (page: Page, date: string) =>
  page
    .locator('.future-day')
    .filter({ has: page.getByRole('button', { name: new RegExp(`^${date} `) }) });
async function progress(row: Locator, actual: number | null, deficit: number | null) {
  const value = row.locator('.progress-value');
  // Check rendered quantities as well as unknown-vs-zero; not just hidden test metadata.
  if (actual === null) await expect(value).toContainText(/未報告\s*\/\s*10問/);
  else await expect(value).toContainText(new RegExp(`(^|\\s)${actual}/10問`));
  if (deficit !== null && deficit > 0) await expect(value).toContainText(`${deficit}問不足`);
  else await expect(value).not.toContainText('不足');
}
async function inspectScreens(page: Page, actual: number | null, pastActual: number | null = 6) {
  await navigate(page, '今日');
  await progress(page.locator('.daily-record-row').filter({ hasText: '一部の教材' }), actual, null);
  for (const c of contractCases.filter((c) => c.id !== 'partial'))
    await progress(page.locator('.daily-record-row').filter({ hasText: c.name }), c.actual, null);
  await futureWeek(page);
  await progress(
    dayList(page, contractDay).locator('li').filter({ hasText: '一部の教材' }),
    actual,
    null,
  );
  await progress(
    dayList(page, contractPast).locator('li').filter({ hasText: '一部の教材' }),
    pastActual,
    pastActual === null ? null : 10 - pastActual,
  );
  for (const amount of await dayList(page, contractFuture).locator('li > strong').all())
    await expect(amount).toHaveText(/^\d+問$/);
  await page.getByRole('button', { name: '詳細カレンダーを見る' }).focus();
  const scroll = await page.evaluate(() => window.scrollY);
  await navigate(page, '詳細カレンダーを見る');
  await navigate(page, '内容');
  await expect(page.locator('.daily-record-form')).toHaveCount(0);
  await page.getByRole('button', { name: `${contractDay}を表示`, exact: true }).click();
  await progress(
    page
      .locator('.session-detail')
      .filter({ has: page.getByRole('heading', { name: '一部の教材', exact: true }) }),
    actual,
    null,
  );
  const todayCell = page.locator('.day.today');
  const contentNumbers = await todayCell.locator('.progress-value').allTextContents();
  await navigate(page, '学習量');
  expect(await todayCell.locator('.progress-value').allTextContents()).toEqual(contentNumbers);
  await progress(
    page.locator('.quantity-breakdown section').filter({ hasText: '一部の教材' }),
    actual,
    null,
  );
  await page.getByRole('button', { name: new RegExp(`^${contractPast}を表示`) }).click();
  for (const c of contractCases)
    await progress(
      page.locator('.quantity-breakdown section').filter({ hasText: c.name }),
      c.id === 'partial' ? pastActual : c.actual,
      c.id === 'partial' ? (pastActual === null ? null : 10 - pastActual) : c.deficit,
    );
  await expect(page.locator('main')).not.toContainText(/基準なし|実績あり/);
  await navigate(page, '← 今後の予定へ戻る');
  await expect(page.locator('.future-week time')).toHaveAttribute('datetime', '2026-09-20');
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - scroll)).toBeLessThan(3);
  await navigate(page, '設定');
  await navigate(page, '週間レポート');
  await page.locator(`[data-report-date="${contractDay}"]`).click();
  await progress(
    page.locator('.report-day-detail li').filter({ hasText: '一部の教材' }),
    actual,
    null,
  );
  await page.getByRole('button', { name: '← 週間レポートへ戻る' }).click();
  await page.locator(`[data-report-date="${contractPast}"]`).click();
  await progress(
    page.locator('.report-day-detail li').filter({ hasText: '一部の教材' }),
    pastActual,
    pastActual === null ? null : 10 - pastActual,
  );
  await navigate(page, '記録履歴');
  const history = page
    .getByRole('row')
    .filter({ hasText: contractDay })
    .filter({ hasText: '一部の教材' });
  if (actual === null) await expect(history).toHaveCount(0);
  else await expect(history).toContainText(`＋${actual}問`);
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(`${contractDay}T12:00:00+09:00`) });
  await page.addInitScript((state) => {
    if (!localStorage.getItem('studyplan-demo-state-v1'))
      localStorage.setItem('studyplan-demo-state-v1', JSON.stringify({ revision: 1, data: state }));
  }, progressContractFixture());
  await page.goto('./');
});

test('同一fixtureを各画面で照合し、履歴の訂正・取消・再読込を反映する', async ({ page }, info) => {
  await expect(page.locator('.daily-record-row')).toHaveCount(6);
  await page.screenshot({ path: info.outputPath('today-initial.png'), fullPage: true });
  await inspectScreens(page, 6);
  await navigate(page, '設定');
  await navigate(page, '週間レポート');
  expect(
    (
      await new AxeBuilder({ page })
        .include('main')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath('weekly-report.png'), fullPage: true });
  await futureWeek(page);
  await dayList(page, contractPast).getByRole('button').click();
  await navigate(page, '学習量');
  await page.screenshot({ path: info.outputPath('calendar.png'), fullPage: true });
  await navigate(page, '記録履歴');
  const history = page
    .getByRole('row')
    .filter({ hasText: contractDay })
    .filter({ hasText: '一部の教材' });
  await history.getByRole('button', { name: '訂正', exact: true }).click();
  await page.getByRole('textbox', { name: '訂正後の問題数' }).fill('3');
  await navigate(page, '訂正を保存');
  await expect(page.locator('.save-status')).toContainText('保存済み');
  await page.reload();
  await inspectScreens(page, 3);
  await history.getByRole('button', { name: '取消', exact: true }).click();
  await navigate(page, '取消を確定');
  await expect(page.locator('.save-status')).toContainText('保存済み');
  await page.reload();
  await inspectScreens(page, null);
  const past = page
    .getByRole('row')
    .filter({ hasText: contractPast })
    .filter({ hasText: '一部の教材' });
  await past.getByRole('button', { name: '訂正', exact: true }).click();
  await page.getByRole('textbox', { name: '訂正後の問題数' }).fill('3');
  await navigate(page, '訂正を保存');
  await inspectScreens(page, null, 3);
  await past.getByRole('button', { name: '取消', exact: true }).click();
  await navigate(page, '取消を確定');
  await expect(page.locator('.save-status')).toContainText('保存済み');
  await page.reload();
  await inspectScreens(page, null, null);
  await navigate(page, '今日');
  await page.screenshot({ path: info.outputPath('today.png'), fullPage: true });
});

test('入力の中心へ誘導し、確認前に保存せず、キーボードで安全に追加する', async ({ page }, info) => {
  await futureWeek(page);
  await dayList(page, contractDay).getByRole('button').click();
  const detail = page
    .locator('.session-detail')
    .filter({ has: page.getByRole('heading', { name: '一部の教材', exact: true }) });
  await expect(page.getByRole('button', { name: /固定する|固定を解除/ })).toHaveCount(0);
  const before = await page.evaluate(() => localStorage.getItem('studyplan-demo-state-v1'));
  const record = detail.getByRole('button', { name: '進捗を記録' });
  await record.focus();
  await page.keyboard.press('Enter');
  const row = page.locator('.daily-record-row').filter({ hasText: '一部の教材' });
  const input = row.getByRole('textbox');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('4');
  expect(await page.evaluate(() => localStorage.getItem('studyplan-demo-state-v1'))).toBe(before);
  const focus = await input.evaluate((el) => ({
    outline: getComputedStyle(el).outlineStyle,
    width: getComputedStyle(el).outlineWidth,
    rect: el.getBoundingClientRect().toJSON(),
  }));
  expect(focus.outline).not.toBe('none');
  expect(parseFloat(focus.width)).toBeGreaterThanOrEqual(2);
  expect(focus.rect.top).toBeGreaterThanOrEqual(0);
  await page.keyboard.press('Enter');
  await progress(row, 10, null);
  await expect(page.locator('main')).not.toContainText('予定調整に失敗');
  for (const theme of ['mint', 'sky', 'lime'])
    for (const appearance of ['light', 'dark']) {
      await page.evaluate(
        ({ theme, appearance }) => {
          document.documentElement.dataset.theme = theme;
          document.documentElement.dataset.appearance = appearance;
        },
        { theme, appearance },
      );
      await page.waitForTimeout(250);
      expect(
        (
          await new AxeBuilder({ page })
            .include('main')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
            .analyze()
        ).violations,
      ).toEqual([]);
    }
  await page.evaluate(() => {
    // Explicit pixel font sizes must actually grow too, not only the root's rem size.
    const sizes = [...document.querySelectorAll<HTMLElement>('body, body *')].map(el =>
      [el, parseFloat(getComputedStyle(el).fontSize)] as const);
    for (const [el, size] of sizes) el.style.setProperty('font-size', `${size * 2}px`, 'important');
  });
  await page.addStyleTag({ content: '*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath('text-spacing.png'), fullPage: true });
});

test('再配分後も履歴の不足を残し、取得不能な旧データは比較しない', async ({ page }, info) => {
  const state = progressContractFixture();
  state.history.push(structuredClone(state.plan!));
  state.plan = {
    ...state.plan!,
    id: 'new',
    from: contractDay,
    createdAt: `${contractDay}T09:00:00+09:00`,
    sessions: state.plan!.sessions.filter((s) => s.date >= contractDay),
  };
  await page.evaluate(
    (state) =>
      localStorage.setItem('studyplan-demo-state-v1', JSON.stringify({ revision: 2, data: state })),
    state,
  );
  await page.reload();
  await inspectScreens(page, 6);
  const legacy = progressContractFixture();
  legacy.plan!.createdAt = `${contractFuture}T12:00:00+09:00`;
  legacy.plan!.sessions = legacy.plan!.sessions.filter((s) => s.date === contractPast);
  await page.evaluate(
    (state) =>
      localStorage.setItem('studyplan-demo-state-v1', JSON.stringify({ revision: 3, data: state })),
    legacy,
  );
  await page.reload();
  await futureWeek(page);
  const row = dayList(page, contractPast).locator('li').filter({ hasText: '一部の教材' });
  await expect(row.locator('.progress-value')).toHaveText('6問');
  await expect(
    dayList(page, contractPast)
      .locator('li')
      .filter({ hasText: '未報告の教材' })
      .locator('.progress-value'),
  ).toHaveText('未報告');
  await dayList(page, contractPast).getByRole('button').click();
  await navigate(page, '学習量');
  await expect(
    page
      .locator('.quantity-breakdown section')
      .filter({ hasText: '一部の教材' })
      .locator('.progress-value'),
  ).toHaveText('6問');
  await expect(
    page.locator('.quantity-breakdown .progress-value').filter({ hasText: '不足' }),
  ).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('legacy-calendar.png'), fullPage: true });
});
