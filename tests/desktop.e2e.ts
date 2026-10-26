
import { test, expect, chromium, Browser, Page } from '@playwright/test';
import { spawn, execFile, ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  addDays,
  today,
  weekday,
  AppState,
  initialState,
  completed,
  remaining,
} from '../src/domain/model';
import { generatePlan } from '../src/domain/planning';
import AxeBuilder from '@axe-core/playwright';
import { studentFixture } from './fixtures/student';
import { multiDayRolloverFixture, adjustmentFixture } from './fixtures/adjustment';
import { activePlanWork } from '../src/domain/progressAllocation';
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
async function calendarSetting(label: string, value: string | { label: string }) {
  await page.getByRole('button', { name: 'カレンダーの表示設定', exact: true }).click();
  await page.getByRole('dialog', { name: '表示設定', exact: true }).getByLabel(label, { exact: true }).selectOption(value);
  await page.keyboard.press('Escape');
}
async function navigate(name: string) {
  const aliases: Record<string, string> = {
    今日の詳細: '今日のスケジュール',
    詳細カレンダー: '学習カレンダー',
    '予定外・過去日の記録': '進捗を記録',
  };
  name = aliases[name] ?? name;
  const main = page.locator('#app-sidebar');
  if (name === 'ホーム') name = '今日';
  if (name === '今日のスケジュール') {
    await main.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('button', { name: '今日の時間内訳', exact: true }).click();
    return;
  }
  if (name === '学習カレンダー') {
    await main.getByRole('button', { name: '今後の予定', exact: true }).click();
    await page.getByRole('button', { name: 'カレンダー表示', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '詳細カレンダー', exact: true, level: 1 }),
    ).toBeVisible();
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
      if (addDays(today(), 1) < start)
        await page.getByRole('button', { name: '前の週', exact: true }).click();
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
  const label =
    name === '対話式の初期設定'
      ? '初期設定'
      : name === '再計画の確認'
        ? '計画案の確認'
        : name;
  await page.getByRole('button', { name: label, exact: true }).click();
}
async function nav(name: string) {
  await navigate(name);
  await page.locator('.page-transition').evaluateAll(elements =>
    Promise.allSettled(elements.flatMap(element => element.getAnimations().map(animation => animation.finished))));
}
async function displaySettings(appearance?: string, theme?: string) {
  // The page title is drawn as cut-out letters (TODAY on 今日); its accessible name is the page name.
  const previous = (await page.locator('h1').getAttribute('aria-label'))!;
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

test('実機：複数日ぶりの読込で実績・未来固定・全周回数量を保持し、再起動で二重反映しない', async () => {
  dataDir = mkdtempSync(resolve('.test-data/reconcile-multi-day-'));
  await launch();
  const date = today();
  const source = multiDayRolloverFixture(addDays(date, -3));
  await seedState(source, 'multi-day-expired');
  await expect.poll(async () => (await storedState()).plan?.adjustmentBasis?.date).toBe(date);
  await saved();
  const adjusted = await storedState();
  expect(adjusted.records).toEqual(source.records);
  expect(adjusted.plan!.shortfalls).toEqual([]);
  expect(adjusted.plan!.sessions.find((s) => s.id === 'other-4')).toEqual(source.plan!.sessions.find((s) => s.id === 'other-4'));
  expect(adjusted.plan!.sessions.filter((s) => s.date < date).sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      source.plan!.sessions.filter((s) => s.date < date).sort((a, b) => a.id.localeCompare(b.id)),
    );
  for (const material of adjusted.settings.materials) for (const round of material.rounds.keys()) {
    const active = activePlanWork(adjusted, date).filter((s) => s.materialId === material.id && s.round === round).reduce((sum, s) => sum + s.count, 0);
    expect(completed(adjusted, material.id, round) + active).toBe(material.total);
  }
  const book = activePlanWork(adjusted, date).filter((s) => s.materialId === 'book');
  for (const round of [0, 1, 2]) {
    const previousEnd = book.filter((s) => s.round === round).map((s) => `${s.date}/${String(s.end).padStart(4, '0')}`).sort().at(-1)!;
    const nextStart = book.filter((s) => s.round === round + 1).map((s) => `${s.date}/${String(s.start).padStart(4, '0')}`).sort()[0];
    expect(previousEnd <= nextStart).toBe(true);
  }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(await storedState()).toEqual(adjusted);
  await closeWindowNormally();
  await launch();
  expect(await storedState()).toEqual(adjusted);
});

test('実機：未消化反映の保存失敗では正本を保持し、復帰のたびに再保存しない', async () => {
  dataDir = mkdtempSync(resolve('.test-data/reconcile-save-failure-'));
  await launch();
  const source = adjustmentFixture(addDays(today(), -1));
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    const w = window as unknown as { reconciliationSaveAttempts: number };
    w.reconciliationSaveAttempts = 0;
    window.fetch = async (input, options) => {
      if (String(input).includes('ipc.localhost/commit_state')) {
        w.reconciliationSaveAttempts += 1;
        return new Response(JSON.stringify('テスト用：未消化反映の保存失敗'), {
          headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'error' },
        });
      }
      return nativeFetch(input, options);
    };
  });
  await seedState(source, 'before-reconcile-failure');
  await expect(page.getByRole('alert')).toContainText('テスト用：未消化反映の保存失敗');
  await expect.poll(async () => (await storedState()).records).toEqual(source.records);
  expect((await storedState()).plan).toEqual(source.plan);
  const attempts = () =>
    page.evaluate(
      () =>
        (window as unknown as { reconciliationSaveAttempts: number }).reconciliationSaveAttempts,
    );
  expect(await attempts()).toBe(1);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await attempts()).toBe(1);
  expect((await storedState()).plan).toEqual(source.plan);
});

