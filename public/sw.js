// Stretching Service Worker
// Strategia (ricalcata sul diario-alimentare, 4 bucket versionati):
// - Navigazioni HTML          → network-first, fallback shell in cache
// - GET /api/* (whitelist)    → network-first con fallback cache per lettura offline
// - /api/* non whitelistate   → network-only (write, auth)
// - /uploads/*                → stale-while-revalidate
// - Asset same-origin         → stale-while-revalidate
// - CDN cross-origin          → network-first con fallback cache
//
// Update UX: niente skipWaiting() in install. Il client mostra banner e,
// su conferma utente, invia postMessage({type:'SKIP_WAITING'}) che innesca
// self.skipWaiting() qui + reload lato client.

const VERSION = 'v43';
const SHELL_CACHE   = `st-shell-${VERSION}`;
const RUNTIME_CACHE = `st-runtime-${VERSION}`;
const API_CACHE     = `st-api-${VERSION}`;
const UPLOADS_CACHE = `st-uploads-${VERSION}`;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/exercises-table.html',
  '/manifest.json',
  '/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/favicon-16.png',
  '/icons/favicon-32.png',
  '/img/brand/logo.svg',
  '/img/brand/logo-mono.svg',
  '/img/brand/app-icon-512.svg',
  '/img/brand/app-icon-maskable.svg',
  '/css/style.css',
  '/css/tokens.css',
  '/css/exercises-table.css',
  '/js/app.js',
  '/js/icons.js',
  '/js/settings.js',
  '/js/library.js',
  '/js/routines.js',
  '/js/session.js',
  '/js/history.js',
  '/js/exercises-table.js',
  '/img/exercises/default.svg',
  '/img/exercises/collo-e-spalle.svg',
  '/img/exercises/schiena.svg',
  '/img/exercises/addominali.svg',
  '/img/exercises/glutei-e-gambe.svg',
  '/img/exercises/braccia-e-torace.svg'
];

const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/sortablejs@1.15.3/Sortable.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap'
];

function isCacheableApi(url) {
  const p = url.pathname;
  // Solo GET idempotenti su cataloghi: routine, esercizi, sessioni, me.
  if (p === '/api/me') return true;
  if (p === '/api/exercises' || p.startsWith('/api/exercises/')) return true;
  if (p === '/api/routines'  || p.startsWith('/api/routines/'))  return true;
  if (p === '/api/sessions'  || p.startsWith('/api/sessions/'))  return true;
  return false;
}

function isCacheable(response) {
  if (!response) return false;
  return response.status === 200 || response.type === 'opaque';
}

// ── Install ──────────────────────────────
async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(SHELL_ASSETS.map(async (url) => {
    try {
      const res = await fetch(url, { cache: 'reload' });
      if (isCacheable(res)) await cache.put(url, res);
    } catch (e) { console.warn('[sw] precache fallito per', url, e.message); }
  }));
  const cdn = await caches.open(RUNTIME_CACHE);
  await Promise.all(CDN_ASSETS.map(async (url) => {
    try {
      const res = await fetch(url, { mode: 'no-cors' });
      if (isCacheable(res)) await cdn.put(url, res);
    } catch (e) { console.warn('[sw] cdn precache fallito per', url, e.message); }
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell());
});

// ── Activate: pulisci cache vecchie ─────
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, RUNTIME_CACHE, API_CACHE, UPLOADS_CACHE]);
    const names = await caches.keys();
    await Promise.all(names.map(n => keep.has(n) ? null : caches.delete(n)));
    await self.clients.claim();
  })());
});

// ── Messaggi dal client ─────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// ── Fetch handler ───────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // 1) Navigazione HTML → network-first, fallback shell
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('/index.html', net.clone()).catch(() => {});
        return net;
      } catch (_) {
        const cache = await caches.open(SHELL_CACHE);
        const cached = await cache.match('/index.html') || await cache.match('/');
        return cached || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // 2) API /api/* — whitelist o network-only
  if (sameOrigin && url.pathname.startsWith('/api/')) {
    if (!isCacheableApi(url)) return; // write, auth, external: lascia passare al browser
    event.respondWith((async () => {
      const cache = await caches.open(API_CACHE);
      try {
        const net = await fetch(req);
        if (isCacheable(net)) cache.put(req, net.clone()).catch(() => {});
        return net;
      } catch (_) {
        const cached = await cache.match(req);
        if (cached) return cached;
        return new Response(JSON.stringify({ error: 'offline' }), {
          status: 503, headers: { 'Content-Type': 'application/json' }
        });
      }
    })());
    return;
  }

  // 3) /uploads/* → stale-while-revalidate
  if (sameOrigin && url.pathname.startsWith('/uploads/')) {
    event.respondWith(staleWhileRevalidate(req, UPLOADS_CACHE));
    return;
  }

  // 4) Asset same-origin → stale-while-revalidate
  if (sameOrigin) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
    return;
  }

  // 5) CDN cross-origin → network-first con fallback cache
  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    try {
      const net = await fetch(req);
      if (isCacheable(net)) cache.put(req, net.clone()).catch(() => {});
      return net;
    } catch (_) {
      const cached = await cache.match(req);
      if (cached) return cached;
      return Response.error();
    }
  })());
});

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const netPromise = fetch(req).then(res => {
    if (isCacheable(res)) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  return cached || (await netPromise) || new Response('Offline', { status: 503 });
}
