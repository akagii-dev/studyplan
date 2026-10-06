import { startOfWeek } from '../../src/domain/calendar';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { progressContractFixture, contractDay } from '../fixtures/progressContract';
import { adjustmentFixture } from '../fixtures/adjustment';
import { createProgressBaseline } from '../../src/domain/progressReflection';
import { addDays, initialState, type AppState } from '../../src/domain/model';

async function seed(page: Page, state = progressContractFixture(), expectedRows = 6) {
  await page.clock.install({ time: new Date(`${contractDay}T12:00:00+09:00`) });
  await page.addInitScript((data) => {
    if (!localStorage.getItem('studyplan-demo-state-v1')) localStorage.setItem('studyplan-demo-state-v1', JSON.stringify({ revision: 1, data }));
  }, state);
  await page.goto('./');
  await expect(page.locator('.daily-record-row')).toHaveCount(expectedRows);
}

async function calendarSetting(page: Page, label: string, value: string) {
  await page.getByRole('button', { name: 'カレンダーの表示設定', exact: true }).click();
  await page.getByRole('dialog', { name: '表示設定', exact: true }).getByLabel(label, { exact: true }).selectOption(value);
  await page.keyboard.press('Escape');
}
const read = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('studyplan-demo-state-v1')!).data as AppState);
const nav = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();
const headerPositions = (page: Page) => page.locator('.future-week, .future-day').evaluateAll((elements) =>
  elements.map((element) => element.getBoundingClientRect().top + scrollY));

