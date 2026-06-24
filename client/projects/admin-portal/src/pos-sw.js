const CACHE = 'elite-pos-shell-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('elite-pos-shell-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (url.pathname.startsWith('/pos')) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put('/pos-shell', copy));
          }
          return response;
        })
        .catch(async () => (await caches.open(CACHE)).match('/pos-shell') || Response.error()),
    );
    return;
  }

  if (/\.(?:js|css|woff2?|png|jpe?g|webp|svg|ico)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        try {
          const response = await fetch(request);
          if (response.ok) await cache.put(request, response.clone());
          return response;
        } catch {
          return (await cache.match(request)) || Response.error();
        }
      }),
    );
  }
});