// 区間名の編集は「時刻・通学の内訳を見る」の中にあり、内訳を一時的に外しているため、この試験はスキップする（復活時に test.skip を test に戻す）。
test.skip('実機：今日の未設定区間に名前を付け、保存・取消・再起動・解除する', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/outside-labels-'));
  await launch();
  const date = today(),
    seed = studentFixture(date);
  // This alignment check needs a commute row on weekends as well as weekdays.
  seed.settings.commute = {
    ...seed.settings.commute!,
    mode: 'weekdays',
    weekdays: [weekday(date)],
  };
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
        const stored = (await invoke('load_state')) as { revision: number; data: object } | null;
        try {
          // Desktop saves send changed keys; seeding replaces every key.
          const removed = Object.keys(stored?.data ?? {}).filter((key) => !(key in data));
          await invoke('commit_state', { expected: stored?.revision ?? 0, requestId, changes: data, removed });
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
test('実機：初期設定 → SQLite保存 → 計画 → 進捗 → 再計画 → 再起動', async () => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/native-'));
  await launch();
  await page.getByRole('button', { name: '設定を始める' }).click();
  const next = async () => page.getByRole('button', { name: '次へ', exact: true }).click();
  await expect(page.getByRole('button', { name: '次へ', exact: true })).toBeDisabled();
  await expect(page.locator('.question-answer input')).toHaveCount(1);
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
    page
      .getByRole('region', { name: 'あとで設定する場合の影響' })
      .getByText(
        '未登録のアルバイトやサークルなどの時間は学習可能枠から除かれません。毎週の予定と学習が重なる可能性があります。',
        { exact: true },
      ),
  ).toBeVisible();
  await page.getByRole('button', { name: '定期予定はない', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'あとで設定する場合の影響' })
      .getByText(
        '未登録の旅行や外出などは計画に反映されません。勉強できない日や時間帯にも学習が入る可能性があります。',
        { exact: true },
      ),
  ).toBeVisible();
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
          invoke: (
            name: string,
          ) => Promise<{ data: AppState & { plan: NonNullable<AppState['plan']> } }>;
        };
      }
    ).__TAURI_INTERNALS__.invoke('load_state');
  });
  await calendarSetting('表示期間', 'week');
  await expect(page.locator('.calendar-grid.week')).toBeVisible();
  await expect(page.getByRole('button', { name: '一覧', exact: true })).toHaveCount(0);
  // The current local time may leave no study session today, and late on a Sunday none
  // this week; open an actual visible plan.
  if (!(await page.locator('.calendar-event').count()))
    await page.locator('.calendar-toolbar').getByRole('button', { name: '次の期間', exact: true }).click();
  await page.locator('.calendar-event').first().click();
  await expect(page.locator('.day-panel .session-detail').first()).toBeVisible();
  await calendarSetting('表示期間', 'month');
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
  await calendarSetting('対象の試験', { label: '基本情報技術者' });
  await expect(page.locator('.calendar-event').filter({ hasText: '簿記トレーニング' })).toHaveCount(
    0,
  );
  await calendarSetting('対象の試験', { label: 'すべての試験' });
  // Late in the day, the first available session may be tomorrow rather than the selected today.
  await page.locator('.calendar-event').first().click();
  await expect(page.getByRole('button', { name: '固定する', exact: true })).toHaveCount(0);
  await nav('進捗を記録');
  await page.getByLabel('今回解いた問題数').fill('3');
  await page.getByRole('button', { name: '記録する', exact: true }).dblclick();
  await saved();
  await expect(page.getByText('＋3問を記録しました。', { exact: false })).toBeVisible();
  await page.getByLabel('今回解いた問題数').fill('0');
  await page.getByRole('button', { name: '記録する', exact: true }).click();
  await saved();
  await expect(page.locator('.progress-summary')).toContainText('完了 3問');
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
  const materialId = adjusted.records.find((r) => r.count === 7)!.materialId;
  expect(completed(adjusted, materialId, 0)).toBe(7);
  expect(remaining(adjusted, materialId, 0)).toBe(30);
  const todayPlanned = beforeView.data.plan.sessions
    .filter(
      (s: { date: string; materialId: string; round: number }) =>
        s.date === today() && s.materialId === materialId && s.round === 0,
    )
    .reduce((n: number, s: { count: number }) => n + s.count, 0);
  const todayRemaining = Math.min(30, Math.max(0, todayPlanned - 7));
  const future = adjusted
    .plan!.sessions.filter((s) => s.date > today() && s.materialId === materialId && s.round === 0)
    .reduce((n, s) => n + s.count, 0);
  const unplaced = adjusted
    .plan!.shortfalls.filter((s) => s.materialId === materialId && s.round === 0)
    .reduce((n, s) => n + s.count, 0);
  expect(7 + todayRemaining + future + unplaced).toBe(37);
  if (todayPlanned >= 7) expect(adjusted.plan!.sessions).toEqual(beforeView.data.plan.sessions);
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
  await page.getByLabel('今回解いた問題数').fill('37');
  await page.getByRole('button', { name: '記録する', exact: true }).click();
  await saved();
  await page.getByLabel('今回解いた問題数').fill('5');
  await expect(page.getByRole('button', { name: '記録する', exact: true })).toBeDisabled();
  await expect(page.locator('.progress-summary')).toContainText('残り 0問');
  await nav('今日のスケジュール');
  await expect(page.getByRole('region', { name: '1日の可処分時間' })).toBeVisible();
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
    await nav('ホーム');
    // Weekend-only study windows have no planned row on weekdays. The records still remain.
    const dailyRow = page.locator('.daily-record-row').filter({ hasText: '基本情報 午後問題集' });
    let recordButton;
    if (todayPlanned > 0) {
      await expect(dailyRow.locator('.progress-value')).toHaveText(37 > todayPlanned ? `追加${37-todayPlanned}問` : 37 === todayPlanned ? '完了' : `あと${todayPlanned-37}問`);
      if (await dailyRow.locator('.daily-record-input').getAttribute('open') === null)
        await dailyRow.locator('.daily-record-input summary').press('Enter');
      recordButton = dailyRow.getByRole('button', { name: '記録', exact: true });
    } else {
      await expect(dailyRow).toHaveCount(0);
      await nav('進捗を記録');
      await expect(page.locator('.progress-summary')).toContainText('完了 37問');
      recordButton = page.getByRole('button', { name: '記録する', exact: true });
      // An empty form keeps the button disabled, which looks the same in every theme.
      await page.getByLabel('今回解いた問題数', { exact: true }).fill('0');
      await expect(recordButton).toBeEnabled();
    }
    // Wait for the enabled background transition to settle before reading the color.
    const background = () => recordButton.evaluate(button => getComputedStyle(button).backgroundColor);
    await expect.poll(async () => { const before = await background(); await page.waitForTimeout(100); return before === await background(); }).toBe(true);
    actionColors.add(await background());
  }
  expect(accents.size).toBe(3);
  // The main action is the same gray in every theme; only the accent changes.
  expect(actionColors.size).toBe(1);
  expect((await storedState()).settingsUpdatedAt).toBe(beforeTheme.settingsUpdatedAt);
  await close();
  browser = undefined!;
  await launch();
  await nav('設定');
  await expect(page.getByLabel('カラーテーマ')).toHaveValue('lime');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'lime');
});

