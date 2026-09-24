import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = '/studyplan-pwa/';
const MOUNT = BASE;
const HTTPS_PORT = 8443;
const OWNER = 'StudyPlanPwaHostV1';
const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  throw new Error(message);
}

function asObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} の形式が不正です`);
  return value;
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || value.includes('\\') || value.includes('\0')) return false;
  return /^(?:index\.html|manifest\.webmanifest|sw\.js|icon-(?:192|512)\.png|apple-touch-icon\.png|assets\/[a-zA-Z0-9_.-]+-[a-zA-Z0-9_-]{8,}\.(?:js|css))$/.test(value);
}

export function validateReleaseManifest(raw) {
  const manifest = asObject(raw, 'release-files.json');
  if (manifest.format !== 'StudyPlanPwaRelease' || manifest.version !== 1 || manifest.base !== BASE) fail('PWA配信マニフェストの形式またはbaseが一致しません');
  if (typeof manifest.buildId !== 'string' || !/^[a-f0-9]{16,64}$/i.test(manifest.buildId)) fail('buildIdが不正です');
  if (!Array.isArray(manifest.files) || manifest.files.length < 3 || manifest.files.length > 1000) fail('配信ファイル一覧が不正です');
  const seen = new Set();
  for (const item of manifest.files) {
    asObject(item, '配信ファイル');
    if (!safeRelativePath(item.path) || !/^[a-f0-9]{64}$/i.test(item.sha256)) fail(`配信できないファイル: ${String(item.path)}`);
    if (seen.has(item.path.toLowerCase())) fail(`配信ファイルが重複しています: ${item.path}`);
    seen.add(item.path.toLowerCase());
  }
  for (const required of ['index.html', 'manifest.webmanifest', 'sw.js']) {
    if (!seen.has(required)) fail(`必要なPWAファイルがありません: ${required}`);
  }
  return { format: manifest.format, version: manifest.version, base: manifest.base, buildId: manifest.buildId, files: manifest.files.map(({ path: filePath, sha256 }) => ({ path: filePath, sha256 })) };
}

async function assertNoSymlink(file, root) {
  const rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) fail('配信元の範囲外です');
  let current = root;
  if ((await fs.lstat(current)).isSymbolicLink()) fail(`シンボリックリンクは配信できません: ${current}`);
  for (const part of rel.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) fail(`シンボリックリンクは配信できません: ${current}`);
  }
  if (!(await fs.lstat(file)).isFile()) fail(`通常のファイルではありません: ${file}`);
}

async function digest(file) {
  const bytes = await fs.readFile(file);
  return createHash('sha256').update(bytes).digest('hex');
}

async function assertPlainDirectories(...directories) {
  for (const directory of directories) {
    const info = await fs.lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory()) fail(`管理フォルダーにリンクを使用できません: ${directory}`);
  }
}

export async function stageRelease(sourceDir, stateDir) {
  const source = path.resolve(sourceDir);
  const manifestPath = path.join(source, 'release-files.json');
  await assertNoSymlink(manifestPath, source);
  const manifest = validateReleaseManifest(JSON.parse(await fs.readFile(manifestPath, 'utf8')));
  const releases = path.join(stateDir, 'releases');
  await fs.mkdir(releases, { recursive: true });
  await assertPlainDirectories(path.dirname(stateDir), stateDir, releases);
  const staged = await fs.mkdtemp(path.join(releases, `${manifest.buildId.slice(0, 16)}-`));
  for (const item of manifest.files) {
    const from = path.join(source, ...item.path.split('/'));
    await assertNoSymlink(from, source);
    const to = path.join(staged, ...item.path.split('/'));
    await fs.mkdir(path.dirname(to), { recursive: true });
    const bytes = await fs.readFile(from);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual.toLowerCase() !== item.sha256.toLowerCase()) fail(`ハッシュが一致しません: ${item.path}`);
    await fs.writeFile(to, bytes, { flag: 'wx' });
    if ((await digest(to)).toLowerCase() !== item.sha256.toLowerCase()) fail(`複製したファイルの検証に失敗しました: ${item.path}`);
  }
  await fs.writeFile(path.join(staged, 'release-files.json'), JSON.stringify(manifest), { flag: 'wx' });
  return { manifest, staged };
}

function readJson(stdout, label) {
  try { return JSON.parse(stdout); } catch { fail(`${label} を解析できません`); }
}

export function inspectServeConfig(raw, dnsName) {
  const config = raw == null ? {} : asObject(raw, 'Tailscale Serve設定');
  const web = config.Web == null ? {} : asObject(config.Web, 'Web設定');
  const funnel = config.AllowFunnel == null ? {} : asObject(config.AllowFunnel, 'Funnel設定');
  for (const [hostPort, enabled] of Object.entries(funnel)) {
    if (hostPort.endsWith(`:${HTTPS_PORT}`) && enabled === true) fail(`${HTTPS_PORT}番のFunnelが有効です。公開範囲を変えずに停止してください`);
  }
  const tcp = config.TCP == null ? {} : asObject(config.TCP, 'TCP設定');
  if (tcp[String(HTTPS_PORT)] && tcp[String(HTTPS_PORT)].HTTPS !== true) fail(`${HTTPS_PORT}番はHTTPS Serve以外に使用されています`);
  const hostPort = `${dnsName}:${HTTPS_PORT}`;
  const entry = web[hostPort];
  if (entry == null) return { route: null, handlers: {} };
  const handlers = asObject(asObject(entry, 'Webホスト').Handlers, 'Webハンドラー');
  for (const key of Object.keys(handlers)) {
    if (key !== MOUNT) fail(`${HTTPS_PORT}番は専用配信に使用します。既存のServe設定があります: ${key}`);
  }
  return { route: handlers[MOUNT] ?? null, handlers };
}

function dnsFromStatus(raw) {
  const status = asObject(raw, 'Tailscale状態');
  if (status.BackendState !== 'Running') fail('Tailscaleが稼働していません');
  const dns = asObject(status.Self, 'Tailscale端末').DNSName;
  if (typeof dns !== 'string' || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.?$/i.test(dns)) fail('端末のDNSNameを確認できません');
  return dns.replace(/\.$/, '').toLowerCase();
}

function samePath(a, b) {
  return typeof a === 'string' && typeof b === 'string' && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function ownedState(raw, stateDir) {
  if (raw == null) return null;
  const state = asObject(raw, '配信状態');
  if (state.owner !== OWNER || state.mount !== MOUNT || typeof state.dnsName !== 'string' || typeof state.target !== 'string') fail('配信状態の所有情報が不正です');
  const releases = path.join(stateDir, 'releases');
  const rel = path.relative(releases, state.target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.includes(path.sep)) fail('配信先が管理フォルダー外です');
  return state;
}

function isHashedAsset(value) {
  return typeof value === 'string' && /^assets\/[a-zA-Z0-9_.-]+-[a-zA-Z0-9_-]{8,}\.(?:js|css)$/.test(value);
}

function assertOwnedRoute(route, state) {
  if (!route || !state || !(samePath(route.Path, state.target) || samePath(route.Path, state.previousTarget))) fail('対象パスはこのスクリプトの配信ではありません。設定を変更しません');
}

async function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx' });
  await fs.rename(temporary, file);
}

export function createHost({ root = SCRIPT_ROOT, run = (args) => execFileSync('tailscale', args, { encoding: 'utf8', timeout: 15_000, windowsHide: true }) } = {}) {
  const stateDir = path.join(root, '.test-data', 'pwa-host');
  const stateFile = path.join(stateDir, 'state.json');
  const command = (args) => run(args);
  const snapshot = () => {
    const dnsName = dnsFromStatus(readJson(command(['status', '--json']), 'Tailscale状態'));
    const config = readJson(command(['serve', 'status', '--json']), 'Serve設定');
    return { dnsName, ...inspectServeConfig(config, dnsName) };
  };
  const getState = async () => {
    try { return ownedState(JSON.parse(await fs.readFile(stateFile, 'utf8')), stateDir); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const saveState = async (state) => {
    await fs.mkdir(stateDir, { recursive: true });
    await assertPlainDirectories(path.dirname(stateDir), stateDir);
    await atomicJson(stateFile, state);
  };
  return {
    async start() {
      const current = snapshot();
      const state = await getState();
      if (state && state.dnsName !== current.dnsName) fail('DNSNameが前回配信時から変わりました。URLを自動変更しません');
      if (current.route) assertOwnedRoute(current.route, state);
      const { manifest, staged } = await stageRelease(path.join(root, 'dist-pwa'), stateDir);
      const next = { owner: OWNER, mount: MOUNT, dnsName: current.dnsName, target: staged, buildId: manifest.buildId, active: false };
      if (current.route) {
        next.previousTarget = current.route.Path;
        next.previousBuildId = state.buildId;
      }
      await saveState(next);
      command(['serve', '--bg', '--yes', `--https=${HTTPS_PORT}`, `--set-path=${MOUNT}`, staged]);
      const after = snapshot();
      if (after.dnsName !== current.dnsName || !samePath(after.route?.Path, staged)) fail('Serve反映後の対象パスを確認できません。設定と配信状態を確認してください');
      next.active = true;
      delete next.previousTarget;
      delete next.previousBuildId;
      await saveState(next);
      return { url: `https://${next.dnsName}:${HTTPS_PORT}${MOUNT}`, buildId: next.buildId };
    },
    async status() {
      const current = snapshot();
      const state = await getState();
      if (state && state.dnsName !== current.dnsName) fail('DNSNameが前回配信時から変わっています');
      if (current.route) assertOwnedRoute(current.route, state);
      const oldBuild = current.route && samePath(current.route.Path, state?.previousTarget);
      return { active: Boolean(current.route), url: `https://${current.dnsName}:${HTTPS_PORT}${MOUNT}`, buildId: current.route ? (oldBuild ? state.previousBuildId : state.buildId) : null };
    },
    async stop() {
      const current = snapshot();
      const state = await getState();
      if (!state || state.dnsName !== current.dnsName) fail('この端末で管理している配信状態がありません');
      assertOwnedRoute(current.route, state);
      command(['serve', '--yes', `--https=${HTTPS_PORT}`, `--set-path=${MOUNT}`, 'off']);
      const after = snapshot();
      if (after.route) fail('対象パスが停止したことを確認できません');
      state.active = false;
      await saveState(state);
      return { active: false, url: `https://${state.dnsName}:${HTTPS_PORT}${MOUNT}` };
    },
  };
}

