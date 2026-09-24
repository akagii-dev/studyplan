import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

// The distribution command is JavaScript so it also runs without a TypeScript loader.
// @ts-expect-error The standalone CLI intentionally has no declaration file.
import { createHost, createHttpHost, inspectServeConfig, selectLanAddress, serveHttpFile, stageRelease, validateReleaseManifest } from '../scripts/pwa-host.mjs';

const base = path.resolve('.test-data', 'pwa-host-tests');
const roots: string[] = [];
const dns = 'study-machine.example.ts.net';
const buildId = '0123456789abcdef0123456789abcdef';

async function fixture() {
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'case-'));
  roots.push(root);
  const dist = path.join(root, 'dist-pwa');
  await fs.mkdir(dist);
  const contents: Record<string, string> = {
    'index.html': '<html><script src="/studyplan-pwa/assets/app-Abc_12345.js"></script></html>',
    'manifest.webmanifest': '{"start_url":"/studyplan-pwa/"}',
    'sw.js': 'self.addEventListener("fetch", () => {})',
    'assets/app-Abc_12345.js': 'console.log("ready")',
  };
  const files = [];
  for (const [name, content] of Object.entries(contents)) {
    const file = path.join(dist, ...name.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
    files.push({ path: name, sha256: createHash('sha256').update(content).digest('hex') });
  }
  await fs.writeFile(path.join(dist, 'release-files.json'), JSON.stringify({ format: 'StudyPlanPwaRelease', version: 1, base: '/studyplan-pwa/', buildId, files }));
  await fs.writeFile(path.join(dist, 'private.db'), 'must not be served');
  return { root, dist };
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(`${base}${path.sep}`)) throw new Error('test cleanup escaped its root');
    await fs.rm(root, { recursive: true, force: true });
  }
});

function mockTailscale() {
  const config: { Web: Record<string, { Handlers: Record<string, { Path: string }> }>; AllowFunnel?: Record<string, boolean> } = {
    Web: { [`${dns}:443`]: { Handlers: { '/other/': { Path: 'C:\\other-app' } } } },
  };
  const calls: string[][] = [];
  let currentDns = dns;
  const run = (args: string[]) => {
    calls.push(args);
    if (args[0] === 'status') return JSON.stringify({ BackendState: 'Running', Self: { DNSName: `${currentDns}.` } });
    if (args[0] === 'serve' && args[1] === 'status') return JSON.stringify(config);
    if (args[0] === 'serve' && args.at(-1) === 'off') {
      delete config.Web[`${dns}:8443`].Handlers['/studyplan-pwa/'];
      return '';
    }
    if (args[0] === 'serve') {
      config.Web[`${dns}:8443`] ??= { Handlers: {} };
      config.Web[`${dns}:8443`].Handlers['/studyplan-pwa/'] = { Path: args.at(-1)! };
      return '';
    }
    throw new Error(`unexpected command: ${args.join(' ')}`);
  };
  return { config, calls, run, changeDns: (value: string) => { currentDns = value; } };
}

test('manifest rejects traversal, database files, and duplicate paths', () => {
  const file = (name: string) => ({ path: name, sha256: 'a'.repeat(64) });
  const raw = { format: 'StudyPlanPwaRelease', version: 1, base: '/studyplan-pwa/', buildId, files: [file('index.html'), file('manifest.webmanifest'), file('sw.js')] };
  expect(() => validateReleaseManifest(raw)).not.toThrow();
  expect(() => validateReleaseManifest({ ...raw, files: [...raw.files, file('../secret.txt')] })).toThrow();
  expect(() => validateReleaseManifest({ ...raw, files: [...raw.files, file('backup/data.db')] })).toThrow();
  expect(() => validateReleaseManifest({ ...raw, files: [...raw.files, file('studyplan.json')] })).toThrow();
  expect(() => validateReleaseManifest({ ...raw, files: [...raw.files, file('INDEX.HTML')] })).toThrow();
});

test('staging verifies hashes and excludes unlisted files', async () => {
  const { root, dist } = await fixture();
  const stateDir = path.join(root, '.test-data', 'pwa-host');
  const staged = await stageRelease(dist, stateDir);
  expect(await fs.readFile(path.join(staged.staged, 'index.html'), 'utf8')).toContain('app-Abc_12345.js');
  await expect(fs.access(path.join(staged.staged, 'private.db'))).rejects.toThrow();
  expect(JSON.parse(await fs.readFile(path.join(staged.staged, 'release-files.json'), 'utf8')).files).toHaveLength(4);
  await fs.writeFile(path.join(dist, 'sw.js'), 'tampered');
  await expect(stageRelease(dist, stateDir)).rejects.toThrow('ハッシュ');
});

