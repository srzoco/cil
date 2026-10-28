/* CIL — guarda la app en el teléfono para que abra al instante (menú y módulos).
   Los datos (Supabase) nunca se guardan aquí: siempre se piden a internet.
   Al publicar una versión nueva, se sube el número de VERSION y el ?v= de index.html. */
var VERSION = 'cil-v65';
var ARCHIVOS = ['./', 'index.html', 'comun/tema.css?v=2', 'comun/tema.js?v=1', 'comun/hub.css?v=6', 'comun/hub.js?v=13',
  'tareas/', 'tareas/styles.css?v=28', 'tareas/logic.js?v=25', 'tareas/store.js?v=38', 'tareas/app.js?v=53', 'pendientes/', 'pendientes/styles.css?v=2', 'pendientes/app.js?v=6',
  'mensajes/', 'contenido/', 'contenido/styles.css?v=4', 'contenido/logic.js?v=3', 'contenido/demo.js?v=1', 'contenido/store.js?v=2', 'contenido/app.js?v=6',
  'manifest.webmanifest', 'icon-192.png'];

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
  // La página: primero internet (para ver los cambios), pero si tarda más de 1,5 s se abre lo guardado
  // y lo nuevo queda guardado para la próxima vez. Con internet lento ya no se queda la pantalla en blanco.
  // config.js casi nunca cambia: lo guardado de una vez, y se actualiza por detrás.
  if (req.mode === 'navigate' || /config\.js$/.test(url.pathname)) {
    var red = fetch(req).then(function (r) {
      if (r.ok) { var copia = r.clone(); caches.open(VERSION).then(function (c) { c.put(req, copia); }); }
      return r;
    });
    var guardado = caches.match(req, { ignoreSearch: true });
    e.waitUntil(red.catch(function () { /* sin internet */ }));
    if (/config\.js$/.test(url.pathname)) {
      e.respondWith(guardado.then(function (hit) { return hit || red; }));
      return;
    }
    e.respondWith(new Promise(function (ok, mal) {
      var listo = false, fin = function (r) { if (!listo && r) { listo = true; ok(r); } };
      var plan = function () { guardado.then(function (hit) { if (hit) fin(hit); else red.then(fin, function () { caches.match('index.html').then(function (x) { if (x) fin(x); else mal(new Error('sin red')); }); }); }); };
      var t = setTimeout(plan, 1500);
      red.then(function (r) { clearTimeout(t); fin(r); }, function () { clearTimeout(t); plan(); });
    }));
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
