import { startOfWeek } from '../../src/domain/calendar';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { progressContractFixture, contractDay } from '../fixtures/progressContract';
import { adjustmentFixture } from '../fixtures/adjustment';
import { addDays, initialState, type AppState } from '../../src/domain/model';

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

test('今日を含む週・同日の詳細往復・主画面再入場・日跨ぎと復帰で表示範囲を切り替える', async ({ page }, info) => {
  await seed(page);
  const before = await read(page);
  await nav(page, '今後の予定');
  const range = page.locator('.future-week time');
  await expect(range).toHaveAttribute('datetime', startOfWeek(contractDay));
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
  await nav(page, '← 今後の予定へ戻る');
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
  await nav(page, '← 今後の予定へ戻る');
  await expect(range).toHaveAttribute('datetime', startOfWeek(addDays(contractDay, 2)));
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
  const input = form.getByRole('textbox', { name: '追加量（1ページ単位）' });
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
      const restart = view.getByRole('button', { name: '計画を仕切り直す', exact: true });
      const management = page.getByRole('button', { name: '管理', exact: true });
      await expect(restart).toBeHidden();
      for (const button of [calendar, management]) {
        await expect(button).toBeVisible();
        const box = (await button.boundingBox())!;
        expect(box.y + box.height).toBeLessThan(600);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
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
      expect((await new AxeBuilder({ page }).include('.future-page').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
      // Enter, Tab and focus restoration use native controls, without changing the plan.
      await management.focus(); await page.keyboard.press('Enter');
      await expect(restart).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(view.getByLabel('開始日', { exact: true })).toBeFocused();
      const create = view.getByRole('button', { name: 'この日から案を作成', exact: true });
      // Chromium's native date input has several keyboard-editable segments.
      for (let step = 0; step < 5 && !(await create.evaluate((element) => element === document.activeElement)); step++) await page.keyboard.press('Tab');
      await expect(create).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(view.getByRole('button', { name: 'やめる', exact: true })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(restart).toBeFocused();
      expect(await restart.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
      expect(committed(await read(page))).toEqual(committed(state));
      await page.keyboard.press('Escape');
      await expect(management).toBeFocused();
      await expect(page.getByRole('region', { name: '予定の管理' })).toBeHidden();
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
    // Measure the selected theme after the shared background transition has settled.
    await expect.poll(async () => {
      await page.clock.runFor(150);
      return page.getByRole('button', { name: '管理', exact: true }).evaluate((element) => {
        const hex = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
        const rgb = hex.slice(1).match(/../g)!.map((component) => parseInt(component, 16));
        return getComputedStyle(element).backgroundColor === 'rgb(' + rgb.join(', ') + ')';
      });
    }).toBe(true);
    expect((await new AxeBuilder({ page }).include('.future-page').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    const focus = view.getByRole('button', { name: '次の週', exact: true });
    await focus.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
    await expect(focus).toBeFocused();
    expect(await focus.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
  }
  // Browser zoom shrinks the CSS layout viewport. Also enlarge all text to 200%.
  await page.setViewportSize({ width: info.project.name === 'wide' ? 640 : 320, height: 844 });
  await page.addStyleTag({ content: ':root { font-size: 28px; } .future-page * { letter-spacing: .12em; word-spacing: .16em; line-height: 1.5; } .future-page p { margin-block-end: 2em; }' });
  const calendar = view.getByRole('button', { name: 'カレンダー表示', exact: true });
  await expect(calendar).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await calendar.focus(); await page.keyboard.press('Enter');
  await nav(page, '← 今後の予定へ戻る');
  await expect(calendar).toBeFocused();
  await view.locator('.future-balance > summary').click();
  await expect(view.getByRole('checkbox').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('future-text-spacing.png'), fullPage: true });
});
