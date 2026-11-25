const VERSION = 'v5.3.0-rc.2';
const PREFIX = `teachapp:${self.registration.scope}:`;
const CACHE = PREFIX + VERSION;

/* Всё, что нужно для запуска. Пути относительные — работает и на GitHub Pages из подпапки. */
const PRECACHE = [
  './',
  './index.html',
  './live/index.html','./css/public-portal.css','./js/public-view.js','./js/public-portal.js','./js/public-archive.js','./js/public-media.js','./js/public-media-drafts.js','./js/screens/public-media.js','./js/firebase-portal.js','./js/public-publisher.js','./js/screens/public-portal.js',
  './manifest.webmanifest',
  './css/app.css',
  './css/design.css','./css/next.css','./js/motion.js',
  './js/design.js','./js/assistant.js','./js/screens/assistant.js',
  './js/dashboard.js','./js/dashboard-preferences.js','./js/competition-center.js','./js/screens/competition-center.js',
  './js/attention.js',
  './js/school-tools.js',
  './js/screens/school-tools.js',
  './js/screens/attention.js',
  './js/device-trust.js','./js/screens/trusted-devices.js','./js/privacy-shield.js',
  './js/app.js','./js/search.js','./js/screens/search.js',
  './js/version.js',
  './js/delta-anchor.js','./js/db.js',
  './js/backup.js',
  './js/sync.js','./js/sync-pairing.js','./js/personal-sync.js','./js/device-invite.js','./js/auto-sync.js',
  './js/screens/sync.js',
  './js/store.js',
  './js/model.js',
  './js/health.js',
  './js/assessment.js','./js/attendance-index.js',
  './js/norm-import.js',
  './js/screens/norm-batch.js',
  './js/screens/session.js',
  './js/team-generator.js',
  './js/screens/team-generator.js',
  './js/coach.js','./js/coach-opponents.js','./js/screens/coach-opponents.js','./js/media-studio.js','./js/screens/studio.js',
  './js/workbench.js','./js/methodical.js','./js/portable-library.js','./js/library-materials.js','./js/student-goals.js','./js/norm-retakes.js','./js/teacher-portfolio.js','./js/screens/teacher-portfolio.js',
  './js/tournaments.js',
  './js/screens/tournaments.js',
  './js/work-calendar.js',
  './js/screens/work-calendar.js',
  './js/school-archive.js',
  './js/screens/school-archive.js',
  './js/screens/library.js','./js/screens/methodical.js',
  './js/coach-tests.js',
  './js/coach-goals.js',
  './js/tactics.js',
  './js/documents.js','./js/document-presets.js',
  './js/resources.js',
  './js/grade-history.js',
  './js/selective-backup.js',
  './js/screens/selective-backup.js',
  './js/screens/grade-history.js',
  './js/screens/resources.js',
  './js/screens/documents.js',
  './js/screens/tactics.js',
  './js/screens/coach-goals.js',
  './js/coach-season.js',
  './js/season-plan.js',
  './js/screens/season-plan.js',
  './js/screens/coach-season.js',
  './js/screens/coach-tests.js',
  './js/volleypoint-pdf.js',
  './js/volleypoint-import.js',
  './js/screens/volleypoint-import.js',
  './js/volleyball.js',
  './js/match-protocol.js','./js/match-rules.js','./js/match-transfer.js','./js/match-capture.js','./js/video-review.js','./js/video-clip.js','./js/screens/video-review.js',
  './js/match-tactics.js','./js/match-history.js','./js/screens/match-history.js',
  './js/screens/match-tactics.js',
  './js/screens/match-protocol.js',
  './js/screens/lineup-picker.js',
  './js/screens/volleyball.js',
  './js/privacy.js',
  './js/retention.js',
  './js/analytics.js','./js/school-review.js',
  './js/screens/analytics.js','./js/screens/school-review.js',
  './js/screens/coach.js',
  './js/screens/norms.js',
  './js/screens/health.js',
  './js/ui.js',
  './js/export.js','./js/ktp-docx.js','./js/ktp-history.js','./js/lesson-alternatives.js','./js/court-time.js','./js/journal-filters.js',
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
  './icons/brand.svg',
  './icons/apple-touch-icon.png',
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
    const path=new URL(request.url).pathname,base=new URL(self.registration.scope).pathname;
    const publicPage=path===base+'live/'||path===base+'live/index.html'||path===base+'live';
    const key = request.mode === 'navigate' ? new URL(publicPage?'live/index.html':'index.html',self.registration.scope).href : request;
    const cached = await cache.match(key,{ignoreSearch:true});
    if (cached) return cached;
    try { return await fetch(request); }
    catch { return new Response('',{status:503}); }
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') event.waitUntil(self.skipWaiting());
});
