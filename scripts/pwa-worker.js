/* Build replaces these two constants. This worker never opens learning-data storage. */
const BUILD = __BUILD_ID__;
const FILES = __PRECACHE__;
const PREFIX = 'studyplan-pwa-shell-v1-';
const CACHE = PREFIX + BUILD;
const base = new URL('./', self.location.href);
const address = (path) => new URL(path, base).href;
const hex = (buffer) => [...new Uint8Array(buffer)].map((n) => n.toString(16).padStart(2, '0')).join('');
async function verified(response, entry) {
  return response?.ok && hex(await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer())) === entry.sha256;
}
async function complete(repair = false) {
  const cache = await caches.open(CACHE);
  return (await Promise.all(FILES.map(async (entry) => {
    if (await verified(await cache.match(address(entry.path)), entry)) return true;
    if (!repair) return false;
    try {
      const response = await fetch(address(entry.path), { cache: 'no-store', credentials: 'omit' });
      if (!await verified(response, entry)) return false;
      await cache.put(address(entry.path), response);
      return true;
    } catch { return false; }
  }))).every(Boolean);
}
self.addEventListener('install', (event) => {
  // No skipWaiting: existing tabs retain the code they started with until all are closed.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      for (const entry of FILES) {
        const response = await fetch(address(entry.path), { cache: 'no-store', credentials: 'omit' });
        if (!await verified(response, entry)) throw new Error('Incomplete PWA release');
        await cache.put(address(entry.path), response);
      }
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
  })());
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (!await complete()) throw new Error('Incomplete PWA cache');
    // Only obsolete app-shell caches. Never IndexedDB, demo caches or other apps.
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('message', (event) => {
  if (!['CHECK_OFFLINE', 'REPAIR_OFFLINE'].includes(event.data?.type)) return;
  event.waitUntil(complete(event.data.type === 'REPAIR_OFFLINE').then((ready) => event.ports[0]?.postMessage({ type: 'OFFLINE_STATUS', ready, build: BUILD }))
    .catch(() => event.ports[0]?.postMessage({ type: 'OFFLINE_STATUS', ready: false })));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return;
  const relative = url.pathname.slice(base.pathname.length);
  const path = event.request.mode === 'navigate' && (relative === '' || relative === 'index.html') ? 'index.html' : relative;
  const entry = FILES.find((item) => item.path === path);
  if (!entry) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const saved = await cache.match(address(path));
    if (await verified(saved, entry)) return saved;
    if (saved) await cache.delete(address(path));
    // A partial eviction is repaired only with this exact release, never mixed versions.
    try {
      const response = await fetch(address(path), { cache: 'no-store', credentials: 'omit' });
      if (await verified(response, entry)) {
        await cache.put(address(path), response.clone());
        return response;
      }
    } catch { /* The local database is unaffected by an unreachable host. */ }
    return new Response('アプリのファイルを開けません。配信PCへ接続して、もう一度開いてください。端末内の学習データは削除していません。', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  })());
});
