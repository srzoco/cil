/* CIL — guarda la app en el teléfono para que abra al instante (menú y módulos).
   Los datos (Supabase) nunca se guardan aquí: siempre se piden a internet.
   Al publicar una versión nueva, se sube el número de VERSION y el ?v= de index.html. */
var VERSION = 'cil-v25';
var ARCHIVOS = ['./', 'index.html', 'comun/tema.css?v=2', 'comun/tema.js?v=1', 'comun/hub.css?v=5', 'comun/hub.js?v=7',
  'tareas/', 'tareas/styles.css?v=19', 'tareas/logic.js?v=18', 'tareas/store.js?v=24', 'tareas/app.js?v=30', 'manifest.webmanifest', 'icon-192.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(ARCHIVOS); }).catch(function () { /* se llena después */ }));
  self.skipWaiting();
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;  // Supabase y lo demás: directo a internet
  // La página y config.js: primero internet (para ver cambios); si no hay, lo guardado
  if (req.mode === 'navigate' || /config\.js$/.test(url.pathname)) {
    e.respondWith(fetch(req).then(function (r) {
      if (r.ok) { var copia = r.clone(); caches.open(VERSION).then(function (c) { c.put(req, copia); }); }
      return r;
    }).catch(function () { return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match('index.html'); }); }));
    return;
  }
  // Archivos con versión (?v=): lo guardado primero
  e.respondWith(caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (r) {
      if (r.ok) { var copia = r.clone(); caches.open(VERSION).then(function (c) { c.put(req, copia); }); }
      return r;
    });
  }));
});

// Avisos (notificaciones push): los manda la función «avisos» de Supabase
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { cuerpo: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Tareas CIL', {
    body: d.cuerpo || '', icon: 'icon-192.png', badge: 'icon-192.png', data: { url: d.url || './' }, vibrate: [120, 60, 120]
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) { if (cs[i].url.indexOf(self.registration.scope) === 0 && 'focus' in cs[i]) { cs[i].navigate(url); return cs[i].focus(); } }
    return self.clients.openWindow(url);
  }));
});