// Maximize takes the same close path as normal (useCloseAfterSave has no window-state branch);
// restoring a maximized window is covered by 実機：OSで最大化して閉じても最大化と元のサイズを復元する.
for (const windowMode of ['normal', 'minimize']) {
  test(`実機：${windowMode}で保存済み・保存中・保存失敗の終了契約を守る`, async () => {
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
      if (windowMode !== 'normal') await osWindow(windowMode);
      await osWindow('close');
    }
    async function releaseSave() {
      await page.evaluate(() =>
        (window as unknown as { releaseTestSave: () => void }).releaseTestSave(),
      );
    }
    await requestClose();
    await expect.poll(() => child.exitCode, { timeout: 15000 }).not.toBeNull();
    await launch();
    expect(await storedState()).toEqual(before);
    await nav('対話式の初期設定');
    await holdSave(true);
    await page.getByLabel('試験名', { exact: true }).fill('保存が失敗する目標');
    await expect(page.locator('.save-status')).toContainText('保存中');
    await requestClose();
    await expect(page.getByRole('dialog', { name: '保存して終了' })).toBeVisible();
    await requestClose(); // repeated close must not bypass the pending save
    expect(child.exitCode).toBeNull();
    await releaseSave();
    if (windowMode !== 'normal') await osWindow('restore');
    await expect(page.getByRole('alert')).toContainText('保存に失敗したため終了を中止しました');
    await expect(page.getByRole('dialog', { name: '保存して終了' })).toHaveCount(0);
    await expect(page.getByLabel('試験名', { exact: true })).toHaveValue('保存前の目標');
    expect(await storedState()).toEqual(before);
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    await holdSave(false);
    await page.getByLabel('試験名', { exact: true }).fill('終了直前に入力した目標');
    await requestClose();
    await expect(page.getByRole('dialog', { name: '保存して終了' })).toBeVisible();
    await releaseSave();
    await expect.poll(() => child.exitCode, { timeout: 15000 }).not.toBeNull();
    await close();
    browser = undefined!;
    await launch();
    await nav('対話式の初期設定');
    await expect(page.getByLabel('試験名', { exact: true })).toHaveValue('終了直前に入力した目標');
  });
}

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


