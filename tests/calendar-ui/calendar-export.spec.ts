import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { AppState } from '../../src/domain/model';
import type { createCalendarFile } from '../../src/domain/icalendar';

test('旧一覧設定を月へ戻し、月・週の下部からキーボードでICSの内容を維持する', async ({ page }, info) => {
  const now = '2026-09-24T12:00:00+09:00';
  await page.clock.install({ time: new Date(now) });
  await page.clock.setFixedTime(new Date(now));
  await page.addInitScript(() => {
    Object.assign(window, { isTauri: true, calendarWrites: [], __TAURI_INTERNALS__: {
      invoke: async (command: string, args: unknown) => {
        if (command === 'plugin:dialog|save') return 'isolated-calendar.ics';
        if (command === 'export_calendar') {
          (window as unknown as { calendarWrites: unknown[] }).calendarWrites.push(args);
          return;
        }
        throw new Error('Unexpected native command: ' + command);
      },
    } });
  });
  await page.goto('/tests/calendar-ui/calendar.html');
  await expect(page.locator('.calendar-grid.month')).toBeVisible();
  await expect(page.getByRole('button', { name: '一覧', exact: true })).toHaveCount(0);
  await expect(page.locator('.calendar-grid')).toHaveClass(/density-compact/);
  const before = await page.evaluate(() => (window as unknown as { calendarFixture: { state: AppState } }).calendarFixture.state);
  for (const [label, from, to] of [['月', '2026-09-01', '2026-09-30'], ['週', '2026-09-21', '2026-09-27']]) {
    await page.getByRole('button', { name: 'カレンダーの表示設定' }).press('Enter');
    await page.getByLabel('表示期間', { exact: true }).selectOption(label === '月' ? 'month' : 'week');
    await page.keyboard.press('Escape');
    const entry = page.getByRole('button', { name: 'ICSを書き出す', exact: true });
    await expect(entry).toHaveCount(1);
    expect(await entry.evaluate(e => !!(document.querySelector('.calendar-only-layout')!.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    await page.locator('.calendar-grid .date-number').last().focus();
    await page.keyboard.press('Tab');
    await expect(entry).toBeFocused();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('region', { name: 'ICS書き出し', exact: true });
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel('書き出す開始日')).toHaveValue(from);
    await expect(panel.getByLabel('書き出す終了日')).toHaveValue(to);
    await page.keyboard.press('Tab');
    await expect(panel.getByLabel('書き出す開始日')).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect((await new AxeBuilder({ page }).include('.calendar-export').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath('ics-' + (label === '月' ? 'month' : 'week') + '.png'), fullPage: true });
    await panel.getByRole('button', { name: 'ICSを保存する' }).press('Enter');
    await expect(panel.getByRole('status')).toContainText('書き出しました：学習 18件・授業 0件');
    const actual = await page.evaluate(() => (window as unknown as { calendarWrites: { path: string; text: string }[] }).calendarWrites.at(-1));
    const expected = await page.evaluate(({ from, to, now }) => {
      const fixture = (window as unknown as { calendarFixture: { state: AppState; createCalendarFile: typeof createCalendarFile } }).calendarFixture;
      return fixture.createCalendarFile(fixture.state, { from, to, examId: 'all', study: true, classes: true }, new Date(now)).text;
    }, { from, to, now });
    expect(actual).toEqual({ path: 'isolated-calendar.ics', text: expected });
    await panel.getByRole('button', { name: '閉じる', exact: true }).press('Enter');
    await expect(panel).toHaveCount(0);
  }
  expect(await page.evaluate(() => (window as unknown as { calendarFixture: { state: AppState } }).calendarFixture.state)).toEqual(before);
});