test('staging refuses a linked assets directory', async () => {
  const { root, dist } = await fixture();
  const external = path.join(root, 'external-assets');
  await fs.rename(path.join(dist, 'assets'), external);
  await fs.symlink(external, path.join(dist, 'assets'), process.platform === 'win32' ? 'junction' : 'dir');
  await expect(stageRelease(dist, path.join(root, '.test-data', 'pwa-host'))).rejects.toThrow('シンボリックリンク');
});

test('start, update, and stop touch only the owned route', async () => {
  const { root } = await fixture();
  const ts = mockTailscale();
  const host = createHost({ root, run: ts.run });
  const first = await host.start();
  expect(first.url).toBe(`https://${dns}:8443/studyplan-pwa/`);
  expect(ts.config.Web[`${dns}:443`].Handlers['/other/'].Path).toBe('C:\\other-app');
  expect(ts.calls.some((args) => args.includes('--https=8443'))).toBe(true);
  expect(await fs.readdir(path.join(root, '.test-data', 'pwa-host', 'releases'))).toHaveLength(1);
  const second = await host.start();
  expect(second.url).toBe(first.url);
  expect(ts.config.Web[`${dns}:8443`].Handlers['/studyplan-pwa/'].Path).not.toBe(ts.calls.find((args) => args.includes('--bg'))?.at(-1));
  expect((await host.status()).active).toBe(true);
  await host.stop();
  expect(ts.config.Web[`${dns}:443`].Handlers['/other/']).toBeDefined();
  expect(ts.config.Web[`${dns}:8443`].Handlers['/studyplan-pwa/']).toBeUndefined();
  expect(ts.calls.some((args) => args.includes('reset') || args[0] === 'funnel')).toBe(false);
});

test('collision, Funnel, hijack, and DNS change refuse mutation', async () => {
  const { root } = await fixture();
  const ts = mockTailscale();
  const host = createHost({ root, run: ts.run });
  ts.config.Web[`${dns}:8443`] = { Handlers: { '/studyplan-pwa/': { Path: 'C:\\foreign' } } };
  await expect(host.start()).rejects.toThrow('このスクリプトの配信');
  expect(ts.calls.filter((args) => args[0] === 'serve' && args[1] !== 'status')).toHaveLength(0);
  delete ts.config.Web[`${dns}:8443`].Handlers['/studyplan-pwa/'];
  ts.config.AllowFunnel = { [`${dns}:8443`]: true };
  await expect(host.start()).rejects.toThrow('Funnel');
  delete ts.config.AllowFunnel;
  await host.start();
  ts.config.Web[`${dns}:8443`].Handlers['/studyplan-pwa/'] = { Path: 'C:\\hijacked' };
  await expect(host.stop()).rejects.toThrow('このスクリプトの配信');
  ts.config.Web[`${dns}:8443`].Handlers['/studyplan-pwa/'] = { Path: JSON.parse(await fs.readFile(path.join(root, '.test-data', 'pwa-host', 'state.json'), 'utf8')).target };
  ts.changeDns('renamed.example.ts.net');
  await expect(host.start()).rejects.toThrow('DNSName');
});

test('any existing 8443 mount and non-HTTPS 8443 are rejected', () => {
  expect(() => inspectServeConfig({ Web: { [`${dns}:8443`]: { Handlers: { '/other/': { Path: 'C:\\other' } } } } }, dns)).toThrow('専用');
  expect(() => inspectServeConfig({ TCP: { '8443': { TCPForward: '127.0.0.1:9000' } } }, dns)).toThrow('HTTPS');
  expect(() => inspectServeConfig({ AllowFunnel: { [`${dns}:443`]: true } }, dns)).not.toThrow();
});

