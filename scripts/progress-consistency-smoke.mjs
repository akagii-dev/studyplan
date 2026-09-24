import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { dailyFlowFixture, showFutureWeek } from './daily-flow-fixture.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:4176/studyplan/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
mkdirSync('test-results/progress-consistency', { recursive: true });
try {
  for (const width of [1280, 390, 320]) {
    const { state, date, tomorrow } = dailyFlowFixture();
    const previous = new Date(`${date}T12:00:00Z`); previous.setUTCDate(previous.getUTCDate() - 1);
    const past = previous.toISOString().slice(0, 10);
    const counts = [null, 0, 3, 6, 10, 12];
    state.settings.materials = counts.map((_, i) => ({ id: `b${i}`, examId: 'exam', name: `教材${i}`, total: 200, order: i, rounds: [{ completed: 0, minutes: 2 }] }));
    const session = state.plan.sessions[0];
    state.plan.from = past;
    state.plan.createdAt = `${past}T00:00:00+09:00`;
    state.plan.settingsSnapshot = structuredClone(state.settings);
    state.plan.sessions = [past, date, tomorrow].flatMap(day => counts.map((_, i) => ({ ...session, date: day, id: `${day}-${i}`, materialId: `b${i}`, count: 10, fixed: i === 2 })));
    state.records = [past, date].flatMap(day => counts.flatMap((count, i) => count === null ? [] : [{ id: `${day}-r${i}`, date: day, materialId: `b${i}`, round: 0, count, cancelled: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]));
    state.records.push({ ...state.records[0], id: 'cancelled', materialId: 'b0', count: 9, cancelled: true });
    const context = await browser.newContext({ viewport: { width, height: 950 }, timezoneId: 'Asia/Tokyo' });
    await context.addInitScript(state => {
      if (!localStorage.getItem('studyplan-demo-state-v1')) localStorage.setItem('studyplan-demo-state-v1', JSON.stringify({ revision: 1, data: state }));
    }, state);
    const page = await context.newPage();
    await page.goto(url);
    const rows = page.locator('.daily-record-row');
    await expect(rows).toHaveCount(6);
    for (let i = 0; i < counts.length; i++) {
      await expect(rows.nth(i)).toContainText(counts[i] === null ? '未報告 / 10問' : `${counts[i]}/10問`);
      if (width === 1280) await expect(rows.nth(i).locator('.daily-progress-ring')).toContainText(`${(counts[i] ?? 0) * 10}%`);
      else await expect(rows.nth(i).locator('.daily-progress-ring')).toBeHidden();
    }
    await expect(rows.nth(5).locator('.ring-value')).toHaveAttribute('stroke-dasharray', '100 100');
    await page.screenshot({ path: `test-results/progress-consistency/today-${width}.png`, fullPage: true });
    const before = await page.evaluate(() => localStorage.getItem('studyplan-demo-state-v1'));
    const openDay = async (day, mode = '学習量') => {
      await page.getByRole('button', { name: '今後の予定', exact: true }).click();
      await showFutureWeek(page, day);
      await page.getByRole('button', { name: new RegExp(`^${day} `) }).click();
      await page.getByRole('button', { name: mode, exact: true }).click();
    };
    await openDay(past);
    const details = page.locator('.quantity-breakdown section');
    for (let i = 0; i < counts.length; i++) {
      await expect(details.nth(i)).toContainText(counts[i] === null ? '未報告 / 10問' : `${counts[i]}/10問`);
      if (counts[i] !== null && counts[i] < 10) await expect(details.nth(i)).toContainText(`${10 - counts[i]}問不足`);
      else await expect(details.nth(i)).not.toContainText('問不足');
    }
    await expect(page.locator('main')).not.toContainText('基準なし');
    await page.screenshot({ path: `test-results/progress-consistency/calendar-${width}.png`, fullPage: true });
    await openDay(date, '内容');
    await expect(page.getByRole('button', { name: /固定する|固定を解除/ })).toHaveCount(0);
    await page.locator('.session-detail').filter({ has: page.getByRole('heading', { name: '教材2', exact: true }) }).getByRole('button', { name: '進捗を記録' }).click();
    const input = rows.nth(2).getByRole('textbox');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('7');
    assert.equal(await page.evaluate(() => localStorage.getItem('studyplan-demo-state-v1')), before);
    await rows.nth(2).getByRole('button', { name: '記録', exact: true }).click();
    await expect(rows.nth(2)).toContainText('10/10問');
    await expect(page.locator('.save-status')).toContainText('保存済み');
    await page.reload();
    await expect(rows.nth(2)).toContainText('10/10問');
    await openDay(date);
    await details.nth(0).getByRole('button', { name: '進捗を記録' }).click();
    await expect(rows.nth(0).getByRole('textbox')).toBeFocused();
    await expect(rows.nth(0).getByRole('textbox')).toHaveValue('10');
    for (const theme of ['mint', 'sky', 'lime']) for (const appearance of ['light', 'dark']) {
      await page.evaluate(({ theme, appearance }) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.appearance = appearance; }, { theme, appearance });
      await page.waitForTimeout(300); // Measure final theme colors, not the button's transition.
      const scan = await new AxeBuilder({ page }).include('main').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
      assert.deepEqual(scan.violations, []);
    }
    await page.addStyleTag({ content: 'html {font-size:200%} * {line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}' });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    // A genuinely unrecoverable historical plan: created later, no retained archive.
    const legacy = structuredClone(state);
    legacy.plan.createdAt = `${tomorrow}T00:00:00+09:00`;
    delete legacy.plan.approvedAt;
    legacy.studyDayBaselines = {};
    legacy.history = [];
    legacy.plan.sessions = legacy.plan.sessions.filter(s => s.date === past && ['b0','b1'].includes(s.materialId));
    legacy.records = [{ ...state.records[0], id: 'legacy-record', materialId: 'b0', date: past, count: 15, cancelled: false }];
    await page.evaluate(state => localStorage.setItem('studyplan-demo-state-v1', JSON.stringify({ revision: 1, data: state })), legacy);
    await page.reload();
    await openDay(past);
    await expect(details.nth(0)).toContainText('15問');
    await expect(details.nth(0)).not.toContainText('/');
    await expect(details.nth(1)).toContainText('未報告');
    await expect(page.locator('main')).not.toContainText('基準なし');
    await expect(page.locator('.quantity-breakdown')).not.toContainText('問不足');
    await page.getByRole('button', { name: '内容', exact: true }).click();
    await expect(page.locator('.calendar-event').filter({ hasText: '15問' })).toHaveCount(1);
    await page.getByRole('button', { name: '今後の予定', exact: true }).click();
    await showFutureWeek(page, past);
    await expect(page.locator('.future-day')).toContainText('15問');
    await expect(page.locator('.future-day')).toContainText('未報告');
    await expect(page.locator('.future-day')).not.toContainText('問不足');
    await context.close();
    console.log(`PASS ${width}: shared values, past deficit, cancelled exclusion, ring, focus/prefill, no implicit save, safe add, reload, axe/reflow`);
  }
} finally { await browser.close(); }
