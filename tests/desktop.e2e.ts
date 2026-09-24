import { dailyTimeDisplay } from '../src/domain/dailyTimeDisplay';
import { dailyTime } from '../src/domain/dailyTime';
import { PLAN_CALCULATION_VERSION } from '../src/domain/sessionPolicy';
import { test, expect, chromium, Browser, Page } from '@playwright/test';
import { spawn, execFile, ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmdirSync,
  existsSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { addDays, today, weekday, AppState, initialState } from '../src/domain/model';
import { generatePlan, capacityForWeek } from '../src/domain/planning';
import { overlapsBusy } from '../src/domain/planAudit';
import { proposeSettings } from '../src/domain/planning';
import ICAL from 'ical.js';
import AxeBuilder from '@axe-core/playwright';
import { startOfWeek } from '../src/domain/calendar';
import { studentFixture } from './fixtures/student';
import { adjustmentFixture } from './fixtures/adjustment';
import { activePlanWork } from '../src/domain/progressAllocation';
import { createProgressBaseline } from '../src/domain/progressReflection';
let child: ChildProcess;
let browser: Browser;
let page: Page;
let dataDir: string;
async function osWindow(action = 'inspect', width = 910, height = 680) {
  const { stdout } = await promisify(execFile)(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      resolve('scripts/window-test-control.ps1'),
      '-ProcessId',
      String(child.pid),
      '-Action',
      action,
      '-Width',
      String(width),
      '-Height',
      String(height),
    ],
    { windowsHide: true },
  );
  return JSON.parse(stdout) as {
    width: number;
    height: number;
    maximized: boolean;
    minimized: boolean;
  };
}
async function launch(readyHeading = '今日') {
  await close();
  browser = undefined!;
  const webviewDir = mkdtempSync(resolve('.test-data/native-webview-'));
  let processOutput = '';
  child = spawn(resolve('src-tauri/target/debug/studyplan.exe'), [], {
    env: {
      ...process.env,
      STUDYPLAN_TEST_DATA_DIR: dataDir,
      WEBVIEW2_USER_DATA_FOLDER: webviewDir,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9223',
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (data) => {
    processOutput = (processOutput + data).slice(-8000);
  });
  child.stderr?.on('data', (data) => {
    processOutput = (processOutput + data).slice(-8000);
  });
  let spawnError = '';
  child.on('error', (error) => {
    spawnError = String(error);
  });
  for (let i = 0; i < 60; i++) {
    if (spawnError || child.exitCode !== null)
      throw new Error(`アプリの起動に失敗しました。${spawnError}\n${processOutput}`);
    try {
      browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!browser) throw new Error(`WebView2のデバッグ接続を開始できません。\n${processOutput}`);
  for (let i = 0; i < 60; i++) {
    const pages = browser.contexts().flatMap((c) => c.pages());
    page = pages.find((p) => !p.url().startsWith('devtools:'))!;
    if (page && page.url() !== 'about:blank') break;
    await new Promise((r) => setTimeout(r, 250));
  }
  page.setDefaultTimeout(10000);
  await expect(page.getByRole('heading', { name: readyHeading })).toBeVisible({
    timeout: 30000,
  });
}
async function saved() {
  await expect(page.locator('.save-status')).toContainText('保存済み');
}
async function storedState(): Promise<AppState> {
  return page.evaluate(
    async () =>
      (
        await (
          window as unknown as {
            __TAURI_INTERNALS__: { invoke: (name: string) => Promise<{ data: AppState }> };
          }
        ).__TAURI_INTERNALS__.invoke('load_state')
      ).data,
  );
}
async function nativeWindowSize() {
  return page.evaluate(async () => {
    const invoke = (
      window as unknown as {
        __TAURI_INTERNALS__: { invoke: (name: string, args?: unknown) => Promise<unknown> };
      }
    ).__TAURI_INTERNALS__.invoke;
    const [size, scale] = await Promise.all([
      invoke('plugin:window|inner_size', { label: 'main' }) as Promise<{
        width: number;
        height: number;
      }>,
      invoke('plugin:window|scale_factor', { label: 'main' }) as Promise<number>,
    ]);
    return {
      width: Math.round(size.width / scale),
      height: Math.round(size.height / scale),
    };
  });
}
async function resizeNativeWindow(width: number, height: number) {
  await page.evaluate(
    async ({ width, height }) => {
      await (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke: (name: string, args?: unknown) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__.invoke('plugin:window|set_size', {
        label: 'main',
        value: { Logical: { width, height } },
      });
    },
    { width, height },
  );
}
async function closeWindowNormally() {
  const exited = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('通常終了を待機中にタイムアウトしました。')),
      10000,
    );
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  await page
    .evaluate(async () => {
      await (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke: (name: string, args?: unknown) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' });
    })
    .catch(() => {});
  await exited;
  await browser.close().catch(() => {});
  browser = undefined!;
  child = undefined!;
}
async function nav(name: string) {
  const aliases: Record<string, string> = { '今日の詳細': '今日のスケジュール', '詳細カレンダー': '学習カレンダー', '予定外・過去日の記録': '進捗を記録' };
  name = aliases[name] ?? name;
  const main = page.locator('.sidebar nav');
  if (name === 'ホーム') name = '今日';
  if (name === '今日のスケジュール') {
    await main.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: '今日の時間内訳', exact: true }).click();
    return;
  }
  if (name === '学習カレンダー') {
    await main.getByRole('button', { name: '今後の予定', exact: true }).click();
    const nextDay = page.locator('.future-day').first();
    if (await nextDay.count()) {
      const date = (await nextDay.locator('h2 button').getAttribute('aria-label'))!.split(' ')[0];
      await nextDay.locator('h2 button').click();
      await expect(page.getByRole('button', { name: `${date}を表示`, exact: true })).toHaveAttribute('aria-pressed', 'true');
    } else {
      await page.getByRole('button', { name: '詳細カレンダーを見る', exact: true }).click();
    }
    await expect(page.getByRole('heading', { name: '詳細カレンダー', exact: true, level: 1 })).toBeVisible();
    return;
  }
  if (name === '進捗を記録') {
    await main.getByRole('button', { name: '記録履歴', exact: true }).click();
    await page.getByRole('button', { name: '過去日の学習を記録' }).click();
    return;
  }
  if (['今日', '今後の予定', '記録履歴', '設定'].includes(name)) {
    await main.getByRole('button', { name, exact: true }).click();
    if (name === '今後の予定') {
      const start = (await page.locator('.future-week time').getAttribute('datetime'))!;
      if (addDays(today(), 1) < start) await page.getByRole('button', { name: '前の週', exact: true }).click();
    }
    return;
  }
  await main.getByRole('button', { name: '設定', exact: true }).click();
  if (name === '試験・目標') {
    await page.getByRole('button', { name: '試験・目標の一覧・編集' }).click();
    return;
  }
  if (name === '教材・進捗') {
    await page.getByRole('button', { name: '教材の一覧・編集' }).click();
    return;
  }
  if (name === '時間枠・時間割') {
    await page.getByRole('button', { name: /時間枠を(設定|修正)/ }).click();
    return;
  }
  const label = name === '対話式の初期設定' ? '初期設定' :
    name === '警告の管理' ? '通知の管理' :
    name === '再計画の確認' ? '計画案の確認' :
    name === 'チュートリアル' ? '使い方' : name;
  await page.getByRole('button', { name: label, exact: true }).click();
}
async function displaySettings(appearance?: string, theme?: string) {
  const previous = await page.locator('h1').innerText();
  await nav('設定');
  if (appearance) await page.getByLabel('表示モード').selectOption(appearance);
  if (theme) await page.getByLabel('カラーテーマ').selectOption(theme);
  await saved();
  if (previous !== '設定') await nav(previous);
}
async function close() {
  if (browser) await browser.close();
  if (child && !child.killed && child.exitCode === null) {
    const ended = new Promise<void>((r) => {
      child.once('exit', () => r());
      setTimeout(r, 3000);
    });
    child.kill();
    await ended;
  }
}
test.afterAll(close);

test('実機：今日の未設定区間に名前を付け、保存・取消・再起動・解除する', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/outside-labels-'));
  await launch();
  const date = today(),
    seed = studentFixture(date);
  seed.plan = generatePlan(seed, date);
  seed.plan.sessions[0].fixed = true;
  await seedState(seed, 'outside-labels');
  await nav('今日のスケジュール');
  let card = page.locator('.daily-time');
  await card.locator('summary').click();
  let row = card.locator('tr[data-kind=outside]').first();
  const editButton = row.getByRole('button', { name: /を編集$/ });
  await expect(editButton.locator('svg')).toHaveCount(1);
  await expect(editButton).toHaveText('');
  expect((await editButton.boundingBox())!.x).toBeLessThan(
    (await row.locator('.time-category').boundingBox())!.x,
  );
  const availableText = card.locator('tr[data-kind=available]').first().locator('.time-category');
  expect(
    Math.abs(
      (await row.locator('.time-category').boundingBox())!.x -
        (await availableText.boundingBox())!.x,
    ),
  ).toBeLessThan(1);
  await editButton.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(editButton).toBeFocused();
  await expect(editButton).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  await row.getByRole('textbox').fill('');
  await row.getByRole('textbox').press('Enter');
  await expect(row.getByRole('alert')).toContainText('1〜120文字');
  await row.getByRole('textbox').fill('自由時間 <読書>');
  await row.getByRole('textbox').press('Enter');
  await saved();
  await expect(row.locator('.time-category')).toHaveText('自由時間 <読書>');
  await expect(row.getByRole('button', { name: /名前を編集/ })).toBeFocused();
  const renamed = await storedState();
  expect(renamed.outsideLabels?.[date]).toHaveLength(1);
  expect(renamed.settings).toEqual(seed.settings);
  expect(renamed.plan).toEqual(seed.plan);
  expect(renamed.records).toEqual(seed.records);
  await row.getByRole('button', { name: /名前を編集/ }).click();
  await row.getByRole('textbox').fill('保存しない名前');
  await row.getByRole('button', { name: '取消', exact: true }).click();
  expect((await storedState()).outsideLabels).toEqual(renamed.outsideLabels);
  await launch();
  await nav('今日のスケジュール');
  card = page.locator('.daily-time');
  await card.locator('summary').click();
  row = card.locator('tr[data-kind=outside]').first();
  await expect(row.locator('.time-category')).toHaveText('自由時間 <読書>');
  await page.getByRole('button', { name: 'サイドバーを折りたたむ', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 800 });
  await row.getByRole('button', { name: /名前を編集/ }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  const axe = await new AxeBuilder({ page })
    .include('.daily-time')
    .setLegacyMode()
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(axe.violations).toEqual([]);
  await row.getByRole('button', { name: '元の名前に戻す' }).click();
  await saved();
  expect((await storedState()).outsideLabels?.[date]).toBeUndefined();
  await expect(row.locator('.time-category')).toHaveText('学習対象外・未設定');
  await page.setViewportSize({ width: 1280, height: 900 });
  await row.getByRole('button', { name: /名前を編集/ }).click();
  await row.getByRole('textbox').fill('朝の支度');
  await row.getByRole('textbox').press('Enter');
  await saved();
  const renamedTextX = (await row.locator('.time-category').boundingBox())!.x;
  expect(
    Math.abs((await row.locator('.daily-time-note').boundingBox())!.x - renamedTextX),
  ).toBeLessThan(1);
  const commuteRow = card.locator('tr[data-kind=commute]').first();
  expect(
    Math.abs(
      (await commuteRow.locator('.daily-time-note').boundingBox())!.x -
        (await commuteRow.locator('.time-category').boundingBox())!.x,
    ),
  ).toBeLessThan(1);
  await card.screenshot({ path: 'test-results/outside-label.png' });
});

test('実機：変更したウィンドウサイズを通常終了後の再起動で復元する', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/window-size-'));
  await launch();
  const seed = studentFixture(today());
  await seedState(seed, 'window-size-study-data');
  const studyBefore = await storedState();
  await osWindow('resize', 910, 680);
  await osWindow('close');
  await expect.poll(() => child.exitCode).not.toBeNull();
  await launch();
  await expect.poll(nativeWindowSize, { timeout: 10000 }).toEqual({ width: 910, height: 680 });
  expect(await storedState()).toEqual(studyBefore);
  await resizeNativeWindow(820, 610);
  await closeWindowNormally();
  await launch();
  await expect.poll(nativeWindowSize).toEqual({ width: 820, height: 610 });
  await page.screenshot({ path: 'test-results/window-size-restored.png', fullPage: true });
});

test('実機：OSで最大化して閉じても最大化と元のサイズを復元する', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/window-maximized-'));
  await launch();
  await osWindow('resize', 880, 620);
  await expect.poll(nativeWindowSize).toEqual({ width: 880, height: 620 });
  await osWindow('maximize');
  expect((await osWindow()).maximized).toBe(true);
  await osWindow('close');
  await expect.poll(() => child.exitCode).not.toBeNull();
  await launch();
  expect((await osWindow()).maximized).toBe(true);
  await osWindow('restore');
  await expect.poll(nativeWindowSize).toEqual({ width: 880, height: 620 });
  await osWindow('minimize');
  await osWindow('close');
  await expect.poll(() => child.exitCode).not.toBeNull();
  await launch();
  expect((await osWindow()).minimized).toBe(false);
  await expect.poll(nativeWindowSize).toEqual({ width: 880, height: 620 });
});

test('実機：解消した計画入力エラーだけを再検証し、全解消時に自動で閉じる', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/resolved-errors-'));
  await launch();
  const seed = studentFixture(today());
  seed.plan = generatePlan(seed, today());
  seed.settings.windows = seed.settings.windows.filter((w) => w.kind !== 'study');
  seed.proposal = null;
  await seedState(seed, 'resolved-errors');
  await page.getByRole('button', { name: '現在の設定で計画案を作成', exact: true }).click();
  const popup = page.locator('.error-banner');
  await expect(popup).toContainText('勉強できる時間が未登録です');
  await nav('時間枠・時間割');
  const name = page.getByLabel('枠の名前');
  await name.fill('新しい学習枠');
  await saved();
  await expect(popup).toContainText('勉強できる時間が未登録です');
  const add = page.getByRole('button', { name: '時間枠を追加する', exact: true });
  await add.click();
  await saved();
  await expect(popup).toHaveCount(0);
  await expect(add).toBeFocused();
  await expect(page.locator('.app-shell')).not.toHaveAttribute('inert', '');
  await expect(page.getByLabel('枠の名前')).toBeEnabled();
  await page.screenshot({ path: 'test-results/resolved-error-dismissed.png', fullPage: true });
});

test('実機：選んだ連続時間と休憩だけを再開して修正し、他の項目へ進まない', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/item-edit-'));
  await launch();
  const seed = studentFixture(today());
  seed.plan = generatePlan(seed, today());
  await seedState(seed, 'item-edit');
  await nav('対話式の初期設定');
  await page.getByRole('button', { name: '設定項目を選んで修正する' }).click();
  await page.getByRole('button', { name: '連続時間・休憩を修正する' }).click();
  await page.getByLabel('連続で勉強できる最長時間（分）').fill('70');
  await page.getByLabel('連続で勉強できる最長時間（分）').press('Enter');
  await saved();
  await launch();
  await nav('対話式の初期設定');
  await expect(page.getByLabel('ブロック間の休憩（分）')).toBeVisible();
  await page.getByLabel('ブロック間の休憩（分）').fill('12');
  await page.getByLabel('ブロック間の休憩（分）').press('Enter');
  await expect(page.getByRole('heading', { name: '選んだ項目の修正が完了しました' })).toBeVisible();
  await saved();
  const after = await storedState();
  expect(after.settings).toEqual({ ...seed.settings, block: 70, rest: 12 });
  expect(after.plan).toEqual(seed.plan);
  expect(after.records).toEqual(seed.records);
  await page.getByRole('button', { name: '別の項目を修正する' }).click();
  await page.getByRole('button', { name: '通学時間を修正する' }).click();
  await expect(page.getByRole('heading', { name: '通学時間', exact: true })).toBeVisible();
});

test('実機：睡眠・風呂を任意設定し、日またぎ・中断再開・解除でも計画を変えない', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/outside-time-'));
  await launch();
  const seed = studentFixture(today());
  seed.plan = generatePlan(seed, addDays(today(), 1));
  seed.plan.sessions[0].fixed = true;
  await seedState(seed, 'outside-time');
  await nav('対話式の初期設定');
  await page.getByRole('button', { name: '設定項目を選んで修正する' }).click();
  await page.getByRole('button', { name: '睡眠・風呂を修正する' }).click();
  let sleep = page.getByRole('region', { name: '睡眠の質問' });
  await sleep.getByRole('button', { name: '設定する', exact: true }).click();
  await sleep.getByLabel('睡眠の開始時刻').press('Enter');
  await expect(sleep.getByRole('alert')).toContainText('開始時刻');
  await sleep.getByLabel('睡眠の開始時刻').fill('23:00');
  await sleep.getByLabel('睡眠の開始時刻').press('Enter');
  await expect(sleep.getByLabel('睡眠の終了時刻')).toBeVisible();
  await saved();
  await launch();
  await nav('対話式の初期設定');
  sleep = page.getByRole('region', { name: '睡眠の質問' });
  await expect(sleep.getByLabel('睡眠の終了時刻')).toHaveValue('');
  await sleep.getByLabel('睡眠の終了時刻').fill('07:00');
  await sleep.getByLabel('睡眠の終了時刻').press('Enter');
  let bath = page.getByRole('region', { name: '風呂の質問' });
  await bath.getByRole('button', { name: '設定する', exact: true }).click();
  await bath.getByLabel('風呂の開始時刻').fill('23:30');
  await bath.getByLabel('風呂の開始時刻').press('Enter');
  await bath.getByLabel('風呂の終了時刻').fill('00:00');
  await bath.getByLabel('風呂の終了時刻').press('Enter');
  await expect(bath.getByRole('alert')).toContainText('重なっています');
  expect((await storedState()).outsideTime?.bath).toBeUndefined();
  await bath.getByRole('button', { name: '戻る', exact: true }).click();
  await bath.getByLabel('風呂の開始時刻').fill('22:00');
  await bath.getByLabel('風呂の開始時刻').press('Enter');
  await bath.getByLabel('風呂の終了時刻').fill('22:30');
  await bath.getByLabel('風呂の終了時刻').press('Enter');
  await expect(page.getByRole('heading', { name: '選んだ項目の修正が完了しました' })).toBeVisible();
  await saved();
  const configured = await storedState();
  expect(configured.outsideTime).toEqual({
    sleep: { start: 1380, duration: 480 },
    bath: { start: 1320, duration: 30 },
  });
  expect(configured.settings).toEqual(seed.settings);
  expect(configured.plan).toEqual(seed.plan);
  expect(configured.records).toEqual(seed.records);
  await nav('ホーム');
  await expect(page.locator('.daily-time')).toHaveCount(0);
  await nav('今日のスケジュール');
  const card = page.getByRole('region', { name: '1日の可処分時間', exact: true });
  await expect(card.locator('.time-legend [data-kind=sleep]')).toContainText('8時間');
  await expect(card.locator('.time-legend [data-kind=sleep]')).toContainText('風呂30分');
  await expect(card.locator('.time-legend [data-kind=bath]')).toHaveCount(0);
  await nav('学習カレンダー');
  await expect(page.getByRole('region', { name: '1日の可処分時間', exact: true })).toHaveCount(0);
  await nav('今日のスケジュール');
  await page.locator('.daily-time').screenshot({ path: 'test-results/daily-time-lifestyle.png' });
  await launch();
  expect((await storedState()).outsideTime).toEqual(configured.outsideTime);
  await nav('対話式の初期設定');
  await page.getByRole('button', { name: '設定項目を選んで修正する' }).click();
  await page.getByRole('button', { name: '睡眠・風呂を修正する' }).click();
  sleep = page.getByRole('region', { name: '睡眠の質問' });
  bath = page.getByRole('region', { name: '風呂の質問' });
  await sleep.getByRole('button', { name: '設定を解除して次へ' }).click();
  await bath.getByRole('button', { name: '今の設定で次へ' }).click();
  await saved();
  const removed = await storedState();
  expect(removed.outsideTime).toEqual({ bath: configured.outsideTime!.bath });
  expect(removed.plan).toEqual(seed.plan);
  expect(removed.records).toEqual(seed.records);
});