test('今日を含む週・同日の詳細往復・主画面再入場・日跨ぎと復帰で表示範囲を切り替える', async ({ page }, info) => {
  await seed(page);
  const before = await read(page);
  await nav(page, '今後の予定');
  const range = page.locator('.future-week time');
  await expect(range).toHaveAttribute('datetime', startOfWeek(contractDay));
  const dateHeading = page.locator('.future-day h2').filter({ has: page.locator(`time[datetime="${contractDay}"]`) });
  await expect(dateHeading.getByRole('button')).toHaveCount(0);
  await expect(dateHeading.locator('time')).not.toHaveAttribute('tabindex');
  await dateHeading.locator('time').click();
  await expect(page.locator('.future-week')).toBeVisible();
  await expect(page.locator('.calendar-grid')).toHaveCount(0);
  for (const name of ['前の週', '次の週']) {
    const arrow = page.getByRole('button', { name, exact: true });
    const box = (await arrow.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await arrow.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
    await expect(arrow).toBeFocused();
    expect(await arrow.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
  }
  if (info.project.name === 'wide') {
    const toggle = page.getByRole('button', { name: 'サイドバーを折りたたむ', exact: true });
    await toggle.focus(); await page.keyboard.press('Enter');
    const open = page.getByRole('button', { name: 'サイドバーを開く', exact: true });
    await expect(open).toHaveAttribute('aria-expanded', 'false');
    await expect(open).toBeFocused();
    await expect(page.locator('#app-sidebar')).toBeHidden();
    expect((await open.boundingBox())!.x).toBe(0);
    await page.screenshot({ path: info.outputPath('future-sidebar-collapsed.png'), fullPage: true });
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toBeFocused();
    await expect(page.locator('#app-sidebar')).toBeVisible();
  } else {
    await expect(page.locator('.sidebar-toggle')).toBeHidden();
    await expect(page.locator('#app-sidebar')).toBeVisible();
  }
  await page.locator('.future-balance > summary').click();
  await expect(page.getByRole('list', { name: '試験の優先度' })).toContainText('検証用試験 · 優先度：ふつう');
  await page.locator('.future-balance > summary').click();
  await nav(page, '次の週');
  await expect(range).toHaveAttribute('datetime', startOfWeek(addDays(contractDay, 7)));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(range).toHaveAttribute('datetime', startOfWeek(addDays(contractDay, 7)));
  await nav(page, 'カレンダー表示');
  await expect(page.locator('nav').getByRole('button', { name: '今後の予定', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: '一覧', exact: true })).toHaveCount(0);
  await expect(page.locator('.calendar-toolbar').getByRole('combobox')).toHaveCount(0);
  await expect(page.locator('.calendar-options')).toHaveCount(0);
  const toolbar = page.locator('.calendar-toolbar');
  for (const label of ['月', '週']) {
    await calendarSetting(page, '表示期間', label === '月' ? 'month' : 'week');
    await toolbar.getByRole('button', { name: '次の期間' }).click();
    const todayButton = toolbar.getByRole('button', { name: '今日', exact: true });
    await todayButton.press('Enter');
    await expect(todayButton).toBeFocused();
    await expect(page.locator('.calendar-grid')).toHaveClass(new RegExp(label === '月' ? 'month' : 'week'));
    await expect(toolbar.locator('h2')).toHaveText('2026年 9月');
    await expect(page.getByRole('complementary', { name: '選択した日の学習詳細' })).toBeHidden();
  }
  await calendarSetting(page, '表示期間', 'month');
  const grid = page.locator('.calendar-grid');
  const gridTop = await grid.evaluate(e => e.getBoundingClientRect().top + scrollY);
  const day = page.getByRole('button', { name: contractDay + 'を表示', exact: true });
  await day.press('Enter');
  await expect(page.getByRole('complementary', { name: '選択した日の学習詳細' })).toBeVisible();
  expect(await grid.evaluate(e => e.getBoundingClientRect().top + scrollY)).toBe(gridTop);
  await page.screenshot({ path: info.outputPath('calendar-detail-overlay.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(day).toBeFocused();
  await toolbar.getByRole('button', { name: '次の期間' }).click();
  const heldPeriod = await toolbar.locator('h2').innerText();
  await nav(page, '週間予定');
  await nav(page, 'カレンダー表示');
  await expect(toolbar.locator('h2')).toHaveText(heldPeriod);
  await nav(page, '週間予定');
  await expect(range).toHaveAttribute('datetime', startOfWeek(addDays(contractDay, 7)));
  await page.locator('.future-week').getByRole('button', { name: '今日', exact: true }).click();
  await expect(range).toHaveAttribute('datetime', startOfWeek(contractDay));
  await nav(page, '前の週');
  await expect(range).toHaveAttribute('datetime', startOfWeek(addDays(contractDay, -7)));
  await nav(page, '設定');
  await nav(page, '今後の予定');
  await expect(range).toHaveAttribute('datetime', startOfWeek(contractDay));
  expect((await read(page)).plan).toEqual(before.plan);
  expect((await read(page)).records).toEqual(before.records);
  await nav(page, '次の週');
  await page.clock.setFixedTime(new Date(`${addDays(contractDay, 1)}T00:01:00+09:00`));
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect(range).toHaveAttribute('datetime', startOfWeek(addDays(contractDay, 1)));
  await nav(page, '前の週');
  await nav(page, 'カレンダー表示');
  await page.clock.setFixedTime(new Date(`${addDays(contractDay, 2)}T00:01:00+09:00`));
  await nav(page, '週間予定');
  await expect(range).toHaveAttribute('datetime', startOfWeek(addDays(contractDay, 2)));
  await expect(page.locator('.page-transition:visible')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: info.outputPath('future-today-range.png'), fullPage: true });
});

for (const legacy of ['all', 'preset', 'numberEdit'] as const) {
  test(`過去日記録の旧${legacy}下書きを自由数値入力に復元する`, async ({ page }) => {
    const state = progressContractFixture();
    state.draft.progress = { date: addDays(contractDay, -1), materialId: 'partial', round: 0,
      choice: legacy === 'all' ? 'all' : legacy === 'preset' ? '5' : 'other', custom: legacy === 'numberEdit' ? '2' : '' };
    if (legacy === 'numberEdit') state.draft.numberEdits = { 'progress/old/追加問題数（1問単位）': { base: '2', text: '7' } };
    await seed(page, state);
    await nav(page, '記録履歴');
    await nav(page, '過去日の学習を記録');
    await expect(page.getByLabel('今回解いた問題数')).toHaveValue(legacy === 'all' ? '88' : legacy === 'preset' ? '5' : '7');
    await expect(page.getByRole('button', { name: /その他|残りすべて|^\d+\s*問$/ })).toHaveCount(0);
    expect((await read(page)).records).toEqual(state.records);
  });
}

test('予定外と過去日を同じ自由入力で記録し、単位・0・保存失敗・IME・二重送信を守る', async ({ page }, info) => {
  const state = progressContractFixture();
  state.settings.materials[0].unit = 'ページ';
  await seed(page, state);
  const before = await read(page);
  const checkDateWidth = async (form: ReturnType<Page['locator']>, screenshot: string) => {
    const date = form.getByLabel('記録対象日');
    for (const fontSize of ['', '28px']) {
      await date.evaluate((element, size) => { element.style.fontSize = size; }, fontSize);
      const bounds = await date.boundingBox();
      const field = await date.locator('..').boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(field!.x - 1);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(field!.x + field!.width + 1);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    await date.focus();
    await expect(date).toBeFocused();
    await page.screenshot({ path: info.outputPath(screenshot), fullPage: true });
    await date.evaluate((element) => { element.style.fontSize = ''; });
  };
  await page.locator('.outside-record > summary').click();
  const form = page.locator('.outside-record .study-record-form');
  const input = form.getByRole('textbox', { name: '今回進めた量（ページ）' });
  const submit = form.getByRole('button', { name: '記録する', exact: true });
  await expect(form.getByLabel('記録対象日')).toHaveValue(contractDay);
  await expect(form.getByLabel('記録対象日')).toHaveAttribute('readonly', '');
  await checkDateWidth(form, 'outside-record-date.png');
  for (const invalid of ['', '-1', '1.5', '101']) {
    await input.fill(invalid);
    await expect(submit).toBeDisabled();
  }
  await input.fill('0');
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await input.dispatchEvent('keydown', { key: 'Enter', repeat: true });
  expect((await read(page)).records).toEqual(before.records);
  await input.press('Enter');
  await expect(page.locator('.daily-record-saved')).toContainText('0ページを記録しました');
  await expect(input).toHaveValue('');
  expect((await read(page)).records).toHaveLength(before.records.length + 1);
  await nav(page, '記録履歴');
  await nav(page, '過去日の学習を記録');
  const past = page.locator('.study-record-form');
  await checkDateWidth(past, 'past-record-date.png');
  await past.getByLabel('記録対象日').fill(addDays(contractDay, -1));
  await expect(past.getByRole('textbox', { name: '今回進めた量（ページ）' })).toHaveValue('');
  await past.getByRole('textbox', { name: '今回進めた量（ページ）' }).fill('3');
  await page.evaluate(() => {
    const save = Storage.prototype.setItem;
    let once = true;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'studyplan-demo-state-v1' && once && JSON.parse(value).data.records.some((record: { count: number; materialId: string }) => record.materialId === 'missing' && record.count === 3)) {
        once = false;
        throw new Error('専用試験：記録の保存を一度だけ失敗');
      }
      return save.call(this, key, value);
    };
  });
  await past.getByRole('button', { name: '記録する', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('専用試験');
  await expect(past.getByRole('textbox', { name: '今回進めた量（ページ）' })).toHaveValue('3');
  expect((await read(page)).records).toHaveLength(before.records.length + 1);
  await past.getByRole('button', { name: '記録する', exact: true }).dblclick();
  await expect(page.locator('.progress-result')).toContainText('＋3ページを記録しました');
  await expect(page.getByRole('alert').filter({ hasText: '専用試験' })).toHaveCount(0);
  expect((await read(page)).records).toHaveLength(before.records.length + 2);
  await expect(past.getByRole('textbox', { name: '今回進めた量（ページ）' })).toHaveValue('');
  expect((await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('shared-free-record.png'), fullPage: true });
});

test('予定外記録は今日の予定行を増やさず、履歴と進捗だけに保存する', async ({ page }, info) => {
  const state = progressContractFixture();
  state.settings.materials.push({
    id: 'outside', name: '予定外の教材', examId: 'exam', unit: 'ページ',
    total: 10, order: 7, rounds: [{ completed: 0, minutes: 2 }],
  });
  state.plan!.settingsSnapshot = structuredClone(state.settings);
  await seed(page, state);
  const before = await read(page);
  const todaySlots = before.plan!.sessions.filter((session) => session.date === contractDay);
  await page.locator('.outside-record > summary').click();
  const form = page.locator('.outside-record .study-record-form');
  await form.getByLabel('教材', { exact: true }).selectOption('outside');
  await form.getByRole('textbox', { name: '今回進めた量（ページ）' }).fill('3');
  await form.getByRole('button', { name: '記録する', exact: true }).click();
  await expect(page.locator('.daily-record-saved')).toContainText('3ページを記録しました');
  const recorded = await read(page);
  expect(recorded.plan!.sessions.filter((session) => session.date === contractDay)).toEqual(todaySlots);
  expect(recorded.records).toHaveLength(before.records.length + 1);
  expect(recorded.records.filter((record) => record.materialId === 'outside')).toMatchObject([
    { date: contractDay, count: 3, round: 0, cancelled: false },
  ]);
  await expect(page.locator('.daily-record-row')).toHaveCount(6);
  await expect(page.locator('.daily-record-row').filter({ hasText: '予定外の教材' })).toHaveCount(0);
  await expect(form.locator('.progress-summary')).toContainText('完了 3ページ');
  await expect(form.locator('.progress-summary')).toContainText('残り 7ページ');
  const scheduled = page.locator('.daily-record-row').filter({ hasText: '未報告の教材' });
  await scheduled.getByRole('textbox').fill('2');
  await scheduled.getByRole('button', { name: '記録', exact: true }).click();
  await expect(scheduled).toContainText('あと8問');
  await expect(page.locator('.daily-record-saved')).toContainText('2問を記録しました');
  await page.reload();
  await expect(page.locator('.daily-record-row')).toHaveCount(6);
  await expect(page.locator('.daily-record-row').filter({ hasText: '予定外の教材' })).toHaveCount(0);
  const reloaded = await read(page);
  expect(reloaded.records).toHaveLength(before.records.length + 2);
  expect(reloaded.records.filter((record) => record.materialId === 'outside')).toEqual(
    recorded.records.filter((record) => record.materialId === 'outside'));
  expect(reloaded.plan!.sessions.filter((session) => session.date === contractDay)).toEqual(todaySlots);
  await page.locator('.outside-record > summary').click();
  await form.getByLabel('教材', { exact: true }).selectOption('outside');
  await expect(form.locator('.progress-summary')).toContainText('完了 3ページ');
  await expect(form.locator('.progress-summary')).toContainText('残り 7ページ');
  await page.screenshot({ path: info.outputPath('outside-record-keeps-schedule.png'), fullPage: true });
  await nav(page, '記録履歴');
  const history = page.getByRole('row').filter({ hasText: '予定外の教材' });
  await expect(history).toHaveCount(1);
  await expect(history).toContainText('＋3ページ');
  await page.screenshot({ path: info.outputPath('outside-record-history.png'), fullPage: true });
});

test('予定のある教材の別周回で13問記録しても、今日の予定へ混在させない', async ({ page }, info) => {
  const state = progressContractFixture();
  state.settings.materials[0].rounds.push({ completed: 0, minutes: 2 });
  state.plan!.settingsSnapshot = structuredClone(state.settings);
  await seed(page, state);
  const todaySlots = state.plan!.sessions.filter(session => session.date === contractDay);
  await page.locator('.outside-record > summary').click();
  const form = page.locator('.outside-record .study-record-form');
  await form.getByLabel('教材', { exact: true }).selectOption('missing');
  await form.getByLabel('周回', { exact: true }).selectOption('1');
  await form.getByRole('textbox', { name: '今回解いた問題数' }).fill('13');
  await form.getByRole('button', { name: '記録する', exact: true }).press('Enter');
  await expect(page.locator('.daily-record-saved')).toContainText('13問を記録しました');
  await expect(page.locator('.daily-record-row')).toHaveCount(6);
  await expect(page.locator('.daily-record-row').filter({ hasText: '2周目' })).toHaveCount(0);
  await expect(form.locator('.progress-summary')).toContainText('完了 13問');
  await expect(form.locator('.progress-summary')).toContainText('残り 87問');
  await expect(page.locator('.daily-record-row').filter({ hasText: '未報告の教材' })).toContainText('あと10問');
  await page.reload();
  const reloaded = await read(page);
  expect(reloaded.plan!.sessions.filter(session => session.date === contractDay)).toEqual(todaySlots);
  expect(reloaded.records.filter(r => r.materialId === 'missing' && r.round === 1)).toMatchObject([{ date: contractDay, count: 13, cancelled: false }]);
  await expect(page.locator('.daily-record-row')).toHaveCount(6);
  await expect(page.locator('.daily-record-row').filter({ hasText: '2周目' })).toHaveCount(0);
  await expect(page.locator('.page-transition:visible')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: info.outputPath('outside-round-keeps-schedule.png'), fullPage: true });
  await nav(page, '記録履歴');
  await expect(page.getByRole('row').filter({ hasText: '未報告の教材' })).toContainText('＋13問');
});

test('予定のない今日の実績詳細から予定外の入力へ移動し、保存前に実績を増やさない', async ({ page }, info) => {
  const state = progressContractFixture();
  state.settings.materials.push({ id: 'outside', name: '予定外の教材', examId: 'exam', total: 10, order: 7, rounds: [{ completed: 0, minutes: 2 }] });
  state.plan!.settingsSnapshot = structuredClone(state.settings);
  state.plan!.sessions = state.plan!.sessions.filter(session => session.date !== contractDay);
  state.records.push({ id: 'outside-record', date: contractDay, materialId: 'outside', round: 0, count: 3, cancelled: false, createdAt: contractDay, updatedAt: contractDay });
  await seed(page, state, 0);
  const before = await read(page);
  await nav(page, '今後の予定');
  await nav(page, 'カレンダー表示');
  await page.getByRole('button', { name: contractDay + 'を表示', exact: true }).press('Enter');
  const quantity = page.locator('.quantity-breakdown section').filter({ hasText: '予定外の教材' });
  await expect(quantity.locator('.progress-value')).toHaveText('3問');
  await quantity.getByRole('button', { name: '記録を確認・追加', exact: true }).press('Enter');
  await expect(page.locator('.outside-record')).toHaveAttribute('open', '');
  const form = page.locator('.outside-record .study-record-form');
  await expect(form.getByLabel('教材', { exact: true })).toHaveValue('outside');
  await expect(form.getByLabel('周回', { exact: true })).toHaveValue('0');
  const input = form.getByRole('textbox', { name: '今回解いた問題数' });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
  expect((await read(page)).records).toEqual(before.records);
  expect((await read(page)).plan).toEqual(before.plan);
  await input.fill('2');
  await input.press('Enter');
  await expect(page.locator('.daily-record-saved')).toContainText('2問を記録しました');
  await expect(page.locator('.daily-record-row')).toHaveCount(0);
  await expect(form.locator('.progress-summary')).toContainText('完了 5問');
  await expect(form.locator('.progress-summary')).toContainText('残り 5問');
  await expect(page.locator('.page-transition:visible')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: info.outputPath('outside-detail-target.png'), fullPage: true });
});

for (const responseLost of [false, true]) {
  test(`今日の保存${responseLost ? '応答消失' : '失敗'}後も再読込で入力を保持し同じ記録を再送する`, async ({ page }) => {
    await seed(page);
    const before = await read(page);
    const row = page.locator('.daily-record-row').filter({ has: page.getByText('未報告の教材', { exact: true }) });
    const input = row.getByRole('textbox');
    await input.fill('7');
    await page.evaluate((lost) => {
      const save = Storage.prototype.setItem;
      let once = true;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'studyplan-demo-state-v1' && once && JSON.parse(value).data.records.some((record: { count: number; materialId: string }) => record.materialId === 'missing' && record.count === 7)) {
          once = false;
          if (lost) save.call(this, key, value);
          throw new Error('専用試験：今日の記録保存を一度だけ失敗');
        }
        return save.call(this, key, value);
      };
    }, responseLost);
    await row.getByRole('button', { name: '記録', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('専用試験');
    await expect(input).toHaveValue('7');
    const afterFailure = await read(page);
    expect(afterFailure.records).toHaveLength(before.records.length + (responseLost ? 1 : 0));
    await row.getByRole('button', { name: '記録', exact: true }).click();
    await expect(page.locator('.daily-record-saved')).toContainText('7問を記録しました');
    await expect(page.getByRole('alert').filter({ hasText: '専用試験' })).toHaveCount(0);
    await expect(input).toHaveValue('');
    const saved = await read(page);
    expect(saved.records).toHaveLength(before.records.length + 1);
    if (responseLost) {
      expect(saved.records).toEqual(afterFailure.records);
      expect(saved.history).toEqual(afterFailure.history);
    }
    await input.fill('7');
    await input.press('Enter');
    await expect(input).toHaveValue('');
    expect((await read(page)).records).toHaveLength(before.records.length + 2);
  });
}

 test('休講不備の修正導線から単日・期間・対象コマを編集し、取消と再読込を保つ', async ({page},info) => {
  const state=progressContractFixture();
  state.settings.windows.push({...state.settings.windows[0],id:'class-check',kind:'class',name:'休講検証授業',start:840,end:940});
  state.settings.classCancellations=[{id:'invalid-off',from:addDays(contractDay,1),to:contractDay}];
  await seed(page,state);
  await nav(page,'設定');
  await page.getByRole('button',{name:'計画案を作成',exact:true}).click();
  const errors=page.locator('#settings-plan-check');
  await expect(errors).toContainText('休講');
  await errors.getByRole('button',{name:'修正する',exact:true}).click();
  await expect(page.getByRole('heading',{name:'休講・大学の休み'})).toBeVisible();
  const panel=page.locator('section').filter({has:page.getByRole('heading',{name:'休講・大学の休み'})});
  await panel.getByRole('button',{name:addDays(contractDay,1)+'の休講を編集'}).click();
  await panel.getByLabel('休講の終了日（この日を含む）').fill(addDays(contractDay,2));
  await panel.getByRole('button',{name:'休講を更新する',exact:true}).click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await panel.getByLabel('休講の期間').selectOption('single');
  await panel.getByLabel('休講日',{exact:true}).fill(contractDay);
  await panel.getByLabel('休講にする授業').selectOption('selected');
  await panel.getByRole('button',{name:'休講を追加する',exact:true}).click();
  await expect(panel.getByRole('alert')).toContainText('対象');
  await panel.getByRole('checkbox',{name:/休講検証授業/}).check();
  await panel.getByRole('button',{name:'休講を追加する',exact:true}).click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  const stored=await read(page);
  expect(stored.settings.classCancellations).toHaveLength(2);
  expect(stored.settings.classCancellations![1]).toMatchObject({from:contractDay,to:contractDay,classIds:['class-check']});
  expect(stored.records).toEqual(state.records);
  expect(stored.plan).toEqual(state.plan);
  await panel.getByRole('button',{name:contractDay+'の休講を取消',exact:true}).click();
  await panel.getByRole('button',{name:'休講を取り消す',exact:true}).click();
  expect((await read(page)).settings.classCancellations).toHaveLength(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect((await new AxeBuilder({page}).include('main').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:info.outputPath('class-cancellation-edit.png'),fullPage:true});
  await page.reload();
  expect((await read(page)).settings.classCancellations).toEqual(stored.settings.classCancellations!.slice(0,1));
});

// UI-only fixtures remain small, in memory, and share the current domain/store contract.
for (const scenario of ['通常', '空', '未配置', '競合', '長い教材名'] as const) {
  test('今後の予定の密度・主要導線・警告とアクセシビリティ：' + scenario, async ({ page }, info) => {
    const state = scenario === '空' ? initialState() : adjustmentFixture(contractDay);
    if (scenario === '未配置') {
      const session = state.plan!.sessions.find((item) => item.id === 'book-9')!;
      session.count = 3; session.end = session.start + 9;
      state.plan!.shortfalls = [{ materialId: 'book', round: 1, count: 3, minutes: 9, reason: '期限内の学習枠が足りません。' }];
    }
    if (scenario === '競合') {
      const session = state.plan!.sessions[0];
      session.fixed = true; session.start = 400; session.end = 418;
    }
    if (scenario === '長い教材名') {
      state.settings.materials[0].name = '行政書士試験対策・民法の事例問題と判例を詳しく確認するための長い名前の問題集・改訂版';
      state.settings.exams[0].name = '非常に長い名称の行政書士試験・総合対策';
      state.plan!.settingsSnapshot = structuredClone(state.settings);
    }
    await page.clock.install({ time: new Date(contractDay + 'T08:00:00+09:00') });
    await page.addInitScript((data) => {
      if (!localStorage.getItem('studyplan-demo-state-v1')) localStorage.setItem('studyplan-demo-state-v1', JSON.stringify({ revision: 1, data }));
    }, state);
    await page.goto('./');
    await nav(page, '今後の予定');
    const committed = (data: AppState) => ({ plan: data.plan, settings: data.settings, records: data.records, history: data.history });
    expect(committed(await read(page))).toEqual(committed(state));
    const view = page.locator('.future-page');
    for (const width of info.project.name === 'wide' ? [1280] : [320, 390]) {
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
      await expect(page.getByText('残量の内訳', { exact: true })).toHaveCount(0);
      await expect(view.locator('.future-work')).toHaveCount(0);
      await expect(view.locator('.future-week time')).toHaveAttribute('datetime', startOfWeek(contractDay));
      const calendar = view.getByRole('button', { name: 'カレンダー表示', exact: true });
      const menu = page.getByRole('region', { name: '計画の仕切り直し' });
      const restart = page.getByText('計画を仕切り直す', { exact: true });
      const management = page.getByText('計画を仕切り直す', { exact: true });
      await expect(menu).toBeHidden();
      for (const button of [calendar]) {
        await expect(button).toBeVisible();
        const box = (await button.boundingBox())!;
        expect(box.y + box.height).toBeLessThan(600);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
      }
      await expect(restart).toBeVisible();
      const balanceToggle = view.locator('.future-balance > summary');
      if (await balanceToggle.count()) {
        expect((await restart.boundingBox())!.y).toBeGreaterThan((await balanceToggle.boundingBox())!.y);
      }
      if (scenario === '空') {
        await expect(view.getByText('この週の予定はありません。', { exact: true })).toBeVisible();
        await expect(view.getByRole('region', { name: '未配置の学習' })).toHaveCount(0);
      } else {
        await expect(view.getByRole('button', { name: /^未消化\d+件・調整する$/ })).toHaveCount(0);
        await expect(view.getByText('昨日以前の未消化分なし', { exact: true })).toHaveCount(0);
        await expect(view.locator('.future-balance')).not.toHaveAttribute('open');
        await expect(view.getByRole('list', { name: '試験の優先度' })).toBeHidden();
        if (scenario === '未配置') {
          const warning = view.getByRole('region', { name: '未配置の学習' });
          await expect(warning).toContainText('未配置 1件・9分');
          await expect(warning).toContainText('3問');
          expect((await warning.boundingBox())!.y).toBeGreaterThan((await view.locator('.future-week').boundingBox())!.y);
          const reason = warning.locator('summary');
          await reason.focus(); await page.keyboard.press('Enter');
          await expect(warning.getByText('期限内の学習枠が足りません。', { exact: true })).toBeVisible();
          await page.keyboard.press('Enter');
        }
        if (scenario === '競合') {
          await expect(view.locator('.future-reconciliation')).toContainText('調整未反映・要確認。現在の計画を保持しています。');
          await expect(view).toContainText('配置要確認');
        }
        if (scenario === '通常') expect((await view.locator('.future-day').first().boundingBox())!.y).toBeLessThan(500);
        if (scenario === '長い教材名') {
          await expect(view.locator('.future-day li').first()).toContainText(state.settings.materials[0].name);
          expect(await view.locator('.future-day li > span:first-child').first().evaluate((element) => getComputedStyle(element).textOverflow)).not.toBe('ellipsis');
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await expect(page.locator('.page-transition:visible')).toHaveCSS('opacity', '1');
      expect((await new AxeBuilder({ page }).include('.future-page').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
      // Enter, Tab and focus restoration use native controls, without changing the plan.
      const positions = await headerPositions(page);
      await management.focus(); await page.keyboard.press('Enter');
      await expect(menu.getByLabel('開始日', { exact: true })).toBeFocused();
      expect(await headerPositions(page)).toEqual(positions);
      await expect(page.getByRole('button', { name: '管理を閉じる', exact: true })).toHaveCount(0);
      if (scenario === '通常') await page.screenshot({ path: info.outputPath('future-management-open-' + width + '.png'), fullPage: true });
      await expect(menu.getByLabel('開始日', { exact: true })).toBeFocused();
      expect(await headerPositions(page)).toEqual(positions);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const create = menu.getByRole('button', { name: 'この日から案を作成', exact: true });
      // Chromium's native date input has several keyboard-editable segments.
      for (let step = 0; step < 5 && !(await create.evaluate((element) => element === document.activeElement)); step++) await page.keyboard.press('Tab');
      await expect(create).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(menu.getByRole('button', { name: 'やめる', exact: true })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(restart).toBeFocused();
      expect(await restart.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
      expect(committed(await read(page))).toEqual(committed(state));
      await page.keyboard.press('Escape');
      await expect(management).toBeFocused();
      await expect(page.getByRole('region', { name: '計画の仕切り直し' })).toBeHidden();
      if (scenario === '通常') {
        await management.click(); await management.click();
        await expect(menu).toBeHidden();
        await management.press('Enter');
        await menu.getByRole('button', { name: 'やめる', exact: true }).press('Escape');
        await expect(menu).toBeHidden();
        await expect(management).toBeFocused();
        expect(await headerPositions(page)).toEqual(positions);
      }
      if (scenario !== '空') {
        const summary = view.locator('.future-balance > summary');
        await summary.focus(); await page.keyboard.press('Enter');
        await expect(view.getByRole('list', { name: '試験の優先度' })).toBeVisible();
        const first = view.getByRole('checkbox').first();
        await first.check();
        await expect(view.getByRole('button', { name: '配分案を確認', exact: true })).toBeEnabled();
        await summary.focus(); await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        await expect(first).toBeChecked();
        await page.keyboard.press('Enter');
        expect(committed(await read(page))).toEqual(committed(state));
      }
      await view.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath('future-' + scenario + '-' + width + '.png'), fullPage: true });
    }
    await page.reload();
    await nav(page, '今後の予定');
    expect(committed(await read(page))).toEqual(committed(state));
  });
}

test('今後の予定の全配色・拡大・文字間隔でもラベルと操作を保つ', async ({ page }, info) => {
  const state = adjustmentFixture(contractDay);
  await page.clock.install({ time: new Date(contractDay + 'T08:00:00+09:00') });
  await page.addInitScript((data) => localStorage.setItem('studyplan-demo-state-v1', JSON.stringify({ revision: 1, data })), state);
  await page.goto('./'); await nav(page, '今後の予定');
  const view = page.locator('.future-page');
  for (const theme of ['mint', 'sky', 'lime']) for (const appearance of ['light', 'dark']) {
    await page.evaluate(({ theme, appearance }) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.appearance = appearance;
    }, { theme, appearance });
    // Check settled colors after the existing page fade; do not sample partial opacity.
    await page.clock.runFor(150);
    await expect(page.locator('.page-transition')).toHaveCSS('opacity', '1');
    const selected = view.getByRole('button', { name: '週間予定', exact: true });
    await expect(selected).toHaveClass('active');
    // Theme changes also transition button backgrounds for 120ms; wait for settled paint.
    await expect.poll(() => selected.evaluate(element =>
      element.getAnimations().filter(animation => animation instanceof CSSTransition &&
        animation.playState === 'running').length)).toBe(0);
    expect(await selected.evaluate((element) => getComputedStyle(element).color)).not.toBe(
      await selected.evaluate((element) => getComputedStyle(element).backgroundColor));
    expect((await new AxeBuilder({ page }).include('.future-page').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    const focus = view.getByRole('button', { name: '次の週', exact: true });
    await focus.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
    await expect(focus).toBeFocused();
    expect(await focus.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
  }
  // Browser zoom shrinks the CSS layout viewport. Also enlarge all text to 200%.
  await page.setViewportSize({ width: info.project.name === 'wide' ? 640 : 320, height: 844 });
  await page.addStyleTag({ content: ':root { font-size: 28px; } :is(.future-page, .future-heading) * { letter-spacing: .12em; word-spacing: .16em; line-height: 1.5; } .future-page p { margin-block-end: 2em; }' });
  const positions = await headerPositions(page);
  const management = page.getByText('計画を仕切り直す', { exact: true });
  await management.press('Enter');
  const menu = page.getByRole('region', { name: '計画の仕切り直し' });

  expect(await headerPositions(page)).toEqual(positions);
  const panel = (await menu.boundingBox())!;
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect((await new AxeBuilder({ page }).include('.future-page').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('future-management-enlarged.png'), fullPage: true });
  await menu.getByRole('button', { name: 'やめる', exact: true }).press('Escape');
  await expect(management).toBeFocused();
  expect(await headerPositions(page)).toEqual(positions);
  const calendar = view.getByRole('button', { name: 'カレンダー表示', exact: true });
  await expect(calendar).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await calendar.focus(); await page.keyboard.press('Enter');
  const gear = page.getByRole('button', { name: 'カレンダーの表示設定', exact: true });
  await expect(gear).toHaveAttribute('aria-expanded', 'false');
  expect((await gear.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.addStyleTag({ content: '.calendar-toolbar *, .calendar-display-settings *, .day-panel * { letter-spacing: .12em; word-spacing: .16em; line-height: 1.5; }' });
  const grid = page.locator('.calendar-grid');
  const beforeDetail = await grid.evaluate(e => e.getBoundingClientRect().top + scrollY);
  await page.getByRole('button', { name: addDays(contractDay, 1) + 'を表示', exact: true }).press('Enter');
  const detailPanel = page.getByRole('complementary', { name: '選択した日の学習詳細' });
  await expect(detailPanel).toBeVisible();
  await expect(page.locator('.page-transition')).toHaveCSS('opacity', '1');
  expect(await grid.evaluate(e => e.getBoundingClientRect().top + scrollY)).toBe(beforeDetail);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect((await new AxeBuilder({ page }).include('.calendar-toolbar').include('.day-panel').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('calendar-text-spacing-detail.png'), fullPage: true });
  await detailPanel.getByRole('button', { name: '詳細を閉じる' }).press('Escape');
  await nav(page, '週間予定');
  await expect(calendar).not.toBeFocused();
  await calendar.press('Enter');
  await expect(page.getByRole('heading', { name: '詳細カレンダー', level: 1 })).toBeFocused();
  await page.getByRole('button', { name: '週間予定', exact: true }).press('Enter');
  await expect(calendar).toBeFocused();
  await view.locator('.future-balance > summary').click();
  await expect(view.getByRole('checkbox').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('future-text-spacing.png'), fullPage: true });
});

test('カレンダーは週単位の7列/2列と月末の罫線を保ち、拡大・往復でも配置を揃える', async ({ page }, info) => {
  const state = progressContractFixture();
  state.settings.exams.push({ ...state.settings.exams[0], id: 'review-other', name: '別の試験' });
  state.plan!.settingsSnapshot = structuredClone(state.settings);
  state.plan!.sessions.push(...Array.from({ length: 16 }, (_, i) => ({
    id: `review-${i}`, date: '2026-10-25', examId: i < 8 ? 'exam' : 'review-other',
    materialId: '', round: 0, kind: 'review' as const, count: 0, fixed: false,
    start: 480 + i * 40, end: 480 + (i + 1) * 40 + (i === 15 ? 55 : 0),
  })));
  await seed(page, state);
  const before = await read(page);
  await nav(page, '今後の予定');
  await nav(page, 'カレンダー表示');
  await expect(page.locator('.page-transition')).toHaveCSS('animation-duration', '0.28s');
  const todayDate = page.locator('.day.today .date-number');
  await expect(todayDate).toHaveText('24');
  expect((await todayDate.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole('button', { name: /^(内容|学習量)$/ })).toHaveCount(0);
  await todayDate.press('Enter');
  await expect(page.locator('.day-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(todayDate).toBeFocused();
  await page.screenshot({ path: info.outputPath('calendar-restored-controls.png'), fullPage: true });
  await nav(page, '次の期間');
  const cell = (date: string) => page.locator('.day').filter({ has: page.getByRole('button', { name: new RegExp(`^${date}を表示`) }) });
  const review = cell('2026-10-25');
  await expect(review).toContainText('復習 5時間 20分');
  await expect(review).toContainText('復習 6時間 15分');
  await expect(cell('2026-10-18').locator('.calendar-event')).toHaveCount(0);
  for (const date of ['2026-10-18', '2026-10-19', '2026-10-31', '2026-11-08']) {
    expect(await cell(date).evaluate(element => ({ outline: getComputedStyle(element).outlineWidth, border: getComputedStyle(element).borderRightWidth })))
      .toEqual({ outline: '1px', border: '0px' });
  }
  const expectedColumns = info.project.name === 'wide' ? 7 : 2;
  const columns = () => page.locator('.calendar-week-days').first().evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(await columns()).toBe(expectedColumns);
  await page.screenshot({ path: info.outputPath('calendar-grid-month.png'), fullPage: true });
  await review.locator('.date-number').press('Enter');
  const panel = page.getByRole('complementary', { name: '選択した日の学習詳細' });
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(review.locator('.date-number')).toBeFocused();
  await calendarSetting(page, '表示期間', 'week');
  await expect(page.locator('.day')).toHaveCount(7);
  expect(await columns()).toBe(expectedColumns);
  await expect(page.getByRole('button', { name: '一覧', exact: true })).toHaveCount(0);

  await nav(page, '週間予定');
  await nav(page, 'カレンダー表示');
  await expect(page.locator('.calendar-grid.week')).toBeVisible();
  await calendarSetting(page, '表示期間', 'month');
  for (const destination of ['今日', '記録履歴', '設定']) {
    await page.locator('nav').getByRole('button', { name: destination, exact: true }).press('Enter');
    await expect(page.locator('.page-transition:visible')).toHaveCSS('animation-duration', '0.28s');
  }
  await nav(page, '今後の予定');
  await nav(page, 'カレンダー表示');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('.page-transition').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await page.addStyleTag({ content: ':root { font-size: 28px; } .calendar-grid * { letter-spacing: .12em; word-spacing: .16em; line-height: 1.5; }' });
  await expect(page.locator('html')).toHaveCSS('font-size', '28px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await review.locator('.date-number').press('Enter');
  await page.screenshot({ path: info.outputPath('calendar-grid-enlarged.png'), fullPage: true });
  expect((await new AxeBuilder({ page }).include('.calendar-grid').include('.day-panel').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  const after = await read(page);
  expect(after.plan).toEqual(before.plan);
  expect(after.records).toEqual(before.records);
});

test('表示設定は歯車のそばで3選択を縦に並べ、旧詳細密度を安全に表示し保持・開閉を行う', async ({ page }, info) => {
  const state = progressContractFixture();
  state.calendarDensity = { month: 'detailed', week: 'detailed', list: 'detailed' };
  state.settings.exams.push({ ...state.settings.exams[0], id: 'other', name: '別の試験' });
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.assign(window, { calendarSelectFocus: calls });
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function(options?: FocusOptions) {
      if (this.matches('.calendar-display-settings select')) calls.push(this.getAttribute('id') ?? 'select');
      focus.call(this, options);
    };
  });
  await seed(page, state);
  await expect(page.getByRole('heading', { name: '今日', level: 1, exact: true })).not.toBeFocused();
  const before = await read(page);
  await nav(page, '今後の予定'); await nav(page, 'カレンダー表示');
  await expect(page.locator('.page-transition')).toHaveCSS('opacity', '1');
  const gear = page.getByRole('button', { name: 'カレンダーの表示設定', exact: true });
  const popup = page.getByRole('dialog', { name: '表示設定', exact: true });
  const grid = page.locator('.calendar-grid');
  await expect(grid).toHaveClass(/density-standard/);
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(gear).toHaveAttribute('aria-haspopup', 'dialog');
  const todayBox = (await page.locator('.calendar-toolbar').getByRole('button', { name: '今日', exact: true }).boundingBox())!;
  const gearBox = (await gear.boundingBox())!;
  expect(gearBox.x).toBeGreaterThanOrEqual(todayBox.x + todayBox.width);
  expect(gearBox.y).toBe(todayBox.y);
  const selectedDate = await page.locator('.date-number[aria-pressed="true"]').getAttribute('aria-label');
  const scroll = await page.evaluate(() => scrollY);
  const gridTop = await grid.evaluate(e => e.getBoundingClientRect().top + scrollY);
  for (let opening = 0; opening < 2; opening++) {
    await gear.click();
    await expect(popup).toBeVisible();
    expect(await popup.getByRole('combobox').evaluateAll(elements => elements.some(e => e === document.activeElement))).toBe(false);
    expect(await page.evaluate(() => (window as unknown as { calendarSelectFocus: string[] }).calendarSelectFocus)).toEqual([]);
    expect(await gear.evaluate(e => getComputedStyle(e).outlineStyle)).toBe('none');
    const pointerBox = (await popup.boundingBox())!;
    expect(pointerBox.x).toBeGreaterThanOrEqual(12);
    expect(pointerBox.y).toBeGreaterThanOrEqual(12);
    expect(Math.min(Math.abs(pointerBox.y - gearBox.y - gearBox.height), Math.abs(pointerBox.y + pointerBox.height - gearBox.y))).toBeLessThanOrEqual(9);
    if (opening === 0) await page.screenshot({ path: info.outputPath('calendar-settings-pointer.png'), fullPage: true });
    await popup.getByRole('button', { name: '表示設定を閉じる' }).click();
    await expect(popup).toHaveCount(0); await expect(gear).not.toBeFocused();
  }
  await gear.focus(); await page.keyboard.press('Enter');
  await expect(gear).toHaveAttribute('aria-expanded', 'true');
  await expect(gear).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { calendarSelectFocus: string[] }).calendarSelectFocus)).toEqual([]);
  await page.keyboard.press('Tab');
  await expect(popup.getByRole('button', { name: '表示設定を閉じる' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(popup.getByLabel('対象の試験', { exact: true })).toBeFocused();
  expect(await popup.getByLabel('対象の試験', { exact: true }).evaluate(e => getComputedStyle(e).outlineStyle)).not.toBe('none');
  const fields = popup.getByRole('combobox');
  await expect(fields).toHaveCount(3);
  expect(await popup.locator('label').allTextContents()).toEqual(['対象の試験', '表示期間', '表示密度']);
  expect(await popup.getByLabel('表示密度', { exact: true }).locator('option').allTextContents()).toEqual(['コンパクト', '標準']);
  await expect(popup.getByLabel('表示密度', { exact: true })).toHaveValue('standard');
  const positions = await fields.evaluateAll(elements => elements.map(e => e.getBoundingClientRect().top));
  expect(positions[0]).toBeLessThan(positions[1]); expect(positions[1]).toBeLessThan(positions[2]);
  const box = (await popup.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(12); expect(box.y).toBeGreaterThanOrEqual(12);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width - 11);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height - 11);
  expect(box.width).toBeLessThanOrEqual(330); expect(box.height).toBeLessThan(300);
  expect(Math.min(Math.abs(box.y - gearBox.y - gearBox.height), Math.abs(box.y + box.height - gearBox.y))).toBeLessThanOrEqual(9);
  await page.keyboard.press('Shift+Tab');
  await expect(popup.getByRole('button', { name: '表示設定を閉じる' })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(popup.getByLabel('表示密度', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(popup.getByRole('button', { name: '表示設定を閉じる' })).toBeFocused();
  await popup.getByLabel('表示密度', { exact: true }).selectOption('compact');
  await expect(grid).toHaveClass(/density-compact/);
  expect((await new AxeBuilder({ page }).include('.calendar-display-settings').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('calendar-display-settings.png'), fullPage: true });
  await popup.getByLabel('表示密度', { exact: true }).selectOption('standard');
  await expect(grid).toHaveClass(/density-standard/);
  await popup.getByLabel('表示密度', { exact: true }).selectOption('compact');
  await popup.getByRole('button', { name: '表示設定を閉じる' }).press('Enter');
  await expect(popup).toHaveCount(0); await expect(gear).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  expect(await grid.evaluate(e => e.getBoundingClientRect().top + scrollY)).toBe(gridTop);
  expect(await page.locator('.date-number[aria-pressed="true"]').getAttribute('aria-label')).toBe(selectedDate);
  await gear.press('Enter');
  await popup.getByLabel('対象の試験', { exact: true }).selectOption('other');
  await expect(page.locator('.calendar-event')).toHaveCount(0);
  await popup.getByLabel('対象の試験', { exact: true }).selectOption('all');
  await expect(page.locator('.calendar-event').first()).toBeVisible();
  await popup.getByLabel('表示期間', { exact: true }).selectOption('week');
  await expect(grid).toHaveClass(/week.*density-standard/);
  await expect(popup.getByLabel('表示密度', { exact: true })).toHaveValue('standard');
  await popup.getByLabel('表示密度', { exact: true }).selectOption('compact');
  await expect(grid).toHaveClass(/density-compact/);
  await popup.getByLabel('表示密度', { exact: true }).selectOption('standard');
  await page.keyboard.press('Escape'); await expect(gear).toBeFocused();
  await gear.press('Enter');
  await page.locator('.calendar-period h2').click();
  await expect(popup).toHaveCount(0); await expect(gear).not.toBeFocused();
  await expect(gear).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: addDays(contractDay, 1) + 'を表示', exact: true }).press('Enter');
  const detail = page.getByRole('complementary', { name: '選択した日の学習詳細' });
  await expect(detail).toBeVisible(); await expect(detail.locator('.planned-time').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload(); await nav(page, '今後の予定'); await nav(page, 'カレンダー表示');
  await expect(grid).toHaveClass(/month.*density-compact/);
  await calendarSetting(page, '表示期間', 'week'); await expect(grid).toHaveClass(/week.*density-standard/);
  const after = await read(page);
  expect(after.calendarDensity).toEqual({ month: 'compact', week: 'standard', list: 'detailed' });
  expect(after.plan).toEqual(before.plan); expect(after.records).toEqual(before.records); expect(after.settings).toEqual(before.settings);
  await expect(page.locator('.page-transition')).toHaveCSS('opacity', '1');
  await gear.press('Enter');
  await page.addStyleTag({ content: ':root { font-size: 28px; } .calendar-display-settings * { letter-spacing: .12em; word-spacing: .16em; line-height: 1.5; }' });
  await page.setViewportSize({ width: info.project.name === 'wide' ? 640 : 320, height: 844 });
  await expect.poll(() => popup.evaluate(e => { const r = e.getBoundingClientRect(); return r.x >= 0 && r.right <= innerWidth; })).toBe(true);
  const enlarged = (await popup.boundingBox())!;
  expect(enlarged.x).toBeGreaterThanOrEqual(0); expect(enlarged.x + enlarged.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('calendar-display-settings-enlarged.png'), fullPage: true });
  await page.keyboard.press('Escape'); await expect(gear).toBeFocused();
  await page.locator('nav').getByRole('button', { name: '今日', exact: true }).click();
  const todayHeading = page.getByRole('heading', { name: '今日', level: 1, exact: true });
  await expect(todayHeading).toBeVisible(); await expect(todayHeading).not.toBeFocused();
  expect(await todayHeading.evaluate(e => getComputedStyle(e).outlineStyle)).toBe('none');
  await expect(page.locator('.page-transition')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: info.outputPath('today-pointer-navigation.png'), fullPage: true });
  const futureNav = page.locator('nav').getByRole('button', { name: '今後の予定', exact: true });
  await futureNav.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '今後の予定', level: 1, exact: true })).toBeFocused();
});

test('今日の残りと折りたたみ進捗を円・直線で共有し、追加・訂正・取消と週間へ反映する', async ({ page }, info) => {
  const state = adjustmentFixture(contractDay);
  state.settings.materials[0].name = '長い教材名の基礎問題集と確認演習'.repeat(4);
  state.settings.materials[1].unit = 'ページ';
  for (const [index, count] of [15, 6, 3, 3, 3].entries()) {
    state.plan!.sessions[index].count = count;
    state.plan!.sessions[index].end = state.plan!.sessions[index].start + count * 3;
  }
  state.plan!.settingsSnapshot = structuredClone(state.settings);
  state.plan!.progressBaseline = createProgressBaseline(state.plan!, []);
  await seed(page, state, 2);
  const row = page.locator('.daily-record-row').filter({ hasText: state.settings.materials[0].name });
  const input = row.getByRole('textbox', { name: /今回解いた問題数/ });
  const panel = page.locator('.today-study-progress');
  const item = panel.locator('li').filter({ hasText: state.settings.materials[0].name });
  const baseline = await read(page);
  await expect(row.locator('.progress-value')).toHaveText('あと15問');
  await expect(item).toContainText('0/15問 · あと15問');
  await expect(item.locator('.today-study-circle-center strong')).toHaveText(state.settings.materials[0].name);
  await expect(panel.locator('li').filter({ hasText: '別問題集' })).toContainText('あと9ページ');
  const summary = panel.locator('summary');
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(item).toBeHidden();
  await page.keyboard.press('Enter'); await expect(item).toBeVisible();
  await panel.getByRole('button', { name: '直線型', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(item.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  expect(await read(page)).toEqual(baseline);
  for (const [count, expected, total] of [[6, 'あと9問', 6], [4, 'あと5問', 10], [5, '✅完了', 15]] as const) {
    await input.fill(String(count)); await input.press('Enter');
    await expect(row.locator('.progress-value')).toHaveText(expected);
    await expect(item).toContainText(`${total}/15問 · ${expected}`);
    await expect(page.locator('.daily-record-saved')).toContainText(expected);
    await expect(row.getByRole('textbox', { name: /今回解いた問題数/ })).toHaveValue('');
  }
  await expect(item.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  await expect(row.getByRole('checkbox')).toHaveCount(0);
  await page.reload(); await expect(row.locator('.progress-value')).toHaveText('✅完了');
  for (const shape of ['円型', '直線型']) {
    const shapeButton = panel.getByRole('button', { name: shape, exact: true });
    await shapeButton.click();
    await expect(page.locator('.page-transition')).toHaveCSS('opacity', '1');
    await shapeButton.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect((await new AxeBuilder({ page }).include('main').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`today-progress-${shape === '円型' ? 'circle' : 'line'}.png`), fullPage: true });
  }
  await nav(page, '今後の予定');
  const day = page.locator('.future-day').filter({ has: page.locator(`time[datetime="${contractDay}"]`) });
  await expect(day.locator('li').filter({ hasText: state.settings.materials[0].name })).toContainText('✅完了');
  await nav(page, '記録履歴');
  const last = page.getByRole('row').filter({ hasText: state.settings.materials[0].name }).filter({ hasText: '＋5問' });
  await last.getByRole('button', { name: '訂正', exact: true }).click();
  await page.getByRole('textbox', { name: '訂正後の問題数' }).fill('3'); await nav(page, '訂正を保存');
  await nav(page, '今日'); await expect(row.locator('.progress-value')).toHaveText('あと2問');
  await expect(item).toContainText('13/15問 · あと2問');
  await nav(page, '記録履歴');
  const corrected = page.getByRole('row').filter({ hasText: state.settings.materials[0].name }).filter({ hasText: '＋3問' });
  await corrected.getByRole('button', { name: '取消', exact: true }).click(); await nav(page, '取消を確定');
  await nav(page, '今日'); await expect(row.locator('.progress-value')).toHaveText('あと5問');
  await expect(item).toContainText('10/15問 · あと5問');
  await nav(page, '今後の予定');
  await expect(day.locator('li').filter({ hasText: state.settings.materials[0].name })).toContainText('あと5問');
});