for (const responseLost of [false, true]) {
  test('実機：今日の記録保存' + (responseLost ? '応答消失' : '失敗') + 'でも入力・記録ID・数量を保持して再送する', async () => {
    dataDir = mkdtempSync(resolve('.test-data/record-retry-'));
    await launch();
    await seedState(adjustmentFixture(today()), 'record-retry-source');
    const before = await storedState();
    await page.evaluate((lost) => {
      const nativeFetch = window.fetch.bind(window);
      const probe = window as unknown as { recordAttemptIds: string[] };
      probe.recordAttemptIds = [];
      let once = true;
      window.fetch = async (input, options) => {
        if (String(input).includes('ipc.localhost/commit_state')) {
          const args = JSON.parse(String(options?.body)) as { changes: Partial<AppState> };
          const record = args.changes.records?.find(r => r.materialId === 'book' && r.count === 4);
          if (record) {
            probe.recordAttemptIds.push(record.id);
            if (once) {
              once = false;
              if (lost) await nativeFetch(input, options);
              return new Response(JSON.stringify('専用試験：記録の保存応答失敗'), {
                headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'error' },
              });
            }
          }
        }
        return nativeFetch(input, options);
      };
    }, responseLost);
    const row = page.locator('.daily-record-row').filter({ hasText: '対象問題集' });
    await row.getByRole('textbox').fill('4');
    await row.getByRole('button', { name: '記録', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: '専用試験' })).toBeVisible();
    await expect(row.getByRole('textbox')).toHaveValue('4');
    const recovered = await storedState();
    expect(recovered.records).toHaveLength(responseLost ? 1 : 0);
    if (!responseLost) expect(recovered).toEqual(before);
    await row.getByRole('button', { name: '記録', exact: true }).click();
    await expect(page.locator('.daily-record-saved')).toContainText('4問を記録しました');
    await expect(row.getByRole('textbox')).toHaveValue('');
    await expect(page.getByRole('alert').filter({ hasText: '専用試験' })).toHaveCount(0);
    const savedState = await storedState();
    expect(savedState.records).toHaveLength(1);
    expect(savedState.records[0].count).toBe(4);
    const ids = await page.evaluate(() => (window as unknown as { recordAttemptIds: string[] }).recordAttemptIds);
    expect(ids.length).toBe(responseLost ? 1 : 2);
    expect(new Set(ids)).toEqual(new Set([savedState.records[0].id]));
    if (responseLost) { expect(savedState.plan).toEqual(recovered.plan); expect(savedState.history).toEqual(recovered.history); }
    const work = activePlanWork(savedState, today()).filter(s => s.materialId === 'book' && s.round === 0);
    expect(work.filter(s => s.date === today()).reduce((n,s) => n+s.count,0)).toBe(2);
    expect(work.filter(s => s.date > today()).reduce((n,s) => n+s.count,0)).toBe(24);
    expect(4 + work.reduce((n,s) => n+s.count,0)).toBe(30);
    await closeWindowNormally(); await launch();
    expect((await storedState()).records).toEqual(savedState.records);
    expect((await storedState()).plan).toEqual(savedState.plan);
  });
}

