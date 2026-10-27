/* CIL — Pendientes de gerencia: recordatorios propios y pedidos entre personas de gerencia.
   Todo pasa por las funciones pend_* de supabase/cil.sql. Las fotos van a la carpeta privada «pendientes». */
(function () {
  'use strict';
  var CFG = window.BARQUERO_CONFIG || {};
  var URL_SB = String(CFG.supabaseUrl || '').replace(/\/+$/, ''), KEY = CFG.supabaseKey;
  var CLAVES = ['barquero_sesion', 'bfcontenido_sesion'];
  var $app = document.getElementById('app');
  var S = { d: null, hilos: {}, fotos: {}, foto: null, borrando: false, ocupado: false, nuevoId: null };
  var REPITE = { '': 'No se repite', diaria: 'Cada día', semanal: 'Cada semana', semanas2: 'Cada 2 semanas', semanas3: 'Cada 3 semanas', mensual: 'Cada mes' };
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // ---------- Sesión (la misma del menú de CIL) ----------
  // Seguridad: si quedaron sesiones de personas DISTINTAS en este teléfono, no se usa ninguna (se pide entrar)
  function leer() {
    var mejor = null, usuarios = {};
    CLAVES.forEach(function (k) { var x = null; try { x = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { /* nada */ } if (x && x.refresh_token && x.user) { usuarios[x.user.id] = 1; if (!mejor || (x.expires_at || 0) > (mejor.expires_at || 0)) mejor = x; } });
    if (Object.keys(usuarios).length > 1) { CLAVES.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) { /* nada */ } }); return null; }
    return mejor;
  }
  function guardar(d) {
    // al renovar: si mientras tanto entró otra persona en este teléfono, no se escribe encima de su sesión
    var actual = leer();
    if (actual && actual.user.id !== d.user.id) throw new Error('sesion');
    var ses = { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600), user: { id: d.user.id, email: d.user.email } };
    CLAVES.forEach(function (k) { try { localStorage.setItem(k, JSON.stringify(ses)); } catch (e) { /* nada */ } });
    return ses;
  }
  function token() {
    var s = leer(); if (!s) return Promise.reject(new Error('sesion'));
    if (s.expires_at - 60 > Date.now() / 1000) return Promise.resolve(s.access_token);
    return fetch(URL_SB + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }) })
      .then(function (r) { if (!r.ok) throw new Error('sesion'); return r.json(); }).then(function (d) { return guardar(d).access_token; });
  }
  function rpc(fn, args) {
    return token().then(function (t) {
      return fetch(URL_SB + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}) });
    }).then(function (r) {
      return r.text().then(function (x) {
        var c = null; try { c = x ? JSON.parse(x) : null; } catch (e) { c = x; }
        if (!r.ok) throw new Error((c && c.message) || ('Error ' + r.status));
        return c;
      });
    });
  }
  function almacen(metodo, ruta, cuerpo, tipo) {
    return token().then(function (t) {
      var h = { apikey: KEY, Authorization: 'Bearer ' + t }; if (tipo) h['Content-Type'] = tipo;
      return fetch(URL_SB + '/storage/v1/object/' + ruta, { method: metodo, headers: h, body: cuerpo });
    });
  }

  // ---------- Utilidades ----------
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fecha(f) { if (!f) return ''; var p = f.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]); return DIAS[d.getDay()] + ' ' + d.getDate() + ' ' + MESES[d.getMonth()]; }
  function hora(h) { if (!h) return ''; var p = h.split(':'), n = +p[0]; return (n % 12 || 12) + ':' + p[1] + (n < 12 ? ' a. m.' : ' p. m.'); }
  function cuando(ts) {
    var d = new Date(ts), hoy = iso(new Date()), f = iso(d);
    var h = (d.getHours() % 12 || 12) + ':' + ('0' + d.getMinutes()).slice(-2) + (d.getHours() < 12 ? ' a. m.' : ' p. m.');
    return f === hoy ? h : fecha(f) + ', ' + h;
  }
  function nombre(id) {
    if (!S.d) return '';
    if (id === S.d.yo) return 'Tú';
    var p = (S.d.gerencia || []).filter(function (x) { return x.id === id; })[0];
    return p ? p.nombre.split(' ')[0] : 'Alguien';
  }
  function pend(id) { return ((S.d && S.d.pendientes) || []).filter(function (x) { return x.id === id; })[0]; }
  function otro(x) { return x.creado_por === S.d.yo ? x.para : x.creado_por; }
  function propio(x) { return x.creado_por === x.para; }
  function aviso(txt, ok) {
    [].forEach.call(document.querySelectorAll('.toast'), function (x) { x.remove(); });
    var t = document.createElement('div'); t.className = 'toast' + (ok ? ' ok' : ''); t.setAttribute('role', 'status'); t.textContent = txt; document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, ok ? 2600 : 5000);
  }
  function ruta() { var h = location.hash.replace(/^#\/?/, ''); var q = h.split('?'); return { partes: q[0].split('/').filter(Boolean), q: new URLSearchParams(q[1] || '') }; }

  // ---------- Datos ----------
  function cargar() {
    return rpc('pend_datos').then(function (d) { S.d = d; pintar(); limpiarFotos(); }, function (e) {
      if (e.message === 'sesion') { $app.innerHTML = '<div class="centro"><h1>Inicia sesión</h1><p class="muted">Entra primero desde el menú de CIL.</p><a class="btn" href="../">Ir al menú</a></div>'; return; }
      if (/Solo gerencia/.test(e.message)) { $app.innerHTML = '<div class="centro"><h1>Solo gerencia</h1><p class="muted">Esta página es para las personas de gerencia.</p><a class="btn" href="../">Volver al menú</a></div>'; return; }
      $app.innerHTML = '<div class="centro"><h1>No se pudo cargar</h1><p class="muted">' + esc(e.message === 'Failed to fetch' ? 'No hay conexión. Revisa el internet.' : e.message) + '</p><button class="btn" data-acc="recargar">Intentar de nuevo</button></div>';
    });
  }
  // Fotos de pendientes cerrados hace más de 60 días: se borran del almacenamiento (en silencio)
  var limpiado = false;
  function limpiarFotos() {
    if (limpiado) return; limpiado = true;
    rpc('pend_fotos_vencidas').then(function (fotos) {
      if (!fotos || !fotos.length) return;
      return almacen('DELETE', 'pendientes', JSON.stringify({ prefixes: fotos }), 'application/json').then(function (r) {
        if (r.ok) return rpc('pend_fotos_borradas', { p_fotos: fotos });
      });
    }).catch(function () { /* se intenta la próxima vez */ });
  }

  // ---------- Pantallas ----------
  function cabecera() {
    return '<header class="top"><a class="marca" href="../"><span class="logo">CIL</span><span class="marca-txt">Pendientes<small>Gerencia</small></span></a>' +
      (window.BarqueroTema ? BarqueroTema.boton() : '') + '</header>';
  }
  function pillsDe(x) {
    var h = '', hoy = S.d.hoy;
    if (propio(x)) h += '<span class="pill">Recordatorio</span>';
    else if (x.creado_por === S.d.yo) h += '<span class="pill edita">Para ' + esc(nombre(x.para)) + '</span>';
    else h += '<span class="pill espera">De ' + esc(nombre(x.creado_por)) + '</span>';
    if (x.vence && x.estado === 'abierto') {
      if (x.vence < hoy) h += '<span class="pill vence">Venció ' + esc(fecha(x.vence)) + '</span>';
      else if (x.vence === hoy) h += '<span class="pill hoy">Hoy' + (x.hora ? ' ' + esc(hora(x.hora)) : '') + '</span>';
      else h += '<span class="pill hora">' + esc(fecha(x.vence)) + (x.hora ? ' ' + esc(hora(x.hora)) : '') + '</span>';
    }
    if (x.hecho_en && x.estado === 'abierto') h += '<span class="pill aprueba">' + (x.creado_por === S.d.yo ? 'Por confirmar' : 'Esperando que ' + esc(nombre(x.creado_por)) + ' confirme') + '</span>';
    if (x.repite) h += '<span class="pill banco">' + esc(REPITE[x.repite]) + '</span>';
    if (x.estado === 'cerrado') h += '<span class="pill ok">Cerrado</span>';
    return h;
  }
  function item(x) {
    var u = x.ultimo, prev = u ? (u.autor === S.d.yo ? 'Tú: ' : nombre(u.autor) + ': ') + (u.texto || (u.foto ? '📷 Foto' : '')) : '';
    return '<a class="item" href="#/p/' + esc(x.id) + '">' + (x.nuevo ? '<span class="punto" aria-label="Nuevo"></span>' : '') +
      '<span class="item-cuerpo"><span class="item-titulo">' + esc(x.titulo) + '</span><span class="item-meta">' + pillsDe(x) + '</span>' +
      (prev ? '<span class="previa">' + esc(prev) + '</span>' : '') + '</span><span class="flecha">›</span></a>';
  }
  function lista(xs, vacio) { return xs.length ? '<div class="lista">' + xs.map(item).join('') + '</div>' : '<p class="muted vacio">' + esc(vacio) + '</p>'; }

  function vistaListas(tab) {
    var yo = S.d.yo, xs = S.d.pendientes || [];
    var abiertos = xs.filter(function (x) { return x.estado === 'abierto'; });
    var paraMi = abiertos.filter(function (x) { return x.para === yo; });
    var pedi = abiertos.filter(function (x) { return x.creado_por === yo && x.para !== yo; })
      .sort(function (a, b) { return (b.hecho_en ? 1 : 0) - (a.hecho_en ? 1 : 0); });  // lo «Por confirmar», arriba
    var cerrados = xs.filter(function (x) { return x.estado === 'cerrado'; }).sort(function (a, b) { return a.cerrado_en < b.cerrado_en ? 1 : -1; });
    var n = function (l) { var k = l.filter(function (x) { return x.nuevo || (x.vence && x.vence <= S.d.hoy) || (x.hecho_en && x.creado_por === S.d.yo); }).length; return k ? '<span class="num">' + k + '</span>' : ''; };
    var tabs = [['mi', 'Para mí', n(paraMi)], ['pedi', 'Lo que pedí', n(pedi)], ['personas', 'Por persona', ''], ['cerrados', 'Cerrados', '']];
    var h = '<h1>Pendientes</h1><div class="seg">' + tabs.map(function (t) { return '<a href="#/' + t[0] + '"' + (t[0] === tab ? ' class="activo"' : '') + '>' + t[1] + t[2] + '</a>'; }).join('') + '</div>';
    if (tab === 'mi') h += lista(paraMi, 'Nada pendiente para ti. 🎉');
    else if (tab === 'pedi') h += lista(pedi, 'No estás esperando respuesta de nadie.');
    else if (tab === 'cerrados') h += lista(cerrados, 'Todavía no hay pendientes cerrados.') + '<p class="nota-suave">Se muestran los cerrados de los últimos 60 días. Las fotos de un pendiente se borran 60 días después de cerrarlo.</p>';
    else {
      var otros = (S.d.gerencia || []).filter(function (p) { return p.id !== yo; });
      if (!otros.length) h += '<p class="muted vacio">Todavía no hay más personas de gerencia en CIL.</p>';
      otros.forEach(function (p) {
        var con = abiertos.filter(function (x) { return x.creado_por === p.id || x.para === p.id; });
        h += '<div class="persona-sec"><h2>' + esc(p.nombre) + '</h2><a class="btn chico sec" href="#/nuevo?para=' + esc(p.id) + '">Pedirle algo</a></div>' + lista(con, 'Nada pendiente con ' + p.nombre.split(' ')[0] + '.');
      });
    }
    h += '<div class="acciones"><a class="btn grande" href="#/nuevo">+ Nuevo pendiente</a></div>';
    h += '<div class="card pref-avisos"><label class="campo">Avisos de pedidos y respuestas<select data-cambio="pref"><option value="momento"' + (S.d.avisos === 'momento' ? ' selected' : '') + '>Al momento</option>' +
      '<option value="resumen"' + (S.d.avisos === 'resumen' ? ' selected' : '') + '>Un resumen a las 8 a. m.</option></select></label>' +
      '<p class="ayuda">Lo que vence te avisa ese día igual (a su hora, o a las 8 a. m. si no tiene hora).</p></div>';
    return h;
  }

  function opcionesPara(sel) {
    return '<option value=""' + (!sel ? ' selected' : '') + '>Para mí (recordatorio)</option>' + (S.d.gerencia || []).filter(function (p) { return p.id !== S.d.yo; }).map(function (p) {
      return '<option value="' + esc(p.id) + '"' + (sel === p.id ? ' selected' : '') + '>Pedírselo a ' + esc(p.nombre) + '</option>';
    }).join('');
  }
  function camposFecha(x) {
    return '<div class="fila-dos"><label class="campo">Fecha límite <small>(opcional)</small><input type="date" name="vence" value="' + esc((x && x.vence) || '') + '"></label>' +
      '<label class="campo">Hora <small>(opcional)</small><input type="time" name="hora" value="' + esc((x && x.hora) || '') + '"></label></div>' +
      '<label class="campo">¿Se repite?<select name="repite">' + Object.keys(REPITE).map(function (k) { return '<option value="' + k + '"' + (((x && x.repite) || '') === k ? ' selected' : '') + '>' + REPITE[k] + '</option>'; }).join('') + '</select></label>';
  }
  function vistaNuevo(q) {
    return '<a class="volver" href="#/mi">‹ Volver</a><h1>Nuevo pendiente</h1><form class="pendientes-form" data-form="nuevo">' +
      '<label class="campo">¿Para quién?<select name="para">' + opcionesPara(q.get('para') || '') + '</select></label>' +
      '<label class="campo">¿Qué es?<input name="titulo" maxlength="200" required placeholder="Ej.: ¿Necesitamos lavaplatos?"></label>' +
      '<label class="campo">Detalle <small>(opcional)</small><textarea name="texto" maxlength="4000" placeholder="Lo que haga falta explicar"></textarea></label>' +
      camposFecha(null) + '<div class="acciones"><button class="btn grande" type="submit">Crear</button></div></form>';
  }
  function textoWA(x) {
    var hilo = S.hilos[x.id] || [], primero = hilo[0] && hilo[0].autor === x.creado_por ? hilo[0].texto : '';
    return 'Hola ' + nombre(x.para) + ', ' + x.titulo + (primero ? '\n' + primero : '') + (x.vence ? '\nPara el ' + fecha(x.vence) + (x.hora ? ' a las ' + hora(x.hora) : '') : '') + '\n(Lo anoté en Pendientes de CIL)';
  }
  function botonWA(x) { return '<a class="btn wa" href="https://wa.me/?text=' + encodeURIComponent(textoWA(x)) + '" target="_blank" rel="noopener">Enviar también por WhatsApp</a>'; }

  function vistaDetalle(id) {
    var x = pend(id);
    if (!x) return '<a class="volver" href="#/mi">‹ Volver</a><p class="muted vacio">Este pendiente ya no existe o no es tuyo.</p>';
    var mio = x.creado_por === S.d.yo, hilo = S.hilos[id];
    var h = '<a class="volver" href="#/' + (x.estado === 'cerrado' ? 'cerrados' : x.para === S.d.yo ? 'mi' : 'pedi') + '">‹ Volver</a>';
    if (S.nuevoId === id && !propio(x)) {
      return h + '<div class="card listo-wa"><h2>Listo, se lo pediste a ' + esc(nombre(x.para)) + '</h2><p class="muted">Si no suele entrar a CIL, mándaselo también por WhatsApp. Aquí te queda anotado qué falta.</p>' +
        botonWA(x) + '<a class="btn sec" href="#/p/' + esc(id) + '" data-acc="ya-visto">Listo</a></div>';
    }
    h += '<div class="cab-detalle"><h1>' + esc(x.titulo) + '</h1><div class="item-meta">' + pillsDe(x) + '</div>' +
      '<p class="muted">' + (propio(x) ? 'Tu recordatorio' : 'De ' + esc(nombre(x.creado_por)) + ' para ' + esc(nombre(x.para))) + ' · creado ' + esc(cuando(x.creado_en)) + '</p></div>';
    if (mio && x.hecho_en && x.estado === 'abierto') {
      h += '<div class="card"><p><b>' + esc(nombre(x.para)) + ' dice que ya lo hizo</b> <small class="muted">(' + esc(cuando(x.hecho_en)) + ')</small></p>' +
        '<div class="acciones-detalle"><button class="btn ok" data-acc="cerrar" data-id="' + esc(id) + '">Confirmar y cerrar</button>' +
        '<button class="btn sec" data-acc="no-hecho" data-id="' + esc(id) + '">Todavía no está</button></div></div>';
    }
    if (mio) {
      h += '<div class="acciones-detalle">' + (x.estado === 'abierto' ? (x.hecho_en && !propio(x) ? '' : '<button class="btn ok" data-acc="cerrar" data-id="' + esc(id) + '">Cerrar: ya está resuelto</button>') : '<button class="btn sec" data-acc="reabrir" data-id="' + esc(id) + '">Reabrir</button>') +
        '<button class="btn sec" data-acc="editar">Cambiar</button>' + (!propio(x) && x.estado === 'abierto' ? botonWA(x) : '') +
        '<button class="btn fantasma rojo" type="button" data-acc="borrar">Borrar</button></div>' +
        (S.borrando ? '<div class="confirmar-borrar">¿Borrar este pendiente con toda su conversación? No se puede deshacer.<div class="acciones-detalle"><button class="btn warn" type="button" data-acc="borrar-si" data-id="' + esc(id) + '">Sí, borrar</button><button class="btn sec" type="button" data-acc="borrar-no">No</button></div></div>' : '');
      h += '<form class="pendientes-form card" data-form="editar" data-id="' + esc(id) + '" hidden><label class="campo">¿Qué es?<input name="titulo" maxlength="200" required value="' + esc(x.titulo) + '"></label>' + camposFecha(x) +
        '<div class="acciones"><button class="btn" type="submit">Guardar</button></div></form>';
    } else if (x.estado === 'abierto') {
      h += x.hecho_en
        ? '<div class="card"><p>Marcaste que ya lo hiciste. ' + esc(nombre(x.creado_por)) + ' lo confirma y lo cierra.</p><button class="btn sec chico" data-acc="no-hecho" data-id="' + esc(id) + '">Deshacer</button></div>'
        : '<div class="acciones-detalle"><button class="btn ok" data-acc="hecho" data-id="' + esc(id) + '">Ya lo hice</button></div>' +
          '<p class="ayuda">Al tocarlo, a ' + esc(nombre(x.creado_por)) + ' le llega un aviso para que lo confirme y lo cierre. Si necesitas preguntar algo, escríbelo aquí abajo.</p>';
    }
    h += '<div class="hilo">' + (!hilo ? '<div class="spinner"></div>' : hilo.length ? hilo.map(function (m) {
      var yoM = m.autor === S.d.yo;
      return '<div class="msj' + (yoM ? ' mio' : '') + '"><div class="msj-quien">' + esc(yoM ? 'Tú' : nombre(m.autor)) + ' · ' + esc(cuando(m.creado_en)) + '</div>' +
        (m.texto ? '<div class="msj-txt">' + esc(m.texto) + '</div>' : '') +
        (m.foto ? '<img alt="Foto" data-foto="' + esc(m.foto) + '"' + (S.fotos[m.foto] ? ' src="' + esc(S.fotos[m.foto]) + '"' : '') + '>' : '') +
        (m.foto_borrada ? '<div class="foto-borrada">Foto borrada (pasaron 60 días desde que se cerró)</div>' : '') + '</div>';
    }).join('') : '<p class="muted">Todavía no hay mensajes.</p>') + '</div>';
    h += '<form class="escribir" data-form="mensaje" data-id="' + esc(id) + '"><textarea name="texto" maxlength="4000" placeholder="' + (mio ? 'Escribe algo' : 'Contesta aquí') + '"></textarea>' +
      (S.foto ? '<div class="foto-previa"><img src="' + esc(S.foto.url) + '" alt=""><span>Foto lista para enviar</span><button class="btn link" type="button" data-acc="quitar-foto">Quitar</button></div>' : '') +
      '<div class="escribir-fila"><label class="btn sec" title="Agregar foto">📷<input type="file" accept="image/*" data-cambio="foto" hidden></label><button class="btn enviar" type="submit">Enviar</button></div></form>';
    return h;
  }

  function pintar() {
    if (!S.d) return;
    var r = ruta(), p = r.partes, cuerpo;
    if (p[0] === 'p' && p[1]) { cuerpo = vistaDetalle(p[1]); if (!S.hilos[p[1]] && pend(p[1])) abrirHilo(p[1]); }
    else if (p[0] === 'nuevo') cuerpo = vistaNuevo(r.q);
    else cuerpo = vistaListas(['mi', 'pedi', 'personas', 'cerrados'].indexOf(p[0]) >= 0 ? p[0] : 'mi');
    $app.innerHTML = cabecera() + '<main class="contenido">' + cuerpo + '</main>';
    cargarFotos();
  }
  function abrirHilo(id) {
    rpc('pend_hilo', { p_id: id }).then(function (h) {
      S.hilos[id] = h || [];
      var x = pend(id); if (x) x.nuevo = false;
      if (ruta().partes[1] === id) pintar();
    }, function (e) { aviso(e.message); });
  }
  function cargarFotos() {
    [].forEach.call(document.querySelectorAll('img[data-foto]:not([src])'), function (img) {
      var f = img.getAttribute('data-foto');
      almacen('GET', 'authenticated/pendientes/' + f.split('/').map(encodeURIComponent).join('/')).then(function (r) { if (!r.ok) throw new Error(); return r.blob(); })
        .then(function (b) { S.fotos[f] = URL.createObjectURL(b); img.src = S.fotos[f]; }, function () { img.alt = 'No se pudo cargar la foto'; });
    });
  }

  // Achica la foto en el teléfono: lado mayor de 1280 px, JPG, menos de ~900 KB
  function achicar(archivo) {
    return new Promise(function (ok, mal) {
      var img = new Image(), u = URL.createObjectURL(archivo);
      img.onload = function () {
        var k = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
        (function intento(q) {
          c.toBlob(function (b) { if (!b) return mal(new Error('No se pudo leer la foto.')); if (b.size > 900000 && q > 0.4) return intento(q - 0.15); ok(b); }, 'image/jpeg', q);
        })(0.72);
      };
      img.onerror = function () { URL.revokeObjectURL(u); mal(new Error('Ese archivo no es una foto.')); };
      img.src = u;
    });
  }
  function aleatorio() { var a = new Uint8Array(9); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }

  function ocupado(f, si) { S.ocupado = si; var b = f && f.querySelector('button[type="submit"]'); if (b) b.disabled = si; }

  document.addEventListener('submit', function (ev) {
    var f = ev.target, tipo = f.getAttribute('data-form'); if (!tipo) return;
    ev.preventDefault(); if (S.ocupado) return;
    var fd = new FormData(f), id = f.getAttribute('data-id');
    var fechaArgs = function () {
      var v = fd.get('vence') || null, h = fd.get('hora') || null, rp = fd.get('repite') || '';
      if (rp && !v) throw new Error('Para que se repita, ponle una fecha.');
      if (h && !v) throw new Error('Para ponerle hora, ponle también una fecha.');
      return { p_vence: v, p_hora: h, p_repite: rp };
    };
    var p;
    try {
      if (tipo === 'nuevo') {
        var a = fechaArgs(); a.p_titulo = String(fd.get('titulo') || '').trim(); a.p_para = fd.get('para') || null; a.p_texto = String(fd.get('texto') || '').trim() || null;
        if (!a.p_titulo) throw new Error('Escribe qué es.');
        p = rpc('pend_crear', a).then(function (nid) {
          if (a.p_texto) S.hilos[nid] = [{ autor: S.d.yo, texto: a.p_texto, creado_en: new Date().toISOString() }];
          if (a.p_para) S.nuevoId = nid;
          return rpc('pend_datos').then(function (d) { S.d = d; location.hash = '#/p/' + nid; pintar(); });
        });
      } else if (tipo === 'editar') {
        var e2 = fechaArgs(); e2.p_id = id; e2.p_titulo = String(fd.get('titulo') || '').trim();
        if (!e2.p_titulo) throw new Error('Escribe qué es.');
        p = rpc('pend_editar', e2).then(cargar).then(function () { aviso('Guardado.', true); });
      } else if (tipo === 'mensaje') {
        var t = String(fd.get('texto') || '').trim(), foto = S.foto;
        if (!t && !foto) throw new Error('Escribe algo o agrega una foto.');
        var nombreFoto = foto ? id + '/' + aleatorio() + '.jpg' : null;
        p = (foto ? almacen('POST', 'pendientes/' + nombreFoto, foto.blob, 'image/jpeg').then(function (r) {
          if (!r.ok) throw new Error('No se pudo subir la foto. Intenta de nuevo.');
        }) : Promise.resolve()).then(function () {
          return rpc('pend_mensaje', { p_id: id, p_texto: t, p_foto: nombreFoto });
        }).then(function () {
          if (foto) S.fotos[nombreFoto] = foto.url;
          S.foto = null; delete S.hilos[id];
          return rpc('pend_datos').then(function (d) { S.d = d; pintar(); });
        });
      }
    } catch (err) { aviso(err.message); return; }
    if (!p) return;
    ocupado(f, true);
    p.then(function () { S.ocupado = false; }, function (err) { ocupado(f, false); aviso(err.message === 'Failed to fetch' ? 'No hay conexión. Revisa el internet.' : err.message); });
  });

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-acc]'); if (!b) return;
    var acc = b.getAttribute('data-acc'), id = b.getAttribute('data-id');
    if (acc === 'recargar') { cargar(); return; }
    if (acc === 'editar') { var f = document.querySelector('form[data-form="editar"]'); if (f) f.hidden = !f.hidden; return; }
    if (acc === 'borrar') { S.borrando = true; pintar(); return; }
    if (acc === 'borrar-no') { S.borrando = false; pintar(); return; }
    if (acc === 'quitar-foto') { S.foto = null; pintar(); return; }
    if (acc === 'ya-visto') { S.nuevoId = null; pintar(); return; }
    if (S.ocupado) return;
    var p = null;
    if (acc === 'cerrar') p = rpc('pend_cerrar', { p_id: id }).then(function (nid) { return cargar().then(function () { aviso(nid ? 'Cerrado. Ya salió el de la próxima vez.' : 'Cerrado.', true); }); });
    else if (acc === 'hecho') p = rpc('pend_hecho', { p_id: id, p_si: true }).then(cargar).then(function () { aviso('Listo: le avisamos a ' + nombre(pend(id).creado_por) + ' para que lo confirme.', true); });
    else if (acc === 'no-hecho') p = rpc('pend_hecho', { p_id: id, p_si: false }).then(cargar);
    else if (acc === 'reabrir') p = rpc('pend_reabrir', { p_id: id }).then(cargar).then(function () { aviso('Reabierto.', true); });
    else if (acc === 'borrar-si') p = rpc('pend_hilo', { p_id: id }).then(function (hilo) {
      // Primero las fotos: después de borrar el pendiente ya no hay permiso para tocarlas
      var fotos = (hilo || []).map(function (m) { return m.foto; }).filter(Boolean);
      return fotos.length ? almacen('DELETE', 'pendientes', JSON.stringify({ prefixes: fotos }), 'application/json').then(function (r) {
        if (!r.ok) throw new Error('No se pudieron borrar las fotos. Intenta de nuevo.');
      }) : null;
    }).then(function () { return rpc('pend_borrar', { p_id: id }); }).then(function () {
      S.borrando = false; delete S.hilos[id];
      location.hash = '#/mi'; return cargar().then(function () { aviso('Borrado.', true); });
    });
    if (!p) return;
    S.ocupado = true; b.disabled = true;
    p.then(function () { S.ocupado = false; }, function (err) { S.ocupado = false; b.disabled = false; aviso(err.message); });
  });

  document.addEventListener('change', function (ev) {
    var el = ev.target, c = el.getAttribute('data-cambio');
    if (c === 'pref') rpc('pend_avisos', { p_modo: el.value }).then(function () { S.d.avisos = el.value; aviso(el.value === 'momento' ? 'Te avisará al momento.' : 'Te llegará un resumen a las 8 a. m.', true); }, function (e) { aviso(e.message); });
    else if (c === 'foto' && el.files && el.files[0]) {
      var txt = (document.querySelector('form[data-form="mensaje"] textarea') || {}).value || '';
      achicar(el.files[0]).then(function (blob) {
        S.foto = { blob: blob, url: URL.createObjectURL(blob) }; pintar();
        var ta = document.querySelector('form[data-form="mensaje"] textarea'); if (ta) ta.value = txt;
      }, function (e) { aviso(e.message); });
    }
  });

  window.addEventListener('hashchange', function () { S.borrando = false; S.foto = null; if (S.nuevoId && ruta().partes[1] !== S.nuevoId) S.nuevoId = null; pintar(); window.scrollTo(0, 0); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && S.d && !S.ocupado) { var id = ruta().partes[0] === 'p' && ruta().partes[1]; if (id) delete S.hilos[id]; cargar(); } });
  setInterval(function () {
    var r = ruta(), ta = document.querySelector('form[data-form="mensaje"] textarea');
    if (document.visibilityState !== 'visible' || S.ocupado || S.foto || !S.d || r.partes[0] !== 'p' || (ta && ta.value) || S.borrando) return;
    var abierto = document.querySelector('form[data-form="editar"]:not([hidden])'); if (abierto) return;
    rpc('pend_hilo', { p_id: r.partes[1] }).then(function (h) {
      var antes = JSON.stringify(S.hilos[r.partes[1]] || []); S.hilos[r.partes[1]] = h || [];
      if (JSON.stringify(h || []) !== antes && ruta().partes[1] === r.partes[1]) pintar();
    }).catch(function () { /* se intenta otra vez */ });
  }, 30000);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(function () { /* nada */ });
  if (!URL_SB) $app.innerHTML = '<div class="centro"><h1>Pendientes</h1><p class="muted">Falta conectar la base de datos (config.js).</p></div>';
  else cargar();
})();
