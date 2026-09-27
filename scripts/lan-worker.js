/* Static app shell only. Study data and API responses always come from SQLite through the LAN host. */
const BUILD = __BUILD_ID__;
const FILES = __PRECACHE__;
const PREFIX = 'studyplan-lan-shell-v1-';
const CACHE = PREFIX + BUILD;
const base = new URL('./', self.location.href);
const address = (path) => new URL(path, base).href;
const hex = (buffer) => [...new Uint8Array(buffer)].map((n) => n.toString(16).padStart(2, '0')).join('');
async function matching(response, entry) {
  return !!response?.ok &&
    hex(await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer())) === entry.sha256;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      for (const entry of FILES) {
        const response = await fetch(address(entry.path), { cache: 'no-store', credentials: 'omit' });
        if (!await matching(response, entry)) throw new Error('LAN app shell is incomplete');
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
    for (const key of await caches.keys())
      if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return;
  const relative = url.pathname.slice(base.pathname.length);
  if (relative.startsWith('api/') || relative === 'release-files.json') return;
  const path = request.mode === 'navigate' && (relative === '' || relative === 'index.html')
    ? 'index.html' : relative;
  const entry = FILES.find((item) => item.path === path);
  if (!entry) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const saved = await cache.match(address(path));
    if (await matching(saved, entry)) return saved;
    if (saved) await cache.delete(address(path));
    try {
      const response = await fetch(address(path), { cache: 'no-store', credentials: 'omit' });
      if (await matching(response, entry)) {
        await cache.put(address(path), response.clone());
        return response;
      }
    } catch { /* The API remains network only. */ }
    return new Response('アプリの表示ファイルを開けません。配信PCへ接続してください。', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  })());
});