const HTTP_PORT = 4178;
const CONTROL_PORT = 4179;
const HTTP_OWNER = 'StudyPlanPwaHttpV1';

export function selectLanAddress(interfaces, requested = '') {
  const addresses = [...new Set(Object.entries(interfaces)
    .filter(([name]) => !/tailscale|docker|virtual|vEthernet|loopback/i.test(name))
    .flatMap(([, entries]) => entries ?? [])
    .filter((entry) => !entry.internal && entry.family === 'IPv4')
    .map((entry) => entry.address)
    .filter((address) => /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address)))];
  if (requested) {
    if (!addresses.includes(requested)) fail('PWA_LAN_IP は現在の有線/Wi-Fi LANアドレスではありません');
    return requested;
  }
  if (addresses.length !== 1) fail('LANアドレスを1つに確定できません。PWA_LAN_IPを指定してください');
  return addresses[0];
}

function validateHttpState(raw, stateDir) {
  const state = asObject(raw, 'HTTP配信状態');
  if (state.owner !== HTTP_OWNER || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(state.lanIp) || !/^[a-f0-9]{64}$/.test(state.token) || !/^[a-f0-9]{32}$/.test(state.startId)) fail('HTTP配信状態の所有情報が不正です');
  ownedState({ owner: OWNER, mount: MOUNT, dnsName: 'local', target: state.target }, stateDir);
  const manifest = validateReleaseManifest(state.manifest);
  const retainedAssets = state.retainedAssets ?? [];
  if (!Array.isArray(retainedAssets)) fail('保持する旧版ファイルの形式が不正です');
  const seen = new Set();
  for (const item of retainedAssets) {
    asObject(item, '旧版ファイル');
    if (!isHashedAsset(item.path) || !/^[a-f0-9]{64}$/i.test(item.sha256) || seen.has(item.path)) fail('保持する旧版ファイルの形式が不正です');
    ownedState({ owner: OWNER, mount: MOUNT, dnsName: 'local', target: item.target }, stateDir);
    seen.add(item.path);
  }
  return { ...state, manifest, retainedAssets };
}

