import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { promises as fs, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASE = '/studyplan-lan/';
const FORMAT = 'StudyPlanLanRelease';
const PORT = 4178;
const CONTROL_PORT = 4180;
const OWNER = 'StudyPlanLanHostV1';
const MAX_BODY = 102 * 1024 * 1024;
const METHODS = new Set(['load_state', 'revision', 'commit_state', 'export_backup', 'validate_backup', 'load_restore_point', 'restore_backup', 'undo_restore']);

function fail(message) { throw new Error(message); }
const hex = (n) => randomBytes(n).toString('hex');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
function safePath(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || value.includes('\\') || value.includes('%') || value.includes('\0')) return false;
  if (['index.html', 'manifest.webmanifest', 'sw.js', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'].includes(value)) return true;
  return /^assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.(?:js|css|svg|png|webp|woff2?)$/.test(value) && !value.includes('..');
}
export function validateManifest(raw) {
  if (!object(raw) || raw.format !== FORMAT || raw.version !== 1 || raw.base !== BASE ||
    !/^[a-f0-9]{16,64}$/i.test(raw.buildId ?? '') || !Array.isArray(raw.files) ||
    raw.files.length < 2 || raw.files.length > 1000) fail('LAN配信マニフェストが不正です。');
  const seen = new Set();
  const files = raw.files.map((item) => {
    if (!object(item) || !safePath(item.path) || !/^[a-f0-9]{64}$/i.test(item.sha256 ?? '')) fail('配信できないファイルがあります。');
    if (seen.has(item.path.toLowerCase())) fail('配信ファイルが重複しています。');
    seen.add(item.path.toLowerCase());
    return { path: item.path, sha256: item.sha256.toLowerCase() };
  });
  if (!seen.has('index.html')) fail('index.html がありません。');
  return { format: FORMAT, version: 1, base: BASE, buildId: raw.buildId, files };
}
async function regularFile(file, root) {
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) fail('配信元の範囲外です。');
  let current = root;
  if ((await fs.lstat(current)).isSymbolicLink()) fail('配信元にリンクを使用できません。');
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if ((await fs.lstat(current)).isSymbolicLink()) fail('配信元にリンクを使用できません。');
  }
  if (!(await fs.lstat(file)).isFile()) fail('通常のファイルではありません。');
}
async function plainDirectory(directory) {
  const info = await fs.lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) fail('管理フォルダーにリンクを使用できません。');
}
export async function stageRelease(source, stateDirectory) {
  source = path.resolve(source);
  const manifestFile = path.join(source, 'release-files.json');
  await regularFile(manifestFile, source);
  const manifest = validateManifest(JSON.parse(await fs.readFile(manifestFile, 'utf8')));
  const releases = path.join(stateDirectory, 'releases');
  await fs.mkdir(releases, { recursive: true });
  await plainDirectory(stateDirectory);
  await plainDirectory(releases);
  const target = await fs.mkdtemp(path.join(releases, `${manifest.buildId.slice(0, 16)}-`));
  for (const item of manifest.files) {
    const from = path.join(source, ...item.path.split('/'));
    await regularFile(from, source);
    const bytes = await fs.readFile(from);
    if (digest(bytes) !== item.sha256) fail(`配信ファイルの検証に失敗しました: ${item.path}`);
    const to = path.join(target, ...item.path.split('/'));
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.writeFile(to, bytes, { flag: 'wx' });
  }
  await fs.writeFile(path.join(target, 'release-files.json'), JSON.stringify(manifest), { flag: 'wx' });
  return { manifest, target };
}
function ownedTarget(target, stateDirectory) {
  if (typeof target !== 'string') fail('配信先が不正です。');
  const releases = path.join(stateDirectory, 'releases');
  const relative = path.relative(releases, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.includes(path.sep)) fail('管理外の配信先です。');
  return target;
}
function validateState(raw, stateDirectory) {
  if (!object(raw) || raw.owner !== OWNER || !/^[a-f0-9]{64}$/.test(raw.key ?? '') ||
    !/^[a-f0-9]{64}$/.test(raw.controlToken ?? '') || !/^[a-f0-9]{32}$/.test(raw.startId ?? '') ||
    !Number.isInteger(raw.port) || !Number.isInteger(raw.controlPort) || !Number.isInteger(raw.pid) ||
    !/^[a-f0-9]{64}$/.test(raw.bridgeSha256 ?? '')) fail('LAN配信状態が不正です。');
  if (typeof raw.address !== 'string' || typeof raw.database !== 'string' || typeof raw.bridge !== 'string') fail('LAN配信状態が不正です。');
  ownedTarget(raw.target, stateDirectory);
  validateManifest(raw.manifest);
  if (!Array.isArray(raw.retainedAssets)) fail('旧版ファイルの形式が不正です。');
  for (const item of raw.retainedAssets) {
    if (!object(item) || !safePath(item.path) || !/^[a-f0-9]{64}$/i.test(item.sha256 ?? '')) fail('旧版ファイルの形式が不正です。');
    ownedTarget(item.target, stateDirectory);
  }
  return raw;
}
function assetType(name) {
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2' })[path.extname(name)] ?? 'application/octet-stream';
}
const sendJson = (response, status, value) => {
  const bytes = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  response.end(bytes);
};
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { request.pause(); reject(new Error('要求が大きすぎます。')); return; }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}
function httpError(error) {
  const message = String(error?.message ?? error).split('\n保存先：')[0];
  if (message.includes('別の操作でデータが更新')) return [409, 'revision_conflict', message];
  if (message.includes('橋渡し') || message.includes('保存先') || message.includes('保存データを開け')) return [503, 'storage_unavailable', message];
  if (message.includes('大きすぎ')) return [413, 'too_large', message];
  return [422, 'invalid_request', message];
}