test('実機：可処分時間の情報階層・全テーマ・キーボード・拡大と文字間隔', async () => {
  test.setTimeout(180000);
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/daily-time-a11y-'));
  await launch();
  const seed = studentFixture(today());
  seed.settings.windows.find((w) => w.kind === 'class')!.weekdays = [weekday(today())];
  // Keep a legacy overlap to verify visible repair guidance and union-based totals.
  seed.settings.commute!.returnStart = 750;
  seed.outsideTime = { sleep: { start: 1380, duration: 480 }, bath: { start: 1330, duration: 30 } };
  const expected = dailyTime(seed.settings, today());
  const shown = dailyTimeDisplay(expected.segments, seed.outsideTime);
  await seedState(seed, 'daily-time-a11y');
  await nav('今日のスケジュール');
  const card = page.getByRole('region', { name: '1日の可処分時間', exact: true });
  const summary = card.locator('.daily-time-details > summary');
  const details = card.locator('.daily-time-details');
  const minutesOf = (text: string) => {
    const hours = Number(text.match(/([\d.]+)時間/)?.[1] ?? 0);
    const minutes = Number(text.match(/([\d.]+)分/)?.[1] ?? 0);
    return hours * 60 + minutes;
  };
  const assertValues = async () => {
    expect(minutesOf(await card.locator('.daily-time-metric dd').innerText())).toBe(
      expected.capacity.focus,
    );
    expect(minutesOf(await card.locator('.daily-time-support').innerText())).toBe(
      expected.capacity.free,
    );
    for (const [kind, total] of Object.entries(shown.totals).filter(
      ([kind]) => !['available', 'meal', 'commute', 'mealCommute', 'sleep', 'bath'].includes(kind),
    ))
      expect(
        minutesOf(await card.locator(`.time-legend [data-kind="${kind}"] dd`).innerText()),
      ).toBe(total);
    const combined = card.locator('.time-legend [data-kind="meal"]');
    await expect(combined.locator('dt')).toHaveText('通学・食事');
    const parts = (await combined.locator('dd').innerText()).match(/食事(.+)、通学(.+)）/)!;
    expect(minutesOf(parts[1])).toBe(shown.totals.meal + shown.totals.mealCommute);
    expect(minutesOf(parts[2])).toBe(shown.totals.commute + shown.totals.mealCommute);
    const living = card.locator('.time-legend [data-kind="sleep"]');
    await expect(living.locator('dt')).toHaveText('睡眠・風呂');
    const livingParts = (await living.locator('dd').innerText()).match(/睡眠(.+)、風呂(.+)）/)!;
    expect(minutesOf(livingParts[1])).toBe(shown.totals.sleep);
    expect(minutesOf(livingParts[2])).toBe(shown.totals.bath);
    await expect(card.locator('.time-legend [data-kind="bath"]')).toHaveCount(0);
    await expect(
      card.locator('.time-legend [data-kind="commute"], .time-legend [data-kind="mealCommute"]'),
    ).toHaveCount(0);
  };
  await assertValues();
  await expect(card.getByRole('heading', { level: 2, name: '1日の可処分時間' })).toBeVisible();
  expect(await card.getAttribute('aria-labelledby')).toBe(
    await card.locator('h2').getAttribute('id'),
  );
  await expect(details).not.toHaveAttribute('open');
  await expect(card.locator('.daily-time-warning')).toBeVisible();
  await expect(card.locator('.daily-commute')).not.toBeVisible();
  await expect(card.locator('.daily-time-donut')).toHaveAttribute('aria-hidden', 'true');
  await expect(card.locator('.daily-time-visual')).not.toHaveAttribute('aria-hidden');
  await expect(
    card.locator('.daily-time-summary').getByText('学習可能', { exact: true }),
  ).toHaveCount(1);
  await expect(card.locator('.daily-time-total, .daily-time-primary')).toHaveCount(0);
  expect(await card.getByRole('img').count()).toBe(0);
  // Category arcs cover exactly one day; no minimum slice size or duplicated overlaps.
  const slices = await card.locator('.daily-time-donut circle').evaluateAll((els) =>
    els.map((e) => ({
      kind: e.getAttribute('data-kind')!,
      amount: Number(e.getAttribute('stroke-dasharray')!.split(' ')[0]),
      offset: Number(e.getAttribute('stroke-dashoffset')),
      length: e.getAttribute('pathLength'),
    })),
  );
  let total = 0;
  for (const slice of slices) {
    expect(slice.length).toBe('1440');
    expect(slice.amount).toBe(
      slice.kind === 'meal'
        ? shown.totals.meal + shown.totals.commute + shown.totals.mealCommute
        : slice.kind === 'sleep'
          ? shown.totals.sleep + shown.totals.bath
          : shown.totals[slice.kind as keyof typeof shown.totals],
    );
    expect(slice.offset).toBeCloseTo(-total, 8);
    total += slice.amount;
  }
  expect(total).toBe(1440);
  expect(slices.filter((s) => s.kind === 'meal')).toHaveLength(1);
  expect(slices.some((s) => s.kind === 'commute' || s.kind === 'mealCommute')).toBe(false);
  expect(slices.some((s) => s.kind === 'bath')).toBe(false);
  await expect(card.locator('.day-time-bar')).toHaveCount(0);
  const reports: unknown[] = [];
  for (const theme of ['mint', 'sky', 'lime']) {
    for (const mode of ['light', 'dark', 'system-light', 'system-dark']) {
      const appearance = mode.endsWith('dark') ? 'dark' : 'light';
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({ colorScheme: appearance });
      await displaySettings(mode.startsWith('system') ? 'system' : mode);
      await displaySettings(undefined, theme);
      await saved();
      await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance);
      await expect(card.locator('.daily-time-visual')).not.toHaveAttribute('data-expanded');
      const centered = await card.locator('.daily-time-visual').evaluate((e) => {
        const ring = e.querySelector('svg')!.getBoundingClientRect();
        const label = e.querySelector('dl')!.getBoundingClientRect();
        return (
          Math.abs(ring.x + ring.width / 2 - label.x - label.width / 2) < 1 &&
          Math.abs(ring.y + ring.height / 2 - label.y - label.height / 2) < 1 &&
          Math.hypot(label.width, label.height) < ring.width * 0.58
        );
      });
      expect(centered).toBe(true);
      await summary.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(summary).toBeFocused();
      await expect(summary).toBeInViewport({ ratio: 1 });
      const focus = await summary.evaluate((e) => {
        const s = getComputedStyle(e),
          r = e.getBoundingClientRect();
        return {
          style: s.outlineStyle,
          width: parseFloat(s.outlineWidth),
          color: s.outlineColor,
          widthPx: r.width,
          heightPx: r.height,
          uncovered: e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
        };
      });
      expect(focus.style).toBe('solid');
      // Windows display scaling snaps the declared 3px outline to physical pixels.
      expect(focus.width).toBeGreaterThanOrEqual(2);
      expect(focus.widthPx).toBeGreaterThanOrEqual(24);
      expect(focus.heightPx).toBeGreaterThanOrEqual(24);
      expect(focus.uncovered).toBe(true);
      if (!mode.startsWith('system'))
        await card.screenshot({
          path: `test-results/daily-time-${theme}-${appearance}-closed.png`,
        });
      await page.keyboard.press('Enter');
      await expect(details).toHaveAttribute('open', '');
      await expect(card.locator('.daily-commute')).toBeVisible();
      await expect(card.getByRole('table', { name: '24時間の内訳' })).toBeVisible();
      const rows = card.locator('.daily-time-table tbody tr');
      expect(await rows.count()).toBe(shown.segments.length);
      for (let i = 0; i < shown.segments.length; i++) {
        await expect(rows.nth(i)).toHaveAttribute('data-kind', shown.segments[i].kind);
        expect(minutesOf(await rows.nth(i).locator('td').last().innerText())).toBe(
          shown.segments[i].end - shown.segments[i].start,
        );
      }
      const colors = await card
        .locator('.daily-time-donut circle')
        .evaluateAll((els) =>
          Object.fromEntries(
            els.map((e) => [e.getAttribute('data-kind'), getComputedStyle(e).stroke]),
          ),
        );
      const underlines = await card.locator('.time-category').evaluateAll((els) =>
        els.map((e) => ({
          kind: e.closest('tr')!.getAttribute('data-kind')!,
          line: getComputedStyle(e).textDecorationLine,
          color: getComputedStyle(e).textDecorationColor,
        })),
      );
      for (const line of underlines) {
        expect(line.line).toBe('underline');
        expect(line.color).toBe(
          colors[
            ['commute', 'mealCommute'].includes(line.kind)
              ? 'meal'
              : line.kind === 'bath'
                ? 'sleep'
                : line.kind
          ],
        );
      }
      const axe = await new AxeBuilder({ page })
        .include('.daily-time')
        .setLegacyMode()
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(axe.violations).toEqual([]);
      // Supplement axe with computed text/background and focus/background contrast ratios.
      const contrast = await card.evaluate((root) => {
        const luminance = (color: string) => {
          const rgb = color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number)
            .map((v) => {
              const n = v / 255;
              return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
            });
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        const ratio = (a: string, b: string) => {
          const x = luminance(a),
            y = luminance(b);
          return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
        };
        const background = (e: Element): string => {
          const c = getComputedStyle(e).backgroundColor;
          return c === 'rgba(0, 0, 0, 0)' || c === 'transparent' ? background(e.parentElement!) : c;
        };
        const text = [...root.querySelectorAll('*')].filter(
          (e) =>
            e.getClientRects().length &&
            !e.closest('[aria-hidden="true"]') &&
            [...e.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()),
        );
        const summary = root.querySelector('summary')!;
        return {
          textMinimum: Math.min(
            ...text.map((e) => ratio(getComputedStyle(e).color, background(e))),
          ),
          focus: ratio(getComputedStyle(summary).outlineColor, background(summary)),
          learning: ratio(
            getComputedStyle(root.querySelector('.daily-time-donut .time-available')!).stroke,
            background(root),
          ),
          sleep: ratio(
            getComputedStyle(root.querySelector('.daily-time-donut .time-sleep')!).stroke,
            background(root),
          ),
        };
      });
      expect(contrast.textMinimum).toBeGreaterThanOrEqual(4.5);
      expect(contrast.focus).toBeGreaterThanOrEqual(3);
      expect(contrast.sleep).toBeLessThan(contrast.learning);
      reports.push({
        theme,
        mode,
        contrast,
        violations: axe.violations,
        incomplete: axe.incomplete.map((v) => v.id),
      });
      await summary.focus();
      await page.keyboard.press('Space');
      await expect(details).not.toHaveAttribute('open');
      await assertValues();
    }
  }
  await page.setViewportSize({ width: 480, height: 800 });
  await summary.focus();
  await page.keyboard.press('Enter');
  const checkFit = async () => {
    const result = await card.evaluate((e) => {
      const r = e.getBoundingClientRect();
      const overflow = [...e.querySelectorAll('*')]
        .filter((x) => {
          if (!x.getClientRects().length) return false;
          const b = x.getBoundingClientRect();
          return (
            b.left < r.left - 1 ||
            b.right > r.right + 1 ||
            (x.scrollWidth > x.clientWidth + 1 && getComputedStyle(x).display !== 'inline')
          );
        })
        .map((x) => x.tagName + '.' + x.className);
      return { overflow, pageWidth: document.documentElement.scrollWidth, width: innerWidth };
    });
    expect(result.overflow).toEqual([]);
    expect(result.pageWidth).toBeLessThanOrEqual(result.width + 1);
  };
  await checkFit();
  // Narrow layouts now use the persistent bottom navigation rather than a sidebar rail.
  await expect(page.locator('.sidebar-toggle')).toBeHidden();
  await page.setViewportSize({ width: 320, height: 800 });
  await checkFit();
  await card.screenshot({ path: 'test-results/daily-time-narrow.png' });
  const doubledText = await card.evaluate((root) =>
    [root, ...root.querySelectorAll('*')]
      .map((e, i) => {
        e.setAttribute('data-daily-size', String(i));
        return `[data-daily-size="${i}"] { font-size: ${parseFloat(getComputedStyle(e).fontSize) * 2}px !important; }`;
      })
      .join('\n'),
  );
  const override = await page.addStyleTag({
    content:
      doubledText +
      `
    .daily-time, .daily-time * { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; }
    .daily-time p { margin-bottom: 2em !important; }
  `,
  });
  await checkFit();
  await assertValues();
  await expect(card.locator('.daily-time-visual')).toHaveAttribute('data-expanded', 'true');
  const separated = await card
    .locator('.daily-time-visual')
    .evaluate(
      (e) =>
        e.querySelector('dl')!.getBoundingClientRect().top >=
        e.querySelector('svg')!.getBoundingClientRect().bottom - 1,
    );
  expect(separated).toBe(true);
  // Text enlargement moves an already focused element without a new focus event.
  // Exercise actual keyboard re-entry so the browser scrolls it into view.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(summary).toBeFocused();
  await expect(summary).toBeInViewport({ ratio: 1 });
  await card.screenshot({ path: 'test-results/daily-time-text-spacing.png' });
  await override.evaluate((e) => e.parentNode?.removeChild(e));
  await expect(card.locator('.daily-time-visual')).not.toHaveAttribute('data-expanded');
  await card.evaluate((e) => {
    e.style.filter = 'grayscale(1)';
  });
  await assertValues();
  await card.screenshot({ path: 'test-results/daily-time-grayscale.png' });
  await saved();
  const after = await storedState();
  expect(after.settings).toEqual(seed.settings);
  expect(after.plan).toEqual(seed.plan);
  expect(after.records).toEqual(seed.records);
  expect(dailyTime(after.settings, today())).toEqual(expected);
  writeFileSync('test-results/daily-time-accessibility.json', JSON.stringify(reports, null, 2));
});
test('実機：往復の出発時刻を確認し、食事との重複を修正して保存する', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/departures-'));
  await launch();
  const seed = studentFixture(today());
  seed.settings.windows.find((w) => w.kind === 'class')!.weekdays = [weekday(today())];
  delete seed.settings.commute!.departureTimesConfirmed;
  await seedState(seed, 'departures');
  await nav('通学時間');
  await expect(page.getByRole('button', { name: '残りを一括スキップして確認' })).toHaveCount(0);
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await expect(page.getByLabel('往路の出発時刻')).toHaveValue('');
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await expect(page.getByText('出発時刻を入力してください。', { exact: true })).toBeVisible();
  await page.getByLabel('往路の出発時刻').fill('08:10');
  await page.getByLabel('往路の出発時刻').press('Enter');
  await page.getByLabel('往路の所要時間（分）').fill('50');
  await page.getByLabel('往路の所要時間（分）').press('Enter');
  await page.getByLabel('復路の出発時刻').fill('12:30');
  await page.getByLabel('復路の出発時刻').press('Enter');
  await page.getByLabel('復路の所要時間（分）').fill('50');
  await page.getByLabel('復路の所要時間（分）').press('Enter');
  await page.getByRole('button', { name: 'この通学設定を使う', exact: true }).click();
  await expect(page.locator('.commute-editor [role=alert]')).toContainText('昼食');
  expect((await storedState()).settings).toEqual(seed.settings);
  await page.getByRole('button', { name: '復路の出発時刻を修正', exact: true }).click();
  await page.getByLabel('復路の出発時刻').fill('13:30');
  await page.getByLabel('復路の出発時刻').press('Enter');
  await page.getByLabel('復路の所要時間（分）').press('Enter');
  await page.getByRole('button', { name: 'この通学設定を使う', exact: true }).click();
  await saved();
  expect((await storedState()).settings.commute).toMatchObject({
    outboundStart: 490,
    returnStart: 810,
    departureTimesConfirmed: true,
  });
  expect((await storedState()).settings.meals).toEqual(seed.settings.meals);
  await launch();
  await nav('通学時間');
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await expect(page.getByLabel('往路の出発時刻')).toHaveValue('08:10');
  await page.screenshot({ path: 'test-results/commute-departure.png', fullPage: true });
  for (const name of ['対話式の初期設定', '時間枠・時間割', '再計画の確認']) {
    await nav(name);
    await expect(page.getByRole('button', { name: '残りを一括スキップして確認' })).toHaveCount(0);
  }
});
test('実機：昼食の重複があっても朝食の質問を進め、昼食を修正できる', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/meal-conflict-'));
  await launch();
  const seed = studentFixture(today());
  seed.settings.windows.find((w) => w.kind === 'class')!.weekdays = [weekday(today())];
  seed.settings.commute!.returnStart = 750;
  await seedState(seed, 'meal-conflict');
  await nav('時間枠・時間割');
  await page.getByRole('button', { name: '食事時間を対話で設定する' }).click();
  const questions = page.getByRole('region', { name: '食事時間の質問' });
  await questions.getByRole('button', { name: '次へ', exact: true }).click();
  await questions.getByRole('button', { name: '次へ', exact: true }).click();
  await expect(questions.getByLabel('昼食の開始時刻')).toBeVisible();
  await questions.getByRole('button', { name: '次へ', exact: true }).click();
  await questions.getByRole('button', { name: '次へ', exact: true }).click();
  await expect(questions.getByRole('alert')).toContainText('昼食');
  await questions.getByRole('button', { name: '前の質問', exact: true }).click();
  await questions.getByLabel('昼食の開始時刻').fill('13:30');
  await questions.getByRole('button', { name: '次へ', exact: true }).click();
  await questions.getByRole('button', { name: '次へ', exact: true }).click();
  await expect(questions.getByLabel('夕食の開始時刻')).toBeVisible();
  await saved();
  expect((await storedState()).settings.meals!.lunch!.start).toBe(810);
  expect((await storedState()).settings.commute).toEqual(seed.settings.commute);
});

test('実機：学生の代表データで条件変更案を維持して記録・承認・保存・出力する', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/student-flow-'));
  await launch();
  const date = today();
  let seed = studentFixture(date);
  seed.plan = generatePlan(seed, date, false, new Date().getHours() * 60 + new Date().getMinutes());
  const settings = structuredClone(seed.settings);
  settings.buffer = 0.3;
  settings.materials[1].rounds[0].minutes = 45;
  seed = proposeSettings(seed, settings, date);
  await seedState(seed, 'student');
  await nav('今日のスケジュール');
  await expect(page.getByRole('region', { name: '今日の予定一覧' })).toContainText('勉強');
  await nav('進捗を記録');
  await page.getByLabel('教材', { exact: true }).selectOption('long');
  await page.getByRole('button', { name: 'その他', exact: true }).click();
  await page.getByLabel('追加問題数（1問単位）').fill('2');
  await page.getByRole('button', { name: '記録する', exact: true }).click();
  await saved();
  const recorded = await storedState();
  expect(recorded.records.at(-1)?.count).toBe(2);
  expect(recorded.settings.buffer).toBe(0.2);
  expect(recorded.proposal?.plan.settingsSnapshot?.buffer).toBe(0.3);
  expect(recorded.proposal?.plan.settingsSnapshot?.materials[1].rounds[0].minutes).toBe(45);
  await nav('再計画の確認');
  const refreshFromProgress = page.getByRole('button', { name: '現在の残数から案を作り直す' });
  if (await refreshFromProgress.count()) await refreshFromProgress.click();
  const acknowledge = page.getByRole('checkbox');
  if (await acknowledge.count()) await acknowledge.first().check();
  await page.getByRole('button', { name: 'この内容で更新', exact: true }).click();
  await saved();
  const approved = await storedState();
  expect(approved.settings.buffer).toBe(0.3);
  expect(approved.records).toEqual(recorded.records);
  await nav('学習カレンダー');
  await page.getByRole('button', { name: 'ICSを書き出す', exact: true }).click();
  const exporter = page.getByRole('region', { name: 'ICS書き出し', exact: true });
  await exporter.getByLabel('書き出す開始日').fill(date);
  await exporter.getByLabel('書き出す終了日').fill(addDays(date, 55));
  const icsPath = resolve(dataDir, '学生の計画.ics');
  await calendarSavePath(icsPath);
  await exporter.getByRole('button', { name: 'ICSを保存する' }).click();
  await expect(exporter.getByRole('status')).toContainText('書き出しました');
  const events = new ICAL.Component(ICAL.parse(readFileSync(icsPath, 'utf8'))).getAllSubcomponents(
    'vevent',
  );
  expect(events.length).toBeGreaterThan(approved.plan!.sessions.length);
  expect(events.some((e) => String(e.getFirstPropertyValue('summary')).includes('民法'))).toBe(
    true,
  );
  await nav('週間レポート');
  const markdownPath = resolve(dataDir, '学生の週間レポート.md');
  await calendarSavePath(markdownPath);
  await page.getByRole('button', { name: 'Markdownを保存', exact: true }).click();
  await expect.poll(() => existsSync(markdownPath)).toBe(true);
  expect(readFileSync(markdownPath, 'utf8')).toContain('論文演習');
  expect(readFileSync(markdownPath, 'utf8')).toContain('週間の追加完了数 | 2問');
  await close();
  await launch();
  expect((await storedState()).plan).toEqual(approved.plan);
  expect((await storedState()).records).toEqual(approved.records);
  await nav('今日のスケジュール');
  await page.screenshot({ path: 'test-results/student-today.png', fullPage: true });
});

test('実機：予定6への追加4・2・2で数量と変更詳細を保存し再起動する', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/stable-adjustment-'));
  await launch();
  const date = today();
  const seed = adjustmentFixture(date);
  await seedState(seed, 'stable-adjustment');
  const row = page.locator('.daily-record-row').filter({ hasText: '対象問題集' });
  for (const [add, actual, left] of [[4, 4, 26], [2, 6, 24], [2, 8, 22]]) {
    await row.getByRole('textbox').fill(String(add));
    await row.getByRole('button', { name: '記録', exact: true }).click();
    await saved();
    await expect(row).toContainText(actual + '/6問');
    const stored = await storedState();
    expect(activePlanWork(stored, date).filter((x) => x.materialId === 'book' && x.round === 0).reduce((n,x) => n+x.count,0)).toBe(left);
    expect(stored.plan!.shortfalls).toEqual([]);
    await expect(page.locator('.daily-record-saved')).toContainText(actual <= 6 ? '予定の変更なし' : '数量 1件');
  }
  const details = page.locator('.daily-record-saved details');
  await details.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(details).toContainText('6 → 4問');
  await expect(details).not.toContainText('別問題集');
  await page.screenshot({ path: resolve('.test-data/stable-adjustment-native.png'), fullPage: true });
  const savedState = await storedState();
  await closeWindowNormally();
  await launch();
  expect((await storedState()).plan).toEqual(savedState.plan);
  expect((await storedState()).records).toEqual(savedState.records);
  await nav('記録履歴');
  await page.getByRole('row').filter({ hasText: '＋4問' }).getByRole('button', { name: '訂正', exact: true }).click();
  await page.getByLabel('訂正後の問題数').fill('0');
  await page.getByRole('button', { name: '訂正を保存', exact: true }).click();
  await saved();
  const corrected = await storedState();
  expect(activePlanWork(corrected, date).filter((x) => x.materialId === 'book' && x.round === 0).reduce((n,x) => n+x.count,0)).toBe(26);
  await closeWindowNormally();
  await launch();
  expect((await storedState()).plan).toEqual(corrected.plan);
});

test('実機：周回数の確定場所から変更を保持した案へ進み、判断情報と詳細を使い分ける', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/replan-decision-'));
  await launch();
  const date = today();
  const seed = studentFixture(date);
  seed.plan = generatePlan(seed, date, false, 0);
  seed.proposal = null;
  await seedState(seed, 'replan-decision');
  await nav('試験・目標');
  await page.getByRole('button', { name: '行政書士を編集', exact: true }).click();
  await page.getByRole('button', { name: '表示色 #4c89ac', exact: true }).click();
  await page.getByRole('button', { name: '試験を更新する', exact: true }).click();
  await saved();
  await expect(page.getByRole('region', { name: '登録と計画の状態' })).toHaveCount(0);
  const colorOnly = await storedState();
  expect(colorOnly.plan!.id).toBe(seed.plan.id);
  expect(colorOnly.plan!.settingsSnapshot!.exams.find((exam) => exam.id === 'law')!.color).toBe(
    '#4c89ac',
  );
  await nav('教材・進捗');
  await page.getByRole('button', { name: '短答・過去問を編集', exact: true }).click();
  await page.getByLabel('周回数', { exact: true }).fill('3');
  await page.getByRole('button', { name: '教材を更新する', exact: true }).click();
  const status = page.getByRole('region', { name: '登録と計画の状態' });
  await expect(status.getByRole('heading', { name: '計画に未反映' })).toBeVisible();
  await status.getByRole('button', { name: 'この変更を含めて計画を見直す' }).click();
  await expect(page.getByRole('heading', { name: '変更した条件' })).toBeVisible();
  await expect(page.getByText(/短答・過去問 \/ 周回数：2 → 3/)).toBeVisible();
  await expect(page.getByRole('heading', { name: '計画への主な影響' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '対応が必要な問題' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '適用操作' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'この内容で更新' })).toBeVisible();
  const details = page.locator('details.replan-details');
  await expect(details).not.toHaveAttribute('open', '');
  await page.setViewportSize({ width: 480, height: 800 });
  await page.addStyleTag({
    content:
      '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/replan-decision-mobile.png', fullPage: true });
  await details.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  await expect(details.getByText('バッファーなし（余裕率0%）なら、いつ終わる？')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  const stored = await storedState();
  expect(
    stored.settings.materials.find((material) => material.id === 'short')!.rounds,
  ).toHaveLength(3);
  expect(
    stored.plan!.settingsSnapshot!.materials.find((material) => material.id === 'short')!.rounds,
  ).toHaveLength(2);
  expect(
    stored.proposal!.plan.settingsSnapshot!.materials.find((material) => material.id === 'short')!
      .rounds,
  ).toHaveLength(3);
});

