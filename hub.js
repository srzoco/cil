/* Barquero — menú principal: inicio de sesión único y módulos según los accesos de cada persona. */
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
    { id: 'contenido', nombre: 'Contenido', desc: 'Reels, carruseles y grabaciones', href: 'https://srzoco.github.io/contenidoBF/', nota: 'Por ahora abre su app de siempre',
      ic: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4-2.5z"/></svg>' },
    { id: 'mensajes', nombre: 'Armador de mensajes', desc: 'Respuestas con precios y descuento del día', href: 'https://srzoco.github.io/mensajesBF/', nota: 'Por ahora abre su app de siempre',
      ic: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 11h7M8.5 14h4"/></svg>' }
  ];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function leer() { try { return JSON.parse(localStorage.getItem(CLAVE) || 'null'); } catch (e) { return null; } }
  function guardar(d) {
    var ses = { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600), user: { id: d.user.id, email: d.user.email } };
    try { localStorage.setItem(CLAVE, JSON.stringify(ses)); } catch (e) { /* sin almacenamiento */ }
    return ses;
  }
  function olvidar() { try { localStorage.removeItem(CLAVE); Object.keys(localStorage).forEach(function (k) { if (k.indexOf('barquero_cache_') === 0) localStorage.removeItem(k); }); } catch (e) { /* nada */ } }
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
      '<div class="hub-logo">B</div><h1>Barquero</h1><p>Entra con tu correo y tu clave</p>' + (error ? '<p class="hub-error">' + esc(error) + '</p>' : '') +
      '<label>Correo<input name="email" type="email" autocomplete="username" required></label>' +
      '<label>Clave<input name="clave" type="password" autocomplete="current-password" required></label>' +
      '<button class="btn-hub" type="submit">Entrar</button></form></div>';
    document.getElementById('login').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = new FormData(ev.target), b = ev.target.querySelector('button'); b.disabled = true; b.textContent = 'Entrando…';
      auth('token?grant_type=password', { email: String(f.get('email') || '').trim(), password: f.get('clave') }).then(function (r) {
        if (!r.ok) throw new Error(r.status === 400 ? 'Correo o clave incorrectos.' : 'No se pudo entrar (' + r.status + ').');
        return r.json();
      }).then(function (d) { guardar(d); cargar(); }, function (e) { login(e.message === 'Failed to fetch' ? 'No hay conexión. Revisa el internet.' : e.message); });
    });
  }

  function menu(p) {
    var admin = p.rol === 'admin' && p.activo;
    var mios = MODULOS.filter(function (m) { return admin || (p.accesos || []).indexOf(m.id) >= 0; });
    if (!p.activo) mios = [];
    // Un solo módulo (por ejemplo, el personal de mantenimiento): directo a él
    if (!admin && mios.length === 1 && !sessionStorage.getItem('barquero_en_menu')) { location.replace(mios[0].href); return; }
    var nombre = (p.nombre || '').split(' ')[0] || (p.email || '').split('@')[0];
    var h = new Date().getHours(), saludo = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
    var html = '<div class="hub"><header class="hub-top"><a class="hub-marca" href="./"><span class="hub-logo">B</span><b>Barquero</b></a>' +
      (window.BarqueroTema ? BarqueroTema.boton() : '') + '<button class="hub-salir" id="salir">Salir</button></header>' +
      '<h1 class="hub-hola">' + esc(saludo) + (nombre ? ', ' + esc(nombre) : '') + '</h1>';
    if (!mios.length) {
      html += '<p class="hub-sub">' + (p.activo ? 'Todavía no tienes acceso a ningún módulo. Avísale a gerencia.' : 'Tu usuario está desactivado. Habla con gerencia.') + '</p>';
    } else {
      html += '<p class="hub-sub">¿Qué vas a hacer?</p><div class="modulos">' + mios.map(function (m) {
        return '<a class="modulo" href="' + esc(m.href) + '"><span class="modulo-ic">' + m.ic + '</span><span class="modulo-txt"><b>' + esc(m.nombre) + '</b><span>' + esc(m.desc) + '</span>' +
          (m.nota ? '<br><span class="modulo-nota">' + esc(m.nota) + '</span>' : '') + '</span><span class="modulo-flecha">›</span></a>';
      }).join('') + '</div>';
    }
    if (admin) {
      html += '<h2 class="hub-sec">Gerencia</h2><div class="modulos"><a class="modulo" href="tareas/#/equipo"><span class="modulo-ic"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.6 14.2c2.4-.3 4.3 1.2 4.9 4.3"/></svg></span>' +
        '<span class="modulo-txt"><b>Personas y accesos</b><span>Quién entra a qué, y quién es de gerencia</span></span><span class="modulo-flecha">›</span></a></div>';
    }
    html += '</div>';
    $.innerHTML = html;
    try { sessionStorage.setItem('barquero_en_menu', '1'); } catch (e) { /* nada */ }
    document.getElementById('salir').addEventListener('click', function () {
      var s = leer(); olvidar(); if (s) auth('logout', {}, s.access_token).catch(function () { /* da igual */ }); login();
    });
  }

  function cargar() {
    if (!URL_SB || !KEY) { location.replace('tareas/'); return; }  // sin base de datos: demo de Tareas
    var s = leer(); if (!s) { login(); return; }
    $.innerHTML = '<div class="hub-centro"><div class="hub-spinner"></div></div>';
    rest('personas?select=nombre,email,rol,accesos,activo&id=eq.' + encodeURIComponent(s.user.id)).then(function (r) {
      var p = r && r[0];
      if (!p) { $.innerHTML = '<div class="hub-centro"><h2>Tu usuario no está en la lista</h2><p>Avísale a gerencia.</p><button class="hub-salir" id="salir2">Salir</button></div>'; document.getElementById('salir2').onclick = function () { olvidar(); login(); }; return; }
      menu(p);
    }, function (e) {
      if (e.message === 'sesion' || e.status === 401) { olvidar(); login('Tu sesión expiró. Vuelve a entrar.'); return; }
      if (/does not exist|could not find/i.test(e.message)) { $.innerHTML = '<div class="hub-centro"><h2>Falta preparar la base de datos</h2><p>Hay que ejecutar <b>barquero.sql</b> en Supabase (paso 2 de la guía).</p></div>'; return; }
      $.innerHTML = '<div class="hub-centro"><h2>No se pudo cargar</h2><p>' + esc(e.message === 'Failed to fetch' ? 'No hay conexión. Revisa el internet.' : e.message) + '</p><button class="btn-hub" style="max-width:240px" onclick="location.reload()">Reintentar</button></div>';
    });
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:' && URL_SB) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function () { /* nada */ });
  cargar();
})();