export class RustBridge {
  constructor(executable, database) {
    this.executable = executable;
    this.database = database;
    this.pending = new Map();
    this.nextId = 1;
    this.closed = false;
  }
  async start() {
    this.child = spawn(this.executable, ['--database', this.database], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    this.child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-2000); });
    const ready = new Promise((resolve, reject) => {
      this.pending.set(0, { resolve, reject });
      this.child.once('error', reject);
      this.child.once('exit', () => {
        this.closed = true;
        for (const task of this.pending.values()) task.reject(new Error(`保存の橋渡しが停止しました。${stderr.trim()}`));
        this.pending.clear();
      });
    });
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      let result;
      try { result = JSON.parse(line); } catch { this.child.kill(); return; }
      const task = this.pending.get(result.id);
      if (!task) return;
      this.pending.delete(result.id);
      if (task.timer) clearTimeout(task.timer);
      if (result.ok) task.resolve(result.result);
      else task.reject(new Error(result.error ?? '保存の橋渡しに失敗しました。'));
    });
    let startupTimer;
    try {
      await Promise.race([ready, new Promise((_, reject) => {
        startupTimer = setTimeout(() => reject(new Error('保存の橋渡しを開始できません。')), 10_000);
      })]);
    } catch (error) { this.close(); throw error; }
    finally { clearTimeout(startupTimer); }
  }
  call(method, params = {}) {
    if (this.closed || !this.child?.stdin.writable) return Promise.reject(new Error('保存の橋渡しが停止しました。'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('保存の橋渡しが応答しません。'));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }
  close() {
    if (!this.closed) this.child?.kill();
    this.closed = true;
    for (const task of this.pending.values()) {
      if (task.timer) clearTimeout(task.timer);
      task.reject(new Error('保存の橋渡しが停止しました。'));
    }
    this.pending.clear();
  }
}

