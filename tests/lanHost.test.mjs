import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { BASE, createRequestHandler, stageRelease, validateManifest, selectLanAddress } from '../scripts/lan-host.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function temporary(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studyplan-lan-host-'));
  try { return await callback(root); }
  finally {
    const relative = path.relative(os.tmpdir(), root);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    await fs.rm(root, { recursive: true, force: true });
  }
}
async function release(root) {
  const source = path.join(root, 'dist-lan');
  await fs.mkdir(path.join(source, 'assets'), { recursive: true });
  const files = [
    { path: 'index.html', bytes: Buffer.from('<!doctype html><title>StudyPlan</title>') },
    { path: 'assets/app-abcdefgh.js', bytes: Buffer.from('export const ok = true;') },
  ];
  for (const item of files) await fs.writeFile(path.join(source, ...item.path.split('/')), item.bytes);
  const manifest = { format: 'StudyPlanLanRelease', version: 1, base: BASE,
    buildId: 'a'.repeat(32), files: files.map((item) => ({ path: item.path, sha256: sha(item.bytes) })) };
  await fs.writeFile(path.join(source, 'release-files.json'), JSON.stringify(manifest));
  return { source, manifest };
}
function rawRequest(origin, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(origin);
    const request = httpRequest({ hostname: url.hostname, port: url.port, path: pathname,
      method: options.method ?? 'GET', headers: options.headers ?? {} }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end(options.body);
  });
}

test('allowlist and LAN address selection reject unrelated paths and interfaces', async () => {
  const { manifest } = await temporary(release);
  assert.equal(validateManifest(manifest).base, BASE);
  assert.throws(() => validateManifest({ ...manifest, files: [...manifest.files, { path: '../secret', sha256: 'a'.repeat(64) }] }));
  assert.equal(selectLanAddress({ WiFi: [{ family: 'IPv4', address: '192.168.1.7', internal: false }], Tailscale: [{ family: 'IPv4', address: '100.1.1.1', internal: false }] }), '192.168.1.7');
  assert.throws(() => selectLanAddress({ WiFi: [{ family: 'IPv4', address: '192.168.1.7', internal: false }] }, '192.168.1.8'));
});

test('staged files and API require exact Host, Origin and connection key', async () => temporary(async (root) => {
  const { source } = await release(root);
  const stateDirectory = path.join(root, 'state');
  await fs.mkdir(stateDirectory);
  const { manifest, target } = await stageRelease(source, stateDirectory);
  const key = 'a'.repeat(64);
  const stateFile = path.join(stateDirectory, 'state.json');
  let calls = 0;
  const bridge = { call: async (method) => { calls++; assert.equal(method, 'revision'); return 7; } };
  let handler;
  const server = createServer((request, response) => { void handler(request, response); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  handler = createRequestHandler({ address: '127.0.0.1', port, key, stateFile, bridge });
  await fs.writeFile(stateFile, JSON.stringify({ owner: 'StudyPlanLanHostV1', address: '127.0.0.1', port,
    controlPort: 4183, database: 'test.sqlite3', bridge: 'bridge', bridgeSha256: 'b'.repeat(64),
    target, manifest, retainedAssets: [], key, controlToken: 'c'.repeat(64), startId: 'd'.repeat(32), pid: process.pid }));
  try {
    const page = await fetch(`${origin}${BASE}`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /StudyPlan/);
    assert.equal(await rawRequest(origin, BASE, { headers: { Host: 'other.example:4182' } }), 400);
    for (const pathname of [
      `${BASE}.test-data/private`, `${BASE}../src/domain/initialState.json`,
      `${BASE}%2e%2e/studyplan.sqlite3`, `${BASE}studyplan.sqlite3`,
      `${BASE}src/domain/initialState.json`, `${BASE}release-files.json/secret`,
    ]) assert.equal(await rawRequest(origin, pathname), 404, pathname);
    const api = `${origin}${BASE}api/revision`;
    const post = (headers) => fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
    assert.equal((await post({ Origin: origin })).status, 401);
    assert.equal((await post({ Origin: 'http://elsewhere.test', Authorization: `Bearer ${key}` })).status, 403);
    assert.equal(await rawRequest(origin, `${BASE}api/revision`, { method: 'POST',
      headers: { Host: 'wrong.example:4182', Origin: origin, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{}' }), 400);
    assert.equal(await rawRequest(origin, `${BASE}api/not_a_method`, { method: 'POST',
      headers: { Origin: origin, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{}' }), 404);
    assert.equal(await rawRequest(origin, `${BASE}api/revision`, { method: 'POST',
      headers: { Origin: origin, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{bad' }), 422);
    assert.equal(await rawRequest(origin, `${BASE}api/revision`, { method: 'POST',
      headers: { Origin: origin, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Content-Length': 102 * 1024 * 1024 + 1 } }), 413);
    const good = await post({ Origin: origin, Authorization: `Bearer ${key}` });
    assert.equal(good.status, 200);
    assert.deepEqual(await good.json(), { ok: true, value: 7 });
    assert.equal(calls, 1);
    await fs.writeFile(path.join(target, 'index.html'), 'changed');
    assert.equal((await fetch(`${origin}${BASE}`)).status, 503);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}));
