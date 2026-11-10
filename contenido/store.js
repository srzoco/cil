/* Contenido Barquero — acceso a datos.
   - Modo demo: todo se guarda en este navegador (para probar sin instalar nada).
   - Modo real: Supabase (base de datos compartida), usando su API REST directamente. */
(function (root, factory) {
  var mod = factory(root.CILSesion || (typeof require === 'function' ? require('../comun/sesion.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.BFStore = mod;
})(typeof self !== 'undefined' ? self : this, function (SES) {
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
    this.ses = SES.leer();
    this.fetch = config.fetch || (typeof fetch !== 'undefined' ? fetch.bind(typeof window !== 'undefined' ? window : globalThis) : null);
  }
  // La sesión es la misma en todas las herramientas: vive en comun/sesion.js (CILSesion)
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
    // al renovar: si mientras tanto entró OTRA persona en este teléfono, esta pantalla quedó vieja: no escribe encima y se recarga
    try { this.ses = SES.guardar(d, esEntrada); }
    catch (e) { this.ses = null; if (typeof location !== 'undefined') location.reload(); throw errorUsuario(e.message, { sesion: true }); }
  };
  SupabaseStore.prototype._olvidarSesion = function () { this.ses = null; SES.olvidar(); };

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
    // Una sola renovación a la vez, y si otra herramienta ya la renovó se usa esa (comun/sesion.js)
    return SES.renovar(self.url, self.key, self.ses, self.fetch).then(function (n) { self.ses = n; }, function (e) {
      if (e && e.otro) { self.ses = null; if (typeof location !== 'undefined') location.reload(); }
      else if (e && e.sesion) self.ses = null;
      throw errorUsuario(e.message, { sesion: !!(e && e.sesion), red: !!(e && e.red) });
    });
  };
  SupabaseStore.prototype._token = function () {
    var self = this;
    if (!self.ses) return Promise.reject(errorUsuario('Inicia sesión para continuar.', { sesion: true }));
    // Si en este teléfono ahora hay guardada otra persona (o nadie, porque salió en otra pantalla), esta pantalla quedó vieja
    if (SES.usuario() !== self.ses.user.id) { self.ses = null; if (typeof location !== 'undefined') location.reload(); return Promise.reject(errorUsuario('La sesión cambió en este teléfono.', { sesion: true })); }
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
  // Supabase entrega como máximo 1.000 filas por consulta. Las piezas y sobre todo su historial pasan de ahí con los meses,
  // y sin esto la app se quedaba solo con las 1.000 más viejas (sin las aprobaciones y correcciones recientes) sin avisar.
  // Se pide por páginas hasta que no haya más (mientras sean menos de 1.000, es una sola consulta, igual que antes).
  SupabaseStore.prototype._todas = function (ruta) {
    var self = this, N = 1000, todo = [];
    function pagina(desde) {
      return self._rest('GET', ruta + '&limit=' + N + '&offset=' + desde).then(function (r) {
        r = r || []; todo = todo.concat(r);
        return r.length === N ? pagina(desde + N) : todo;
      });
    }
    return pagina(0);
  };
  // dias (30): al abrir solo se baja lo que está en proceso (tenga la edad que tenga) y lo publicado o archivado que se
  // movió en los últimos «dias» días, con el historial de esas piezas nada más. Sin «dias» se baja todo (Publicadas,
  // Archivadas, Métricas, semanas pasadas del calendario y la búsqueda en lo antiguo lo piden así).
  SupabaseStore.prototype.cargarTodo = function (dias) {
    var self = this;
    var resto = [
      self._rest('GET', 'equipo?select=*'),
      self._rest('GET', 'ajustes?select=*'),
      self._rest('GET', 'grabaciones?select=*&order=semana.desc'),
      self._todas('grabacion_eventos?select=*&order=creado_en.asc,id.asc')
    ];
    var piezasEv;
    if (!dias) {
      piezasEv = Promise.all([self._todas('piezas?select=*&order=creado_en.desc,id.asc'), self._todas('eventos?select=*&order=creado_en.asc,id.asc')]);
    } else {
      var corte = new Date(Date.now() - dias * 864e5).toISOString().slice(0, 19) + 'Z';
      piezasEv = self._todas('piezas?select=*&or=(fase.not.in.(publicada,archivada),actualizado_en.gte.' + corte + ',publicado_ig_en.gte.' + corte + ',publicado_tt_en.gte.' + corte + ')&order=creado_en.desc,id.asc').then(function (ps) {
        // el historial se pide solo de esas piezas, de 60 en 60 (la dirección tiene un largo máximo)
        var grupos = [];
        for (var i = 0; i < ps.length; i += 60) grupos.push(ps.slice(i, i + 60).map(function (x) { return x.id; }));
        return Promise.all(grupos.map(function (ids) { return self._todas('eventos?select=*&pieza_id=in.(' + ids.join(',') + ')&order=creado_en.asc,id.asc'); })).then(function (partes) {
          var ev = [].concat.apply([], partes);
          ev.sort(function (a, b) { return a.creado_en < b.creado_en ? -1 : a.creado_en > b.creado_en ? 1 : (a.id < b.id ? -1 : 1); });
          return [ps, ev];
        });
      }).catch(function (e) {
        // Red de seguridad: si el servidor no acepta la consulta de «lo reciente», se baja todo como antes (más lento, pero abre)
        if (e && (e.red || e.sesion)) throw e;
        dias = null;
        return Promise.all([self._todas('piezas?select=*&order=creado_en.desc,id.asc'), self._todas('eventos?select=*&order=creado_en.asc,id.asc')]);
      });
    }
    return Promise.all(resto.concat([piezasEv])).then(function (r) {
      return { equipo: r[0] || [], ajustes: (r[1] && r[1][0]) || null, piezas: r[4][0] || [], eventos: r[4][1] || [], grabaciones: r[2] || [], grabacion_eventos: r[3] || [], completo: !dias };
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

  SupabaseStore.prototype.actualizar = function (tabla, id, patch, match) {
    var clave = tabla === 'equipo' ? 'user_id' : 'id';
    var qs = [filtro(clave, id)];
    Object.keys(match || {}).forEach(function (k) { qs.push(filtro(k, match[k])); });
    return this._rest('PATCH', tabla + '?' + qs.join('&'), patch, { Prefer: 'return=representation' })
      .then(function (r) { return (r && r[0]) || null; });
  };

  // Nombres de productos del Armador (para revisar que el copy los nombre completos)
  DemoStore.prototype.catalogo = function () { return Promise.resolve(['Queso manchego curado', 'Pistachos tostados', 'Jamón serrano']); };
  SupabaseStore.prototype.catalogo = function () {
    return this._rest('GET', 'armador_datos?id=eq.1&select=datos').then(function (r) {
      var d = r && r[0] && r[0].datos; return ((d && d.productos) || []).map(function (x) { return x.nombre; }).filter(Boolean);
    });
  };

  function crearStore(config, semilla) {
    if (config && config.supabaseUrl && config.supabaseKey) return new SupabaseStore(config);
    return new DemoStore(semilla);
  }

  return { crearStore: crearStore, DemoStore: DemoStore, SupabaseStore: SupabaseStore, uuid: uuid, LS: LS, coincide: coincide };
});
