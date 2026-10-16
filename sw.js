/* Casper Lost Dogs service worker: offline app shell + map tile cache.
 * Bump VERSION whenever shell files change so phones pick up the update. */
const VERSION = 'v1.0.0';
const SHELL = `lostdogs-shell-${VERSION}`;
const TILES = 'lostdogs-tiles';
const MAX_TILES = 400;
const SHELL_FILES = [
  './', 'index.html', 'styles.css', 'app.js', 'data.js', 'seed.js', 'config.js', 'manifest.json', 'favicon.svg',
  'vendor/leaflet/leaflet.css', 'vendor/leaflet/leaflet.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
  'samples/dog-1.svg', 'samples/dog-2.svg', 'samples/dog-3.svg', 'samples/dog-4.svg', 'samples/dog-5.svg', 'samples/dog-6.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('lostdogs-shell-') && k !== SHELL).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trimTiles() {
  const c = await caches.open(TILES); const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Map tiles: cache-first so recently viewed areas work offline
  if (/\.tile\.openstreetmap\.org$/.test(url.hostname)) {
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); trimTiles(); }
      return res;
    }).catch(() => caches.match(req)));
    return;
  }

  if (url.origin !== location.origin) return;          // Supabase etc.: always network
  if (url.pathname.includes('/api/')) return;          // Node server API: always network

  // Pages and config: network first (fresh data/settings), fall back to cache offline
  if (req.mode === 'navigate' || url.pathname.endsWith('/config.js')) {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req.mode === 'navigate' ? './' : req, copy)); }
      return res;
    }).catch(async () => (await caches.match(req, { ignoreSearch: true })) || caches.match('./')));
    return;
  }

  // Everything else on our origin: stale-while-revalidate
  e.respondWith(caches.open(SHELL).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
