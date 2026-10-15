const CACHE_NAME = 'votly-vault-v1';
const STATIC_ASSETS = [
  '/',
  '/static/css/votly.css',
  '/static/js/app.js',
  '/static/js/camera.js',
  '/static/js/crypto.js',
  '/static/manifest.json',
  '/static/assets/icon-192.png',
  '/static/assets/icon-512.png',
  '/static/assets/ada_header_avatar.png',
  '/static/assets/nigeria_passport_authentic.png',
  '/static/assets/nigeria_nin_front_crop.png',
  '/static/assets/thumb_passport_authentic.png',
  '/static/assets/thumb_nin_authentic.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Do not cache API endpoints or download/preview streams, always hit network for security
  if (event.request.url.includes('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch fresh copy in background to keep cache updated
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});
