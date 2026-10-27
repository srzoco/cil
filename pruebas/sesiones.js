/* Seguridad de la sesión en el teléfono (27/10/2026: la app abría con la cuenta de otra persona).
   - Si quedaron guardadas sesiones de personas distintas, ninguna app abre con ninguna: piden entrar.
   - Una pantalla vieja de otra persona no puede escribir su sesión encima de la de quien entró después.
   - Al salir no queda ninguna sesión guardada.
   Uso: python3 -m http.server 8765 (en la carpeta del repo) y luego: node pruebas/sesiones.js */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
const ses = (id, exp) => JSON.stringify({ access_token: 'tok-' + id, refresh_token: 'ref-' + id, expires_at: exp || 4e9, user: { id: id, email: id + '@x.com' } });
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: 360, height: 720 } });
  const fallas = [];
  await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.BARQUERO_CONFIG=window.TB_CONFIG={supabaseUrl:"http://sb.test",supabaseKey:"k"};' }));
  // la base de datos de mentira: responde como la persona del token; renovar le da a Sara un token nuevo
  await p.route('http://sb.test/**', r => {
    const u = r.request().url(), tok = (r.request().headers().authorization || '').replace('Bearer tok-', '');
    if (u.includes('/auth/v1/token')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ access_token: 'tok-sara', refresh_token: 'ref-sara2', expires_in: 3600, user: { id: 'sara', email: 'sara@x.com' } }) });
    if (u.includes('/auth/v1/logout')) return r.fulfill({ status: 204, body: '' });
    if (u.includes('/personas')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ nombre: tok, email: tok + '@x.com', rol: 'empleado', accesos: ['tareas'], activo: true }]) });
    return r.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"JWT"}' });
  });
  const intentar = async (f) => { for (let i = 0; i < 10; i++) { try { return await f(); } catch (e) { if (!/destroyed|navigat/i.test(e.message)) throw e; await p.waitForTimeout(300); } } };
  const claves = () => intentar(() => p.evaluate(() => [localStorage.getItem('barquero_sesion'), localStorage.getItem('bfcontenido_sesion')].map(x => x && JSON.parse(x).user.id)));
  for (const app of ['/', '/tareas/', '/pendientes/', '/contenido/']) {
    await p.goto(BASE + app); await p.evaluate(() => localStorage.clear());
    await p.evaluate(([a, c]) => { localStorage.setItem('barquero_sesion', a); localStorage.setItem('bfcontenido_sesion', c); }, [ses('yure'), ses('sara', 4e9 + 5)]);
    await p.goto(BASE + app); await p.waitForTimeout(900);
    const k = await claves(), texto = await p.locator('body').innerText();
    if (k[0] || k[1]) fallas.push(app + ': con dos personas guardadas no borró las sesiones (' + k.join(', ') + ')');
    if (/sara/i.test(texto)) fallas.push(app + ': abrió con la cuenta de otra persona');
  }
  // Pantalla vieja de Sara (sesión vencida en memoria) mientras Yure entró después: no puede escribir encima
  await p.goto(BASE + '/tareas/'); await p.evaluate(() => localStorage.clear());
  await p.evaluate((s) => { localStorage.setItem('barquero_sesion', s); localStorage.setItem('bfcontenido_sesion', s); }, ses('sara', 1));
  await p.goto(BASE + '/tareas/'); await p.waitForTimeout(100);
  await intentar(() => p.evaluate((s) => { localStorage.setItem('barquero_sesion', s); localStorage.setItem('bfcontenido_sesion', s); }, ses('yure')));
  await p.waitForTimeout(1500); await p.waitForLoadState('load'); await p.waitForTimeout(500);
  const k2 = await claves();
  if (k2[0] !== 'yure' || k2[1] !== 'yure') fallas.push('Una pantalla vieja escribió otra sesión encima de la de Yure (' + k2.join(', ') + ')');
  // Salir no deja ninguna sesión
  await p.goto(BASE + '/'); await p.waitForTimeout(500);
  await intentar(() => p.evaluate((s) => { localStorage.clear(); sessionStorage.setItem('barquero_en_menu', '1'); localStorage.setItem('barquero_sesion', s); localStorage.setItem('bfcontenido_sesion', s); }, ses('yure')));
  await p.goto(BASE + '/'); await p.waitForTimeout(300);
  await p.reload(); await p.waitForTimeout(700);
  const salir = p.locator('#salir'); if (await salir.count()) { await salir.click(); await p.waitForTimeout(400); }
  const k3 = await claves(); if (k3[0] || k3[1]) fallas.push('Al salir quedó una sesión guardada (' + k3.join(', ') + ')');
  await b.close();
  if (fallas.length) { console.error('FALLAS (' + fallas.length + '):\n- ' + fallas.join('\n- ')); process.exit(1); }
  console.log('OK: sesiones en el teléfono (dos personas guardadas, pantalla vieja, salir) sin abrir nunca otra cuenta.');
})();
