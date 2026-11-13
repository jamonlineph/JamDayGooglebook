// JamDay service worker: offline app shell + notification clicks.
// Bump VERSION when shipping changes so installed apps pick up the new files.
const VERSION = 'jamday-v1.0.0';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/badge-96.png',
  'vendor/preact.mjs', 'vendor/hooks.mjs', 'vendor/htm.mjs',
  'js/main.js', 'js/lib.js', 'js/dates.js', 'js/db.js', 'js/store.js', 'js/tokens.js', 'js/md.js', 'js/notify.js',
  'js/io.js', 'js/ai.js', 'js/google.js', 'js/demo.js',
  'js/ui/app.js', 'js/ui/icons.js', 'js/ui/common.js', 'js/ui/editor.js', 'js/ui/attachments.js', 'js/ui/tasks.js',
  'js/ui/calendar.js', 'js/ui/notes.js', 'js/ui/collections.js', 'js/ui/launcher.js', 'js/ui/panel.js',
  'js/ui/assistant.js', 'js/ui/settings.js', 'js/ui/tour.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // never touch Google / AI / CDN requests
  if (req.mode === 'navigate') {
    // network first so updates arrive; fall back to the cached shell offline
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put('index.html', copy)); return res; })
      .catch(() => caches.match('index.html').then((r) => r || caches.match('./'))));
    return;
  }
  // stale-while-revalidate for app files
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.id;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const client = list.find((c) => c.url.includes(self.registration.scope));
    if (client) { client.focus(); if (id) client.postMessage({ type: 'open', id }); return; }
    return self.clients.openWindow(id ? `./#/open/${encodeURIComponent(id)}` : './');
  }));
});
