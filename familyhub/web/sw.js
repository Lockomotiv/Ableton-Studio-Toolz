// Offline-Cache für die Browser-Version (in der App liegen die Dateien ohnehin lokal).
const CACHE = 'fh4-v11';
const FILES = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/ui.js', 'js/store.js', 'js/native.js', 'js/voice.js', 'js/nlp.js', 'js/recur.js', 'js/domain.js', 'js/views.js', 'js/more.js', 'js/capture.js', 'js/editors.js', 'js/household.js', 'js/kitchen.js', 'js/wall.js', 'js/extcal.js', 'js/icsparse.js', 'js/recipeimport.js', 'js/coach.js', 'js/commands.js', 'js/photos.js', 'js/family.js', 'js/budget.js', 'js/budgetcats.js', 'js/docs.js', 'js/waste.js', 'js/wastetypes.js', 'js/iphone.js', 'js/catalog.js', 'js/shopping.js', 'js/weather.js', 'js/weathercore.js', 'js/login.js', 'js/dashboard.js', 'js/gamify.js', 'js/legacy.js', 'js/fx.js', 'js/icons.js', 'fonts/manrope.woff2', 'img/icon-180.png', 'img/icon-192.png', 'img/icon-512.png', 'img/icon.svg', 'manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || u.pathname.includes('/api/') || u.pathname.endsWith('/healthz')) return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});

// Push vom Pi (iPhone-Web-App ab iOS 16.4, Android-/Desktop-Browser)
self.addEventListener('push', (e) => {
  let m = {}; try { m = e.data ? e.data.json() : {}; } catch { m = { title: 'FamilyHub', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(m.title || 'FamilyHub', { body: m.body || '', tag: m.tag, icon: 'img/icon-192.png', badge: 'img/icon-192.png', data: { url: m.url || '#heute' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '#heute';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { c.postMessage({ url }); return c.focus(); }
    return self.clients.openWindow('./' + url);
  }));
});
