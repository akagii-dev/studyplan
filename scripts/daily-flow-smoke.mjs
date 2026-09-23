import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { dailyFlowFixture } from './daily-flow-fixture.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/studyplan/';
const output = 'test-results/daily-flow';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('studyplan-demo-state-v1')).data);
const futureCount = (state, date, materialId = 'book') => state.plan.sessions
  .filter((session) => session.date > date && session.kind === 'study' && session.materialId === materialId)
  .reduce((sum, session) => sum + session.count, 0);
const actualCount = (state, materialId = 'book') => state.records
  .filter((record) => !record.cancelled && record.materialId === materialId)
  .reduce((sum, record) => sum + record.count, 0);
const row = (page, name = '民法過去問') => page.getByRole('listitem').filter({ hasText: name });
async function record(page, count, enter = false) {
  const target = row(page);
  await target.getByRole('textbox').fill(String(count));
  if (enter) await target.getByRole('textbox').press('Enter');
  else await target.getByRole('button', { name: '記録', exact: true }).click();
  await expect.poll(async () => (await stored(page)).records.length).toBeGreaterThan(0);
  await expect(page.locator('.save-status')).toContainText('保存済み');
  await expect(page.getByRole('heading', { name: '今日', exact: true })).toBeVisible();
}
function preserved(fixture, saved) {
  assert.deepEqual(saved.settings, fixture.state.settings);
  assert.deepEqual(saved.plan.sessions.filter((session) => session.date <= fixture.date),
    fixture.state.plan.sessions.filter((session) => session.date <= fixture.date));
}
async function scenario(name, options, action) {
  if (process.env.DAILY_FLOW_FILTER && !new RegExp(process.env.DAILY_FLOW_FILTER).test(name)) return;
  const fixture = dailyFlowFixture(options);
  if (options.prepare) options.prepare(fixture.state);
  const context = await browser.newContext({ viewport: { width: options.width ?? 1280, height: 800 } });
  await context.addInitScript((state) => {
    if (!localStorage.getItem('studyplan-demo-state-v1'))
      localStorage.setItem('studyplan-demo-state-v1', JSON.stringify({ revision: 1, data: state }));
  }, fixture.state);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: '今日', exact: true })).toBeVisible();
    await action(page, fixture);
    assert.deepEqual(errors, [], 'browser runtime errors');
    results.push({ name, result: 'passed' });
    console.log(`PASS ${name}`);
  } catch (error) {
    await page.screenshot({ path: `${output}/${name}-failed.png`, fullPage: true });
    console.error((await page.locator('body').innerText()).slice(0, 7000));
    throw error;
  } finally {
    await context.close();
  }
}

