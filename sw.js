/* sw.js — service worker: offline-first, cache-first для статики.
   Стратегия:
     • навигационные запросы — cache-first со свежей копией в фоне (offline открывается моментально);
     • статика — cache-first, сеть только при промахе;
     • чужие домены игнорируем полностью (никаких сетевых вызовов у приложения нет). */

const VERSION = 'v1.0.0';
const CACHE = `teachapp-${VERSION}`;

/* Всё, что нужно для запуска. Пути относительные — работает и на GitHub Pages из подпапки. */
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/store.js',
  './js/model.js',
  './js/ui.js',
  './js/export.js',
  './js/demo.js',
  './js/screens/classes.js',
  './js/screens/journal.js',
  './js/screens/monthly.js',
  './js/screens/exemptions.js',
  './js/screens/lesson.js',
  './js/screens/settings.js',
  './vendor/xlsx.full.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // addAll падает целиком при одном 404 — добавляем по одному, чтобы частичный сбой не ломал установку.
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (err) {
        console.warn('[sw] не удалось закэшировать', url, err.message);
      }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Только GET и только свой источник.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Навигация: сначала кэш (offline-first), затем сеть с обновлением кэша.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match('./index.html');
      const network = fetch(request).then((resp) => {
        if (resp && resp.ok) cache.put('./index.html', resp.clone());
        return resp;
      }).catch(() => null);

      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      const resp = await network;
      return resp || new Response('Приложение недоступно офлайн', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    })());
    return;
  }

  // Статика: cache-first.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;

    try {
      const resp = await fetch(request);
      if (resp && resp.ok && resp.type === 'basic') {
        cache.put(request, resp.clone());
      }
      return resp;
    } catch (err) {
      return new Response('', { status: 504, statusText: 'offline' });
    }
  })());
});

/* Сообщение из страницы: принудительно обновить кэш (кнопка «Проверить обновления»). */
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
