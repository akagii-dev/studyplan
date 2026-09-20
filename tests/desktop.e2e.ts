import { test, expect, chromium, Browser, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'node:child_process';
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
import { generatePlan } from '../src/domain/planner';
import { overlapsBusy } from '../src/domain/planAudit';
import { proposeSettings } from '../src/domain/planner';
import ICAL from 'ical.js';
import AxeBuilder from '@axe-core/playwright';
import { startOfWeek } from '../src/domain/calendar';
let child: ChildProcess;
let browser: Browser;
let page: Page;
let dataDir: string;
async function launch(readyHeading = 'ホーム') {
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
async function nav(name: string) {
  await page.locator('.sidebar nav').getByRole('button', { name, exact: true }).click();
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
  for (const theme of ['mint', 'sky', 'lime']) {
    await page.getByLabel('カラーテーマ').selectOption(theme);
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
        await expect(page.getByRole('heading', { name: 'ホーム', exact: true })).toBeVisible();
        await expect(page.locator('.hero')).toHaveCount(0);
      }
      if (screen === '再計画の確認') {
        await expect(
          page.getByRole('button', { name: 'この計画を承認する', exact: true }),
        ).toBeInViewport({ ratio: 1 });
      }
      const result = await new AxeBuilder({ page })
        // WebView2 exposes one native window, not a browser that can open aggregation tabs.
        .setLegacyMode()
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      reports.push({
        theme,
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
        await page.screenshot({ path: `test-results/contrast-${theme}-${view}.png` });
      }
    }
    await nav('再計画の確認');
    const planTable = page.getByRole('region', { name: '一日の予定問題数の表' });
    await page.getByText('一日の予定問題数（全試験で共有）', { exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(planTable).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => planTable.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(planTable).toBeFocused();
    await page.keyboard.press('End');
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
      theme,
      screen: '一日の予定問題数の表・末尾',
      violations: bottom.violations,
      incomplete: bottom.incomplete,
    });
    await page.screenshot({ path: `test-results/readability-${theme}.png`, fullPage: true });
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
});
async function seedState(data: AppState, requestId: string) {
  await page.evaluate(
    async ({ data, requestId }) => {
      await (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke: (name: string, args: unknown) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__.invoke('commit_state', { expected: 0, requestId, data });
    },
    { data, requestId },
  );
  await page.reload();
}
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
    createdAt: new Date().toISOString(),
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
    '0問報告 1件',
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
  expect(text).toContain('0問報告 1件');
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
  await expect(
    page.getByRole('button', { name: 'この計画を承認する', exact: true }),
  ).toBeInViewport({ ratio: 1 });
  const errors = page.getByRole('region', { name: '計画エラーの修正' });
  await expect(errors).toContainText('経済学（09:00〜10:40）と重なっています');
  await expect(page.getByRole('button', { name: 'この計画を承認する' })).toBeDisabled();
  const readiness = page.getByRole('region', { name: '承認前の確認' });
  await expect(readiness).toContainText('予定の競合：1件');
  await expect(readiness).toContainText('未報告の扱い：1件が未確認');
  await readiness.getByRole('button', { name: '競合の理由と修正方法を確認' }).click();
  await expect(errors.getByRole('heading')).toBeFocused();
  await expect(errors.getByRole('heading')).toBeInViewport();
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
  await expect(page.getByRole('button', { name: 'この計画を承認する' })).toBeDisabled();
  await readiness.getByRole('button', { name: '未報告の予定を確認', exact: true }).click();
  await expect(page.getByRole('heading', { name: '未報告の予定を確認してください' })).toBeFocused();
  await expect(
    page.getByRole('heading', { name: '未報告の予定を確認してください' }),
  ).toBeInViewport();
  await page.getByLabel('未報告は記録を保留したまま、現在の残数を今後の枠へ再配置する').check();
  await page.getByRole('button', { name: '承認操作へ戻る' }).click();
  await expect(page.getByRole('button', { name: 'この計画を承認する' })).toBeFocused();
  await expect(readiness).toHaveCount(0);
  await page.getByRole('button', { name: 'この計画を承認する' }).click();
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
  await page.evaluate(async (data) => {
    await (
      window as unknown as {
        __TAURI_INTERNALS__: { invoke: (name: string, args: unknown) => Promise<unknown> };
      }
    ).__TAURI_INTERNALS__.invoke('commit_state', { expected: 0, requestId: 'revision-seed', data });
  }, seed);
  await page.reload();
  await nav('学習カレンダー');
  await expect(page.getByText('授業・予定と重なる学習予定が2件あります')).toBeVisible();
  await page.getByRole('button', { name: `${date}を表示` }).click();
  const panel = page.locator('.day-panel');
  await expect(panel.getByText('学習予定と授業・予定が重複')).toHaveCount(2);
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
  await page.getByRole('button', { name: 'この計画を承認する' }).click();
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
  await page.getByRole('button', { name: '質問に答えて計画をつくる' }).click();
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
  await page.getByRole('button', { name: '表示色 #6870b5' }).click();
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
    page.getByText(
      '未登録のアルバイトやサークルなどの時間は学習可能枠から除かれません。毎週の予定と学習が重なる可能性があります。',
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: '定期予定はない', exact: true }).click();
  await expect(
    page.getByText(
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
    page.getByText('勉強できない特定の日・時間：あとで設定', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('授業以外の定期予定：あとで設定', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '計画案を作成する' }).click();
  await expect(page.getByRole('heading', { name: '計画案', exact: true })).toBeVisible();
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
    page.getByText('勉強できない特定の日・時間：あとで設定', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'この計画を承認する' }).click();
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
  await page.getByRole('button', { name: '予定を固定', exact: true }).first().click();
  await saved();
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
  await nav('再計画の確認');
  const beforeApproval = await storedState();
  const approveButton = page.getByRole('button', { name: 'この計画を承認する' });
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
  await expect(
    page.getByText('勉強できない特定の日・時間：あとで設定', { exact: true }),
  ).toBeVisible();
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
  await nav('ホーム');
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
  await nav('ホーム');
  await expect(
    page.getByText('勉強できない特定の日・時間：あとで設定', { exact: true }),
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
  for (const theme of ['mint', 'sky', 'lime']) {
    await page.getByLabel('カラーテーマ').selectOption(theme);
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
    await nav('進捗を記録');
    expect(
      await page
        .locator('svg[aria-label="本と学びの積み重ねのイラスト"] circle')
        .getAttribute('fill'),
    ).toBe('var(--soft)');
    await page.screenshot({ path: `test-results/progress-${theme}.png`, fullPage: true });
    await nav('ホーム');
  }
  expect(accents.size).toBe(3);
  expect((await storedState()).settingsUpdatedAt).toBe(beforeTheme.settingsUpdatedAt);
  await close();
  browser = undefined!;
  await launch();
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
  seed.plan = generatePlan(seed, date);
  seed.plan.sessions[0].fixed = true;
  await page.evaluate(async (data) => {
    await (
      window as unknown as {
        __TAURI_INTERNALS__: { invoke: (name: string, args: unknown) => Promise<unknown> };
      }
    ).__TAURI_INTERNALS__.invoke('commit_state', { expected: 0, requestId: 'edit-seed', data });
  }, seed);
  await page.reload();
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
  await expect(page.getByLabel('① 記録対象日')).toHaveValue(date);
  await expect(page.getByLabel('教材', { exact: true })).toHaveValue('m');
  await nav('学習カレンダー');
  await expect(page.locator('.calendar-busy').filter({ hasText: '経済学' }).first()).toBeVisible();
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
  await page.getByRole('button', { name: '保存して、勉強できる時間へ' }).click();
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
  await page.evaluate(async (data) => {
    data.draft.progress = {
      date: data.settings.exams[0].start,
      materialId: 'a',
      round: 0,
      choice: 'other',
      custom: '',
    };
    data.draft.numberEdits = { 'progress///追加問題数（1問単位）': { text: '7', base: '' } };
    await (
      window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> };
      }
    ).__TAURI_INTERNALS__.invoke('commit_state', { data, expected: 0, requestId: 'calendar-seed' });
  }, seed);
  await page.reload();
  await nav('学習カレンダー');
  const selected = `${month}-27`;
  await page.getByRole('button', { name: `${selected}を表示`, exact: true }).click();
  const week = addDays(selected, -((weekday(selected) + 6) % 7));
  await expect(page.getByRole('region', { name: '選択した日の週の時間の内訳' })).toContainText(
    `${week}〜${addDays(week, 6)}`,
  );
  await page.getByRole('button', { name: '週', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `${selected}を表示`, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '次の期間', exact: true }).click();
  const nextSelected = addDays(selected, 7);
  await expect(
    page.getByRole('button', { name: `${nextSelected}を表示`, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: '1日の可処分時間' })).toContainText(nextSelected);
  await page.getByRole('button', { name: '一覧', exact: true }).click();
  await expect(page.locator('.busy-event').first()).toContainText('経済学');
  await expect(
    page.getByText('この期間に勉強・大学の予定と学習実績はありません。', { exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '今日', exact: true }).click();
  await expect(page.getByText('教材a · 1周目：＋0問', { exact: true })).toBeVisible();
  await expect(page.getByText('教材b · 1周目：＋7問', { exact: true })).toBeVisible();
  await expect(page.getByText('教材a · 1周目：＋3問', { exact: true })).toHaveCount(0);
  await page.getByLabel('表示する試験').selectOption('a');
  await expect(page.getByText('教材b · 1周目：＋7問', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: `${date}の時間の内訳を表示`, exact: true }).click();
  await expect(page.getByRole('region', { name: '1日の可処分時間' })).toContainText(date);
  await expect(page.getByRole('button', { name: '記録は当日から', exact: true })).toBeDisabled();
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
  await page.evaluate(async (data) => {
    await (
      window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> };
      }
    ).__TAURI_INTERNALS__.invoke('commit_state', { data, expected: 0, requestId: 'backup-seed' });
  }, seed);
  await page.reload();
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
  expect(await storedState()).toEqual(seed);
  await chooseSavePath(path);
  await page.getByRole('button', { name: 'バックアップを保存する', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '保存しました：' })).toBeVisible();
  const { readFileSync } = await import('node:fs');
  const packet = JSON.parse(readFileSync(path, 'utf8'));
  expect(packet.data).toEqual(seed);
  await page.getByLabel('カラーテーマ').selectOption('lime');
  await saved();
  const beforeRestore = await storedState();
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
  expect(await storedState()).toEqual(seed);
  await close();
  browser = undefined!;
  await launch();
  expect(await storedState()).toEqual(seed);
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
    page.getByRole('heading', { name: '今日のスケジュール', level: 1 }),
  ).toBeInViewport();
  await expect(page.getByRole('heading', { name: '今日のスケジュール', level: 1 })).toBeFocused();
  await page
    .locator('.sidebar nav')
    .getByRole('button', { name: 'チュートリアル', exact: true })
    .focus();
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
    ['はじめの設定', '初期設定へ', '対話式の初期設定'],
    ['勉強できる時間', '時間枠・時間割へ', '時間枠・時間割'],
    ['勉強できる時間', '連続時間・余裕率へ', '連続時間・余裕率'],
    ['計画を見る', '今日のスケジュールへ', '今日のスケジュール'],
    ['計画を見る', '学習カレンダーへ', '学習カレンダー'],
    ['進捗を記録', '進捗を記録へ', '進捗を記録'],
    ['進捗を記録', '記録履歴へ', '記録履歴'],
    ['進捗を記録', '週間レポートへ', '週間レポート'],
    ['計画を見直す', '再計画の確認へ', '再計画の確認'],
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
  await expect(page.getByRole('button', { name: '次の項目', exact: true })).toBeDisabled();
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
  await expect(page.getByRole('heading', { name: 'ホーム' })).toBeVisible();
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
    '計画への反映待ち',
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
  await page.getByRole('button', { name: '追加・変更を含めた計画案を確認', exact: true }).click();
  await expect(page.getByText('教材を追加：追加の問題集', { exact: true })).toBeVisible();
  await expect(page.getByText('試験を追加：新しい資格試験', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '案を破棄する', exact: true }).click();
  await saved();
  expect((await storedState()).settings).toEqual(data.settings);
  expect((await storedState()).plan).toEqual(seed.plan);
  await nav('教材・進捗');
  await page.getByRole('button', { name: '追加・変更を含めた計画案を確認', exact: true }).click();
  await page.getByRole('button', { name: 'この計画を承認する', exact: true }).click();
  await saved();
  await expect(
    page.getByRole('heading', { name: '計画を承認し、カレンダーに反映しました' }),
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
  await expect(
    page.getByRole('region', { name: '選択した日の週の時間の内訳' }).locator('.metrics > div'),
  ).toHaveCount(2);
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
  await page.getByRole('button', { name: '教材を追加', exact: true }).click();
  await expect(page.getByRole('heading', { name: '先に試験を追加しましょう' })).toBeVisible();
  await page.getByRole('button', { name: '試験を追加', exact: true }).click();
  const next = async () => page.getByRole('button', { name: '次へ', exact: true }).click();
  await page.getByLabel('試験名', { exact: true }).fill('最初の試験');
  await next();
  await next();
  await next();
  await next();
  await next();
  await page.getByRole('button', { name: '今回は設定しない' }).click();
  await page.getByRole('button', { name: '試験を登録する', exact: true }).click();
  await page.getByRole('button', { name: '入力途中の教材の追加を再開', exact: true }).click();
  await page.getByRole('button', { name: '最初の試験', exact: true }).click();
  await next();
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
    page.getByRole('button', { name: '追加・変更を含めた計画案を確認', exact: true }),
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
  await expect(
    page.getByRole('button', { name: 'この計画を承認する', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: '時間を基準に案を更新する', exact: true }).click();
  await saved();
  expect((await storedState()).proposal!.plan.calculationVersion).toBe(4);
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
  await page.getByRole('button', { name: 'この計画を承認する', exact: true }).click();
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
  await page.getByRole('button', { name: 'この計画を承認する', exact: true }).click();
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