test('実機：ターム・メモのSQLite保存・失敗入力・バックアップ復元・再起動を維持する', async () => {
  dataDir = mkdtempSync(resolve('.test-data/study-note-'));
  await launch(); await seedState(adjustmentFixture(today()), 'study-note-source');
  const before = await storedState();
  const form = page.getByRole('form', { name: 'ターム・メモ' });
  const memo = form.getByLabel('メモ', { exact: true });
  const note = { nextTerm: '', memo: '判例を確認\n次は錯誤' };
  await memo.fill(note.memo); await form.getByRole('button', { name: '保存', exact: true }).click(); await saved();
  const stored = await storedState(); expect(stored.studyNote).toEqual(note); delete stored.studyNote; expect(stored).toEqual(before);
  const path = resolve(dataDir, 'note.studyplan.json');
  await page.evaluate(async path => {
    await (window as unknown as { __TAURI_INTERNALS__: { invoke: (name: string, args: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke('export_backup', { path });
  }, path);
  expect(JSON.parse(readFileSync(path, 'utf8')).data.studyNote).toEqual(note);
  await page.evaluate(() => {
    const nativeFetch = window.fetch.bind(window); let once = true;
    window.fetch = async (input, options) => {
      if (String(input).includes('ipc.localhost/commit_state') && once) { once = false; return new Response(JSON.stringify('専用試験：メモ保存失敗'), { headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'error' } }); }
      return nativeFetch(input, options);
    };
  });
  await memo.fill('失敗時の下書き'); await form.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '専用試験：メモ保存失敗' })).toBeVisible();
  await expect(memo).toHaveValue('失敗時の下書き'); expect((await storedState()).studyNote).toEqual(note);
  await nav('今後の予定'); await nav('今日'); await expect(memo).toHaveValue('失敗時の下書き');
  await form.getByRole('button', { name: '保存', exact: true }).click(); await saved(); expect((await storedState()).studyNote?.memo).toBe('失敗時の下書き');
  await nav('バックアップ'); await page.getByLabel('復元するバックアップ').setInputFiles(path);
  await page.getByLabel('置き換える内容を確認しました').check(); await page.getByRole('button', { name: 'この内容で復元する', exact: true }).click();
  await expect(page.getByText('復元しました。', { exact: true })).toBeVisible(); await nav('今日');
  await expect(memo).toHaveValue(note.memo);
  await closeWindowNormally(); await launch();
  expect((await storedState()).studyNote).toEqual(note);
  await expect(page.getByLabel('メモ', { exact: true })).toHaveValue(note.memo);
});