test('HTTP serves only verified release files, with suitable cache headers', async () => {
  const { root, dist } = await fixture();
  const stateDir = path.join(root, '.test-data', 'pwa-host');
  const { manifest, staged } = await stageRelease(dist, stateDir);
  const token = 'a'.repeat(64);
  const startId = 'b'.repeat(32);
  const stateFile = path.join(stateDir, 'http-state.json');
  await fs.writeFile(stateFile, JSON.stringify({ owner: 'StudyPlanPwaHttpV1', lanIp: '192.168.1.20', target: staged, manifest, token, startId, pid: 123 }));
  const server = http.createServer((request, response) => { void serveHttpFile(request, response, stateFile, { token, startId }); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test port');
    const origin = `http://127.0.0.1:${address.port}`;
    const index = await fetch(`${origin}/studyplan-pwa/`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toContain('text/html');
    expect(index.headers.get('cache-control')).toContain('no-store');
    expect(await index.text()).toContain('app-Abc_12345.js');
    expect((await fetch(`${origin}/studyplan-pwa/assets/app-Abc_12345.js`)).headers.get('cache-control')).toContain('immutable');
    expect((await fetch(`${origin}/studyplan-pwa/sw.js`)).headers.get('cache-control')).toContain('no-store');
    expect((await fetch(`${origin}/studyplan-pwa/private.db`)).status).toBe(404);
    const release = await fetch(`${origin}/studyplan-pwa/release-files.json`);
    expect(release.status).toBe(200);
    expect(release.headers.get('cache-control')).toContain('no-store');
    expect((await release.json()).format).toBe('StudyPlanPwaRelease');
    expect((await fetch(`${origin}/studyplan-pwa/assets/`)).status).toBe(404);
    expect((await fetch(`${origin}/studyplan-pwa/`, { method: 'POST' })).status).toBe(405);
    await fs.writeFile(path.join(staged, 'sw.js'), 'tampered');
    expect((await fetch(`${origin}/studyplan-pwa/sw.js`)).status).toBe(503);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP host fixes LAN origin and controls only its own worker', async () => {
  const { root } = await fixture();
  let address = '192.168.1.20';
  const seen: string[] = [];
  let launches = 0;
  const host = createHttpHost({
    root,
    interfaces: () => ({ WiFi: [{ family: 'IPv4', address, internal: false }] }),
    launch: () => { launches += 1; return 4321; },
    request: async (url: string, options: { headers: { Authorization: string } }) => {
      seen.push(url);
      const state = JSON.parse(await fs.readFile(path.join(root, '.test-data', 'pwa-host', 'http-state.json'), 'utf8'));
      expect(options.headers.Authorization).toBe(`Bearer ${state.token}`);
      return { ok: true, json: async () => ({ pid: state.pid, startId: state.startId }) };
    },
  });
  expect((await host.start()).url).toBe('http://192.168.1.20:4178/studyplan-pwa/');
  expect((await host.start()).url).toBe('http://192.168.1.20:4178/studyplan-pwa/');
  expect(launches).toBe(1);
  expect((await host.status()).active).toBe(true);
  await host.stop();
  expect(seen.every((url) => url.startsWith('http://127.0.0.1:4179/'))).toBe(true);
  address = '192.168.1.21';
  await expect(host.start()).rejects.toThrow('LANアドレス');
});

test('LAN address selection rejects ambiguity and non-local requests', () => {
  const network = { WiFi: [{ family: 'IPv4', address: '192.168.1.20', internal: false }], Ethernet: [{ family: 'IPv4', address: '10.0.0.2', internal: false }] };
  expect(() => selectLanAddress(network)).toThrow('確定');
  expect(selectLanAddress(network, '10.0.0.2')).toBe('10.0.0.2');
  expect(() => selectLanAddress(network, '203.0.113.1')).toThrow('LAN');
});

test('HTTP update retains verified hashed assets for an already open tab', async () => {
  const { root, dist } = await fixture();
  const stateFile = path.join(root, '.test-data', 'pwa-host', 'http-state.json');
  let launches = 0;
  const host = createHttpHost({
    root,
    interfaces: () => ({ WiFi: [{ family: 'IPv4', address: '192.168.1.20', internal: false }] }),
    launch: () => { launches += 1; return 4321; },
    request: async () => {
      const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
      return { ok: true, json: async () => ({ pid: state.pid, startId: state.startId }) };
    },
  });
  await host.start();
  const old = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  const oldAsset = 'assets/app-Abc_12345.js';
  const newAsset = 'assets/app-Def_67890.js';
  await fs.rename(path.join(dist, ...oldAsset.split('/')), path.join(dist, ...newAsset.split('/')));
  const nextIndex = '<html><script src="/studyplan-pwa/assets/app-Def_67890.js"></script></html>';
  await fs.writeFile(path.join(dist, 'index.html'), nextIndex);
  const manifestPath = path.join(dist, 'release-files.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.buildId = '1'.repeat(32);
  manifest.files.find((file: { path: string }) => file.path === oldAsset).path = newAsset;
  manifest.files.find((file: { path: string }) => file.path === 'index.html').sha256 = createHash('sha256').update(nextIndex).digest('hex');
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  await host.start();
  expect(launches).toBe(1);
  const updated = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  expect(updated.retainedAssets).toContainEqual({ path: oldAsset, sha256: old.manifest.files.find((file: { path: string }) => file.path === oldAsset).sha256, target: old.target });
  const server = http.createServer((request, response) => { void serveHttpFile(request, response, stateFile, { token: updated.token, startId: updated.startId }); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test port');
    const origin = `http://127.0.0.1:${address.port}/studyplan-pwa/`;
    expect((await fetch(`${origin}${oldAsset}`)).status).toBe(200);
    expect((await fetch(`${origin}${newAsset}`)).status).toBe(200);
    await fs.writeFile(path.join(old.target, ...oldAsset.split('/')), 'tampered');
    expect((await fetch(`${origin}${oldAsset}`)).status).toBe(503);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
