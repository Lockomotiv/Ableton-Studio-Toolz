// Offline-Cache für die Browser-Version (in der App liegen die Dateien ohnehin lokal).
const CACHE = 'fh3-v1';
const FILES = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/ui.js', 'js/store.js', 'js/native.js', 'js/voice.js', 'js/nlp.js', 'js/recur.js', 'js/domain.js', 'js/views.js', 'js/more.js', 'js/capture.js', 'js/editors.js', 'img/icon.svg', 'manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || u.pathname.includes('/api/') || u.pathname.endsWith('/healthz')) return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});
