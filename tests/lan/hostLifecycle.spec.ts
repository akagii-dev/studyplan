import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
// @ts-expect-error The Node host is an ESM script, verified by lanHost.test.mjs.
import { createLanHost } from '../../scripts/lan-host.mjs';

test('dedicated host starts, reports its identity and stops only its own process', async () => {
  test.skip(test.info().project.name !== 'wide', 'The host lifecycle runs once per build.');
  const root = path.resolve('.');
  const testRoot = path.join(root, '.test-data');
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(path.join(testRoot, 'lan-host-lifecycle-'));
  const database = path.join(directory, 'studyplan.sqlite3');
  const stateFile = path.join(directory, 'state.json');
  const connection = new DatabaseSync(database);
  try {
    connection.exec('CREATE TABLE state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)))');
    connection.prepare('INSERT INTO state VALUES(1,1,?)').run(await readFile(path.join(root, 'src/domain/initialState.json'), 'utf8'));
  } finally { connection.close(); }

  const host = createLanHost({ root, address: '127.0.0.1', port: 4192, controlPort: 4193,
    database, executable: path.join(root, 'src-tauri/target/debug/studyplan_lan_bridge.exe'),
    stateDirectory: directory });
  let originalState = '';
  try {
    const started = await host.start();
    expect(started.active).toBe(true);
    expect(started.url).toMatch(/^http:\/\/127\.0\.0\.1:4192\/studyplan-lan\/#key=[a-f0-9]{64}$/);
    expect((await host.status()).active).toBe(true);
    const page = await fetch(started.url.split('#')[0]);
    expect(page.status).toBe(200);
    const key = started.url.split('#key=')[1];
    const revision = await fetch('http://127.0.0.1:4192/studyplan-lan/api/revision', {
      method: 'POST', headers: { Origin: 'http://127.0.0.1:4192', Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json' }, body: '{}',
    });
    expect(revision.status).toBe(200);
    expect(await revision.json()).toEqual({ ok: true, value: 1 });

    originalState = await readFile(stateFile, 'utf8');
    const wrongIdentity = { ...JSON.parse(originalState), startId: randomUUID().replaceAll('-', '') };
    await writeFile(stateFile, JSON.stringify(wrongIdentity));
    await expect(host.stop()).rejects.toThrow('管理するLAN配信');
    expect((await host.status()).active).toBe(false);
    await writeFile(stateFile, originalState);
    expect((await host.status()).active).toBe(true);
    expect((await host.stop()).active).toBe(false);
    await expect.poll(async () => (await host.status()).active).toBe(false);
  } finally {
    if (originalState) await writeFile(stateFile, originalState);
    let stopped = false;
    try {
      if ((await host.status()).active) await host.stop();
      stopped = true;
    } catch { /* Keep an active host's files for safe diagnosis. */ }
    const relative = path.relative(testRoot, directory);
    if (stopped && relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      try { await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
      catch { /* Do not hide the actual host failure with a transient SQLite file lock. */ }
    }
  }
});
