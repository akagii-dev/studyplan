import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const root = resolve(process.env.PWA_TEST_ROOT ?? resolve(process.cwd(), 'dist-pwa'));
const demoRoot = process.env.PWA_TEST_DEMO_ROOT ? resolve(process.env.PWA_TEST_DEMO_ROOT) : undefined;
const base = '/studyplan-pwa/';
const demoBase = '/studyplan/';
const requestedPort = Number(process.argv[2] ?? 0);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const selected = pathname.startsWith(base) ? { root, base } :
      demoRoot && pathname.startsWith(demoBase) ? { root: demoRoot, base: demoBase } : undefined;
    if (!selected) {
      response.writeHead(404).end();
      return;
    }
    let relative = pathname.slice(selected.base.length) || 'index.html';
    const file = resolve(selected.root, relative);
    if (file !== selected.root && !file.startsWith(`${selected.root}${sep}`)) {
      response.writeHead(403).end();
      return;
    }
    let target = file;
    let details;
    try {
      details = await stat(target);
    } catch {
      if (!relative.includes('.') && !relative.endsWith('/')) {
        target = resolve(selected.root, 'index.html');
        details = await stat(target);
      } else throw new Error('not found');
    }
    if (details.isDirectory()) target = resolve(target, 'index.html');
    const extension = target.slice(target.lastIndexOf('.'));
    response.setHeader('Content-Type', mime[extension] ?? 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Service-Worker-Allowed', selected.base);
    response.writeHead(200).end(await readFile(target));
  } catch {
    response.writeHead(404).end();
  }
});

server.listen(requestedPort, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('port unavailable');
  process.stdout.write(`PWA_TEST_SERVER_PORT=${address.port}\n`);
});