async function collectRetainedAssets(old, nextManifest) {
  if (!old) return [];
  const currentPaths = new Set(nextManifest.files.map((item) => item.path));
  const retained = new Map();
  for (const item of [...old.retainedAssets, ...old.manifest.files.filter((file) => isHashedAsset(file.path)).map((file) => ({ ...file, target: old.target }))]) {
    if (currentPaths.has(item.path) || retained.has(item.path)) continue;
    const file = path.join(item.target, ...item.path.split('/'));
    await assertNoSymlink(file, item.target);
    if ((await digest(file)).toLowerCase() !== item.sha256.toLowerCase()) fail(`旧版ファイルを検証できません: ${item.path}`);
    retained.set(item.path, { path: item.path, sha256: item.sha256, target: item.target });
  }
  return [...retained.values()];
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.avif': 'image/avif',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

export async function serveHttpFile(request, response, stateFile, identity) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
  let pathname;
  try { pathname = new URL(request.url, 'http://localhost').pathname; } catch { response.writeHead(400); response.end(); return; }
  if (!pathname.startsWith(BASE)) { response.writeHead(404); response.end(); return; }
  const relative = pathname === BASE ? 'index.html' : pathname.slice(BASE.length);
  if (relative !== 'release-files.json' && !safeRelativePath(relative)) { response.writeHead(404); response.end(); return; }
  let state;
  try {
    state = validateHttpState(JSON.parse(await fs.readFile(stateFile, 'utf8')), path.dirname(stateFile));
    if (state.token !== identity.token || state.startId !== identity.startId) throw new Error('worker identity changed');
  } catch { response.writeHead(503); response.end(); return; }
  const currentItem = state.manifest.files.find((file) => file.path === relative);
  const item = currentItem ?? state.retainedAssets.find((file) => file.path === relative);
  if (!item && relative !== 'release-files.json') { response.writeHead(404); response.end(); return; }
  const source = item?.target ?? state.target;
  const file = path.join(source, ...relative.split('/'));
  try {
    await assertNoSymlink(file, source);
    const bytes = await fs.readFile(file);
    if (relative === 'release-files.json') {
      if (JSON.stringify(JSON.parse(bytes.toString('utf8'))) !== JSON.stringify(state.manifest)) throw new Error('staged manifest changed');
    } else if (createHash('sha256').update(bytes).digest('hex').toLowerCase() !== item.sha256.toLowerCase()) throw new Error('staged hash changed');
    response.setHeader('Content-Type', contentTypes[path.extname(relative).toLowerCase()] ?? 'application/octet-stream');
    response.setHeader('Cache-Control', relative === 'index.html' || relative === 'sw.js' || relative === 'manifest.webmanifest' || relative === 'release-files.json'
      ? 'no-cache, no-store, must-revalidate'
      : /^assets\/.+-[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9]+$/.test(relative) ? 'public, max-age=31536000, immutable' : 'no-cache');
    response.setHeader('Content-Length', bytes.length);
    response.writeHead(200);
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(503); response.end(); }
}

