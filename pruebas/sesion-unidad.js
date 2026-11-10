/* comun/sesion.js (la sesión, en un solo lugar para todas las herramientas). Sin navegador: node pruebas/sesion-unidad.js */
const S = require('../comun/sesion.js');
const fallas = []; const ok = (c, m) => { if (!c) fallas.push(m); };
const d = (id, exp, rt) => ({ access_token: 'a-' + id, refresh_token: rt || 'r-' + id, expires_at: exp, user: { id, email: id + '@x.com' } });
const ahora = () => Math.floor(Date.now() / 1000);
(async () => {
  // entrar, leer, salir
  S.guardar(d('sara', ahora() + 3600), true);
  ok(S.usuario() === 'sara' && S.vigente(S.leer()), 'entrar y leer');
  S.olvidar(); ok(S.leer() === null, 'salir no borró la sesión');
  // al renovar no se escribe encima de otra persona
  S.guardar(d('yure', ahora() + 3600), true);
  let e1 = null; try { S.guardar(d('sara', ahora() + 3600), false); } catch (e) { e1 = e; }
  ok(e1 && e1.otro && S.usuario() === 'yure', 'una pantalla vieja escribió su sesión encima de la de otra persona');
  // token vigente: no llama al servidor
  let llamadas = 0;
  const f = (status, cuerpo) => async () => { llamadas++; return { ok: status === 200, status, json: async () => cuerpo }; };
  ok(await S.token('http://sb', 'k', f(200, {})) === 'a-yure' && llamadas === 0, 'con sesión vigente no debía renovar');
  // vencida + servidor caído (503) o ocupado (429): se conserva y es «sin internet»
  for (const st of [503, 429]) {
    S.guardar(d('yure', ahora() - 10), true);
    let e = null; try { await S.token('http://sb', 'k', f(st)); } catch (x) { e = x; }
    ok(e && e.red && !e.sesion && S.usuario() === 'yure', 'con el servidor en ' + st + ' se borró la sesión o no dijo «sin internet»');
  }
  // sin internet (fetch falla): igual
  { let e = null; try { await S.token('http://sb', 'k', async () => { throw new TypeError('Failed to fetch'); }); } catch (x) { e = x; }
    ok(e && e.red && S.usuario() === 'yure', 'sin internet se borró la sesión'); }
  // sesión rechazada (400): se borra y pide entrar
  { let e = null; try { await S.token('http://sb', 'k', f(400)); } catch (x) { e = x; }
    ok(e && e.sesion && S.leer() === null, 'con la sesión rechazada (400) no se borró'); }
  // renovar bien: guarda la nueva; dos pedidos a la vez = una sola renovación
  S.guardar(d('sara', ahora() - 10, 'viejo'), true); llamadas = 0;
  const nueva = { access_token: 'nuevo', refresh_token: 'r2', expires_in: 3600, user: { id: 'sara', email: 's@x.com' } };
  const lento = async () => { llamadas++; await new Promise(r => setTimeout(r, 30)); return { ok: true, status: 200, json: async () => nueva }; };
  const [t1, t2] = await Promise.all([S.token('http://sb', 'k', lento), S.token('http://sb', 'k', lento)]);
  ok(t1 === 'nuevo' && t2 === 'nuevo' && llamadas === 1, 'dos renovaciones a la vez gastaron el token dos veces (' + llamadas + ')');
  ok(S.leer().refresh_token === 'r2', 'no guardó la sesión renovada');
  // otra herramienta ya la renovó: se usa esa sin llamar al servidor
  const vieja = d('sara', ahora() - 10, 'r1'); S.guardar(d('sara', ahora() + 3600, 'r3'), true); llamadas = 0;
  const n = await S.renovar('http://sb', 'k', vieja, f(400));
  ok(n.refresh_token === 'r3' && llamadas === 0, 'no aprovechó la sesión que otra herramienta ya renovó');
  // (dos personas guardadas a la vez en el teléfono: se prueba con el navegador en pruebas/sesiones.js)
  if (fallas.length) { console.error('FALLAS:\n- ' + fallas.join('\n- ')); process.exit(1); }
  console.log('OK: sesión en un solo lugar (entrar, salir, otra persona, servidor caído, rechazada, una sola renovación).');
})();