export function createRequestHandler({ address, port, key, stateFile, bridge }) {
  const origin = `http://${address}:${port}`;
  const stateDirectory = path.dirname(stateFile);
  return async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (request.headers.host !== `${address}:${port}`) { sendJson(response, 400, { ok: false, error: '接続先が一致しません。', code: 'invalid_host' }); return; }
    let pathname;
    try { pathname = new URL(request.url, origin).pathname; } catch { sendJson(response, 400, { ok: false, error: 'URLが不正です。' }); return; }
    if (pathname.startsWith(`${BASE}api/`)) {
      const method = pathname.slice(`${BASE}api/`.length);
      if (request.method !== 'POST' || !METHODS.has(method)) { sendJson(response, 404, { ok: false, error: '操作がありません。' }); return; }
      if (request.headers.origin !== origin) { sendJson(response, 403, { ok: false, error: '接続元が一致しません。', code: 'invalid_origin' }); return; }
      if (request.headers.authorization !== `Bearer ${key}`) { sendJson(response, 401, { ok: false, error: '接続キーを確認してください。', code: 'unauthorized' }); return; }
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) { sendJson(response, 415, { ok: false, error: 'JSON形式で送信してください。' }); return; }
      if (Number(request.headers['content-length'] ?? 0) > MAX_BODY) {
        response.setHeader('Connection', 'close');
        response.once('finish', () => request.destroy());
        sendJson(response, 413, { ok: false, error: '要求が大きすぎます。' }); return;
      }
      try {
        const params = JSON.parse(await readBody(request));
        if (!object(params)) fail('保存要求の形式が不正です。');
        const value = await bridge.call(method, params);
        sendJson(response, 200, { ok: true, value });
      } catch (error) {
        const [status, code, message] = httpError(error);
        if (status === 413) {
          response.setHeader('Connection', 'close');
          response.once('finish', () => request.destroy());
        }
        sendJson(response, status, { ok: false, error: message, code });
      }
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') { sendJson(response, 405, { ok: false, error: '許可されない操作です。' }); return; }
    if (!pathname.startsWith(BASE)) { response.writeHead(404); response.end(); return; }
    const relative = pathname === BASE ? 'index.html' : pathname.slice(BASE.length);
    if (relative !== 'release-files.json' && !safePath(relative)) { response.writeHead(404); response.end(); return; }
    try {
      const state = validateState(JSON.parse(await fs.readFile(stateFile, 'utf8')), stateDirectory);
      if (state.key !== key) fail('配信が変更されました。');
      const item = state.manifest.files.find((file) => file.path === relative) ?? state.retainedAssets.find((file) => file.path === relative);
      if (!item && relative !== 'release-files.json') { response.writeHead(404); response.end(); return; }
      const source = item?.target ?? state.target;
      const file = path.join(source, ...relative.split('/'));
      await regularFile(file, source);
      const bytes = await fs.readFile(file);
      if (relative === 'release-files.json') {
        if (JSON.stringify(JSON.parse(bytes.toString())) !== JSON.stringify(state.manifest)) fail('配信一覧が変化しました。');
      } else if (digest(bytes) !== item.sha256) fail('配信ファイルが変化しました。');
      response.writeHead(200, {
        'Content-Type': assetType(relative), 'Content-Length': bytes.length,
        'Cache-Control': relative === 'index.html' || relative === 'sw.js' || relative === 'manifest.webmanifest' || relative === 'release-files.json' ? 'no-store' : 'public, max-age=31536000, immutable',
        'Content-Security-Policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { response.writeHead(503); response.end(); }
  };
}

const listen = (server, address, port) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, address, () => { server.off('error', reject); resolve(); });
});
const close = (server) => new Promise((resolve) => server.close(resolve));

