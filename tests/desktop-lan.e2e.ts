import {
  test,
  expect,
  chromium,
  type Browser,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { type AppState, type Envelope, today } from '../src/domain/model';
import { activePlanWork } from '../src/domain/progressAllocation';
import { adjustmentFixture } from './fixtures/adjustment';
import { type DesktopLanAddress, type DesktopLanStatus } from '../src/desktopLan';

// The native host and both frontends share only this test's dedicated SQLite.
// Release builds ignore these overrides, so never replace the debug executable.
const origin = 'http://127.0.0.1:4186';
const base = `${origin}/studyplan-lan/`;
let child: ChildProcess | undefined;
let nativeBrowser: Browser | undefined;
let page: Page;
let dataDir: string;

type HostStatus = DesktopLanStatus;
interface CandidateTestWindow {
  __TAURI_INTERNALS__: { invoke: (name: string, args?: unknown) => Promise<unknown> };
  lanCandidateTest: {
    calls: { name: string; args?: unknown }[];
    addresses: DesktopLanAddress[];
    nativeStatus: () => Promise<unknown>;
  };
}
async function invoke<T>(name: string, args?: unknown): Promise<T> {
  return page.evaluate(
    async ({ name, args }) => {
      const api = (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke: (name: string, args?: unknown) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__;
      return api.invoke(name, args);
    },
    { name, args },
  ) as Promise<T>;
}
async function close() {
  if (nativeBrowser) await nativeBrowser.close().catch(() => {});
  nativeBrowser = undefined;
  if (child && !child.killed && child.exitCode === null) {
    const ended = new Promise<void>((done) => {
      child!.once('exit', () => done());
      setTimeout(done, 3000);
    });
    child.kill();
    await ended;
  }
  child = undefined;
}
async function launch() {
  await close();
  const webview = mkdtempSync(resolve('.test-data/native-host-webview-'));
  child = spawn(resolve('src-tauri/target/debug/studyplan.exe'), [], {
    env: {
      ...process.env,
      STUDYPLAN_TEST_DATA_DIR: dataDir,
      STUDYPLAN_LAN_TEST_ADDRESS: '127.0.0.1',
      STUDYPLAN_LAN_TEST_PORT: '4186',
      WEBVIEW2_USER_DATA_FOLDER: webview,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9225',
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.resume();
  child.stderr?.resume();
  let failure = '';
  child.on('error', (error) => {
    failure = String(error);
  });
  for (let i = 0; i < 60; i++) {
    if (failure || child.exitCode !== null)
      throw new Error(`隔離アプリを起動できません: ${failure}`);
    try {
      nativeBrowser = await chromium.connectOverCDP('http://127.0.0.1:9225');
      break;
    } catch {
      await new Promise((done) => setTimeout(done, 500));
    }
  }
  if (!nativeBrowser) throw new Error('隔離WebView2へ接続できません。');
  for (let i = 0; i < 60; i++) {
    page = nativeBrowser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => !candidate.url().startsWith('devtools:'))!;
    if (page && page.url() !== 'about:blank') break;
    await new Promise((done) => setTimeout(done, 250));
  }
  page.setDefaultTimeout(10000);
  await expect(page.getByRole('heading', { name: '今日', exact: true })).toBeVisible({
    timeout: 30000,
  });
}
async function seed(data: AppState) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await invoke<Envelope | null>('load_state');
    try {
      await invoke('commit_state', {
        data,
        expected: current?.revision ?? 0,
        requestId: 'embedded-host-seed',
      });
      await page.reload();
      await expect(page.locator('.save-status')).toContainText('保存済み');
      return;
    } catch (error) {
      if (!String(error).includes('別の操作でデータが更新') || attempt === 4) throw error;
    }
  }
}
async function api<T>(
  request: APIRequestContext,
  key: string,
  method: string,
  data = {},
): Promise<T> {
  const response = await request.post(`${base}api/${method}`, {
    headers: { Origin: origin, Authorization: `Bearer ${key}` },
    data,
  });
  expect(response.status()).toBe(200);
  return (await response.json()).value as T;
}
const book = (target: Page) =>
  target.locator('.daily-record-row').filter({ hasText: '対象問題集' });
async function normalClose() {
  const ended = new Promise<void>((done, reject) => {
    const timer = setTimeout(() => reject(new Error('LAN公開中の通常終了が完了しません。')), 15000);
    child!.once('exit', () => {
      clearTimeout(timer);
      done();
    });
  });
  await invoke('plugin:window|close', { label: 'main' }).catch(() => {});
  await ended;
  await nativeBrowser?.close().catch(() => {});
  nativeBrowser = undefined;
  child = undefined;
}
test.afterAll(close);

test('実機：LAN候補をInterfaceAliasとIPv4で選択し、再確認でも選択を保持する', async ({ request }, testInfo) => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/native-lan-candidates-'));
  await launch();
  try {
    // Discovery supplies priority order and has already removed APIPA addresses.
    // Only LAN IPC is mocked; starting these fixtures never binds a real interface.
    const candidates: DesktopLanAddress[] = [
      { address: '133.26.237.171', interface_alias: 'Wi-Fi 2' },
      { address: '172.28.224.1', interface_alias: 'vEthernet (WSL (Hyper-V firewall))' },
      { address: '100.101.102.103', interface_alias: 'Tailscale' },
      { address: '10.20.30.40', interface_alias: 'Fortinet VPN' },
    ];
    expect((await invoke<HostStatus>('lan_host_status')).active).toBe(false);
    await page.evaluate((addresses) => {
      const target = window as unknown as CandidateTestWindow;
      const nativeInvoke = target.__TAURI_INTERNALS__.invoke;
      const nativeFetch = window.fetch.bind(window);
      let readingNativeStatus = false;
      const state: CandidateTestWindow['lanCandidateTest'] = {
        calls: [],
        addresses,
        nativeStatus: async () => {
          readingNativeStatus = true;
          try { return await nativeInvoke('lan_host_status'); }
          finally { readingNativeStatus = false; }
        },
      };
      target.lanCandidateTest = state;
      let selected: string | null = null;
      // Tauri's invoke property is read-only. Intercept its LAN transport in this
      // isolated WebView without changing native permissions or the IPC implementation.
      window.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        const name = decodeURIComponent(url.pathname.slice(1));
        if (url.hostname !== 'ipc.localhost' || !name.startsWith('lan_') ||
          (readingNativeStatus && name === 'lan_host_status')) return nativeFetch(input, init);
        const args = JSON.parse(String(init?.body ?? '{}')) as { address?: string };
        state.calls.push({ name, args });
        if (name === 'lan_host_start') selected = args.address ?? null;
        else if (name === 'lan_host_stop') selected = null;
        else if (name !== 'lan_host_status') return new Response(JSON.stringify(`Unexpected LAN command: ${name}`), {
          headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'error' },
        });
        const status: HostStatus = {
          active: selected !== null,
          addresses: state.addresses,
          address: selected,
          url: selected ? `http://${selected}:4178/studyplan-lan/` : null,
          key: selected ? '0'.repeat(64) : null,
        };
        return new Response(JSON.stringify(status), {
          headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' },
        });
      };
    }, candidates);
    await invoke('plugin:window|set_size', { label: 'main', value: { Logical: { width: 1280, height: 800 } } });
    await page.locator('.sidebar nav').getByRole('button', { name: '設定', exact: true }).click();
    const summary = page.locator('.lan-sharing > summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    const panel = page.locator('.lan-sharing');
    const choices = page.getByRole('combobox', { name: '使用するLANアドレス', exact: true });
    const selection = panel.locator('output.lan-sharing-selection');
    const start = page.getByRole('button', { name: 'LANに公開', exact: true });
    const refresh = page.getByRole('button', { name: '状態を再確認', exact: true });
    await expect(choices.locator('option')).toHaveText([
      '選択してください',
      'Wi-Fi 2 — 133.26.237.171',
      'vEthernet (WSL (Hyper-V firewall)) — 172.28.224.1',
      'Tailscale — 100.101.102.103',
      'Fortinet VPN — 10.20.30.40',
    ]);
    await expect(choices).toHaveValue('');
    await start.click();
    await expect(choices).toBeFocused();
    await expect(choices).toHaveAttribute('aria-invalid', 'true');
    await expect(panel.getByRole('alert')).toContainText('使用するLANアドレスを選んでください');
    await page.keyboard.press('ArrowDown');
    await expect(choices).toHaveValue('133.26.237.171');
    await refresh.click();
    await expect(choices).toHaveValue('133.26.237.171');
    await expect(selection).toBeHidden();
    await panel.screenshot({ path: testInfo.outputPath('lan-candidates-wide.png') });
    await choices.focus();
    await page.keyboard.press('End');
    await expect(choices).toHaveValue('10.20.30.40');
    await start.focus();
    await page.keyboard.press('Enter');
    await expect(panel).toContainText('LAN公開先：Fortinet VPN — 10.20.30.40');
    await page.getByRole('button', { name: '公開を停止', exact: true }).click();
    await expect(choices).toHaveValue('10.20.30.40');
    await choices.selectOption('172.28.224.1');
    await invoke('plugin:window|set_size', { label: 'main', value: { Logical: { width: 390, height: 844 } } });
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(600);
    await refresh.click();
    await expect(choices).toHaveValue('172.28.224.1');
    await expect(selection).toBeVisible();
    await expect(selection).toHaveAccessibleName('選択中のLAN公開先');
    await expect(selection).toHaveText('vEthernet (WSL (Hyper-V firewall)) — 172.28.224.1');
    expect(await selection.evaluate((element) => getComputedStyle(element).fontSize)).toBe(
      await choices.evaluate((element) => getComputedStyle(element).fontSize),
    );
    expect(await selection.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await panel.screenshot({ path: testInfo.outputPath('lan-candidates-narrow.png') });
    expect((await new AxeBuilder({ page }).include('.lan-sharing').analyze()).violations).toEqual([]);
    // A removed adapter must not remain selected or be silently replaced by another NIC.
    await page.evaluate(() => {
      const state = (window as unknown as CandidateTestWindow).lanCandidateTest;
      state.addresses = state.addresses.filter((candidate) => candidate.address !== '172.28.224.1');
    });
    await refresh.click();
    await expect(choices).toHaveValue('');
    await expect(selection).toHaveCount(0);
    const result = await page.evaluate(async () => {
      const state = (window as unknown as CandidateTestWindow).lanCandidateTest;
      return { calls: state.calls, native: await state.nativeStatus() };
    });
    expect(result.calls.filter((call) => call.name === 'lan_host_start')).toEqual([
      { name: 'lan_host_start', args: { address: '10.20.30.40' } },
    ]);
    expect(result.calls.some((call) => call.name === 'lan_network_names')).toBe(false);
    expect(result.native).toMatchObject({ active: false, key: null });
    await expect(request.get(base, { timeout: 3000 })).rejects.toThrow();
  } finally {
    await close();
  }
});

test('実機：設定からLAN公開・キー確認・共有保存・安全な停止を完了できる', async ({
  request,
}, testInfo) => {
  mkdirSync('.test-data', { recursive: true });
  dataDir = mkdtempSync(resolve('.test-data/native-embedded-lan-'));
  await launch();
  await seed(adjustmentFixture(today()));
  await invoke('plugin:window|set_size', {
    label: 'main',
    value: { Logical: { width: 1280, height: 800 } },
  });
  const statusBefore = await invoke<HostStatus>('lan_host_status');
  expect(statusBefore.active).toBe(false);
  expect(statusBefore.key).toBeNull();
  await page.locator('.sidebar nav').getByRole('button', { name: '設定', exact: true }).click();
  await page.locator('.lan-sharing > summary').click();
  await expect(page.locator('.lan-sharing')).toContainText('Test LAN — 127.0.0.1');

  // The UI is the only start/stop entry here; native invocation is read-only.
  const start = page.getByRole('button', { name: 'LANに公開', exact: true });
  await expect(start).toBeVisible();
  const occupied = createServer((_request, response) => {
    response.end('isolated-existing-service');
  });
  await new Promise<void>((done, reject) => {
    occupied.once('error', reject);
    occupied.listen(4186, '127.0.0.1', done);
  });
  try {
    await start.click();
    await expect(page.locator('.lan-sharing [role="alert"]')).toContainText('4186番ポート');
    expect((await invoke<HostStatus>('lan_host_status')).active).toBe(false);
    expect(await (await request.get(base)).text()).toBe('isolated-existing-service');
    await expect(page.getByRole('button', { name: '公開を停止', exact: true })).toHaveCount(0);
  } finally {
    await new Promise<void>((done, reject) =>
      occupied.close((error) => (error ? reject(error) : done())),
    );
  }
  await start.focus();
  await expect(start).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '公開を停止', exact: true })).toBeVisible();
  const first = await invoke<HostStatus>('lan_host_status');
  expect(first.active).toBe(true);
  expect(first.url).toBe(base);
  expect(first.key).toMatch(/^[a-f0-9]{64}$/);
  const key = first.key!;
  const qr = page.getByRole('img', { name: 'LAN接続用QRコード' });
  const readQr = async () => {
    await qr.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    const png = PNG.sync.read(await qr.screenshot({ path: testInfo.outputPath('qr-code.png') }));
    return jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data;
  };
  await expect(qr).toBeVisible();
  expect(await readQr()).toBe(`${base}#key=${key}`);
  await page.screenshot({ path: testInfo.outputPath('lan-qr-wide.png') });
  await invoke('plugin:window|set_size', { label: 'main', value: { Logical: { width: 390, height: 844 } } });
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(600);
  expect(await readQr()).toBe(`${base}#key=${key}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('lan-qr-narrow.png') });
  await invoke('plugin:window|set_size', { label: 'main', value: { Logical: { width: 1280, height: 800 } } });
  await expect(page.getByLabel('接続先URL', { exact: true })).toHaveValue(base);
  await expect(page.getByLabel('APIキー', { exact: true })).toHaveValue(key);
  await expect(page.locator('#lan-sharing-key-warning')).toContainText(
    '学習データを閲覧・変更できます',
  );
  await expect(page.locator('#lan-sharing-warning')).toContainText('HTTP通信は暗号化されません');
  await expect(page.getByLabel('APIキー', { exact: true })).toHaveAttribute('readonly', '');
  // Capture copy payload in this isolated WebView; never overwrite the user's OS clipboard.
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async (text: string) => {
        (window as unknown as { copied: string }).copied = text;
      },
    });
  });
  await page.getByRole('button', { name: '接続リンクをコピー', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe(
    `${base}#key=${key}`,
  );
  await expect(page.locator('.lan-sharing-copy-result')).toContainText(
    '接続リンクをコピーしました',
  );
  await page.getByRole('button', { name: 'APIキーをコピー', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe(key);
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async () => {
        throw new Error('isolated clipboard denied');
      },
    });
  });
  await page.getByRole('button', { name: '接続リンクをコピー', exact: true }).click();
  const manualLink = page.getByLabel('手動コピー用の接続リンク', { exact: true });
  await expect(manualLink).toHaveValue(`${base}#key=${key}`);
  await expect(manualLink).toBeFocused();
  expect(
    await manualLink.evaluate(
      (element: HTMLTextAreaElement) => element.selectionEnd - element.selectionStart,
    ),
  ).toBe(`${base}#key=${key}`.length);

  const missingKey = await request.post(`${base}api/revision`, {
    headers: { Origin: origin },
    data: {},
  });
  expect(missingKey.status()).toBe(401);
  const missingOrigin = await request.post(`${base}api/revision`, {
    headers: { Authorization: `Bearer ${key}` },
    data: {},
  });
  expect(missingOrigin.status()).toBe(403);
  const foreignPage = await request.post(`${base}api/revision`, {
    headers: { Origin: 'http://untrusted.example', Authorization: `Bearer ${key}` },
    data: {},
  });
  expect(foreignPage.status()).toBe(403);
  for (const path of [
    'studyplan.sqlite3',
    'src/main.tsx',
    '.test-data/private',
    'release-files.json/secret',
  ])
    expect((await request.get(`${base}${path}`)).status()).toBe(404);
  const malformed = await request.post(`${base}api/revision`, {
    headers: { Origin: origin, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    data: '{bad',
  });
  expect(malformed.status()).toBe(400);

  const client = await chromium.launch({ channel: 'chrome' });
  const phoneContext = await client.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await phoneContext.newPage();
  try {
    await page.screenshot({
      path: testInfo.outputPath('desktop-lan-settings.png'),
      fullPage: true,
    });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await phone.goto(`${base}#key=${key}`);
    await expect(book(phone)).toBeVisible();
    expect(new URL(phone.url()).hash).toBe('');
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.locator('.sidebar nav').getByRole('button', { name: '今日', exact: true }).click();
    await book(page).getByRole('textbox').fill('2');
    await book(phone).getByRole('textbox').fill('4');
    await book(phone).getByRole('button', { name: '記録', exact: true }).click();
    await expect(phone.locator('.save-status')).toContainText('Windowsに保存済み');
    expect(
      (await invoke<Envelope>('load_state')).data.records.reduce(
        (n, record) => n + record.count,
        0,
      ),
    ).toBe(4);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('button', { name: '最新を読み込む', exact: true })).toBeVisible();
    await expect(book(page).getByRole('textbox')).toHaveValue('2');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '最新を読み込む', exact: true }).click();
    await expect(book(page)).toContainText('あと2問');
    await page.screenshot({ path: testInfo.outputPath('desktop-reload-notice.png') });
    await book(page).getByRole('textbox').fill('2');
    await book(page).getByRole('button', { name: '記録', exact: true }).click();
    await expect(page.locator('.save-status')).toContainText('保存済み');
    await phone.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(phone.getByRole('button', { name: '最新を読み込む', exact: true })).toBeVisible();
    phone.once('dialog', (dialog) => dialog.accept());
    await phone.getByRole('button', { name: '最新を読み込む', exact: true }).click();
    await expect(book(phone)).toContainText('✅完了');
    const shared = await api<Envelope>(request, key, 'load_state');
    expect(shared.data.records.reduce((n, record) => n + record.count, 0)).toBe(6);
    expect(
      activePlanWork(shared.data, today())
        .filter((session) => session.materialId === 'book' && session.round === 0)
        .reduce((n, session) => n + session.count, 0),
    ).toBe(24);
    await phone.screenshot({ path: testInfo.outputPath('phone-lan-recorded.png') });
    await phone.locator('.page-transition').evaluateAll(elements =>
      Promise.allSettled(elements.flatMap(element => element.getAnimations().map(animation => animation.finished))));
    expect((await new AxeBuilder({ page: phone }).analyze()).violations).toEqual([]);
    const dismissNotice = phone
      .locator('.error-banner')
      .getByRole('button', { name: '閉じる', exact: true });
    await dismissNotice.focus();
    await phone.keyboard.press('Enter');
    await expect(phone.locator('.error-banner')).toHaveCount(0);
    await expect(book(phone)).toContainText('✅完了');
    expect(await api<Envelope>(request, key, 'load_state')).toEqual(shared);

    // Store CAS/replay are exercised through the embedded server, not the CLI host.
    const operation = {
      data: { ...shared.data, theme: 'sky' },
      expected: shared.revision,
      requestId: 'embedded-cas-success',
    };
    const written = await api<Envelope>(request, key, 'commit_state', operation);
    const replayed = await api<Envelope>(request, key, 'commit_state', operation);
    expect(replayed).toEqual(written);
    const conflict = await request.post(`${base}api/commit_state`, {
      headers: { Origin: origin, Authorization: `Bearer ${key}` },
      data: {
        ...operation,
        data: { ...shared.data, theme: 'lime' },
        requestId: 'embedded-cas-stale',
      },
    });
    expect(conflict.status()).toBe(409);
    expect(await api<Envelope>(request, key, 'load_state')).toEqual(written);
    expect(
      JSON.stringify((await api<{ data: AppState }>(request, key, 'export_backup')).data),
    ).not.toContain(key);

    await page.locator('.sidebar nav').getByRole('button', { name: '設定', exact: true }).click();
    await page.locator('.lan-sharing > summary').click();
    expect(await readQr()).toBe(`${base}#key=${key}`);
    await page.getByRole('button', { name: '公開を停止', exact: true }).click();
    await expect(start).toBeVisible();
    await expect(qr).toHaveCount(0);
    const stopped = await invoke<HostStatus>('lan_host_status');
    expect(stopped.active).toBe(false);
    expect(stopped.key).toBeNull();
    await expect(request.get(base, { timeout: 3000 })).rejects.toThrow();
    await start.click();
    await expect(page.getByRole('button', { name: '公開を停止', exact: true })).toBeVisible();
    const second = await invoke<HostStatus>('lan_host_status');
    expect(second.key).not.toBe(key);
    expect(await readQr()).toBe(`${base}#key=${second.key}`);
    const expired = await request.post(`${base}api/revision`, {
      headers: { Origin: origin, Authorization: `Bearer ${key}` },
      data: {},
    });
    expect(expired.status()).toBe(401);
    expect(await api<Envelope>(request, second.key!, 'load_state')).toEqual(written);
    await normalClose();
    await expect(request.get(base, { timeout: 3000 })).rejects.toThrow();
    await launch();
    expect((await invoke<HostStatus>('lan_host_status')).active).toBe(false);
    expect((await invoke<Envelope>('load_state')).data.records).toEqual(written.data.records);
  } finally {
    await client.close();
  }
});
