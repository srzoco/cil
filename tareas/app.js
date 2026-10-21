/* Tareas CIL — interfaz */
(function () {
  'use strict';
  var L = window.TBLogic, ST = window.TBStore;
  var CFG = window.TB_CONFIG || {};
  var store = null;  // se crea en arrancar()
  var $app = document.getElementById('app');

  var S = { data: null, hoy: L.hoyISO(), cargando: true, error: null, modal: null, toast: null, ocupado: false, eventos: null, red: null,
    marcando: {}, ultimaMarca: 0, sucio: false };
  // Pide una vez a qué red está conectado este teléfono (para «Registrar esta red»)
  S.redCheck = function () {
    if (S.red !== null || S.redPidiendo) return;
    S.redPidiendo = true;
    store.rpc('mi_red', {}).then(function (r) { S.red = r || {}; S.redPidiendo = false; render(); }, function () { S.red = {}; S.redPidiendo = false; render(); });
  };

  // ---------- Utilidades ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ruta() {
    var h = location.hash.replace(/^#/, '') || '/';
    var i = h.indexOf('?');
    var path = i >= 0 ? h.slice(0, i) : h;
    return { parts: path.split('/').filter(Boolean), q: new URLSearchParams(i >= 0 ? h.slice(i + 1) : '') };
  }
  function ir(h) { if (location.hash === '#' + h) render(); else location.hash = h; }
  function db() { return S.data; }
  function aj() { return (S.data && S.data.ajustes) || L.AJUSTES_BASE; }
  function yo() { return S.data && S.data.yo; }
  function esAdmin() { var y = yo(); return !!(y && y.rol === 'admin'); }
  function persona(id) { return (S.data && S.data.personas.filter(function (p) { return p.id === id; })[0]) || null; }
  function nombreDe(id) { var p = persona(id); return p ? (p.nombre || p.email || 'Sin nombre') : 'Sin asignar'; }
  function empleados() {
    return S.data.personas.filter(L.esEmpleadoActivo).sort(function (a, b) { return (a.nombre || '') < (b.nombre || '') ? -1 : 1; });
  }
  function asig(id) { return S.data.asignaciones.filter(function (a) { return a.id === id; })[0] || null; }
  function plantilla(id) { return S.data.plantillas.filter(function (p) { return p.id === id; })[0] || null; }
  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
  function saludo() { var h = new Date().getHours(); return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'; }
  function sumMin(l) { return l.reduce(function (s, a) { return s + a.minutos; }, 0); }

  var ICON = {
    hoy: '<svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5"/></svg>',
    tareas: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01" stroke-width="3"/></svg>',
    mas: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    reporte: '<svg viewBox="0 0 24 24"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>',
    equipo: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.6 14.2c2.4-.3 4.3 1.2 4.9 4.3"/></svg>',
    salir: '<svg viewBox="0 0 24 24"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H4"/></svg>',
    recargar: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/></svg>',
    reloj: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    menu: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
    termo: '<svg viewBox="0 0 24 24"><path d="M10 4a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 9v7"/></svg>'
  };

  // ---------- Datos ----------
  // Historial y reportes de días pasados necesitan 35 días de datos; el resto, solo lo de hoy (mucho más liviano).
  function necesitaCompleto() {
    var r = ruta(), p = r.parts[0];
    return p === 'historial' || p === 'temperaturas' || (p === 'reporte' && !!r.q.get('f') && r.q.get('f') < L.hoyISO());
  }
  function claveCache() { var s = store && store.modo === 'supabase' && store.sesion(); return s ? 'barquero_cache_tareas_' + s.user.id : null; }
  function guardarCache(d) { var k = claveCache(); if (k) ST.LS.set(k, { hoy: L.hoyISO(), data: d }); }
  function borrarCache() { var k = claveCache(); if (k) ST.LS.del(k); }
  function indicador(on) {
    S.actualizando = on;
    var b = document.querySelector('[data-acc=recargar]'); if (b) b.classList.toggle('girando', !!on);
  }
  function recargar(silencioso) {
    if (!store.sesion()) { S.cargando = false; render(); return Promise.resolve(); }
    if (!silencioso) { S.cargando = true; render(); }
    var inicio = Date.now();
    indicador(true);
    return store.cargar(necesitaCompleto()).then(function (d) {
      indicador(false);
      // si marcó algo mientras cargaba, esta foto ya está vieja: se pide otra
      if (S.ultimaMarca > inicio) { recargarPronto(); return; }
      aplicarCola(d);
      S.data = d; S.hoy = L.hoyISO(); S.error = null; S.cargando = false;
      guardarCache(d);
      if (colaLeer().length) setTimeout(enviarCola, 0);
      // no borrar lo que alguien está escribiendo en un formulario
      if (silencioso && S.sucio) return;
      render();
    }, function (e) {
      indicador(false);
      S.cargando = false;
      if (e && e.sesion) { borrarCache(); S.data = null; render(); return; }
      if (silencioso && S.data) aviso(e.message); else { S.error = e.message || String(e); render(); }
    });
  }
  // ---------- Sin internet: lo marcado se guarda en el teléfono y se envía al volver la conexión ----------
  function claveCola() { var s = store && store.modo === 'supabase' && store.sesion(); return s ? 'barquero_cola_tareas_' + s.user.id : null; }
  function colaLeer() { var k = claveCola(); return (k && ST.LS.get(k)) || []; }
  function colaGuardar(c) { var k = claveCola(); if (k) { if (c.length) ST.LS.set(k, c); else ST.LS.del(k); } }
  function encolar(item) {
    var c = colaLeer().filter(function (x) { return !(item.tipo === 'hecha' && x.tipo === 'hecha' && x.id === item.id) && !(item.tipo === 'llegada' && x.tipo === 'llegada'); });
    c.push(item); colaGuardar(c);
  }
  function llegadaEnCola() { return colaLeer().filter(function (x) { return x.tipo === 'llegada' && x.fecha === S.hoy; })[0] || null; }
  // Al cargar datos nuevos, lo que sigue en la cola se ve como ya marcado
  function aplicarCola(d) {
    colaLeer().forEach(function (x) {
      if (x.tipo !== 'hecha') return;
      var a = (d.asignaciones || []).filter(function (y) { return y.id === x.id; })[0];
      if (a) { a.estado = x.hecha ? 'hecha' : 'pendiente'; a.hecha_en = x.hecha ? x.t : null; }
    });
  }
  function enviarCola() {
    if (S.enviandoCola || !colaLeer().length) return Promise.resolve();
    S.enviandoCola = true;
    var c = colaLeer(), enviados = 0;
    var siguiente = function () {
      if (!c.length) return Promise.resolve();
      var x = c[0];
      var p = x.tipo === 'llegada'
        ? store.rpc('marcar_llegada', { p_hora: x.t }).then(function (r) { if (r && r.error) { var e = new Error(r.error); throw e; } })
        : store.rpc('marcar_hecha', { p_id: x.id, p_hecha: x.hecha });
      return p.then(function () { c.shift(); colaGuardar(c); enviados++; return siguiente(); }, function (e) {
        if (e && e.red) throw e;  // sigue sin internet: se reintenta después
        c.shift(); colaGuardar(c); aviso((x.tipo === 'llegada' ? 'No se pudo enviar tu llegada: ' : 'No se pudo enviar una tarea: ') + (e && e.message ? e.message : 'error'));
        return siguiente();
      });
    };
    return siguiente().then(function () {
      S.enviandoCola = false;
      if (enviados) { aviso('✓ Se envió lo que marcaste sin internet.', 'ok'); return recargar(true); }
    }, function () { S.enviandoCola = false; });
  }
  window.addEventListener('online', function () { enviarCola(); });

  function recargarPronto() {
    clearTimeout(recargarPronto.t);
    recargarPronto.t = setTimeout(function () {
      if (Object.keys(S.marcando).length) recargarPronto(); else recargar(true);
    }, 1200);
  }
  function aviso(texto, tipo) {
    S.toast = { texto: texto, tipo: tipo || 'error' };
    pintarCapas();
    clearTimeout(aviso.t);
    aviso.t = setTimeout(function () { S.toast = null; pintarCapas(); }, tipo === 'ok' ? 2600 : 5000);
  }
  // Ejecuta una acción, recarga y muestra un mensaje.
  function ejecutar(promesa, okTexto, cerrarModal) {
    if (S.ocupado) return Promise.resolve();
    S.ocupado = true; S.sucio = false; pintarCapas();
    return promesa.then(function (r) {
      S.ocupado = false;
      if (cerrarModal) S.modal = null;
      if (okTexto) aviso(typeof okTexto === 'function' ? okTexto(r) : okTexto, 'ok');
      return recargar(true).then(function () { return r; });
    }, function (e) {
      S.ocupado = false; pintarCapas();
      aviso(e && e.message ? e.message : 'Algo salió mal.');
    });
  }

  // ---------- Render ----------
  function render() {
    if (S.cargando && !S.data) { $app.innerHTML = '<div class="centro"><div class="spinner"></div></div>'; return; }
    if (!store.sesion()) { $app.innerHTML = vistaLogin(); pintarCapas(); return; }
    if (S.error && !S.data) {
      $app.innerHTML = '<div class="centro"><h2>No se pudo cargar</h2><p class="muted">' + esc(S.error) + '</p>' +
        '<button class="btn" data-acc="recargar">Reintentar</button><button class="btn link" data-acc="salir">Salir</button></div>';
      return;
    }
    if (!S.data) return;
    var y = yo();
    var html;
    if (!y.nombre) html = marco(vistaPerfil(true), true);
    else if (!y.activo) html = marco('<div class="centro"><h2>Tu usuario está desactivado</h2><p class="muted">Habla con gerencia.</p></div>', true);
    else if (!esAdmin() && y.accesos && y.accesos.indexOf('tareas') < 0) html = marco('<div class="centro"><h2>No tienes acceso a Tareas</h2><p class="muted">Si debería tenerlo, avísale a gerencia.</p><a class="btn" href="../">Ir al menú</a></div>', true);
    else html = marco(esAdmin() ? vistaAdmin() : vistaEmpleado(), !esAdmin());
    $app.innerHTML = html;
    S.sucio = false;
    pintarCapas();
  }
  function pedirCompleto() {
    if (!S.pidiendoCompleto) { S.pidiendoCompleto = true; recargar(true).then(function () { S.pidiendoCompleto = false; }); }
    return '<div class="centro"><div class="spinner"></div><p class="muted">Cargando el historial…</p></div>';
  }

  function vistaAdmin() {
    var r = ruta(), p = r.parts;
    if (!p.length) return vistaHoy();
    if (p[0] === 'tareas') return vistaTareas(r.q);
    if (p[0] === 'tarea') return vistaFormTarea(p[1], r.q);
    if (necesitaCompleto() && !S.data.completo) return pedirCompleto();
    if (p[0] === 'reporte') return vistaReporte(r.q.get('f') || S.hoy);
    if (p[0] === 'historial') return vistaHistorial(Number(r.q.get('d')) || 30);
    if (p[0] === 'temperaturas') return vistaTemperaturas(r.q);
    if (p[0] === 'equipo') return vistaEquipo(p[1]);
    if (p[0] === 'perfil') return vistaPerfil(false);
    return vistaHoy();
  }
  function vistaEmpleado() {
    var p = ruta().parts;
    if (p[0] === 'perfil') return vistaPerfil(false);
    return vistaMiDia();
  }

  function marco(contenido, sinNav) {
    var y = yo(), demo = store.modo === 'demo';
    var conMenu = store.modo === 'supabase' && (esAdmin() || ((y.accesos || []).length > 1));
    var top = '<header class="top">' + (conMenu ? '<a class="icono-btn menu-btn" href="../" aria-label="Menú de CIL">' + ICON.menu + '</a>' : '') +
      '<a class="marca" href="#/"><span class="logo">CIL</span><span class="marca-txt">Tareas<small>CIL</small></span></a>';
    if (demo) {
      top += '<label class="ver-como"><span>Ver como</span><select data-cambio="demo-usuario">' +
        store.db.personas.map(function (pe) {
          return '<option value="' + esc(pe.id) + '"' + (pe.id === y.id ? ' selected' : '') + '>' + esc(pe.nombre) + (pe.rol === 'admin' ? ' (gerencia)' : '') + '</option>';
        }).join('') + '</select></label>';
    } else {
      top += '<a class="quien" href="#/perfil">' + esc(y.nombre || y.email) + '</a>';
    }
    if (window.BarqueroTema) top += window.BarqueroTema.boton();
    top += '<button class="icono-btn' + (S.actualizando ? ' girando' : '') + '" data-acc="recargar" aria-label="Actualizar">' + ICON.recargar + '</button>';
    if (!demo) top += '<button class="icono-btn" data-acc="salir" aria-label="Salir">' + ICON.salir + '</button>';
    top += '</header>';
    if (demo) top += '<div class="franja-demo">Modo demo: datos de ejemplo guardados solo en este teléfono. <a href="#" data-acc="reiniciar-demo">Reiniciar</a></div>';
    var nav = '';
    if (!sinNav) {
      var act = ruta().parts[0] || '';
      var tab = function (h, id, ic, txt, clase) {
        return '<a class="tab ' + (clase || '') + (act === id ? ' activo' : '') + '" href="#' + h + '">' + ic + '<span>' + txt + '</span></a>';
      };
      var nAlerta = alertasHoy();
      nav = '<nav class="tabs">' +
        tab('/', '', ICON.hoy + (nAlerta ? '<span class="badge">' + nAlerta + '</span>' : ''), 'Hoy') +
        tab('/tareas', 'tareas', ICON.tareas, 'Tareas') +
        '<a class="tab tab-nueva" href="#/tarea/nueva?tipo=unica"><span class="mas-ic">' + ICON.mas + '</span><span>Una vez</span></a>' +
        tab('/reporte', 'reporte', ICON.reporte, 'Reporte') +
        tab('/equipo', 'equipo', ICON.equipo, 'Equipo') + '</nav>';
    }
    return top + '<main class="contenido">' + contenido + '</main>' + nav + '<div id="capas"></div>';
  }

  // ---------- Locales ----------
  function locales() { return (S.data && S.data.locales) || []; }
  function variosLocales() { return locales().length > 1; }
  function nombreLocal(id) { var l = L.localDe(db(), id); return l ? l.nombre : 'Local'; }
  function localDe(pe) { return L.localDePersona(db(), pe); }
  function grupos() { return ((S.data && S.data.grupos) || []).slice().sort(function (a, b) { return a.nombre < b.nombre ? -1 : 1; }); }
  function nombreGrupo(id) { var g = grupos().filter(function (x) { return x.id === id; })[0]; return g ? g.nombre : 'Grupo'; }
  function empleadosDe(localId) { return empleados().filter(function (pe) { return localDe(pe) === localId; }); }
  // Local elegido en el selector (se recuerda en este teléfono)
  function localElegido() {
    var id = null;
    try { id = localStorage.getItem('tareasbf_local'); } catch (e) { id = S.localMem || null; }
    if (!L.localDe(db(), id)) id = (L.localPrincipal(db()) || {}).id || null;
    return id;
  }
  function elegirLocal(id) { S.localMem = id; try { localStorage.setItem('tareasbf_local', id); } catch (e) { /* sin almacenamiento */ } }

  function justPorRevisar(localId) {
    return db().asignaciones.filter(function (a) { return a.just_estado === 'pendiente' && a.estado === 'pendiente' && (!localId || a.local_id === localId); });
  }
  function alertasDe(localId) {
    var s = L.sugerirReasignacion(db(), S.hoy, new Date(), localId);
    return s.items.length + justPorRevisar(localId).length + (aj().pool_activo ? 0 : L.delPool(db(), S.hoy, localId).length);
  }
  function alertasHoy() {
    if (!esAdmin()) return 0;
    return locales().reduce(function (n, l) { return n + alertasDe(l.id); }, 0) || (locales().length ? 0 : alertasDe(null));
  }

  // ---------- Empleado: Mi día ----------
  function vistaMiDia() {
    var y = yo(), d = db(), hoy = S.hoy;
    var est = L.estadoAsistencia(d, y.id, hoy, new Date());
    var s = L.asistenciaDe(d, y.id, hoy);
    var t = L.tareasDe(d, y.id, hoy);
    var todas = t.hoy.concat(t.atrasadas);
    var hechas = t.hoy.filter(function (a) { return a.estado === 'hecha'; });
    var h = '<h1 class="saludo">' + saludo() + ', ' + esc(y.nombre) + '</h1><p class="fecha-hoy">' + esc(L.fmtFechaLarga(hoy)) + '</p>';

    if (est === 'libre' && !todas.length) {
      h += '<p class="nota">Hoy no te toca trabajar.</p>';
    } else if (!L.estaPresente(est) && llegadaEnCola()) {
      h += '<p class="llego presente">' + ICON.check + '<span>Llegaste ' + esc(L.fmtHora(llegadaEnCola().t)) + ' · sin internet, se envía al volver la conexión</span></p>';
    } else if (!L.estaPresente(est)) {
      var ahoraM = new Date(), paso = L.pasoLimite(aj(), ahoraM), tardeYa = L.pasoATiempo(aj(), ahoraM);
      var sub = paso ? 'Ya pasó la hora límite (' + L.fmtHoraTxt(aj().hora_limite) + '). Marca igual: lo tuyo que nadie ha hecho vuelve a ti, y lo que otro ya hizo por ti lo compensas con tareas suyas.'
        : tardeYa ? 'Ya pasó la hora de entrada. Marca ya: a las ' + L.fmtHoraTxt(aj().hora_limite) + ' tus tareas pasan a otra persona.'
        : 'Marca apenas llegues. A tiempo hasta las ' + L.fmtHoraTxt(L.aTiempoHasta(aj())) + '.';
      h += '<div class="hero llegada' + (tardeYa ? ' tarde' : '') + '"><div><p class="hero-t">' + (est === 'ausente' ? 'Gerencia te marcó como ausente' : '¿Ya llegaste?') + '</p>' +
        '<p class="hero-sub">' + esc(sub) + '</p></div>' +
        '<button class="btn grande" data-acc="llegue">Llegué</button></div>';
    } else {
      h += '<p class="llego ' + est + '">' + ICON.check + '<span>Llegaste ' + esc(L.fmtHora(s.llegada)) + (s.local_id && s.local_id !== y.local_id ? ' a ' + esc(nombreLocal(s.local_id)) : '') +
        (est === 'tarde' ? ' · después de las ' + esc(L.fmtHoraTxt(L.aTiempoHasta(aj()))) : '') + (s.salida ? ' · te fuiste ' + esc(L.fmtHora(s.salida)) : '') + '</span></p>';
    }
    // «Salí a despachar» / «Volví»
    if (aj().usar_salidas && L.estaPresente(est) && s && !s.salida) {
      var abierta = (S.data.salidas_rato || []).filter(function (x) { return x.persona_id === y.id && x.fecha === hoy && !x.volvio; })[0];
      h += abierta ? '<div class="hero fuera-hero"><div><p class="hero-t">Estás fuera del local</p><p class="hero-sub">Desde las ' + esc(L.fmtHora(abierta.salio)) + '. Lo que tenga horario mientras tanto lo puede hacer otra persona.</p></div><button class="btn grande" data-acc="fuera" data-v="0">Volví</button></div>'
        : '<p class="sin-margen"><button class="btn sec chico" data-acc="fuera" data-v="1">Salí a despachar</button></p>';
    }
    // Tareas de otras personas con horario que se están pasando: cualquiera del local las puede hacer
    if (L.estaPresente(est) && s && !s.salida && !L.estaFuera(d, y.id, hoy)) {
      var urg = d.asignaciones.filter(function (a) { return a.asignado_a !== y.id && a.local_id === y.local_id && L.esUrgente(d, a, new Date()); });
      if (urg.length) h += '<section class="bloque alerta"><div class="bloque-head"><h2>Urgente</h2><small class="muted">Se está pasando la hora</small></div><div class="lista">' +
        urg.map(function (a) {
          return '<div class="item"><div class="item-cuerpo"><span class="item-titulo">' + tituloHtml(a) + '</span><span class="item-meta"><span class="extra">' + a.minutos + ' min</span>' + horaPill(a) + '</span></div>' +
            '<button class="btn chico" data-acc="rescatar" data-id="' + esc(a.id) + '">La hago yo</button></div>';
        }).join('') + '</div></section>';
    }
    // Su propio récord del mes (nadie más lo ve)
    var mm = S.data.mi_mes;
    if (mm && mm.dias > 0 && aj().mostrar_record) {
      h += '<p class="record' + (mm.a_tiempo === mm.dias ? ' perfecto' : '') + '">Este mes: <b>' + mm.a_tiempo + ' de ' + mm.dias + '</b> ' + (mm.dias === 1 ? 'día' : 'días') + ' a tiempo' +
        (mm.a_tiempo === mm.dias ? ' · ¡todos!' : '') + '</p>';
    }

    h += tarjetaAvisos(false);
    if (todas.length) {
      var minT = sumMin(todas), minH = sumMin(hechas);
      var pend = todas.length - hechas.length;
      h += '<div class="resumen-dia"><div><b>' + (pend ? plural(pend, 'pendiente', 'pendientes') : '¡Todo listo!') + '</b>' +
        '<span>' + esc(L.minutosTxt(minH)) + ' de ' + esc(L.minutosTxt(minT)) + ' hechos</span></div>' +
        '<div class="progreso"><span style="width:' + Math.round(100 * minH / Math.max(1, minT)) + '%"></span></div></div>';
    }
    if (t.atrasadas.length) {
      h += '<section class="bloque alerta"><div class="bloque-head"><h2>Atrasadas</h2></div>' +
        '<p class="ayuda sin-margen">Se recuperan además de tus tareas de hoy. Si no se pudo hacer por un motivo válido, explícalo y gerencia lo revisa.</p><div class="lista">' +
        t.atrasadas.map(function (a) { return filaTareaEmpleado(a, true); }).join('') + '</div></section>';
    }
    h += '<section class="bloque"><div class="bloque-head"><h2>Tus tareas de hoy</h2></div>';
    h += '<p class="regla">Gerencia puede reasignar cualquier tarea en cualquier momento. <b>Si está en tu lista, es tu responsabilidad.</b></p>';
    h += t.hoy.length ? '<div class="lista">' + t.hoy.map(function (a) { return filaTareaEmpleado(a, false); }).join('') + '</div>'
      : '<p class="vacio muted">No tienes tareas asignadas hoy.</p>';
    if (L.estaPresente(est) && s && !s.salida) h += '<p class="me-voy"><button class="btn link" data-acc="me-voy">Me voy antes de terminar</button></p>';
    h += '</section>';
    if (aj().pool_activo) {
      var pool = L.delPool(d, hoy, y.local_id);
      if (pool.length) {
        h += '<section class="bloque"><div class="bloque-head"><h2>Tareas libres</h2><small class="muted">Quien la tome, la hace</small></div><div class="lista">' +
          pool.map(function (a) {
            return '<div class="item"><div class="item-cuerpo"><span class="item-titulo">' + esc(L.tituloCompleto(a)) + '</span>' +
              '<span class="item-meta"><span class="extra">' + a.minutos + ' min</span>' + horaPill(a) + (a.detalle ? '<span class="extra">· ' + esc(a.detalle) + '</span>' : '') + '</span></div>' +
              '<button class="btn chico" data-acc="tomar" data-id="' + esc(a.id) + '">Tomar</button></div>';
          }).join('') + '</div></section>';
      }
    }
    return h;
  }

  // «antes de las 12» / vencida / hecha tarde
  function horaPill(a) {
    if (!a.antes && !a.desde) return '';
    if (a.desde && L.antesDeHora(a, new Date())) return '<span class="pill espera">' + ICON.reloj + ' desde las ' + esc(L.fmtHoraTxt(L.hhmm(a.desde))) + '</span>';
    if (!a.antes) return '';
    var e = L.estadoHora(a, new Date()), txt = 'antes de las ' + L.fmtHoraTxt(L.hhmm(a.antes));
    if (e === 'vencida') return '<span class="pill corregir">' + ICON.reloj + ' ' + esc(txt) + ' · se pasó la hora</span>';
    if (e === 'tarde') return '<span class="pill aprueba">hecha después de su hora</span>';
    if (a.estado === 'hecha') return '';
    return '<span class="pill hora">' + ICON.reloj + ' ' + esc(txt) + '</span>';
  }
  function tituloHtml(a) {
    return esc(a.titulo) + (a.momento_nombre ? ' <span class="momento">· ' + esc(a.momento_nombre) + '</span>' : '') + conHtml(a);
  }
  // Tareas de varias personas: «con María»
  function conHtml(a) {
    var txt = (S.data && S.data.companeros && S.data.companeros[a.id]) || '';
    if (!txt && S.data && S.data.asignaciones) {
      txt = L.companerosDe(S.data, a).map(function (b) { return b.asignado_a ? nombreDe(b.asignado_a) : 'sin asignar'; }).join(', ');
    }
    return txt ? ' <span class="momento">· con ' + esc(txt) + '</span>' : '';
  }

  function filaTareaEmpleado(a, atrasada) {
    var hecha = a.estado === 'hecha', vencida = L.estadoHora(a, new Date()) === 'vencida', espera = L.antesDeHora(a, new Date());
    return '<div class="tarea' + (hecha ? ' hecha' : '') + (atrasada || vencida ? ' atrasada' : '') + (espera ? ' en-espera' : '') + '">' +
      '<button class="marcar" data-acc="hecha" data-id="' + esc(a.id) + '" data-v="' + (hecha ? '0' : '1') + '" aria-pressed="' + hecha + '" aria-label="' + (hecha ? 'Desmarcar ' : (a.registro ? 'Anotar temperaturas: ' : 'Marcar hecha: ')) + esc(L.tituloCompleto(a)) + '">' + (a.registro && !hecha ? ICON.termo : ICON.check) + '</button>' +
      '<div class="tarea-cuerpo"><span class="item-titulo">' + tituloHtml(a) + '</span>' +
      '<span class="item-meta"><span class="extra">' + a.minutos + ' min</span>' + horaPill(a) +
      (atrasada ? '<span class="pill corregir">desde ' + esc(L.fmtFecha(a.fecha)) + '</span>' : '') +
      (a.repetir && !hecha ? '<span class="pill corregir">Gerencia pidió repetirla</span>' : '') +
      (a.registro && !hecha ? '<span class="pill hora">anotar temperaturas</span>' : '') +
      (!hecha && L.esUrgente(db(), a, new Date()) ? '<span class="pill corregir">urgente: si no la haces ya, la hace otra persona</span>' : '') +
      (hecha && a.hecha_en ? '<span class="extra">· hecha ' + esc(L.fmtHora(a.hecha_en)) + '</span>' : '') + '</span>' +
      (a.detalle ? '<span class="tarea-detalle">' + esc(a.detalle) + '</span>' : '') +
      (atrasada && !hecha ? justEmpleado(a) : '') + '</div></div>';
  }
  var JUST_TXT = { pendiente: 'Justificación enviada, falta que gerencia la revise', aprobada: 'Justificación aprobada', rechazada: 'Justificación rechazada' };
  var JUST_TONO = { pendiente: 'aprueba', aprobada: 'ok', rechazada: 'corregir' };
  function justEmpleado(a) {
    if (a.just_estado) return '<span class="just"><span class="pill ' + JUST_TONO[a.just_estado] + '">' + JUST_TXT[a.just_estado] + '</span>' +
      '</span>';
    return '<button class="btn link just-btn" data-acc="justificar" data-id="' + esc(a.id) + '">¿Por qué no se hizo?</button>';
  }

  // ---------- Gerencia: Hoy ----------
  var ESTADO_TXT = { presente: 'A tiempo', tarde: 'Tarde', ausente: 'No viene', falta: 'No marcó', sin_marcar: 'Sin marcar', libre: 'No trabaja hoy' };
  var ESTADO_TONO = { presente: 'ok', tarde: 'aprueba', ausente: 'corregir', falta: 'corregir', sin_marcar: '', libre: '' };

  // Vista de Hoy: 'juntos' (los locales uno debajo del otro) o 'selector' (un local a la vez)
  function modoHoy() { var m = null; try { m = localStorage.getItem('tareasbf_modo_hoy'); } catch (e) { /* nada */ } return m === 'juntos' ? 'juntos' : 'selector'; }

  // Reparto automático: lo que nadie de los presentes podía hacer queda oculto hasta que gerencia lo apruebe
  function bloqueOcultas() {
    var oc = ((S.data && S.data.asignaciones) || []).filter(function (a) { return a.oculta && a.estado === 'pendiente'; });
    if (!oc.length) return '';
    return '<section class="card alerta-card"><h2>' + (oc.length === 1 ? '1 tarea necesita tu aprobación' : oc.length + ' tareas necesitan tu aprobación') + '</h2>' +
      '<p class="ayuda sin-margen">Eran de alguien que faltó y nadie de los presentes podía hacerlas. Las asigné a quien tiene menos carga, pero no las ve hasta que apruebes.</p>' +
      oc.map(function (a) {
        return '<form class="oculta-fila" data-form="aprobar-oculta" data-id="' + esc(a.id) + '"><div><b>' + tituloHtml(a) + '</b><span class="muted">' + a.minutos + ' min' + (a.fecha < S.hoy ? ' · del ' + esc(L.fmtFecha(a.fecha)) : '') + '</span></div>' +
          '<div class="acciones"><select name="persona" aria-label="A quién">' + opcionesPersona(a.asignado_a, null, false, a.local_id) + '</select><button class="btn chico" type="submit">Asignar</button></div>' +
          '<div class="acciones"><input type="date" name="fecha" min="' + L.addDias(S.hoy, 1) + '" value="' + L.addDias(S.hoy, 1) + '" aria-label="Nuevo día">' +
          '<button class="btn chico sec" type="button" data-acc="reprogramar-oculta" data-id="' + esc(a.id) + '">Reprogramar</button></div><small class="muted">Reprogramar: vuelve a ' + esc(nombreDe(a.asignado_original || a.asignado_a)) + ' ese día.</small></form>';
      }).join('') + '</section>';
  }
  function vistaHoy() {
    var hoy = S.hoy, ahora = new Date();
    var h = '<h1>Hoy</h1><p class="fecha-hoy">' + esc(L.fmtFechaLarga(hoy)) + ' · a tiempo hasta ' + esc(L.fmtHoraTxt(L.aTiempoHasta(aj()))) + ' · falta desde ' + esc(L.fmtHoraTxt(aj().hora_limite)) + '</p>';
    if (ahora.getHours() >= 17) {
      h += '<a class="card reporte-listo" href="#/reporte?f=' + hoy + '"><b>Reporte del día</b><span class="muted">Ver y enviar por WhatsApp ›</span></a>';
    }
    h += bloqueOcultas();
    if (!variosLocales()) return h + bloqueLocal(locales()[0] ? locales()[0].id : null, false);
    if (modoHoy() === 'juntos') {
      locales().forEach(function (l) { h += '<div class="local-sec"><h2 class="local-titulo">' + esc(l.nombre) + '</h2>' + bloqueLocal(l.id, true) + '</div>'; });
      return h;
    }
    var sel = localElegido();
    h += '<div class="seg-tabs locales-tabs" role="tablist">' + locales().map(function (l) {
      var n = alertasDe(l.id);
      return '<a href="#" role="tab" data-acc="elegir-local" data-id="' + esc(l.id) + '" class="' + (l.id === sel ? 'on' : '') + '" aria-selected="' + (l.id === sel) + '">' +
        esc(l.nombre) + (n ? ' <span class="badge-in">' + n + '</span>' : '') + '</a>';
    }).join('') + '</div>';
    return h + bloqueLocal(sel, false);
  }

  function bloqueLocal(localId, compacto) {
    var d = db(), hoy = S.hoy, ahora = new Date();
    var emps = localId ? empleadosDe(localId) : empleados();
    var sug = L.sugerirReasignacion(d, hoy, ahora, localId);
    var paso = L.pasoLimite(aj(), ahora);
    var trabajan = emps.filter(function (pe) { return L.estadoAsistencia(d, pe.id, hoy, ahora) !== 'libre'; });
    var marcados = emps.filter(function (pe) { return L.estaPresente(L.estadoAsistencia(d, pe.id, hoy, ahora)); }).length;
    var h = '';
    if (localId && !L.laborable(d, localId, hoy) && !sug.items.length) {
      var esp = L.especial(d, hoy, localId);
      h += '<p class="nota">Este local no trabaja hoy' + (esp && esp.nombre ? ' (' + esc(esp.nombre) + ')' : '') + '.</p>';
    }
    if (sug.items.length) {
      var minS = sumMin(sug.items.map(function (i) { return i.asignacion; }));
      h += '<div class="hero alerta-hero"><div><p class="hero-n">' + sug.items.length + '</p><p class="hero-t">' +
        (sug.items.length === 1 ? 'tarea quedó' : 'tareas quedaron') + ' sin hacer (' + esc(L.minutosTxt(minS)) + '): ' +
        esc(sug.faltan.map(function (id) { return nombreDe(id) + ((sug.seFueron || []).indexOf(id) >= 0 ? ' se fue' : ' falta'); }).join(' · ')) + '</p></div>' +
        '<button class="btn grande" data-acc="ver-reasignar" data-id="' + esc(localId || '') + '">Revisar</button></div>';
    }
    if (sug.sinCobertura && sug.sinCobertura.length) {
      var deQuien = sug.sinCobertura.reduce(function (acc, it) { if (acc.indexOf(it.de) < 0) acc.push(it.de); return acc; }, []);
      h += '<p class="nota">' + esc(deQuien.map(nombreDe).join(' y ')) + ' no vino: ' + plural(sug.sinCobertura.length, 'tarea queda', 'tareas quedan') +
        ' pendiente' + (sug.sinCobertura.length === 1 ? '' : 's') + ' porque nadie más de este local puede hacerla' + (sug.sinCobertura.length === 1 ? '' : 's') + '.</p>';
    }
    if (!sug.items.length && !paso && marcados < trabajan.length) {
      h += '<p class="nota">' + marcados + ' de ' + trabajan.length + ' han marcado llegada. A las ' + esc(L.fmtHoraTxt(aj().hora_limite)) + ' la app reparte sola lo de quien falte: primero a quienes llegaron tarde.</p>';
    }

    var visitas = localId ? empleados().filter(function (pe) {
      var s = L.asistenciaDe(d, pe.id, hoy);
      return localDe(pe) !== localId && s && s.estado === 'presente' && s.local_id === localId;
    }) : [];
    h += '<section class="bloque"><div class="bloque-head"><h2>Asistencia</h2><small class="muted">' + marcados + ' de ' + trabajan.length + '</small></div><div class="asistencia">' +
      emps.map(function (pe) {
        var e = L.estadoAsistencia(d, pe.id, hoy, ahora), s = L.asistenciaDe(d, pe.id, hoy);
        var otro = s && s.estado === 'presente' && s.local_id && s.local_id !== localDe(pe);
        return '<button class="asis" data-acc="asistencia" data-id="' + esc(pe.id) + '"><span class="asis-nombre">' + esc(pe.nombre) + '</span>' +
          '<span class="pill ' + ESTADO_TONO[e] + '">' + ESTADO_TXT[e] + (s && s.llegada ? ' · ' + esc(L.fmtHora(s.llegada)) : '') + '</span>' +
          (s && s.salida && s.estado === 'presente' ? '<span class="pill corregir">Se fue ' + esc(L.fmtHora(s.salida)) + '</span>' : '') +
          (L.estaFuera(d, pe.id, hoy) ? '<span class="pill hora">Fuera (despachando)</span>' : '') +
          (otro ? '<span class="pill edita">Vino a ' + esc(nombreLocal(s.local_id)) + '</span>' : '') + '</button>';
      }).join('') +
      visitas.map(function (pe) {
        var s = L.asistenciaDe(d, pe.id, hoy);
        return '<button class="asis visita" data-acc="asistencia" data-id="' + esc(pe.id) + '"><span class="asis-nombre">' + esc(pe.nombre) + '</span>' +
          '<span class="pill edita">Vino de ' + esc(nombreLocal(localDe(pe))) + ' · ' + esc(L.fmtHora(s.llegada)) + '</span></button>';
      }).join('') + '</div>' + lineaSinPuntualidad(emps, hoy, ahora) + '</section>';

    var justs = justPorRevisar(localId);
    if (justs.length) {
      h += '<section class="bloque alerta"><div class="bloque-head"><h2>Justificaciones por revisar</h2><small class="muted">' + justs.length + '</small></div><div class="lista">' +
        justs.map(function (a) {
          return '<div class="item just-item"><div class="item-cuerpo"><span class="item-titulo">' + tituloHtml(a) + '</span>' +
            '<span class="item-meta"><span class="extra">' + esc(nombreDe(a.asignado_a)) + ' · del ' + esc(L.fmtFecha(a.fecha)) + ' · ' + a.minutos + ' min</span></span>' +
            '<span class="just-texto">«' + esc(a.justificacion) + '»</span>' +
            '<span class="just-acc"><button class="btn chico ok" data-acc="just-ok" data-id="' + esc(a.id) + '">Aprobar</button>' +
            '<button class="btn chico sec" data-acc="just-no" data-id="' + esc(a.id) + '">Rechazar</button></span></div></div>';
        }).join('') + '</div><p class="ayuda">Aprobada: cuenta como carga y le llegan menos tareas nuevas hasta recuperarla. Rechazada: igual tiene que hacerla, sin bajarle trabajo.</p></section>';
    }

    h += bloqueTemperaturas(localId);
    h += bloqueRevisiones(localId);

    var pool = L.delPool(d, hoy, localId);
    if (pool.length) {
      h += '<section class="bloque' + (aj().pool_activo ? '' : ' alerta') + '"><div class="bloque-head"><h2>' + (aj().pool_activo ? 'En el pool' : 'Sin asignar') + '</h2>' +
        '<small class="muted">' + esc(L.minutosTxt(sumMin(pool))) + '</small></div><div class="lista">' + pool.map(filaTareaAdmin).join('') + '</div></section>';
    }

    emps.forEach(function (pe) {
      var t = L.tareasDe(d, pe.id, hoy), todas = t.atrasadas.concat(t.hoy);
      var e = L.estadoAsistencia(d, pe.id, hoy, ahora);
      if (e === 'libre' && !todas.length) return;
      var min = sumMin(todas), hechas = todas.filter(function (a) { return a.estado === 'hecha'; });
      var disp = Math.round(aj().minutos_jornada * L.capacidad(pe) / 100);
      h += '<section class="bloque persona-bloque' + (e === 'ausente' || e === 'falta' || L.seFue(d, pe.id, hoy) ? ' falta' : '') + '"><div class="bloque-head"><h2>' + esc(pe.nombre) +
        (L.capacidad(pe) < 100 ? ' <small class="muted cap">' + L.capacidad(pe) + '%</small>' : '') + '</h2>' +
        '<small class="muted">' + hechas.length + ' de ' + todas.length + ' · ' + esc(L.minutosTxt(min)) + '</small></div>' +
        '<div class="carga" title="Minutos asignados frente a su tiempo para tareas (' + esc(L.minutosTxt(disp)) + ')"><span style="width:' + Math.min(100, Math.round(100 * min / disp)) + '%"></span><span class="hecho" style="width:' +
        Math.min(100, Math.round(100 * sumMin(hechas) / disp)) + '%"></span></div>' +
        (todas.length ? '<div class="lista">' + todas.map(filaTareaAdmin).join('') + '</div>' : '<p class="muted vacio-chico">Sin tareas hoy.</p>') + '</section>';
    });
    if (!emps.length) h += '<p class="vacio muted">Este local no tiene empleados activos. Asígnalos en <a href="#/equipo/personas">Equipo → Personas</a>.</p>';
    return h;
  }

  // Imprevisto general (paro, tranca grande): el día no cuenta para la puntualidad de nadie
  function diaSinPunt(f) { return ((S.data && S.data.dias_sin_puntualidad) || []).filter(function (x) { return x.fecha === f; })[0] || null; }
  function lineaSinPuntualidad(emps, hoy, ahora) {
    var dia = diaSinPunt(hoy);
    if (dia) return '<p class="ayuda">Hoy no cuenta para la puntualidad' + (dia.motivo ? ' (' + esc(dia.motivo) + ')' : '') +
      '. <button class="btn link" data-acc="sinpunt-quitar" data-id="' + esc(dia.id) + '">Deshacer</button></p>';
    var hayTarde = emps.some(function (pe) { var e = L.estadoAsistencia(db(), pe.id, hoy, ahora); return e === 'tarde' || e === 'falta'; });
    return hayTarde ? '<p class="sin-margen"><button class="btn link" data-acc="sinpunt" data-id="' + hoy + '">¿Imprevisto que afectó a todos? Que hoy no cuente para la puntualidad</button></p>' : '';
  }
  function modalSinPunt(f) {
    var inicioMes = S.hoy.slice(0, 8) + '01';
    return '<h2>Día que no cuenta para la puntualidad</h2><p class="muted">Para un imprevisto que afectó a todos (paro de transporte, tranca grande). Aplica a todos por igual: ese día no suma ni resta en el récord del mes.</p>' +
      '<form data-form="sinpunt"><label class="campo">Día<input type="date" name="fecha" required value="' + esc(f || S.hoy) + '" min="' + inicioMes + '" max="' + S.hoy + '"></label>' +
      '<label class="campo">Motivo<input name="motivo" required maxlength="80" placeholder="Ej.: paro de transporte"></label>' +
      '<div class="acciones"><button class="btn grande" type="submit">Guardar</button></div></form>';
  }

  var CALIF = { 3: 'Bien', 2: 'Regular', 1: 'Mal' };
  var CALIF_TONO = { 3: 'ok', 2: 'aprueba', 1: 'corregir' };
  function revisionesDe(localId, f) {
    return ((S.data && S.data.revisiones) || []).filter(function (r) {
      var a = asig(r.asignacion_id);
      return r.fecha === (f || S.hoy) && a && (!localId || a.local_id === localId);
    });
  }
  function bloqueRevisiones(localId) {
    var revs = revisionesDe(localId);
    if (!revs.length) return '';
    var y = yo();
    revs.sort(function (a, b) { return (a.calificacion == null ? 0 : 1) - (b.calificacion == null ? 0 : 1) || ((a.revisor === y.id ? 0 : 1) - (b.revisor === y.id ? 0 : 1)); });
    var pend = revs.filter(function (r) { return r.calificacion == null; }).length;
    return '<section class="bloque"><div class="bloque-head"><h2>Revisiones de calidad</h2><small class="muted">' + (pend ? pend + ' por revisar' : 'listas') + '</small></div>' +
      '<p class="ayuda sin-margen">Tareas hechas hoy, elegidas al azar. Ve a verlas y califícalas. Los empleados no saben cuáles se revisan.</p><div class="lista">' +
      revs.map(function (r) {
        var a = asig(r.asignacion_id);
        var quien = r.revisor === y.id ? '<span class="pill aprueba">Te toca a ti</span>' : '<span class="extra">Le toca a ' + esc(nombreDe(r.revisor)) + '</span>';
        return '<button class="item" data-acc="ver-revision" data-id="' + esc(r.id) + '"><span class="item-cuerpo"><span class="item-titulo">' + tituloHtml(a) + '</span>' +
          '<span class="item-meta"><span class="extra">' + esc(nombreDe(r.hecho_por || a.hecha_por || a.asignado_a)) + (a.hecha_en ? ' · ' + esc(L.fmtHora(a.hecha_en)) : '') + '</span>' +
          (r.calificacion != null ? '<span class="pill ' + CALIF_TONO[r.calificacion] + '">' + CALIF[r.calificacion] + '</span><span class="extra">por ' + esc(nombreDe(r.revisado_por)) + '</span>' : quien) +
          '</span></span><span class="flecha">›</span></button>';
      }).join('') + '</div></section>';
  }

  function filaTareaAdmin(a) {
    var hecha = a.estado === 'hecha';
    var meta = '<span class="extra">' + a.minutos + ' min</span>' + horaPill(a);
    if (a.fecha < S.hoy) meta += '<span class="pill corregir">atrasada · ' + esc(L.fmtFecha(a.fecha)) + '</span>';
    if (a.just_estado && !hecha) meta += '<span class="pill ' + JUST_TONO[a.just_estado] + '">' + { pendiente: 'justificación por revisar', aprobada: 'justificada', rechazada: 'justificación rechazada' }[a.just_estado] + '</span>';
    if (a.motivo === 'ausencia' && a.asignado_original) meta += '<span class="pill edita">cubre a ' + esc(nombreDe(a.asignado_original)) + '</span>';
    if (a.motivo === 'devuelta') meta += '<span class="pill">devuelta</span>';
    if (a.motivo === 'compensa') meta += '<span class="pill edita">compensación</span>';
    if (!hecha && L.esUrgente(db(), a, new Date())) meta += '<span class="pill corregir">urgente: la puede hacer cualquiera</span>';
    if (a.motivo === 'rescate' && a.rescatada_de) meta += '<span class="pill ' + (a.incumplida ? 'corregir' : 'edita') + '">' + (a.incumplida ? 'se le pasó a ' : 'cubre a ') + esc(nombreDe(a.rescatada_de)) + '</span>';
    if (a.repetir && !hecha) meta += '<span class="pill corregir">a repetir</span>';
    if (a.motivo === 'tomada') meta += '<span class="pill banco">la tomó del pool</span>';
    var p = a.plantilla_id && plantilla(a.plantilla_id);
    if (p && p.frecuencia === 'unica') meta += '<span class="pill espera">una vez</span>';
    if (hecha) meta += '<span class="extra">· ' + esc(L.fmtHora(a.hecha_en)) + '</span>';
    return '<button class="item tarea-admin' + (hecha ? ' hecha' : '') + '" data-acc="ver-tarea" data-id="' + esc(a.id) + '">' +
      '<span class="estado-dot' + (hecha ? ' ok' : '') + '">' + (hecha ? ICON.check : '') + '</span>' +
      '<span class="item-cuerpo"><span class="item-titulo">' + tituloHtml(a) + '</span><span class="item-meta">' + meta + '</span></span><span class="flecha">›</span></button>';
  }

  // ---------- Gerencia: Tareas ----------
  var FREC_TXT = { diaria: 'Todos los días', semanal: 'Ciertos días de la semana', mensual: 'Una vez al mes', unica: 'De una sola vez' };

  function tabsLocales(base, sel, extra) {
    if (!variosLocales()) return '';
    return '<div class="seg-tabs locales-tabs">' + locales().map(function (l) {
      return '<a href="#' + base + (base.indexOf('?') >= 0 ? '&' : '?') + 'local=' + esc(l.id) + (extra || '') + '" data-acc="elegir-local-link" data-id="' + esc(l.id) + '" class="' + (l.id === sel ? 'on' : '') + '">' + esc(l.nombre) + '</a>';
    }).join('') + '</div>';
  }

  function vistaTareas(q) {
    var d = db(), modo = q.get('ver') === 'unica' ? 'unica' : 'rec';
    var loc = q.get('local') && L.localDe(d, q.get('local')) ? q.get('local') : localElegido();
    var emps = loc ? empleadosDe(loc) : empleados();
    var tipica = L.cargaTipica(d, S.hoy, loc);
    var porPersona = emps.length ? Math.round(tipica / emps.length) : 0;
    var delLocal = d.plantillas.filter(function (p) { return !loc || (p.local_id || (L.localPrincipal(d) || {}).id) === loc; });
    var h = '<h1>Tareas</h1>';
    h += tabsLocales('/tareas' + (modo === 'unica' ? '?ver=unica' : ''), loc);
    h += '<div class="kpis"><div class="kpi"><b>' + esc(L.minutosTxt(tipica)) + '</b><span>de trabajo un día normal</span></div>' +
      '<div class="kpi"><b>' + esc(L.minutosTxt(porPersona)) + '</b><span>por persona (' + plural(emps.length, 'activo', 'activos') + ') de ' + esc(L.minutosTxt(aj().minutos_jornada)) + '</span></div></div>';
    if (emps.length && porPersona > aj().minutos_jornada * 0.85) h += '<p class="nota alerta-nota">Con esta carga casi no queda margen: si falta alguien, no da el tiempo. Revisa minutos o frecuencias.</p>';
    else if (emps.length && porPersona < aj().minutos_jornada * 0.5) h += '<p class="nota">Las tareas registradas ocupan menos de la mitad de la jornada. Si hay trabajo que no está aquí, agrégalo: lo que no está en la app no se puede exigir.</p>';

    var qLoc = loc ? '&local=' + loc : '';
    h += '<div class="seg-tabs"><a href="#/tareas' + (loc ? '?local=' + loc : '') + '" class="' + (modo === 'rec' ? 'on' : '') + '">Se repiten</a><a href="#/tareas?ver=unica' + qLoc + '" class="' + (modo === 'unica' ? 'on' : '') + '">De una vez</a></div>';
    h += '<a class="btn grande" href="#/tarea/nueva?tipo=' + (modo === 'unica' ? 'unica' : 'rec') + qLoc + '">' + ICON.mas + (modo === 'unica' ? 'Nueva tarea de una vez' : 'Nueva tarea que se repite') + '</a>';

    if (modo === 'rec') {
      ['diaria', 'semanal', 'mensual'].forEach(function (fr) {
        var l = delLocal.filter(function (p) { return p.frecuencia === fr; })
          .sort(function (a, b) { return (b.activa - a.activa) || (a.titulo < b.titulo ? -1 : 1); });
        if (!l.length) return;
        h += '<section class="bloque"><div class="bloque-head"><h2>' + FREC_TXT[fr] + '</h2><small class="muted">' + l.length + '</small></div><div class="lista">' + l.map(filaPlantilla).join('') + '</div></section>';
      });
      if (!delLocal.some(function (p) { return p.frecuencia !== 'unica'; })) h += '<p class="vacio muted">Todavía no hay tareas. Empieza por las que se hacen todos los días.</p>';
    } else {
      var desde = L.addDias(S.hoy, -14);
      var u = delLocal.filter(function (p) { return p.frecuencia === 'unica' && p.fecha_unica >= desde; })
        .sort(function (a, b) { return a.fecha_unica < b.fecha_unica ? 1 : -1; });
      h += u.length ? '<section class="bloque"><div class="lista">' + u.map(filaPlantilla).join('') + '</div></section>'
        : '<p class="vacio muted">No hay tareas de una vez en las últimas dos semanas.</p>';
    }
    return h;
  }

  function vecesTxt(p) {
    var m = p.momentos || [];
    if (m.length > 1) return ' · ' + m.length + ' veces: ' + m.map(function (x) { return (x.nombre || '') + (x.antes ? ' (antes de ' + L.fmtHoraTxt(x.antes) + ')' : ''); }).join(', ');
    if (m.length === 1 && m[0].antes) return ' · antes de las ' + L.fmtHoraTxt(m[0].antes);
    return '';
  }

  function filaPlantilla(p) {
    var meta = '<span class="extra">' + esc(L.frecuenciaTxt(p)) + ' · ' + p.minutos + ' min' + esc(vecesTxt(p)) + '</span>';
    if ((p.solo_pueden || []).length) meta += '<span class="pill edita">Solo ' + esc(p.solo_pueden.map(nombreDe).join(', ')) + '</span>';
    else if ((p.grupos || []).length) meta += '<span class="pill banco">' + esc(p.grupos.map(nombreGrupo).join(' o ')) + '</span>';
    if (p.frecuencia === 'unica') {
      var a = S.data.asignaciones.filter(function (x) { return x.plantilla_id === p.id; })[0];
      meta += a ? '<span class="pill ' + (a.estado === 'hecha' ? 'ok' : '') + '">' + (a.estado === 'hecha' ? 'Hecha' : (a.asignado_a ? nombreDe(a.asignado_a) : 'Sin asignar')) + '</span>'
        : '<span class="pill">' + (p.al_pool ? 'Irá al pool' : p.asignar_a ? 'Para ' + esc(nombreDe(p.asignar_a)) : 'La app elige') + '</span>';
    }
    if (!p.activa) meta += '<span class="pill">Pausada</span>';
    return '<a class="item' + (p.activa ? '' : ' pausada') + '" href="#/tarea/' + esc(p.id) + '"><span class="item-cuerpo"><span class="item-titulo">' + esc(p.titulo) + '</span>' +
      '<span class="item-meta">' + meta + '</span></span><span class="flecha">›</span></a>';
  }

  function vistaFormTarea(id, q) {
    var nueva = id === 'nueva';
    var p = nueva ? null : plantilla(id);
    if (!nueva && !p) return '<a class="volver" href="#/tareas">‹ Tareas</a><p class="vacio muted">Esa tarea ya no existe.</p>';
    var unica = nueva ? q.get('tipo') === 'unica' : p.frecuencia === 'unica';
    var v = p || { titulo: '', detalle: '', minutos: 15, frecuencia: unica ? 'unica' : 'diaria', dias_semana: [], cada_n: 1, dia_mes: 1,
      fecha_inicio: S.hoy, fecha_unica: S.hoy, solo_pueden: [], asignar_a: null, al_pool: false, activa: true, momentos: [],
      local_id: q.get('local') && L.localDe(db(), q.get('local')) ? q.get('local') : localElegido() };
    var loc = v.local_id || (L.localPrincipal(db()) || {}).id;
    var emps = empleados();
    var oculto = function (pe) { return loc && localDe(pe) !== loc ? ' hidden' : ''; };
    var h = '<a class="volver" href="#/tareas' + (unica ? '?ver=unica' : '') + '">‹ Tareas</a>';
    h += '<h1>' + (nueva ? (unica ? 'Tarea de una vez' : 'Nueva tarea') : 'Editar tarea') + '</h1>';
    if (unica && nueva) h += '<p class="muted">Para algo puntual: llegó mercancía, se rompió algo, hay que preparar un evento.</p>';
    h += '<form data-form="tarea" data-id="' + esc(nueva ? '' : p.id) + '" data-unica="' + (unica ? '1' : '') + '" class="card">';
    if (variosLocales()) {
      h += '<label class="campo">Local<select name="local_id" data-cambio="local-tarea">' + locales().map(function (l) {
        return '<option value="' + esc(l.id) + '"' + (l.id === loc ? ' selected' : '') + '>' + esc(l.nombre) + '</option>';
      }).join('') + '</select></label>';
    }
    h += '<label class="campo">¿Qué hay que hacer?<input name="titulo" required maxlength="120" value="' + esc(v.titulo) + '" placeholder="Ej.: Limpiar neveras exhibidoras"></label>';
    h += '<label class="campo">Detalle <small>(opcional: cómo se hace, qué no olvidar)</small><textarea name="detalle" rows="2" maxlength="500">' + esc(v.detalle || '') + '</textarea></label>';
    h += '<div class="campo"><span>¿Cuánto tarda cada vez? <small>(estimado)</small></span><div class="chips min-chips">' +
      [5, 10, 15, 20, 30, 45, 60, 90].map(function (m) {
        return '<label class="chip-r"><input type="radio" name="min_r" value="' + m + '"' + (v.minutos === m ? ' checked' : '') + '><span>' + L.minutosTxt(m) + '</span></label>';
      }).join('') + '<label class="min-otro"><input type="number" name="minutos" min="1" max="600" value="' + v.minutos + '" inputmode="numeric" aria-label="Minutos"><span>min</span></label></div></div>';

    // Veces al día y hora límite
    var mom = v.momentos || [], veces = Math.max(1, mom.length);
    var ej = ['después del desayuno', 'después del almuerzo', 'antes de cerrar'], ejH = ['12:00', '16:00', '18:00'];
    h += '<div class="campo momentos" data-veces="' + veces + '"><span>¿Cuántas veces al día?</span><div class="seg grande">' +
      [1, 2, 3].map(function (n) { return '<label><input type="radio" name="veces" value="' + n + '"' + (veces === n ? ' checked' : '') + ' data-cambio="veces">' + (n === 1 ? 'Una' : n === 2 ? 'Dos' : 'Tres') + '</label>'; }).join('') + '</div>';
    for (var i = 0; i < 3; i++) {
      var m = mom[i] || {};
      h += '<div class="momento-fila" data-i="' + i + '"' + (i >= veces ? ' hidden' : '') + '>' +
        '<label class="mom-nombre">' + (i + 1) + 'ª vez<input name="mnombre_' + i + '" maxlength="40" value="' + esc(m.nombre || '') + '" placeholder="' + ej[i] + '"></label>' +
        '<label class="mom-hora">Desde<input type="time" name="mdesde_' + i + '" value="' + esc(L.hhmm(m.desde) || '') + '"></label>' +
        '<label class="mom-hora">Antes de<input type="time" name="mantes_' + i + '" value="' + esc(L.hhmm(m.antes) || '') + '" placeholder="' + ejH[i] + '"></label></div>';
    }
    h += '<p class="ayuda veces-ayuda">Las horas son opcionales. «Desde»: no se puede marcar antes. «Antes de»: si no la marca a tiempo, se ve en rojo y queda en el reporte. Cada vez sale como una casilla aparte, y todas las del día las hace la misma persona.' +
      (nueva ? '' : ' Cambiar las veces aplica desde el próximo día.') + '</p></div>';

    if (unica) {
      h += '<label class="campo">¿Qué día?<input type="date" name="fecha_unica" required value="' + esc(v.fecha_unica || S.hoy) + '" min="' + (nueva ? S.hoy : '') + '"></label>';
      var quien = v.al_pool ? 'pool' : (v.asignar_a || 'auto');
      var asigU = nueva ? null : S.data.asignaciones.filter(function (a) { return a.plantilla_id === p.id; })[0];
      if (asigU && asigU.estado === 'pendiente') quien = asigU.asignado_a || 'pool';
      h += '<div class="campo"><span>¿Para quién?</span><div class="seg grande vertical para">' +
        (aj().pool_activo || quien === 'pool' ? '<label><input type="radio" name="quien" value="pool"' + (quien === 'pool' ? ' checked' : '') + '><span><b>Pool</b><small>Cualquiera de ese local la ve y la toma el primero</small></span></label>' : '') +
        '<label><input type="radio" name="quien" value="auto"' + (quien === 'auto' ? ' checked' : '') + '><span><b>La app elige</b><small>Se la da a quien tenga menos carga</small></span></label>' +
        '<label class="para-persona"><input type="radio" name="quien" value="persona"' + (quien !== 'auto' && quien !== 'pool' ? ' checked' : '') + '><span><b>Una persona</b>' +
        '<select name="persona" aria-label="Persona">' + emps.map(function (pe) {
          return '<option value="' + esc(pe.id) + '" data-local="' + esc(localDe(pe)) + '"' + (quien === pe.id ? ' selected' : '') + oculto(pe) + '>' + esc(pe.nombre) + '</option>';
        }).join('') + '</select></span></label>' +
        '</div>' + (asigU && asigU.estado === 'hecha' ? '<p class="ayuda">Ya la hizo ' + esc(nombreDe(asigU.hecha_por)) + '.</p>' : '') + '</div>';
    } else {
      h += '<div class="campo"><span>¿Cada cuánto?</span><div class="seg grande vertical">' +
        ['diaria', 'semanal', 'mensual'].map(function (fr) {
          return '<label><input type="radio" name="frecuencia" value="' + fr + '"' + (v.frecuencia === fr ? ' checked' : '') + ' data-cambio="frecuencia">' + FREC_TXT[fr] + '</label>';
        }).join('') + '</div></div>';
      h += '<div class="campo frec-semanal"' + (v.frecuencia === 'semanal' ? '' : ' hidden') + '><span>¿Qué días?</span><div class="dias">' +
        [1, 2, 3, 4, 5, 6, 0].map(function (dd) {
          return '<label class="dia"><input type="checkbox" name="dias" value="' + dd + '"' + ((v.dias_semana || []).indexOf(dd) >= 0 ? ' checked' : '') + '><span>' + L.DIAS_CORTOS[dd] + '</span></label>';
        }).join('') + '</div><label class="fila-inline">Cada <select name="cada_n">' +
        [1, 2, 3, 4].map(function (n) { return '<option value="' + n + '"' + (v.cada_n === n ? ' selected' : '') + '>' + (n === 1 ? 'semana' : n + ' semanas') + '</option>'; }).join('') +
        '</select></label></div>';
      h += '<div class="campo frec-mensual"' + (v.frecuencia === 'mensual' ? '' : ' hidden') + '><label class="campo">Día del mes <small>(si cae en día libre, se adelanta al día de trabajo anterior)</small>' +
        '<input type="number" name="dia_mes" min="1" max="31" value="' + esc(v.dia_mes || 1) + '" inputmode="numeric"></label>' +
        '<label class="fila-inline">Cada <select name="cada_meses">' + [1, 2, 3, 4, 6, 12].map(function (n) {
          return '<option value="' + n + '"' + ((v.frecuencia === 'mensual' ? v.cada_n || 1 : 1) === n ? ' selected' : '') + '>' + (n === 1 ? 'mes' : n === 12 ? '12 meses (una vez al año)' : n + ' meses') + '</option>';
        }).join('') + '</select></label><small class="ayuda">Cuenta desde el mes en que «Empieza».</small></div>';
      h += '<label class="campo">Empieza<input type="date" name="fecha_inicio" value="' + esc(v.fecha_inicio || S.hoy) + '"></label>';
    }

    var restr = (v.solo_pueden || []).length > 0 ? '1' : ((v.grupos || []).length ? 'g' : '0');
    if (!unica) h += '<div class="campo"><span>¿Quién puede hacerla?</span><div class="seg grande vertical">' +
      '<label><input type="radio" name="restr" value="0"' + (restr === '0' ? ' checked' : '') + ' data-cambio="restr">Cualquiera del local</label>' +
      '<label><input type="radio" name="restr" value="g"' + (restr === 'g' ? ' checked' : '') + ' data-cambio="restr">Uno o más grupos</label>' +
      '<label><input type="radio" name="restr" value="1"' + (restr === '1' ? ' checked' : '') + ' data-cambio="restr">Personas específicas</label></div>' +
      '<div class="solo-grupos"' + (restr === 'g' ? '' : ' hidden') + '>' +
      (grupos().length ? grupos().map(function (g) {
        var miembros = empleados().filter(function (pe) { return (pe.grupos || []).indexOf(g.id) >= 0; }).map(function (pe) { return pe.nombre; });
        return '<label class="check"><input type="checkbox" name="grupo" value="' + esc(g.id) + '"' + ((v.grupos || []).indexOf(g.id) >= 0 ? ' checked' : '') + '><span>' + esc(g.nombre) +
          ' <small class="muted">' + esc(miembros.join(', ') || 'sin personas') + '</small></span></label>';
      }).join('') + '<p class="ayuda">Rota entre todos los que estén en esos grupos. Si entra alguien nuevo al grupo, le empieza a tocar sin editar la tarea.</p>'
        : '<p class="ayuda">Todavía no hay grupos. Créalos en <a href="#/equipo/grupos">Equipo → Grupos</a>.</p>') + '</div>' +
      '<div class="solo-quien"' + (restr === '1' ? '' : ' hidden') + '>' +
      emps.map(function (pe) {
        return '<label class="check" data-local="' + esc(localDe(pe)) + '"' + oculto(pe) + '><input type="checkbox" name="solo" value="' + esc(pe.id) + '"' + ((v.solo_pueden || []).indexOf(pe.id) >= 0 ? ' checked' : '') + '>' + esc(pe.nombre) + '</label>';
      }).join('') + '<p class="ayuda">Si solo puede una persona y falta, la tarea queda esperando hasta que vuelva.</p></div></div>';

    // Cuántas personas la hacen juntas
    if (!unica) h += '<label class="campo">¿Cuántas personas la hacen? <select name="personas">' + [1, 2, 3].map(function (n) {
      return '<option value="' + n + '"' + ((v.personas || 1) === n ? ' selected' : '') + '>' + (n === 1 ? '1 persona' : n + ' personas juntas') + '</option>';
    }).join('') + '</select><small class="ayuda">Con más de una, a cada una le cuentan los minutos completos. Con que una la marque, queda hecha para todas.</small></label>';
    // Registro de temperaturas
    h += '<label class="check"><input type="checkbox" name="registro"' + (v.registro ? ' checked' : '') + ' data-cambio="registro"><span>Pide anotar temperaturas <small class="muted">— al marcarla, la persona anota la lectura de cada equipo de frío</small></span></label>';
    h += '<div class="campo sub-campo registro-equipos"' + (v.registro ? '' : ' hidden') + '><span>¿Qué equipos? <small>(ninguno marcado = todos los activos del local)</small></span>' +
      ((S.data.equipos || []).length ? (S.data.equipos || []).map(function (e) {
        return '<label class="check" data-local="' + esc(e.local_id || '') + '"' + (loc && e.local_id !== loc ? ' hidden' : '') + '><input type="checkbox" name="equipo" value="' + esc(e.id) + '"' + ((v.equipos || []).indexOf(e.id) >= 0 ? ' checked' : '') + '>' + esc(e.nombre) +
          (L.rangoTxt(e) ? ' <small class="muted">' + esc(L.rangoTxt(e)) + '</small>' : '') + '</label>';
      }).join('') : '<p class="ayuda">Todavía no hay equipos. Agrégalos en <a href="#/equipo/frio">Equipo → Equipos de frío</a>.</p>') + '</div>';
    // Tarea que sale después
    var conSeg = !!String(v.seguimiento_titulo || '').trim();
    if (!unica) {
      h += '<label class="check"><input type="checkbox" name="con_seg"' + (conSeg ? ' checked' : '') + ' data-cambio="con-seg"><span>Al hacerla, sale otra tarea después <small class="muted">— por ejemplo «Apagar contenedores» 45 min después de «Prender contenedores», para la misma persona</small></span></label>';
      h += '<div class="campo sub-campo seg-campos"' + (conSeg ? '' : ' hidden') + '><label class="campo">¿Qué tarea?<input name="seg_titulo" maxlength="120" value="' + esc(v.seguimiento_titulo || '') + '" placeholder="Ej.: Apagar contenedores"></label>' +
        '<div class="fila-dos"><label class="campo">¿Cuántos minutos después?<input type="number" name="seg_despues" min="1" max="600" value="' + esc(v.seguimiento_despues || 45) + '" inputmode="numeric"></label>' +
        '<label class="campo">¿Cuánto tarda?<input type="number" name="seg_minutos" min="1" max="600" value="' + esc(v.seguimiento_minutos || 5) + '" inputmode="numeric"></label></div>' +
        '<p class="ayuda">Sale en su lista a esa hora y tiene 15 minutos para marcarla. La app no puede sonar una alarma en el teléfono: si es crítico, que pongan un temporizador.</p></div>';
    }

    if (!nueva) h += '<label class="check"><input type="checkbox" name="activa"' + (v.activa ? ' checked' : '') + '>Activa <small class="muted">(desmárcala para pausarla sin borrar su historial)</small></label>';
    if (!nueva && !unica) {
      var prox = L.proximas(p, S.hoy, L.laborableFn(db(), loc), 3);
      if (prox.length) h += '<p class="ayuda">Próximas veces: ' + esc(prox.map(L.fmtFecha).join(' · ')) + '</p>';
    }
    h += '<div class="acciones"><button class="btn grande" type="submit">' + (nueva ? 'Crear tarea' : 'Guardar cambios') + '</button></div>';
    if (!nueva) h += '<div class="mas-acciones"><button class="btn sec" type="button" data-acc="duplicar-plantilla" data-id="' + esc(p.id) + '">Duplicar</button><button class="btn fantasma rojo" type="button" data-acc="borrar-plantilla" data-id="' + esc(p.id) + '">Borrar tarea</button></div>';
    h += '</form>';
    return h;
  }

  // ---------- Gerencia: Reporte e historial ----------
  function ordenPorLocal(lista, getPersona) {
    var orden = {}; locales().forEach(function (l, i) { orden[l.id] = i; });
    return lista.slice().sort(function (a, b) {
      var la = orden[localDe(getPersona(a))] || 0, lb = orden[localDe(getPersona(b))] || 0;
      if (la !== lb) return la - lb;
      return (getPersona(a).nombre || '') < (getPersona(b).nombre || '') ? -1 : 1;
    });
  }

  function vistaReporte(f) {
    var d = db(), rep = ordenPorLocal(L.reporteDia(d, f, new Date()), function (r) { return r.persona; });
    var sinAsignar = d.asignaciones.filter(function (a) { return a.asignado_a === null && a.estado === 'pendiente' && a.fecha <= f && (a.fecha === f || a.arrastra); });
    rep.sinAsignar = sinAsignar;
    var h = '<h1>Reporte</h1>';
    h += '<div class="cal-nav"><a class="btn sec chico" href="#/reporte?f=' + L.addDias(f, -1) + '">‹</a>' +
      '<input type="date" value="' + f + '" max="' + S.hoy + '" data-cambio="fecha-reporte" aria-label="Fecha del reporte">' +
      (f < S.hoy ? '<a class="btn sec chico" href="#/reporte?f=' + L.addDias(f, 1) + '">›</a>' : '<span class="btn sec chico" aria-disabled="true">›</span>') + '</div>';
    h += '<p class="fecha-hoy">' + esc(L.fmtFechaLarga(f)) + (f === S.hoy ? ' · hoy (aún en curso)' : '') + '</p>';
    var texto = L.textoReporte(rep, f, variosLocales() ? nombreLocal : null, d);
    h += '<div class="acciones arriba"><a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(texto) + '">Enviar por WhatsApp</a>' +
      '<button class="btn sec" data-acc="copiar" data-texto="' + esc(texto) + '">Copiar</button></div>';
    if (!rep.length) h += '<p class="vacio muted">No hay empleados activos.</p>';
    var ultimo = null;
    rep.forEach(function (r) {
      var loc = localDe(r.persona);
      if (variosLocales() && loc !== ultimo) { h += '<h2 class="local-titulo">' + esc(nombreLocal(loc)) + '</h2>'; ultimo = loc; }
      var total = r.hechas.length + r.pendientes.length;
      if (r.estado === 'libre' && !total) return;
      h += '<section class="card rep"><div class="rep-head"><h2>' + esc(r.persona.nombre) + '</h2><span class="pill ' + ESTADO_TONO[r.estado] + '">' + ESTADO_TXT[r.estado] +
        (r.llegada ? ' · ' + esc(L.fmtHora(r.llegada)) : '') + '</span>' +
        (r.local && r.local !== loc ? '<span class="pill edita">Vino a ' + esc(nombreLocal(r.local)) + '</span>' : '') +
        (r.salida ? '<span class="pill corregir">Se fue ' + esc(L.fmtHora(r.salida)) + (r.salidaMotivo ? ' · ' + esc(r.salidaMotivo) : '') + '</span>' : '') + '</div>';
      if (!total) { h += '<p class="muted">Sin tareas este día.</p></section>'; return; }
      h += '<div class="barra"><div class="barra-txt"><span>Hizo <b>' + r.hechas.length + ' de ' + total + '</b></span><small>' + esc(L.minutosTxt(r.minHechos)) + ' de ' + esc(L.minutosTxt(r.minAsignados)) + '</small></div>' +
        '<div class="barra-fondo"><span style="width:' + Math.round(100 * r.minHechos / Math.max(1, r.minAsignados)) + '%"></span></div></div>';
      if (r.pendientes.length) {
        h += '<p class="rep-sub rojo">Quedó pendiente</p><ul class="rep-lista">' + r.pendientes.map(function (a) {
          return '<li>' + tituloHtml(a) + ' <small class="muted">' + a.minutos + ' min' + (a.antes ? ' · antes de las ' + esc(L.fmtHoraTxt(L.hhmm(a.antes))) : '') + (a.fecha < f ? ' · desde ' + esc(L.fmtFecha(a.fecha)) : '') +
            (a.just_estado ? ' · justificación ' + { pendiente: 'por revisar', aprobada: 'aprobada', rechazada: 'rechazada' }[a.just_estado] : (a.fecha < f ? ' · sin justificar' : '')) + '</small></li>';
        }).join('') + '</ul>';
        if (L.estaPresente(r.estado) && r.minAsignados < r.jornada * 0.8) {
          h += '<p class="ayuda">Tenía ' + esc(L.minutosTxt(r.minAsignados)) + ' asignados y ' + esc(L.minutosTxt(r.jornada)) + ' de su jornada para tareas.</p>';
        }
      }
      if (r.incumplidas && r.incumplidas.length) {
        h += '<p class="rep-sub rojo">Se le pasó (la hizo otra persona)</p><ul class="rep-lista">' + r.incumplidas.map(function (a) {
          return '<li>' + tituloHtml(a) + ' <small class="muted">la hizo ' + esc(nombreDe(a.asignado_a)) + '</small></li>';
        }).join('') + '</ul>';
      }
      if (r.hechasTarde.length) {
        h += '<p class="rep-sub ambar">Hechas después de su hora</p><ul class="rep-lista">' + r.hechasTarde.map(function (a) {
          return '<li>' + tituloHtml(a) + ' <small class="muted">tocaba antes de las ' + esc(L.fmtHoraTxt(L.hhmm(a.antes))) + ', la marcó ' + esc(L.fmtHora(a.hecha_en)) + '</small></li>';
        }).join('') + '</ul>';
      }
      if (r.hechas.length) {
        h += '<details class="rep-hechas"><summary>Hechas (' + r.hechas.length + ')</summary><ul class="rep-lista">' + r.hechas.map(function (a) {
          return '<li>' + tituloHtml(a) + ' <small class="muted">' + esc(L.fmtHora(a.hecha_en)) + '</small></li>';
        }).join('') + '</ul></details>';
      }
      h += '</section>';
    });
    if (sinAsignar.length) h += '<section class="card"><h2>Sin asignar</h2><ul class="rep-lista">' + sinAsignar.map(function (a) { return '<li>' + tituloHtml(a) + (variosLocales() ? ' <small class="muted">' + esc(nombreLocal(a.local_id)) + '</small>' : '') + '</li>'; }).join('') + '</ul></section>';
    if ((S.data.equipos || []).length) h += '<a class="card enlace-card" href="#/temperaturas"><b>Temperaturas</b><span class="muted">Lecturas de los últimos 35 días, para descargar ›</span></a>';
    h += '<a class="card enlace-card" href="#/historial"><b>Historial del equipo</b><span class="muted">Tardanzas, faltas y cumplimiento de los últimos 30 días ›</span></a>';
    return h;
  }

  function calidadTxt(pid, dias) {
    var desde = L.addDias(S.hoy, -(dias - 1));
    var revs = ((S.data && S.data.revisiones) || []).filter(function (r) {
      if (r.calificacion == null || r.fecha < desde) return false;
      if (r.hecho_por) return r.hecho_por === pid;
      var a = asig(r.asignacion_id); return !!a && (a.hecha_por || a.asignado_a) === pid;
    });
    if (!revs.length) return '';
    var c = { 3: 0, 2: 0, 1: 0 }; revs.forEach(function (r) { c[r.calificacion]++; });
    return '<span>Calidad: <b class="ok-txt">' + c[3] + '</b> bien · <b class="ambar">' + c[2] + '</b> reg. · <b class="rojo">' + c[1] + '</b> mal</span>';
  }

  function vistaHistorial(dias) {
    dias = dias === 7 ? 7 : 30;
    var hist = L.historial(db(), S.hoy, dias, new Date());
    var h = '<a class="volver" href="#/reporte">‹ Reporte</a><h1>Historial</h1>';
    h += '<div class="seg-tabs"><a href="#/historial?d=7" class="' + (dias === 7 ? 'on' : '') + '">7 días</a><a href="#/historial?d=30" class="' + (dias === 30 ? 'on' : '') + '">30 días</a></div>';
    hist.sort(function (a, b) { return (b.cumplimiento || 0) - (a.cumplimiento || 0); });
    // Puntualidad del mes en curso (para el reconocimiento)
    var MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    var punt = empleados().map(function (pe) { return { pe: pe, p: L.puntualidadMes(db(), pe.id, S.hoy) }; }).filter(function (x) { return x.p.dias > 0; })
      .sort(function (a, b) { return (b.p.a_tiempo / b.p.dias) - (a.p.a_tiempo / a.p.dias) || (a.pe.nombre < b.pe.nombre ? -1 : 1); });
    if (empleados().length) {
      h += '<section class="card"><h2>Puntualidad de ' + MESES_L[Number(S.hoy.slice(5, 7)) - 1] + '</h2><p class="ayuda sin-margen">A tiempo = marcó «Llegué» hasta las ' + esc(L.fmtHoraTxt(L.aTiempoHasta(aj()))) + ' Una falta también cuenta como no a tiempo.</p>' +
        (punt.length ? '' : '<p class="muted">Todavía no hay días contados este mes.</p>') + '<ul class="rep-lista">' +
        punt.map(function (x) {
          var todo = x.p.a_tiempo === x.p.dias;
          return '<li>' + esc(x.pe.nombre) + ' <b>' + x.p.a_tiempo + ' de ' + x.p.dias + '</b>' + (todo ? ' <span class="pill ok">todos a tiempo</span>' : '') + '</li>';
        }).join('') + '</ul>';
      var noCuentan = ((S.data && S.data.dias_sin_puntualidad) || []).filter(function (x) { return x.fecha.slice(0, 7) === S.hoy.slice(0, 7); });
      if (noCuentan.length) h += '<p class="rep-sub">No cuentan</p><ul class="rep-lista">' + noCuentan.map(function (x) {
        return '<li>' + esc(L.fmtFecha(x.fecha)) + (x.motivo ? ' · ' + esc(x.motivo) : '') + ' <button class="btn link" data-acc="sinpunt-quitar" data-id="' + esc(x.id) + '">quitar</button></li>';
      }).join('') + '</ul>';
      h += '<p class="ayuda">' + (aj().mostrar_record ? 'Cada empleado ve su propio récord.' : 'Por ahora solo lo ve gerencia (se cambia en <a href="#/equipo/ajustes">Equipo → Ajustes</a>).') +
        ' <button class="btn link" data-acc="sinpunt">Marcar un día que no cuenta</button></p></section>';
    }
    hist.forEach(function (r) {
      h += '<section class="card hist"><div class="rep-head"><h2>' + esc(r.persona.nombre) + (variosLocales() ? ' <small class="muted local-chico">' + esc(nombreLocal(localDe(r.persona))) + '</small>' : '') + '</h2><b class="hist-pct' + (r.cumplimiento !== null && r.cumplimiento < 80 ? ' rojo' : '') + '">' +
        (r.cumplimiento === null ? '—' : r.cumplimiento + '%') + '</b></div>' +
        '<div class="hist-datos"><span><b>' + r.dias + '</b> días</span><span class="' + (r.tardes ? 'ambar' : '') + '"><b>' + r.tardes + '</b> tarde</span>' +
        '<span class="' + (r.faltas ? 'rojo' : '') + '"><b>' + r.faltas + '</b> ' + (r.faltas === 1 ? 'falta' : 'faltas') + '</span>' +
        (r.salidas ? '<span class="ambar"><b>' + r.salidas + '</b> se fue antes</span>' : '') +
        (r.incumplidas ? '<span class="rojo"><b>' + r.incumplidas + '</b> se le pasaron</span>' : '') +
        (r.rescates ? '<span class="ok-txt"><b>' + r.rescates + '</b> rescató</span>' : '') +
        '<span><b>' + r.hechas + '</b>/' + r.asignadas + ' tareas</span>' +
        (r.fueraDeHora ? '<span class="ambar"><b>' + r.fueraDeHora + '</b> fuera de hora</span>' : '') + calidadTxt(r.persona.id, dias) + '</div>' +
        '<div class="barra-fondo"><span style="width:' + (r.cumplimiento || 0) + '%"></span></div></section>';
    });
    h += '<p class="nota-suave">El porcentaje es tareas hechas sobre tareas asignadas a esa persona. Las que se reasignaron cuentan para quien las terminó teniendo. «Fuera de hora» son las que tenían hora límite y se hicieron después, o no se hicieron.</p>';
    return h;
  }

  // ---------- Gerencia: Equipo, locales y ajustes ----------
  // Equipo: un menú corto y cada sección en su propia pantalla (antes era una sola página larguísima).
  var SECCIONES_EQUIPO = [
    ['personas', 'Personas', 'Quién trabaja, en qué local, a qué entra y su clave'],
    ['grupos', 'Grupos', 'Tareas que solo rotan entre algunos'],
    ['locales', 'Locales', 'Días de trabajo, Wi-Fi y ubicación'],
    ['frio', 'Equipos de frío', 'Neveras, cavas y contenedores'],
    ['calendario', 'Calendario', 'Feriados, vacaciones y días extra'],
    ['avisos', 'Avisos', 'Notificaciones en el teléfono'],
    ['ajustes', 'Ajustes', 'Horarios, puntualidad y reglas generales']
  ];
  function vistaEquipo(sec) {
    var d = db();
    var sel = SECCIONES_EQUIPO.filter(function (x) { return x[0] === sec; })[0];
    if (!sel) {
      var resumen = {
        personas: plural(d.personas.filter(function (pe) { return pe.activo; }).length, 'activa', 'activas'),
        grupos: plural(grupos().length, 'grupo', 'grupos'),
        locales: plural(locales().length, 'local', 'locales'),
        frio: plural(((d.equipos) || []).filter(function (e) { return e.activo !== false; }).length, 'equipo activo', 'equipos activos')
      };
      return '<h1>Equipo</h1><div class="lista">' + SECCIONES_EQUIPO.map(function (x) {
        return '<a class="item" href="#/equipo/' + x[0] + '"><span class="item-cuerpo"><span class="item-titulo">' + esc(x[1]) + '</span>' +
          '<span class="item-meta"><span class="extra">' + esc(x[2]) + (resumen[x[0]] ? ' · ' + esc(resumen[x[0]]) : '') + '</span></span></span><span class="flecha">›</span></a>';
      }).join('') + '</div>' +
        '<p class="version muted"><small>' + (store.modo === 'demo' ? 'Modo demo' : 'Conectado a la base de datos') + ' · Tareas CIL v3</small></p>';
    }
    var h = '<a class="volver" href="#/equipo">‹ Equipo</a>';
    if (sec === 'personas') return h + seccionPersonas();
    if (sec === 'grupos') return h + seccionGrupos();
    if (sec === 'locales') {
      S.redCheck();
      h += '<h1>Locales</h1><p class="ayuda sin-margen">Cada local tiene sus días de trabajo, su Wi-Fi y su ubicación. Las tareas y los empleados de un local no se mezclan con los del otro.</p>';
      h += bloqueRedesNuevas();
      locales().forEach(function (l) { h += tarjetaLocal(l); });
      return h + '<button class="btn sec" data-acc="agregar-local">' + ICON.mas + 'Agregar local</button>';
    }
    if (sec === 'frio') return h + seccionEquipos();
    if (sec === 'calendario') return h + seccionCalendario();
    if (sec === 'avisos') return h + seccionAvisos();
    return h + seccionAjustes();
  }
  function seccionPersonas() {
    var d = db();
    var orden = d.personas.slice().sort(function (x, y) {
      if (x.activo !== y.activo) return x.activo ? -1 : 1;
      if (x.rol !== y.rol) return x.rol === 'admin' ? -1 : 1;
      if (variosLocales() && x.rol === 'empleado' && localDe(x) !== localDe(y)) return nombreLocal(localDe(x)) < nombreLocal(localDe(y)) ? -1 : 1;
      return (x.nombre || '') < (y.nombre || '') ? -1 : 1;
    });
    // Pocas etiquetas por persona (rol y alertas); el resto va en una línea de texto que se ajusta al ancho.
    var h = '<h1>Personas</h1><div class="lista">' + orden.map(function (pe) {
      var emp = pe.rol === 'empleado', det = [];
      if (variosLocales() && emp) det.push(nombreLocal(localDe(pe)));
      if (emp && L.capacidad(pe) < 100) det.push(L.capacidad(pe) + '% para tareas');
      if (emp && pe.tarea_max) det.push('máx. ' + pe.tarea_max + ' min');
      if (emp && (pe.grupos || []).length) det.push((pe.grupos || []).map(nombreGrupo).join(', '));
      if (store.modo === 'supabase' && emp && (pe.accesos || []).length) det.push('Entra a: ' + (pe.accesos || []).map(function (m) { return { tareas: 'Tareas', contenido: 'Contenido', mensajes: 'Mensajes' }[m] || m; }).join(', '));
      return '<button class="item persona-fila' + (pe.activo ? '' : ' pausada') + '" data-acc="editar-persona" data-id="' + esc(pe.id) + '"><span class="item-cuerpo"><span class="item-titulo">' + esc(pe.nombre || '(sin nombre aún)') + '</span>' +
        '<span class="item-meta"><span class="pill ' + (pe.rol === 'admin' ? 'gerencia' : 'edita') + '">' + (pe.rol === 'admin' ? 'Gerencia' : 'Empleado') + '</span>' +
        (pe.activo ? '' : '<span class="pill">Inactivo</span>') +
        (emp && pe.rota === false ? '<span class="pill espera">Fuera de la rotación</span>' : '') +
        (store.modo === 'supabase' && emp && !(pe.accesos || []).length ? '<span class="pill corregir">Sin acceso a nada</span>' : '') +
        (store.modo === 'supabase' && pe.activo && (pe.rol === 'admin' || (pe.accesos || []).indexOf('tareas') >= 0) && S.data.con_avisos && S.data.con_avisos.indexOf(pe.id) < 0 ? '<span class="pill espera">Avisos apagados</span>' : '') + '</span>' +
        (det.length ? '<span class="persona-det">' + esc(det.join(' · ')) + '</span>' : '') +
        '<span class="persona-det muted">' + esc(pe.email || '') + '</span></span><span class="flecha">›</span></button>';
    }).join('') + '</div>';
    if (store.modo === 'supabase') h += '<div class="acciones"><button class="btn" data-acc="nueva-persona">' + ICON.mas + 'Agregar persona</button></div>';
    h += '<p class="ayuda">Si alguien se va, desactívalo: se cierra su sesión en todos sus teléfonos, deja de recibir tareas y avisos, y se guarda su historial.</p>';
    return h;
  }
  function seccionGrupos() {
    var d = db();
    var h = '<h1>Grupos</h1>';
    h += '<p class="ayuda sin-margen">Para tareas que solo rotan entre algunos (por ejemplo, solo despachadores). Una persona puede estar en varios grupos; se asignan abriendo a cada persona en <a href="#/equipo/personas">Personas</a>.</p>';
    h += '<div class="lista">' + grupos().map(function (g) {
      var miembros = empleados().filter(function (pe) { return (pe.grupos || []).indexOf(g.id) >= 0; });
      var nTareas = d.plantillas.filter(function (p) { return (p.grupos || []).indexOf(g.id) >= 0; }).length;
      return '<form class="item grupo-fila" data-form="grupo" data-id="' + esc(g.id) + '"><span class="item-cuerpo">' +
        '<input name="nombre" value="' + esc(g.nombre) + '" maxlength="30" aria-label="Nombre del grupo" required>' +
        '<span class="item-meta"><span class="extra">' + esc(miembros.map(function (pe) { return pe.nombre; }).join(', ') || 'Sin personas todavía') + ' · ' + plural(nTareas, 'tarea', 'tareas') + '</span></span></span>' +
        '<button class="btn chico sec" type="submit">Guardar</button><button class="quitar" type="button" data-acc="borrar-grupo" data-id="' + esc(g.id) + '" aria-label="Borrar grupo">×</button></form>';
    }).join('') + '</div>';
    h += '<button class="btn sec" data-acc="agregar-grupo">' + ICON.mas + 'Agregar grupo</button>';
    return h;
  }
  function seccionAjustes() {
    var a = aj();
    var h = '<h1>Ajustes</h1><form data-form="ajustes" class="card">';
    h += '<div class="fila-dos"><label class="campo">A tiempo hasta<input type="time" name="a_tiempo_hasta" value="' + esc(L.aTiempoHasta(a)) + '" required></label>' +
      '<label class="campo">Hora límite (falta)<input type="time" name="hora_limite" value="' + esc(L.hhmm(a.hora_limite)) + '" required></label></div>';
    h += '<p class="ayuda sin-margen">Hasta la primera hora cuenta «a tiempo»; después, «tarde». Quien no marque «Llegué» antes de la hora límite aparece como falta y sus tareas se reparten solas: primero a quienes llegaron tarde (el de último primero, hasta 30 min sobre el promedio) y lo demás a quien tenga menos carga. Si nadie puede hacer alguna, te la muestro en Hoy para que la apruebes. Aplica a todos los locales.</p>';
    h += '<label class="check"><input type="checkbox" name="usar_salidas"' + (a.usar_salidas ? ' checked' : '') + '><span>Botón «Salí a despachar» / «Volví» <small class="muted">— si alguien lo marcó antes de que empiece la ventana de una tarea con horario, esa tarea pasa a otro sin penalizarlo. Si no lo marcó y otra persona tuvo que hacerla, queda como «se le pasó» y le compensa los minutos a quien la hizo. Apagado, nada de eso aplica: las urgentes igual las puede hacer cualquiera, sin penalización.</small></span></label>';
    h += '<label class="check"><input type="checkbox" name="mostrar_record"' + (a.mostrar_record ? ' checked' : '') + '><span>Cada empleado ve su récord de puntualidad del mes <small class="muted">— apagado, solo lo ves tú en Historial.</small></span></label>';
    h += '<label class="campo">Jornada (horas)<input type="number" name="jornada" min="1" max="15" step="0.5" value="' + (a.minutos_jornada / 60) + '" required inputmode="decimal"></label>';
    h += '<label class="check"><input type="checkbox" name="pool"' + (a.pool_activo ? ' checked' : '') + '><span>Pool de tareas libres <small class="muted">— los empleados ven las tareas sin dueño de su local y pueden tomarlas. Si lo apagas, lo que quede sin asignar solo lo ves tú.</small></span></label>';
    h += '<label class="check"><input type="checkbox" name="solo_tienda"' + (a.solo_en_tienda ? ' checked' : '') + '><span>«Llegué» solo en el local <small class="muted">— solo funciona conectado al Wi-Fi de un local. Fuera, les sale «No se pudo marcar tu llegada», sin explicar por qué. Marcar «Hecho» también exige haber marcado «Llegué». Registra el Wi-Fi de cada local antes de activarlo.</small></span></label>';
    h += '<label class="check sub-check"><input type="checkbox" name="usar_gps"' + (a.usar_gps ? ' checked' : '') + '><span>Si no está en el Wi-Fi, probar con la ubicación del teléfono <small class="muted">— el teléfono les pedirá permiso de ubicación (eso no se puede ocultar). La ubicación no se guarda: solo se compara con la del local.</small></span></label>';
    h += '<label class="campo">Revisiones de calidad por día<select name="revisiones_dia">' + [0, 2, 4, 6, 8, 10].map(function (n) {
      return '<option value="' + n + '"' + ((a.revisiones_dia == null ? 4 : a.revisiones_dia) === n ? ' selected' : '') + '>' + (n ? n + ' al día (' + n / 2 + ' de la mañana y ' + n / 2 + ' de la tarde)' : 'Ninguna') + '</option>';
    }).join('') + '</select><small class="ayuda">La mitad sale de lo hecho antes de las 12 (se eligen al mediodía) y la otra mitad de lo hecho desde las 12 (se eligen a las 4 p. m.). Se reparten entre gerencia.</small></label>';
    if (store.modo === 'demo') {
      h += '<label class="check demo-fuera"><input type="checkbox" data-cambio="demo-fuera"' + (store.fuera() ? ' checked' : '') + '><span>Solo demo: simular que este teléfono está <b>fuera</b> de cualquier local</span></label>';
    }
    h += '<div class="acciones"><button class="btn" type="submit">Guardar ajustes</button></div></form>';
    return h;
  }

  // ---------- Calendario: feriados, vacaciones colectivas y días de trabajo extra ----------
  function seccionCalendario() {
    var desde = S.hoy, hasta = L.addDias(S.hoy, 400);
    var es = ((S.data && S.data.dias_especiales) || []).filter(function (x) { return x.fecha >= desde && x.fecha <= hasta; })
      .sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
    // agrupar días seguidos con el mismo nombre, tipo y local
    var grupos = [];
    es.forEach(function (x) {
      var g = grupos[grupos.length - 1];
      if (g && g.tipo === x.tipo && g.nombre === x.nombre && g.local_id === (x.local_id || null) && L.addDias(g.hasta, 1) === x.fecha) { g.hasta = x.fecha; g.ids.push(x.id); }
      else grupos.push({ desde: x.fecha, hasta: x.fecha, tipo: x.tipo, nombre: x.nombre, local_id: x.local_id || null, ids: [x.id] });
    });
    var h = '<h1>Calendario</h1>';
    var anioSig = Number(S.hoy.slice(0, 4)) + 1;
    var hayFeriadosSig = ((S.data && S.data.dias_especiales) || []).some(function (x) { return x.tipo === 'libre' && !x.local_id && x.fecha.slice(0, 4) === String(anioSig) && x.fecha.slice(5) === '01-01'; });
    if (Number(S.hoy.slice(5, 7)) >= 10 && !hayFeriadosSig) {
      h += '<p class="nota alerta-nota">Faltan los feriados de ' + anioSig + '. Agrégalos abajo (Carnaval y Semana Santa cambian cada año).</p>';
    }
    h += '<p class="ayuda sin-margen">Feriados, vacaciones colectivas y días de trabajo extra (por ejemplo, sábados de diciembre). Los días libres no generan tareas ni cuentan como falta.</p>';
    h += '<div class="acciones arriba"><button class="btn sec" data-acc="atajo-vacaciones">Cargar vacaciones colectivas</button></div>';
    h += '<form data-form="especial" class="card"><div class="seg grande">' +
      '<label><input type="radio" name="tipo" value="libre" checked>Día libre</label><label><input type="radio" name="tipo" value="laborable">Día de trabajo extra</label></div>' +
      '<div class="fila-dos"><label class="campo">Desde<input type="date" name="desde" required min="' + S.hoy + '"></label><label class="campo">Hasta <small>(opcional)</small><input type="date" name="hasta" min="' + S.hoy + '"></label></div>' +
      '<label class="campo">Nombre<input name="nombre" maxlength="60" placeholder="Ej.: Vacaciones colectivas, sábados de diciembre"></label>' +
      (variosLocales() ? '<label class="campo">¿Dónde?<select name="local_id"><option value="">Todos los locales</option>' + locales().map(function (l) { return '<option value="' + esc(l.id) + '">' + esc(l.nombre) + '</option>'; }).join('') + '</select></label>' : '') +
      '<label class="check"><input type="checkbox" name="solo_sab">Solo los sábados del rango <small class="muted">(útil para «sábados de diciembre»)</small></label>' +
      '<div class="acciones"><button class="btn" type="submit">Agregar al calendario</button></div></form>';
    h += grupos.length ? '<div class="lista cal-lista">' + grupos.slice(0, 40).map(function (g) {
      var rango = g.desde === g.hasta ? L.fmtFecha(g.desde) : L.fmtFecha(g.desde) + ' – ' + L.fmtFecha(g.hasta);
      return '<div class="item"><span class="item-cuerpo"><span class="item-titulo">' + esc(rango) + (g.nombre ? ' · ' + esc(g.nombre) : '') + '</span>' +
        '<span class="item-meta"><span class="pill ' + (g.tipo === 'libre' ? 'corregir' : 'ok') + '">' + (g.tipo === 'libre' ? 'Libre' : 'Se trabaja') + '</span>' +
        (variosLocales() ? '<span class="extra">' + esc(g.local_id ? nombreLocal(g.local_id) : 'Todos los locales') + '</span>' : '') + '</span></span>' +
        '<button class="quitar" data-acc="borrar-especial" data-id="' + esc(g.ids.join(',')) + '" aria-label="Quitar">×</button></div>';
    }).join('') + '</div>' : '<p class="muted">No hay días especiales próximos.</p>';
    return h;
  }

  function guardarEspecial(f, fd) {
    var desde = fd.get('desde'), hasta = fd.get('hasta') || desde, tipo = fd.get('tipo'), loc = fd.get('local_id') || null;
    if (!desde) { aviso('Elige la fecha.'); return; }
    if (hasta < desde) { aviso('La fecha «hasta» es antes de «desde».'); return; }
    if (L.difDias(hasta, desde) > 62) { aviso('El rango máximo es de dos meses.'); return; }
    var nombre = String(fd.get('nombre') || '').trim() || (tipo === 'libre' ? 'Día libre' : 'Día de trabajo extra');
    var fechas = [];
    for (var x = desde; x <= hasta; x = L.addDias(x, 1)) if (!fd.get('solo_sab') || L.dow(x) === 6) fechas.push(x);
    if (!fechas.length) { aviso('No hay sábados en ese rango.'); return; }
    var existentes = ((S.data && S.data.dias_especiales) || []).filter(function (e) { return fechas.indexOf(e.fecha) >= 0 && (e.local_id || null) === loc; });
    var p = existentes.reduce(function (pr, e) { return pr.then(function () { return store.borrar('dias_especiales', e.id); }); }, Promise.resolve());
    p = p.then(function () { return store.insertarVarios('dias_especiales', fechas.map(function (fe) { return { fecha: fe, local_id: loc, tipo: tipo, nombre: nombre }; })); });
    ejecutar(p, plural(fechas.length, 'día agregado', 'días agregados') + ' al calendario.').then(function (r) { if (r !== undefined) f.reset(); });
  }

  // Alguien intentó marcar «Llegué» desde una red que la app no conoce (el proveedor pudo cambiarla)
  function bloqueRedesNuevas() {
    var rs = (S.data && S.data.redes_nuevas) || [];
    if (!rs.length) return '';
    var porIp = {};
    rs.forEach(function (r) { (porIp[r.ip] = porIp[r.ip] || []).push(r); });
    return '<section class="card alerta-card"><h2>Redes nuevas por revisar</h2><p class="ayuda sin-margen">Alguien no pudo marcar «Llegué» desde estas redes. Si es el Wi-Fi del local (el proveedor a veces lo cambia), regístrala aquí y vuelven a poder marcar.</p>' +
      Object.keys(porIp).map(function (ip) {
        var lista = porIp[ip], r = lista[0];
        return '<div class="tienda-fila"><div><b>' + esc(lista.map(function (x) { return nombreDe(x.persona_id); }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', ')) + '</b>' +
          '<span class="muted">' + esc(L.fmtFecha(String(r.creado_en).slice(0, 10))) + ' · ' + esc(L.fmtHora(r.creado_en)) + '</span></div>' +
          '<div class="acciones">' + locales().map(function (l) { return '<button class="btn chico" data-acc="aceptar-red" data-id="' + esc(r.id) + '" data-local="' + esc(l.id) + '">Es de ' + esc(l.nombre) + '</button>'; }).join('') +
          '<button class="btn fantasma chico" data-acc="ignorar-red" data-id="' + esc(lista.map(function (x) { return x.id; }).join(',')) + '">No es del local</button></div></div>';
      }).join('') + '</section>';
  }

  function tarjetaLocal(l) {
    var red = S.red || {}, aqui = (red.locales || []).indexOf(l.id) >= 0, nRedes = (l.redes || []).length, hayGps = l.lat != null;
    var nEmp = empleadosDe(l.id).length;
    var h = '<form data-form="local" data-id="' + esc(l.id) + '" class="card local-card">';
    h += '<div class="local-head"><input name="nombre" value="' + esc(l.nombre) + '" maxlength="40" aria-label="Nombre del local" required><span class="muted">' + plural(nEmp, 'empleado', 'empleados') + '</span></div>';
    h += '<div class="campo"><span>Días que trabaja</span><div class="dias">' + [1, 2, 3, 4, 5, 6, 0].map(function (dd) {
      return '<label class="dia"><input type="checkbox" name="lab" value="' + dd + '"' + ((l.dias_laborables || []).indexOf(dd) >= 0 ? ' checked' : '') + '><span>' + L.DIAS_CORTOS[dd] + '</span></label>';
    }).join('') + '</div></div>';
    h += '<div class="tienda-fila"><div><b>Wi-Fi</b><span class="muted">' + (nRedes ? plural(nRedes, 'red registrada', 'redes registradas') : 'Ninguna red registrada') +
      (red.ip ? (aqui ? ' · <span class="ok-txt">este teléfono está aquí</span>' : '') : (S.red === null ? ' · revisando…' : '')) + '</span></div>' +
      (aqui ? '' : '<button class="btn sec chico" type="button" data-acc="registrar-red" data-id="' + esc(l.id) + '">Registrar esta red</button>') + '</div>';
    h += '<div class="tienda-fila"><div><b>Ubicación</b><span class="muted">' + (hayGps ? 'Guardada · <a href="https://maps.google.com/?q=' + l.lat + ',' + l.lng + '" target="_blank" rel="noopener">ver en el mapa</a>' : 'Sin guardar') + '</span></div>' +
      '<button class="btn sec chico" type="button" data-acc="guardar-ubicacion" data-id="' + esc(l.id) + '">' + (hayGps ? 'Actualizar' : 'Usar mi ubicación') + '</button></div>';
    h += '<label class="fila-inline">Radio <select name="radio_m">' + [100, 150, 250, 400].map(function (m) {
      return '<option value="' + m + '"' + (l.radio_m === m ? ' selected' : '') + '>' + m + ' m</option>';
    }).join('') + '</select><small class="muted">alrededor del local</small></label>';
    h += '<p class="ayuda">Wi-Fi y ubicación se registran estando en ese local. Si deja de reconocer el Wi-Fi, vuelve a registrarlo desde ahí.</p>';
    var sinWifi = l.sin_wifi_fecha === S.hoy;
    h += '<div class="tienda-fila"><div><b>¿Se cayó el Wi-Fi?</b><span class="muted">' + (sinWifi ? '<span class="ok-txt">Hoy pueden marcar «Llegué» sin el Wi-Fi</span>' : 'Permite marcar «Llegué» sin el Wi-Fi solo por hoy') + '</span></div>' +
      '<button class="btn ' + (sinWifi ? 'sec' : 'warn') + ' chico" type="button" data-acc="sin-wifi" data-id="' + esc(l.id) + '" data-v="' + (sinWifi ? '0' : '1') + '">' + (sinWifi ? 'Ya volvió' : 'Hoy no hay Wi-Fi') + '</button></div>';
    h += '<div class="acciones"><button class="btn chico" type="submit">Guardar local</button>' +
      (l.principal ? '' : '<button class="btn fantasma rojo chico" type="button" data-acc="borrar-local" data-id="' + esc(l.id) + '">Borrar</button>') + '</div></form>';
    return h;
  }

  function vistaPerfil(primeraVez) {
    var y = yo();
    var h = primeraVez ? '<h1>¡Bienvenido!</h1><p class="muted">Antes de empezar, dinos cómo te llamas.</p>' : '<a class="volver" href="#/">‹ Volver</a><h1>Mi perfil</h1>';
    h += '<form data-form="perfil" class="card"><label class="campo">Nombre<input name="nombre" required maxlength="40" value="' + esc(y.nombre || '') + '" autocomplete="given-name"></label>' +
      '<label class="campo">WhatsApp <small>(opcional)</small><input name="telefono" inputmode="tel" maxlength="20" value="' + esc(y.telefono || '') + '" placeholder="0414…"></label>' +
      '<button class="btn grande" type="submit">Guardar</button></form>';
    if (!primeraVez) h += '<p class="muted">' + esc(y.email || '') + '</p>';
    return h;
  }

  function vistaLogin() {
    return '<div class="login"><div class="login-marca"><span class="logo grande">CIL</span><h1>Tareas CIL</h1><p class="muted">Entra con el correo y la clave que te dio gerencia.</p></div>' +
      '<form data-form="login" class="card"><label class="campo">Correo<input type="email" name="email" required autocomplete="username" inputmode="email"></label>' +
      '<label class="campo">Clave<input type="password" name="clave" required autocomplete="current-password"></label>' +
      '<button class="btn grande" type="submit">Entrar</button></form></div><div id="capas"></div>';
  }

  // ---------- Modales ----------
  function modalHtml() {
    var m = S.modal; if (!m) return '';
    var c = '';
    if (m.tipo === 'reasignar') c = modalReasignar();
    else if (m.tipo === 'tarea') c = modalTarea(m.id);
    else if (m.tipo === 'asistencia') c = modalAsistencia(m.id);
    else if (m.tipo === 'persona') c = modalPersona(m.id);
    else if (m.tipo === 'nueva-persona') c = modalNuevaPersona();
    else if (m.tipo === 'justificar') c = modalJustificar(m.id);
    else if (m.tipo === 'salida') c = modalSalida();
    else if (m.tipo === 'registro') c = modalRegistro(m.id);
    else if (m.tipo === 'sinpunt') c = modalSinPunt(m.id);
    else if (m.tipo === 'revision') c = modalRevision(m.id);
    else if (m.tipo === 'confirmar') c = '<h2>' + esc(m.texto) + '</h2><div class="acciones"><button class="btn warn" data-acc="confirmar-si">' + esc(m.boton) + '</button><button class="btn sec" data-acc="cerrar">Cancelar</button></div>';
    if (!c) return '';
    return '<div class="modal" role="dialog" aria-modal="true"><div class="modal-fondo" data-acc="cerrar"></div><div class="hoja">' +
      '<button class="cerrar" data-acc="cerrar" aria-label="Cerrar">×</button>' + c + '</div></div>';
  }

  function opcionesPersona(sel, permitidos, conPool, localId) {
    var d = db(), ahora = new Date();
    var o = (localId ? empleadosDe(localId) : empleados()).map(function (pe) {
      var e = L.estadoAsistencia(d, pe.id, S.hoy, ahora);
      var nota = L.estaPresente(e) ? '' : ' (' + ESTADO_TXT[e].toLowerCase() + ')';
      var ok = !permitidos || permitidos.indexOf(pe.id) >= 0;
      return '<option value="' + esc(pe.id) + '"' + (sel === pe.id ? ' selected' : '') + (ok ? '' : ' disabled') + '>' + esc(pe.nombre) + nota + (ok ? '' : ' — no puede') + '</option>';
    }).join('');
    if (conPool) o += '<option value=""' + (!sel ? ' selected' : '') + '>' + (aj().pool_activo ? 'Pool (la toma quien pueda)' : 'Sin asignar') + '</option>';
    return o;
  }

  function modalReasignar() {
    var loc = S.modal.local || null;
    var sug = L.sugerirReasignacion(db(), S.hoy, new Date(), loc);
    if (!sug.items.length) return '<h2>Todo cubierto</h2><p class="muted">No hay tareas pendientes de personas que falten.</p>';
    var h = '<h2>Repartir lo de ' + esc(sug.faltan.map(nombreDe).join(' y ')) + '</h2>' +
      '<p class="muted">Te sugiero quién tiene menos carga entre los que sí vinieron. Cambia lo que quieras y aprueba. Si llegan tarde, lo que no se haya hecho vuelve a ellos solo.</p>' +
      '<form data-form="reasignar"><div class="reasig">';
    sug.items.forEach(function (it) {
      var a = it.asignacion;
      var solo = puedenSolo(a);
      h += '<label class="reasig-fila"><span class="reasig-t"><b>' + tituloHtml(a) + '</b><small class="muted">' + a.minutos + ' min · de ' + esc(nombreDe(it.de)) +
        (a.antes ? ' · antes de las ' + esc(L.fmtHoraTxt(L.hhmm(a.antes))) : '') + (a.fecha < S.hoy ? ' · atrasada' : '') + '</small></span><select name="a_' + esc(a.id) + '">' + opcionesPersona(it.sugerido, solo, true, a.local_id || loc) + '</select></label>';
    });
    h += '</div><div class="acciones"><button class="btn grande" type="submit">Aprobar reasignación</button></div></form>';
    var cargaTras = {}, gente = loc ? empleadosDe(loc) : empleados();
    gente.forEach(function (pe) { var t = L.tareasDe(db(), pe.id, S.hoy); cargaTras[pe.id] = sumMin(t.hoy.concat(t.atrasadas)); });
    sug.items.forEach(function (it) { if (it.sugerido && cargaTras[it.sugerido] !== undefined) cargaTras[it.sugerido] += it.asignacion.minutos; });
    h += '<p class="ayuda">Carga con la sugerencia: ' + esc(gente.filter(function (pe) { return L.estaPresente(L.estadoAsistencia(db(), pe.id, S.hoy, new Date())); })
      .map(function (pe) { return pe.nombre + ' ' + L.minutosTxt(cargaTras[pe.id]); }).join(' · ')) + '</p>';
    return h;
  }
  function puedenSolo(a) {
    var p = a.plantilla_id && plantilla(a.plantilla_id);
    if (!p || (!(p.solo_pueden || []).length && !(p.grupos || []).length)) return null;
    return empleados().filter(function (pe) { return L.puedeSegun(p, pe); }).map(function (pe) { return pe.id; });
  }

  function modalTarea(id) {
    var a = asig(id); if (!a) return '';
    var hecha = a.estado === 'hecha';
    var p = a.plantilla_id && plantilla(a.plantilla_id);
    var h = '<h2>' + tituloHtml(a) + '</h2><p class="muted">' + esc(L.fmtFechaLarga(a.fecha)) + ' · ' + a.minutos + ' min' + (p ? ' · ' + esc(L.frecuenciaTxt(p)) : '') +
      (a.antes ? ' · antes de las ' + esc(L.fmtHoraTxt(L.hhmm(a.antes))) : '') + (variosLocales() ? ' · ' + esc(nombreLocal(a.local_id)) : '') + '</p>';
    if (a.detalle) h += '<p class="nota">' + esc(a.detalle) + '</p>';
    if (a.justificacion && !hecha) {
      var decidida = a.just_estado === 'aprobada' || a.just_estado === 'rechazada';
      var mia = decidida && a.just_por === yo().id;
      h += '<div class="just-box"><b>Justificación' + (a.just_estado ? ' · ' + { pendiente: 'por revisar', aprobada: 'aprobada', rechazada: 'rechazada' }[a.just_estado] : '') + '</b><p>«' + esc(a.justificacion) + '»</p>';
      if (!decidida) {
        h += '<button class="btn chico ok" data-acc="just-ok" data-id="' + esc(a.id) + '">Aprobar</button> <button class="btn chico sec" data-acc="just-no" data-id="' + esc(a.id) + '">Rechazar</button>';
      } else if (mia) {
        h += '<p class="ayuda">La revisaste tú. Si fue un error:</p><button class="btn chico sec" data-acc="' + (a.just_estado === 'aprobada' ? 'just-no' : 'just-ok') + '" data-id="' + esc(a.id) + '">Cambiar a ' + (a.just_estado === 'aprobada' ? 'rechazada' : 'aprobada') + '</button>';
      } else {
        h += '<p class="ayuda">Decisión de ' + esc(nombreDe(a.just_por)) + '. Es final; solo quien decidió puede corregirla.</p>';
      }
      h += '</div>';
    } else if (!hecha && a.fecha < S.hoy) {
      h += '<p><button class="btn link" data-acc="justificar" data-id="' + esc(a.id) + '">Justificar yo esta tarea atrasada</button></p>';
    }
    if (hecha && a.registro) {
      var ls = lecturasDe(a.id);
      if (ls.length) h += '<ul class="rep-lista">' + ls.map(function (l) { var e = equipo(l.equipo_id); return '<li' + (l.fuera_rango ? ' class="rojo"' : '') + '>' + esc(e ? e.nombre : 'Equipo') + ': ' + esc(tempTxt(l)) + (l.nota ? ' · «' + esc(l.nota) + '»' : '') + '</li>'; }).join('') + '</ul>';
    }
    if (hecha) h += '<p class="llego presente">' + ICON.check + '<span>Hecha por ' + esc(nombreDe(a.hecha_por)) + ' · ' + esc(L.fmtHora(a.hecha_en)) + (L.hoyISO(new Date(a.hecha_en)) !== a.fecha ? ' del ' + esc(L.fmtFecha(L.hoyISO(new Date(a.hecha_en)))) : '') + '</span></p>';
    else {
      h += '<form data-form="reasignar-una" data-id="' + esc(a.id) + '"><label class="campo">Le toca a<select name="a">' + opcionesPersona(a.asignado_a, puedenSolo(a), true, a.local_id) + '</select></label>' +
        (p && (p.momentos || []).length > 1 ? '<label class="check"><input type="checkbox" name="todas" checked>Pasar también las otras veces de hoy de esta tarea</label>' : '') +
        '<div class="acciones"><button class="btn" type="submit">Reasignar</button><button class="btn sec" type="button" data-acc="hecha" data-id="' + esc(a.id) + '" data-v="1">' + (a.registro ? 'Anotar temperaturas' : 'Marcar hecha') + '</button></div></form>';
    }
    if (hecha) h += '<div class="acciones"><button class="btn sec" data-acc="hecha" data-id="' + esc(a.id) + '" data-v="0">Desmarcar</button></div>';
    h += '<div class="historial"><h3>Historial</h3>' + (S.eventos === null ? '<p class="muted">Cargando…</p>' :
      S.eventos.length ? '<ul class="timeline">' + S.eventos.map(eventoHtml).join('') + '</ul>' : '<p class="muted">Sin movimientos.</p>') + '</div>';
    if (p && p.frecuencia === 'unica' && !hecha) h += '<div class="mas-acciones"><button class="btn fantasma rojo" data-acc="borrar-asig" data-id="' + esc(a.id) + '">Borrar esta tarea</button></div>';
    if (p) h += '<p><a href="#/tarea/' + esc(p.id) + '" data-acc="cerrar-ir">Editar la tarea (afecta a los días siguientes) ›</a></p>';
    return h;
  }
  function eventoHtml(e) {
    var txt = {
      generada: e.a ? 'Se le asignó a ' + nombreDe(e.a) : 'Quedó sin asignar',
      hecha: nombreDe(e.a) + ' la marcó hecha',
      deshecha: 'Se desmarcó',
      reasignada: 'Pasó de ' + (e.de ? nombreDe(e.de) : 'sin asignar') + ' a ' + (e.a ? nombreDe(e.a) : 'sin asignar') + (e.texto === 'ausencia' ? ' (por ausencia)' : e.texto === 'compensa' ? ' (compensación)' : e.texto === 'rescate' ? ' (urgente: se le pasó)' : e.texto === 'rescate_excusa' ? ' (urgente: estaba fuera)' : ''),
      devuelta: 'Volvió a ' + nombreDe(e.a) + ' porque llegó',
      tomada: nombreDe(e.a) + ' la tomó del pool'
    }[e.tipo] || e.tipo;
    var autor = e.autor && e.tipo !== 'hecha' && e.tipo !== 'tomada' ? ' · por ' + nombreDe(e.autor) : '';
    return '<li class="ev"><div class="ev-cuerpo"><p class="ev-txt">' + esc(txt) + '</p><time>' + esc(L.fmtFecha(L.hoyISO(new Date(e.creado_en)))) + ', ' + esc(L.fmtHora(e.creado_en)) + esc(autor) + '</time></div></li>';
  }

  function modalAsistencia(id) {
    var pe = persona(id); if (!pe) return '';
    var e = L.estadoAsistencia(db(), id, S.hoy, new Date()), s = L.asistenciaDe(db(), id, S.hoy);
    var VERIF = { wifi: ' (Wi-Fi del local)', gps: ' (ubicación)', gerencia: ' (marcado por gerencia)', sin_wifi: ' (día sin Wi-Fi)', sin_conexion: ' (marcado sin internet)' };
    var h = '<h2>' + esc(pe.nombre) + '</h2><p class="muted">Hoy: ' + ESTADO_TXT[e] + (s && s.llegada ? ' · llegó ' + esc(L.fmtHora(s.llegada)) + (VERIF[s.verificado] || '') : '') + '</p><div class="seg vertical botones">';
    if (!L.estaPresente(e)) h += '<button class="btn" data-acc="asis-set" data-id="' + esc(id) + '" data-v="presente">Llegó (marcar ahora)</button>';
    if (e !== 'ausente') h += '<button class="btn sec" data-acc="asis-set" data-id="' + esc(id) + '" data-v="ausente">No viene hoy</button>';
    if (L.estaPresente(e) && s && !s.salida) h += '<button class="btn sec" data-acc="asis-set" data-id="' + esc(id) + '" data-v="salida">Se fue (marcar salida ahora)</button>';
    if (s && s.salida) h += '<p class="just-box">Se fue ' + esc(L.fmtHora(s.salida)) + (s.salida_motivo ? ': «' + esc(s.salida_motivo) + '»' : '') + '</p>' +
      '<button class="btn fantasma" data-acc="asis-set" data-id="' + esc(id) + '" data-v="sin_salida">Quitar salida (fue un error)</button>';
    if (s) h += '<button class="btn fantasma" data-acc="asis-set" data-id="' + esc(id) + '" data-v="sin_marcar">Quitar marca</button>';
    h += '</div><p class="ayuda">Marca «No viene hoy» apenas avise, así puedes repartir sus tareas sin esperar a la hora límite.</p>';
    return h;
  }

  function modalRevision(id) {
    var r = ((S.data && S.data.revisiones) || []).filter(function (x) { return x.id === id; })[0]; if (!r) return '';
    var a = asig(r.asignacion_id); if (!a) return '';
    var y = yo(), puede = r.calificacion == null || r.revisado_por === y.id;
    var h = '<h2>Revisar: ' + tituloHtml(a) + '</h2><p class="muted">La hizo ' + esc(nombreDe(r.hecho_por || a.hecha_por || a.asignado_a)) + (a.hecha_en ? ' a las ' + esc(L.fmtHora(a.hecha_en)) : '') +
      (variosLocales() ? ' · ' + esc(nombreLocal(a.local_id)) : '') + (r.revisor ? ' · le tocaba revisarla a ' + esc(nombreDe(r.revisor)) : '') + '</p>';
    if (a.detalle) h += '<p class="nota">' + esc(a.detalle) + '</p>';
    if (!puede) return h + '<p class="just-box">Calificada <b>' + CALIF[r.calificacion] + '</b> por ' + esc(nombreDe(r.revisado_por)) + (r.nota ? ': «' + esc(r.nota) + '»' : '') + '. Es final.</p>';
    h += '<form data-form="calificar" data-id="' + esc(r.id) + '"><div class="campo"><span>¿Cómo quedó?</span><div class="seg grande">' +
      [3, 2, 1].map(function (c) { return '<label><input type="radio" name="calif" value="' + c + '"' + (r.calificacion === c ? ' checked' : '') + ' data-cambio="calif" required>' + CALIF[c] + '</label>'; }).join('') + '</div></div>' +
      '<label class="campo">Nota <small>(opcional)</small><textarea name="nota" rows="2" maxlength="300" placeholder="Qué faltó o qué estuvo bien">' + esc(r.nota || '') + '</textarea></label>' +
      '<label class="check repetir-check"' + (r.calificacion === 1 ? '' : ' hidden') + '><input type="checkbox" name="repetir" checked>Que la repita (vuelve a su lista de hoy)</label>' +
      '<div class="acciones"><button class="btn grande" type="submit">Guardar calificación</button></div></form>';
    if (r.calificacion != null) h += '<p class="ayuda">Ya la calificaste. Puedes corregirla si fue un error.</p>';
    return h;
  }

  // ---------- Avisos en el teléfono (push) ----------
  function b64aBytes(t) { t = String(t).replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; var b = atob(t), o = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }
  function bytesAB64(buf) { var b = new Uint8Array(buf), t = ''; for (var i = 0; i < b.length; i++) t += String.fromCharCode(b[i]); return btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function iosSinInstalar() { return /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) && !navigator.standalone; }
  // Estado: 'no' (no se puede aquí) | 'ios' (iPhone sin instalar) | 'bloqueado' | 'off' | 'on' | null (revisando)
  function revisarAvisos() {
    if (!store || store.modo !== 'supabase' || !CFG.vapidPublicKey || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window) || location.protocol !== 'https:') { S.avisos = 'no'; return; }
    if (iosSinInstalar()) { S.avisos = 'ios'; return; }
    if (Notification.permission === 'denied') { S.avisos = 'bloqueado'; return; }
    if (S.avisosRevisando) return;
    S.avisosRevisando = true;
    navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
      S.avisos = sub && Notification.permission === 'granted' ? 'on' : 'off';
      // se vuelve a guardar una vez por sesión, por si el teléfono cambió la suscripción
      if (sub && !S.avisosGuardados) { S.avisosGuardados = true; var j = sub.toJSON(); store.rpc('guardar_suscripcion', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth }).catch(function () { /* nada */ }); }
      render();
    }, function () { S.avisos = 'no'; render(); });
  }
  function activarAvisos() {
    if (!('Notification' in window)) return;
    S.ocupado = true; pintarCapas();
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Bloqueaste los avisos. Actívalos en los ajustes del navegador para esta página.' : 'No se activaron los avisos.');
      return navigator.serviceWorker.ready;
    }).then(function (reg) {
      return reg.pushManager.getSubscription().then(function (sub) { return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64aBytes(CFG.vapidPublicKey) }); });
    }).then(function (sub) {
      var j = sub.toJSON();
      return store.rpc('guardar_suscripcion', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    }).then(function () {
      S.ocupado = false; S.avisos = 'on'; S.avisosGuardados = true; aviso('Listo: te llegarán los avisos en este teléfono.', 'ok'); render();
    }, function (e) {
      S.ocupado = false; pintarCapas(); revisarAvisos(); aviso(e && e.message ? e.message : 'No se pudieron activar los avisos.');
    });
  }
  function tarjetaAvisos(paraGerencia) {
    if (S.avisos === undefined || S.avisos === null) revisarAvisos();
    var e = S.avisos;
    if (e === 'on' && !paraGerencia) return '';
    if (e === 'no' && !paraGerencia) return '';
    if (e === 'ios') return '<div class="card avisos-card"><span><b>Avisos en el teléfono</b><br><small class="muted">En iPhone, primero instala la app: Compartir → «Agregar a inicio», y ábrela desde el ícono.</small></span></div>';
    if (e === 'bloqueado') return '<div class="card avisos-card"><span><b>Avisos bloqueados</b><br><small class="muted">Actívalos en los ajustes del navegador para esta página.</small></span></div>';
    if (e === 'off') return '<div class="card avisos-card"><span><b>Avisos en el teléfono</b><br><small class="muted">Te avisa cuando te toca algo con hora o cuando algo urgente se está pasando.</small></span><button class="btn chico" data-acc="activar-avisos">Activar</button></div>';
    if (e === 'on') return '<div class="card avisos-card"><span><b>Avisos activados</b> en este teléfono</span><button class="btn chico sec" data-acc="aviso-prueba">Enviarme uno de prueba</button></div>';
    return '';
  }
  function seccionAvisos() {
    var h = '<h1>Avisos en el teléfono</h1>';
    if (store.modo !== 'supabase') return h + '<p class="ayuda">En el modo demo no hay avisos.</p>';
    if (!CFG.vapidPublicKey) {
      h += '<p class="ayuda sin-margen">Para activarlos sigue el paso «Avisos» de la guía. Primero genera aquí las claves: la pública va en <code>config.js</code> y en Supabase; la privada solo en Supabase. Nunca compartas la privada.</p>';
      if (S.claves) h += '<div class="card claves"><b>Clave pública</b><code>' + esc(S.claves.publica) + '</code><b>Clave privada</b><code>' + esc(S.claves.privada) + '</code>' +
        '<p class="ayuda">Cópialas ahora a un lugar seguro: al salir de esta pantalla no se vuelven a mostrar.</p></div>';
      else h += '<button class="btn sec" data-acc="generar-claves">Generar claves</button>';
      return h;
    }
    return h + tarjetaAvisos(true) + '<p class="ayuda">Cada persona los activa en su propio teléfono (le sale el botón en su pantalla). Avisos: le toca algo con hora · algo urgente se está pasando · ¿ya llegaste? · a gerencia: resumen de asistencia a las 9:30 (solo si alguien faltó o llegó tarde), temperatura fuera de rango al momento, alguien se fue antes.</p>';
  }
  function generarClaves() {
    crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']).then(function (k) {
      return Promise.all([crypto.subtle.exportKey('raw', k.publicKey), crypto.subtle.exportKey('jwk', k.privateKey)]);
    }).then(function (r) { S.claves = { publica: bytesAB64(r[0]), privada: r[1].d }; render(); }, function () { aviso('Este navegador no pudo generar las claves.'); });
  }

  // ---------- Temperaturas ----------
  function equiposLocal(localId) { return ((S.data && S.data.equipos) || []).filter(function (e) { return (e.local_id || null) === (localId || null); }).sort(function (a, b) { return (a.orden || 0) - (b.orden || 0) || (a.nombre < b.nombre ? -1 : 1); }); }
  function equipo(id) { return ((S.data && S.data.equipos) || []).filter(function (e) { return e.id === id; })[0] || null; }
  function lecturasDe(asigId) { return ((S.data && S.data.lecturas) || []).filter(function (x) { return x.asignacion_id === asigId; }); }
  function tempTxt(x) {
    if (!x) return '—';
    var t = x.temperatura === null || x.temperatura === undefined ? '' : String(Number(x.temperatura)).replace('.', ',') + ' °C';
    return (t || '') + (x.estado === 'defrost' ? (t ? ' · ' : '') + 'defrost' : x.estado === 'apagado' ? (t ? ' · ' : '') + 'apagado' : '');
  }
  // Corto para tablas: «−19,5», «8 D» (defrost), «A» (apagado)
  function tempCorto(x) {
    if (!x) return '—';
    var t = x.temperatura === null || x.temperatura === undefined ? '' : String(Number(x.temperatura)).replace('.', ',').replace('-', '−');
    return (t + (x.estado === 'defrost' ? ' D' : x.estado === 'apagado' ? ' A' : '')).trim();
  }
  function modalRegistro(id) {
    var a = asig(id); if (!a) return '';
    var eqs = L.equiposDe(db(), a.local_id, a);
    if (!eqs.length) return '<h2>' + tituloHtml(a) + '</h2><p class="muted">Este local no tiene equipos cargados. Gerencia los agrega en Equipo → Equipos de frío.</p>';
    return '<h2>' + tituloHtml(a) + '</h2><p class="muted">Anota lo que marca cada equipo ahora.</p><form data-form="registro" data-id="' + esc(a.id) + '" class="registro">' +
      eqs.map(function (e) {
        var r = L.rangoTxt(e);
        return '<fieldset class="lectura" data-equipo="' + esc(e.id) + '" data-min="' + (e.temp_min == null ? '' : e.temp_min) + '" data-max="' + (e.temp_max == null ? '' : e.temp_max) + '">' +
          '<legend>' + esc(e.nombre) + (r ? ' <small class="muted">' + esc(r) + '</small>' : '') + '</legend>' +
          '<div class="lectura-fila"><label class="lectura-temp"><input type="number" step="0.1" name="t_' + esc(e.id) + '" aria-label="Temperatura de ' + esc(e.nombre) + '" placeholder="°C"><span>°C</span></label>' +
          '<div class="seg lectura-estado">' + [['normal', 'Normal'], ['defrost', 'Defrost'], ['apagado', 'Apagado']].map(function (o) {
            return '<label><input type="radio" name="e_' + esc(e.id) + '" value="' + o[0] + '"' + (o[0] === 'normal' ? ' checked' : '') + '>' + o[1] + '</label>';
          }).join('') + '</div></div>' +
          '<p class="lectura-aviso" hidden>Fuera de rango: escribe qué pasó.</p>' +
          '<input class="lectura-nota" name="n_' + esc(e.id) + '" maxlength="200" placeholder="Nota (obligatoria si está fuera de rango)"></fieldset>';
      }).join('') + '<div class="acciones"><button class="btn grande" type="submit">Guardar y marcar hecha</button></div></form>';
  }
  function revisarLectura(fs) {
    var t = fs.querySelector('input[type=number]').value, est = (fs.querySelector('input[type=radio]:checked') || {}).value || 'normal';
    var fuera = t !== '' && L.fueraDeRango({ temp_min: fs.getAttribute('data-min'), temp_max: fs.getAttribute('data-max') }, Number(t), est);
    fs.classList.toggle('fuera', fuera);
    fs.querySelector('.lectura-aviso').hidden = !fuera;
  }
  // Hoy: una cuadrícula por local (equipos × veces del día)
  function bloqueTemperaturas(localId) {
    var eqs = equiposLocal(localId).filter(function (e) { return e.activo !== false; });
    if (!eqs.length) return '';
    var tareas = db().asignaciones.filter(function (a) { return a.registro && a.fecha === S.hoy && (!localId || a.local_id === localId); })
      .sort(function (x, y) { return (x.momento || 0) - (y.momento || 0); });
    if (!tareas.length) return '';
    var fuera = 0;
    var filas = eqs.map(function (e) {
      return '<tr><th>' + esc(e.nombre) + '</th>' + tareas.map(function (a) {
        var x = lecturasDe(a.id).filter(function (l) { return l.equipo_id === e.id; })[0];
        if (x && x.fuera_rango) fuera++;
        var cls = !x ? (L.estadoHora(a, new Date()) === 'vencida' ? 'vencida' : '') : x.fuera_rango ? 'fuera' : x.estado !== 'normal' ? 'otro' : 'ok';
        return '<td class="' + cls + '"' + (x && x.nota ? ' title="' + esc(x.nota) + '"' : '') + '>' + esc(x ? tempCorto(x) : (cls === 'vencida' ? 'no se tomó' : '—')) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    var notas = ((S.data && S.data.lecturas) || []).filter(function (l) { return l.fecha === S.hoy && l.fuera_rango && tareas.some(function (a) { return a.id === l.asignacion_id; }); });
    return '<section class="bloque' + (fuera ? ' alerta' : '') + '"><div class="bloque-head"><h2>Temperaturas <small class="muted">°C · D defrost · A apagado</small></h2><a class="muted" href="#/temperaturas' + (localId ? '?local=' + esc(localId) : '') + '">Historial ›</a></div>' +
      '<div class="tabla-scroll"><table class="temps"><thead><tr><th></th>' + tareas.map(function (a) {
        return '<th>' + esc(a.momento_nombre || (a.desde ? L.fmtHoraTxt(L.hhmm(a.desde)) : 'Hoy')) + (a.desde ? '<small>' + esc(L.fmtHoraTxt(L.hhmm(a.desde))) + '</small>' : '') + '</th>';
      }).join('') + '</tr></thead><tbody>' + filas + '</tbody></table></div>' +
      (notas.length ? '<ul class="rep-lista">' + notas.map(function (l) {
        var e = equipo(l.equipo_id);
        return '<li class="rojo">' + esc(e ? e.nombre : 'Equipo') + ': ' + esc(tempTxt(l)) + ' · «' + esc(l.nota || '') + '» <small class="muted">' + esc(nombreDe(l.registrado_por)) + ', ' + esc(L.fmtHora(l.registrado_en)) + '</small></li>';
      }).join('') + '</ul>' : '') + '</section>';
  }
  // Historial de temperaturas (35 días) con descarga
  function vistaTemperaturas(q) {
    var d = db(), loc = q.get('local') && L.localDe(d, q.get('local')) ? q.get('local') : localElegido();
    var h = '<a class="volver" href="#/reporte">‹ Reporte</a><h1>Temperaturas</h1>' + tabsLocales('/temperaturas', loc);
    var eqs = equiposLocal(loc);
    if (!eqs.length) return h + '<p class="vacio muted">Este local no tiene equipos. Agrégalos en <a href="#/equipo/frio">Equipo → Equipos de frío</a>.</p>';
    var lects = (d.lecturas || []).filter(function (l) { return eqs.some(function (e) { return e.id === l.equipo_id; }); });
    var momentoDe = function (l) { var a = asig(l.asignacion_id); return a ? (a.momento || 0) : 0; };
    var nombreMom = {};
    d.asignaciones.forEach(function (a) { if (a.registro && a.local_id === loc && nombreMom[a.momento || 0] === undefined) nombreMom[a.momento || 0] = a.momento_nombre || (a.desde ? L.fmtHoraTxt(L.hhmm(a.desde)) : 'Lectura'); });
    var moms = Object.keys(nombreMom).map(Number).sort(function (a, b) { return a - b; });
    if (!moms.length) moms = [0];
    var fechas = lects.map(function (l) { return l.fecha; }).filter(function (f, i, arr) { return arr.indexOf(f) === i; }).sort().reverse();
    var csv = [['Fecha', 'Equipo', 'Vez', 'Temperatura (°C)', 'Estado', 'Fuera de rango', 'Nota', 'Registró', 'Hora'].join(';')];
    lects.slice().sort(function (a, b) { return a.registrado_en < b.registrado_en ? -1 : 1; }).forEach(function (l) {
      var e = equipo(l.equipo_id);
      csv.push([l.fecha, e ? e.nombre : '', nombreMom[momentoDe(l)] || '', l.temperatura === null ? '' : String(l.temperatura).replace('.', ','), l.estado, l.fuera_rango ? 'sí' : 'no',
        (l.nota || '').replace(/[;\n]/g, ' '), nombreDe(l.registrado_por), L.fmtHora(l.registrado_en)].join(';'));
    });
    h += '<div class="acciones arriba"><a class="btn sec" download="temperaturas-' + esc(S.hoy) + '.csv" href="data:text/csv;charset=utf-8,' + encodeURIComponent('\ufeff' + csv.join('\n')) + '">Descargar (Excel)</a></div>';
    h += '<p class="ayuda sin-margen">Últimos 35 días, en °C. <b>D</b> = defrost, <b>A</b> = apagado. En rojo, fuera de rango: tócala para ver la nota.</p>';
    eqs.forEach(function (e) {
      var r = L.rangoTxt(e);
      h += '<section class="card"><h2>' + esc(e.nombre) + (r ? ' <small class="muted">' + esc(r) + '</small>' : '') + (e.activo === false ? ' <span class="pill">inactivo</span>' : '') + '</h2>' +
        '<div class="tabla-scroll"><table class="temps"><thead><tr><th>Día</th>' + moms.map(function (m) { return '<th>' + esc(nombreMom[m] || '') + '</th>'; }).join('') + '</tr></thead><tbody>' +
        (fechas.length ? fechas.map(function (f) {
          return '<tr><th>' + esc(L.fmtFecha(f).replace(/ [a-z]+$/, '')) + '</th>' + moms.map(function (m) {
            var x = lects.filter(function (l) { return l.equipo_id === e.id && l.fecha === f && momentoDe(l) === m; })[0];
            var cls = !x ? '' : x.fuera_rango ? 'fuera' : x.estado !== 'normal' ? 'otro' : 'ok';
            return '<td class="' + cls + '"' + (x && x.nota ? ' title="' + esc(x.nota) + '" data-acc="ver-nota" data-texto="' + esc(x.nota) + '"' : '') + '>' + esc(x ? tempCorto(x) : '—') + '</td>';
          }).join('') + '</tr>';
        }).join('') : '<tr><td colspan="' + (moms.length + 1) + '" class="muted">Sin lecturas todavía.</td></tr>') + '</tbody></table></div></section>';
    });
    return h;
  }
  function seccionEquipos() {
    var h = '<h1>Equipos de frío</h1><p class="ayuda sin-margen">Neveras, cavas y contenedores cuya temperatura se anota. El rango es para avisar cuando algo está fuera. Una tarea con «registro de temperaturas» pide la lectura de todos los equipos activos de su local (o de los que elijas en la tarea).</p>';
    locales().forEach(function (l) {
      var eqs = equiposLocal(l.id);
      if (variosLocales()) h += '<h3 class="local-titulo">' + esc(l.nombre) + '</h3>';
      h += '<div class="lista">' + eqs.map(function (e) {
        return '<form class="item equipo-fila" data-form="equipo" data-id="' + esc(e.id) + '"><span class="item-cuerpo">' +
          '<input name="nombre" value="' + esc(e.nombre) + '" maxlength="40" aria-label="Nombre del equipo" required>' +
          '<span class="rango"><label>Mín.<input type="number" step="0.1" name="temp_min" value="' + (e.temp_min == null ? '' : e.temp_min) + '"></label>' +
          '<label>Máx.<input type="number" step="0.1" name="temp_max" value="' + (e.temp_max == null ? '' : e.temp_max) + '"></label><span>°C</span></span>' +
          '<label class="check chico"><input type="checkbox" name="activo"' + (e.activo !== false ? ' checked' : '') + '>Activo</label></span>' +
          '<button class="btn chico sec" type="submit">Guardar</button><button class="quitar" type="button" data-acc="borrar-equipo" data-id="' + esc(e.id) + '" aria-label="Borrar equipo">×</button></form>';
      }).join('') + '</div><button class="btn sec" data-acc="agregar-equipo" data-id="' + esc(l.id) + '">' + ICON.mas + 'Agregar equipo' + (variosLocales() ? ' en ' + esc(l.nombre) : '') + '</button>';
    });
    return h;
  }

  function modalSalida() {
    return '<h2>¿Te vas antes?</h2><p class="muted">Queda registrada la hora. Lo que no hayas hecho hoy pasa a gerencia para repartirlo.</p>' +
      '<form data-form="salida"><label class="campo">Motivo <small>(opcional)</small><textarea name="motivo" rows="2" maxlength="200" placeholder="Ej.: cita médica, me mandaron a despachar"></textarea></label>' +
      '<div class="acciones"><button class="btn grande" type="submit">Marcar salida</button></div></form>';
  }
  function modalJustificar(id) {
    var a = asig(id); if (!a) return '';
    return '<h2>¿Por qué no se hizo?</h2><p class="muted">' + tituloHtml(a) + ' · del ' + esc(L.fmtFecha(a.fecha)) + '</p>' +
      '<form data-form="justificar" data-id="' + esc(a.id) + '"><label class="campo">Motivo<textarea name="texto" rows="3" maxlength="300" required placeholder="Ej.: no había producto de limpieza; estuve despachando todo el día">' + esc(a.justificacion || '') + '</textarea></label>' +
      '<p class="ayuda">' + (esAdmin() ? 'Como gerencia, queda aprobada de una vez.' : 'Gerencia la revisa. Aunque la aprueben, la tarea sigue siendo tuya hasta que la hagas.') + '</p>' +
      '<div class="acciones"><button class="btn grande" type="submit">' + (esAdmin() ? 'Guardar y aprobar' : 'Enviar') + '</button></div></form>';
  }

  function modalNuevaPersona() {
    return '<h2>Agregar persona</h2><p class="muted">Queda lista para entrar con este correo y esta clave. Dáselos en persona.</p>' +
      '<form data-form="nueva-persona"><label class="campo">Nombre<input name="nombre" required maxlength="40" autocomplete="off"></label>' +
      '<label class="campo">Correo<input name="email" type="email" required autocomplete="off" autocapitalize="off" spellcheck="false"></label>' +
      '<label class="campo">Clave <small>(mínimo 8 caracteres)</small><input name="clave" type="text" minlength="8" required autocomplete="off" autocapitalize="off" spellcheck="false"></label>' +
      (variosLocales() ? '<label class="campo">Local<select name="local_id">' + locales().map(function (l) { return '<option value="' + esc(l.id) + '">' + esc(l.nombre) + '</option>'; }).join('') + '</select></label>' : '') +
      '<label class="campo">Rol<select name="rol"><option value="empleado">Empleado</option><option value="admin">Gerencia (entra a todo)</option></select></label>' +
      '<div class="campo"><span>Módulos a los que entra <small>(si es empleado)</small></span>' +
      [['tareas', 'Tareas'], ['contenido', 'Contenido'], ['mensajes', 'Armador de mensajes']].map(function (m) {
        return '<label class="check"><input type="checkbox" name="acceso" value="' + m[0] + '"' + (m[0] === 'tareas' ? ' checked' : '') + '>' + m[1] + '</label>';
      }).join('') + '</div>' +
      '<div class="acciones"><button class="btn grande" type="submit">Agregar</button></div></form>';
  }

  function modalPersona(id) {
    var pe = persona(id); if (!pe) return '';
    var soyYo = pe.id === yo().id;
    return '<h2>' + esc(pe.nombre || pe.email) + '</h2><p class="muted">' + esc(pe.email || '') + '</p>' +
      '<form data-form="persona" data-id="' + esc(pe.id) + '"><label class="campo">Nombre<input name="nombre" required maxlength="40" value="' + esc(pe.nombre || '') + '"></label>' +
      '<label class="campo">Rol<select name="rol"' + (soyYo ? ' disabled' : '') + '><option value="empleado"' + (pe.rol === 'empleado' ? ' selected' : '') + '>Empleado (solo los módulos que marques)</option>' +
      '<option value="admin"' + (pe.rol === 'admin' ? ' selected' : '') + '>Gerencia (entra a todos los módulos y administra)</option></select></label>' +
      (variosLocales() ? '<label class="campo">Local<select name="local_id">' + locales().map(function (l) {
        return '<option value="' + esc(l.id) + '"' + (l.id === localDe(pe) ? ' selected' : '') + '>' + esc(l.nombre) + '</option>';
      }).join('') + '</select></label>' : '<p class="campo">Local <small>' + esc(nombreLocal(localDe(pe))) + ' · para elegir otro, primero toca «Agregar local» en Equipo → Locales</small></p>') +
      (pe.rol === 'empleado' ? '<label class="campo">Tiempo para tareas <small>(el resto lo dedica a despachar, preparar pedidos, etc.)</small><select name="capacidad">' +
        [100, 90, 80, 70, 60, 50, 40, 30, 25].map(function (c) { return '<option value="' + c + '"' + (L.capacidad(pe) === c ? ' selected' : '') + '>' + c + '% de su jornada</option>'; }).join('') +
        (([100, 90, 80, 70, 60, 50, 40, 30, 25].indexOf(L.capacidad(pe)) < 0) ? '<option value="' + L.capacidad(pe) + '" selected>' + L.capacidad(pe) + '%</option>' : '') +
        '</select></label><p class="ayuda sin-margen">El reparto es proporcional: alguien al 50% recibe más o menos la mitad de minutos que alguien al 100%.</p>' +
        '<label class="campo">Tope por tarea <small>(para quien está en el local por ratos cortos)</small><select name="tarea_max">' +
        '<option value="">Sin tope</option>' + [10, 15, 20, 30, 45, 60].map(function (m) { return '<option value="' + m + '"' + (pe.tarea_max === m ? ' selected' : '') + '>Hasta ' + m + ' min por tarea</option>'; }).join('') +
        (pe.tarea_max && [10, 15, 20, 30, 45, 60].indexOf(pe.tarea_max) < 0 ? '<option value="' + pe.tarea_max + '" selected>Hasta ' + pe.tarea_max + ' min</option>' : '') +
        '</select></label><p class="ayuda sin-margen">No le tocan tareas más largas, salvo que nadie más del grupo pueda hacerlas.</p>' : '') +
      (pe.rol === 'empleado' ? (function () {
        var base = L.labDe(db(), localDe(pe)), sel = (pe.dias_trabajo && pe.dias_trabajo.length) ? pe.dias_trabajo : base;
        return '<div class="campo"><span>Días que trabaja <small>(si no es igual a su local)</small></span><div class="dias">' + [1, 2, 3, 4, 5, 6, 0].map(function (dd) {
          return '<label class="dia"><input type="checkbox" name="dtrab" value="' + dd + '"' + (sel.indexOf(dd) >= 0 ? ' checked' : '') + '><span>' + L.DIAS_CORTOS[dd] + '</span></label>';
        }).join('') + '</div><small class="ayuda">Los días que no trabaja no recibe tareas ni cuenta como falta.</small></div>';
      })() : '') +
      (pe.rol === 'empleado' && grupos().length ? '<div class="campo"><span>Grupos</span>' + grupos().map(function (g) {
        return '<label class="check"><input type="checkbox" name="grupo" value="' + esc(g.id) + '"' + ((pe.grupos || []).indexOf(g.id) >= 0 ? ' checked' : '') + '>' + esc(g.nombre) + '</label>';
      }).join('') + '</div>' : '') +
      (pe.rol === 'empleado' ? '<label class="check"><input type="checkbox" name="rota"' + (pe.rota !== false ? ' checked' : '') + '>Entra en las tareas «para cualquiera»</label>' +
        '<p class="ayuda sin-margen">Desmárcalo para personal administrativo: solo recibe las tareas de sus grupos o las que le asignes. Igual marca «Llegué» y sale en el reporte.</p>' : '') +
      (store.modo === 'supabase' && pe.rol !== 'admin' ? '<div class="campo"><span>Módulos a los que entra <small>(gerencia entra a todos)</small></span>' +
        [['tareas', 'Tareas'], ['contenido', 'Contenido'], ['mensajes', 'Armador de mensajes']].map(function (m) {
          return '<label class="check"><input type="checkbox" name="acceso" value="' + m[0] + '"' + ((pe.accesos || []).indexOf(m[0]) >= 0 ? ' checked' : '') + '>' + m[1] + '</label>';
        }).join('') + '</div>' : '') +
      '<label class="check"><input type="checkbox" name="activo"' + (pe.activo ? ' checked' : '') + (soyYo ? ' disabled' : '') + '>Activo <small class="muted">(puede entrar)</small></label>' +
      (soyYo ? '<p class="ayuda">No puedes quitarte el rol ni desactivarte a ti misma.</p>' : '') +
      '<div class="acciones"><button class="btn grande" type="submit">Guardar</button></div></form>' +
      (store.modo === 'supabase' && (pe.rol !== 'admin' || soyYo) ? '<form data-form="clave" data-id="' + esc(pe.id) + '"><h3>Cambiar clave</h3>' +
        '<label class="campo">Clave nueva <small>(mínimo 8 caracteres; dísela en persona)</small><input name="clave" type="text" minlength="8" required autocomplete="off" autocapitalize="off" spellcheck="false"></label>' +
        '<div class="acciones"><button class="btn sec" type="submit">Cambiar clave</button></div></form>' : '');
  }

  // El modal solo se vuelve a pintar si cambió (otro modal, datos nuevos o su historial): así un aviso
  // de validación no borra lo que la persona ya escribió en el formulario.
  function pintarCapas() {
    var el = document.getElementById('capas'); if (!el) return;
    var cm = document.getElementById('capa-modal');
    if (!cm) { el.innerHTML = '<div id="capa-modal"></div><div id="capa-toast"></div><div id="capa-ocupado"></div>'; cm = document.getElementById('capa-modal'); S._pint = null; }
    var p = S._pint;
    if (!p || p[0] !== S.modal || p[1] !== S.data || p[2] !== S.eventos) { cm.innerHTML = modalHtml(); S._pint = [S.modal, S.data, S.eventos]; }
    document.getElementById('capa-toast').innerHTML = S.toast ? '<div class="toast ' + (S.toast.tipo === 'ok' ? 'ok' : '') + '" role="status">' + esc(S.toast.texto) + '</div>' : '';
    document.getElementById('capa-ocupado').innerHTML = S.ocupado ? '<div class="ocupado"><div class="spinner"></div></div>' : '';
  }
  function confirmar(texto, boton, fn) { S.confirmFn = fn; abrirModal({ tipo: 'confirmar', texto: texto, boton: boton }); }
  function abrirModal(m) {
    S.modal = m; S.eventos = null; pintarCapas();
    if (m.tipo === 'tarea') {
      store.eventos(m.id).then(function (ev) { if (S.modal && S.modal.id === m.id) { S.eventos = ev || []; pintarCapas(); } }, function () { S.eventos = []; pintarCapas(); });
    }
  }

  // ---------- Acciones ----------
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-acc]'); if (!el) return;
    var acc = el.getAttribute('data-acc'), id = el.getAttribute('data-id');
    if (el.tagName === 'A' && acc !== 'cerrar-ir') ev.preventDefault();
    if (acc === 'cerrar') { S.modal = null; pintarCapas(); }
    else if (acc === 'cerrar-ir') { S.modal = null; pintarCapas(); }
    else if (acc === 'recargar') recargar(false);
    else if (acc === 'salir') (borrarCache(), store.salir()).then(function () { S.data = null; location.hash = '/'; render(); });
    else if (acc === 'reiniciar-demo') confirmar('¿Volver a los datos de ejemplo? Se pierde lo que hayas probado.', 'Reiniciar demo', function () { store.reiniciar(); S.modal = null; recargar(false); });
    else if (acc === 'confirmar-si') { var fn = S.confirmFn; S.confirmFn = null; if (fn) fn(); }
    else if (acc === 'llegue') llegar();
    else if (acc === 'hecha') marcarHecha(id, el.getAttribute('data-v') === '1');
    else if (acc === 'me-voy') abrirModal({ tipo: 'salida' });
    else if (acc === 'activar-avisos') activarAvisos();
    else if (acc === 'aviso-prueba') ejecutar(store.rpc('aviso_prueba', {}), 'Listo: te debería llegar en menos de un minuto.');
    else if (acc === 'generar-claves') generarClaves();
    else if (acc === 'fuera') ejecutar(store.rpc('marcar_fuera', { p_fuera: el.getAttribute('data-v') === '1' }), el.getAttribute('data-v') === '1' ? 'Marcado: estás fuera. Toca «Volví» al regresar.' : 'Listo, ya estás de vuelta.');
    else if (acc === 'rescatar') ejecutar(store.rpc('rescatar', { p_id: id }), 'Es tuya. Hazla ya: está en tu lista.');
    else if (acc === 'agregar-equipo') ejecutar(store.insertar('equipos', { nombre: 'Nuevo equipo', local_id: id, activo: true, orden: equiposLocal(id).length + 1, temp_min: null, temp_max: null }), 'Equipo agregado. Ponle nombre y rango.');
    else if (acc === 'borrar-equipo') confirmar('¿Borrar este equipo? Se borran también sus lecturas. Si solo dejó de usarse, desmarca «Activo».', 'Borrar equipo', function () { ejecutar(store.borrar('equipos', id), 'Equipo borrado.', true); });
    else if (acc === 'ver-nota') aviso(el.getAttribute('data-texto'), 'ok');
    else if (acc === 'sinpunt') abrirModal({ tipo: 'sinpunt', id: id });
    else if (acc === 'sinpunt-quitar') confirmar('¿Volver a contar ese día para la puntualidad?', 'Sí, que cuente', function () {
      ejecutar(store.borrar('dias_sin_puntualidad', id), 'Ese día vuelve a contar.', true);
    });
    else if (acc === 'tomar') ejecutar(store.rpc('tomar_del_pool', { p_id: id }), 'Es tuya. Ya aparece en tus tareas.');
    else if (acc === 'justificar') abrirModal({ tipo: 'justificar', id: id });
    else if (acc === 'ver-revision') abrirModal({ tipo: 'revision', id: id });
    else if (acc === 'atajo-vacaciones') {
      var fe = document.querySelector('form[data-form=especial]');
      if (fe) {
        fe.querySelector('input[name=tipo][value=libre]').checked = true;
        fe.querySelector('input[name=nombre]').value = 'Vacaciones colectivas';
        fe.querySelector('input[name=solo_sab]').checked = false;
        var sl = fe.querySelector('select[name=local_id]'); if (sl) sl.value = '';
        fe.scrollIntoView({ behavior: 'smooth', block: 'center' });
        fe.querySelector('input[name=desde]').focus();
        aviso('Elige desde y hasta, y toca «Agregar al calendario».', 'ok');
      }
    }
    else if (acc === 'borrar-especial') {
      var ids = id.split(',');
      confirmar('¿Quitar este día del calendario?', 'Quitar', function () {
        ejecutar(ids.reduce(function (pr, x) { return pr.then(function () { return store.borrar('dias_especiales', x); }); }, Promise.resolve()), 'Quitado del calendario.', true);
      });
    }
    else if (acc === 'just-ok' || acc === 'just-no') {
      ejecutar(store.rpc('revisar_justificacion', { p_id: id, p_ok: acc === 'just-ok' }), acc === 'just-ok' ? 'Justificación aprobada.' : 'Justificación rechazada.', true);
    }
    else if (acc === 'ver-reasignar') abrirModal({ tipo: 'reasignar', local: id || null });
    else if (acc === 'elegir-local') { elegirLocal(id); render(); }
    else if (acc === 'elegir-local-link') { elegirLocal(id); ir(el.getAttribute('href').slice(1)); }
    else if (acc === 'agregar-grupo') ejecutar(store.insertar('grupos', { nombre: 'Nuevo grupo' }), 'Grupo agregado. Ponle nombre y asigna personas.');
    else if (acc === 'borrar-grupo') {
      confirmar('¿Borrar el grupo «' + nombreGrupo(id) + '»? Las tareas limitadas solo a ese grupo pasan a «cualquiera del local».', 'Borrar grupo', function () {
        ejecutar(store.borrar('grupos', id), 'Grupo borrado.', true);
      });
    }
    else if (acc === 'agregar-local') ejecutar(store.insertar('locales', { nombre: 'Nuevo local', dias_laborables: [1, 2, 3, 4, 5, 6] }), 'Local agregado. Ponle nombre y sus días.');
    else if (acc === 'borrar-local') {
      confirmar('¿Borrar «' + nombreLocal(id) + '»? Se borran sus tareas y su historial, y sus empleados pasan al local principal.', 'Borrar local', function () {
        ejecutar(store.borrar('locales', id), 'Local borrado.', true);
      });
    }
    else if (acc === 'ver-tarea') abrirModal({ tipo: 'tarea', id: id });
    else if (acc === 'asistencia') abrirModal({ tipo: 'asistencia', id: id });
    else if (acc === 'editar-persona') abrirModal({ tipo: 'persona', id: id });
    else if (acc === 'nueva-persona') abrirModal({ tipo: 'nueva-persona' });
    else if (acc === 'asis-set') {
      var v = el.getAttribute('data-v');
      ejecutar(store.rpc('marcar_asistencia', { p_persona: id, p_estado: v }), function (r) {
        if (v === 'presente') return ('Llegada marcada. ' + textoDevolucion(r, false)).trim();
        return { ausente: 'Marcado: no viene hoy.', salida: 'Salida marcada.', sin_salida: 'Salida quitada.' }[v] || 'Marca quitada.';
      }, true).then(function () {
        var locA = localDe(persona(id));
        if ((v === 'ausente' || v === 'salida') && L.sugerirReasignacion(db(), S.hoy, new Date(), locA).items.length) abrirModal({ tipo: 'reasignar', local: locA });
      });
    }
    else if (acc === 'borrar-asig') {
      var a = asig(id);
      confirmar('¿Borrar esta tarea de una vez?', 'Borrar', function () { ejecutar(store.borrar('asignaciones', id).then(function () { return a && a.plantilla_id ? store.borrar('plantillas', a.plantilla_id) : null; }), 'Tarea borrada.', true); });
    }
    else if (acc === 'duplicar-plantilla') {
      // La copia nace pausada para que no salga repetida hoy: se revisa, se ajusta y se activa
      var orig = plantilla(id); if (!orig) return;
      var copia = {};
      Object.keys(orig).forEach(function (k) { if (['id', 'creado_en', 'creado_por', 'actualizado_en'].indexOf(k) < 0) copia[k] = orig[k]; });
      copia.titulo = (orig.titulo + ' (copia)').slice(0, 120); copia.activa = false;
      ejecutar(store.insertar('plantillas', copia), 'Copia creada y pausada. Ajústala y marca «Activa».').then(function (r) { if (r && r.id) ir('/tarea/' + r.id); });
    }
    else if (acc === 'borrar-plantilla') {
      confirmar('¿Borrar esta tarea? Lo ya hecho queda en el historial. Si solo quieres pausarla, desmarca «Activa».', 'Borrar tarea', function () {
      var hoy = S.hoy;
      var pend = db().asignaciones.filter(function (x) { return x.plantilla_id === id && x.estado === 'pendiente'; });
      ejecutar(Promise.all(pend.map(function (x) { return store.borrar('asignaciones', x.id); })).then(function () { return store.borrar('plantillas', id); }).then(function () { return true; }), 'Tarea borrada.')
        .then(function (r) { S.modal = null; if (r !== undefined) ir('/tareas'); });
      });
    }
    else if (acc === 'reprogramar-oculta') {
      var fRep = el.closest('form') && el.closest('form').querySelector('[name="fecha"]');
      if (!fRep || !fRep.value) { aviso('Elige el día.'); return; }
      ejecutar(store.rpc('reprogramar_oculta', { p_id: id, p_fecha: fRep.value }), 'Reprogramada para el ' + L.fmtFecha(fRep.value) + '.');
    }
    else if (acc === 'sin-wifi') {
      var on = el.getAttribute('data-v') === '1';
      ejecutar(store.rpc('sin_wifi_hoy', { p_local: id, p_activo: on }), on ? 'Listo: hoy pueden marcar «Llegué» sin el Wi-Fi en «' + nombreLocal(id) + '».' : 'Listo: «Llegué» vuelve a pedir el Wi-Fi.');
    }
    else if (acc === 'aceptar-red') {
      var locR = el.getAttribute('data-local');
      ejecutar(store.rpc('aceptar_red', { p_red: id, p_local: locR }), 'Red registrada en «' + nombreLocal(locR) + '». Ya pueden marcar «Llegué».');
    }
    else if (acc === 'ignorar-red') {
      ejecutar(Promise.all(id.split(',').map(function (x) { return store.borrar('redes_nuevas', x); })), 'Listo: esa red no se registró.');
    }
    else if (acc === 'registrar-red') {
      ejecutar(store.rpc('registrar_red', { p_local: id }), 'Listo: esta red quedó registrada como Wi-Fi de «' + nombreLocal(id) + '».').then(function () { S.red = null; render(); });
    }
    else if (acc === 'guardar-ubicacion') {
      S.ocupado = true; pintarCapas();
      ubicacion().then(function (c) {
        S.ocupado = false;
        if (c.accuracy > 200) aviso('La ubicación salió poco precisa (±' + Math.round(c.accuracy) + ' m). Guárdala de nuevo cerca de una ventana o en la puerta.');
        return ejecutar(store.actualizar('locales', id, { lat: c.latitude, lng: c.longitude }), 'Ubicación de «' + nombreLocal(id) + '» guardada.');
      }, function () { S.ocupado = false; pintarCapas(); aviso('No se pudo leer la ubicación. Permite la ubicación para esta página e intenta de nuevo, estando en el local.'); });
    }
    else if (acc === 'copiar') {
      var texto = el.getAttribute('data-texto');
      (navigator.clipboard ? navigator.clipboard.writeText(texto) : Promise.reject()).then(function () { aviso('Copiado', 'ok'); }, function () { aviso('No se pudo copiar en este navegador.'); });
    }
  });

  document.addEventListener('change', function (ev) {
    var el = ev.target, c = el.getAttribute && el.getAttribute('data-cambio');
    if (c === 'demo-usuario') { store.cambiarUsuario(el.value); S.modal = null; location.hash = '/'; recargar(false); }
    else if (c === 'fecha-reporte' && el.value) ir('/reporte?f=' + el.value);
    else if (c === 'calif') { var rc = el.form.querySelector('.repetir-check'); if (rc) rc.hidden = el.value !== '1'; }
    else if (c === 'demo-fuera') { store.fuera(el.checked); S.red = null; aviso(el.checked ? 'Simulando: fuera de cualquier local.' : 'Simulando: conectado al Wi-Fi.', 'ok'); render(); }
    else if (c === 'frecuencia') {
      var f = el.form;
      f.querySelector('.frec-semanal').hidden = el.value !== 'semanal';
      f.querySelector('.frec-mensual').hidden = el.value !== 'mensual';
    }
    else if (c === 'registro') el.form.querySelector('.registro-equipos').hidden = !el.checked;
    else if (c === 'con-seg') el.form.querySelector('.seg-campos').hidden = !el.checked;
    else if (c === 'restr') { el.form.querySelector('.solo-quien').hidden = el.value !== '1'; el.form.querySelector('.solo-grupos').hidden = el.value !== 'g'; }
    else if (c === 'veces') {
      var box = el.form.querySelector('.momentos'), n = Number(el.value);
      box.setAttribute('data-veces', n);
      Array.prototype.forEach.call(box.querySelectorAll('.momento-fila'), function (r) { r.hidden = Number(r.getAttribute('data-i')) >= n; });
    }
    else if (c === 'local-tarea') {
      Array.prototype.forEach.call(el.form.querySelectorAll('[data-local]'), function (x) {
        var fuera = x.getAttribute('data-local') !== el.value;
        x.hidden = fuera;
        var cb = x.querySelector && x.querySelector('input[type=checkbox]');
        if (fuera && cb) cb.checked = false;
      });
      var sp = el.form.querySelector('select[name=persona]');
      if (sp && sp.selectedOptions[0] && sp.selectedOptions[0].hidden) {
        var prim = Array.prototype.filter.call(sp.options, function (o) { return !o.hidden; })[0];
        if (prim) sp.value = prim.value;
      }
    }
    else if (el.name === 'persona' && el.form) { var r = el.form.querySelector('input[name=quien][value=persona]'); if (r) r.checked = true; }
    else if (el.name === 'min_r') el.form.minutos.value = el.value;
    else if (el.name === 'minutos') {
      Array.prototype.forEach.call(el.form.querySelectorAll('input[name=min_r]'), function (r) { r.checked = r.value === el.value; });
    }
  });

  document.addEventListener('submit', function (ev) {
    var f = ev.target, tipo = f.getAttribute('data-form'); if (!tipo) return;
    ev.preventDefault();
    var fd = new FormData(f);
    if (tipo === 'login') {
      S.ocupado = true; pintarCapas();
      store.entrar(fd.get('email'), fd.get('clave')).then(function () { S.ocupado = false; location.hash = '/'; return recargar(false); },
        function (e) { S.ocupado = false; aviso(e.message); });
    }
    else if (tipo === 'perfil') ejecutar(store.rpc('mi_perfil', { p_nombre: fd.get('nombre'), p_telefono: fd.get('telefono') }), 'Guardado.').then(function () { ir('/'); });
    else if (tipo === 'tarea') guardarTarea(f, fd);
    else if (tipo === 'ajustes') {
      var horas = Number(fd.get('jornada'));
      var solo = !!fd.get('solo_tienda');
      if (solo) {
        var gps = !!fd.get('usar_gps');
        var sinConfig = locales().filter(function (l) { return empleadosDe(l.id).length && !(l.redes || []).length && !(gps && l.lat != null); });
        if (sinConfig.length) { aviso('Antes de activarlo, registra el Wi-Fi de: ' + sinConfig.map(function (l) { return l.nombre; }).join(', ') + '.'); return; }
      }
      if (String(fd.get('a_tiempo_hasta')) > String(fd.get('hora_limite'))) { aviso('«A tiempo hasta» tiene que ser antes de la hora límite.'); return; }
      ejecutar(store.actualizar('ajustes', 1, { usar_salidas: !!fd.get('usar_salidas'), mostrar_record: !!fd.get('mostrar_record'), a_tiempo_hasta: fd.get('a_tiempo_hasta'), hora_limite: fd.get('hora_limite'), pool_activo: !!fd.get('pool'), minutos_jornada: Math.round(horas * 60), solo_en_tienda: solo,
        usar_gps: !!fd.get('usar_gps'), revisiones_dia: Number(fd.get('revisiones_dia')) }), 'Ajustes guardados.');
    }
    else if (tipo === 'local') {
      var labL = fd.getAll('lab').map(Number);
      if (!labL.length) { aviso('Marca al menos un día de trabajo.'); return; }
      ejecutar(store.actualizar('locales', f.getAttribute('data-id'), { nombre: String(fd.get('nombre') || '').trim() || 'Local', dias_laborables: labL, radio_m: Number(fd.get('radio_m')) || 150 }), 'Local guardado.');
    }
    else if (tipo === 'persona') {
      var pid = f.getAttribute('data-id'), soyYo = pid === yo().id;
      var patch = { nombre: String(fd.get('nombre') || '').trim() };
      if (!soyYo) { patch.rol = fd.get('rol'); patch.activo = !!fd.get('activo'); }
      if (fd.get('local_id')) patch.local_id = fd.get('local_id');
      if (fd.get('capacidad')) { patch.capacidad = Number(fd.get('capacidad')); patch.tarea_max = fd.get('tarea_max') ? Number(fd.get('tarea_max')) : null; }
      if (persona(pid) && persona(pid).rol === 'empleado' && grupos().length) patch.grupos = fd.getAll('grupo');
      if (persona(pid) && persona(pid).rol === 'empleado') patch.rota = !!fd.get('rota');
      if (store.modo === 'supabase' && persona(pid) && persona(pid).rol !== 'admin') patch.accesos = fd.getAll('acceso');
      if (persona(pid) && persona(pid).rol === 'empleado') {
        var dt = fd.getAll('dtrab').map(Number).sort(), base = L.labDe(db(), patch.local_id || localDe(persona(pid))).slice().sort();
        if (!dt.length) { aviso('Marca al menos un día de trabajo.'); return; }
        patch.dias_trabajo = dt.join(',') === base.join(',') ? null : dt;
      }
      if (!patch.nombre) { aviso('Escribe el nombre.'); return; }
      // Si deja de estar activa o cambia de local, sus tareas pendientes quedan «sin asignar» para que gerencia las reparta.
      var antes = persona(pid), sueltas = [];
      if (antes && antes.rol === 'empleado' && ((patch.activo === false && antes.activo) || (patch.local_id && patch.local_id !== localDe(antes)))) {
        sueltas = db().asignaciones.filter(function (x) { return x.asignado_a === pid && x.estado === 'pendiente' && (x.fecha >= S.hoy || x.arrastra); });
      }
      var pp = store.actualizar('personas', pid, patch);
      if (sueltas.length) pp = pp.then(function () { return store.rpc('reasignar', { p_items: sueltas.map(function (x) { return { id: x.id, a: null }; }), p_motivo: 'manual' }); });
      ejecutar(pp, sueltas.length ? 'Guardado. Sus ' + plural(sueltas.length, 'tarea pendiente quedó', 'tareas pendientes quedaron') + ' sin asignar: repártelas desde Hoy.' : 'Guardado.', true);
    }
    else if (tipo === 'aprobar-oculta') {
      ejecutar(store.rpc('aprobar_oculta', { p_id: f.getAttribute('data-id'), p_persona: fd.get('persona') || null }), 'Aprobada: ya aparece en su lista.');
    }
    else if (tipo === 'nueva-persona') {
      var np = { p_nombre: String(fd.get('nombre') || '').trim(), p_email: String(fd.get('email') || '').trim(), p_clave: String(fd.get('clave') || '').trim(),
        p_local: fd.get('local_id') || null, p_rol: fd.get('rol') || 'empleado', p_accesos: fd.getAll('acceso') };
      if (np.p_clave.length < 8) { aviso('La clave debe tener al menos 8 caracteres.'); return; }
      ejecutar(store.rpc('crear_persona', np), np.p_nombre + ' ya puede entrar. Dale su correo y su clave.', true);
    }
    else if (tipo === 'clave') {
      var clave = String(fd.get('clave') || '').trim();
      if (clave.length < 8) { aviso('La clave debe tener al menos 8 caracteres.'); return; }
      ejecutar(store.rpc('cambiar_clave', { p_persona: f.getAttribute('data-id'), p_clave: clave }), 'Clave cambiada. Dísela en persona.', true);
    }
    else if (tipo === 'reasignar') {
      var items = [];
      fd.forEach(function (v, k) { if (k.indexOf('a_') === 0) items.push({ id: k.slice(2), a: v || null }); });
      ejecutar(store.rpc('reasignar', { p_items: items, p_motivo: 'ausencia' }), function (n) { return plural(n || 0, 'tarea reasignada', 'tareas reasignadas') + '.'; }, true);
    }
    else if (tipo === 'calificar') {
      var cal = Number(fd.get('calif'));
      if (!cal) { aviso('Elige Bien, Regular o Mal.'); return; }
      ejecutar(store.rpc('calificar', { p_id: f.getAttribute('data-id'), p_calificacion: cal, p_nota: fd.get('nota') || '', p_repetir: cal === 1 && !!fd.get('repetir') }),
        cal === 1 && fd.get('repetir') ? 'Calificada. La tarea volvió a su lista.' : 'Calificada.', true);
    }
    else if (tipo === 'especial') guardarEspecial(f, fd);
    else if (tipo === 'grupo') {
      var nomG = String(fd.get('nombre') || '').trim();
      if (!nomG) { aviso('Ponle nombre al grupo.'); return; }
      ejecutar(store.actualizar('grupos', f.getAttribute('data-id'), { nombre: nomG }), 'Grupo guardado.');
    }
    else if (tipo === 'equipo') {
      var mn = fd.get('temp_min'), mx = fd.get('temp_max');
      var fila = { nombre: String(fd.get('nombre') || '').trim(), temp_min: mn === '' ? null : Number(mn), temp_max: mx === '' ? null : Number(mx), activo: !!fd.get('activo') };
      if (!fila.nombre) { aviso('Ponle nombre al equipo.'); return; }
      if (fila.temp_min !== null && fila.temp_max !== null && fila.temp_min > fila.temp_max) { aviso('El mínimo tiene que ser menor que el máximo.'); return; }
      ejecutar(store.actualizar('equipos', f.getAttribute('data-id'), fila), 'Equipo guardado.');
    }
    else if (tipo === 'registro') {
      var lects = [], falta = null;
      Array.prototype.forEach.call(f.querySelectorAll('fieldset.lectura'), function (fs) {
        var eid = fs.getAttribute('data-equipo'), t = fd.get('t_' + eid), est = fd.get('e_' + eid) || 'normal', nota = String(fd.get('n_' + eid) || '').trim();
        var e = equipo(eid);
        if (t === '' && est !== 'apagado' && !falta) falta = 'Escribe la temperatura de «' + (e ? e.nombre : 'un equipo') + '».';
        if (t !== '' && e && L.fueraDeRango(e, Number(t), est) && !nota && !falta) falta = 'Escribe una nota: «' + e.nombre + '» está fuera de rango.';
        lects.push({ equipo: eid, temperatura: t === '' ? null : Number(t), estado: est, nota: nota });
      });
      if (falta) { aviso(falta); return; }
      ejecutar(store.rpc('registrar_lecturas', { p_id: f.getAttribute('data-id'), p_lecturas: lects }), function (r) {
        return r && r.fuera ? 'Guardado. ' + (r.fuera === 1 ? '1 equipo quedó' : r.fuera + ' equipos quedaron') + ' fuera de rango: gerencia lo ve.' : '✓ Temperaturas guardadas';
      }, true);
    }
    else if (tipo === 'sinpunt') {
      var fsp = fd.get('fecha'), msp = String(fd.get('motivo') || '').trim();
      if (!msp) { aviso('Escribe el motivo.'); return; }
      if (diaSinPunt(fsp)) { aviso('Ese día ya no cuenta.'); return; }
      ejecutar(store.insertar('dias_sin_puntualidad', { fecha: fsp, motivo: msp }), 'Listo: ese día no cuenta para la puntualidad de nadie.', true);
    }
    else if (tipo === 'salida') {
      ejecutar(store.rpc('marcar_salida', { p_motivo: fd.get('motivo') || '' }), 'Salida marcada. Gerencia repartirá lo que quedó pendiente.', true);
    }
    else if (tipo === 'justificar') {
      ejecutar(store.rpc('justificar', { p_id: f.getAttribute('data-id'), p_texto: fd.get('texto') }), esAdmin() ? 'Justificada.' : 'Enviada a gerencia.', true);
    }
    else if (tipo === 'reasignar-una') {
      var a1 = asig(f.getAttribute('data-id')), dest = fd.get('a') || null;
      var its = [{ id: a1.id, a: dest }];
      if (fd.get('todas')) db().asignaciones.forEach(function (x) {
        if (x.id !== a1.id && x.plantilla_id === a1.plantilla_id && x.fecha === a1.fecha && x.estado === 'pendiente') its.push({ id: x.id, a: dest });
      });
      ejecutar(store.rpc('reasignar', { p_items: its, p_motivo: 'manual' }), its.length > 1 ? plural(its.length, 'vez reasignada', 'veces reasignadas') + '.' : 'Reasignada.', true);
    }
  });

  function guardarTarea(f, fd) {
    var id = f.getAttribute('data-id'), unica = !!f.getAttribute('data-unica');
    var min = Math.round(Number(fd.get('minutos')));
    if (!(min >= 1 && min <= 600)) { aviso('El tiempo debe estar entre 1 y 600 minutos.'); return; }
    var fila = {
      titulo: String(fd.get('titulo') || '').trim(),
      detalle: String(fd.get('detalle') || '').trim() || null,
      minutos: min,
      solo_pueden: !unica && fd.get('restr') === '1' ? fd.getAll('solo') : [],
      grupos: !unica && fd.get('restr') === 'g' ? fd.getAll('grupo') : [],
      personas: unica ? 1 : Math.max(1, Math.min(5, Number(fd.get('personas')) || 1))
    };
    if (fd.get('restr') === '1' && !fila.solo_pueden.length) { aviso('Marca quién puede hacerla, o elige «Cualquiera».'); return; }
    if (fd.get('restr') === 'g' && !fila.grupos.length) { aviso('Marca al menos un grupo, o elige «Cualquiera».'); return; }
    if (unica) {
      var q = fd.get('quien') || 'auto';
      if (q === 'persona') q = fd.get('persona');
      Object.assign(fila, { frecuencia: 'unica', fecha_unica: fd.get('fecha_unica'), asignar_a: q !== 'auto' && q !== 'pool' ? q : null, al_pool: q === 'pool' });
    } else {
      var fr = fd.get('frecuencia');
      Object.assign(fila, { frecuencia: fr, fecha_inicio: fd.get('fecha_inicio') || S.hoy, dias_semana: [], cada_n: 1, dia_mes: null });
      if (fr === 'semanal') {
        fila.dias_semana = fd.getAll('dias').map(Number);
        fila.cada_n = Number(fd.get('cada_n')) || 1;
        if (!fila.dias_semana.length) { aviso('Marca qué días de la semana.'); return; }
      }
      if (fr === 'mensual') {
        fila.dia_mes = Math.round(Number(fd.get('dia_mes')));
        if (!(fila.dia_mes >= 1 && fila.dia_mes <= 31)) { aviso('El día del mes debe estar entre 1 y 31.'); return; }
        fila.cada_n = Number(fd.get('cada_meses')) || 1;
      }
    }
    if (id) fila.activa = !!fd.get('activa');
    // Local
    var actual = id ? plantilla(id) : null;
    fila.local_id = fd.get('local_id') || (actual && actual.local_id) || localElegido();
    // Veces al día: cada una con nombre y hora límite opcional
    var veces = Number(fd.get('veces')) || 1, mom = [];
    for (var i = 0; i < veces; i++) {
      var nom = String(fd.get('mnombre_' + i) || '').trim(), antes = fd.get('mantes_' + i) || null, desde = fd.get('mdesde_' + i) || null;
      if (veces > 1 && !nom) { aviso('Ponle nombre a cada vez (por ejemplo «después del desayuno»).'); return; }
      if (desde && antes && desde >= antes) { aviso('En cada vez, «desde» tiene que ser antes que «antes de».'); return; }
      mom.push({ nombre: veces > 1 ? nom : '', desde: desde, antes: antes });
    }
    fila.momentos = veces === 1 && !mom[0].antes && !mom[0].desde ? [] : mom;
    fila.registro = !!fd.get('registro');
    fila.equipos = fila.registro ? fd.getAll('equipo') : [];
    if (!unica) {
      var segT = fd.get('con_seg') ? String(fd.get('seg_titulo') || '').trim() : '';
      if (fd.get('con_seg') && !segT) { aviso('Escribe qué tarea sale después.'); return; }
      fila.seguimiento_titulo = segT || null;
      fila.seguimiento_despues = Math.max(1, Math.min(600, Math.round(Number(fd.get('seg_despues')) || 45)));
      fila.seguimiento_minutos = Math.max(1, Math.min(600, Math.round(Number(fd.get('seg_minutos')) || 5)));
    }

    var p = id ? store.actualizar('plantillas', id, fila) : store.insertar('plantillas', fila);
    var repartidas = unica && id ? S.data.asignaciones.filter(function (a) { return a.plantilla_id === id && a.estado === 'pendiente'; }) : [];
    if (repartidas.length && repartidas[0].fecha !== fila.fecha_unica) {
      // Cambió el día: se quitan las de la fecha vieja y se reparte de nuevo ese día
      repartidas.forEach(function (x) { p = p.then(function () { return store.borrar('asignaciones', x.id); }); });
      repartidas = [];
    }
    if (repartidas.length && (fila.al_pool || fila.asignar_a)) {
      // Si ya estaba repartida, el cambio de «Para quién» se aplica también a la de hoy (todas sus veces)
      var destino = fila.al_pool ? null : fila.asignar_a;
      var items = repartidas.filter(function (x) { return x.asignado_a !== destino; }).map(function (x) { return { id: x.id, a: destino }; });
      if (items.length) p = p.then(function () { return store.rpc('reasignar', { p_items: items, p_motivo: 'manual' }); });
    }
    ejecutar(p, id ? 'Cambios guardados.' : (unica ? 'Tarea creada.' : 'Tarea creada. Entra en la rotación.'))
      .then(function (r) { if (r !== undefined) ir(unica ? '/' : '/tareas'); });
  }

  // «Te volvió 1 tarea. Como te cubrieron, te pasaron 2 tareas (30 min).»
  function textoDevolucion(r, tu) {
    if (!r) return '';
    var t = [];
    if (r.devueltas) t.push(tu ? (r.devueltas === 1 ? 'Te volvió 1 tarea.' : 'Te volvieron ' + r.devueltas + ' tareas.')
      : (r.devueltas === 1 ? 'Se le devolvió 1 tarea.' : 'Se le devolvieron ' + r.devueltas + ' tareas.'));
    if (r.compensadas) t.push((tu ? 'Como te cubrieron, te pasaron ' : 'Como la cubrieron, recibió ') + plural(r.compensadas, 'tarea', 'tareas') +
      ' de quien lo hizo (' + L.minutosTxt(r.min_compensados) + ').');
    return t.join(' ');
  }

  // ---------- Marcar «Hecho» al instante (se guarda por detrás; si falla, se deshace) ----------
  function marcarHecha(id, hecha) {
    var a = asig(id); if (!a || S.marcando[id]) return;
    if (hecha && !esAdmin() && L.antesDeHora(a, new Date())) { aviso('Todavía no toca: es desde las ' + L.fmtHoraTxt(L.hhmm(a.desde))); return; }
    if (hecha && !esAdmin() && aj().solo_en_tienda) {
      var s = L.asistenciaDe(db(), yo().id, S.hoy);
      if (!(s && s.estado === 'presente') && !llegadaEnCola()) { aviso('Primero marca «Llegué».'); return; }
    }
    if (hecha && a.registro) { abrirModal({ tipo: 'registro', id: id }); return; }
    var antes = { estado: a.estado, hecha_en: a.hecha_en, hecha_por: a.hecha_por, repetir: a.repetir };
    S.marcando[id] = true; S.ultimaMarca = Date.now();
    if (hecha) { a.estado = 'hecha'; a.hecha_en = new Date().toISOString(); a.hecha_por = a.asignado_a || yo().id; a.repetir = false; }
    else { a.estado = 'pendiente'; a.hecha_en = null; a.hecha_por = null; }
    if (esAdmin()) S.modal = null;
    render();
    aviso(hecha ? '✓ Hecha' : 'Desmarcada', 'ok');
    store.rpc('marcar_hecha', { p_id: id, p_hecha: hecha }).then(function () {
      delete S.marcando[id]; recargarPronto();
    }, function (e) {
      delete S.marcando[id];
      if (e && e.red && store.modo === 'supabase') {
        encolar({ tipo: 'hecha', id: id, hecha: hecha, t: a.hecha_en || new Date().toISOString() });
        aviso('Sin internet: quedó guardado en el teléfono y se envía solo cuando vuelva la conexión.', 'ok');
        return;
      }
      Object.assign(a, antes); render();
      aviso(e && e.message ? e.message : 'No se pudo guardar. Revisa el internet.');
    });
  }

  // ---------- Llegada: primero Wi-Fi de la tienda; si no, ubicación ----------
  function ubicacion() {
    return new Promise(function (ok, mal) {
      if (!navigator.geolocation) { mal(new Error('sin_gps')); return; }
      navigator.geolocation.getCurrentPosition(function (p) { ok(p.coords); }, function (e) { mal(e); },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
    });
  }
  function llegar() {
    var okTxt = function (r) {
      var donde = r && r.local && yo() && r.local !== yo().local_id ? ' en «' + nombreLocal(r.local) + '»' : '';
      var extra = textoDevolucion(r, true);
      return extra ? 'Listo' + donde + '. ' + extra : 'Listo, llegada marcada' + donde + '.';
    };
    if (S.ocupado) return;
    S.ocupado = true; pintarCapas();
    store.rpc('marcar_llegada', {}).then(function (r) {
      if (r && r.error) { var e0 = new Error(r.error); e0.usuario = true; throw e0; }
      return r;
    }).then(null, function (e) {
      if (!e || !e.noTienda) throw e;
      // No está en el Wi-Fi del local y gerencia activó la ubicación: probar con el GPS del teléfono
      return ubicacion().then(function (c) {
        return store.rpc('marcar_llegada', { p_lat: c.latitude, p_lng: c.longitude, p_precision: c.accuracy });
      }, function (g) {
        var e2 = new Error('No se pudo marcar tu llegada. Si el problema sigue, avísale a gerencia.');
        e2.usuario = true; throw e2;
      });
    }).then(function (r) {
      if (r && r.error) { var e1 = new Error(r.error); throw e1; }
      S.ocupado = false; aviso(okTxt(r), 'ok'); return recargar(true);
    }, function (e) {
      S.ocupado = false;
      if (e && e.red && store.modo === 'supabase') {
        encolar({ tipo: 'llegada', fecha: S.hoy, t: new Date().toISOString() });
        aviso('Sin internet: tu llegada se envía sola cuando vuelva la conexión. Cuenta la hora de ahora solo si gerencia marcó que no hay Wi-Fi.', 'ok');
        render(); return;
      }
      pintarCapas(); aviso(e && e.message ? e.message : 'Algo salió mal.');
    });
  }

  // ---------- Arranque ----------
  window.addEventListener('hashchange', function () { S.modal = null; S.claves = null; render(); window.scrollTo(0, 0); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && S.data) {
      if (L.hoyISO() !== S.hoy) S.hoy = L.hoyISO();
      recargar(true);
    }
  });
  setInterval(function () { if (document.visibilityState === 'visible' && S.data && !S.modal && !S.ocupado) recargar(true); }, 120000);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.modal) { S.modal = null; pintarCapas(); } });
  // Lo que se escribe en un formulario no se pierde con la actualización automática
  document.addEventListener('input', function (e) {
    if (e.target && e.target.closest && e.target.closest('form')) S.sucio = true;
    var fs = e.target && e.target.closest && e.target.closest('fieldset.lectura'); if (fs) revisarLectura(fs);
  });
  document.addEventListener('change', function (e) { var fs = e.target && e.target.closest && e.target.closest('fieldset.lectura'); if (fs) revisarLectura(fs); });

  function arrancar() {
    store = ST.crearStore(CFG, function () { return window.TBDemo.semilla(L.hoyISO()); });
    // Abre al instante con lo último que se vio hoy y actualiza por detrás
    var k = claveCache(), c = k ? ST.LS.get(k) : null;
    if (c && c.hoy === L.hoyISO() && c.data && c.data.yo) {
      S.data = c.data; S.cargando = false; render(); recargar(true);
    } else recargar(false);
    // Guarda la app en el teléfono para que abra rápido (solo en la página publicada)
    if ('serviceWorker' in navigator && location.protocol === 'https:' && store.modo === 'supabase') {
      navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(function () { /* sin caché: funciona igual */ });
    }
  }
  if (!(CFG.supabaseUrl && CFG.supabaseKey) && !window.TBDemo) {
    var sc = document.createElement('script'); sc.src = 'demo.js?v=8'; sc.onload = arrancar;
    sc.onerror = function () { $app.innerHTML = '<div class="centro"><h2>No se pudo cargar</h2><p class="muted">Revisa el internet y vuelve a abrir.</p></div>'; };
    document.head.appendChild(sc);
  } else arrancar();
})();
