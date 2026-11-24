const VERSION = 'v1.8.0';
const PREFIX = `teachapp:${self.registration.scope}:`;
const CACHE = PREFIX + VERSION;

/* Всё, что нужно для запуска. Пути относительные — работает и на GitHub Pages из подпапки. */
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/version.js',
  './js/db.js',
  './js/backup.js',
  './js/store.js',
  './js/model.js',
  './js/health.js',
  './js/assessment.js',
  './js/screens/norms.js',
  './js/screens/health.js',
  './js/ui.js',
  './js/export.js',
  './js/demo.js',
  './js/screens/classes.js',
  './js/screens/today.js',
  './js/screens/journal.js',
  './js/screens/participation.js',
  './js/screens/exemptions.js',
  './js/screens/lesson.js',
  './js/screens/schedule.js',
  './js/screens/ktp.js',
  './js/screens/settings.js',
  './vendor/xlsx.full.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE.map(path => new Request(new URL(path,self.registration.scope), {cache:'reload'})));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    for (const key of keys) {
      if (key === CACHE) continue;
      // Старые версии использовали имя без scope. Проверяем принадлежность по адресу index.html.
      if (key.startsWith(PREFIX) || (/^teachapp-v\d+\.\d+\.\d+$/.test(key)
          && await (await caches.open(key)).match(new URL('index.html',self.registration.scope).href))) {
        await caches.delete(key);
      }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = request.mode === 'navigate' ? new URL('index.html',self.registration.scope).href : request;
    const cached = await cache.match(key,{ignoreSearch:true});
    if (cached) return cached;
    try { return await fetch(request); }
    catch { return new Response('',{status:503}); }
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') event.waitUntil(self.skipWaiting());
});