async function runHttpWorker(stateFile) {
  const state = validateHttpState(JSON.parse(await fs.readFile(stateFile, 'utf8')), path.dirname(stateFile));
  const identity = { token: state.token, startId: state.startId };
  const publicServer = http.createServer((request, response) => { void serveHttpFile(request, response, stateFile, identity); });
  const controlServer = http.createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${identity.token}`) { response.writeHead(403); response.end(); return; }
    const body = JSON.stringify({ pid: process.pid, startId: identity.startId });
    if (request.url === '/status' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(body); return;
    }
    if (request.url === '/stop' && request.method === 'POST') {
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(body);
      publicServer.close(); controlServer.close(); return;
    }
    response.writeHead(404); response.end();
  });
  const listen = (server, host, port) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(); });
  });
  await listen(controlServer, '127.0.0.1', CONTROL_PORT);
  try { await listen(publicServer, state.lanIp, HTTP_PORT); }
  catch (error) { controlServer.close(); throw error; }
}

export function createHttpHost({ root = SCRIPT_ROOT, interfaces = () => os.networkInterfaces(), launch = (stateFile) => {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'http-worker', stateFile], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return child.pid;
}, request = (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(1200) }) } = {}) {
  const stateDir = path.join(root, '.test-data', 'pwa-host');
  const stateFile = path.join(stateDir, 'http-state.json');
  const control = async (state, operation) => {
    try {
      const result = await request(`http://127.0.0.1:${CONTROL_PORT}/${operation}`, {
        method: operation === 'stop' ? 'POST' : 'GET', headers: { Authorization: `Bearer ${state.token}` },
      });
      if (!result.ok) return false;
      const info = await result.json();
      return info.pid === state.pid && info.startId === state.startId;
    } catch { return false; }
  };
  const getState = async () => {
    try { return validateHttpState(JSON.parse(await fs.readFile(stateFile, 'utf8')), stateDir); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const save = async (state) => { await fs.mkdir(stateDir, { recursive: true }); await assertPlainDirectories(path.dirname(stateDir), stateDir); await atomicJson(stateFile, state); };
  return {
    async start() {
      const lanIp = selectLanAddress(interfaces(), process.env.PWA_LAN_IP ?? '');
      const old = await getState();
      if (old && old.lanIp !== lanIp) fail(`LANアドレスが ${old.lanIp} から変わりました。ブラウザーの保存データは別URLへ自動移行できません`);
      const alive = old && await control(old, 'status');
      const { manifest, staged } = await stageRelease(path.join(root, 'dist-pwa'), stateDir);
      const retainedAssets = await collectRetainedAssets(old, manifest);
      const state = { owner: HTTP_OWNER, lanIp, target: staged, manifest, retainedAssets, token: alive ? old.token : randomBytes(32).toString('hex'), startId: alive ? old.startId : randomBytes(16).toString('hex'), pid: alive ? old.pid : 0 };
      if (!alive) {
        await save(state);
        const pid = launch(stateFile);
        if (!Number.isInteger(pid) || pid <= 0) fail('HTTP配信プロセスを開始できません');
        state.pid = pid;
        await save(state);
      } else await save(state);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (await control(state, 'status')) return { active: true, url: `http://${lanIp}:${HTTP_PORT}${BASE}`, buildId: manifest.buildId };
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      fail('HTTP配信を確認できません。4178/4179番の使用状況を確認してください');
    },
    async status() {
      const state = await getState();
      if (!state) return { active: false, url: null, buildId: null };
      return { active: await control(state, 'status'), url: `http://${state.lanIp}:${HTTP_PORT}${BASE}`, buildId: state.manifest.buildId };
    },
    async stop() {
      const state = await getState();
      if (!state || !await control(state, 'status')) fail('管理対象のHTTP配信プロセスを確認できません。別プロセスは停止しません');
      if (!await control(state, 'stop')) fail('管理対象のHTTP配信を停止できません');
      return { active: false, url: `http://${state.lanIp}:${HTTP_PORT}${BASE}` };
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const operation = process.argv[2];
  if (operation === 'http-worker') {
    runHttpWorker(process.argv[3]).catch((error) => { console.error(error); process.exitCode = 1; });
  } else if (!['start', 'status', 'stop', 'https-start', 'https-status', 'https-stop'].includes(operation)) {
    console.error('使い方: node scripts/pwa-host.mjs start|status|stop|https-start|https-status|https-stop');
    process.exitCode = 2;
  } else {
    const https = operation.startsWith('https-');
    const host = https ? createHost() : createHttpHost();
    const method = https ? operation.slice(6) : operation;
    host[method]().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
      console.error(`PWA配信: ${error.message}`);
      process.exitCode = 1;
    });
  }
}
