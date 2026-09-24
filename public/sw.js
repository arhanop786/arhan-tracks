// ============================================================
// Arhan Tracks service worker — offline-friendly patient view.
//
// Precaching: Vite injects the full build file list below at build
// time (see vite.config.ts import.meta define), so every hashed
// asset is cached on install and a new deploy activates cleanly.
//
// Runtime:
//   • Navigation requests → network-first with cache fallback,
//     so a fresh deploy wins online but the app still opens offline.
//   • Same-origin static GETs → stale-while-revalidate.
//   • Google Fonts → cache-first.
//   • Supabase/API traffic is NEVER cached (live queue must be live).
// ============================================================

/* eslint-disable no-restricted-globals */

// Injected by vite.config.ts via `define` (see build.pwaPrecache).
const PRECACHE_URLS = self.__ARHAN_PRECACHE__ || [];

const VERSION = 'arhan-v1';
const PRECACHE = `${VERSION}-precache`;
const RUNTIME = `${VERSION}-runtime`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);
      await cache.addAll(PRECACHE_URLS);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('arhan-') && !k.startsWith(VERSION)).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle idempotent reads; never queue/mutation POSTs or Supabase.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
      event.respondWith(cacheFirst(req));
    }
    return; // Supabase etc. — always live
  }

  if (req.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(req));
    return;
  }

  event.respondWith(staleWhileRevalidate(req));
});

async function networkFirstNavigation(req) {
  try {
    const fresh = await fetch(req);
    const cache = await caches.open(PRECACHE);
    cache.put('/index.html', fresh.clone()).catch(() => {});
    return fresh;
  } catch {
    const cache = await caches.open(PRECACHE);
    return (
      (await cache.match(req)) ||
      (await cache.match('/index.html')) ||
      new Response('You are offline and this page is not cached.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' },
      })
    );
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => cached);
  return cached || network;
}

async function cacheFirst(req) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}
