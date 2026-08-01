const PRECACHE_VERSION = '__POS_CACHE_VERSION__';
const PRECACHE_URLS = /*__POS_PRECACHE_URLS__*/[];
const CACHE = `elite-pos-shell-${PRECACHE_VERSION}`;

async function precachePos() {
  const cache = await caches.open(CACHE);
  await Promise.all(PRECACHE_URLS.map(async (url) => {
    const response = await fetch(url, { cache: 'reload' });
    if (!response.ok) throw new Error(`Could not precache ${url}: ${response.status}`);
    await cache.put(url, response);
  }));

  // Store the document under a private cache key. Only /pos navigations may
  // receive it; an offline /dashboard must not silently render the till.
  const shell = await fetch('/pos', { cache: 'reload' });
  if (!shell.ok) throw new Error(`Could not precache the POS shell: ${shell.status}`);
  await cache.put('/pos-shell', shell);
}

self.addEventListener('install', (event) => {
  event.waitUntil(precachePos());
  // Deliberately no skipWaiting(). An update stays waiting until the running
  // POS confirms there is no cart, payment, sync or rejected offline sale.
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACTIVATE_POS_UPDATE') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('elite-pos-shell-') && key !== CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    if (!url.pathname.startsWith('/pos')) return;
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put('/pos-shell', copy));
          }
          return response;
        })
        .catch(async () => (await caches.open(CACHE)).match('/pos-shell') || Response.error()),
    );
    return;
  }

  if (PRECACHE_URLS.includes(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => (
        (await cache.match(request))
        || fetch(request).then((response) => {
          if (response.ok) void cache.put(request, response.clone());
          return response;
        })
      )),
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
