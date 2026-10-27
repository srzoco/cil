/* Tareas CIL — acceso a datos.
   - Modo demo: todo se guarda en este navegador (para probar sin instalar nada).
   - Modo real: Supabase (base de datos compartida), usando su API REST directamente.
   Las dos versiones exponen lo mismo: cargar(), rpc(), insertar(), actualizar(), borrar(), eventos(). */
(function (root, factory) {
  var mod = factory(root.TBLogic || (typeof require === 'function' ? require('./logic.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.TBStore = mod;
})(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';

  // ---------- Almacenamiento local seguro ----------
  var memoria = {};
  var LS = {
    get: function (k) {
      try { var v = localStorage.getItem(k); return v == null ? (k in memoria ? memoria[k] : null) : JSON.parse(v); }
      catch (e) { return k in memoria ? memoria[k] : null; }
    },
    set: function (k, v) {
      memoria[k] = v;
      try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
    },
    del: function (k) {
      delete memoria[k];
      try { localStorage.removeItem(k); } catch (e) { /* sin almacenamiento */ }
    }
  };

  function uuid() {
    var c = (typeof crypto !== 'undefined') ? crypto : null;
    if (c && c.randomUUID) return c.randomUUID();
    var b = new Uint8Array(16);
    if (c && c.getRandomValues) c.getRandomValues(b); else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function copia(x) { return JSON.parse(JSON.stringify(x)); }
  function errorUsuario(msg, extra) { var e = new Error(msg); e.usuario = true; if (extra) Object.assign(e, extra); return e; }
  function desdeHistorial() { return L.addDias(L.hoyISO(), -35); }

  // ---------- Modo demo ----------
  // Reproduce las reglas de supabase.sql para poder probar todo en un solo teléfono.
  function DemoStore(semilla) {
    this.modo = 'demo';
    this.clave = 'tareasbf_demo_v1';
    this.semilla = semilla;
    this.db = LS.get(this.clave);
    if (!this.db || !this.db.personas || this.db.version !== 14) { this.db = semilla(); this._guardar(); }
    var u = LS.get('tareasbf_demo_usuario');
    this.usuarioId = (u && this.db.personas.some(function (p) { return p.id === u; })) ? u : this.db.personas[0].id;
  }
  DemoStore.prototype._guardar = function () { LS.set(this.clave, this.db); };
  DemoStore.prototype._yo = function () { var id = this.usuarioId; return this.db.personas.filter(function (p) { return p.id === id; })[0]; };
  DemoStore.prototype._admin = function () { var y = this._yo(); return !!(y && y.rol === 'admin' && y.activo); };
  DemoStore.prototype._asig = function (id) { return this.db.asignaciones.filter(function (a) { return a.id === id; })[0] || null; };
  DemoStore.prototype._evento = function (asigId, tipo, de, a, texto) {
    this.db.eventos.push({ id: uuid(), asignacion_id: asigId, tipo: tipo, de: de || null, a: a || null, autor: this.usuarioId, texto: texto || null, creado_en: new Date().toISOString() });
  };
  DemoStore.prototype.sesion = function () { var y = this._yo(); return { user: { id: y.id, email: y.email } }; };
  DemoStore.prototype.cambiarUsuario = function (id) { this.usuarioId = id; LS.set('tareasbf_demo_usuario', id); };
  DemoStore.prototype.reiniciar = function () { this.db = this.semilla(); this._guardar(); };
  DemoStore.prototype.entrar = function () { return Promise.resolve(); };
  DemoStore.prototype.salir = function () { return Promise.resolve(); };

  // Igual que repartir_faltas: a la hora límite, una vez al día por local
  DemoStore.prototype._repartirFaltas = function () {
    var db = this.db, hoy = L.hoyISO(), self = this;
    if (!L.pasoLimite(db.ajustes, new Date())) return;
    db.repartos_auto = db.repartos_auto || [];
    (db.locales || []).forEach(function (l) {
      if (db.repartos_auto.indexOf(hoy + '|' + l.id) >= 0) return;
      db.repartos_auto.push(hoy + '|' + l.id);
      self._repartirLocal(l.id, true);
    });
    this._guardar();
  };
  DemoStore.prototype._repartirLocal = function (localId, conFaltas) {
    var self = this;
    L.repartoAutomatico(this.db, L.hoyISO(), localId, conFaltas).forEach(function (r) {
      var a = self._asig(r.id); if (!a) return;
      a.asignado_a = r.a; a.motivo = 'ausencia'; a.oculta = r.oculta;
      self._evento(a.id, 'reasignada', r.de, r.a, 'ausencia');
    });
  };
  // completo = false: solo hoy, lo pendiente y lo hecho hoy (igual que datos_app en supabase.sql)
  DemoStore.prototype.cargar = function (completo) {
    var self = this;
    self._vencerTemporales();
    return this.rpc('generar_dia', {}).then(function () { self._repartirFaltas(); return self._admin() ? self.rpc('asignar_revisiones', {}) : null; }).then(function () {
      var db = copia(self.db), yo = self._yo(), adm = self._admin(), hoy = L.hoyISO(), desde = completo ? desdeHistorial() : hoy;
      var asigs = db.asignaciones.filter(function (a) {
        if (!(a.fecha >= desde || (a.estado === 'pendiente' && (a.arrastra || a.oculta)) || (a.hecha_en && L.hoyISO(new Date(a.hecha_en)) === hoy))) return false;
        if (adm) return true;
        return (a.asignado_a === yo.id && !a.oculta) || a.hecha_por === yo.id || a.rescatada_de === yo.id || (a.local_id === yo.local_id && L.esUrgente(db, a, new Date()) && L.puedeRescatar(db, a, yo.id)) ||
          (a.asignado_a === null && a.estado === 'pendiente' && (a.fecha === hoy || (a.fecha < hoy && a.arrastra)) && db.ajustes.pool_activo && a.local_id === yo.local_id && L.puedeRescatar(db, a, yo.id));
      });
      return {
        completo: !!completo,
        mi_mes: (adm || db.ajustes.mostrar_record) ? L.puntualidadMes(self.db, yo.id, hoy) : null,
        almorzando_grupo: L.almorzandoGrupo(self.db, yo.id, new Date()),
        dias_sin_puntualidad: db.dias_sin_puntualidad || [],
        equipos: db.equipos || [],
        salidas_rato: (db.salidas_rato || []).filter(function (x) { return x.fecha >= desde && (adm || x.persona_id === yo.id); }),
        lecturas: adm ? (db.lecturas || []).filter(function (x) { return x.fecha >= desde; }) : [],
        yo: copia(yo),
        personas: adm ? db.personas : [copia(yo)],
        ajustes: db.ajustes,
        locales: db.locales,
        grupos: db.grupos || [],
        dias_especiales: db.dias_especiales || [],
        revisiones: adm ? (db.revisiones || []).filter(function (r) { return r.fecha >= desde; }) : [],
        plantillas: adm ? db.plantillas : [],
        asignaciones: asigs,
        asistencia: db.asistencia.filter(function (s) { return s.fecha >= desde && (adm || s.persona_id === yo.id); }),
        consumo: self._consumoDatos()
      };
    });
  };

  // En el demo, «la red» de este teléfono se simula: dentro o fuera de la tienda.
  DemoStore.prototype.fuera = function (v) {
    if (v !== undefined) LS.set('tareasbf_demo_fuera', !!v);
    return !!LS.get('tareasbf_demo_fuera');
  };
  DemoStore.prototype._ip = function () { return this.fuera() ? '201.9.9.9' : '190.200.10.20'; };
  // Igual que _ubicar: su local primero, después cualquier otro.
  DemoStore.prototype._ubicar = function (personaId, lat, lng, prec) {
    var pe = this.db.personas.filter(function (p) { return p.id === personaId; })[0];
    var propio = pe && pe.local_id, ip = this._ip();
    if (!this.db.ajustes.solo_en_tienda) return { verif: 'libre', local: propio };
    var ls = this.db.locales.slice().sort(function (a, b) { return (b.id === propio) - (a.id === propio) || (b.principal ? 1 : 0) - (a.principal ? 1 : 0); });
    for (var i = 0; i < ls.length; i++) if ((ls[i].redes || []).indexOf(ip) >= 0) return { verif: 'wifi', local: ls[i].id };
    // Su local todavía no tiene Wi-Fi registrado (ni ubicación, si se usa): marca como si la opción estuviera apagada
    var suyo = this.db.locales.filter(function (l) { return l.id === propio; })[0];
    if (suyo && !(suyo.redes || []).length && !(this.db.ajustes.usar_gps && suyo.lat != null)) return { verif: 'libre', local: propio };
    if (this.db.ajustes.usar_gps && lat != null && lng != null) {
      var cerca = ls.filter(function (l) { return l.lat != null; }).map(function (l) { return { l: l, d: L.distanciaM(lat, lng, l.lat, l.lng) }; })
        .sort(function (a, b) { return (b.l.id === propio) - (a.l.id === propio) || a.d - b.d; });
      for (var j = 0; j < cerca.length; j++) if (cerca[j].d <= cerca[j].l.radio_m + Math.min(prec || 0, 150)) return { verif: 'gps', local: cerca[j].l.id };
    }
    return null;
  };
  DemoStore.prototype._llegada = function (personaId, verif, localId) {
    var hoy = L.hoyISO(), s = L.asistenciaDe(this.db, personaId, hoy), self = this, ahora = new Date().toISOString(), dev = 0;
    if (s && s.estado === 'presente') return { llegada: s.llegada, devueltas: 0, compensadas: 0, ya: true };
    var pe = this.db.personas.filter(function (p) { return p.id === personaId; })[0];
    var donde = localId || (pe && pe.local_id) || null;
    if (s) { s.estado = 'presente'; s.llegada = ahora; s.marcado_por = this.usuarioId; s.verificado = verif || null; s.local_id = donde; s.salida = null; s.salida_motivo = null; }
    else this.db.asistencia.push({ persona_id: personaId, fecha: hoy, estado: 'presente', llegada: ahora, marcado_por: this.usuarioId, verificado: verif || null, local_id: donde });
    this.db.asignaciones.forEach(function (a) {
      if (a.asignado_original === personaId && a.motivo === 'ausencia' && a.estado === 'pendiente' && a.asignado_a !== personaId && a.fecha <= hoy &&
          (a.fecha === hoy || self.db.eventos.some(function (e) { return e.asignacion_id === a.id && e.tipo === 'reasignada' && e.texto === 'ausencia' && L.hoyISO(new Date(e.creado_en)) === hoy; }))) {
        a.asignado_a = personaId; a.motivo = 'devuelta'; a.oculta = false; dev++;
        self._evento(a.id, 'devuelta', null, personaId, 'Llegó: se le devuelve');
      }
    });
    // Lo que otro ya hizo por ella hoy se compensa con tareas pendientes de esa persona (igual que _llegada)
    var comp = 0, minComp = 0, db = this.db;
    var hechasPorOtro = db.asignaciones.filter(function (a) {
      return a.asignado_original === personaId && a.motivo === 'ausencia' && a.estado === 'hecha' && !a.compensada &&
        a.hecha_por && a.hecha_por !== personaId && a.hecha_en && L.hoyISO(new Date(a.hecha_en)) === hoy;
    });
    var porQuien = {};
    hechasPorOtro.forEach(function (a) { porQuien[a.hecha_por] = (porQuien[a.hecha_por] || 0) + a.minutos; a.compensada = true; });
    Object.keys(porQuien).sort().forEach(function (quien) {
      var v = self._compensar(quien, personaId, porQuien[quien]);
      comp += v.unidades; minComp += v.minutos;
    });
    return { llegada: ahora, devueltas: dev, compensadas: comp, min_compensados: minComp, ya: false };
  };

  // Igual que _compensar en supabase.sql: quien no hizo su parte (debe) recibe tareas pendientes de hoy de quien la hizo
  DemoStore.prototype._compensar = function (hizo, debe, meta) {
    var db = this.db, self = this, hoy = L.hoyISO(), pe = db.personas.filter(function (p) { return p.id === debe; })[0], unidades = {};
    if (!pe || !(meta > 0)) return { unidades: 0, minutos: 0 };
    db.asignaciones.forEach(function (x) {
      if (x.asignado_a !== hizo || x.fecha !== hoy || x.motivo === 'fija' || x.oculta || (x.local_id || null) !== (pe.local_id || null)) return;
      // tarea de varias personas en la que debe ya tiene su propio puesto: no se le da el del compañero
      if (x.plantilla_id && db.asignaciones.some(function (y) { return y.plantilla_id === x.plantilla_id && y.fecha === x.fecha && y.asignado_a === debe; })) return;
      var p = x.plantilla_id ? L.plantillaDe(db, x.plantilla_id) : null;
      if (p && !L.puedeSegun(p, pe)) return;
      var k = x.plantilla_id || x.id;
      (unidades[k] = unidades[k] || { clave: k, total: 0, una: 0, filas: [], pend: true });
      unidades[k].total += x.minutos; unidades[k].una = Math.max(unidades[k].una, x.minutos); unidades[k].filas.push(x);
      if (x.estado !== 'pendiente') unidades[k].pend = false;
    });
    var us = Object.keys(unidades).map(function (k) { return unidades[k]; })
      .filter(function (u) { return u.pend && !(pe.tarea_max && u.una > pe.tarea_max); })
      .sort(function (a, b) { return b.total - a.total || (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0); }).slice(0, 12);
    if (!us.length) return { unidades: 0, minutos: 0 };
    var mejor = 0, mejorTot = 0, dentroMejor = false, mejorDif = null;
    for (var mask = 1; mask < (1 << us.length); mask++) {
      var tot = 0;
      for (var i = 0; i < us.length; i++) if ((mask >> i) & 1) tot += us[i].total;
      var dentro = tot >= meta && tot * 10 <= meta * 12;
      if (dentro) { if (!dentroMejor || tot < mejorTot) { mejor = mask; mejorTot = tot; dentroMejor = true; } }
      else if (!dentroMejor) {
        var dif = Math.abs(tot - meta);
        if (mejorDif === null || dif < mejorDif || (dif === mejorDif && tot > mejorTot)) { mejor = mask; mejorTot = tot; mejorDif = dif; }
      }
    }
    var n = 0;
    us.forEach(function (u, i) {
      if (!((mejor >> i) & 1)) return;
      u.filas.forEach(function (x) { x.asignado_a = debe; x.asignado_original = debe; x.motivo = 'compensa'; self._evento(x.id, 'reasignada', hizo, debe, 'compensa'); });
      n++;
    });
    return { unidades: n, minutos: mejorTot };
  };

  function hhmmAhora(d) { d = d || new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function horaTxt(t) { return L.fmtHoraTxt(t); }
  // Igual que _hecha en supabase.sql
  DemoStore.prototype._hecha = function (id, hecha, conRegistro) {
    var db = this.db, yo = this._yo(), adm = this._admin(), hoy = L.hoyISO(), self = this;
    var a = this._asig(id);
    if (!a) throw errorUsuario('Esa tarea ya no existe.');
    if (!adm && a.asignado_a !== yo.id) throw errorUsuario('Esa tarea no está asignada a ti.');
    var p = a.plantilla_id ? L.plantillaDe(db, a.plantilla_id) : null;
    if (hecha) {
      if (a.estado === 'hecha') return;
      if (a.fecha > hoy) throw errorUsuario('Esa tarea es para otro día.');
      if (a.registro && !conRegistro) throw errorUsuario('Esa tarea pide registrar las temperaturas.');
      if (!adm && a.desde && a.fecha === hoy && hhmmAhora() < L.hhmm(a.desde)) throw errorUsuario('Esa tarea todavía no toca: es desde las ' + horaTxt(L.hhmm(a.desde)));
      if (!adm && a.momento > 0 && a.fecha === hoy) {
        var prev = db.asignaciones.filter(function (b) { return b.plantilla_id === a.plantilla_id && b.fecha === a.fecha && b.momento === a.momento - 1; })[0];
        if (prev && prev.antes && L.hhmm(prev.antes) > hhmmAhora()) throw errorUsuario('Esa tarea todavía no toca: es para ' + (a.momento_nombre || 'más tarde') + '.');
      }
      if (!adm) {
        var pres = L.asistenciaDe(db, yo.id, hoy);
        if (!(pres && pres.estado === 'presente')) {
          if (db.ajustes.solo_en_tienda) throw errorUsuario('Primero marca «Llegué».');
          this._llegada(yo.id);
        }
      }
      a.estado = 'hecha'; a.hecha_en = new Date().toISOString(); a.hecha_por = a.asignado_a || yo.id; a.repetir = false;
      this._evento(a.id, 'hecha', null, a.hecha_por);
      // Tarea de varias personas: con que una la marque, queda hecha para todos (igual que el SQL).
      // Cada puesto queda como hecho por su dueño: la hicieron juntos, nadie le «debe» minutos a nadie.
      L.companerosDe(db, a).forEach(function (b) {
        if (b.estado !== 'pendiente') return;
        b.estado = 'hecha'; b.hecha_en = a.hecha_en; b.hecha_por = b.asignado_a || a.hecha_por; b.repetir = false;
        self._evento(b.id, 'hecha', null, b.hecha_por);
      });
      if (a.motivo === 'rescate' && a.incumplida && !a.compensada && a.rescatada_de) { a.compensada = true; this._compensar(a.asignado_a || yo.id, a.rescatada_de, a.minutos); }
      if (p && String(p.seguimiento_titulo || '').trim() && (a.momento || 0) < 50 && a.fecha === hoy) {
        var t = new Date(Date.now() + (p.seguimiento_despues || 45) * 60000), t2 = new Date(t.getTime() + 15 * 60000);
        var quien = a.asignado_a || yo.id, mom = (a.momento || 0) + 50;
        var ya = db.asignaciones.filter(function (x) { return x.plantilla_id === p.id && x.fecha === a.fecha && x.momento === mom; })[0];
        if (ya) { if (ya.estado === 'pendiente') { ya.desde = hhmmAhora(t); ya.antes = hhmmAhora(t2); ya.asignado_a = quien; ya.asignado_original = quien; } }
        else db.asignaciones.push({ id: uuid(), plantilla_id: p.id, fecha: a.fecha, titulo: String(p.seguimiento_titulo).trim(), detalle: null, minutos: p.seguimiento_minutos || 5,
          arrastra: false, asignado_a: quien, asignado_original: quien, motivo: 'fija', estado: 'pendiente', hecha_en: null, hecha_por: null,
          creado_en: new Date().toISOString(), local_id: a.local_id, momento: mom, momento_nombre: a.momento_nombre || null, desde: hhmmAhora(t), antes: hhmmAhora(t2), registro: false, consumible_id: p.seguimiento_consumible_id || null });
      }
    } else {
      if (a.estado !== 'hecha') return;
      if (!adm && L.hoyISO(new Date(a.hecha_en)) !== hoy) throw errorUsuario('Solo se puede deshacer el mismo día.');
      var cuando = a.hecha_en;
      a.estado = 'pendiente'; a.hecha_en = null; a.hecha_por = null;
      this._evento(a.id, 'deshecha', null, a.asignado_a);
      L.companerosDe(db, a).forEach(function (b) {
        if (b.estado !== 'hecha' || b.hecha_en !== cuando) return;  // solo lo que se marcó junto con esta
        b.estado = 'pendiente'; b.hecha_en = null; b.hecha_por = null;
        self._evento(b.id, 'deshecha', null, b.asignado_a);
      });
      db.lecturas = (db.lecturas || []).filter(function (x) { return x.asignacion_id !== a.id; });
      this._devolverConsumo(a.id);
      if ((a.momento || 0) < 50) db.asignaciones = db.asignaciones.filter(function (x) {
        return !(x.plantilla_id === a.plantilla_id && x.fecha === a.fecha && x.momento === (a.momento || 0) + 50 && x.estado === 'pendiente');
      });
    }
  };
  // ---------- Consumibles (igual que consumo_datos y sus funciones en supabase.sql) ----------
  DemoStore.prototype._cons = function () {
    var db = this.db; db.consumibles = db.consumibles || []; db.consumibles_mov = db.consumibles_mov || []; db.consumibles_pedidos = db.consumibles_pedidos || []; return db;
  };
  DemoStore.prototype._entregador = function (localId) { var y = this._yo(); return this._admin() || !!(y && y.activo && y.entrega_consumibles && y.local_id === localId); };
  DemoStore.prototype._mover = function (c, tipo, cant, persona, pedido, asig, nota) {
    c.stock = Math.round(((Number(c.stock) || 0) + (tipo === 'entrega' || tipo === 'uso' ? -cant : cant)) * 100) / 100;
    this._cons().consumibles_mov.push({ id: uuid(), consumible_id: c.id, tipo: tipo, cantidad: cant, stock_despues: c.stock, persona_id: persona || null,
      autor: (this._yo() || {}).id, pedido_id: pedido || null, asignacion_id: asig || null, nota: nota || null, creado_en: new Date().toISOString() });
    return c.stock;
  };
  DemoStore.prototype._devolverConsumo = function (asigId) {
    var db = this._cons();
    db.consumibles_mov = db.consumibles_mov.filter(function (m) {
      if (m.asignacion_id !== asigId || m.tipo !== 'uso') return true;
      var c = db.consumibles.filter(function (x) { return x.id === m.consumible_id; })[0]; if (c) c.stock = Math.round(((Number(c.stock) || 0) + m.cantidad) * 100) / 100;
      return false;
    });
  };
  DemoStore.prototype._consumoDatos = function () {
    var db = this._cons(), yo = this._yo(), adm = this._admin(); if (!yo || !yo.activo) return null;
    var ent = adm || !!yo.entrega_consumibles, nom = function (id) { var p = db.personas.filter(function (x) { return x.id === id; })[0]; return p ? (p.nombre || p.email) : ''; };
    var porId = function (id) { return db.consumibles.filter(function (c) { return c.id === id; })[0] || {}; };
    var recetas = {};
    db.consumibles.forEach(function (c) { if (adm || c.local_id === yo.local_id) recetas[c.id] = { nombre: c.nombre, unidad: c.unidad, vasitos_por_taza: c.vasitos_por_taza == null ? null : c.vasitos_por_taza, agua_ml_por_taza: c.agua_ml_por_taza == null ? null : c.agua_ml_por_taza }; });
    var hace2 = Date.now() - 2 * 864e5, hace70 = Date.now() - 70 * 864e5;
    return copia({
      puede_entregar: ent,
      para_pedir: db.consumibles.filter(function (c) { return c.activo && c.local_id === yo.local_id; }).sort(function (a, b) { return (a.orden || 0) - (b.orden || 0); })
        .map(function (c) { return { id: c.id, nombre: c.nombre, unidad: c.unidad }; }),
      recetas: recetas,
      mis_pedidos: db.consumibles_pedidos.filter(function (p) { return p.persona_id === yo.id && (p.estado === 'pendiente' || new Date(p.creado_en).getTime() > hace2); }),
      pendientes: ent ? db.consumibles_pedidos.filter(function (p) { return p.estado === 'pendiente' && (adm || porId(p.consumible_id).local_id === yo.local_id); }).map(function (p) {
        var c = porId(p.consumible_id); return { id: p.id, consumible_id: p.consumible_id, nombre: c.nombre, unidad: c.unidad, local_id: c.local_id, persona_id: p.persona_id, persona: nom(p.persona_id), nota: p.nota, creado_en: p.creado_en };
      }) : [],
      inventario: adm ? db.consumibles : [],
      movimientos: adm ? db.consumibles_mov.filter(function (m) { return new Date(m.creado_en).getTime() > hace70; }) : []
    });
  };

  // Igual que registrar_lecturas
  DemoStore.prototype._registrar = function (id, lecturas) {
    var db = this.db, yo = this._yo(), adm = this._admin(), hoy = L.hoyISO();
    var a = this._asig(id);
    if (!a) throw errorUsuario('Esa tarea ya no existe.');
    if (!a.registro) throw errorUsuario('Esa tarea no pide temperaturas.');
    if (!adm && a.asignado_a !== yo.id) throw errorUsuario('Esa tarea no está asignada a ti.');
    if (a.estado === 'hecha') throw errorUsuario('Esa tarea ya está hecha.');
    if (!adm && a.desde && a.fecha === hoy && hhmmAhora() < L.hhmm(a.desde)) throw errorUsuario('Esa tarea todavía no toca: es desde las ' + horaTxt(L.hhmm(a.desde)));
    var eqs = L.equiposDe(db, a.local_id, a);
    var nuevas = [], nfuera = 0;
    eqs.forEach(function (e) {
      var l = lecturas.filter(function (x) { return x.equipo === e.id; })[0];
      if (!l) throw errorUsuario('Escribe la lectura de «' + e.nombre + '».');
      var est = l.estado || 'normal';
      if (['normal', 'defrost', 'apagado'].indexOf(est) < 0) throw errorUsuario('Escribe un estado válido para «' + e.nombre + '».');
      var temp = l.temperatura === '' || l.temperatura == null ? null : Math.round(Number(l.temperatura) * 10) / 10;
      if (temp === null && est !== 'apagado') throw errorUsuario('Escribe la temperatura de «' + e.nombre + '».');
      var nota = String(l.nota || '').trim() || null;
      var fuera = L.fueraDeRango(e, temp, est);
      if (fuera && !nota) throw errorUsuario('Escribe una nota: «' + e.nombre + '» está fuera de rango.');
      if (fuera) nfuera++;
      nuevas.push({ id: uuid(), asignacion_id: a.id, equipo_id: e.id, fecha: a.fecha, temperatura: temp, estado: est, fuera_rango: fuera, nota: nota, registrado_por: yo.id, registrado_en: new Date().toISOString() });
    });
    this._hecha(id, true, true);
    db.lecturas = (db.lecturas || []).filter(function (x) { return x.asignacion_id !== a.id; }).concat(nuevas);
    return { fuera: nfuera };
  };

  DemoStore.prototype.rpc = function (nombre, args) {
    var self = this, db = this.db, yo = this._yo(), adm = this._admin(), hoy = L.hoyISO(), r = null;
    args = args || {};
    try {
      if (nombre === 'generar_dia') {
        var f = args.p_fecha || hoy;
        if (f !== hoy && !adm) throw errorUsuario('Solo gerencia puede generar otros días.');
        var nuevas = L.generarDia(db, f, uuid);
        nuevas.forEach(function (a) { self._evento(a.id, 'generada', null, a.asignado_a, a.motivo); });
        r = nuevas.length;
      } else if (nombre === 'marcar_llegada') {
        if (!yo.activo) throw errorUsuario('Tu usuario no está activo.');
        var ya = L.asistenciaDe(db, yo.id, hoy);
        if (ya && ya.estado === 'presente') r = this._llegada(yo.id);
        else {
          var v = this._ubicar(yo.id, args.p_lat, args.p_lng, args.p_precision);
          if (!v) {
            if (args.p_lat == null && db.ajustes.usar_gps) throw errorUsuario('NO_TIENDA: Falta tu ubicación', { noTienda: true });
            throw errorUsuario('No se pudo marcar tu llegada. Si el problema sigue, avísale a gerencia.');
          }
          L.generarDia(db, hoy, uuid);
          r = this._llegada(yo.id, v.verif === 'libre' ? null : v.verif, v.local);
          r.local = v.local;
        }
      } else if (nombre === 'marcar_hecha') {
        this._hecha(args.p_id, args.p_hecha, false);
      } else if (nombre === 'marcar_fuera') {
        if (!db.ajustes.usar_salidas) throw errorUsuario('Esa opción está apagada.');
        if (args.p_fuera && !yo.despacha) throw errorUsuario('Esa opción es solo para quien despacha.');
        var pf = L.asistenciaDe(db, yo.id, hoy);
        if (!(pf && pf.estado === 'presente')) throw errorUsuario('Primero marca «Llegué».');
        db.salidas_rato = db.salidas_rato || [];
        var ab = db.salidas_rato.filter(function (x) { return x.persona_id === yo.id && x.fecha === hoy && !x.volvio; })[0];
        if (args.p_fuera && !ab) db.salidas_rato.push({ id: uuid(), persona_id: yo.id, fecha: hoy, salio: new Date().toISOString(), volvio: null });
        if (!args.p_fuera && ab) ab.volvio = new Date().toISOString();
        r = { fuera: !!args.p_fuera };
      } else if (nombre === 'rescatar') {
        var ra = this._asig(args.p_id);
        if (!ra) throw errorUsuario('Esa tarea ya no existe.');
        if (ra.asignado_a === yo.id) throw errorUsuario('Esa tarea ya es tuya.');
        if (!L.esUrgente(db, ra, new Date())) throw errorUsuario('Alguien ya la tomó.');
        if (ra.plantilla_id && db.asignaciones.some(function (b) { return b.plantilla_id === ra.plantilla_id && b.fecha === ra.fecha && (b.momento || 0) === (ra.momento || 0) && b.asignado_a === yo.id; })) throw errorUsuario('Ya tienes tu parte de esta tarea: al marcar la tuya queda hecha para los dos.');
        if (ra.local_id !== yo.local_id) throw errorUsuario('Esa tarea es de otro local.');
        var pr = L.asistenciaDe(db, yo.id, hoy);
        if (!(pr && pr.estado === 'presente' && !pr.salida)) throw errorUsuario('Primero marca «Llegué».');
        var rp = ra.plantilla_id ? L.plantillaDe(db, ra.plantilla_id) : null;
        if (!L.puedeRescatar(db, ra, yo.id)) throw errorUsuario('Esa tarea solo la pueden hacer otras personas.');
        var inc = !L.excusado(db, ra);
        var de = ra.asignado_a;
        ra.rescatada_de = de; ra.asignado_a = yo.id; ra.incumplida = inc; ra.motivo = 'rescate';
        this._evento(ra.id, 'reasignada', de, yo.id, inc ? 'rescate' : 'rescate_excusa');
        r = { incumplida: inc };
      } else if (nombre === 'pedir_consumible') {
        var dbc = this._cons(), cp = dbc.consumibles.filter(function (c) { return c.id === args.p_consumible && c.activo; })[0];
        if (!cp || cp.local_id !== yo.local_id) throw errorUsuario('Ese consumible no está disponible.');
        if (dbc.consumibles_pedidos.some(function (p) { return p.consumible_id === cp.id && p.persona_id === yo.id && p.estado === 'pendiente'; })) throw errorUsuario('Ya lo pediste: espera a que te lo entreguen.');
        dbc.consumibles_pedidos.push({ id: uuid(), consumible_id: cp.id, persona_id: yo.id, nota: (String(args.p_nota || '').trim() || null), estado: 'pendiente', creado_en: new Date().toISOString() });
      } else if (nombre === 'cancelar_pedido') {
        var pc = this._cons().consumibles_pedidos.filter(function (p) { return p.id === args.p_id && p.estado === 'pendiente' && (p.persona_id === yo.id || adm); })[0];
        if (!pc) throw errorUsuario('Ese pedido ya no está pendiente.');
        pc.estado = 'cancelado'; pc.atendido_en = new Date().toISOString();
      } else if (nombre === 'entregar_consumible') {
        var ce = this._cons().consumibles.filter(function (c) { return c.id === args.p_consumible; })[0];
        if (!ce) throw errorUsuario('Ese consumible no existe.');
        if (!this._entregador(ce.local_id)) throw errorUsuario('Solo gerencia o el encargado pueden entregar.');
        var qe = Number(args.p_cantidad);
        if (!(qe > 0) || qe > 1000) throw errorUsuario('Escribe cuánto entregaste.');
        if (!args.p_persona || !db.personas.some(function (p) { return p.id === args.p_persona; })) throw errorUsuario('Elige a quién se lo entregaste.');
        if (args.p_pedido) {
          var pe2 = this._cons().consumibles_pedidos.filter(function (p) { return p.id === args.p_pedido && p.consumible_id === ce.id && p.estado === 'pendiente'; })[0];
          if (!pe2) throw errorUsuario('Ese pedido ya fue atendido.');
          pe2.estado = 'entregado'; pe2.atendido_por = yo.id; pe2.atendido_en = new Date().toISOString();
        }
        r = this._mover(ce, 'entrega', qe, args.p_persona, args.p_pedido || null, null, null);
      } else if (nombre === 'mover_consumible') {
        var cm = this._cons().consumibles.filter(function (c) { return c.id === args.p_consumible; })[0];
        if (!cm) throw errorUsuario('Ese consumible no existe.');
        var qm = Number(args.p_cantidad);
        if (isNaN(qm) || qm < 0 || qm > 100000) throw errorUsuario('Cantidad no válida.');
        if (args.p_tipo === 'compra') {
          if (!this._entregador(cm.local_id)) throw errorUsuario('Solo gerencia o el encargado.');
          if (qm === 0) throw errorUsuario('Escribe cuánto entró.');
          r = this._mover(cm, 'compra', qm, null, null, null, args.p_nota || null);
        } else if (args.p_tipo === 'ajuste') {
          if (!adm) throw errorUsuario('Solo gerencia.');
          r = this._mover(cm, 'ajuste', Math.round((qm - (Number(cm.stock) || 0)) * 100) / 100, null, null, null, String(args.p_nota || '').trim() || 'Conteo');
        } else throw errorUsuario('Movimiento no válido.');
      } else if (nombre === 'marcar_consumo') {
        var qc = Number(args.p_cantidad);
        if (!(qc > 0) || qc > 500) throw errorUsuario('Escribe cuánto se hizo.');
        var ac = this._asig(args.p_id); if (!ac) throw errorUsuario('Esa tarea ya no existe.');
        this._hecha(args.p_id, true, false);
        var cc = this._cons().consumibles.filter(function (c) { return c.id === ac.consumible_id; })[0];
        if (cc && !this._cons().consumibles_mov.some(function (m) { return m.asignacion_id === ac.id && m.tipo === 'uso'; })) {
          var uc = cc.vasitos_por_taza != null ? (cc.vasitos_por_unidad > 0 ? Math.round(qc * cc.vasitos_por_taza / cc.vasitos_por_unidad * 100) / 100 : 0) : qc;
          this._mover(cc, 'uso', uc, yo.id, null, ac.id, cc.vasitos_por_taza != null ? qc + ' tazas' : null);
        }
      } else if (nombre === 'registrar_lecturas') {
        r = this._registrar(args.p_id, args.p_lecturas || []);
      } else if (nombre === 'tomar_del_pool') {
        if (!db.ajustes.pool_activo) throw errorUsuario('El pool está desactivado.');
        var t = this._asig(args.p_id);
        if (!t || t.asignado_a !== null || t.estado !== 'pendiente' || t.fecha > hoy || (t.fecha < hoy && !t.arrastra)) throw errorUsuario('Alguien ya la tomó.');
        if (t.local_id !== yo.local_id) throw errorUsuario('Esa tarea es de otro local.');
        if (!L.puedeRescatar(db, t, yo.id)) throw errorUsuario('Esa tarea solo la pueden hacer otras personas.');
        if (t.plantilla_id && db.asignaciones.some(function (b) { return b.plantilla_id === t.plantilla_id && b.fecha === t.fecha && (b.momento || 0) === (t.momento || 0) && b.asignado_a === yo.id; })) throw errorUsuario('Ya tienes tu parte de esta tarea.');
        var presT = L.asistenciaDe(db, yo.id, hoy);
        if (db.ajustes.solo_en_tienda && !(presT && presT.estado === 'presente')) throw errorUsuario('Primero marca «Llegué».');
        t.asignado_a = yo.id; t.asignado_original = yo.id; t.motivo = 'tomada';
        this._evento(t.id, 'tomada', null, yo.id);
      } else if (nombre === 'reprogramar_oculta') {
        if (!adm) throw errorUsuario('Solo gerencia.');
        var ro = this._asig(args.p_id); if (!ro) throw errorUsuario('Esa tarea ya no existe.');
        if (!args.p_fecha || args.p_fecha <= hoy) throw errorUsuario('Elige un día a partir de mañana.');
        if (ro.plantilla_id && db.asignaciones.some(function (b) { return b.id !== ro.id && b.plantilla_id === ro.plantilla_id && b.fecha === args.p_fecha && b.momento === ro.momento && (b.puesto || 0) === (ro.puesto || 0); }))
          throw errorUsuario('Esa tarea ya está programada ese día. Elige otro.');
        var deRo = ro.asignado_a;
        ro.fecha = args.p_fecha; ro.asignado_a = ro.asignado_original || ro.asignado_a; ro.oculta = false; ro.motivo = 'manual';
        this._evento(ro.id, 'reasignada', deRo, ro.asignado_a, 'reprogramada');
      } else if (nombre === 'marcar_almuerzo') {
        var quienAl = args.p_persona || yo.id;
        if (quienAl !== yo.id && !adm) throw errorUsuario('Solo gerencia puede marcarlo por otra persona.');
        if (!db.ajustes.usar_almuerzo && !adm) throw errorUsuario('Esa opción está apagada.');
        var sal = L.asistenciaDe(db, quienAl, hoy);
        if (!sal || sal.estado !== 'presente') throw errorUsuario('Primero marca «Llegué».');
        if (args.p_quitar) { if (!adm) throw errorUsuario('Solo gerencia puede quitarlo.'); sal.almuerzo = null; r = { ok: true }; }
        else if (sal.salida) throw errorUsuario('Ya marcó su salida de hoy.');
        else if (sal.almuerzo) r = { almuerzo: sal.almuerzo, ya: true };
        else {
          var otrosAl = L.almorzandoGrupo(db, quienAl, new Date());
          if (otrosAl.length && !(args.p_forzar && adm)) throw errorUsuario(otrosAl[0].nombre + ' está almorzando hasta las ' + L.fmtHora(otrosAl[0].hasta) + '; espera a que termine (alguien del grupo tiene que quedarse).');
          sal.almuerzo = new Date().toISOString(); sal.almuerzo_por = yo.id; r = { almuerzo: sal.almuerzo, ya: false };
        }
      } else if (nombre === 'aprobar_oculta') {
        if (!adm) throw errorUsuario('Solo gerencia.');
        var ao = this._asig(args.p_id); if (!ao) throw errorUsuario('Esa tarea ya no existe.');
        var antesAo = ao.asignado_a;
        ao.oculta = false; if (args.p_persona) ao.asignado_a = args.p_persona; if (ao.fecha < hoy) ao.arrastra = true;
        if (args.p_persona && args.p_persona !== antesAo) this._evento(ao.id, 'reasignada', antesAo, args.p_persona, 'ausencia');
      } else if (nombre === 'reasignar') {
        if (!adm) throw errorUsuario('Solo gerencia puede reasignar.');
        var mot = args.p_motivo || 'manual', n = 0;
        (args.p_items || []).forEach(function (it) {
          var x = self._asig(it.id), nuevo = it.a || null;
          if (!x || x.estado !== 'pendiente' || nuevo === x.asignado_a) return;
          if (nuevo && !db.personas.some(function (p) { return p.id === nuevo && p.activo; })) throw errorUsuario('Esa persona no está activa.');
          var de = x.asignado_a;
          x.asignado_a = nuevo;
          if (mot !== 'ausencia') x.asignado_original = nuevo;
          x.motivo = mot === 'ausencia' ? 'ausencia' : (!nuevo ? 'pool' : 'manual');
          self._evento(x.id, 'reasignada', de, nuevo, mot);
          n++;
        });
        r = n;
      } else if (nombre === 'marcar_salida') {
        var sa = L.asistenciaDe(db, yo.id, hoy);
        if (!sa || sa.estado !== 'presente') throw errorUsuario('Primero marca «Llegué».');
        if (!sa.salida) {
          sa.salida = new Date().toISOString(); sa.salida_motivo = String(args.p_motivo || '').trim() || null; r = { salida: sa.salida, ya: false };
          this._repartirLocal(L.localDePersona(db, yo), L.pasoLimite(db.ajustes, new Date()));
        }
        else r = { salida: sa.salida, ya: true };
      } else if (nombre === 'marcar_asistencia') {
        if (!adm) throw errorUsuario('Solo gerencia.');
        if (args.p_estado === 'presente') r = this._llegada(args.p_persona, 'gerencia');
        else if (args.p_estado === 'salida' || args.p_estado === 'sin_salida') {
          var sb = L.asistenciaDe(db, args.p_persona, hoy);
          if (args.p_estado === 'salida') {
            if (!sb || sb.estado !== 'presente') throw errorUsuario('Primero marca su llegada.');
            sb.salida = sb.salida || new Date().toISOString();
            this._repartirLocal(L.localDePersona(db, L.personaDe ? L.personaDe(db, args.p_persona) : db.personas.filter(function (x) { return x.id === args.p_persona; })[0]), L.pasoLimite(db.ajustes, new Date()));
          } else if (sb) { sb.salida = null; sb.salida_motivo = null; }
          r = { ok: true };
        } else {
          db.asistencia = db.asistencia.filter(function (s) { return !(s.persona_id === args.p_persona && s.fecha === hoy); });
          if (args.p_estado === 'ausente') {
            db.asistencia.push({ persona_id: args.p_persona, fecha: hoy, estado: 'ausente', llegada: null, marcado_por: yo.id });
            var pa = db.personas.filter(function (x) { return x.id === args.p_persona; })[0];
            if (L.pasoLimite(db.ajustes, new Date())) this._repartirLocal(L.localDePersona(db, pa), true);
          }
          r = { ok: true };
        }
      } else if (nombre === 'justificar') {
        var txt = String(args.p_texto || '').trim();
        if (txt.length < 3) throw errorUsuario('Escribe el motivo.');
        var aj1 = this._asig(args.p_id);
        if (!aj1) throw errorUsuario('Esa tarea ya no existe.');
        if (!adm && aj1.asignado_a !== yo.id) throw errorUsuario('Esa tarea no está asignada a ti.');
        if (aj1.estado !== 'pendiente') throw errorUsuario('Esa tarea ya está hecha.');
        if (aj1.just_estado === 'aprobada' || aj1.just_estado === 'rechazada') throw errorUsuario('Esa justificación ya fue revisada.');
        aj1.justificacion = txt; aj1.just_estado = adm ? 'aprobada' : 'pendiente'; aj1.just_por = adm ? yo.id : null;
        this._evento(aj1.id, adm ? 'just_aprobada' : 'justificada', null, aj1.asignado_a, txt);
      } else if (nombre === 'revisar_justificacion') {
        if (!adm) throw errorUsuario('Solo gerencia.');
        var aj2 = this._asig(args.p_id);
        if (!aj2 || !aj2.justificacion) throw errorUsuario('Esa justificación ya no existe.');
        if ((aj2.just_estado === 'aprobada' || aj2.just_estado === 'rechazada') && aj2.just_por !== yo.id) throw errorUsuario('Esa justificación ya la revisó otra persona de gerencia.');
        aj2.just_estado = args.p_ok ? 'aprobada' : 'rechazada'; aj2.just_por = yo.id;
        this._evento(aj2.id, args.p_ok ? 'just_aprobada' : 'just_rechazada', null, aj2.asignado_a, aj2.justificacion);
      } else if (nombre === 'asignar_revisiones') {
        if (!adm) { r = 0; }
        else {
          db.revisiones = db.revisiones || [];
          var now = new Date(), minAhora = now.getHours() * 60 + now.getMinutes();
          var n = db.ajustes.revisiones_dia == null ? 4 : db.ajustes.revisiones_dia;
          var admins = db.personas.filter(function (p) { return p.rol === 'admin' && p.activo; });
          var nuevas = 0;
          [['manana', 720, Math.ceil(n / 2)], ['tarde', 960, Math.floor(n / 2)]].forEach(function (fr) {
            if (minAhora < fr[1]) return;
            var ya = db.revisiones.filter(function (x) { return x.fecha === hoy && x.franja === fr[0]; }).length;
            while (ya < fr[2]) {
              var revisadas = db.revisiones.map(function (x) { return x.asignacion_id; });
              var conRev = db.revisiones.filter(function (x) { return x.fecha === hoy; }).map(function (x) { return x.hecho_por; });
              var cands = db.asignaciones.filter(function (x) {
                if (x.estado !== 'hecha' || !x.hecha_en || !x.hecha_por || revisadas.indexOf(x.id) >= 0) return false;
                if (!db.personas.some(function (p) { return p.id === x.hecha_por && p.rol === 'empleado'; })) return false;
                var dh = new Date(x.hecha_en);
                if (L.hoyISO(dh) !== hoy) return false;
                return (fr[0] === 'manana') === (dh.getHours() < 12);
              });
              if (!cands.length) break;
              var frescos = cands.filter(function (x) { return conRev.indexOf(x.hecha_por) < 0; });
              var pool2 = frescos.length ? frescos : cands;
              var elegida = pool2[Math.floor(Math.random() * pool2.length)];
              var cuenta = function (p) { return db.revisiones.filter(function (x) { return x.revisor === p.id && x.fecha === hoy; }).length; };
              var minC = Math.min.apply(null, admins.map(cuenta));
              var libres = admins.filter(function (p) { return cuenta(p) === minC; });
              var rev = libres[Math.floor(Math.random() * libres.length)];
              db.revisiones.push({ id: uuid(), asignacion_id: elegida.id, fecha: hoy, franja: fr[0], hecho_por: elegida.hecha_por, revisor: rev ? rev.id : null, calificacion: null, nota: null, revisado_por: null, revisado_en: null, creado_en: new Date().toISOString() });
              ya++; nuevas++;
            }
          });
          r = nuevas;
        }
      } else if (nombre === 'calificar') {
        if (!adm) throw errorUsuario('Solo gerencia.');
        var rv = (db.revisiones || []).filter(function (x) { return x.id === args.p_id; })[0];
        if (!rv) throw errorUsuario('Esa revisión ya no existe.');
        if (rv.calificacion != null && rv.revisado_por !== yo.id) throw errorUsuario('Esa tarea ya la calificó otra persona de gerencia.');
        rv.calificacion = args.p_calificacion; rv.nota = String(args.p_nota || '').trim() || null; rv.revisado_por = yo.id; rv.revisado_en = new Date().toISOString();
        var ta = this._asig(rv.asignacion_id);
        this._evento(ta.id, 'revisada', null, ta.hecha_por, String(args.p_calificacion));
        if (args.p_repetir) {
          var quienR = ta.hecha_por || ta.asignado_a;
          ta.estado = 'pendiente'; ta.hecha_en = null; ta.hecha_por = null; ta.repetir = true; ta.arrastra = true; ta.asignado_a = quienR;
          this._evento(ta.id, 'repetir', null, quienR, rv.nota);
        }
      } else if (nombre === 'mi_red') {
        if (!adm) throw errorUsuario('Solo gerencia.');
        var ipA = this._ip();
        r = { ip: ipA, locales: db.locales.filter(function (l) { return (l.redes || []).indexOf(ipA) >= 0; }).map(function (l) { return l.id; }) };
      } else if (nombre === 'registrar_red') {
        if (!adm) throw errorUsuario('Solo gerencia.');
        var ipR = this._ip(), lo = L.localDe(db, args.p_local);
        if (!lo) throw errorUsuario('Ese local no existe.');
        db.locales.forEach(function (l) { if (l.id !== lo.id) l.redes = (l.redes || []).filter(function (x) { return x !== ipR; }); });
        if ((lo.redes || []).indexOf(ipR) < 0) lo.redes = (lo.redes || []).concat([ipR]).slice(-5);
        r = { ip: ipR, redes: lo.redes.length };
      } else if (nombre === 'mi_perfil') {
        if (!String(args.p_nombre || '').trim()) throw errorUsuario('Escribe tu nombre.');
        yo.nombre = String(args.p_nombre).trim(); yo.telefono = String(args.p_telefono || '').trim() || null;
      } else {
        throw errorUsuario('Función desconocida: ' + nombre);
      }
    } catch (e) { return Promise.reject(e); }
    this._guardar();
    return Promise.resolve(copia(r));
  };

  DemoStore.prototype._soloAdmin = function () { if (!this._admin()) throw errorUsuario('No tienes permiso para hacer eso.'); };
  DemoStore.prototype.insertar = function (tabla, fila) {
    try { this._soloAdmin(); } catch (e) { return Promise.reject(e); }
    var f = Object.assign({ id: uuid(), creado_en: new Date().toISOString() }, fila);
    if (tabla === 'plantillas') f = Object.assign({ detalle: null, dias_semana: [], cada_n: 1, dia_mes: null, fecha_inicio: L.hoyISO(), fecha_unica: null, solo_pueden: [], asignar_a: null, al_pool: false, activa: true, momentos: [], local_id: (L.localPrincipal(this.db) || {}).id,
      registro: false, equipos: [], seguimiento_titulo: null, seguimiento_despues: 45, seguimiento_minutos: 5, seguimiento_consumible_id: null }, f);
    if (tabla === 'grupos') f = Object.assign({ nombre: 'Grupo' }, f);
    if (!this.db[tabla]) this.db[tabla] = [];
    if (tabla === 'dias_sin_puntualidad') {
      this.db.dias_sin_puntualidad = this.db.dias_sin_puntualidad.filter(function (x) { return x.fecha !== f.fecha; });
    }
    if (tabla === 'dias_especiales') {
      this.db.dias_especiales = (this.db.dias_especiales || []).filter(function (x) { return !(x.fecha === f.fecha && (x.local_id || null) === (f.local_id || null)); });
    }
    if (tabla === 'locales') f = Object.assign({ principal: false, dias_laborables: [1, 2, 3, 4, 5, 6], redes: [], lat: null, lng: null, radio_m: 150 }, f);
    this.db[tabla].push(f);
    this._guardar();
    return Promise.resolve(copia(f));
  };
  DemoStore.prototype.insertarVarios = function (tabla, filas) {
    var self = this;
    return filas.reduce(function (p, f) { return p.then(function () { return self.insertar(tabla, f); }); }, Promise.resolve());
  };
  // Personal temporal: pasado su último día, lo pendiente queda sin asignar y se desactiva (igual que en avisos_pendientes)
  DemoStore.prototype._vencerTemporales = function () {
    var hoy = L.hoyISO(), db = this.db, cambio = false;
    db.personas.forEach(function (pe) {
      if (!pe.activo || !pe.hasta || pe.hasta >= hoy) return;
      db.asignaciones.forEach(function (a) { if (a.asignado_a === pe.id && a.estado === 'pendiente' && (a.fecha >= hoy || a.arrastra)) a.asignado_a = null; });
      pe.activo = false; cambio = true;
    });
    if (cambio) this._guardar();
  };
  DemoStore.prototype.actualizar = function (tabla, id, patch) {
    try { this._soloAdmin(); } catch (e) { return Promise.reject(e); }
    var hoy = L.hoyISO();
    var fila = tabla === 'ajustes' ? this.db.ajustes : this.db[tabla].filter(function (r) { return r.id === id; })[0];
    if (!fila) return Promise.resolve(null);
    var estabaActiva = !!fila.activa;
    Object.assign(fila, patch);
    if (tabla === 'plantillas') {
      if (estabaActiva && !fila.activa) {
        this.db.asignaciones = this.db.asignaciones.filter(function (a) { return !(a.plantilla_id === id && a.estado === 'pendiente' && a.fecha >= hoy); });
      } else this.db.asignaciones.forEach(function (a) {
        if (a.plantilla_id === id && a.estado === 'pendiente' && a.fecha >= hoy && (a.momento || 0) < 50) { a.titulo = fila.titulo; a.detalle = fila.detalle; a.minutos = fila.minutos; a.registro = !!fila.registro; a.equipos = (fila.equipos || []).slice(); }
      });
    }
    this._guardar();
    return Promise.resolve(copia(fila));
  };
  DemoStore.prototype.borrar = function (tabla, id) {
    try { this._soloAdmin(); } catch (e) { return Promise.reject(e); }
    this.db[tabla] = this.db[tabla].filter(function (r) { return r.id !== id; });
    if (tabla === 'plantillas') this.db.asignaciones.forEach(function (a) { if (a.plantilla_id === id) a.plantilla_id = null; });
    if (tabla === 'asignaciones') this.db.eventos = this.db.eventos.filter(function (e) { return e.asignacion_id !== id; });
    if (tabla === 'grupos') {
      this.db.personas.forEach(function (p) { p.grupos = (p.grupos || []).filter(function (g) { return g !== id; }); });
      this.db.plantillas.forEach(function (p) { p.grupos = (p.grupos || []).filter(function (g) { return g !== id; }); });
    }
    if (tabla === 'locales') {
      var pr = L.localPrincipal(this.db);
      this.db.plantillas = this.db.plantillas.filter(function (p) { return p.local_id !== id; });
      this.db.asignaciones = this.db.asignaciones.filter(function (a) { return a.local_id !== id; });
      this.db.personas.forEach(function (p) { if (p.local_id === id) p.local_id = pr ? pr.id : null; });
    }
    this._guardar();
    return Promise.resolve();
  };
  DemoStore.prototype.eventos = function (asigId) {
    return Promise.resolve(copia(this.db.eventos.filter(function (e) { return e.asignacion_id === asigId; })
      .sort(function (a, b) { return a.creado_en < b.creado_en ? -1 : 1; })));
  };

  // ---------- Modo real: Supabase ----------
  function SupabaseStore(config) {
    this.modo = 'supabase';
    this.url = String(config.supabaseUrl).replace(/\/+$/, '');
    this.key = config.supabaseKey;
    this.claveSesion = 'barquero_sesion';  // la misma sesión para todos los módulos
    this.ses = sesionCompartida();
    this.fetch = config.fetch || (typeof fetch !== 'undefined' ? fetch.bind(typeof window !== 'undefined' ? window : globalThis) : null);
  }
  // Contenido (srzoco.github.io/contenidoBF) está en el mismo sitio y guarda su sesión en «bfcontenido_sesion».
  // Se comparte la más reciente de las dos: así no hay que poner la clave dos veces, y ninguna app usa un
  // «refresh token» viejo (Supabase cierra la sesión de las dos si se reutiliza uno ya cambiado).
  var CLAVES_SESION = ['barquero_sesion', 'bfcontenido_sesion'];
  function sesionCompartida() {
    var mejor = null;
    CLAVES_SESION.forEach(function (k) { var x = LS.get(k); if (x && x.refresh_token && x.user && (!mejor || (x.expires_at || 0) > (mejor.expires_at || 0))) mejor = x; });
    return mejor;
  }
  SupabaseStore.prototype.sesion = function () { return this.ses ? { user: this.ses.user } : null; };

  SupabaseStore.prototype._pedir = function (url, opciones) {
    var self = this;
    return self.fetch(url, opciones).catch(function () {
      throw errorUsuario('No hay conexión con la base de datos. Revisa el internet e inténtalo de nuevo.', { red: true });
    }).then(function (r) {
      return r.text().then(function (t) {
        var cuerpo = null;
        try { cuerpo = t ? JSON.parse(t) : null; } catch (e) { cuerpo = t; }
        return { ok: r.ok, status: r.status, cuerpo: cuerpo };
      });
    });
  };
  function mensajeDe(cuerpo, porDefecto) {
    if (!cuerpo) return porDefecto;
    if (typeof cuerpo === 'string') return cuerpo;
    return cuerpo.msg || cuerpo.message || cuerpo.error_description || cuerpo.error || porDefecto;
  }

  SupabaseStore.prototype._auth = function (ruta, cuerpo, token) {
    var h = { apikey: this.key, 'Content-Type': 'application/json' };
    if (token) h.Authorization = 'Bearer ' + token;
    return this._pedir(this.url + '/auth/v1/' + ruta, { method: 'POST', headers: h, body: JSON.stringify(cuerpo || {}) });
  };
  SupabaseStore.prototype._guardarSesion = function (d) {
    var ahora = Math.floor(Date.now() / 1000);
    this.ses = {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: d.expires_at || (ahora + (d.expires_in || 3600)),
      user: { id: d.user.id, email: d.user.email }
    };
    var ses = this.ses;
    CLAVES_SESION.forEach(function (k) { LS.set(k, ses); });
  };
  SupabaseStore.prototype._olvidarSesion = function () { this.ses = null; CLAVES_SESION.forEach(function (k) { LS.del(k); }); };

  SupabaseStore.prototype.entrar = function (email, clave) {
    var self = this;
    return self._auth('token?grant_type=password', { email: String(email || '').trim(), password: clave }).then(function (r) {
      if (!r.ok) {
        var m = mensajeDe(r.cuerpo, '');
        if (r.status === 400 || /invalid/i.test(m)) throw errorUsuario('Correo o contraseña incorrectos.');
        throw errorUsuario('No se pudo iniciar sesión (' + r.status + '). ' + m);
      }
      self._guardarSesion(r.cuerpo);
    });
  };
  SupabaseStore.prototype.salir = function () {
    var self = this, tok = self.ses && self.ses.access_token;
    self._olvidarSesion();
    if (!tok) return Promise.resolve();
    return self._auth('logout', {}, tok).catch(function () { /* da igual */ });
  };
  SupabaseStore.prototype._refrescar = function () {
    var self = this;
    if (!self.ses || !self.ses.refresh_token) return Promise.reject(errorUsuario('Tu sesión expiró. Vuelve a entrar.', { sesion: true }));
    if (self._refrescando) return self._refrescando;
    // Si Contenido (u otra pestaña) ya la renovó, usar esa en vez de gastar el refresh token viejo
    var otra = sesionCompartida();
    if (otra && otra.user.id === self.ses.user.id && otra.expires_at > self.ses.expires_at && otra.expires_at - 60 > Date.now() / 1000) { self.ses = otra; return Promise.resolve(); }
    self._refrescando = self._auth('token?grant_type=refresh_token', { refresh_token: self.ses.refresh_token }).then(function (r) {
      self._refrescando = null;
      if (!r.ok) { self._olvidarSesion(); throw errorUsuario('Tu sesión expiró. Vuelve a entrar.', { sesion: true }); }
      self._guardarSesion(r.cuerpo);
    }, function (e) { self._refrescando = null; throw e; });
    return self._refrescando;
  };
  SupabaseStore.prototype._token = function () {
    var self = this;
    if (!self.ses) return Promise.reject(errorUsuario('Inicia sesión para continuar.', { sesion: true }));
    if (self.ses.expires_at - 60 < Date.now() / 1000) return self._refrescar().then(function () { return self.ses.access_token; });
    return Promise.resolve(self.ses.access_token);
  };
  SupabaseStore.prototype._rest = function (metodo, ruta, cuerpo, extra, reintento) {
    var self = this;
    return self._token().then(function (tok) {
      var h = Object.assign({ apikey: self.key, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, extra || {});
      return self._pedir(self.url + '/rest/v1/' + ruta, { method: metodo, headers: h, body: cuerpo == null ? undefined : JSON.stringify(cuerpo) });
    }).then(function (r) {
      if (r.status === 401 && !reintento) {
        return self._refrescar().then(function () { return self._rest(metodo, ruta, cuerpo, extra, true); });
      }
      if (!r.ok) {
        var m = mensajeDe(r.cuerpo, 'Error ' + r.status);
        if (r.status === 401) { self._olvidarSesion(); throw errorUsuario('Tu sesión expiró. Vuelve a entrar.', { sesion: true }); }
        if (r.status === 403 || /row-level security/i.test(m)) throw errorUsuario('No tienes permiso para hacer eso.');
        if (/relation .* does not exist|could not find the (table|function)/i.test(m)) throw errorUsuario('La base de datos no está preparada: falta ejecutar supabase.sql.');
        if (/^NO_TIENDA/.test(m)) throw errorUsuario(m, { noTienda: true });
        throw errorUsuario(/^(Esa|Solo|El pool|El local|Alguien|Tu usuario|Escribe|Inicia|No estás|No se pudo marcar|Primero|No se pudo detectar)/.test(m) ? m : 'No se pudo guardar: ' + m);
      }
      return r.cuerpo;
    });
  };
  function filtro(k, v) {
    if (v === null || v === undefined) return encodeURIComponent(k) + '=is.null';
    if (v === true || v === false) return encodeURIComponent(k) + '=is.' + v;
    return encodeURIComponent(k) + '=eq.' + encodeURIComponent(String(v));
  }
  SupabaseStore.prototype.rpc = function (nombre, args) {
    return this._rest('POST', 'rpc/' + nombre, args || {});
  };
  // Una sola consulta (datos_app) en vez de varias: mucho más rápido con internet lento.
  SupabaseStore.prototype.cargar = function (completo) {
    var self = this;
    return self.rpc('datos_app', { p_completo: !!completo }).then(function (d) {
      d = d || {};
      var uid = self.ses.user.id;
      var personas = d.personas || [];
      var yo = personas.filter(function (p) { return p.id === uid; })[0] || null;
      if (!yo) throw errorUsuario('Tu usuario no está en la lista del equipo. Avísale a gerencia.');
      var aj = d.ajustes || L.AJUSTES_BASE;
      aj.hora_limite = String(aj.hora_limite || '08:50').slice(0, 5);
      aj.a_tiempo_hasta = String(aj.a_tiempo_hasta || '08:35').slice(0, 5);
      (d.asignaciones || []).forEach(function (a) { if (a.antes) a.antes = String(a.antes).slice(0, 5); if (a.desde) a.desde = String(a.desde).slice(0, 5); });
      return { completo: !!d.completo, mi_mes: d.mi_mes || null, dias_sin_puntualidad: d.dias_sin_puntualidad || [], equipos: d.equipos || [], lecturas: d.lecturas || [], salidas_rato: d.salidas_rato || [], yo: yo, personas: personas, ajustes: aj, locales: d.locales || [], grupos: d.grupos || [], dias_especiales: d.dias_especiales || [],
        revisiones: d.revisiones || [], plantillas: d.plantillas || [], asignaciones: d.asignaciones || [], asistencia: d.asistencia || [],
        companeros: d.companeros || {}, almorzando_grupo: d.almorzando_grupo || [], redes_nuevas: d.redes_nuevas || [], con_avisos: d.con_avisos || null, avisos_tel: d.avisos_tel || {}, reloj: d.reloj || null, consumo: d.consumo || null };
    });
  };
  // En la base unificada, dos tablas de Tareas llevan prefijo (Contenido ya usa esos nombres)
  function tablaReal(t) { return t === 'ajustes' ? 'tareas_ajustes' : t === 'eventos' ? 'tareas_eventos' : t; }
  SupabaseStore.prototype.insertar = function (tabla, fila) {
    return this._rest('POST', tablaReal(tabla), fila, { Prefer: 'return=representation' }).then(function (r) { return (r && r[0]) || null; });
  };
  SupabaseStore.prototype.insertarVarios = function (tabla, filas) {
    return this._rest('POST', tablaReal(tabla), filas, { Prefer: 'return=minimal' });
  };
  SupabaseStore.prototype.actualizar = function (tabla, id, patch) {
    var ruta = tabla === 'ajustes' ? 'tareas_ajustes?id=eq.1' : tablaReal(tabla) + '?' + filtro('id', id);
    return this._rest('PATCH', ruta, patch, { Prefer: 'return=representation' }).then(function (r) {
      if (!r || !r[0]) throw errorUsuario('No tienes permiso para hacer eso.');
      return r[0];
    });
  };
  SupabaseStore.prototype.borrar = function (tabla, id) {
    return this._rest('DELETE', tablaReal(tabla) + '?' + filtro('id', id), null, { Prefer: 'return=minimal' });
  };
  SupabaseStore.prototype.eventos = function (asigId) {
    return this._rest('GET', 'tareas_eventos?select=*&asignacion_id=eq.' + encodeURIComponent(asigId) + '&order=creado_en.asc');
  };

  function crearStore(config, semilla) {
    if (config && config.supabaseUrl && config.supabaseKey) return new SupabaseStore(config);
    return new DemoStore(semilla);
  }

  return { crearStore: crearStore, DemoStore: DemoStore, SupabaseStore: SupabaseStore, uuid: uuid, LS: LS };
});
