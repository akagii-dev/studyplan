import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? 'dist');
const port = Number(process.argv[3] ?? 4180);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
createServer(async (request, response) => {
  const path = resolve(root, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`);
  if (path !== root && !path.startsWith(root + sep)) {
    response.writeHead(403).end();
    return;
  }
  const target = path === root ? resolve(root, 'index.html') : path;
  try {
    const data = await readFile(target);
    const suffix = target.slice(target.lastIndexOf('.'));
    response.writeHead(200, { 'Content-Type': types[suffix] ?? 'application/octet-stream' });
    response.end(data);
  } catch {
    response.writeHead(404).end();
  }
}).listen(port, '127.0.0.1');
