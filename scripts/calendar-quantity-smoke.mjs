import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dailyFlowFixture } from './daily-flow-fixture.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:4175/studyplan/';
const output = 'test-results/calendar-quantity';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const shift = (date, days) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('studyplan-demo-state-v1')).data);
try {
  for (const width of [1280, 390, 320]) {
    const { state, date } = dailyFlowFixture();
    const sunday = shift(date, (7 - new Date(`${date}T12:00:00Z`).getUTCDay()) % 7);
    const past = shift(date, -1);
    const first = state.plan.sessions[0];
    state.settings.exams[0].target = shift(sunday, 20);
    state.settings.materials[0].total = 500;
    state.plan.settingsSnapshot = structuredClone(state.settings);
    state.plan.sessions = Array.from({ length: 14 }, (_, i) => ({ ...first, id: `s${i}`, date: shift(sunday, i), count: 20 }));
    state.plan.sessions.push({ ...first, count: 20 });
    state.studyDayBaselines = { [past]: { planId: 'previous-approved', rows: [{ materialId: 'book', round: 0, examId: 'exam', name: '民法過去問', unit: '問', count: 20 }] } };
    state.records = [{ id: 'partial', token: 'partial', date: past, materialId: 'book', round: 0, count: 12, createdAt: new Date().toISOString() }, { id: 'cancelled', token: 'cancelled', date: past, materialId: 'book', round: 0, count: 99, cancelled: true, createdAt: new Date().toISOString() }, { id: 'zero', token: 'zero', date, materialId: 'book', round: 0, count: 0, createdAt: new Date().toISOString() }];
    const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Asia/Tokyo' });
    await context.addInitScript((seed) => {
      if (!localStorage.getItem('studyplan-demo-state-v1')) localStorage.setItem('studyplan-demo-state-v1', JSON.stringify({ revision: 1, data: seed }));
    }, state);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '今後の予定', exact: true }).click();
    await expect(page.getByRole('button', { name: new RegExp(`^${sunday} `) })).toBeVisible();
    const entry = page.getByRole('button', { name: '詳細カレンダーを見る' });
    assert((await entry.boundingBox()).y < (await page.locator('.future-day').first().boundingBox()).y);
    await page.getByRole('button', { name: '次の週', exact: true }).click();
    const range = await page.locator('.future-week strong').innerText();
    const origin = page.getByRole('button', { name: new RegExp(`^${shift(sunday, 10)} `) });
    await origin.scrollIntoViewIfNeeded();
    const originScroll = await page.evaluate(() => scrollY);
    await origin.click();
    await page.getByRole('button', { name: '今後の予定へ戻る' }).click();
    await expect(page.locator('.future-week strong')).toHaveText(range);
    await expect(page.getByRole('button', { name: new RegExp(`^${shift(sunday, 10)} `) })).toBeFocused();
    await expect.poll(async () => Math.abs(await page.evaluate(() => scrollY) - originScroll)).toBeLessThan(2);
    await entry.click();
    await expect(page.locator('.day-panel')).toHaveCount(0);
    await expect(page.locator('.daily-time, .capacity-panel')).toHaveCount(0);
    const before = await stored(page);
    await page.getByRole('button', { name: '学習量', exact: true }).click();
    await expect(page.getByRole('button', { name: '学習量', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.calendar-toolbar').getByRole('button', { name: '今日', exact: true }).click();
    await expect(page.locator('.quantity-breakdown')).toContainText('0/20問');
    const selected = await page.locator('.day-panel h2, .day-panel h3').first().innerText();
    await page.getByRole('button', { name: '内容', exact: true }).click();
    await expect(page.locator('.day-panel h2, .day-panel h3').first()).toHaveText(selected);
    await page.getByRole('button', { name: '学習量', exact: true }).click();
    assert.deepEqual((await stored(page)).plan, before.plan);
    assert.deepEqual((await stored(page)).records, before.records);
    // Select a past archived day, including when the selected week crosses months.
    await page.locator('.calendar-toolbar').getByRole('button', { name: '今日', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(`^${past}を表示 `) }).click();
    await expect(page.locator('.quantity-breakdown')).toContainText('12/20問');
    await expect(page.locator('.quantity-breakdown')).toContainText('8問不足');
    await page.getByRole('button', { name: '一覧', exact: true }).click();
    await expect(page.getByRole('button', { name: `${past}の学習量の内訳` })).toBeVisible();
    await page.getByRole('button', { name: '月', exact: true }).click();
    await page.screenshot({ path: `${output}/quantity-${width}.png`, fullPage: true });
    await page.locator('.quantity-grid .day').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/viewport-${width}.png` });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal overflow');
    await page.locator('.calendar-toolbar').getByRole('button', { name: '今日', exact: true }).click();
    await expect(page.locator('.quantity-breakdown')).toContainText('0/20問');
    await page.getByRole('button', { name: '内容', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: '学習量', exact: true })).toBeFocused();
    const focus = await page.getByRole('button', { name: '学習量', exact: true }).evaluate((el) => ({ outline: getComputedStyle(el).outlineStyle, width: getComputedStyle(el).outlineWidth }));
    assert.notEqual(focus.outline, 'none');
    assert.notEqual(focus.width, '0px');
    for (const theme of ['mint', 'sky', 'lime']) {
      for (const mode of ['light', 'dark']) {
        await page.evaluate(({ theme, mode }) => {
          document.documentElement.dataset.theme = theme;
          document.documentElement.dataset.appearance = mode;
        }, { theme, mode });
        await page.evaluate(async () => {
          await new Promise(requestAnimationFrame);
          await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})));
        });
        const a11y = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        assert.deepEqual(a11y.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), [], `${theme}/${mode} axe`);
      }
    }
    await page.addStyleTag({ content: 'html { font-size: 200% !important; } * { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }' });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'text expansion reflow');
    await page.screenshot({ path: `${output}/expanded-${width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS ${width}px navigation, quantities, modes, archive, keyboard, axe themes, reflow`);
  }
  {
    const { state, date } = dailyFlowFixture();
    const past = shift(date, -1);
    state.settings.materials.push({ id: 'pages', examId: 'exam', name: '読書', unit: 'ページ', total: 5, order: 2, rounds: [{ completed: 0, minutes: 2 }] });
    state.plan.settingsSnapshot = structuredClone(state.settings);
    state.plan.from = past;
    state.plan.sessions.push({ ...state.plan.sessions[0], id: 'past', date: past, count: 20 }, { ...state.plan.sessions[0], id: 'pages-session', materialId: 'pages', count: 5 });
    state.records = [{ id: 'past-record', date: past, materialId: 'book', round: 0, count: 12, createdAt: new Date().toISOString() }, { id: 'pages-record', date, materialId: 'pages', round: 0, count: 2, createdAt: new Date().toISOString() }];
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Tokyo' });
    await context.addInitScript((seed) => {
      if (!localStorage.getItem('studyplan-demo-state-v1')) localStorage.setItem('studyplan-demo-state-v1', JSON.stringify({ revision: 1, data: seed }));
    }, state);
    const page = await context.newPage();
    await page.goto(`${url}#calendar`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '学習量', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(`^${past}を表示 `) }).click();
    await expect(page.locator('.quantity-breakdown')).toContainText('12問');
    await expect(page.locator('.quantity-breakdown')).not.toContainText('基準なし');
    await expect(page.locator('.quantity-breakdown')).not.toContainText('問不足');
    await page.reload();
    await page.getByRole('button', { name: '学習量', exact: true }).click();
    await page.locator('.calendar-toolbar').getByRole('button', { name: '今日', exact: true }).click();
    const pages = page.locator('.quantity-breakdown section').filter({ hasText: '読書' });
    await expect(pages).toContainText('2/5ページ');
    await pages.getByRole('button', { name: '記録を確認・追加' }).click();
    await expect(page.getByRole('textbox', { name: '読書 1周目の追加分（ページ）' })).toHaveValue('3');
    await expect(page.locator('.daily-record-row').filter({ hasText: '読書' })).toContainText('2/5ページ');
    await context.close();
    console.log('PASS missing historical baseline, mixed units, record detail route');
  }
} finally {
  await browser.close();
}
