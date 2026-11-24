/* sw.js — offline support. App files: network-first (always fresh when online,
   cached copy when offline). Pinned CDN modules: cache-first. */
const VERSION = 'runway-v1.1.0';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/ctx.js', './js/store.js', './js/cloud.js', './js/config.js', './js/engine.js',
  './js/schedule.js', './js/dates.js', './js/money.js', './js/views.js', './js/forms.js', './js/charts.js',
  './js/ui.js', './js/demo.js', './js/csv.js', './js/savings.js',
  './icons/icon.svg', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const res = await Promise.race([fetch(req), timeout(4000)]);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./index.html') : null);
        return hit || Response.error();
      }
    })());
    return;
  }
  // Versioned CDN modules (supabase-js) never change: cache-first.
  if (url.hostname === 'esm.sh') {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })());
  }
  // Everything else (Supabase API) goes straight to the network.
});