export async function startLanServer({ address, port = PORT, controlPort = CONTROL_PORT, key, controlToken, startId, stateFile, database, executable }) {
  const bridge = new RustBridge(executable, database);
  await bridge.start();
  const publicServer = createServer(createRequestHandler({ address, port, key, stateFile, bridge }));
  const controlServer = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${controlToken}`) { response.writeHead(403); response.end(); return; }
    const value = { pid: process.pid, startId };
    if (request.url === '/status' && request.method === 'GET') { sendJson(response, 200, value); return; }
    if (request.url === '/stop' && request.method === 'POST') {
      sendJson(response, 200, value);
      void Promise.all([close(publicServer), close(controlServer)]).then(() => bridge.close());
      return;
    }
    response.writeHead(404); response.end();
  });
  try {
    await listen(controlServer, '127.0.0.1', controlPort);
    await listen(publicServer, address, port);
  } catch (error) {
    controlServer.close(); publicServer.close(); bridge.close(); throw error;
  }
  return { bridge, publicServer, controlServer, close: async () => { await Promise.all([close(publicServer), close(controlServer)]); bridge.close(); } };
}

/** In-process test host. The caller seeds an isolated SQLite file before entry. */
export async function createLanServer({ root = ROOT, databasePath, bridgePath, host = '127.0.0.1', port = 4182, controlPort = port + 1, key = 'a'.repeat(64), stateDirectory = path.join(root, '.test-data', 'lan-server-test') }) {
  if (!databasePath || !bridgePath || !path.resolve(databasePath).includes(`${path.sep}.test-data${path.sep}`))
    fail('テストサーバーには .test-data 内の専用SQLiteとbridgeを指定してください。');
  const database = path.resolve(databasePath);
  const executable = path.resolve(bridgePath);
  await fs.mkdir(stateDirectory, { recursive: true });
  const { manifest, target } = await stageRelease(path.join(root, 'dist-lan'), stateDirectory);
  const stateFile = path.join(stateDirectory, 'state.json');
  const controlToken = hex(32), startId = hex(16);
  await saveState(stateFile, { owner: OWNER, address: host, port, controlPort, database, bridge: executable,
    bridgeSha256: digest(await fs.readFile(executable)), target, manifest, retainedAssets: [],
    key, controlToken, startId, pid: process.pid });
  const server = await startLanServer({ address: host, port, controlPort, key, controlToken, startId,
    stateFile, database, executable });
  return { ...server, url: `http://${host}:${port}${BASE}`, key };
}

export function selectLanAddress(interfaces, requested = '') {
  const addresses = [...new Set(Object.entries(interfaces)
    .filter(([name]) => !/tailscale|docker|virtual|vEthernet|loopback/i.test(name))
    .flatMap(([, entries]) => entries ?? [])
    .filter((entry) => !entry.internal && entry.family === 'IPv4')
    .map((entry) => entry.address)
    .filter((address) => /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address)))];
  if (requested) {
    if (requested !== '127.0.0.1' && !addresses.includes(requested)) fail('指定アドレスは現在のLANアドレスではありません。');
    return requested;
  }
  if (addresses.length !== 1) fail('LANアドレスを1つに確定できません。STUDYPLAN_LAN_IPを指定してください。');
  return addresses[0];
}