test('実機：条件変更なし・別教材への影響・未配置を標準表示だけで判断できる', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/replan-impact-'));
  await launch();
  const date = today();
  const seed = studentFixture(date);
  seed.plan = generatePlan(seed, date, false, 0);
  seed.plan.sessions = [
    {
      id: 'before-short',
      date,
      start: 600,
      end: 660,
      examId: 'law',
      materialId: 'short',
      round: 0,
      count: 20,
      fixed: false,
      kind: 'study' as const,
    },
    {
      id: 'before-long',
      date: addDays(date, 1),
      start: 600,
      end: 660,
      examId: 'essay',
      materialId: 'long',
      round: 0,
      count: 20,
      fixed: false,
      kind: 'study' as const,
    },
  ];
  seed.plan.shortfalls = [];
  seed.plan.progressBaseline = createProgressBaseline(seed.plan, seed.records);
  const candidate = structuredClone(seed.plan);
  candidate.id = 'replan-impact-candidate';
  candidate.createdAt = new Date().toISOString();
  candidate.sessions = [
    { ...candidate.sessions[0], id: 'after-short', count: 30 },
    { ...candidate.sessions[1], id: 'after-long', count: 10 },
  ];
  candidate.shortfalls = [
    { materialId: 'long', round: 0, count: 5, minutes: 150, reason: '期限内の枠が不足' },
  ];
  candidate.progressBaseline = createProgressBaseline(candidate, seed.records);
  seed.proposal = {
    plan: candidate,
    basedOn: seed.plan.id,
    reason: '同じ条件で残りの課題を再計算しました。',
    unreported: [],
  };
  await seedState(seed, 'replan-impact');
  await nav('再計画の確認');
  await expect(page.getByText('条件の変更はありません。', { exact: false })).toBeVisible();
  await expect(page.locator('.impact-list > li').filter({ hasText: '短答・過去問' })).toContainText(
    '予定量 20問 → 30問',
  );
  await expect(page.locator('.impact-list > li').filter({ hasText: '論文演習' })).toContainText(
    '予定量 20問 → 10問',
  );
  await expect(page.getByRole('heading', { name: '未配置の課題' })).toBeVisible();
  await expect(page.getByText('注意付きで更新できます。', { exact: true })).toBeVisible();
  const shortfall = page.getByRole('region', { name: '未配置の課題' });
  await expect(shortfall).toContainText('論文演習');
  await expect(shortfall).toContainText('1周目：5問');
  await expect(shortfall).toContainText('2時間 30分');
  await expect(page.getByRole('button', { name: 'この内容で更新' })).toBeEnabled();
  await expect(page.locator('details.replan-details')).not.toHaveAttribute('open', '');
  await page.screenshot({ path: 'test-results/replan-impact.png', fullPage: true });
});