try {
  for (const [done, expected] of [[0, 20], [5, 15], [10, 10], [15, 5], [20, 0]]) {
    await scenario(`record-${done}`, {}, async (page, fixture) => {
      await expect(row(page)).toContainText('予定 10問');
      await expect(row(page)).toContainText('未入力');
      if (done === 5) await page.screenshot({ path: `${output}/today-before.png`, fullPage: true });
      await record(page, done, done === 5);
      await expect(row(page)).toContainText(`実績 ${done}問`);
      const saved = await stored(page);
      assert.equal(actualCount(saved), done);
      assert.equal(futureCount(saved, fixture.date), expected);
      assert.deepEqual(saved.plan.shortfalls, []);
      assert.equal(saved.proposal, null);
      preserved(fixture, saved);
      if (done === 5) await page.screenshot({ path: `${output}/today-recorded.png`, fullPage: true });
      await page.reload({ waitUntil: 'networkidle' });
      const reloaded = await stored(page);
      assert.deepEqual(reloaded.records, saved.records);
      assert.deepEqual(reloaded.plan, saved.plan);
      assert.deepEqual(reloaded.settings, saved.settings);
      await page.getByRole('button', { name: '今後の予定', exact: true }).click();
      if (expected > 0) {
        await expect(page.locator('.future-page')).toContainText('民法過去問');
        await expect(page.locator('.future-page')).toContainText(`${expected}問`);
      }
      if (done === 5) await page.screenshot({ path: `${output}/future-15.png`, fullPage: true });
    });
  }

  await scenario('correct-cancel', {}, async (page, fixture) => {
    await record(page, 5);
    await page.getByRole('button', { name: '記録履歴', exact: true }).click();
    await page.getByRole('button', { name: '訂正', exact: true }).click();
    await page.getByLabel('訂正後の問題数').fill('8');
    await page.getByRole('button', { name: '訂正を保存', exact: true }).click();
    await expect.poll(async () => actualCount(await stored(page))).toBe(8);
    let saved = await stored(page);
    assert.equal(futureCount(saved, fixture.date), 12);
    preserved(fixture, saved);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '取消を確定', exact: true }).click();
    await expect.poll(async () => actualCount(await stored(page))).toBe(0);
    saved = await stored(page);
    assert.equal(saved.records.length, 1);
    assert.equal(saved.records[0].cancelled, true);
    assert.equal(futureCount(saved, fixture.date), 20);
    preserved(fixture, saved);
    await page.getByRole('button', { name: '今日', exact: true }).click();
    await expect(row(page)).toContainText('未入力');
  });

  await scenario('outside-study', { secondBook: true }, async (page, fixture) => {
    await page.getByText('予定外の学習を記録', { exact: true }).click();
    const form = page.locator('.outside-record');
    await form.getByRole('combobox', { name: /^問題集/ }).selectOption({ label: '英語読解' });
    await form.getByLabel('追加問数', { exact: true }).fill('2');
    await form.getByRole('button', { name: '記録', exact: true }).click();
    await expect.poll(async () => actualCount(await stored(page), 'reading')).toBe(2);
    await expect(row(page, '英語読解')).toContainText('予定なし');
    await expect(row(page, '英語読解')).toContainText('実績 2問');
    const saved = await stored(page);
    assert.equal(actualCount(saved), 0);
    assert.equal(futureCount(saved, fixture.date), 20);
    assert.equal(futureCount(saved, fixture.date, 'reading'), 2);
    assert.deepEqual(saved.plan.shortfalls, []);
    preserved(fixture, saved);
  });

  await scenario('shortfall', { capacity: 20 }, async (page, fixture) => {
    await record(page, 5);
    const saved = await stored(page);
    assert.equal(futureCount(saved, fixture.date), 10);
    assert.equal(saved.plan.shortfalls[0].count, 5);
    assert.equal(saved.plan.shortfalls[0].minutes, 10);
    const unplaced = page.getByRole('region', { name: '未配置の学習' });
    await expect(unplaced.getByText('5問', { exact: true })).toBeVisible();
    await expect(unplaced).toContainText('民法過去問');
    await expect(unplaced.locator('details')).not.toHaveAttribute('open', '');
    await unplaced.getByText('理由', { exact: true }).click();
    await expect(unplaced.getByText(saved.plan.shortfalls[0].reason, { exact: true })).toBeVisible();
    await page.screenshot({ path: `${output}/shortfall.png`, fullPage: true });
  });

  await scenario('fixed-recovery', { fixed: true }, async (page, fixture) => {
    await record(page, 15);
    let saved = await stored(page);
    assert.equal(actualCount(saved), 15);
    assert.deepEqual(saved.plan, fixture.state.plan);
    await expect(page.locator('main')).toContainText('確認');
    await page.screenshot({ path: `${output}/fixed-conflict.png`, fullPage: true });
    await page.getByRole('button', { name: '記録履歴', exact: true }).click();
    await page.getByRole('button', { name: '訂正', exact: true }).click();
    await page.getByLabel('訂正後の問題数').fill('5');
    await page.getByRole('button', { name: '訂正を保存', exact: true }).click();
    await expect.poll(async () => actualCount(await stored(page))).toBe(5);
    saved = await stored(page);
    assert.equal(futureCount(saved, fixture.date), 15);
    assert.deepEqual(saved.plan.sessions.find((session) => session.id === 'tomorrow-book'), fixture.state.plan.sessions[1]);
  });

  await scenario('deadline-shortfall', { prepare(state) {
    state.settings.exams[0].target = state.plan.sessions[1].date;
    state.plan.settingsSnapshot = structuredClone(state.settings);
  } }, async (page, fixture) => {
    await record(page, 5);
    const saved = await stored(page);
    assert.equal(futureCount(saved, fixture.date), 0);
    assert.equal(saved.plan.shortfalls[0].count, 15);
    assert.equal(saved.plan.shortfalls[0].minutes, 30);
    preserved(fixture, saved);
    await page.getByRole('button', { name: '今後の予定', exact: true }).click();
    await expect(page.locator('.future-page')).toContainText('未配置');
    await expect(page.locator('.future-page')).toContainText('30分');
  });

  await scenario('pending-settings', { prepare(state) {
    state.proposal = { basedOn: state.plan.id, reason: '編集中の条件変更', unreported: [], settingsBase: structuredClone(state.settings), plan: structuredClone(state.plan) };
    state.proposal.plan.settingsSnapshot.buffer = 0.1;
  } }, async (page, fixture) => {
    await record(page, 5);
    const saved = await stored(page);
    assert.equal(actualCount(saved), 5);
    assert.deepEqual(saved.plan, fixture.state.plan);
    assert.deepEqual(saved.proposal, fixture.state.proposal);
  });

  await scenario('narrow-keyboard', { width: 320 }, async (page) => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await record(page, 5, true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/today-320.png`, fullPage: true });
    await page.getByRole('button', { name: '今後の予定', exact: true }).click();
    await expect(page.locator('.future-page')).toContainText('15問');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  });
  await scenario('resolved-review', { prepare(state) {
    state.proposal = { basedOn: state.plan.id, reason: '編集中の条件変更', unreported: [], settingsBase: structuredClone(state.settings), plan: structuredClone(state.plan) };
    state.proposal.plan.settingsSnapshot.buffer = 0.1;
  } }, async (page) => {
    await record(page, 5);
    await page.getByRole('button', { name: '計画案を確認', exact: true }).click();
    await page.getByRole('button', { name: '現在の残数から案を作り直す', exact: true }).click();
    const acknowledgement = page.getByLabel('未報告は記録を保留したまま、現在の残数を今後の枠へ再配置する');
    if (await acknowledgement.count()) await acknowledgement.check();
    await page.getByRole('button', { name: 'この内容で更新', exact: true }).click();
    await expect(page.locator('.save-status')).toContainText('保存済み');
    await page.getByRole('button', { name: '今日', exact: true }).click();
    await expect(row(page)).toContainText('実績 5問');
    await expect(page.locator('.daily-adjustment')).toHaveCount(0);
  });
  writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(`${results.length} daily flow scenarios passed.`);
} finally {
  await browser.close();
}
