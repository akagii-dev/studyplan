import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { progressContractFixture, contractDay } from '../fixtures/progressContract';
import { addDays, type AppState } from '../../src/domain/model';

async function seed(page: Page, state = progressContractFixture()) {
  await page.clock.install({ time: new Date(`${contractDay}T12:00:00+09:00`) });
  await page.addInitScript((data) => {
    if (!localStorage.getItem('studyplan-demo-state-v1')) localStorage.setItem('studyplan-demo-state-v1', JSON.stringify({ revision: 1, data }));
  }, state);
  await page.goto('./');
  await expect(page.locator('.daily-record-row')).toHaveCount(6);
}
const read = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('studyplan-demo-state-v1')!).data as AppState);
const nav = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();

test('今日起点・同日の詳細往復・主画面再入場・日跨ぎと復帰で表示範囲を切り替える', async ({ page }, info) => {
  await seed(page);
  const before = await read(page);
  await nav(page, '今後の予定');
  const range = page.locator('.future-week time');
  await expect(range).toHaveAttribute('datetime', contractDay);
  await expect(page.getByRole('list', { name: '試験の優先度' })).toContainText('検証用試験 · 優先度：ふつう');
  await nav(page, '次の週');
  await expect(range).toHaveAttribute('datetime', addDays(contractDay, 7));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(range).toHaveAttribute('datetime', addDays(contractDay, 7));
  await nav(page, '詳細カレンダーを見る');
  await nav(page, '← 今後の予定へ戻る');
  await expect(range).toHaveAttribute('datetime', addDays(contractDay, 7));
  await nav(page, '今日から');
  await expect(range).toHaveAttribute('datetime', contractDay);
  await nav(page, '前の週');
  await expect(range).toHaveAttribute('datetime', addDays(contractDay, -7));
  await nav(page, '設定');
  await nav(page, '今後の予定');
  await expect(range).toHaveAttribute('datetime', contractDay);
  expect((await read(page)).plan).toEqual(before.plan);
  expect((await read(page)).records).toEqual(before.records);
  await nav(page, '次の週');
  await page.clock.setFixedTime(new Date(`${addDays(contractDay, 1)}T00:01:00+09:00`));
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect(range).toHaveAttribute('datetime', addDays(contractDay, 1));
  await nav(page, '前の週');
  await nav(page, '詳細カレンダーを見る');
  await page.clock.setFixedTime(new Date(`${addDays(contractDay, 2)}T00:01:00+09:00`));
  await nav(page, '← 今後の予定へ戻る');
  await expect(range).toHaveAttribute('datetime', addDays(contractDay, 2));
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
    await expect(page.getByLabel('追加問題数（1問単位）')).toHaveValue(legacy === 'all' ? '88' : legacy === 'preset' ? '5' : '7');
    await expect(page.getByRole('button', { name: /その他|残りすべて|^\d+\s*問$/ })).toHaveCount(0);
    expect((await read(page)).records).toEqual(state.records);
  });
}

test('予定外と過去日を同じ自由入力で記録し、単位・0・保存失敗・IME・二重送信を守る', async ({ page }, info) => {
  const state = progressContractFixture();
  state.settings.materials[0].unit = 'ページ';
  await seed(page, state);
  const before = await read(page);
  await page.locator('.outside-record > summary').click();
  const form = page.locator('.outside-record .study-record-form');
  const input = form.getByRole('textbox', { name: '追加量（1ページ単位）' });
  const submit = form.getByRole('button', { name: '記録する', exact: true });
  await expect(form.getByLabel('記録対象日')).toHaveValue(contractDay);
  await expect(form.getByLabel('記録対象日')).toHaveAttribute('readonly', '');
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
  await past.getByLabel('記録対象日').fill(addDays(contractDay, -1));
  await expect(past.getByRole('textbox', { name: '追加量（1ページ単位）' })).toHaveValue('');
  await past.getByRole('textbox', { name: '追加量（1ページ単位）' }).fill('3');
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
  await expect(past.getByRole('textbox', { name: '追加量（1ページ単位）' })).toHaveValue('3');
  expect((await read(page)).records).toHaveLength(before.records.length + 1);
  await past.getByRole('button', { name: '記録する', exact: true }).dblclick();
  await expect(page.locator('.progress-result')).toContainText('＋3ページを記録しました');
  await expect(page.getByRole('alert').filter({ hasText: '専用試験' })).toHaveCount(0);
  expect((await read(page)).records).toHaveLength(before.records.length + 2);
  await expect(past.getByRole('textbox', { name: '追加量（1ページ単位）' })).toHaveValue('');
  expect((await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('shared-free-record.png'), fullPage: true });
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
