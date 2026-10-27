/* Contenido Barquero — acceso a datos.
   - Modo demo: todo se guarda en este navegador (para probar sin instalar nada).
   - Modo real: Supabase (base de datos compartida), usando su API REST directamente. */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.BFStore = mod;
})(typeof self !== 'undefined' ? self : this, function () {
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

  function coincide(fila, match) {
    if (!match) return true;
    return Object.keys(match).every(function (k) {
      var a = fila[k] === undefined ? null : fila[k];
      var b = match[k] === undefined ? null : match[k];
      return a === b;
    });
  }

  // ---------- Modo demo ----------
  function DemoStore(semilla) {
    this.modo = 'demo';
    this.clave = 'bfcontenido_demo_v2';
    this.semilla = semilla;
    this.db = LS.get(this.clave);
    if (!this.db || !this.db.piezas) { this.db = semilla(); this._guardar(); }
    if (!this.db.grabaciones) { var s = semilla(); this.db.grabaciones = s.grabaciones || []; this.db.grabacion_eventos = s.grabacion_eventos || []; Object.assign(this.db.ajustes, { grabacion_dia: 2, grabacion_hora: '11:00' }, this.db.ajustes); this._guardar(); }
    if (!this.db.push_subs) { this.db.push_subs = []; this._guardar(); }
    var u = LS.get('bfcontenido_demo_usuario');
    this.usuarioId = (u && this.db.equipo.some(function (e) { return e.user_id === u; })) ? u : this.db.equipo[0].user_id;
  }
  DemoStore.prototype._guardar = function () { LS.set(this.clave, this.db); };
  DemoStore.prototype.sesion = function () {
    var id = this.usuarioId;
    var m = this.db.equipo.filter(function (e) { return e.user_id === id; })[0];
    return { user: { id: id, email: (m ? m.nombre.toLowerCase() : 'demo') + '@demo' } };
  };
  DemoStore.prototype.cambiarUsuario = function (id) { this.usuarioId = id; LS.set('bfcontenido_demo_usuario', id); };
  DemoStore.prototype.reiniciar = function () { this.db = this.semilla(); this._guardar(); };
  DemoStore.prototype.entrar = function () { return Promise.resolve(); };
  DemoStore.prototype.salir = function () { return Promise.resolve(); };
  DemoStore.prototype.cargarTodo = function () {
    var db = copia(this.db);
    db.piezas.sort(function (a, b) { return a.creado_en < b.creado_en ? 1 : -1; });
    db.eventos.sort(function (a, b) { return a.creado_en < b.creado_en ? -1 : 1; });
    db.grabacion_eventos.sort(function (a, b) { return a.creado_en < b.creado_en ? -1 : 1; });
    return Promise.resolve({ equipo: db.equipo, ajustes: db.ajustes, piezas: db.piezas, eventos: db.eventos, grabaciones: db.grabaciones, grabacion_eventos: db.grabacion_eventos });
  };
  DemoStore.prototype.insertar = function (tabla, fila) {
    var ahora = new Date().toISOString();
    var f = Object.assign({}, fila);
    if (tabla === 'push_subs') {
      f.user_id = this.usuarioId;
      this.db.push_subs = this.db.push_subs.filter(function (r) { return r.endpoint !== f.endpoint; });
      this.db.push_subs.push(f); this._guardar();
      return Promise.resolve(copia(f));
    }
    if (tabla === 'equipo') {
      f.user_id = f.user_id || this.usuarioId;
      this.db.equipo = this.db.equipo.filter(function (e) { return e.user_id !== f.user_id; });
      this.db.equipo.push(f);
    } else {
      f.id = f.id || uuid();
      f.creado_en = f.creado_en || ahora;
      if (tabla === 'piezas') { f.actualizado_en = ahora; f.creado_por = f.creado_por || this.usuarioId; }
      if (tabla === 'eventos' || tabla === 'grabacion_eventos') { f.autor = this.usuarioId; f.datos = f.datos || {}; }
      if (tabla === 'grabaciones') {
        if (this.db.grabaciones.some(function (g) { return g.semana === f.semana; })) return Promise.reject(errorUsuario('No se pudo guardar: duplicate key value violates unique constraint "grabaciones_semana_key"'));
        f.actualizado_en = ahora; f.confirmaciones = f.confirmaciones || []; f.estado = f.estado || 'propuesta';
      }
      this.db[tabla].push(f);
    }
    this._guardar();
    return Promise.resolve(copia(f));
  };
  DemoStore.prototype.eliminar = function (tabla, filtros) {
    var lista = this.db[tabla] || [];
    this.db[tabla] = lista.filter(function (r) { return !coincide(r, filtros); });
    this._guardar();
    return Promise.resolve();
  };
  DemoStore.prototype.funcion = function () { return Promise.reject(errorUsuario('Las notificaciones no funcionan en modo demo.')); };
  DemoStore.prototype.funcionPublica = function () { return Promise.reject(errorUsuario('Las notificaciones no funcionan en modo demo.')); };
  DemoStore.prototype.actualizar = function (tabla, id, patch, match) {
    var clave = tabla === 'equipo' ? 'user_id' : 'id';
    var fila = (this.db[tabla] instanceof Array ? this.db[tabla] : [this.db[tabla]]).filter(function (r) { return r[clave] === id; })[0];
    if (!fila || !coincide(fila, match)) return Promise.resolve(null);
    Object.assign(fila, patch);
    if (tabla === 'piezas' || tabla === 'ajustes' || tabla === 'grabaciones') fila.actualizado_en = new Date().toISOString();
    this._guardar();
    return Promise.resolve(copia(fila));
  };

  // ---------- Modo real: Supabase ----------
  function SupabaseStore(config) {
    this.modo = 'supabase';
    this.url = String(config.supabaseUrl).replace(/\/+$/, '');
    this.key = config.supabaseKey;
    this.claveSesion = 'bfcontenido_sesion';
    this.ses = sesionCompartida();
    this.fetch = config.fetch || (typeof fetch !== 'undefined' ? fetch.bind(typeof window !== 'undefined' ? window : globalThis) : null);
  }
  // La misma sesión del menú de CIL (dos lugares en el teléfono). Seguridad: si tienen personas DISTINTAS
  // (quedó una sesión vieja de otra persona), no se usa ninguna: se borran y se pide entrar. Nunca se abre con otra cuenta.
  var CLAVES_SESION = ['barquero_sesion', 'bfcontenido_sesion'];
  function sesionCompartida() {
    var mejor = null, usuarios = {};
    CLAVES_SESION.forEach(function (k) { var x = LS.get(k); if (x && x.refresh_token && x.user) { usuarios[x.user.id] = 1; if (!mejor || (x.expires_at || 0) > (mejor.expires_at || 0)) mejor = x; } });
    if (Object.keys(usuarios).length > 1) { CLAVES_SESION.forEach(function (k) { LS.del(k); }); return null; }
    return mejor;
  }
  function usuarioGuardado() { var x = sesionCompartida(); return x ? x.user.id : null; }
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
  SupabaseStore.prototype._guardarSesion = function (d, esEntrada) {
    var ahora = Math.floor(Date.now() / 1000);
    // al renovar: si mientras tanto entró otra persona en este teléfono, esta pantalla quedó vieja y no escribe encima
    var otro = usuarioGuardado();
    if (!esEntrada && otro && otro !== d.user.id) { this.ses = null; if (typeof location !== 'undefined') location.reload(); throw errorUsuario('Entró otra persona en este teléfono.', { sesion: true }); }
    if (esEntrada) CLAVES_SESION.forEach(function (k) { LS.del(k); });
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
      self._guardarSesion(r.cuerpo, true);
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
    // Si el menú de CIL u otra app ya la renovó, se usa esa (gastar el refresh token viejo cerraría la sesión en todas)
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
    // Si en este teléfono ahora hay guardada otra persona (o nadie, porque salió en otra pantalla), esta pantalla quedó vieja
    if (usuarioGuardado() !== self.ses.user.id) { self.ses = null; if (typeof location !== 'undefined') location.reload(); return Promise.reject(errorUsuario('La sesión cambió en este teléfono.', { sesion: true })); }
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
        if (/relation .* does not exist|could not find the table/i.test(m)) throw errorUsuario('La base de datos no está preparada: falta ejecutar supabase.sql.');
        throw errorUsuario('No se pudo guardar: ' + m);
      }
      return r.cuerpo;
    });
  };
  function filtro(k, v) {
    if (v === null || v === undefined) return encodeURIComponent(k) + '=is.null';
    if (v === true || v === false) return encodeURIComponent(k) + '=is.' + v;
    return encodeURIComponent(k) + '=eq.' + encodeURIComponent(String(v));
  }
  SupabaseStore.prototype.cargarTodo = function () {
    var self = this;
    return Promise.all([
      self._rest('GET', 'equipo?select=*'),
      self._rest('GET', 'ajustes?select=*'),
      self._rest('GET', 'piezas?select=*&order=creado_en.desc'),
      self._rest('GET', 'eventos?select=*&order=creado_en.asc'),
      self._rest('GET', 'grabaciones?select=*&order=semana.desc'),
      self._rest('GET', 'grabacion_eventos?select=*&order=creado_en.asc')
    ]).then(function (r) {
      return { equipo: r[0] || [], ajustes: (r[1] && r[1][0]) || null, piezas: r[2] || [], eventos: r[3] || [], grabaciones: r[4] || [], grabacion_eventos: r[5] || [] };
    });
  };
  SupabaseStore.prototype.insertar = function (tabla, fila, opciones) {
    var pref = 'return=representation' + (opciones && opciones.upsert ? ',resolution=merge-duplicates' : '');
    return this._rest('POST', tabla, fila, { Prefer: pref }).then(function (r) { return (r && r[0]) || null; });
  };
  SupabaseStore.prototype.eliminar = function (tabla, filtros) {
    var qs = Object.keys(filtros || {}).map(function (k) { return filtro(k, filtros[k]); });
    if (!qs.length) return Promise.reject(errorUsuario('Falta el filtro para borrar.'));
    return this._rest('DELETE', tabla + '?' + qs.join('&'), null, {});
  };
  // Llama a la función de notificaciones con la sesión de la usuaria
  SupabaseStore.prototype.funcion = function (nombre, cuerpo) {
    var self = this;
    return self._token().then(function (tok) {
      return self._pedir(self.url + '/functions/v1/' + nombre, {
        method: 'POST', headers: { apikey: self.key, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo || {})
      });
    }).then(function (r) {
      if (r.status === 404) throw errorUsuario('Falta instalar la función de notificaciones en Supabase (paso 6 de la guía).');
      if (!r.ok) throw errorUsuario('Notificaciones: ' + mensajeDe(r.cuerpo, 'error ' + r.status));
      return r.cuerpo;
    });
  };
  SupabaseStore.prototype.funcionPublica = function (nombre, params) {
    var self = this;
    var qs = Object.keys(params || {}).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    return self._pedir(self.url + '/functions/v1/' + nombre + (qs ? '?' + qs : ''), { method: 'GET', headers: { apikey: self.key } }).then(function (r) {
      if (r.status === 404) throw errorUsuario('Falta instalar la función de notificaciones en Supabase (paso 6 de la guía).');
      if (r.status === 401) throw errorUsuario('La función de notificaciones pide JWT: desactiva «Verify JWT» en Supabase (paso 6 de la guía).');
      if (!r.ok) throw errorUsuario('Notificaciones: ' + mensajeDe(r.cuerpo, 'error ' + r.status));
      return r.cuerpo;
    });
  };
  SupabaseStore.prototype.actualizar = function (tabla, id, patch, match) {
    var clave = tabla === 'equipo' ? 'user_id' : 'id';
    var qs = [filtro(clave, id)];
    Object.keys(match || {}).forEach(function (k) { qs.push(filtro(k, match[k])); });
    return this._rest('PATCH', tabla + '?' + qs.join('&'), patch, { Prefer: 'return=representation' })
      .then(function (r) { return (r && r[0]) || null; });
  };

  function crearStore(config, semilla) {
    if (config && config.supabaseUrl && config.supabaseKey) return new SupabaseStore(config);
    return new DemoStore(semilla);
  }

  return { crearStore: crearStore, DemoStore: DemoStore, SupabaseStore: SupabaseStore, uuid: uuid, LS: LS, coincide: coincide };
});