test('実機：固定枠の時間不足を教材の推定時間へ戻って修正できる', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/fixed-duration-'));
  await launch();
  const date = today();
  let seed = studentFixture(date);
  seed.plan = generatePlan(seed, date, false, new Date().getHours() * 60 + new Date().getMinutes());
  const fixed = seed.plan.sessions.find((s) => s.materialId === 'long')!;
  fixed.fixed = true;
  const settings = structuredClone(seed.settings);
  settings.materials[1].rounds[fixed.round].minutes = 100;
  seed = proposeSettings(seed, settings, date);
  // Older saved proposals did not contain the duration conflict. The UI must recheck it.
  seed.proposal!.plan.conflicts = [];
  await seedState(seed, 'fixed-duration');
  await nav('再計画の確認');
  await expect(page.getByRole('button', { name: 'この内容で更新', exact: true })).toBeDisabled();
  const conflict = page.locator('.plan-conflict').filter({ hasText: '推定所要時間' });
  await expect(conflict).toHaveCount(1);
  await conflict.getByRole('button', { name: '条件を修正', exact: true }).click();
  await expect(
    page.getByRole('heading', {
      name: `${fixed.round + 1}周目は1問に何分かかりそうですか？`,
      exact: true,
    }),
  ).toBeVisible();
  expect((await storedState()).plan!.sessions).toContainEqual(fixed);
});
test('実機：ホームの導線・表示別のカレンダー密度・再起動保存', async () => {
  test.setTimeout(180000);
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/calendar-density-'));
  await launch();
  const date = today();
  const seed = initialState();
  seed.settings.exams = [
    {
      id: 'e',
      name: '行政書士',
      start: date,
      target: addDays(date, 14),
      priority: 2,
      color: '#287569',
      reviewDays: 0,
    },
    {
      id: 'e2',
      name: '予備試験',
      start: date,
      target: addDays(date, 14),
      priority: 1,
      color: '#b76336',
      reviewDays: 0,
    },
  ];
  seed.settings.materials = [
    {
      id: 'm',
      name: '分野別の長い教材名・過去問題集',
      examId: 'e',
      total: 70,
      order: 1,
      rounds: [{ completed: 0, minutes: 3 }],
    },
    {
      id: 'm2',
      name: '論文演習',
      examId: 'e2',
      total: 10,
      order: 1,
      rounds: [{ completed: 0, minutes: 30 }],
    },
  ];
  seed.settings.windows = [
    {
      id: 'c',
      name: '民法の授業',
      kind: 'class',
      from: date,
      to: date,
      weekdays: [weekday(date)],
      start: 540,
      end: 640,
    },
  ];
  seed.plan = {
    id: 'density-plan',
    calculationVersion: PLAN_CALCULATION_VERSION,
    createdAt: new Date().toISOString(),
    from: date,
    sessions: [
      {
        id: 's',
        date,
        start: 660,
        end: 690,
        examId: 'e',
        materialId: 'm',
        round: 0,
        count: 10,
        kind: 'study',
        fixed: false,
      },
      {
        id: 's2',
        date,
        start: 720,
        end: 780,
        examId: 'e2',
        materialId: 'm2',
        round: 0,
        count: 2,
        kind: 'study',
        fixed: true,
      },
    ],
    capacities: [],
    shortfalls: [],
    conflicts: [],
  };
  seed.records = [
    {
      id: 'r',
      materialId: 'm',
      round: 0,
      date,
      count: 0,
      cancelled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  await seedState(seed, 'density-seed');
  await page.setViewportSize({ width: 1320, height: 900 });
  const dailyRows = page.locator('.daily-record-row');
  await expect(dailyRows).toHaveCount(2);
  await expect(dailyRows.first()).toContainText('0/10問');
  await expect(dailyRows.first().getByRole('textbox')).toBeVisible();
  await nav('今日のスケジュール');
  await expect(page.getByRole('region', { name: '今日の予定一覧' })).toBeVisible();
  await nav('ホーム');
  await expect(dailyRows.first().getByRole('textbox')).toBeVisible();
  await nav('学習カレンダー');
  let density = page.getByRole('group', { name: 'カレンダーの表示密度' });
  let views = page.locator('.calendar-toolbar');
  for (const [view, initial] of [
    ['月', 'コンパクト'],
    ['週', '標準'],
    ['一覧', '標準'],
  ]) {
    await views.getByRole('button', { name: view, exact: true }).click();
    await expect(density.getByRole('button', { name: initial, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    for (const level of ['コンパクト', '標準', '詳細']) {
      await density.getByRole('button', { name: level, exact: true }).click();
      await saved();
      const events = page.locator(
        view === '一覧'
          ? '.calendar-list .calendar-day-summary .calendar-event'
          : '.calendar-grid .calendar-event',
      );
      await expect(events).toHaveCount(2);
      const first = events.first();
      if (level !== 'コンパクト') await expect(first).toContainText('分野別の長い教材名');
      await expect(first).toContainText('0/10問');
      await expect(first).toContainText('行政書士');
      await expect(first).not.toContainText('1周目');
      expect(await first.evaluate((e) => getComputedStyle(e).borderLeftColor)).toBe(
        'rgb(40, 117, 105)',
      );
      await page.getByLabel('表示する試験').selectOption('e2');
      await expect(events).toHaveCount(1);
      await expect(events).toContainText('予備試験');
      await expect(
        page.locator(
          view === '一覧'
            ? '.calendar-list .calendar-day-summary .calendar-busy'
            : '.calendar-grid .calendar-busy',
        ),
      ).toHaveCount(1);
      await page.getByLabel('表示する試験').selectOption('all');
      await page.setViewportSize({ width: 480, height: 800 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    }
  }
  await density.getByRole('button', { name: '標準', exact: true }).click();
  await views.getByRole('button', { name: '月', exact: true }).click();
  await density.getByRole('button', { name: 'コンパクト', exact: true }).click();
  await saved();
  for (const mode of ['light', 'dark']) {
    await displaySettings(mode);
    await saved();
    const result = await new AxeBuilder({ page })
      .setLegacyMode()
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(result.violations).toEqual([]);
  }
  await page.setViewportSize({ width: 1320, height: 900 });
  await page.screenshot({ path: 'test-results/calendar-density-month.png', fullPage: true });
  const stored = await storedState();
  expect(stored.calendarDensity).toEqual({ month: 'compact', week: 'detailed', list: 'standard' });
  expect(stored.plan).toEqual(seed.plan);
  expect(stored.records).toEqual(seed.records);
  await close();
  await launch();
  await nav('学習カレンダー');
  density = page.getByRole('group', { name: 'カレンダーの表示密度' });
  views = page.locator('.calendar-toolbar');
  for (const [view, selected] of [
    ['月', 'コンパクト'],
    ['週', '詳細'],
    ['一覧', '標準'],
  ]) {
    await views.getByRole('button', { name: view, exact: true }).click();
    await expect(density.getByRole('button', { name: selected, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
});
test('実機：3テーマの読みやすさ・入力ラベル・小さい画面での操作', async () => {
  test.setTimeout(180000);
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/accessibility-'));
  await launch();
  const date = today();
  const seed = initialState();
  seed.settings.exams = [
    {
      id: 'e',
      name: '情報処理安全確保支援士試験',
      start: date,
      target: addDays(date, 14),
      priority: 2,
      color: '#c78341',
      reviewDays: 1,
    },
  ];
  seed.settings.materials = [
    {
      id: 'm',
      name: '分野別の過去問題集と解説',
      examId: 'e',
      total: 70,
      order: 1,
      rounds: [{ completed: 0, minutes: 3 }],
    },
  ];
  seed.settings.windows = [
    {
      id: 'w',
      name: '毎日の学習枠',
      kind: 'study',
      from: date,
      to: addDays(date, 20),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 540,
      end: 1080,
    },
    {
      id: 'c',
      name: 'プログラミング演習',
      kind: 'class',
      from: date,
      to: addDays(date, 20),
      weekdays: [1, 2, 3, 4, 5],
      start: 650,
      end: 750,
    },
  ];
  seed.records = [
    {
      id: 'r',
      materialId: 'm',
      round: 0,
      date,
      count: 7,
      cancelled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  seed.records.push({ ...seed.records[0], id: 'cancelled', cancelled: true, count: 3 });
  seed.plan = generatePlan(seed, date);
  seed.proposal = {
    plan: generatePlan(seed, date, true),
    basedOn: seed.plan.id,
    reason: '変更案を確認します。',
    unreported: [],
  };
  await seedState(seed, 'a11y-seed');
  const reports: { theme: string; screen: string; violations: unknown[]; incomplete: unknown[] }[] =
    [];
  for (const { theme, appearance } of ['mint', 'sky', 'lime'].flatMap((theme) =>
    ['light', 'dark'].map((appearance) => ({ theme, appearance })),
  )) {
    await displaySettings(appearance);
    await displaySettings(undefined, theme);
    await saved();
    for (const screen of [
      'ホーム',
      '学習カレンダー',
      '進捗を記録',
      '再計画の確認',
      '記録履歴',
      '週間レポート',
    ]) {
      await nav(screen);
      if (screen === 'ホーム') {
        await expect(page.getByRole('heading', { name: '今日', exact: true })).toBeVisible();
        await expect(page.locator('.hero')).toHaveCount(0);
      }
      if (screen === '再計画の確認') {
        const updatePlan = page.getByRole('button', { name: 'この内容で更新', exact: true });
        await updatePlan.scrollIntoViewIfNeeded();
        await expect(updatePlan).toBeInViewport({ ratio: 1 });
      }
      const result = await new AxeBuilder({ page })
        // WebView2 exposes one native window, not a browser that can open aggregation tabs.
        .setLegacyMode()
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      reports.push({
        theme: `${theme}-${appearance}`,
        screen,
        violations: result.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
        })),
        incomplete: result.incomplete.map((x) => ({
          id: x.id,
          targets: x.nodes.map((n) => n.target),
        })),
      });
      if (screen === 'ホーム' || screen === '進捗を記録' || screen === '学習カレンダー') {
        const view =
          screen === 'ホーム' ? 'home' : screen === '進捗を記録' ? 'progress' : 'calendar';
        await page.screenshot({ path: `test-results/contrast-${theme}-${appearance}-${view}.png` });
      }
    }
    await nav('再計画の確認');
    const replanDetails = page.locator('details.replan-details');
    await replanDetails.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(replanDetails).toHaveAttribute('open', '');
    const planTable = page.getByRole('region', { name: '一日の予定問題数の表' });
    if (theme === 'mint' && appearance === 'light') {
      await planTable.focus();
      await expect(planTable).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect
        .poll(() => planTable.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
      await expect(planTable).toBeFocused();
      await page.keyboard.press('End');
    } else {
      // Keyboard behavior is checked once; inspect the same final rows in every palette.
      await planTable.evaluate((element) =>
        element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }),
      );
    }
    await expect
      .poll(() =>
        planTable.evaluate(
          (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
        ),
      )
      .toBeLessThan(2);
    const bottom = await new AxeBuilder({ page })
      .setLegacyMode()
      .include('.daily-plan-table')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    reports.push({
      theme: `${theme}-${appearance}`,
      screen: '一日の予定問題数の表・末尾',
      violations: bottom.violations,
      incomplete: bottom.incomplete,
    });
    await page.screenshot({
      path: `test-results/readability-${theme}-${appearance}.png`,
      fullPage: true,
    });
  }
  await nav('試験・目標');
  await page.getByRole('button', { name: '情報処理安全確保支援士試験を編集', exact: true }).click();
  await expect(page.getByRole('button', { name: '表示色 #c78341', exact: true })).toHaveCSS(
    'background-color',
    'rgb(199, 131, 65)',
  );
  await page.getByRole('button', { name: '表示色 #4c89ac', exact: true }).click();
  await expect(page.getByRole('button', { name: '表示色 #4c89ac', exact: true })).toHaveCSS(
    'background-color',
    'rgb(76, 137, 172)',
  );
  await expect(page.getByRole('button', { name: '表示色 #4c89ac', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.swatch')).toHaveCount(16);
  await page.getByRole('button', { name: '表示色 #329ca2', exact: true }).click();
  await page.getByRole('button', { name: '試験を更新する', exact: true }).click();
  await saved();
  expect((await storedState()).settings.exams[0].color).toBe('#329ca2');
  await nav('学習カレンダー');
  await expect(page.locator('.calendar-event').first()).toHaveCSS(
    'border-left-color',
    'rgb(50, 156, 162)',
  );
  await page.emulateMedia({ colorScheme: 'dark' });
  await displaySettings('system');
  await saved();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
  await displaySettings('dark');
  await saved();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
  await displaySettings('light');
  await saved();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
  await displaySettings('system');
  await saved();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
  await page.setViewportSize({ width: 900, height: 640 });
  for (const screen of [
    '対話式の初期設定',
    '時間枠・時間割',
    '学習カレンダー',
    '進捗を記録',
    '記録履歴',
    '週間レポート',
  ]) {
    await nav(screen);
    expect
      .soft(await page.evaluate(() => document.documentElement.scrollWidth), screen)
      .toBeLessThanOrEqual(901);
  }
  await page.screenshot({ path: 'test-results/accessibility-small.png', fullPage: true });
  writeFileSync('test-results/accessibility.json', JSON.stringify(reports, null, 2));
  expect(
    reports
      .filter((r) => r.violations.length)
      .map((r) => ({ theme: r.theme, screen: r.screen, violations: r.violations })),
    '詳細は accessibility.json',
  ).toEqual([]);
  await close();
  await launch();
  await nav('設定');
  await expect(page.getByLabel('表示モード')).toHaveValue('system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
  expect((await storedState()).settings.exams[0].color).toBe('#329ca2');
});
async function seedState(data: AppState, requestId: string) {
  await page.evaluate(
    async ({ data, requestId }) => {
      const invoke = (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke: (name: string, args?: unknown) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__.invoke;
      let error: unknown;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const stored = (await invoke('load_state')) as { revision: number } | null;
        try {
          await invoke('commit_state', { expected: stored?.revision ?? 0, requestId, data });
          return;
        } catch (caught) {
          error = caught;
          if (!String(caught).includes('別の操作でデータが更新されました')) throw caught;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      throw error;
    },
    { data, requestId },
  );
  await page.reload();
}
test('実機：部分記録で今日の残りと翌日の配置を維持し、SQLite再起動後も残る', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/native-daily-flow-'));
  await launch();
  const date = today();
  const tomorrow = addDays(date, 1);
  const seed = initialState();
  seed.settings.exams = [{ id: 'exam', name: '資格試験', start: date, target: addDays(date, 2), priority: 2, color: '#287569', reviewDays: 0 }];
  seed.settings.materials = [{ id: 'book', examId: 'exam', name: '問題集A', total: 20, order: 1, rounds: [{ completed: 0, minutes: 2 }] }];
  seed.settings.windows = [date, tomorrow].map((day) => ({ id: day, name: '学習枠', kind: 'study' as const, from: day, to: day, weekdays: [0, 1, 2, 3, 4, 5, 6], start: 1080, end: 1140 }));
  seed.settings.buffer = 0;
  seed.settings.scheduleAnswers = { class: 'none', busy: 'none', exception: 'none' };
  const originalToday = { id: 'today-work', date, start: 1080, end: 1100, examId: 'exam', materialId: 'book', round: 0, count: 10, fixed: false, kind: 'study' as const };
  seed.plan = {
    id: 'approved', createdAt: new Date().toISOString(), calculationVersion: PLAN_CALCULATION_VERSION,
    settingsSnapshot: structuredClone(seed.settings), settingsUpdatedAt: seed.settingsUpdatedAt,
    from: date, notBefore: 0,
    sessions: [originalToday, { ...originalToday, id: 'tomorrow-work', date: tomorrow }],
    capacities: [], shortfalls: [], conflicts: [],
  };
  seed.plan.progressBaseline = createProgressBaseline(seed.plan, seed.records);
  await seedState(seed, 'native-daily-seed');
  const row = page.locator('.daily-record-row').filter({ hasText: '問題集A' });
  await expect(row).toContainText('未報告 / 10問');
  await expect(row).toContainText('未報告 / 10問');
  await row.getByRole('textbox', { name: '問題集A 1周目の実績（問）' }).fill('5');
  await row.getByRole('button', { name: '記録', exact: true }).click();
  await saved();
  await expect(row).toContainText('5/10問');
  const recordResult = page.locator('.daily-record-saved');
  await expect(recordResult).toContainText('5問を記録しました。予定の変更なし');
  const changeDetail = recordResult.locator('details');
  await expect(changeDetail).not.toHaveAttribute('open', '');
  await expect(changeDetail.locator('summary')).toHaveText('結果を見る');
  await changeDetail.locator('summary').click();
  await expect(changeDetail).toContainText('予定の変更なし');
  await nav('今後の予定');
  await expect(page.locator('.future-day').filter({ has: page.getByRole('button', { name: new RegExp(`^${tomorrow} `) }) })).toContainText('10問');
  let persisted = await storedState();
  expect(persisted.records).toHaveLength(1);
  expect(persisted.records[0]).toMatchObject({ date, materialId: 'book', round: 0, count: 5, cancelled: false });
  expect(persisted.studyDayBaselines?.[date].rows[0].count).toBe(10);
  expect(persisted.plan!.sessions.filter((session) => session.date === date)).toEqual([originalToday]);
  expect(persisted.plan!.sessions.filter((session) => session.date === tomorrow).reduce((sum, session) => sum + session.count, 0)).toBe(10);
  await close();
  browser = undefined!;
  await launch();
  persisted = await storedState();
  expect(persisted.records[0].count).toBe(5);
  expect(persisted.studyDayBaselines?.[date].rows[0].count).toBe(10);
  await nav('詳細カレンダー');
  await page.getByRole('button', { name: '学習量', exact: true }).click();
  await page.locator('.calendar-toolbar').getByRole('button', { name: '今日', exact: true }).click();
  expect(persisted.plan!.sessions.filter((session) => session.date === date)).toEqual([originalToday]);
  expect(persisted.plan!.sessions.filter((session) => session.date === tomorrow).reduce((sum, session) => sum + session.count, 0)).toBe(10);
  await nav('今後の予定');
  await expect(page.locator('.future-day').filter({ has: page.getByRole('button', { name: new RegExp(`^${tomorrow} `) }) })).toContainText('10問');
  await page.locator('.plan-change-history > summary').click();
  const persistedChange = page.locator('.plan-change-history details').first();
  await persistedChange.locator('summary').click();
  await expect(persistedChange).toContainText('予定の変更なし');
  const futureQuantity = async (materialId = 'book') => (await storedState()).plan!.sessions
    .filter((session) => session.date === tomorrow && session.materialId === materialId)
    .reduce((sum, session) => sum + session.count, 0);
  await nav('記録履歴');
  await page.getByRole('button', { name: '訂正', exact: true }).click();
  await page.getByLabel('訂正後の問題数').fill('8');
  await page.getByRole('button', { name: '訂正を保存', exact: true }).click();
  await saved();
  expect(await futureQuantity()).toBe(10);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '取消を確定', exact: true }).click();
  await saved();
  expect(await futureQuantity()).toBe(10);
  expect((await storedState()).records[0].cancelled).toBe(true);
  await nav('ホーム');
  await expect(page.locator('.daily-record-row')).toContainText('未報告 / 10問');
  for (const [actual, expected] of [[0, 10], [10, 10], [15, 5]]) {
    await seedState(seed, `native-daily-${actual}`);
    const activeRow = page.locator('.daily-record-row');
    await activeRow.getByRole('textbox').fill(String(actual));
    await activeRow.getByRole('button', { name: '記録', exact: true }).click();
    await saved();
    await expect(activeRow).toContainText(`${actual}/10問`);
    expect(await futureQuantity()).toBe(expected);
    expect((await storedState()).plan!.sessions.filter((session) => session.date === date)).toEqual([originalToday]);
    await nav('今後の予定');
    await expect(page.locator('.future-day').filter({ has: page.getByRole('button', { name: new RegExp(`^${tomorrow} `) }) })).toContainText(`${expected}問`);
  }
  const outsideSeed = structuredClone(seed);
  outsideSeed.settings.block = 60;
  outsideSeed.settings.materials.push({ id: 'outside', examId: 'exam', name: '予定外問題集', total: 4, order: 2, rounds: [{ completed: 0, minutes: 5 }] });
  outsideSeed.plan!.settingsSnapshot = structuredClone(outsideSeed.settings);
  await seedState(outsideSeed, 'native-outside');
  await page.locator('.outside-record > summary').click();
  await page.getByRole('combobox', { name: /^問題集/ }).selectOption('outside');
  await page.getByLabel('追加問数').fill('2');
  await page.locator('.outside-record').getByRole('button', { name: '記録', exact: true }).click();
  await saved();
  await expect(page.getByRole('listitem').filter({ hasText: '予定外問題集' })).toContainText('2/0問');
  await expect(page.getByRole('listitem').filter({ hasText: '予定外問題集' })).toContainText('2/0問');
  expect(await futureQuantity()).toBe(10);
  expect(await futureQuantity('outside')).toBe(2);
  const beforeRestart = await storedState();
  await closeWindowNormally();
  await launch();
  const afterRestart = await storedState();
  expect(afterRestart.records).toEqual(beforeRestart.records);
  expect(afterRestart.settings).toEqual(beforeRestart.settings);
  expect(afterRestart.plan).toEqual(beforeRestart.plan);
  expect(afterRestart.studyDayBaselines).toEqual(beforeRestart.studyDayBaselines);
});
async function calendarSavePath(path: string | null) {
  await page.evaluate((path) => {
    const nativeFetch = window.fetch.bind(window);
    let once = true;
    window.fetch = (input, options) => {
      if (once && decodeURIComponent(String(input)).includes('plugin:dialog|save')) {
        once = false;
        return Promise.resolve(
          new Response(JSON.stringify(path), {
            headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' },
          }),
        );
      }
      return nativeFetch(input, options);
    };
  }, path);
}
test('実機：教材別の今日・周回・記録・訂正・取消・空表示', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/progress-chart-'));
  await launch();
  await nav('進捗を記録');
  await expect(page.getByRole('combobox', { name: '教材', exact: true }).locator('option')).toHaveText(['教材を選択']);
  const seed = initialState();
  const date = today();
  seed.settings.exams = [
    {
      id: 'e',
      name: '試験',
      start: date,
      target: addDays(date, 30),
      priority: 1,
      color: '#216957',
      reviewDays: 0,
    },
  ];
  seed.settings.materials = [
    {
      id: 'm',
      examId: 'e',
      name: '短答',
      total: 20,
      order: 1,
      rounds: [
        { completed: 3, minutes: 3 },
        { completed: 0, minutes: 3 },
      ],
    },
    {
      id: 'essay',
      examId: 'e',
      name: '論文',
      total: 10,
      order: 2,
      rounds: [{ completed: 2, minutes: 30 }],
    },
  ];
  seed.records = [
    {
      id: 'cancelled',
      materialId: 'm',
      round: 0,
      date,
      count: 7,
      cancelled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  seed.draft.progress = { date, materialId: 'm', round: 0, choice: '', custom: '' };
  seed.plan = {
    id: 'p',
    createdAt: new Date().toISOString(),
    from: date,
    settingsSnapshot: structuredClone(seed.settings),
    capacities: [],
    conflicts: [],
    shortfalls: [],
    sessions: [
      {
        id: 'short',
        date,
        start: 600,
        end: 630,
        materialId: 'm',
        examId: 'e',
        round: 0,
        count: 10,
        kind: 'study',
        fixed: false,
      },
      {
        id: 'essay',
        date,
        start: 700,
        end: 940,
        materialId: 'essay',
        examId: 'e',
        round: 0,
        count: 8,
        kind: 'study',
        fixed: false,
      },
    ],
  };
  await seedState(seed, 'progress-chart');
  await nav('ホーム');
  const shortRow = page.getByRole('listitem').filter({ hasText: '短答' });
  const essayRow = page.getByRole('listitem').filter({ hasText: '論文' });
  await expect(shortRow).toContainText('未報告 / 10問');
  await expect(essayRow).toContainText('未報告 / 8問');
  // Initial completion belongs to the round; it must never become today's actual work.
  await nav('進捗を記録');
  await expect(page.locator('.progress-summary')).toContainText('完了 3問');
  await expect(page.locator('.progress-summary')).toContainText('残り 17問');
  await page.getByLabel('周回', { exact: true }).selectOption('1');
  await expect(page.locator('.progress-summary')).toContainText('完了 0問');
  await expect(page.locator('.progress-summary')).toContainText('残り 20問');
  await page.getByLabel('教材', { exact: true }).selectOption('essay');
  await expect(page.locator('.progress-summary')).toContainText('完了 2問');
  await expect(page.locator('.progress-summary')).toContainText('残り 8問');
  await page.getByRole('button', { name: 'その他', exact: true }).click();
  await page.getByLabel('追加問題数（1問単位）').fill('3');
  await page.getByLabel('追加問題数（1問単位）').press('Enter');
  await saved();
  await expect(page.locator('.progress-summary')).toContainText('完了 5問');
  await expect(page.locator('.progress-summary')).toContainText('残り 5問');
  await nav('ホーム');
  await expect(essayRow).toContainText('3/8問');
  await expect(shortRow).toContainText('未報告 / 10問');
  await nav('記録履歴');
  await page.getByRole('button', { name: '訂正', exact: true }).click();
  await page.getByLabel('訂正後の問題数').fill('7');
  await page.getByRole('button', { name: '訂正を保存' }).click();
  await saved();
  await nav('ホーム');
  await expect(essayRow).toContainText('7/8問');
  await expect(shortRow).toContainText('未報告 / 10問');
  await nav('記録履歴');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '取消を確定' }).click();
  await saved();
  await nav('ホーム');
  await expect(essayRow).toContainText('未報告 / 8問');
  for (const theme of ['mint', 'sky', 'lime']) {
    await displaySettings(undefined, theme);
    expect((await new AxeBuilder({ page }).include('.daily-record-list').analyze()).violations).toEqual([]);
    await page.screenshot({ path: 'test-results/progress-chart-' + theme + '.png', fullPage: true });
  }
  await nav('進捗を記録');
  await page.getByRole('button', { name: '残りすべて：8問' }).click();
  await page.getByRole('button', { name: '記録する', exact: true }).click();
  await saved();
  await expect(page.locator('.progress-summary')).toContainText('完了 10問');
  await expect(page.locator('.progress-summary')).toContainText('残り 0問');
  await page.getByRole('button', { name: /^0\s*問$/ }).click();
  await page.getByRole('button', { name: '記録する', exact: true }).click();
  await saved();
  await expect(page.locator('.progress-summary')).toContainText('完了 10問');
  await expect(page.locator('.progress-summary')).toContainText('残り 0問');
  await nav('ホーム');
  await expect(essayRow).toContainText('8/8問');
  await expect(shortRow).toContainText('未報告 / 10問');
  await page.setViewportSize({ width: 900, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/progress-chart-900.png', fullPage: true });
  await close();
  await launch();
  await expect(page.getByRole('listitem').filter({ hasText: '論文' })).toContainText('8/8問');
  await expect(page.getByRole('listitem').filter({ hasText: '短答' })).toContainText('未報告 / 10問');
});

test('実機：通学の承認・警告の管理・サイドバー保存・可変幅・進捗アニメーション', async () => {
  test.setTimeout(180000);
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/adaptive-commute-'));
  await launch();
  const date = today();
  const s = initialState();
  s.settings.exams = [
    {
      id: 'e',
      name: '資格試験',
      start: date,
      target: addDays(date, 20),
      priority: 1,
      color: '#287569',
      reviewDays: 0,
    },
  ];
  s.settings.materials = [
    {
      id: 'm',
      examId: 'e',
      name: '過去問',
      total: 100,
      order: 1,
      rounds: [{ completed: 20, minutes: 3 }],
    },
  ];
  s.settings.windows = [
    {
      id: 'w',
      kind: 'study',
      name: '学習枠',
      from: date,
      to: addDays(date, 30),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 480,
      end: 1260,
    },
    {
      id: 'c',
      kind: 'class',
      name: '授業',
      from: date,
      to: addDays(date, 30),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 600,
      end: 700,
    },
  ];
  s.records = [
    {
      id: 'r',
      date,
      materialId: 'm',
      round: 0,
      count: 1,
      cancelled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  s.plan = generatePlan(s, date, false);
  const fixed = s.plan.sessions[0];
  fixed.fixed = true;
  s.settings.rest += 1;
  await seedState(s, 'adaptive-seed');
  const warning = page.getByRole('region', {
    name: '保存済みの計画と現在の設定が一致していません。',
    exact: true,
  });
  await warning.getByRole('button', { name: /保存済みの計画/ }).click();
  await expect(warning.locator('.warning-content')).toHaveCount(0);
  await warning.getByRole('button', { name: /保存済みの計画/ }).click();
  await warning.getByRole('button', { name: '通知を非表示', exact: true }).click();
  await saved();
  await expect(warning).toHaveCount(0);
  expect((await storedState()).plan).toEqual(s.plan);
  const beforeWidth = (await page.locator('main').boundingBox())!.width;
  await expect(page.locator('.sidebar-toggle')).toHaveText('◀');
  const rail = (await page.locator('.sidebar-toggle').boundingBox())!;
  expect(rail.width).toBe(12);
  expect(rail.x + rail.width).toBe((await page.locator('main').boundingBox())!.x);
  expect(rail.height).toBe(await page.evaluate(() => window.innerHeight));
  await page.getByRole('button', { name: 'サイドバーを折りたたむ' }).click();
  await saved();
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('.sidebar-toggle')).toHaveText('▶');
  expect((await page.locator('main').boundingBox())!.x).toBe(12);
  await page.screenshot({ path: 'test-results/sidebar-rail-collapsed.png' });
  expect((await page.locator('main').boundingBox())!.width).toBeGreaterThan(beforeWidth);
  await close();
  await launch();
  await expect(page.getByRole('button', { name: 'サイドバーを開く' })).toBeVisible();
  await expect(page.locator('.sidebar')).toBeHidden();
  await page.getByRole('button', { name: 'サイドバーを開く' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.sidebar-toggle')).toHaveText('◀');
  await saved();
  await page.screenshot({ path: 'test-results/sidebar-rail-expanded.png' });
  await expect(
    page.getByRole('region', {
      name: '保存済みの計画と現在の設定が一致していません。',
      exact: true,
    }),
  ).toHaveCount(0);
  await nav('警告の管理');
  await page
    .getByRole('button', { name: '保存済みの計画と現在の設定が一致していません。を再表示' })
    .click();
  await nav('ホーム');
  await expect(
    page.getByRole('region', {
      name: '保存済みの計画と現在の設定が一致していません。',
      exact: true,
    }),
  ).toBeVisible();
  await nav('通学時間');
  await page.getByLabel('通学時間を確保する').check();
  await page.getByLabel('通学の適用終了日').fill(addDays(date, 30));
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.getByLabel('往路の出発時刻').fill('09:30');
  await page.getByLabel('往路の出発時刻').press('Enter');
  await page.getByLabel('往路の所要時間（分）').fill('');
  await page.getByLabel('往路の所要時間（分）').fill('30');
  await page.getByLabel('往路の所要時間（分）').press('Enter');
  await page.getByLabel('復路の出発時刻').fill('11:40');
  await page.getByLabel('復路の出発時刻').press('Enter');
  await page.getByLabel('復路の所要時間（分）').fill('45');
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.getByRole('button', { name: 'この通学設定を使う', exact: true }).click();
  await expect(page.getByRole('heading', { name: '計画案の確認', exact: true })).toBeVisible();
  expect((await storedState()).settings.commute).toBeUndefined();
  const proposal = (await storedState()).proposal!;
  expect(proposal.plan.settingsSnapshot!.commute!.returnMinutes).toBe(45);
  expect(proposal.plan.sessions.find((x) => x.id === fixed.id)).toEqual(fixed);
  if (proposal.unreported.length)
    await page.getByLabel('未報告は記録を保留したまま、現在の残数を今後の枠へ再配置する').check();
  await page.getByRole('button', { name: 'この内容で更新', exact: true }).click();
  await saved();
  const approved = await storedState();
  expect(approved.settings.commute!.enabled).toBe(true);
  expect(approved.records).toEqual(s.records);
  for (const session of approved.plan!.sessions)
    expect(overlapsBusy(approved.settings, session)).toEqual([]);
  await nav('再計画の確認');
  await page.getByRole('button', { name: '対話で条件を見直す', exact: true }).click();
  await page
    .getByRole('region', { name: '対話式の再計画', exact: true })
    .getByRole('button', { name: '通学時間', exact: true })
    .click();
  await expect(page.getByLabel('通学時間を確保する')).toBeChecked();
  await page.getByLabel('適用する日', { exact: true }).selectOption('weekdays');
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.getByLabel('往路の出発時刻').fill('07:15');
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await expect(page.getByLabel('往路の所要時間（分）')).toHaveValue('30');
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.getByLabel('復路の出発時刻').fill('18:30');
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await expect(page.getByLabel('復路の所要時間（分）')).toHaveValue('45');
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.getByRole('button', { name: 'この通学設定を使う', exact: true }).click();
  await page.getByRole('button', { name: '変更内容を確認する', exact: true }).click();
  await page.getByRole('button', { name: 'この条件で再計画案を作成', exact: true }).click();
  await saved();
  expect((await storedState()).proposal!.plan.settingsSnapshot!.commute!.mode).toBe('weekdays');
  expect((await storedState()).settings.commute).toEqual(approved.settings.commute);
  await page.getByRole('button', { name: '案を破棄する', exact: true }).click();
  await saved();
  for (const width of [1400, 900, 640, 480]) {
    await page.setViewportSize({ width, height: 800 });
    for (const screen of [
      'ホーム',
      '学習カレンダー',
      '進捗を記録',
      '教材・進捗',
      '通学時間',
      '警告の管理',
      ...(width === 480
        ? [
            '時間枠・時間割',
            '連続時間・余裕率',
            '試験・目標',
            '対話式の初期設定',
            '週間レポート',
            '記録履歴',
            'バックアップ',
            'チュートリアル',
            '再計画の確認',
          ]
        : []),
    ]) {
      await nav(screen);
      expect
        .soft(
          await page.evaluate(() => document.documentElement.scrollWidth),
          `${width}px ${screen}`,
        )
        .toBeLessThanOrEqual(width + 1);
    }
  }
  await displaySettings('dark');
  await nav('進捗を記録');
  await page.screenshot({ path: 'test-results/adaptive-480-dark.png', fullPage: true });
  expect(
    (await new AxeBuilder({ page }).setLegacyMode().withTags(['wcag2a', 'wcag2aa']).analyze())
      .violations,
  ).toEqual([]);
  await page.setViewportSize({ width: 1100, height: 900 });
  await nav('教材・進捗');
  const bar = page.getByRole('progressbar', { name: '過去問の進捗' });
  await expect(bar).toHaveAttribute('aria-valuenow', '21');
  await expect(bar.locator('span')).toHaveCSS('transition-duration', '0.7s');
  await expect
    .poll(() =>
      bar
        .locator('span')
        .evaluate((el) =>
          Number(getComputedStyle(el).transform.match(/matrix\(([^,]+)/)?.[1] ?? 0),
        ),
    )
    .toBeCloseTo(0.21, 2);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(bar.locator('span')).toHaveCSS('transition-duration', '0s');
  await close();
  await launch();
  expect((await storedState()).settings.commute).toEqual(approved.settings.commute);
});

test('実機：時間内訳で指定時刻の往復100分と移動しない昼食を表示する', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/commute-meal-overlap-'));
  await launch();
  const date = today();
  const s = initialState();
  s.settings.windows = [
    {
      id: 'study',
      kind: 'study',
      name: '学習',
      from: date,
      to: date,
      weekdays: [weekday(date)],
      start: 480,
      end: 1290,
    },
    {
      id: 'c1',
      kind: 'class',
      name: '授業',
      from: date,
      to: date,
      weekdays: [weekday(date)],
      start: 540,
      end: 640,
    },
    {
      id: 'c2',
      kind: 'class',
      name: '授業',
      from: date,
      to: date,
      weekdays: [weekday(date)],
      start: 650,
      end: 750,
    },
  ];
  s.settings.meals = {
    breakfast: { start: 420, duration: 30 },
    lunch: { start: 750, duration: 60 },
    dinner: { start: 1320, duration: 45 },
  };
  s.settings.commute = {
    enabled: true,
    from: date,
    to: date,
    mode: 'classDays',
    weekdays: [weekday(date)],
    outboundMinutes: 50,
    returnMinutes: 50,
    departureTimesConfirmed: true,
    outboundStart: 490,
    returnStart: 810,
  };
  await seedState(s, 'overlap-home');
  await nav('今日のスケジュール');
  const card = page.getByRole('region', { name: '1日の可処分時間', exact: true });
  await expect(card.locator('.daily-commute')).not.toBeVisible();
  await card.screenshot({ path: 'test-results/daily-time-normal.png' });
  await card.locator('.daily-time-details > summary').click();
  await expect(card.locator('.daily-commute')).toContainText('この日の通学：計1時間 40分');
  await expect(card.locator('.daily-commute-list > div').filter({ hasText: '往路' })).toContainText(
    '08:10〜09:00 · 50分',
  );
  await expect(card.locator('.daily-commute-list > div').filter({ hasText: '復路' })).toContainText(
    '13:30〜14:20 · 50分',
  );
  await expect(
    card.getByRole('row', { name: '12:30〜13:30 食事 1時間', exact: true }),
  ).toBeVisible();
  await expect(
    card.getByRole('row', { name: '09:00〜12:30 授業・予定・移動 3時間 30分', exact: true }),
  ).toBeVisible();
  expect(await card.locator('tbody tr[data-kind=rest]').count()).toBeGreaterThan(0);
  for (const appearance of ['light', 'dark']) {
    await displaySettings(appearance);
    await page.setViewportSize({ width: 480, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      481,
    );
    expect(
      (
        await new AxeBuilder({ page })
          .include('.daily-time')
          .setLegacyMode()
          .withTags(['wcag2a', 'wcag2aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
  }
  await card.screenshot({ path: 'test-results/home-commute-overlap.png' });
  expect((await storedState()).settings).toEqual(s.settings);
});

test('実機：日別バッファーなし・週の割当上限・旧計画からの承認と再起動', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/weekly-limit-'));
  await launch();
  const monday = addDays(startOfWeek(today()), 7);
  const s = initialState();
  s.settings.block = 120;
  s.settings.rest = 10;
  s.settings.buffer = 0.2;
  s.settings.exams = [
    {
      id: 'e',
      name: '週上限の試験',
      start: monday,
      target: addDays(monday, 6),
      priority: 1,
      color: '#287569',
      reviewDays: 0,
    },
  ];
  s.settings.materials = [
    {
      id: 'm',
      examId: 'e',
      name: '教材',
      total: 4000,
      order: 1,
      rounds: [{ completed: 0, minutes: 1 }],
    },
  ];
  s.settings.windows = [
    {
      id: 'w',
      name: '平日',
      kind: 'study',
      from: monday,
      to: addDays(monday, 6),
      weekdays: [1, 2, 3, 4, 5],
      start: 540,
      end: 920,
    },
  ];
  s.records = [
    {
      id: 'zero',
      date: today(),
      materialId: 'm',
      round: 0,
      count: 0,
      cancelled: false,
      createdAt: 'now',
      updatedAt: 'now',
    },
  ];
  s.plan = generatePlan(s, monday, false, 0, 'earliest');
  s.plan.calculationVersion = 6;
  await seedState(s, 'weekly-limit-seed');
  await nav('今日のスケジュール');
  await expect(page.locator('.daily-time .time-buffer')).toHaveCount(0);
  await expect(page.locator('.daily-time')).not.toContainText('余裕として残す時間');
  await nav('再計画の確認');
  await page.getByRole('button', { name: '設定を変えずに再計画', exact: true }).click();
  await saved();
  expect((await storedState()).plan).toEqual(s.plan);
  await page.locator('details.replan-details > summary').click();
  await expect(page.getByText('週全体の割当上限', { exact: true })).toBeVisible();
  const row = page
    .locator('.plan-insights tr')
    .filter({ hasText: `${monday}〜${addDays(monday, 6)}` });
  await expect(row).toContainText('30時間');
  await expect(row).toContainText('24時間');
  await expect(row.getByRole('cell', { name: '6時間', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/weekly-limit-preview.png', fullPage: true });
  await page.getByRole('button', { name: 'この内容で更新', exact: true }).click();
  await saved();
  const approved = await storedState();
  expect(approved.plan!.calculationVersion).toBe(PLAN_CALCULATION_VERSION);
  expect(capacityForWeek(approved.settings, monday, approved.plan!.sessions).used).toBe(1440);
  expect(
    approved
      .plan!.capacities.filter((c) => c.date >= monday && c.date < addDays(monday, 5))
      .every((c) => c.allocatable === 360),
  ).toBe(true);
  await close();
  await launch();
  expect((await storedState()).plan).toEqual(approved.plan);
  expect((await storedState()).records).toEqual(s.records);
  await nav('再計画の確認');
  await page.getByRole('button', { name: '前の計画へ戻す', exact: true }).click();
  await page.getByRole('button', { name: '計画を戻す', exact: true }).click();
  await saved();
  expect((await storedState()).plan).toEqual(s.plan);
  expect((await storedState()).records).toEqual(s.records);
});

test('実機：週間レポートの全体比較・Markdown保存・取消・保存失敗', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/weekly-report-'));
  await launch();
  const from = addDays(startOfWeek(today()), -7);
  const s = initialState();
  s.settings.exams = ['e1', 'e2'].map((id) => ({
    id,
    name: `試験${id}`,
    start: addDays(from, -7),
    target: addDays(from, 30),
    priority: 2,
    color: '#4c89ac',
    reviewDays: 0,
  }));
  s.settings.materials = [
    {
      id: 'm1',
      examId: 'e1',
      name: '問題|集📘',
      total: 37,
      order: 1,
      rounds: [
        { completed: 4, minutes: 2 },
        { completed: 2, minutes: 3 },
      ],
    },
    {
      id: 'm2',
      examId: 'e2',
      name: '問題集B',
      total: 20,
      order: 1,
      rounds: [{ completed: 0, minutes: 2 }],
    },
  ];
  s.settings.windows = [
    {
      id: 'w',
      kind: 'study',
      name: '学習枠',
      from: addDays(from, -7),
      to: addDays(from, 30),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 540,
      end: 720,
    },
  ];
  s.plan = {
    id: 'p',
    from,
    createdAt: `${from}T00:00:00.000Z`,
    capacities: [],
    conflicts: [],
    shortfalls: [],
    settingsSnapshot: structuredClone(s.settings),
    sessions: [0, 1, 2, 3].map((i) => ({
      id: `s${i}`,
      date: addDays(from, i),
      materialId: i === 3 ? 'm2' : 'm1',
      examId: i === 3 ? 'e2' : 'e1',
      round: i === 1 || i === 2 ? 1 : 0,
      start: 540,
      end: 570,
      count: i === 3 ? 5 : 7,
      kind: 'study',
      fixed: false,
    })),
  };
  s.records = [
    {
      id: 'before',
      date: addDays(from, -1),
      materialId: 'm1',
      round: 0,
      count: 5,
      cancelled: false,
    },
    { id: 'three', date: from, materialId: 'm1', round: 0, count: 3, cancelled: false },
    { id: 'seven', date: addDays(from, 1), materialId: 'm1', round: 1, count: 7, cancelled: false },
    {
      id: 'cancelled',
      date: addDays(from, 2),
      materialId: 'm1',
      round: 1,
      count: 7,
      cancelled: true,
    },
    { id: 'zero', date: addDays(from, 3), materialId: 'm2', round: 0, count: 0, cancelled: false },
    { id: 'later', date: addDays(from, 7), materialId: 'm1', round: 1, count: 2, cancelled: false },
  ].map((r) => ({
    ...r,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  s.proposal = {
    plan: { ...s.plan, id: 'pending', sessions: [] },
    basedOn: 'p',
    reason: '未承認',
    unreported: [],
  };
  await seedState(s, 'report-seed');
  await nav('週間レポート');
  await page.getByRole('button', { name: '前の週', exact: true }).click();
  const preview = page.getByRole('region', { name: '週間レポートのプレビュー' });
  await expect(preview).toContainText(`${from}〜${addDays(from, 6)}`);
  await expect(preview).toContainText('完了 23 / 94問');
  await expect(preview).toContainText('週間予定 26問');
  await expect(preview).toContainText('10.6%');
  const days = page.getByRole('region', { name: '週間の日別実績' });
  await expect(days.getByRole('row').filter({ hasText: addDays(from, 2) })).toContainText(
    '未報告 1件',
  );
  await expect(days.getByRole('row').filter({ hasText: addDays(from, 3) })).toContainText(
    '0実績報告 1件',
  );
  const before = await storedState();
  await calendarSavePath(null);
  await page.getByRole('button', { name: 'Markdownを保存', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Markdownを保存', exact: true })).toBeEnabled();
  await expect(page.getByText(/レポートを保存しました/)).toHaveCount(0);
  const file = resolve(dataDir, '先週のレポート.md');
  await calendarSavePath(file);
  await page.getByRole('button', { name: 'Markdownを保存', exact: true }).dblclick();
  await expect(
    page.getByRole('status').filter({ hasText: 'レポートを保存しました' }),
  ).toBeVisible();
  expect(existsSync(file)).toBe(true);
  const text = readFileSync(file, 'utf8');
  expect(text).toContain('| 週間の追加完了数 | 10問 |');
  expect(text).toContain('| 全体の完了数（出力時点） | 23 / 94問 |');
  expect(text).toContain('| 週間の学習予定 | 26問 |');
  expect(text).toContain('問題\\|集📘');
  expect(text).toContain('0実績報告 1件');
  expect(text).toContain('未報告 1件');
  const protectedFile = resolve(dataDir, '上書きしない.txt');
  writeFileSync(protectedFile, '元の内容');
  await calendarSavePath(protectedFile);
  await page.getByRole('button', { name: 'Markdownを保存', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('.md');
  expect(readFileSync(protectedFile, 'utf8')).toBe('元の内容');
  expect(await storedState()).toEqual(before);
  await page.getByLabel('レポートの対象日（その日を含む週）').fill('');
  await expect(page.getByRole('button', { name: 'Markdownを保存', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '今週', exact: true }).click();
  await expect(page.getByRole('button', { name: '次の週', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '前の週', exact: true }).click();
  await page.setViewportSize({ width: 900, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(901);
  await page.screenshot({ path: 'test-results/weekly-report.png', fullPage: true });
  await close();
  await launch();
  await nav('週間レポート');
  await page.getByRole('button', { name: '前の週', exact: true }).click();
  await expect(page.getByRole('region', { name: '週間レポートのプレビュー' })).toContainText(
    '完了 23 / 94問',
  );
  expect(await storedState()).toEqual(before);
});
test('実機：授業名の曜日・時刻順と、選択式ICSの保存・取消', async () => {
  await close();
  browser = undefined!;
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/ics-'));
  await launch();
  const date = addDays(today(), (8 - weekday(today())) % 7 || 7);
  const end = addDays(date, 6);
  const seed = initialState();
  seed.settings.exams = ['a', 'b'].map((id) => ({
    id,
    name: `試験${id}`,
    start: date,
    target: end,
    priority: 2,
    color: '#4c89ac',
    reviewDays: 0,
  }));
  seed.settings.materials = ['a', 'b'].map((id) => ({
    id,
    examId: id,
    name: `教材${id}`,
    total: 7,
    order: 1,
    rounds: [{ completed: 0, minutes: 2 }],
  }));
  seed.settings.windows = [
    {
      id: 'w',
      kind: 'study',
      name: '学習枠',
      from: date,
      to: end,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 540,
      end: 1080,
    },
    ...[
      { id: 'fri', name: '金曜の授業', day: 5, start: 540 },
      { id: 'mon-late', name: '午後の演習', day: 1, start: 780 },
      { id: 'tue', name: '統計学', day: 2, start: 650 },
      { id: 'mon', name: '経済学', day: 1, start: 540 },
    ].map(({ id, name, day, start }) => ({
      id,
      name,
      kind: 'class' as const,
      from: date,
      to: end,
      weekdays: [day],
      start,
      end: start + 100,
    })),
  ];
  seed.settings.meals = { lunch: { start: 720, duration: 45 } };
  seed.plan = generatePlan(seed, date);
  expect(seed.plan.sessions).toHaveLength(2);
  seed.proposal = {
    plan: { ...structuredClone(seed.plan), sessions: [] },
    basedOn: seed.plan.id,
    reason: '未承認',
    unreported: [],
  };
  await seedState(seed, 'ics-seed');
  await nav('対話式の初期設定');
  await page.getByRole('button', { name: '設定項目を選んで修正する' }).click();
  await page.getByRole('button', { name: `大学の授業：${date}〜${end}`, exact: true }).click();
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  const names = page.locator('.class-names input');
  expect(
    await names.evaluateAll((inputs) => inputs.map((x) => (x as HTMLInputElement).value)),
  ).toEqual(['経済学', '午後の演習', '統計学', '金曜の授業']);
  await names.first().fill('経済学・演習');
  await saved();
  await page.screenshot({ path: 'test-results/class-name-order.png', fullPage: true });
  const before = await storedState();
  expect(before.settings.windows.find((x) => x.id === 'mon')!.name).toBe('経済学・演習');
  await nav('学習カレンダー');
  await page.getByRole('button', { name: 'ICSを書き出す', exact: true }).click();
  const exporter = page.getByRole('region', { name: 'ICS書き出し', exact: true });
  await exporter.getByLabel('書き出す開始日').fill('');
  await exporter.getByRole('button', { name: 'ICSを保存する' }).click();
  await expect(exporter.getByRole('alert')).toContainText('開始日と終了日');
  await exporter.getByLabel('書き出す開始日').fill(date);
  await exporter.getByLabel('書き出す終了日').fill(end);
  await calendarSavePath(null);
  await exporter.getByRole('button', { name: 'ICSを保存する' }).click();
  await expect(exporter.getByRole('button', { name: 'ICSを保存する' })).toBeEnabled();
  expect(await storedState()).toEqual(before);
  const path = resolve(dataDir, '学習と大学.ics');
  async function exportEvents() {
    await calendarSavePath(path);
    await exporter.getByRole('button', { name: 'ICSを保存する' }).click();
    await expect(exporter.getByRole('status')).toContainText('書き出しました');
    return new ICAL.Component(ICAL.parse(readFileSync(path, 'utf8')))
      .getAllSubcomponents('vevent')
      .map((c) => new ICAL.Event(c));
  }
  let events = await exportEvents();
  expect(events).toHaveLength(6);
  expect(events.map((x) => x.summary)).toContain('経済学・演習');
  expect(events.filter((x) => x.summary.includes('教材'))).toHaveLength(2);
  expect(events.map((x) => x.summary).join(' ')).not.toContain('昼食');
  await page.screenshot({ path: 'test-results/calendar-export.png', fullPage: true });
  await exporter.getByLabel('学習予定', { exact: true }).uncheck();
  events = await exportEvents();
  expect(events).toHaveLength(4);
  expect(events.every((x) => !x.summary.includes('教材'))).toBe(true);
  await exporter.getByLabel('学習予定', { exact: true }).check();
  await exporter.getByLabel('大学の授業（授業名付き）', { exact: true }).uncheck();
  await exporter.getByLabel('書き出す試験').selectOption('a');
  events = await exportEvents();
  expect(events.map((x) => x.summary)).toEqual(['試験a / 教材a・7問']);
  expect(await storedState()).toEqual(before);
});

test('実機：固定エラーの理由・該当設定への修正・固定解除と承認', async () => {
  await close();
  browser = undefined!;
  dataDir = mkdtempSync(resolve('.test-data/constraint-'));
  await launch();
  const date = addDays(today(), 1);
  let seed = initialState();
  seed.settings.exams = [
    {
      id: 'e',
      name: '資格',
      start: addDays(today(), -1),
      target: addDays(date, 7),
      priority: 2,
      color: '#4c89ac',
      reviewDays: 0,
    },
  ];
  seed.settings.materials = [
    {
      id: 'm',
      examId: 'e',
      name: '問題集',
      total: 30,
      order: 1,
      rounds: [{ completed: 0, minutes: 2 }],
    },
  ];
  seed.settings.windows = [
    {
      id: 'w',
      kind: 'study',
      name: '学習枠',
      from: addDays(today(), -1),
      to: addDays(date, 7),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 540,
      end: 720,
    },
  ];
  seed.records = [
    {
      id: 'r',
      materialId: 'm',
      round: 0,
      date: today(),
      count: 0,
      cancelled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  seed.plan = generatePlan(seed, date);
  seed.plan.sessions = [
    {
      id: 'unreported',
      examId: 'e',
      materialId: 'm',
      round: 0,
      date: addDays(today(), -1),
      start: 540,
      end: 550,
      count: 5,
      kind: 'study',
      fixed: false,
    },
    {
      id: 'conflict',
      examId: 'e',
      materialId: 'm',
      round: 0,
      date,
      start: 550,
      end: 560,
      count: 5,
      kind: 'study',
      fixed: true,
    },
    {
      id: 'keep',
      examId: 'e',
      materialId: 'm',
      round: 0,
      date: addDays(date, 1),
      start: 540,
      end: 550,
      count: 5,
      kind: 'study',
      fixed: true,
    },
  ];
  const candidate = structuredClone(seed.settings);
  candidate.buffer = 0.1;
  candidate.windows.push({
    id: 'c',
    name: '経済学',
    kind: 'class',
    from: date,
    to: date,
    weekdays: [weekday(date)],
    start: 540,
    end: 640,
  });
  seed = proposeSettings(seed, candidate, date);
  expect(seed.proposal!.plan.conflicts).toHaveLength(1);
  await seedState(seed, 'constraint-seed');
  await nav('再計画の確認');
  const updatePlan = page.getByRole('button', { name: 'この内容で更新', exact: true });
  await updatePlan.scrollIntoViewIfNeeded();
  await expect(updatePlan).toBeInViewport({ ratio: 1 });
  const errors = page.getByRole('region', { name: '計画エラーの修正' });
  await expect(errors).toContainText('経済学（09:00〜10:40）と重なっています');
  await expect(page.getByRole('button', { name: 'この内容で更新' })).toBeDisabled();
  const readiness = page.getByRole('region', { name: '承認前の確認' });
  await expect(readiness).toContainText('現在は更新できません');
  await expect(page.getByRole('heading', { name: '予定の競合' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '未報告の予定を確認してください' })).toBeVisible();
  await page.screenshot({ path: 'test-results/constraint-repair.png', fullPage: true });
  await errors.getByRole('button', { name: '条件を修正', exact: true }).click();
  const wizard = page.getByRole('region', { name: '対話式の再計画' });
  await expect(wizard.getByLabel('授業・予定は何時に始まりますか？')).toHaveValue('09:00');
  expect((await storedState()).settings).toEqual(seed.settings);
  await wizard.getByRole('button', { name: '下書きを残して閉じる' }).click();
  await errors.getByRole('button', { name: '固定を解除して案を更新' }).click();
  await saved();
  await expect(errors).toHaveCount(0);
  const updated = await storedState();
  expect(updated.settings).toEqual(seed.settings);
  expect(updated.records).toEqual(seed.records);
  expect(updated.plan!.sessions).toEqual(
    seed.plan!.sessions.map((s) => (s.id === 'conflict' ? { ...s, fixed: false } : s)),
  );
  expect(updated.proposal!.plan.settingsSnapshot!.buffer).toBe(0.1);
  expect(updated.proposal!.plan.sessions.find((s) => s.id === 'keep')).toEqual(
    seed.plan!.sessions.find((s) => s.id === 'keep'),
  );
  expect(updated.proposal!.plan.sessions.every((s) => !overlapsBusy(candidate, s).length)).toBe(
    true,
  );
  await expect(page.getByRole('button', { name: 'この内容で更新' })).toBeDisabled();
  await page
    .getByRole('heading', { name: '未報告の予定を確認してください' })
    .scrollIntoViewIfNeeded();
  await page.getByLabel('未報告は記録を保留したまま、現在の残数を今後の枠へ再配置する').check();
  await page.getByRole('button', { name: '承認操作へ戻る' }).click();
  await expect(page.getByRole('button', { name: 'この内容で更新' })).toBeFocused();
  await expect(readiness).toHaveCount(0);
  await page.getByRole('button', { name: 'この内容で更新' }).click();
  await saved();
  const approved = await storedState();
  expect(approved.settings).toEqual(candidate);
  expect(approved.records).toEqual(seed.records);
  expect(approved.plan!.sessions.find((s) => s.id === 'keep')).toEqual(
    seed.plan!.sessions.find((s) => s.id === 'keep'),
  );
});

test('実機：重複の表示 → 既存設定を対話で修正 → 破棄・承認 → 再起動', async () => {
  await close();
  browser = undefined!;
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/revision-'));
  await launch();
  const date = addDays(today(), (8 - weekday(today())) % 7 || 7);
  const seed = initialState();
  seed.settings.exams = [
    {
      id: 'exam',
      name: '行政書士試験',
      start: date,
      target: addDays(date, 14),
      priority: 2,
      color: '#287569',
      reviewDays: 0,
    },
  ];
  seed.settings.materials = [
    {
      id: 'book',
      name: '過去問題集',
      examId: 'exam',
      total: 37,
      order: 1,
      rounds: [{ completed: 0, minutes: 3 }],
    },
  ];
  seed.settings.windows = [
    {
      id: 'study',
      name: '平日の学習枠',
      kind: 'study',
      from: date,
      to: addDays(date, 45),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 540,
      end: 1080,
    },
  ];
  seed.records = [
    {
      id: 'record',
      materialId: 'book',
      round: 0,
      date: addDays(date, -1),
      count: 3,
      cancelled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  seed.plan = generatePlan(seed, date);
  seed.plan.sessions = [
    [640, 649, 3],
    [750, 798, 16],
    [808, 838, 10],
  ].map(([start, end, count], i) => ({
    id: `old${i}`,
    date,
    start,
    end,
    count,
    materialId: 'book',
    examId: 'exam',
    round: 0,
    fixed: false,
    kind: 'study',
  }));
  const fixed = {
    id: 'fixed',
    date: addDays(date, 1),
    start: 540,
    end: 543,
    count: 1,
    materialId: 'book',
    examId: 'exam',
    round: 0,
    fixed: true,
    kind: 'study' as const,
  };
  seed.plan.sessions.push(fixed);
  [540, 650, 790].forEach((start, i) =>
    seed.settings.windows.push({
      id: `class${i}`,
      name: `大学${i + 1}限`,
      kind: 'class',
      from: date,
      to: addDays(date, 45),
      weekdays: [1],
      start,
      end: start + 100,
    }),
  );
  await seedState(seed, 'revision-seed');
  await nav('学習カレンダー');
  await expect(page.getByText('授業・予定と重なる学習予定が3件あります')).toBeVisible();
  await page.getByRole('button', { name: `${date}を表示` }).click();
  const panel = page.locator('.day-panel');
  await expect(panel.getByText('学習予定と授業・予定が重複')).toHaveCount(3);
  await expect(panel.locator('.busy-event').first()).toContainText('開始 09:00 ／ 終了 10:40');
  const order = await panel
    .locator(':scope > .busy-event, :scope > .session-detail')
    .allTextContents();
  expect(order[0]).toContain('09:00');
  expect(order[1]).toContain('10:40');
  expect(order[2]).toContain('10:50');
  await page.screenshot({ path: 'test-results/calendar-conflict.png', fullPage: true });
  await page.getByRole('button', { name: '重なりを対話で見直す' }).click();
  await page.getByRole('button', { name: '対話で条件を見直す', exact: true }).click();
  const wizard = page.getByRole('region', { name: '対話式の再計画' });
  await wizard.getByRole('button', { name: '試験・目標日', exact: true }).click();
  await wizard.getByRole('button', { name: '行政書士試験', exact: true }).click();
  const next = () => wizard.getByRole('button', { name: '次へ', exact: true }).click();
  await expect(wizard.getByLabel('試験名はこのままですか？')).toHaveValue('行政書士試験');
  await next();
  await expect(wizard.getByLabel('目標日はいつですか？')).toHaveValue(addDays(date, 14));
  await wizard.getByLabel('目標日はいつですか？').fill(addDays(date, 21));
  await saved();
  await page.reload();
  await nav('再計画の確認');
  await page.getByRole('button', { name: '対話の続きから見直す' }).click();
  await expect(wizard.getByLabel('目標日はいつですか？')).toHaveValue(addDays(date, 21));
  expect((await storedState()).settings.exams[0].target).toBe(addDays(date, 14));
  await next();
  await next();
  await next();
  await next();
  await wizard.getByRole('button', { name: 'この項目の変更を終える' }).click();
  await wizard.getByRole('button', { name: '連続時間・休憩・余裕率', exact: true }).click();
  await expect(wizard.getByLabel('最長で何分続けて勉強できますか？')).toHaveValue('50');
  await wizard.getByLabel('最長で何分続けて勉強できますか？').fill('90');
  await wizard.getByLabel('最長で何分続けて勉強できますか？').press('Enter');
  await expect(wizard.getByLabel('学習ブロックの間に何分休みますか？')).toBeVisible();
  await next();
  await wizard.getByLabel('授業の前後に何分空けますか？').fill('10');
  await wizard.getByLabel('授業の前後に何分空けますか？').press('Enter');
  await next(); // buffer
  await expect(wizard.getByLabel('予定の下限は何分にしますか？')).toHaveValue('10');
  await next();
  await expect(wizard.getByLabel('なるべく何分のまとまりで学びますか？')).toHaveValue('30');
  await wizard.getByRole('button', { name: 'この項目の変更を終える' }).click();
  await wizard.getByRole('button', { name: '朝・昼・夜の食事時間', exact: true }).click();
  await wizard.getByLabel('朝食は何時からですか？').fill('08:00');
  await next();
  await next();
  await wizard.getByLabel('昼食は何時からですか？').fill('12:00');
  await next();
  await wizard.getByLabel('昼食は何分確保しますか？').fill('60');
  await next(); // One click also commits a dirty numeric value.
  await next();
  await wizard.getByRole('button', { name: 'この項目の変更を終える' }).click();
  await wizard.getByRole('button', { name: '変更内容を確認する' }).click();
  await saved();
  expect((await storedState()).settings).toEqual(seed.settings);
  await page.screenshot({ path: 'test-results/revision-dialogue.png', fullPage: true });
  await wizard.getByRole('button', { name: 'この条件で再計画案を作成' }).click();
  await saved();
  let stored = await storedState();
  expect(stored.settings).toEqual(seed.settings);
  expect(stored.records).toEqual(seed.records);
  expect(stored.plan).toEqual(seed.plan);
  expect(stored.proposal!.plan.conflicts).toEqual([]);
  await page.getByRole('button', { name: '案を破棄する', exact: true }).click();
  await saved();
  expect((await storedState()).settings).toEqual(seed.settings);
  await page.getByRole('button', { name: '対話の続きから見直す' }).click();
  await wizard.getByRole('button', { name: 'この条件で再計画案を作成' }).click();
  await page.getByRole('button', { name: 'この内容で更新' }).click();
  await saved();
  stored = await storedState();
  expect(stored.settings.block).toBe(90);
  expect(stored.settings.classTransition).toBe(10);
  expect(stored.settings.meals?.lunch).toEqual({ start: 720, duration: 60 });
  expect(stored.settings.exams[0].target).toBe(addDays(date, 21));
  expect(stored.settings.materials).toEqual(seed.settings.materials);
  expect(stored.settings.windows).toEqual(seed.settings.windows);
  expect(stored.records).toEqual(seed.records);
  expect(stored.plan!.sessions).toContainEqual(fixed);
  expect(stored.plan!.sessions.every((x) => !overlapsBusy(stored.settings, x).length)).toBe(true);
  await nav('学習カレンダー');
  await page.getByRole('button', { name: `${date}を表示` }).click();
  await expect(page.locator('.calendar-event.has-conflict')).toHaveCount(0);
  await expect(page.locator('.day-panel .busy-event')).toHaveCount(3);
  for (const view of ['月', '週', '一覧']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    await expect(
      page.locator('.calendar-busy, .busy-event').filter({ hasText: /朝食|昼食|夕食|移動・準備/ }),
    ).toHaveCount(0);
    const events = await page.locator('.calendar-busy, .busy-event').allTextContents();
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((text) => text.includes('授業'))).toBe(true);
  }
  await page.getByRole('button', { name: '月', exact: true }).click();
  await page.screenshot({ path: 'test-results/calendar-resolved.png', fullPage: true });
  await close();
  browser = undefined!;
  await launch();
  expect((await storedState()).settings.block).toBe(90);
  expect((await storedState()).records).toEqual(seed.records);
  await close();
  browser = undefined!;
});
test('実機：初期設定 → SQLite保存 → 計画 → 進捗 → 再計画 → 再起動', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/native-'));
  await launch();
  await page.getByRole('button', { name: '設定を始める' }).click();
  const next = async () => page.getByRole('button', { name: '次へ', exact: true }).click();
  await expect(page.getByRole('button', { name: '次へ', exact: true })).toBeDisabled();
  await expect(page.locator('.question-answer input')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/setup-question.png', fullPage: true });
  await page.getByLabel('試験名', { exact: true }).fill('基本情報技術者');
  await saved();
  await page.reload();
  await nav('対話式の初期設定');
  await expect(page.getByLabel('試験名', { exact: true })).toHaveValue('基本情報技術者');
  await next();
  await page.getByLabel('目標日', { exact: true }).fill(addDays(today(), 20));
  await page.getByRole('button', { name: '前の質問', exact: true }).click();
  await expect(page.getByLabel('試験名', { exact: true })).toHaveValue('基本情報技術者');
  await next();
  await next();
  await next();
  await next();
  await next();
  await page.getByRole('button', { name: '今回は設定しない' }).click();
  await page.getByRole('button', { name: '別の試験も追加する' }).click();
  await saved();
  await page.getByLabel('試験名', { exact: true }).fill('簿記検定');
  await next();
  await page.getByLabel('目標日', { exact: true }).fill(addDays(today(), 25));
  await next();
  await next();
  await next();
  await expect(page.getByRole('button', { name: /^表示色 #/ })).toHaveCount(16);
  await page.getByRole('button', { name: '表示色 #8f6ab9' }).click();
  await next();
  await page.getByRole('button', { name: '今回は設定しない' }).click();
  await page.getByRole('button', { name: '保存して、勉強できる時間へ' }).click();
  await saved();
  await next();
  await page.getByRole('button', { name: '日', exact: true }).click();
  await page.getByRole('button', { name: '土', exact: true }).click();
  await next();
  await next();
  await page.getByRole('button', { name: '保存して次へ', exact: true }).click();
  await page.getByRole('button', { name: '時間割を登録する' }).click();
  await next();
  await next();
  await page.getByRole('button', { name: '月曜1限' }).click();
  await expect(page.getByRole('button', { name: '月曜1限' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: '月曜1限' })).toContainText('学習不可');
  await expect(page.getByRole('region', { name: '授業を除いた学習枠の確認' })).toContainText(
    '選択したコマは「授業・学習不可」です',
  );
  await next();
  await expect(
    page.getByRole('region', { name: 'あとで設定する場合の影響' }).getByText(
      '未登録のアルバイトやサークルなどの時間は学習可能枠から除かれません。毎週の予定と学習が重なる可能性があります。',
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: '定期予定はない', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'あとで設定する場合の影響' }).getByText(
      '未登録の旅行や外出などは計画に反映されません。勉強できない日や時間帯にも学習が入る可能性があります。',
      { exact: true },
    ),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/setup-skip-impact.png', fullPage: true });
  await page.getByRole('button', { name: 'あとで設定する', exact: true }).click();
  await saved();
  await page.reload();
  await nav('対話式の初期設定');
  const meals = page.getByRole('region', { name: '食事時間の質問' });
  await meals.getByLabel('朝食の開始時刻').fill('');
  await meals.getByLabel('朝食の開始時刻').press('Enter');
  await expect(meals.getByRole('alert')).toContainText('開始時刻');
  await meals.getByLabel('朝食の開始時刻').fill('08:00');
  await meals.getByLabel('朝食の開始時刻').press('Enter');
  await meals.getByLabel('朝食の長さ（分）').fill('30');
  await meals.getByLabel('朝食の長さ（分）').press('Enter');
  await expect(meals.getByLabel('昼食の開始時刻')).toBeVisible();
  await next();
  await meals.getByLabel('昼食の長さ（分）').fill('60');
  await next();
  await next();
  await meals.getByLabel('夕食の長さ（分）').fill('45');
  await meals.getByLabel('夕食の長さ（分）').press('Enter');
  await saved();
  expect((await storedState()).settings.meals).toEqual({
    breakfast: { start: 480, duration: 30 },
    lunch: { start: 720, duration: 60 },
    dinner: { start: 1140, duration: 45 },
  });
  await page
    .getByRole('region', { name: '睡眠の質問' })
    .getByRole('button', { name: 'あとで', exact: true })
    .click();
  await page
    .getByRole('region', { name: '風呂の質問' })
    .getByRole('button', { name: 'あとで', exact: true })
    .click();
  const focusInput = page.getByLabel('連続で勉強できる最長時間（分）');
  await focusInput.fill('');
  await expect(focusInput).toHaveValue('');
  await expect(focusInput).not.toHaveAttribute('aria-invalid', 'true');
  await saved();
  expect((await storedState()).settings.block).toBe(50);
  await next();
  await expect(focusInput).toBeVisible();
  await page.reload();
  await nav('対話式の初期設定');
  await expect(focusInput).toHaveValue('');
  await focusInput.press('Enter');
  await expect(page.getByRole('alert')).toContainText('空欄');
  await focusInput.fill('1.5');
  await focusInput.press('Enter');
  await expect(page.getByRole('alert')).toContainText('整数');
  await focusInput.fill('120');
  // IME conversion Enter must not submit the question.
  await focusInput.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    isComposing: true,
    keyCode: 229,
  });
  await expect(focusInput).toBeVisible();
  await focusInput.press('Enter');
  await expect(page.getByLabel('ブロック間の休憩（分）')).toBeVisible();
  await next();
  await page.getByRole('button', { name: '基本情報技術者', exact: true }).click();
  await next();
  await page.getByLabel('教材名', { exact: true }).fill('基本情報 午後問題集');
  await next();
  await page.getByLabel('総問題数', { exact: true }).fill('37');
  await page.getByLabel('総問題数', { exact: true }).press('Enter');
  await next();
  await next();
  await next();
  await next();
  await page.getByRole('button', { name: '別の教材も追加する' }).click();
  await saved();
  await page.getByRole('button', { name: '簿記検定', exact: true }).click();
  await next();
  await page.getByLabel('教材名', { exact: true }).fill('簿記トレーニング');
  await next();
  await page.getByLabel('総問題数', { exact: true }).fill('53');
  await page.getByLabel('総問題数', { exact: true }).press('Enter');
  await next();
  await next();
  await next();
  await next();
  await page.getByRole('button', { name: '保存して、最後の質問へ' }).click();
  await saved();
  await expect(page.getByRole('button', { name: /20%.*初期値/ })).toHaveClass(/selected/);
  await next();
  await page.screenshot({ path: 'test-results/setup-finish.png', fullPage: true });
  await expect(
    page.getByRole('region', { name: '勉強できない特定の日・時間：あとで設定', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: '授業以外の定期予定：あとで設定', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '計画案を作成する' }).click();
  await expect(page.getByRole('heading', { name: '計画案', exact: true })).toBeVisible();
  await page.locator('details.replan-details > summary').click();
  await expect(
    page.getByRole('heading', { name: 'バッファーなし（余裕率0%）なら、いつ終わる？' }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: '計画の条件と一日の問題数' })).toContainText(
    '使用した設定の最終更新',
  );
  const previewState = await storedState();
  expect(previewState.proposal!.plan.settingsSnapshot).toEqual(previewState.settings);
  expect(previewState.proposal!.plan.settingsUpdatedAt).toBeTruthy();
  await expect(
    page.getByRole('region', { name: '勉強できない特定の日・時間：あとで設定', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'この内容で更新' }).click();
  await saved();
  await nav('学習カレンダー');
  const beforeView = await page.evaluate(async () => {
    return await (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (name: string) => Promise<{ data: { plan: { id: string } } }>;
        };
      }
    ).__TAURI_INTERNALS__.invoke('load_state');
  });
  await page.getByRole('button', { name: '週', exact: true }).click();
  await expect(page.locator('.calendar-grid.week')).toBeVisible();
  await page.getByRole('button', { name: '一覧', exact: true }).click();
  await page.locator('.calendar-list details.calendar-individual > summary').first().click();
  await expect(page.locator('.session-detail').first()).toBeVisible();
  await page.getByRole('button', { name: '月', exact: true }).click();
  const afterView = await page.evaluate(async () => {
    return await (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (name: string) => Promise<{ data: { plan: { id: string } } }>;
        };
      }
    ).__TAURI_INTERNALS__.invoke('load_state');
  });
  expect(afterView.data.plan.id).toBe(beforeView.data.plan.id);
  await expect(page.locator('.calendar-event').first()).toBeVisible();
  await page.getByLabel('表示する試験').selectOption({ label: '基本情報技術者' });
  await expect(page.locator('.calendar-event').filter({ hasText: '簿記トレーニング' })).toHaveCount(
    0,
  );
  await page.getByLabel('表示する試験').selectOption({ label: 'すべての試験' });
  // Late in the day, the first available session may be tomorrow rather than the selected today.
  await page.locator('.calendar-event').first().click();
  await expect(page.getByRole('button', { name: '固定する', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/calendar.png', fullPage: true });
  await nav('進捗を記録');
  await page.getByRole('button', { name: 'その他', exact: true }).click();
  for (const invalid of ['', '-1', '1.5', '38']) {
    await page.getByLabel('追加問題数（1問単位）').fill(invalid);
    await expect(page.getByRole('button', { name: '記録する', exact: true })).toBeDisabled();
  }
  await page.getByLabel('追加問題数（1問単位）').fill('3');
  await page.getByRole('button', { name: '記録する', exact: true }).dblclick();
  await saved();
  await expect(page.getByText('＋3問を記録しました。', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /^0\s*問$/ }).click();
  await page.getByRole('button', { name: '記録する', exact: true }).click();
  await saved();
  await expect(page.locator('.progress-summary')).toContainText('完了 3問');
  await page.screenshot({ path: 'test-results/progress.png', fullPage: true });
  await nav('記録履歴');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.locator('tbody')).toContainText('＋0問');
  const row = page.locator('tbody tr').filter({ hasText: '＋3問' });
  await row.getByRole('button', { name: '訂正', exact: true }).click();
  await page.getByLabel('訂正後の問題数').fill('7');
  await page.getByLabel('訂正後の問題数').press('Enter');
  await page.getByRole('button', { name: '訂正を保存' }).click();
  await saved();
  await expect(page.locator('tbody')).toContainText('＋7問');
  const adjusted = await storedState();
  expect(adjusted.records.find((record) => record.count === 7)?.cancelled).toBe(false);
  expect(adjusted.plan?.id).not.toBe(beforeView.data.plan.id);
  await nav('再計画の確認');
  await page.getByRole('button', { name: '設定を変えずに再計画' }).click();
  const beforeApproval = await storedState();
  const approveButton = page.getByRole('button', { name: 'この内容で更新' });
  // A session can start during this real-time flow. Its missing report needs explicit acknowledgement.
  if (beforeApproval.proposal!.unreported.length) {
    await expect(approveButton).toBeDisabled();
    await page.getByLabel('未報告は記録を保留したまま、現在の残数を今後の枠へ再配置する').check();
  }
  await expect(approveButton).toBeEnabled();
  await approveButton.click();
  await saved();
  expect((await storedState()).records).toEqual(beforeApproval.records);
  await page.getByRole('button', { name: '前の計画へ戻す' }).click();
  await page.getByRole('button', { name: '計画を戻す', exact: true }).click();
  await saved();
  await nav('教材・進捗');
  await expect(page.getByText('1周目：完了 7問 · 残り 30問 · 1問 2分')).toBeVisible();
  await close();
  browser = undefined!;
  await launch();
  await nav('設定');
  await page.locator('details.settings-extra > summary').click();
  await expect(page.locator('.settings-extra')).toContainText('勉強できない特定の日・時間');
  await expect(page.locator('.settings-extra')).toContainText('あとで設定');
  await nav('記録履歴');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.locator('tbody')).toContainText('＋7問');
  const corrected = page.locator('tbody tr').filter({ hasText: '＋7問' });
  await corrected.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '取消を確定' }).click();
  await saved();
  await nav('進捗を記録');
  await expect(page.locator('.progress-summary')).toContainText('残り 37問');
  await page.getByRole('button', { name: '残りすべて：37問' }).click();
  await page.getByRole('button', { name: '記録する', exact: true }).click();
  await saved();
  await expect(page.getByRole('button', { name: /^5\s*問$/ })).toBeDisabled();
  await expect(page.locator('.progress-summary')).toContainText('残り 0問');
  await nav('今日のスケジュール');
  await expect(page.getByRole('region', { name: '1日の可処分時間' })).toBeVisible();
  await page.screenshot({ path: 'test-results/dashboard.png', fullPage: true });
  await nav('時間枠・時間割');
  const deferred = page
    .locator('.schedule-review')
    .filter({ hasText: '勉強できない特定の日・時間' });
  await expect(deferred.locator('.badge')).toHaveText('あとで設定');
  await deferred.getByRole('button', { name: '予定がないことを確認', exact: true }).click();
  await saved();
  await page.reload();
  await nav('時間枠・時間割');
  await expect(
    page
      .locator('.schedule-review')
      .filter({ hasText: '勉強できない特定の日・時間' })
      .locator('.badge'),
  ).toHaveText('予定なし');
  await nav('設定');
  await expect(
    page.getByRole('region', { name: '勉強できない特定の日・時間：あとで設定', exact: true }),
  ).toHaveCount(0);
  await nav('時間枠・時間割');
  await page.getByLabel('勉強できる開始時刻', { exact: true }).fill('09:00');
  await page.getByLabel('勉強できる終了時刻', { exact: true }).fill('13:00');
  await page.getByRole('button', { name: '時間枠を追加する', exact: true }).click();
  await saved();
  const monday = addDays(today(), (8 - weekday(today())) % 7);
  await page.getByLabel('学習枠を確認する日').fill(monday);
  const timetable = page.getByRole('region', { name: '授業を除いた学習枠の確認' });
  await expect(timetable.locator('.busy-time')).toContainText('09:00–10:40 授業');
  await expect(timetable.locator('.free-time')).toContainText(
    '10:40–12:00 / 18:00–19:00 / 19:45–21:00',
  );
  await expect(timetable.locator('.free-time')).toContainText('3時間 35分');
  await page.screenshot({ path: 'test-results/timetable-exclusion.png', fullPage: true });
  await nav('ホーム');
  await expect(page.getByText('保存済みの計画と現在の設定が一致していません。')).toBeVisible();
  const beforeTheme = await storedState();
  const accents = new Set<string>();
  const actionColors = new Set<string>();
  for (const theme of ['mint', 'sky', 'lime']) {
    await nav('設定');
    await displaySettings(undefined, theme);
    await saved();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const palette = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        accent: root.getPropertyValue('--accent').trim(),
        muted: root.getPropertyValue('--muted').trim(),
      };
    });
    expect(palette.accent).toMatch(/^#[0-9a-f]{6}$/i);
    accents.add(palette.accent);
    await page.screenshot({ path: `test-results/theme-${theme}.png`, fullPage: true });
    await nav('ホーム');
    // The daily row replaces the former progress chart; retain the value and theme checks.
    const dailyRow = page.getByRole('listitem').filter({ hasText: '基本情報 午後問題集' });
    await expect(dailyRow).toContainText('37/0問');
    actionColors.add(await dailyRow.getByRole('button', { name: '記録', exact: true })
      .evaluate((button) => getComputedStyle(button).backgroundColor));
    await page.screenshot({ path: `test-results/progress-${theme}.png`, fullPage: true });
  }
  expect(accents.size).toBe(3);
  expect(actionColors.size).toBe(3);
  expect((await storedState()).settingsUpdatedAt).toBe(beforeTheme.settingsUpdatedAt);
  await close();
  browser = undefined!;
  await launch();
  await nav('設定');
  await expect(page.getByLabel('カラーテーマ')).toHaveValue('lime');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'lime');
});

test('実機：授業名・初期設定の再編集・今日の予定・初期化と復元', async () => {
  await close();
  browser = undefined!;
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/setup-edit-'));
  await launch();
  const date = today();
  const seed = initialState();
  seed.settings.exams = [
    {
      id: 'e',
      name: '資格試験',
      start: date,
      target: addDays(date, 14),
      priority: 2,
      color: '#4c89ac',
      reviewDays: 0,
    },
  ];
  seed.settings.materials = [
    {
      id: 'm',
      examId: 'e',
      name: 'まとめ問題集',
      total: 70,
      order: 1,
      rounds: [{ completed: 0, minutes: 2 }],
    },
  ];
  seed.settings.windows = [
    {
      id: 'w',
      name: '勉強枠',
      kind: 'study',
      from: date,
      to: addDays(date, 30),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 540,
      end: 1260,
    },
    {
      id: 'c',
      name: '',
      kind: 'class',
      from: date,
      to: addDays(date, 30),
      weekdays: [weekday(date)],
      start: 660,
      end: 760,
    },
  ];
  seed.records = [
    {
      id: 'r',
      date,
      materialId: 'm',
      round: 0,
      count: 3,
      cancelled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  // This report was entered after the approved day's schedule was created.
  seed.plan = generatePlan({ ...seed, records: [] }, date);
  seed.plan.sessions[0].fixed = true;
  await seedState(seed, 'edit-seed');
  await nav('対話式の初期設定');
  await page.getByRole('button', { name: '設定項目を選んで修正する' }).click();
  await expect(page.getByRole('region', { name: '初期設定の項目選択' })).toContainText(
    '教材：まとめ問題集',
  );
  await page
    .getByRole('button', { name: `大学の授業：${date}〜${addDays(date, 30)}`, exact: true })
    .click();
  await expect(page.getByLabel('時間割の適用開始', { exact: true })).toHaveValue(date);
  await page.getByLabel('時間割の適用終了', { exact: true }).fill(addDays(date, 45));
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  const className = page.getByLabel(/11:00〜12:40の授業名（任意）/);
  await expect(className).toHaveValue('');
  await className.fill('経済学');
  await saved();
  const named = await storedState();
  expect(named.settings.windows.find((x) => x.id === 'c')!.name).toBe('経済学');
  expect(named.settings.windows.find((x) => x.id === 'c')!.to).toBe(addDays(date, 45));
  expect(named.settings.windows.filter((x) => x.kind === 'class')).toHaveLength(1);
  expect(named.plan).toEqual(seed.plan);
  expect(named.records).toEqual(seed.records);
  await nav('今日のスケジュール');
  const todayPanel = page.getByRole('region', { name: '今日の予定一覧' });
  await expect(todayPanel).toContainText('経済学');
  await expect(todayPanel).toContainText('まとめ問題集');
  await expect(todayPanel).toContainText('＋3問');
  await expect(page.locator('.calendar-toolbar')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/today-schedule.png', fullPage: true });
  await todayPanel.getByRole('button', { name: '進捗を記録', exact: true }).first().click();
  const recordRow = page.locator('.daily-record-row').filter({ hasText: 'まとめ問題集' });
  await expect(recordRow.getByRole('textbox')).toHaveValue('12');
  await expect(recordRow.getByRole('textbox')).toBeFocused();
  await nav('学習カレンダー');
  await expect(page.locator('.calendar-busy').first()).toContainText('授業');
  await nav('対話式の初期設定');
  await page.getByRole('button', { name: '設定項目を選んで修正する' }).click();
  await page.getByRole('button', { name: '連続時間・休憩を修正する' }).click();
  await expect(page.getByLabel('連続で勉強できる最長時間（分）')).toHaveValue('50');
  await page.getByLabel('連続で勉強できる最長時間（分）').fill('90');
  await page.getByLabel('連続で勉強できる最長時間（分）').press('Enter');
  await saved();
  expect((await storedState()).settings.block).toBe(90);
  expect((await storedState()).plan).toEqual(seed.plan);
  await page.getByRole('button', { name: '設定項目を選んで修正する' }).click();
  await page.getByRole('button', { name: '試験・目標：資格試験', exact: true }).click();
  await expect(page.getByLabel('試験名', { exact: true })).toHaveValue('資格試験');
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.getByLabel('目標日', { exact: true }).fill(addDays(date, 21));
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.getByRole('button', { name: '今回は設定しない' }).click();
  await page.getByRole('button', { name: '保存して修正を終了' }).click();
  await saved();
  expect((await storedState()).settings.exams[0].target).toBe(addDays(date, 21));
  expect((await storedState()).settings.exams).toHaveLength(1);
  await page.locator('summary').filter({ hasText: '初期設定を初期化する' }).click();
  const beforeCancel = await storedState();
  await page.getByRole('button', { name: '設定・計画・記録を初期化する', exact: true }).click();
  let confirm = page.getByRole('region', { name: '初期化の確認' });
  await expect(confirm).toContainText('記録1件');
  await expect(confirm.getByRole('button', { name: '初期化を確定する' })).toBeDisabled();
  await confirm.getByRole('button', { name: 'やめる' }).click();
  expect(await storedState()).toEqual(beforeCancel);
  await page.getByRole('button', { name: '質問の進行だけ最初に戻す' }).click();
  await confirm.getByLabel('変更される範囲を確認しました').check();
  await confirm.getByRole('button', { name: '初期化を確定する' }).click();
  await saved();
  let data = await storedState();
  expect(data.settings).toEqual(beforeCancel.settings);
  expect(data.records).toEqual(seed.records);
  expect(data.plan).toEqual(seed.plan);
  expect(data.draft.guided).toBeUndefined();
  const beforeReset = structuredClone(data);
  await page.getByRole('button', { name: '設定・計画・記録を初期化する', exact: true }).click();
  await confirm.getByLabel('変更される範囲を確認しました').check();
  await page.screenshot({ path: 'test-results/reset-warning.png', fullPage: true });
  await confirm.getByRole('button', { name: '初期化を確定する' }).click();
  await saved();
  data = await storedState();
  expect(data.settings.exams).toEqual([]);
  expect(data.records).toEqual([]);
  expect(data.plan).toBeNull();
  await close();
  browser = undefined!;
  await launch();
  await nav('対話式の初期設定');
  await page.locator('summary').filter({ hasText: '初期設定を初期化する' }).click();
  await page.getByRole('button', { name: '初期化前のデータを復元する' }).click();
  confirm = page.getByRole('region', { name: '初期化の確認' });
  await confirm.getByLabel('変更される範囲を確認しました').check();
  await confirm.getByRole('button', { name: '復元を確定する' }).click();
  await saved();
  data = await storedState();
  expect(data).toEqual(beforeReset);
  await nav('今日のスケジュール');
  await expect(page.getByRole('region', { name: '今日の予定一覧' })).toContainText('経済学');
});

test('実機：選択日と週内訳・月移動・授業だけの日・予定のない実績を表示', async () => {
  await close();
  browser = undefined!;
  dataDir = mkdtempSync(resolve('.test-data/calendar-'));
  await launch();
  const month = today().slice(0, 7);
  const date = `${month}-01`;
  const nextMonth = new Date(`${date}T12:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const nextDate = nextMonth.toISOString().slice(0, 10);
  const seed = initialState();
  seed.settings.exams = ['a', 'b'].map((id) => ({
    id,
    name: `試験${id}`,
    start: date,
    target: addDays(nextDate, 20),
    priority: 1,
    color: '#316d9c',
    reviewDays: 0,
  }));
  seed.settings.materials = ['a', 'b'].map((id) => ({
    id,
    examId: id,
    name: `教材${id}`,
    total: 30,
    order: 1,
    rounds: [{ completed: 0, minutes: 2 }],
  }));
  seed.settings.windows = [
    {
      id: 'class',
      name: '経済学',
      from: nextDate,
      to: addDays(nextDate, 20),
      weekdays: [1, 2, 3, 4, 5],
      start: 540,
      end: 640,
      kind: 'class',
    },
  ];
  seed.records = [
    {
      id: 'r1',
      date,
      materialId: 'a',
      round: 0,
      count: 0,
      cancelled: false,
      createdAt: date,
      updatedAt: date,
    },
    {
      id: 'r2',
      date: addDays(date, 1),
      materialId: 'b',
      round: 0,
      count: 7,
      cancelled: false,
      createdAt: date,
      updatedAt: date,
    },
    {
      id: 'r3',
      date: addDays(date, 2),
      materialId: 'a',
      round: 0,
      count: 3,
      cancelled: true,
      createdAt: date,
      updatedAt: date,
    },
  ];
  seed.plan = generatePlan(seed, date);
  seed.plan.sessions = [
    {
      id: 'future',
      date: addDays(today(), 1),
      start: 600,
      end: 610,
      examId: 'a',
      materialId: 'a',
      round: 0,
      count: 5,
      fixed: false,
      kind: 'study',
    },
  ];
  seed.draft.progress = {
    date: seed.settings.exams[0].start,
    materialId: 'a',
    round: 0,
    choice: 'other',
    custom: '',
  };
  seed.draft.numberEdits = { 'progress///追加問題数（1問単位）': { text: '7', base: '' } };
  await seedState(seed, 'calendar-seed');
  await nav('学習カレンダー');
  const selected = `${month}-27`;
  await page.getByRole('button', { name: `${selected}を表示`, exact: true }).click();
  await expect(page.getByRole('complementary', { name: '選択した日の学習詳細' })).toBeVisible();
  await page.getByRole('button', { name: '週', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `${selected}を表示`, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '次の期間', exact: true }).click();
  const nextSelected = addDays(selected, 7);
  await expect(
    page.getByRole('button', { name: `${nextSelected}を表示`, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('complementary', { name: '選択した日の学習詳細' })).toBeVisible();
  await page.getByRole('button', { name: '一覧', exact: true }).click();
  await expect(page.locator('.busy-event').first()).toContainText('経済学');
  await expect(
    page.getByText('この期間に勉強・大学の予定と学習実績はありません。', { exact: true }),
  ).toHaveCount(0);
  await page.locator('.calendar-toolbar').getByRole('button', { name: '今日', exact: true }).click();
  await expect(page.getByText('教材a · 1周目：＋0問', { exact: true })).toBeVisible();
  await expect(page.getByText('教材b · 1周目：＋7問', { exact: true })).toBeVisible();
  await expect(page.getByText('教材a · 1周目：＋3問', { exact: true })).toHaveCount(0);
  await page.getByLabel('表示する試験').selectOption('a');
  await expect(page.getByText('教材b · 1周目：＋7問', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: `${date}の時間の内訳を表示`, exact: true }).click();
  await expect(page.getByRole('button', { name: `${date}の時間の内訳を表示`, exact: true })).toHaveAttribute('aria-pressed', 'true');
  const futureSection = page.locator('.calendar-list > section').filter({
    has: page.getByRole('button', { name: `${addDays(today(), 1)}の時間の内訳を表示`, exact: true }),
  });
  const futureDetails = futureSection.locator('.calendar-individual');
  if (!(await futureDetails.getAttribute('open'))) await futureDetails.locator('summary').click();
  await expect(futureDetails.locator('.session-detail')).toContainText('5問');
  await expect(futureDetails.getByRole('button', { name: '固定する', exact: true })).toHaveCount(0);
  await expect(futureDetails.getByRole('button', { name: '進捗を記録', exact: true })).toHaveCount(0);
  expect((await storedState()).plan).toEqual(seed.plan);
  await page.screenshot({ path: 'test-results/calendar-consistency.png', fullPage: true });
  await nav('進捗を記録');
  await expect(page.getByLabel('追加問題数（1問単位）')).toHaveValue('7');
  await page.getByRole('button', { name: '記録する', exact: true }).click();
  await saved();
  await expect(page.locator('.progress-summary')).toContainText('完了 7問');
  await page.getByRole('button', { name: 'その他', exact: true }).click();
  await expect(page.getByLabel('追加問題数（1問単位）')).toHaveValue('');
  await page.getByLabel('追加問題数（1問単位）').fill('3');
  await page.getByLabel('追加問題数（1問単位）').press('Enter');
  await saved();
  await expect(page.locator('.progress-summary')).toContainText('完了 10問');
});

test('実機：保存中の終了を待機し、失敗したら終了せず、保存成功後の再起動でも入力が残る', async () => {
  await close();
  browser = undefined!;
  dataDir = mkdtempSync(resolve('.test-data/close-save-'));
  await launch();
  await nav('対話式の初期設定');
  await page.getByLabel('試験名', { exact: true }).fill('保存前の目標');
  await saved();
  const before = await storedState();
  async function holdSave(fail: boolean) {
    await page.evaluate((shouldFail) => {
      const w = window as unknown as {
        releaseTestSave: () => void;
      };
      const nativeFetch = window.fetch.bind(window);
      let first = true;
      window.fetch = async (input, options) => {
        if (String(input).includes('ipc.localhost/commit_state') && first) {
          first = false;
          await new Promise<void>((resolve) => {
            w.releaseTestSave = resolve;
          });
          if (shouldFail)
            return new Response(JSON.stringify('テスト用の保存失敗'), {
              headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'error' },
            });
        }
        return nativeFetch(input, options);
      };
    }, fail);
  }
  async function requestClose() {
    await page.evaluate(async () => {
      await (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' });
    });
  }
  async function releaseSave() {
    await page.evaluate(() =>
      (window as unknown as { releaseTestSave: () => void }).releaseTestSave(),
    );
  }
  await holdSave(true);
  await page.getByLabel('試験名', { exact: true }).fill('保存が失敗する目標');
  await expect(page.locator('.save-status')).toContainText('保存中');
  await requestClose();
  await expect(page.getByRole('dialog', { name: '保存して終了' })).toBeVisible();
  await requestClose(); // repeated close must not bypass the pending save
  expect(child.exitCode).toBeNull();
  await releaseSave();
  await expect(page.getByRole('alert')).toContainText('保存に失敗したため終了を中止しました');
  await expect(page.getByRole('dialog', { name: '保存して終了' })).toHaveCount(0);
  await expect(page.getByLabel('試験名', { exact: true })).toHaveValue('保存前の目標');
  expect(await storedState()).toEqual(before);
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await holdSave(false);
  await page.getByLabel('試験名', { exact: true }).fill('終了直前に入力した目標');
  await requestClose();
  await expect(page.getByRole('dialog', { name: '保存して終了' })).toBeVisible();
  await page.screenshot({ path: 'test-results/close-save.png' });
  await releaseSave();
  await expect.poll(() => child.exitCode, { timeout: 15000 }).not.toBeNull();
  await close();
  browser = undefined!;
  await launch();
  await nav('対話式の初期設定');
  await expect(page.getByLabel('試験名', { exact: true })).toHaveValue('終了直前に入力した目標');
});

test('実機：保存と再読込の両方が失敗しても保存済みとせず、確認・再開・終了を選べる', async () => {
  await close();
  browser = undefined!;
  dataDir = mkdtempSync(resolve('.test-data/save-recovery-'));
  await launch();
  await nav('対話式の初期設定');
  await page.getByLabel('試験名', { exact: true }).fill('確認済みの目標');
  await saved();
  const before = await storedState();
  async function failSaveAndRead(committed: boolean) {
    await page.evaluate((committed) => {
      const w = window as unknown as { testFailRead: boolean };
      const nativeFetch = window.fetch.bind(window);
      w.testFailRead = true;
      let first = true;
      window.fetch = async (input, options) => {
        const url = String(input);
        const failure = () =>
          new Response(JSON.stringify('テスト用の保存先エラー'), {
            headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'error' },
          });
        if (url.includes('ipc.localhost/commit_state') && first) {
          first = false;
          if (committed) await nativeFetch(input, options);
          return failure();
        }
        if (url.includes('ipc.localhost/load_state') && w.testFailRead) return failure();
        return nativeFetch(input, options);
      };
    }, committed);
  }
  const recovery = page.getByRole('dialog', { name: '保存状態の確認' });
  const retry = () => recovery.getByRole('button', { name: '保存済みの内容を読み直す' }).click();
  const enableRead = () =>
    page.evaluate(() => {
      (window as unknown as { testFailRead: boolean }).testFailRead = false;
    });
  const requestClose = () =>
    page.evaluate(() =>
      (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke: (name: string, args: unknown) => Promise<void> };
        }
      ).__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' }),
    );
  await failSaveAndRead(false);
  await page.getByLabel('試験名', { exact: true }).fill('まだ保存されていない目標');
  await expect(recovery).toBeVisible();
  await expect(page.locator('.save-status')).toContainText('保存未確認');
  await expect(page.locator('.app-shell')).toHaveAttribute('inert', '');
  await requestClose();
  expect(child.exitCode).toBeNull();
  await retry();
  await expect(recovery).toContainText('テスト用の保存先エラー');
  await page.screenshot({ path: 'test-results/save-recovery.png' });
  await enableRead();
  await retry();
  await expect(recovery).toHaveCount(0);
  await expect(page.getByLabel('試験名', { exact: true })).toHaveValue('確認済みの目標');
  expect(await storedState()).toEqual(before);

  // A lost reply is not proof that the commit failed: recover what SQLite actually contains.
  await failSaveAndRead(true);
  await page.getByLabel('試験名', { exact: true }).fill('応答だけ失われた目標');
  await expect(recovery).toBeVisible();
  await recovery.getByRole('button', { name: '保存を確認せずに終了' }).click();
  await recovery.getByRole('button', { name: '戻る', exact: true }).click();
  expect(child.exitCode).toBeNull();
  await enableRead();
  await retry();
  await expect(recovery).toHaveCount(0);
  await expect(page.getByLabel('試験名', { exact: true })).toHaveValue('応答だけ失われた目標');
  const committed = await storedState();
  await failSaveAndRead(false);
  await page.getByLabel('試験名', { exact: true }).fill('終了時に破棄する入力');
  await expect(recovery).toBeVisible();
  await recovery.getByRole('button', { name: '保存を確認せずに終了' }).click();
  await expect(recovery).toContainText('保存できていない変更は失われます');
  await recovery.getByRole('button', { name: '終了する', exact: true }).click();
  await expect.poll(() => child.exitCode, { timeout: 15000 }).not.toBeNull();
  await close();
  browser = undefined!;
  await launch();
  await nav('対話式の初期設定');
  await expect(page.getByLabel('試験名', { exact: true })).toHaveValue('応答だけ失われた目標');
  expect(await storedState()).toEqual(committed);
});

test('実機：バックアップ保存・破損拒否・内容確認・復元・再起動後の復元取消', async () => {
  await close();
  browser = undefined!;
  dataDir = mkdtempSync(resolve('.test-data/backup-'));
  await launch();
  const date = today();
  const seed = initialState();
  seed.settings.exams = [
    {
      id: 'e',
      name: '復元テスト試験',
      start: date,
      target: addDays(date, 20),
      priority: 2,
      color: '#316d9c',
      reviewDays: 2,
    },
  ];
  seed.settings.materials = [
    {
      id: 'm',
      examId: 'e',
      name: '学習の記録',
      total: 37,
      order: 1,
      rounds: [
        { completed: 2, minutes: 3 },
        { completed: 0, minutes: 2 },
      ],
    },
  ];
  seed.settings.windows = [
    {
      id: 'w',
      name: '学習枠',
      kind: 'study',
      from: date,
      to: addDays(date, 30),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 540,
      end: 1260,
    },
  ];
  seed.settings.meals = {
    breakfast: { start: 480, duration: 30 },
    lunch: { start: 720, duration: 45 },
    dinner: { start: 1140, duration: 60 },
  };
  seed.records = [0, 3].map((count, i) => ({
    id: `r${i}`,
    materialId: 'm',
    round: 0,
    date,
    count,
    cancelled: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  seed.plan = generatePlan(seed, date);
  seed.plan.sessions[0].fixed = true;
  seed.history = [structuredClone(seed.plan)];
  seed.proposal = {
    plan: generatePlan(seed, date, true),
    basedOn: seed.plan.id,
    reason: '確認前の計画',
    unreported: [],
  };
  seed.draft.progress = { date, materialId: 'm', round: 0, choice: 'other', custom: '' };
  seed.draft.numberEdits = { 'setup/test': { base: '50', text: '' } };
  seed.resetBackup = initialState();
  seed.theme = 'sky';
  seed.appearance = 'dark';
  await seedState(seed, 'backup-seed');
  await nav('バックアップ');
  const path = resolve(dataDir, '試験.studyplan.json');
  async function chooseSavePath(result: string | null) {
    await page.evaluate((path) => {
      const nativeFetch = window.fetch.bind(window);
      let once = true;
      window.fetch = (input, options) => {
        if (once && decodeURIComponent(String(input)).includes('plugin:dialog|save')) {
          once = false;
          return Promise.resolve(
            new Response(JSON.stringify(path), {
              headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' },
            }),
          );
        }
        return nativeFetch(input, options);
      };
    }, result);
  }
  await chooseSavePath(null);
  await page.getByRole('button', { name: 'バックアップを保存する', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'バックアップを保存する', exact: true }),
  ).toBeEnabled();
  const seeded = await storedState();
  const seededContent = { ...seeded };
  delete seededContent.windowSize;
  expect(seededContent).toEqual(JSON.parse(JSON.stringify(seed)));
  await chooseSavePath(path);
  await page.getByRole('button', { name: 'バックアップを保存する', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '保存しました：' })).toBeVisible();
  const { readFileSync } = await import('node:fs');
  const packet = JSON.parse(readFileSync(path, 'utf8'));
  expect(packet.data).toEqual(seeded);
  await nav('設定');
  await displaySettings(undefined, 'lime');
  await displaySettings('light');
  await saved();
  const beforeRestore = await storedState();
  await nav('バックアップ');
  await page
    .getByLabel('復元するバックアップ')
    .setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{') });
  await expect(page.getByRole('alert')).toContainText('ファイルを読み取れません');
  expect(await storedState()).toEqual(beforeRestore);
  const overrun = structuredClone(packet);
  overrun.data.records[1].count = 100;
  await page.getByLabel('復元するバックアップ').setInputFiles({
    name: 'overrun.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(overrun)),
  });
  await expect(page.getByRole('alert')).toContainText('完了数が総問題数を超えています');
  expect(await storedState()).toEqual(beforeRestore);
  await page.getByLabel('復元するバックアップ').setInputFiles(path);
  const confirm = page.getByRole('region', { name: 'バックアップ復元の確認' });
  await expect(confirm).toContainText('有効な記録 2件');
  await expect(confirm.getByRole('button', { name: 'この内容で復元する' })).toBeDisabled();
  await confirm.getByRole('button', { name: 'やめる' }).click();
  expect(await storedState()).toEqual(beforeRestore);
  await page.getByLabel('復元するバックアップ').setInputFiles(path);
  await confirm.getByLabel('置き換える内容を確認しました').check();
  await page.screenshot({ path: 'test-results/backup-preview.png', fullPage: true });
  await confirm.getByRole('button', { name: 'この内容で復元する' }).click();
  await saved();
  await expect(page.getByText('復元しました。', { exact: true })).toBeVisible();
  expect(await storedState()).toEqual(seeded);
  await close();
  browser = undefined!;
  await launch();
  expect(await storedState()).toEqual(seeded);
  await nav('バックアップ');
  await page.getByRole('button', { name: '前回の復元前に戻す' }).click();
  const undo = page.getByRole('region', { name: 'バックアップ復元の確認' });
  await undo.getByLabel('置き換える内容を確認しました').check();
  await undo.getByRole('button', { name: 'この内容で復元する' }).click();
  await saved();
  expect(await storedState()).toEqual(beforeRestore);
  await nav('対話式の初期設定');
  await expect(page.locator('.question-description')).not.toBeVisible();
  await page.screenshot({ path: 'test-results/setup-concise.png', fullPage: true });
});

test('実機：独立したチュートリアルと各画面への移動で、入力途中・設定・実績を変更しない', async () => {
  await close();
  browser = undefined!;
  dataDir = mkdtempSync(resolve('.test-data/native-tutorial-'));
  await launch();
  await page.setViewportSize({ width: 900, height: 640 });
  await nav('時間枠・時間割');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  await nav('今日のスケジュール');
  await page.screenshot({ path: 'test-results/navigation-arrival.png' });
  await expect(
    page.getByRole('heading', { name: '今日の詳細', level: 1 }),
  ).toBeInViewport();
  await expect(page.getByRole('heading', { name: '今日の詳細', level: 1 })).toBeFocused();
  await page
    .locator('.sidebar nav')
    .getByRole('button', { name: '設定', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '使い方', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'チュートリアル', level: 1 })).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('main') !== null)).toBe(true);
  await nav('対話式の初期設定');
  await page.getByLabel('試験名', { exact: true }).fill('入力途中の試験');
  const inputScroll = await page.evaluate(() => window.scrollY);
  await saved();
  await expect(page.getByLabel('試験名', { exact: true })).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(inputScroll);
  const before = await storedState();
  await expect(page.locator('.question-description')).toHaveCount(0);
  await expect(page.locator('.question-card summary')).toHaveCount(0);
  await nav('チュートリアル');
  await expect(page.getByRole('heading', { name: '質問に答えて、計画の準備' })).toBeVisible();
  await expect(page.getByRole('button', { name: '前の項目', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '次の項目', exact: true }).click();
  await expect(page.getByRole('heading', { name: '空き時間の中に、休憩と余裕を' })).toBeVisible();
  await page.getByRole('button', { name: '前の項目', exact: true }).click();
  for (const [topic, action, heading] of [
    ['はじめの設定', '初期設定へ', '初期設定'],
    ['勉強できる時間', '時間枠・時間割へ', '時間枠・時間割'],
    ['勉強できる時間', '連続時間・余裕率へ', '連続時間・余裕率'],
    ['計画を見る', '今日へ', '今日'],
    ['計画を見る', '今後の予定へ', '今後の予定'],
    ['計画を見る', '今日の時間内訳へ', '今日の詳細'],
    ['進捗を記録', '今日へ', '今日'],
    ['進捗を記録', '過去日の記録へ', '予定外・過去日の記録'],
    ['進捗を記録', '記録履歴へ', '記録履歴'],
    ['進捗を記録', '週間レポートへ', '週間レポート'],
    ['計画を見直す', '再計画の確認へ', '計画案の確認'],
    ['保存と復元', 'バックアップへ', 'バックアップ'],
  ]) {
    await nav('チュートリアル');
    await page
      .getByRole('navigation', { name: 'チュートリアルの項目' })
      .getByRole('button', { name: topic, exact: true })
      .click();
    await page.getByRole('button', { name: action, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true, level: 1 })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: heading, exact: true, level: 1 }),
    ).toBeInViewport();
    await expect(page.getByRole('heading', { name: heading, exact: true, level: 1 })).toBeFocused();
  }
  expect(await storedState()).toEqual(before);
  await nav('対話式の初期設定');
  await expect(page.getByLabel('試験名', { exact: true })).toHaveValue('入力途中の試験');
  await nav('チュートリアル');
  await page.screenshot({ path: 'test-results/tutorial.png', fullPage: true });
  await page
    .getByRole('navigation', { name: 'チュートリアルの項目' })
    .getByRole('button', { name: '保存と復元', exact: true })
    .click();
  const finish = page.getByRole('button', { name: '終了して戻る', exact: true });
  await expect(finish).toBeVisible();
  await expect(finish).toBeEnabled();
  await finish.click();
  await expect(page.getByRole('heading', { name: '設定', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: '使い方', exact: true })).toBeFocused();
  expect(await storedState()).toEqual(before);
  await page.reload();
  expect(await storedState()).toEqual(before);
});

test('実機：起動時の保存先エラーから再試行・保存内容の保持・壊れたDBの保護', async () => {
  await close();
  browser = undefined!;
  dataDir = mkdtempSync(resolve('.test-data/native-storage-failure-'));
  const path = resolve(dataDir, 'studyplan.sqlite3');
  // Only this test-owned, empty directory is removed to make the file available again.
  mkdirSync(path);
  await launch('学習データを開けませんでした');
  expect(child.exitCode).toBeNull();
  await page.getByText('エラーの詳細', { exact: true }).click();
  await expect(page.locator('.startup-details')).toContainText(path);
  await page.getByRole('button', { name: 'もう一度読み込む', exact: true }).click();
  await expect(page.getByRole('button', { name: 'もう一度読み込む', exact: true })).toBeEnabled();
  await expect(page.getByRole('heading', { name: '学習データを開けませんでした' })).toBeVisible();
  await page.screenshot({ path: 'test-results/startup-retry.png' });
  rmdirSync(path);
  await page.getByRole('button', { name: 'もう一度読み込む', exact: true }).dblclick();
  await expect(page.getByRole('heading', { name: '今日' })).toBeVisible();
  await nav('対話式の初期設定');
  await page.getByLabel('試験名', { exact: true }).fill('読み込み失敗でも残す回答');
  await saved();
  const before = await storedState();
  // A temporary command failure is separate from a missing/empty database.
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    let first = true;
    window.fetch = (input, options) => {
      if (first && String(input).includes('ipc.localhost/load_state')) {
        first = false;
        return Promise.resolve(
          new Response(JSON.stringify('テスト用：一時的に読み込めません'), {
            headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'error' },
          }),
        );
      }
      return nativeFetch(input, options);
    };
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: '学習データを開けませんでした' })).toBeVisible();
  expect(await storedState()).toEqual(before);
  await page.getByRole('button', { name: 'もう一度読み込む', exact: true }).click();
  await nav('対話式の初期設定');
  await expect(page.getByLabel('試験名', { exact: true })).toHaveValue('読み込み失敗でも残す回答');
  expect(await storedState()).toEqual(before);
  await close();
  browser = undefined!;
  await launch();
  expect(await storedState()).toEqual(before);

  await close();
  browser = undefined!;
  dataDir = mkdtempSync(resolve('.test-data/native-damaged-storage-'));
  const damaged = resolve(dataDir, 'studyplan.sqlite3');
  const original = Buffer.from('test-only damaged database');
  writeFileSync(damaged, original);
  await launch('学習データを開けませんでした');
  await page.getByRole('button', { name: 'もう一度読み込む', exact: true }).click();
  await expect(page.getByRole('button', { name: 'もう一度読み込む', exact: true })).toBeEnabled();
  expect(readFileSync(damaged)).toEqual(original);
  expect(child.exitCode).toBeNull();
});

test('実機：試験・教材を対話で追加 → 中断再開 → 計画案の破棄と承認', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/additions-'));
  await launch();
  const seed = initialState();
  const start = addDays(today(), 1);
  seed.settings.exams = [
    {
      id: 'old-e',
      name: '既存の試験',
      start,
      target: addDays(start, 20),
      priority: 2,
      color: '#287569',
      reviewDays: 0,
    },
  ];
  seed.settings.materials = [
    {
      id: 'old-m',
      examId: 'old-e',
      name: '既存の教材',
      total: 50,
      order: 1,
      rounds: [{ completed: 3, minutes: 3 }],
    },
  ];
  seed.settings.windows = [
    {
      id: 'old-w',
      kind: 'study',
      name: '夜の学習枠',
      from: start,
      to: addDays(start, 20),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 1080,
      end: 1260,
    },
  ];
  seed.settings.scheduleAnswers = { class: 'none', busy: 'none', exception: 'none' };
  seed.records = [
    {
      id: 'keep-record',
      materialId: 'old-m',
      round: 0,
      date: today(),
      count: 0,
      cancelled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  seed.plan = generatePlan(seed, start, true, 0);
  seed.plan.sessions[0].fixed = true;
  const fixed = structuredClone(seed.plan.sessions[0]);
  await seedState(seed, 'addition-seed');
  await nav('試験・目標');
  await page.getByRole('button', { name: '試験を追加', exact: true }).click();
  const next = async () => page.getByRole('button', { name: '次へ', exact: true }).click();
  let q = page.getByRole('region', { name: '追加の質問' });
  await expect(q.locator('input')).toHaveCount(1);
  await page.getByLabel('試験名', { exact: true }).fill('新しい資格試験');
  await page.getByLabel('試験名', { exact: true }).press('Enter');
  await page.getByLabel('目標日', { exact: true }).fill(addDays(start, 14));
  await next();
  await page.getByLabel('計画開始日', { exact: true }).fill(start);
  await next();
  await next();
  await next();
  await page.getByRole('button', { name: '今回は設定しない' }).click();
  expect((await storedState()).settings).toEqual(seed.settings);
  await expect(q).toContainText('計画への反映は');
  await page.getByRole('button', { name: '試験を登録する', exact: true }).evaluate((b) => {
    (b as HTMLButtonElement).click();
    (b as HTMLButtonElement).click();
  });
  await saved();
  await expect(q.getByRole('heading', { name: '新しい資格試験を登録しました' })).toBeVisible();
  let data = await storedState();
  expect(data.settings.exams).toHaveLength(2);
  expect(data.plan).toEqual(seed.plan);
  expect(data.settings.windows).toEqual(seed.settings.windows);
  await page.getByRole('button', { name: 'この試験の教材を追加', exact: true }).click();
  await expect(page.getByRole('button', { name: '新しい資格試験', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await next();
  await page.getByLabel('教材名', { exact: true }).fill('追加の問題集');
  await next();
  await page.getByLabel('総問題数', { exact: true }).fill('');
  await page.getByLabel('総問題数', { exact: true }).press('Enter');
  await expect(page.getByLabel('総問題数', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await page.getByRole('button', { name: '中断して一覧へ（続きは保存）', exact: true }).click();
  await saved();
  await launch();
  await nav('教材・進捗');
  await page.getByRole('button', { name: '教材の追加を再開', exact: true }).click();
  q = page.getByRole('region', { name: '追加の質問' });
  await expect(page.getByLabel('総問題数', { exact: true })).toHaveValue('');
  await page.getByLabel('総問題数', { exact: true }).fill('23');
  await page.getByLabel('総問題数', { exact: true }).press('Enter');
  await expect(q).toContainText('この教材を何周しますか');
  await page.getByRole('button', { name: '2周', exact: true }).click();
  await next();
  await page.getByLabel('1周目の初期完了数', { exact: true }).fill('3');
  await page.getByLabel('1周目の初期完了数', { exact: true }).press('Enter');
  await page.getByLabel('2周目の初期完了数', { exact: true }).fill('7');
  await page.getByLabel('2周目の初期完了数', { exact: true }).press('Enter');
  await next();
  await page.getByRole('button', { name: 'すべて同じ時間で進める', exact: true }).click();
  await next();
  await page.getByRole('button', { name: '教材を登録する', exact: true }).evaluate((b) => {
    (b as HTMLButtonElement).click();
    (b as HTMLButtonElement).click();
  });
  await saved();
  await expect(q).toContainText('追加の問題集を登録しました');
  await expect(page.getByRole('region', { name: '登録と計画の状態' })).toContainText(
    '計画に未反映',
  );
  await page.screenshot({ path: 'test-results/addition-saved.png', fullPage: true });
  data = await storedState();
  expect(data.settings.materials).toHaveLength(2);
  expect(data.settings.materials[1].rounds.map((r) => r.completed)).toEqual([3, 7]);
  expect(data.settings.materials[1].examId).toBe(data.settings.exams[1].id);
  expect(data.plan).toEqual(seed.plan);
  expect(data.records).toEqual(seed.records);
  expect(data.settings.buffer).toBe(seed.settings.buffer);
  expect(data.settings.block).toBe(seed.settings.block);
  expect(data.draft.guided).toBeUndefined();
  await page.getByRole('button', { name: 'この変更を含めて計画を見直す', exact: true }).click();
  await expect(page.getByText('教材を追加：追加の問題集', { exact: true })).toBeVisible();
  await expect(page.getByText('試験を追加：新しい資格試験', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '案を破棄する', exact: true }).click();
  await saved();
  expect((await storedState()).settings).toEqual(data.settings);
  expect((await storedState()).plan).toEqual(seed.plan);
  await nav('教材・進捗');
  await page.getByRole('button', { name: 'この変更を含めて計画を見直す', exact: true }).click();
  await page.getByRole('button', { name: 'この内容で更新', exact: true }).click();
  await saved();
  await expect(
    page.getByRole('heading', { name: '計画を更新し、カレンダーに反映しました' }),
  ).toBeFocused();
  await page.screenshot({ path: 'test-results/addition-approved.png', fullPage: true });
  data = await storedState();
  expect(data.records).toEqual(seed.records);
  expect(data.plan!.sessions.find((s) => s.id === fixed.id)).toEqual(fixed);
  expect(data.plan!.settingsSnapshot).toEqual(data.settings);
  expect(data.plan!.sessions.some((s) => s.materialId === data.settings.materials[1].id)).toBe(
    true,
  );
  expect(data.history.at(-1)).toEqual(seed.plan);
  expect(data.proposal).toBeNull();
  await page.getByRole('button', { name: 'カレンダーを見る', exact: true }).click();
  await expect(page.locator('.calendar-toolbar')).toBeVisible();
  await launch();
  const restarted = await storedState();
  expect(restarted.settings).toEqual(data.settings);
  expect(restarted.plan).toEqual(data.plan);
  expect(restarted.records).toEqual(data.records);
});

test('実機：追加前の不足設定を案内し、空の設定から追加できる', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/empty-additions-'));
  await launch();
  await nav('設定');
  await page.getByRole('button', { name: '先に試験を追加', exact: true }).click();
  await expect(page.getByLabel('試験名', { exact: true })).toBeFocused();
  const next = async () => page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.getByLabel('試験名', { exact: true }).fill('最初の試験');
  await next();
  await next();
  await next();
  await next();
  await next();
  await page.getByRole('button', { name: '今回は設定しない' }).click();
  await page.getByRole('button', { name: '試験を登録する', exact: true }).click();
  await nav('設定');
  await page.getByRole('button', { name: '教材を追加', exact: true }).click();
  await expect(page.getByLabel('教材名', { exact: true })).toBeFocused();
  await page.getByLabel('教材名', { exact: true }).fill('最初の問題集');
  await next();
  await next();
  await next();
  await next();
  await next();
  await next();
  await page.getByRole('button', { name: '教材を登録する', exact: true }).click();
  await saved();
  await expect(page.getByRole('region', { name: '登録と計画の状態' })).toContainText(
    '勉強できる時間が未登録',
  );
  await expect(
    page.getByRole('button', { name: 'この変更を含めて計画を見直す', exact: true }),
  ).toHaveCount(0);
  const result = await new AxeBuilder({ page })
    .setLegacyMode()
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(result.violations).toEqual([]);
  await page.getByRole('button', { name: '勉強できる時間を設定', exact: true }).click();
  await expect(page.getByRole('heading', { name: '時間枠・時間割', exact: true })).toBeVisible();
  expect((await storedState()).plan).toBeNull();
});

test('実機：論文2問は通常の60分予定として扱い、時間設定と旧案を更新する', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/time-sessions-'));
  await launch();
  const seed = initialState();
  const start = addDays(today(), 1);
  seed.settings.exams = [
    {
      id: 'e',
      name: '論文試験',
      start,
      target: addDays(start, 4),
      priority: 2,
      color: '#287569',
      reviewDays: 0,
    },
  ];
  seed.settings.materials = [
    {
      id: 'm',
      examId: 'e',
      name: '論文問題集',
      total: 4,
      order: 1,
      rounds: [{ completed: 0, minutes: 30 }],
    },
  ];
  seed.settings.windows = [
    {
      id: 'w',
      name: '60分の学習枠',
      kind: 'study',
      from: start,
      to: addDays(start, 4),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 540,
      end: 600,
    },
  ];
  seed.settings.block = 60;
  seed.settings.buffer = 0;
  seed.settings.scheduleAnswers = { class: 'none', busy: 'none', exception: 'none' };
  seed.records = [
    {
      id: 'zero',
      date: today(),
      materialId: 'm',
      round: 0,
      count: 0,
      cancelled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  seed.plan = generatePlan(seed, start);
  seed.plan.calculationVersion = 3;
  seed.plan.sessions = [
    {
      id: 'fixed',
      date: start,
      start: 540,
      end: 600,
      examId: 'e',
      materialId: 'm',
      round: 0,
      count: 2,
      fixed: true,
      kind: 'study',
      allocationReason: 'deadline',
    },
  ];
  seed.proposal = {
    plan: { ...structuredClone(seed.plan), id: 'old-proposal' },
    basedOn: seed.plan.id,
    reason: '旧方式の案',
    unreported: [],
  };
  await seedState(seed, 'time-seed');
  await nav('学習カレンダー');
  await page.locator('.calendar-event').first().click();
  await expect(
    page.getByText('期限内に配置するため、設定した下限より短い予定です。', { exact: true }),
  ).toHaveCount(0);
  await nav('再計画の確認');
  await expect(page.getByRole('button', { name: 'この内容で更新', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '時間を基準に案を更新する', exact: true }).click();
  await saved();
  expect((await storedState()).proposal!.plan.calculationVersion).toBe(PLAN_CALCULATION_VERSION);
  expect((await storedState()).plan).toEqual(seed.plan);
  await nav('連続時間・余裕率');
  await page.getByText('予定のまとまりを調整する', { exact: true }).click();
  await expect(page.getByLabel('予定の下限（分）')).toHaveValue('10');
  await expect(page.getByLabel('まとまりの目安（分）')).toHaveValue('30');
  await page.getByLabel('予定の下限（分）').fill('15');
  await page.getByLabel('予定の下限（分）').press('Enter');
  await page.getByLabel('まとまりの目安（分）').fill('60');
  await page.getByLabel('まとまりの目安（分）').press('Enter');
  await saved();
  await page.getByRole('button', { name: '設定から計画案を作成', exact: true }).click();
  await page.getByRole('button', { name: 'この内容で更新', exact: true }).click();
  await saved();
  const updated = await storedState();
  expect(updated.settings.minimumSessionMinutes).toBe(15);
  expect(updated.settings.preferredSessionMinutes).toBe(60);
  expect(updated.records).toEqual(seed.records);
  expect(updated.plan!.sessions.find((x) => x.id === 'fixed')).toEqual(seed.plan.sessions[0]);
  const fresh = updated.plan!.sessions.filter((x) => x.id !== 'fixed');
  expect(fresh.map((x) => [x.count, x.end - x.start, x.allocationReason])).toEqual([
    [2, 60, undefined],
  ]);
  await page.getByRole('button', { name: 'カレンダーを見る', exact: true }).click();
  await page.locator('.calendar-event').last().click();
  await expect(
    page.getByText('期限内に配置するため、設定した下限より短い予定です。', { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: 'test-results/time-based-session.png', fullPage: true });
  await launch();
  const after = await storedState();
  expect(after.settings).toEqual(updated.settings);
  expect(after.plan).toEqual(updated.plan);
  expect(after.records).toEqual(seed.records);
});

test('実機：長期計画の未登録期間から周回と時間枠を対話で見直し、承認後に保存する', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/study-coverage-'));
  await launch();
  const seed = initialState();
  const start = addDays(today(), 1);
  const cutoff = addDays(start, 5);
  seed.settings.exams = [
    {
      id: 'long',
      name: '長期の試験',
      start,
      target: addDays(start, 120),
      priority: 2,
      color: '#287569',
      reviewDays: 0,
    },
  ];
  seed.settings.materials = [
    {
      id: 'essay',
      examId: 'long',
      name: '論述教材',
      total: 12,
      order: 1,
      rounds: [
        { completed: 0, minutes: 30 },
        { completed: 0, minutes: 30 },
      ],
    },
  ];
  seed.settings.windows = [
    {
      id: 'term',
      name: '授業期間の学習',
      kind: 'study',
      from: start,
      to: cutoff,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 540,
      end: 690,
    },
  ];
  seed.settings.block = 60;
  seed.settings.buffer = 0;
  seed.settings.scheduleAnswers = { class: 'none', busy: 'none', exception: 'none' };
  seed.records = [
    {
      id: 'zero',
      date: today(),
      materialId: 'essay',
      round: 0,
      count: 0,
      cancelled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  seed.plan = generatePlan(seed, start);
  seed.plan.sessions[0].fixed = true;
  await seedState(seed, 'coverage-seed');
  await nav('学習カレンダー');
  await expect(page.getByLabel('学習枠の未登録期間')).toContainText(
    '周回数・目標日を見直してください',
  );
  await page.getByRole('button', { name: '再計画で期間を見直す', exact: true }).click();
  await page.getByRole('button', { name: '周回数を見直す', exact: true }).click();
  await expect(page.getByRole('heading', { name: '何周取り組みますか？' })).toBeVisible();
  await page.getByLabel('何周取り組みますか？', { exact: true }).fill('1');
  await page.getByLabel('何周取り組みますか？', { exact: true }).press('Enter');
  await expect(
    page.getByRole('heading', { name: '1周目は1問に何分かかりそうですか？' }),
  ).toBeVisible();
  await saved();
  expect((await storedState()).settings.materials[0].rounds).toHaveLength(2);
  await page.getByRole('button', { name: '下書きを残して閉じる', exact: true }).click();
  await page.getByRole('button', { name: 'この期間の学習枠を追加', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'この学習枠に名前を付けますか？' })).toBeVisible();
  await page.getByLabel('この学習枠に名前を付けますか？', { exact: true }).fill('休暇以降の学習');
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await expect(page.getByLabel('この時間帯はいつから使いますか？', { exact: true })).toHaveValue(
    addDays(cutoff, 1),
  );
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await expect(page.getByLabel('この時間帯はいつまで使いますか？', { exact: true })).toHaveValue(
    addDays(start, 119),
  );
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.getByRole('button', { name: 'この項目の変更を終える', exact: true }).click();
  await page.getByRole('button', { name: '変更内容を確認する', exact: true }).click();
  await expect(page.getByLabel('学習枠の未登録期間')).toHaveCount(0);
  await page.getByRole('button', { name: 'この条件で再計画案を作成', exact: true }).click();
  await saved();
  const preview = await storedState();
  expect(preview.settings).toEqual(seed.settings);
  expect(preview.plan).toEqual(seed.plan);
  expect(preview.proposal!.plan.settingsSnapshot!.materials[0].rounds).toHaveLength(1);
  expect(preview.proposal!.plan.sessions.some((x) => x.date > cutoff)).toBe(true);
  await page.getByRole('button', { name: 'この内容で更新', exact: true }).click();
  await saved();
  const approved = await storedState();
  expect(approved.records).toEqual(seed.records);
  expect(approved.plan!.sessions.find((x) => x.id === seed.plan!.sessions[0].id)).toEqual(
    seed.plan.sessions[0],
  );
  expect(approved.settings.windows[0]).toEqual(seed.settings.windows[0]);
  expect(approved.settings.materials[0].rounds).toHaveLength(1);
  await launch();
  const restored = await storedState();
  expect(restored.settings).toEqual(approved.settings);
  expect(restored.plan).toEqual(approved.plan);
  expect(restored.records).toEqual(approved.records);
  await nav('学習カレンダー');
  await expect(page.getByLabel('学習枠の未登録期間')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/study-coverage-resolved.png', fullPage: true });
});

test('実機：共通進捗と今日への安全な入力引継ぎ', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/native-progress-view-'));
  await launch();
  const date = today();
  const seed = initialState();
  seed.settings.exams = [{ id: 'exam', name: '検証試験', start: date, target: addDays(date, 2), priority: 2, color: '#287569', reviewDays: 0 }];
  seed.settings.materials = [{ id: 'book', examId: 'exam', name: '検証教材', total: 100, order: 1, rounds: [{ completed: 0, minutes: 2 }] }];
  seed.settings.windows = [{ id: 'window', name: '枠', kind: 'study', from: date, to: addDays(date, 2), weekdays: [0,1,2,3,4,5,6], start: 1080, end: 1200 }];
  seed.settings.buffer = 0;
  seed.settings.scheduleAnswers = { class: 'none', busy: 'none', exception: 'none' };
  seed.plan = { id: 'p', createdAt: new Date().toISOString(), from: date, settingsSnapshot: structuredClone(seed.settings), calculationVersion: PLAN_CALCULATION_VERSION,
    sessions: [{ id: 's', date, start: 1080, end: 1100, materialId: 'book', examId: 'exam', round: 0, count: 10, fixed: false, kind: 'study' }], capacities: [], conflicts: [], shortfalls: [] };
  seed.records = [{ id: 'r', date, materialId: 'book', round: 0, count: 3, cancelled: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
  await seedState(seed, 'progress-view-seed');
  const row = page.locator('.daily-record-row');
  await expect(row).toContainText('3/10問');
  await nav('詳細カレンダー');
  await page.locator('.calendar-toolbar').getByRole('button', { name: '今日', exact: true }).click();
  await expect(page.getByRole('button', { name: /固定する|固定を解除/ })).toHaveCount(0);
  await page.locator('.session-detail').getByRole('button', { name: '進捗を記録' }).click();
  await expect(row.getByRole('textbox')).toBeFocused();
  await expect(row.getByRole('textbox')).toHaveValue('7');
  expect((await storedState()).records).toEqual(seed.records);
  await row.getByRole('button', { name: '記録', exact: true }).click();
  await saved();
  await expect(row).toContainText('10/10問');
  expect((await storedState()).records.reduce((n, r) => n + r.count, 0)).toBe(10);
  await page.screenshot({ path: 'test-results/progress-consistency/native-today.png', fullPage: true });
  await close();
  await launch();
  await expect(page.locator('.daily-record-row')).toContainText('10/10問');
  await nav('詳細カレンダー');
  await page.getByRole('button', { name: '学習量', exact: true }).click();
  await page.locator('.calendar-toolbar').getByRole('button', { name: '今日', exact: true }).click();
  await expect(page.locator('.quantity-breakdown')).toContainText('10/10問');
});
