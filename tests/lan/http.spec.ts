import { test, expect } from '@playwright/test';
import { networkInterfaces } from 'node:os';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { adjustmentFixture, adjustmentContext } from '../fixtures/adjustment';

test('実LANのHTTPアドレスでも暗号乱数IDで記録でき、SWやIndexedDBへ学習データを置かない', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'wide', 'Network transport is independent of viewport.');
  const address = Object.entries(networkInterfaces())
    .filter(([name]) => !/tailscale|docker|virtual|vEthernet|loopback/i.test(name))
    .flatMap(([, entries]) => entries ?? [])
    .find((entry) => entry.family === 'IPv4' && !entry.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address))?.address;
  test.skip(!address, 'No private LAN interface is available.');
  await mkdir(resolve('.test-data'), { recursive: true });
  const directory = await mkdtemp(resolve('.test-data/http-lan-'));
  const databasePath = join(directory, 'studyplan.sqlite3');
  const db = new DatabaseSync(databasePath);
  db.exec('CREATE TABLE state (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL)');
  db.prepare('INSERT INTO state VALUES(1,1,?)').run(JSON.stringify(adjustmentFixture()));
  db.close();
  const { createLanServer } = await import(pathToFileURL(resolve('scripts/lan-host.mjs')).href);
  const key = 'c'.repeat(64);
  const server = await createLanServer({ root: resolve('.'), databasePath, bridgePath: resolve('src-tauri/target/debug/studyplan_lan_bridge.exe'), host: address, port: 4194, key, stateDirectory: join(directory, 'host') });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.install({ time: new Date(adjustmentContext.timestamp) });
    await page.goto(`${server.url}#key=${key}`);
    const row = page.locator('.daily-record-row').filter({ hasText: '対象問題集' });
    await expect(row).toBeVisible();
    expect(await page.evaluate(() => isSecureContext)).toBe(false);
    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');
    await row.getByRole('textbox').fill('4');
    await row.getByRole('button', { name: '記録', exact: true }).click();
    await expect(page.locator('.save-status')).toContainText('Windowsに保存済み');
    const response = await request.post(`${server.url}api/load_state`, { headers: { Origin: new URL(server.url).origin, Authorization: `Bearer ${key}` }, data: {} });
    expect(response.ok()).toBe(true);
    const packet = await response.json();
    expect(packet.value.data.records).toHaveLength(1);
    expect(packet.value.data.records[0].count).toBe(4);
    expect(packet.value.data.records[0].id).toMatch(/^[a-f0-9-]{36}$/);
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['studyplan-lan-access-key-v1']);
    expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
    await page.reload();
    await expect(row).toContainText('あと2問');
    await page.screenshot({ path: info.outputPath('http-lan-mobile.png'), fullPage: true });
  } finally { await server.close(); }
});
