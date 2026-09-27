import { createHash } from 'node:crypto';
import { copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist-lan');
const base = '/studyplan-lan/';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const icons = [
  ['src-tauri/icons/icon.png', 'icon-512.png', '512x512'],
  ['src-tauri/icons/android/mipmap-xxxhdpi/ic_launcher.png', 'icon-192.png', '192x192'],
  ['src-tauri/icons/ios/AppIcon-60x60@3x.png', 'apple-touch-icon.png', '180x180'],
];
for (const [source, target] of icons) await copyFile(resolve(root, source), resolve(output, target));
await writeFile(resolve(output, 'manifest.webmanifest'), JSON.stringify({
  id: base, name: 'StudyPlan', short_name: 'StudyPlan', lang: 'ja',
  start_url: base, scope: base, display: 'standalone',
  background_color: '#eef5f1', theme_color: '#23665b',
  icons: icons.slice(0, 2).map(([, src, sizes]) => ({ src, sizes, type: 'image/png', purpose: 'any' })),
}, null, 2));
const html = await readFile(resolve(output, 'index.html'), 'utf8');
if (!html.includes('</head>')) throw new Error('LANビルドのindex.htmlが不正です。');
await writeFile(resolve(output, 'index.html'), html.replace('</head>',
  `<link rel="manifest" href="${base}manifest.webmanifest"/><link rel="apple-touch-icon" href="${base}apple-touch-icon.png"/><meta name="apple-mobile-web-app-title" content="StudyPlan"/></head>`));

const files = [];
async function scan(relative = '') {
  for (const entry of await readdir(resolve(output, relative), { withFileTypes: true })) {
    const path = relative + entry.name;
    if (entry.isDirectory() && path === 'assets') await scan('assets/');
    else if (entry.isFile() && /^(index\.html|manifest\.webmanifest|(?:icon-(?:192|512)|apple-touch-icon)\.png|assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.(?:js|css|svg|png|webp|woff|woff2))$/.test(path))
      files.push({ path, sha256: digest(await readFile(resolve(output, path))) });
    else throw new Error(`LAN配信対象外のファイルです: ${path}`);
  }
}
await scan();
files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
const template = await readFile(resolve(root, 'scripts/lan-worker.js'), 'utf8');
const buildId = digest(JSON.stringify(files) + template);
const worker = template.replace('__BUILD_ID__', JSON.stringify(buildId)).replace('__PRECACHE__', JSON.stringify(files));
await writeFile(resolve(output, 'sw.js'), worker);
files.push({ path: 'sw.js', sha256: digest(worker) });
await writeFile(resolve(output, 'release-files.json'), JSON.stringify({
  format: 'StudyPlanLanRelease', version: 1, base, buildId, files,
}, null, 2));
console.log(`LAN: ${files.length} files / ${buildId.slice(0, 12)}`);
