/**
 * sw.js — the service worker.
 *
 * Hand-written rather than generated, because `@vite-pwa/astro` only declares
 * support up to Astro 5 and this project is on Astro 7. It is small enough
 * that the three strategies below are easier to reason about than a build
 * step generating them.
 *
 * Bump CACHE_VERSION to ship a new worker; the old cache is dropped on
 * activate.
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `habit-tracker-${CACHE_VERSION}`;

/** The shell we are sure about, resolved relative to this file. */
const PRECACHE = [
  './',
  './manifest.webmanifest',
  './favicon.svg',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Individually, so one 404 cannot fail the whole install.
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {
            /* ignore a missing optional asset */
          }),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('habit-tracker-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

/** Navigations: fresh if possible, cached copy if the network is gone. */
async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
    return response;
  } catch (error) {
    // ignoreVary matters: the server sends `Vary: Accept-Encoding`, and without
    // this a cached copy is invisible to a later request.
    const cached =
      (await caches.match(request, { ignoreVary: true })) ||
      (await caches.match('./', { ignoreVary: true }));
    return cached || Response.error();
  }
}

/** Everything else same-origin: serve from cache, refresh in the background. */
async function handleAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreVary: true });

  const network = fetch(request)
    .then((response) => {
      if (response.ok && response.type === 'basic') cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) {
    return cached; // revalidation continues in the background
  }

  const response = await network;
  return response || new Response('', { status: 504, statusText: 'Offline' });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // let analytics et al. pass through

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  event.respondWith(handleAsset(request));
});
