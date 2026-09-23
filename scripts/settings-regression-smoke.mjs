import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { dailyFlowFixture } from './daily-flow-fixture.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:4175/studyplan/';
const storageKey = 'studyplan-demo-state-v1';
const browser = await chromium.launch({ channel: 'msedge', headless: true });

try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.locator('nav button[aria-label="設定"]').click();
    await page.locator('.settings-extra summary').first().click();
    await page.locator('.settings-extra .settings-row').first()
      .getByRole('button', { name: '設定・確認' }).click();
    assert.equal(await page.locator('h1').innerText(), '時間枠・時間割');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-settings-target')), 'meals');
    await page.locator('nav button[aria-label="設定"]').click();
    await page.getByRole('button', { name: '使い方' }).click();
    await page.getByRole('navigation', { name: 'チュートリアルの項目' })
      .getByRole('button', { name: '勉強できる時間' }).click();
    await page.getByRole('button', { name: '時間枠・時間割へ' }).click();
    assert.equal(await page.locator('h1').innerText(), '時間枠・時間割');
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'H1');
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    await page.close();
  }

  const { state, date } = dailyFlowFixture();
  state.settings.windows.push({
    id: 'class-fixture', kind: 'class', name: '検証用の授業',
    from: date, to: date, weekdays: [1], start: 600, end: 700,
  });
  state.settings.exceptions.push({
    id: 'exception-fixture', name: '検証用の外出', date, start: 700, end: 800,
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript((data) => {
    if (!localStorage.getItem('studyplan-demo-state-v1'))
      localStorage.setItem('studyplan-demo-state-v1', JSON.stringify({ revision: 1, data }));
  }, state);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('nav button[aria-label="設定"]').click();
  await page.getByRole('button', { name: '時間枠を設定' }).click();
  const before = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  const first = page.locator('.split .card.compact').first();
  await first.getByRole('button', { name: /削除/ }).click();
  assert.equal(await first.getByRole('button', { name: '削除する' }).count(), 1);
  const pending = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  assert.equal(pending.revision, before.revision);
  assert.equal(pending.data.settings.windows.length, before.data.settings.windows.length);
  await first.getByRole('button', { name: 'やめる' }).click();
  assert.equal(await first.getByRole('button', { name: '削除する' }).count(), 0);
  await first.getByRole('button', { name: /削除/ }).click();
  await first.getByRole('button', { name: '削除する' }).click();
  const after = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  assert.equal(after.data.settings.windows.length, before.data.settings.windows.length - 1);
  await page.locator('details summary').filter({ hasText: '登録済みの授業' }).click();
  const classRow = page.locator('details').filter({ hasText: '登録済みの授業' }).locator('.history-row').first();
  await classRow.getByRole('button', { name: /削除/ }).click();
  const classPending = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  assert.equal(classPending.data.settings.windows.length, after.data.settings.windows.length);
  await classRow.getByRole('button', { name: '削除する' }).click();
  const classAfter = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  assert.equal(classAfter.data.settings.windows.length, after.data.settings.windows.length - 1);
  const exceptionRow = page.locator('.history-row').filter({ hasText: '検証用の外出' }).first();
  await exceptionRow.getByRole('button', { name: /削除/ }).click();
  const exceptionPending = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  assert.equal(exceptionPending.data.settings.exceptions.length, 1);
  await exceptionRow.getByRole('button', { name: '削除する' }).click();
  const exceptionAfter = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  assert.equal(exceptionAfter.data.settings.exceptions.length, 0);
  await page.close();

  const failure = await browser.newPage();
  await failure.addInitScript((key) => {
    const original = Storage.prototype.getItem;
    let fail = true;
    Storage.prototype.getItem = function (name) {
      if (name === key && fail) {
        fail = false;
        throw new Error('読込失敗の検証');
      }
      return original.call(this, name);
    };
  }, storageKey);
  await failure.goto(url, { waitUntil: 'networkidle' });
  assert.equal(await failure.getByRole('heading', { name: '学習データを開けませんでした' }).count(), 1);
  assert.equal(await failure.getByRole('alert').filter({ hasText: '読込失敗の検証' }).count(), 1);
  await failure.getByRole('button', { name: 'もう一度読み込む' }).click();
  assert.equal(await failure.getByRole('heading', { name: '今日', level: 1 }).count(), 1);
  await failure.close();

  console.log('Settings regression smoke passed: focus, deletion confirmation, demo load retry');
} finally {
  await browser.close();
}
