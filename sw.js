/* CIL — guarda la app en el teléfono para que abra al instante (menú y módulos).
   Los datos (Supabase) nunca se guardan aquí: siempre se piden a internet.
   Al publicar una versión nueva, se sube el número de VERSION y el ?v= de index.html. */
var VERSION = 'cil-v103';
var ARCHIVOS = ['./', 'index.html', 'comun/tema.css?v=3', 'comun/tema.js?v=4', 'comun/cambiar.js?v=2', 'comun/hub.css?v=8', 'comun/hub.js?v=15',
  'tareas/', 'tareas/styles.css?v=33', 'tareas/logic.js?v=28', 'tareas/store.js?v=42', 'tareas/app.js?v=65', 'pendientes/', 'pendientes/styles.css?v=4', 'pendientes/app.js?v=9',
  'mensajes/', 'contenido/', 'contenido/styles.css?v=9', 'contenido/logic.js?v=8', 'contenido/demo.js?v=1', 'contenido/store.js?v=3', 'contenido/app.js?v=14',
  'manifest.webmanifest', 'icon-192.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(ARCHIVOS); }).catch(function () { /* se llena después */ }));
  self.skipWaiting();
});
self.addEventListener('activate', function (e) {
  // Se guarda también la versión anterior: una página que abrió con ella sigue encontrando sus archivos (no se mezclan versiones)
  e.waitUntil(caches.keys().then(function (ks) {
    var viejas = ks.filter(function (k) { return k !== VERSION; });
    return Promise.all(viejas.slice(0, -1).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;  // Supabase y lo demás: directo a internet
  // La página y config.js: lo guardado al instante (abrir o cambiar de herramienta no espera a internet)
  // y lo nuevo se guarda por detrás para la próxima vez. Si no hay nada guardado, se espera a internet.
  // Si hay una versión nueva, la página se entera y se actualiza (ver abajo).
  if (req.mode === 'navigate' || /config\.js$/.test(url.pathname)) {
    var red = fetch(req).then(function (r) {
      if (r.ok) { var copia = r.clone(); caches.open(VERSION).then(function (c) { c.put(req, copia); }); }
      return r;
    });
    // primero en la versión actual (la anterior también se guarda, pero ahí la página es vieja)
    var guardado = caches.open(VERSION).then(function (c) { return c.match(req, { ignoreSearch: true }); })
      .then(function (hit) { return hit || caches.match(req, { ignoreSearch: true }); });
    e.waitUntil(red.catch(function () { /* sin internet */ }));
    e.respondWith(guardado.then(function (hit) {
      // Si se abrió lo guardado y en internet ya hay otra versión de la página, se le avisa a la página
      // (comun/tema.js la recarga sola si recién abrió y nadie está escribiendo; si no, muestra «Actualizar»)
      if (hit && req.mode === 'navigate') e.waitUntil(red.then(function (r) {
        if (!r.ok) return;
        return Promise.all([hit.clone().text(), r.clone().text()]).then(function (t) {
          if (t[0] === t[1]) return;
          return self.clients.get(e.resultingClientId || e.clientId).then(function (cl) {
            if (cl) cl.postMessage({ tipo: 'nueva-version' });
          });
        });
      }).catch(function () { /* sin internet */ }));
      return hit || red.catch(function () { return caches.match('index.html').then(function (x) { if (x) return x; throw new Error('sin red'); }); });
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
  var u = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope), raiz = new URL(self.registration.scope);
  // Los avisos de Tareas vienen como «./#/…» (la raíz es el menú de CIL): se abren dentro de Tareas
  if (u.origin === raiz.origin && u.pathname === raiz.pathname && u.hash.indexOf('#/') === 0) u = new URL('tareas/' + u.hash, raiz);
  var url = u.href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) { if (cs[i].url.indexOf(self.registration.scope) === 0 && 'focus' in cs[i]) { cs[i].navigate(url); return cs[i].focus(); } }
    return self.clients.openWindow(url);
  }));
});
