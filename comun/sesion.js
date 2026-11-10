/* CIL — la sesión del teléfono, en un solo lugar (10/11/2026). La usan el menú, Tareas, Contenido, Pendientes y el Armador.
   Antes había 5 copias casi iguales: un arreglo de seguridad había que hacerlo en todas.

   Reglas (incidente del 27/10/2026: la app abría con la cuenta de otra persona):
   - La sesión se guarda en dos lugares del teléfono (barquero_sesion y bfcontenido_sesion) y gana la que vence más tarde.
   - Si los dos lugares tienen personas DISTINTAS, no se usa ninguna: se borran y se pide entrar.
   - Al renovar nunca se escribe encima de la sesión de otra persona (la pantalla vieja se entera y se recarga).
   - Al entrar se borran las demás; al salir, todas.
   - Al renovar, solo se borra si el servidor dice que ya no vale (400/401/403). Si el servidor falló o está ocupado
     (5xx, 429) o no hay internet, se conserva y se trata como «sin internet».

   Errores: los que devuelve llevan e.sesion = true (hay que volver a entrar), e.red = true (sin internet o servidor caído)
   o e.otro = true (en este teléfono entró otra persona). */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.CILSesion = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var CLAVES = ['barquero_sesion', 'bfcontenido_sesion'];
  // Si el teléfono no deja guardar (modo privado), se guarda en memoria mientras la página esté abierta
  var memoria = {};
  function hayLS() { try { return typeof localStorage !== 'undefined' && localStorage !== null; } catch (e) { return false; } }
  function get(k) {
    try { if (hayLS()) { var v = localStorage.getItem(k); if (v != null) return JSON.parse(v); } } catch (e) { /* sigue con la memoria */ }
    return k in memoria ? memoria[k] : null;
  }
  function set(k, v) { memoria[k] = v; try { if (hayLS()) localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* queda en memoria */ } }
  function del(k) { delete memoria[k]; try { if (hayLS()) localStorage.removeItem(k); } catch (e) { /* nada */ } }
  function error(msg, extra) { var e = new Error(msg); for (var k in extra) e[k] = extra[k]; return e; }

  // La sesión guardada (la que vence más tarde), o null. Si hay dos personas distintas, se borran las dos.
  function leer() {
    var mejor = null, usuarios = {};
    CLAVES.forEach(function (k) {
      var x = get(k);
      if (x && x.refresh_token && x.user) { usuarios[x.user.id] = 1; if (!mejor || (x.expires_at || 0) > (mejor.expires_at || 0)) mejor = x; }
    });
    if (Object.keys(usuarios).length > 1) { olvidar(); return null; }
    return mejor;
  }
  function usuario() { var s = leer(); return s ? s.user.id : null; }
  // Guarda lo que devuelve Supabase al entrar (esEntrada) o al renovar. Al renovar, si en el teléfono ya hay otra persona, no escribe.
  function guardar(d, esEntrada) {
    var otro = usuario();
    if (!esEntrada && otro && otro !== d.user.id) throw error('Entró otra persona en este teléfono.', { otro: true, sesion: true });
    if (esEntrada) olvidar();
    var ses = { access_token: d.access_token, refresh_token: d.refresh_token,
      expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600), user: { id: d.user.id, email: d.user.email } };
    CLAVES.forEach(function (k) { set(k, ses); });
    return ses;
  }
  function olvidar() { CLAVES.forEach(del); }
  function vigente(s) { return !!s && (s.expires_at || 0) - 60 > Date.now() / 1000; }

  // Renueva la sesión «ses» (la que tiene la pantalla). Una sola renovación a la vez por teléfono y pantalla:
  // gastar dos veces el mismo «refresh token» hace que Supabase cierre la sesión en todas las herramientas.
  var renovando = {};
  function renovar(url, key, ses, fetchFn) {
    ses = ses || leer();
    if (!ses || !ses.refresh_token) return Promise.reject(error('Tu sesión expiró. Vuelve a entrar.', { sesion: true }));
    // ¿Otra herramienta u otra pestaña ya la renovó? Se usa esa.
    var ya = leer();
    if (ya && ya.user.id === ses.user.id && (ya.expires_at || 0) > (ses.expires_at || 0) && vigente(ya)) return Promise.resolve(ya);
    if (ya && ya.user.id !== ses.user.id) return Promise.reject(error('Entró otra persona en este teléfono.', { otro: true, sesion: true }));
    if (renovando[ses.refresh_token]) return renovando[ses.refresh_token];
    var f = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    var p = Promise.resolve().then(function () {
      return f(String(url).replace(/\/+$/, '') + '/auth/v1/token?grant_type=refresh_token',
        { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: ses.refresh_token }) });
    }).then(function (r) {
      if (!r.ok && [400, 401, 403].indexOf(r.status) < 0) throw error('El servidor no respondió. Inténtalo de nuevo en un momento.', { red: true });
      if (!r.ok) {
        // si mientras tanto otra pantalla ya la renovó, el token viejo ya no sirve pero la sesión sigue: se usa la nueva
        var otra = leer();
        if (otra && otra.user.id === ses.user.id && otra.refresh_token !== ses.refresh_token && vigente(otra)) return otra;
        olvidar(); throw error('Tu sesión expiró. Vuelve a entrar.', { sesion: true });
      }
      return r.json().then(function (d) { return guardar(d, false); });
    }, function (e) {
      if (e && (e.sesion || e.red)) throw e;
      throw error('No hay conexión. Revisa el internet e inténtalo de nuevo.', { red: true });
    });
    renovando[ses.refresh_token] = p;
    var limpiar = function () { delete renovando[ses.refresh_token]; };
    p.then(limpiar, limpiar);
    return p;
  }
  // Un token que sirva ahora: el guardado si sigue vigente; si no, se renueva.
  function token(url, key, fetchFn) {
    var s = leer();
    if (!s) return Promise.reject(error('Inicia sesión para continuar.', { sesion: true }));
    if (vigente(s)) return Promise.resolve(s.access_token);
    return renovar(url, key, s, fetchFn).then(function (n) { return n.access_token; });
  }

  return { CLAVES: CLAVES, leer: leer, usuario: usuario, guardar: guardar, olvidar: olvidar, vigente: vigente, renovar: renovar, token: token };
});