async function saveState(file, state) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
  await fs.rename(temporary, file);
}
async function readState(file, directory) {
  try { return validateState(JSON.parse(await fs.readFile(file, 'utf8')), directory); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function defaultDatabase(root) {
  const identifier = JSON.parse(readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8')).identifier;
  if (!/^[A-Za-z0-9.-]+$/.test(identifier ?? '') || !process.env.APPDATA) fail('デスクトップ版の保存先を確認できません。');
  return path.join(process.env.APPDATA, identifier, 'studyplan.sqlite3');
}

export function createLanHost({ root = ROOT, address, port = PORT, controlPort = CONTROL_PORT, database, executable, stateDirectory = path.join(root, '.test-data', 'lan-host'), launch = (file) => {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'worker', file], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return child.pid;
}, request = (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(1500) }) } = {}) {
  const stateFile = path.join(stateDirectory, 'state.json');
  const control = async (state, method) => {
    try {
      const reply = await request(`http://127.0.0.1:${state.controlPort}/${method}`, { method: method === 'stop' ? 'POST' : 'GET', headers: { Authorization: `Bearer ${state.controlToken}` } });
      if (!reply.ok) return false;
      const result = await reply.json();
      return result.pid === state.pid && result.startId === state.startId;
    } catch { return false; }
  };
  return {
    async start() {
      const ip = address ?? selectLanAddress(os.networkInterfaces(), process.env.STUDYPLAN_LAN_IP ?? '');
      const dbPath = path.resolve(database ?? defaultDatabase(root));
      const bridgePath = path.resolve(executable ?? path.join(root, 'src-tauri', 'target', 'release', process.platform === 'win32' ? 'studyplan_lan_bridge.exe' : 'studyplan_lan_bridge'));
      if (!(await fs.stat(dbPath)).isFile()) fail('既存のSQLite保存先がありません。デスクトップ版で先に保存してください。');
      if (!(await fs.stat(bridgePath)).isFile()) fail('LAN保存ブリッジがありません。先にビルドしてください。');
      const bridgeSha256 = digest(await fs.readFile(bridgePath));
      await fs.mkdir(stateDirectory, { recursive: true });
      await plainDirectory(stateDirectory);
      const old = await readState(stateFile, stateDirectory);
      if (old && (old.address !== ip || old.database !== dbPath || old.port !== port || old.controlPort !== controlPort)) fail('前回のLAN配信と接続先が異なります。既存配信を確認してください。');
      const alive = old && await control(old, 'status');
      if (alive && old.bridgeSha256 !== bridgeSha256) fail('LAN保存ブリッジが更新されています。管理対象の配信を停止してから開始してください。');
      const { manifest, target } = await stageRelease(path.join(root, 'dist-lan'), stateDirectory);
      const retainedAssets = [...new Map((old ? [...old.retainedAssets, ...old.manifest.files.filter((item) => item.path.startsWith('assets/')).map((item) => ({ ...item, target: old.target }))] : [])
        .filter((item) => !manifest.files.some((next) => next.path === item.path))
        .map((item) => [item.path, item])).values()];
      for (const item of retainedAssets) {
        const file = path.join(item.target, ...item.path.split('/'));
        await regularFile(file, item.target);
        if (digest(await fs.readFile(file)) !== item.sha256) fail('旧版ファイルを検証できません。');
      }
      const state = { owner: OWNER, address: ip, port, controlPort, database: dbPath, bridge: bridgePath, bridgeSha256, target, manifest, retainedAssets, key: old?.key ?? hex(32), controlToken: old?.controlToken ?? hex(32), startId: alive ? old.startId : hex(16), pid: alive ? old.pid : 0 };
      await saveState(stateFile, state);
      if (!alive) {
        state.pid = launch(stateFile);
        if (!Number.isInteger(state.pid) || state.pid <= 0) fail('LAN配信を開始できません。');
        await saveState(stateFile, state);
      }
      for (let attempt = 0; attempt < 30; attempt++) {
        if (await control(state, 'status')) return { active: true, url: `http://${ip}:${port}${BASE}#key=${state.key}`, buildId: manifest.buildId };
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      fail('LAN配信を確認できません。使用ポートと保存先を確認してください。');
    },
    async status() {
      const state = await readState(stateFile, stateDirectory);
      if (!state) return { active: false, url: null, buildId: null };
      return { active: await control(state, 'status'), url: `http://${state.address}:${state.port}${BASE}#key=${state.key}`, buildId: state.manifest.buildId };
    },
    async stop() {
      const state = await readState(stateFile, stateDirectory);
      if (!state || !await control(state, 'status')) fail('このホストが管理するLAN配信を確認できません。');
      if (!await control(state, 'stop')) fail('LAN配信を停止できません。');
      return { active: false, url: `http://${state.address}:${state.port}${BASE}`, buildId: state.manifest.buildId };
    },
  };
}

async function cli() {
  const command = process.argv[2];
  if (command === 'worker') {
    const file = path.resolve(process.argv[3]);
    const state = await readState(file, path.dirname(file));
    if (!state) fail('LAN配信状態がありません。');
    await startLanServer({ address: state.address, port: state.port, controlPort: state.controlPort, key: state.key, controlToken: state.controlToken, startId: state.startId, stateFile: file, database: state.database, executable: state.bridge });
    return;
  }
  if (!['start', 'status', 'stop'].includes(command)) fail('使い方: node scripts/lan-host.mjs start|status|stop');
  const host = createLanHost();
  console.log(JSON.stringify(await host[command](), null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch((error) => { console.error(`LAN配信: ${error.message}`); process.exitCode = 1; });
}
