import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve } from 'node:path';

export interface PwaServer {
  port: number;
  url: string;
  child: ChildProcessWithoutNullStreams;
  stop: () => Promise<void>;
}

export async function startPwaServer(port = 0, options: { root?: string; demoRoot?: string } = {}): Promise<PwaServer> {
  const child = spawn(process.execPath, [resolve('tests/pwa/server.mjs'), String(port)], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      ...(options.root ? { PWA_TEST_ROOT: options.root } : {}),
      ...(options.demoRoot ? { PWA_TEST_DEMO_ROOT: options.demoRoot } : {}),
    },
  });
  let error = '';
  child.stderr.on('data', (chunk: Buffer) => { error += chunk.toString(); });
  const assigned = await new Promise<number>((resolvePort, reject) => {
    const timeout = setTimeout(() => reject(new Error(`PWA server startup timed out: ${error}`)), 10000);
    child.stdout.on('data', (chunk: Buffer) => {
      const match = chunk.toString().match(/PWA_TEST_SERVER_PORT=(\d+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolvePort(Number(match[1]));
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`PWA server exited ${code}: ${error}`));
    });
  });
  return {
    port: assigned,
    url: `http://127.0.0.1:${assigned}/studyplan-pwa/`,
    child,
    stop: () => new Promise<void>((done) => {
      if (child.exitCode !== null || child.killed) { done(); return; }
      child.once('exit', () => done());
      child.kill();
    }),
  };
}
