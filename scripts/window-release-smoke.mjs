import { chromium, expect } from '@playwright/test';
import { spawn, execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

// Uses the actual release and its normal storage. Only window geometry is changed;
// study data is compared before/after, and original geometry is restored at the end.
const executable = resolve(process.argv[2] ?? 'release/StudyPlan.exe');
mkdirSync('.test-data', { recursive: true });
mkdirSync('test-results', { recursive: true });
let child, browser, page, original, studyBefore;
const results = [];
async function control(action = 'inspect', width = 910, height = 680) {
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
  return JSON.parse(stdout);
}
async function launch() {
  child = spawn(executable, [], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9224',
      WEBVIEW2_USER_DATA_FOLDER: mkdtempSync(resolve('.test-data/geometry-release-')),
    },
    windowsHide: true,
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try {
      browser = await chromium.connectOverCDP('http://127.0.0.1:9224');
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (!browser) throw new Error('Release did not start');
  await expect
    .poll(() => {
      page = browser.contexts().flatMap((c) => c.pages())[0];
      return page?.url();
    })
    .toContain('tauri.localhost');
  await expect(page.getByRole('heading', { name: 'ホーム' })).toBeVisible();
}
async function study() {
  return page.evaluate(() => window.__TAURI_INTERNALS__.invoke('load_state'));
}
async function close() {
  await control('close');
  await expect.poll(() => child.exitCode, { timeout: 15000 }).not.toBeNull();
  await browser.close();
  browser = undefined;
}
async function verify(width, height, maximized = false) {
  const actual = await control();
  expect(actual.maximized).toBe(maximized);
  expect(actual.minimized).toBe(false);
  if (!maximized) expect({ width: actual.width, height: actual.height }).toEqual({ width, height });
  expect(await study()).toEqual(studyBefore);
  results.push(actual);
}
try {
  await launch();
  original = await control();
  studyBefore = await study();
  if (original.maximized) {
    await control('restore');
    original = { ...(await control()), maximized: true };
  }
  await control('resize', 910, 680);
  await close();
  await launch();
  await verify(910, 680);
  await page.screenshot({ path: 'test-results/release-window-restored.png' });
  await control('resize', 820, 610);
  await close();
  await launch();
  await verify(820, 610);
  await control('maximize');
  await close();
  await launch();
  await verify(0, 0, true);
  await page.screenshot({ path: 'test-results/release-window-maximized.png' });
  await control('minimize');
  await close();
  await launch();
  await verify(0, 0, true);
  await control('restore');
  await verify(820, 610);
  await control('minimize');
  await close();
  await launch();
  await verify(820, 610);
  writeFileSync(
    'test-results/release-window-results.json',
    JSON.stringify({ executable, results }, null, 2),
  );
  console.log(
    'Release window checks passed: resize twice, maximize, minimize, normal restore; study data unchanged.',
  );
} finally {
  if (browser && child?.exitCode === null && original) {
    await control('restore');
    await control('resize', original.width, original.height);
    if (original.maximized) await control('maximize');
    await close();
  }
  if (browser) await browser.close();
  if (child?.exitCode === null) child.kill();
}
