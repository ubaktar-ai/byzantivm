// Offline support: serve the app shell from cache, refresh it in the background.
// Only same-origin files are cached; Supabase API calls always go to the network.
// Bump VERSION whenever you change any file below.
const VERSION = 'v11';
const CACHE = `studio-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './vendor/supabase.js',
  './js/main.js',
  './js/config.js',
  './js/lib.js',
  './js/backend.js',
  './js/store.js',
  './js/ui-state.js',
  './js/forms.js',
  './js/files.js',
  './js/money.js',
  './js/pdf.js',
  './js/views/common.js',
  './js/views/auth.js',
  './js/views/overview.js',
  './js/views/projects.js',
  './js/views/project.js',
  './js/views/deliverables.js',
  './js/views/money.js',
  './js/views/order.js',
  './js/views/shipping.js',
  './js/views/calendar.js',
  './js/views/activity.js',
  './js/views/clients.js',
  './js/views/tasks.js',
  './js/views/team.js',
  './icons/icon.svg',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cached => {
      const network = fetch(req)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
