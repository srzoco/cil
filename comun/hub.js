/* CIL — menú principal: inicio de sesión único y módulos según los accesos de cada persona. */
(function () {
  'use strict';
  var CFG = window.BARQUERO_CONFIG || {};
  var URL_SB = String(CFG.supabaseUrl || '').replace(/\/+$/, ''), KEY = CFG.supabaseKey;
  var CLAVE = 'barquero_sesion';
  var $ = document.getElementById('hub');
  // Módulos: los de la fase 2 y 3 abren por ahora su app de siempre (con su propio inicio de sesión)
  var MODULOS = [
    { id: 'tareas', nombre: 'Tareas', desc: 'Llegada, tareas del día, reporte y temperaturas', href: 'tareas/',
      ic: '<svg viewBox="0 0 24 24"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/></svg>' },
    { id: 'contenido', nombre: 'Contenido', desc: 'Reels, carruseles y grabaciones', href: 'contenido/',
      ic: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4-2.5z"/></svg>' },
    { id: 'pendientes', nombre: 'Pendientes', desc: 'Recordatorios y pedidos entre gerencia', href: 'pendientes/', soloGerencia: true,
      ic: '<svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4V3h6v1"/><path d="M8.5 10.5l1.5 1.5 3-3M8.5 16h7"/></svg>' },
    { id: 'mensajes', nombre: 'Armador de mensajes', desc: 'Respuestas con precios y descuento del día', href: 'mensajes/',
      ic: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 11h7M8.5 14h4"/></svg>' }
  ];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // La sesión se comparte con Contenido («bfcontenido_sesion», mismo sitio): se usa la más reciente de las dos
  // y se guarda en ambas, para no pedir la clave otra vez al abrir Contenido.
  var CLAVES = [CLAVE, 'bfcontenido_sesion'];
  // Seguridad: si quedaron guardadas sesiones de personas DISTINTAS en este teléfono, no se usa ninguna (se pide entrar)
  function leer() {
    var mejor = null, usuarios = {};
    CLAVES.forEach(function (k) { var x = null; try { x = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { /* nada */ } if (x && x.refresh_token && x.user) { usuarios[x.user.id] = 1; if (!mejor || (x.expires_at || 0) > (mejor.expires_at || 0)) mejor = x; } });
    if (Object.keys(usuarios).length > 1) { olvidar(); return null; }
    return mejor;
  }
  function guardar(d, esEntrada) {
    // al renovar: si mientras tanto entró otra persona en este teléfono, no se escribe encima de su sesión
    var actual = leer();
    if (!esEntrada && actual && actual.user.id !== d.user.id) throw new Error('sesion');
    if (esEntrada) olvidar();
    var ses = { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600), user: { id: d.user.id, email: d.user.email } };
    CLAVES.forEach(function (k) { try { localStorage.setItem(k, JSON.stringify(ses)); } catch (e) { /* sin almacenamiento */ } });
    return ses;
  }
  function olvidar() { try { CLAVES.forEach(function (k) { localStorage.removeItem(k); }); localStorage.removeItem('barquero_directo'); Object.keys(localStorage).forEach(function (k) { if (k.indexOf('barquero_cache_') === 0) localStorage.removeItem(k); }); } catch (e) { /* nada */ } }
  function auth(ruta, cuerpo, tok) {
    var h = { apikey: KEY, 'Content-Type': 'application/json' }; if (tok) h.Authorization = 'Bearer ' + tok;
    return fetch(URL_SB + '/auth/v1/' + ruta, { method: 'POST', headers: h, body: JSON.stringify(cuerpo || {}) });
  }
  function token() {
    var s = leer(); if (!s) return Promise.reject(new Error('sesion'));
    if (s.expires_at - 60 > Date.now() / 1000) return Promise.resolve(s.access_token);
    return auth('token?grant_type=refresh_token', { refresh_token: s.refresh_token }).then(function (r) {
      if (!r.ok) { olvidar(); throw new Error('sesion'); }
      return r.json().then(function (d) { return guardar(d).access_token; });
    });
  }
  function rest(ruta) {
    return token().then(function (t) { return fetch(URL_SB + '/rest/v1/' + ruta, { headers: { apikey: KEY, Authorization: 'Bearer ' + t } }); })
      .then(function (r) { return r.text().then(function (x) { var c = null; try { c = JSON.parse(x); } catch (e) { c = x; } if (!r.ok) { var e2 = new Error((c && c.message) || ('Error ' + r.status)); e2.status = r.status; throw e2; } return c; }); });
  }

  function login(error) {
    $.innerHTML = '<div class="hub-tema">' + (window.BarqueroTema ? BarqueroTema.boton() : '') + '</div><div class="hub-centro"><form class="login" id="login">' +
      '<div class="hub-logo">CIL</div><h1>CIL</h1><p>Entra con tu correo y tu clave</p>' + (error ? '<p class="hub-error">' + esc(error) + '</p>' : '') +
      '<label>Correo<input name="email" type="email" autocomplete="username" required></label>' +
      '<label>Clave<input name="clave" type="password" autocomplete="current-password" required></label>' +
      '<button class="btn-hub" type="submit">Entrar</button></form></div>';
    document.getElementById('login').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = new FormData(ev.target), b = ev.target.querySelector('button'); b.disabled = true; b.textContent = 'Entrando…';
      auth('token?grant_type=password', { email: String(f.get('email') || '').trim(), password: f.get('clave') }).then(function (r) {
        if (!r.ok) throw new Error(r.status === 400 ? 'Correo o clave incorrectos.' : 'No se pudo entrar (' + r.status + ').');
        return r.json();
      }).then(function (d) { guardar(d, true); cargar(); }, function (e) { login(e.message === 'Failed to fetch' ? 'No hay conexión. Revisa el internet.' : e.message); });
    });
  }

  function menu(p) {
    var admin = p.rol === 'admin' && p.activo;
    var mios = MODULOS.filter(function (m) { return admin || (!m.soloGerencia && (p.accesos || []).indexOf(m.id) >= 0); });
    if (!p.activo) mios = [];
    // Un solo módulo (por ejemplo, el personal de mantenimiento): directo a él
    // (?avisos: viene de «Activar avisos» en Contenido; se queda en el menú para mostrar la tarjeta)
    // (se recuerda en el teléfono: la próxima vez index.html salta directo, sin esperar al menú)
    var directo = !admin && mios.length === 1 ? mios[0].href : null;
    try { if (directo) localStorage.setItem('barquero_directo', directo); else localStorage.removeItem('barquero_directo'); } catch (e) { /* nada */ }
    if (directo && !sessionStorage.getItem('barquero_en_menu') && !/avisos/.test(location.search)) { location.replace(directo); return; }
    var nombre = (p.nombre || '').split(' ')[0] || (p.email || '').split('@')[0];
    var h = new Date().getHours(), saludo = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
    var html = '<div class="hub"><header class="hub-top"><a class="hub-marca" href="./"><span class="hub-logo">CIL</span><b>CIL</b></a>' +
      (window.BarqueroTema ? BarqueroTema.boton() : '') + '<button class="hub-salir" id="salir">Salir</button></header>' +
      '<h1 class="hub-hola">' + esc(saludo) + (nombre ? ', ' + esc(nombre) : '') + '</h1>' + (admin ? '<a class="hub-reloj" id="hub-reloj" href="tareas/#/" hidden></a>' : '');
    if (!mios.length) {
      html += '<p class="hub-sub">' + (p.activo ? 'Todavía no tienes acceso a ningún módulo. Avísale a gerencia.' : 'Tu usuario está desactivado. Habla con gerencia.') + '</p>';
    } else {
      html += '<p class="hub-sub">¿Qué vas a hacer?</p><div class="modulos">' + mios.map(function (m) {
        return '<a class="modulo" href="' + esc(m.href) + '"><span class="modulo-ic">' + m.ic + '<span class="modulo-badge" data-pend="' + m.id + '" hidden></span></span><span class="modulo-txt"><b>' + esc(m.nombre) + '</b><span>' + esc(m.desc) + '</span>' +
          (m.nota ? '<br><span class="modulo-nota">' + esc(m.nota) + '</span>' : '') + '</span><span class="modulo-flecha">›</span></a>';
      }).join('') + '</div>';
    }
    if (admin) {
      html += '<h2 class="hub-sec">Gerencia</h2><div class="modulos"><a class="modulo" href="tareas/#/equipo/personas"><span class="modulo-ic"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.6 14.2c2.4-.3 4.3 1.2 4.9 4.3"/></svg></span>' +
        '<span class="modulo-txt"><b>Personas y accesos</b><span>Quién entra a qué, y quién es de gerencia</span></span><span class="modulo-flecha">›</span></a></div>';
    }
    if (mios.length) html += '<div id="hub-avisos"></div>';
    html += '<p class="hub-ayuda"><a href="tareas/#/ayuda">¿Cómo se usa la app?</a></p></div>';
    $.innerHTML = html;
    pintarAvisos();
    try { sessionStorage.setItem('barquero_en_menu', '1'); } catch (e) { /* nada */ }
    // Lo pendiente de cada módulo llega después: el menú no lo espera
    token().then(function (t) {
      return fetch(URL_SB + '/rest/v1/rpc/menu_pendientes', { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: '{}' });
    }).then(function (r) { return r.ok ? r.json() : {}; }).then(function (n) {
      if (n && n.reloj_min > 10) {
        var av = document.getElementById('hub-reloj');
        if (av) { av.hidden = false; av.innerHTML = '<b>Los avisos no están saliendo</b><span>El reloj de avisos no corre hace ' + (n.reloj_min < 120 ? n.reloj_min + ' min' : Math.round(n.reloj_min / 60) + ' horas') + '. Detalle en Tareas → Hoy.</span>'; }
      }
      Object.keys(n || {}).forEach(function (k) {
        var b = document.querySelector('[data-pend="' + k + '"]');
        if (b && n[k] > 0) { b.textContent = n[k] > 99 ? '99+' : n[k]; b.hidden = false; b.setAttribute('aria-label', n[k] + ' pendientes'); }
      });
    }).catch(function () { /* sin números: el menú funciona igual */ });
    document.getElementById('salir').addEventListener('click', function () {
      var s = leer(); olvidar(); if (s) auth('logout', {}, s.access_token).catch(function () { /* da igual */ }); login();
    });
  }

  // ---------- Avisos en el teléfono: uno solo para todos los módulos (Tareas y Contenido) ----------
  function b64aBytes(t) { t = String(t).replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; var b = atob(t), o = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }
  function esIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1); }
  function instalada() { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone; }
  function rpc(nombre, cuerpo) {
    return token().then(function (t) {
      return fetch(URL_SB + '/rest/v1/rpc/' + nombre, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo || {}) });
    }).then(function (r) { if (!r.ok) return r.text().then(function (x) { var m = x; try { m = JSON.parse(x).message || x; } catch (e) { /* nada */ } throw new Error(m); }); });
  }
  function estadoAvisos() {
    if (!CFG.vapidPublicKey || !('serviceWorker' in navigator) || location.protocol !== 'https:') return Promise.resolve('no');
    if (esIOS() && !instalada()) return Promise.resolve('ios');
    if (!('PushManager' in window) || !('Notification' in window)) return Promise.resolve('no');
    if (Notification.permission === 'denied') return Promise.resolve('bloqueado');
    return navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
      if (sub && Notification.permission === 'granted') {
        // se vuelve a guardar por si el teléfono cambió la suscripción
        var j = sub.toJSON(); rpc('guardar_suscripcion', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth }).catch(function () { /* nada */ });
        return 'on';
      }
      return 'off';
    }, function () { return 'no'; });
  }
  function pintarAvisos(msg) {
    var c = document.getElementById('hub-avisos'); if (!c) return;
    estadoAvisos().then(function (e) {
      var t = {
        ios: '<b>Avisos en el teléfono</b><span>En iPhone, primero instala la app: Compartir → «Agregar a inicio», y ábrela desde el ícono.</span>',
        bloqueado: '<b>Avisos bloqueados</b><span>Actívalos en los ajustes del navegador para esta página.</span>',
        off: '<b>Avisos en el teléfono</b><span>Te avisa cuando te toca algo, en Tareas y en Contenido.</span><button class="btn-hub chico" id="activar-avisos">Activar</button>',
        on: '<b>Avisos activados</b><span>en este teléfono, para todos los módulos.</span><button class="hub-salir" id="probar-avisos">Enviarme uno de prueba</button>'
      }[e];
      c.innerHTML = t ? '<div class="hub-avisos' + (e === 'on' ? ' on' : '') + '">' + t + (msg ? '<small>' + esc(msg) + '</small>' : '') + '</div>' : '';
      var a = document.getElementById('activar-avisos');
      if (a) a.onclick = function () {
        a.disabled = true; a.textContent = 'Activando…';
        Notification.requestPermission().then(function (perm) {
          if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Bloqueaste los avisos. Actívalos en los ajustes del navegador.' : 'No se activaron los avisos.');
          return navigator.serviceWorker.ready;
        }).then(function (reg) {
          return reg.pushManager.getSubscription().then(function (sub) { return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64aBytes(CFG.vapidPublicKey) }); });
        }).then(function (sub) {
          var j = sub.toJSON(); return rpc('guardar_suscripcion', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
        }).then(function () { pintarAvisos('Listo: te llegarán los avisos en este teléfono.'); }, function (err) { pintarAvisos(err && err.message ? err.message : 'No se pudieron activar.'); });
      };
      var pr = document.getElementById('probar-avisos');
      if (pr) pr.onclick = function () { pr.disabled = true; rpc('aviso_prueba').then(function () { pintarAvisos('Te debería llegar en menos de un minuto.'); }, function (err) { pintarAvisos(err.message); }); };
    });
  }

  function cargar() {
    if (!URL_SB || !KEY) { location.replace('tareas/'); return; }  // sin base de datos: demo de Tareas
    var s = leer(); if (!s) { login(); return; }
    CLAVES.forEach(function (k) { try { localStorage.setItem(k, JSON.stringify(s)); } catch (e) { /* nada */ } });  // Contenido la encuentra al abrir
    // Abre al instante con el último menú visto en este teléfono y lo confirma por detrás
    var CACHE = 'barquero_cache_menu_' + s.user.id, previo = null;
    try { previo = JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch (e) { /* nada */ }
    if (previo) menu(previo); else $.innerHTML = '<div class="hub-centro"><div class="hub-spinner"></div></div>';
    rest('personas?select=nombre,email,rol,accesos,activo&id=eq.' + encodeURIComponent(s.user.id)).then(function (r) {
      var p = r && r[0];
      try { if (p) localStorage.setItem(CACHE, JSON.stringify(p)); } catch (e) { /* nada */ }
      if (p && previo && JSON.stringify(p) === JSON.stringify(previo)) return;  // ya está pintado
      if (!p) { $.innerHTML = '<div class="hub-centro"><h2>Tu usuario no está en la lista</h2><p>Avísale a gerencia.</p><button class="hub-salir" id="salir2">Salir</button></div>'; document.getElementById('salir2').onclick = function () { olvidar(); login(); }; return; }
      menu(p);
    }, function (e) {
      if (e.message === 'sesion' || e.status === 401) { olvidar(); login('Tu sesión expiró. Vuelve a entrar.'); return; }
      if (previo) return;  // sin internet: se queda el menú guardado
      if (/does not exist|could not find/i.test(e.message)) { $.innerHTML = '<div class="hub-centro"><h2>Falta preparar la base de datos</h2><p>Hay que ejecutar <b>cil.sql</b> en Supabase (paso 2 de la guía).</p></div>'; return; }
      $.innerHTML = '<div class="hub-centro"><h2>No se pudo cargar</h2><p>' + esc(e.message === 'Failed to fetch' ? 'No hay conexión. Revisa el internet.' : e.message) + '</p><button class="btn-hub" style="max-width:240px" onclick="location.reload()">Reintentar</button></div>';
    });
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:' && URL_SB) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function () { /* nada */ });
  cargar();
})();
