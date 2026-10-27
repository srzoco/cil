/* Prueba de Pendientes de gerencia contra el Postgres de prueba (stub + cil.sql + datos de pruebas/seguridad.sql).
   Las llamadas a la base de datos de la página se responden con psql, como la persona que tiene la sesión.
   Uso: python3 -m http.server 8765 (en la carpeta del repo) y luego: PSQL="psql -d prueba" node pruebas/pendientes.js */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const { execFileSync } = require('child_process');
const BASE = process.env.BASE || 'http://localhost:8765';
const PSQL = (process.env.PSQL || 'psql -d prueba').split(' ');
const SARA = 'a0000000-0000-0000-0000-000000000001', JAVIER = 'b0000000-0000-0000-0000-000000000001';
const sql = (q) => execFileSync(PSQL[0], PSQL.slice(1).concat(['-v', 'ON_ERROR_STOP=1', '-qAt', '-c', q]), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const lit = (v) => v === null || v === undefined ? 'NULL' : Array.isArray(v) ? lit('{' + v.map(x => '"' + String(x).replace(/["\\]/g, '\\$&') + '"').join(',') + '}') : '$v$' + String(v) + '$v$';
sql(`insert into auth.users (id, email) values ('${JAVIER}', 'javier@x.com') on conflict do nothing;
     update personas set rol = 'admin', nombre = 'Javier Pérez' where id = '${JAVIER}'; update personas set nombre = 'Sara Zoco' where id = '${SARA}';`);

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: 360, height: 760 } });
  const fallas = []; let donde = '';
  p.on('pageerror', e => fallas.push('JS en ' + donde + ': ' + e.message));
  const fotos = {};
  await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.BARQUERO_CONFIG={supabaseUrl:"http://sb.test",supabaseKey:"k"};' }));
  await p.route('http://sb.test/**', async (r) => {
    const req = r.request(), u = new URL(req.url()), uid = (req.headers().authorization || '').replace('Bearer ', '');
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = u.pathname.split('/').pop(), args = JSON.parse(req.postData() || '{}');
      const q = `set test.uid = '${uid}'; set role authenticated; select coalesce(to_json(public.${fn}(${Object.keys(args).map(k => k + ' => ' + lit(args[k])).join(', ')}))::text, 'null');`;
      try { return r.fulfill({ status: 200, contentType: 'application/json', body: sql(q).trim() || 'null' }); }
      catch (e) { const m = String(e.stderr || e.message).match(/ERROR:\s+(.*)/); return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: m ? m[1] : 'error' }) }); }
    }
    if (u.pathname.startsWith('/storage/v1/object/')) {
      const ruta = decodeURIComponent(u.pathname.replace('/storage/v1/object/', '').replace('authenticated/', ''));
      if (req.method() === 'POST') { fotos[ruta] = req.postDataBuffer(); return r.fulfill({ status: 200, body: '{}' }); }
      if (req.method() === 'GET') return fotos[ruta] ? r.fulfill({ status: 200, contentType: 'image/jpeg', body: fotos[ruta] }) : r.fulfill({ status: 404, body: '' });
      return r.fulfill({ status: 200, body: '[]' });
    }
    return r.fulfill({ status: 404, body: '' });
  });
  const como = async (uid) => {
    await p.goto(BASE + '/pendientes/');
    await p.evaluate((uid) => localStorage.setItem('barquero_sesion', JSON.stringify({ access_token: uid, refresh_token: 'x', expires_at: 4e9, user: { id: uid } })), uid);
    await p.reload(); await p.waitForTimeout(500);
  };
  const revisar = async () => {
    const r = await p.evaluate(() => ({ xss: !!window.__xss, w: document.documentElement.scrollWidth }));
    if (r.xss) fallas.push('Un texto se ejecutó como código en ' + donde);
    if (r.w > 361) fallas.push('Se sale de la pantalla (' + r.w + ' px) en ' + donde);
  };
  const ve = (txt) => p.evaluate((t) => document.body.innerText.includes(t), txt);
  const debe = async (txt) => { if (!(await ve(txt))) fallas.push('No sale «' + txt + '» en ' + donde); };

  // Sara le pide algo a Javier, con detalle y foto
  donde = 'Sara crea'; await como(SARA); await revisar(); await debe('Nada pendiente para ti');
  await p.goto(BASE + '/pendientes/#/nuevo'); await p.waitForTimeout(200);
  await p.selectOption('select[name="para"]', JAVIER);
  await p.fill('input[name="titulo"]', '¿Necesitamos lavaplatos? <img src=x onerror="window.__xss=1">' + 'x'.repeat(120));
  await p.fill('textarea[name="texto"]', 'Para el CIL');
  await p.click('form[data-form="nuevo"] button[type="submit"]'); await p.waitForTimeout(700); await revisar();
  await debe('Listo, se lo pediste a Javier');
  const wa = await p.getAttribute('a.btn.wa', 'href'); if (!/wa\.me\/\?text=Hola%20Javier/.test(wa || '')) fallas.push('El botón de WhatsApp no arma el texto: ' + wa);
  await p.click('[data-acc="ya-visto"]'); await p.waitForTimeout(400);
  donde = 'Sara foto';
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGNQSDiAFTEMLQkAGplQAT43V5gAAAAASUVORK5CYII=', 'base64');
  await p.setInputFiles('input[data-cambio="foto"]', { name: 'f.png', mimeType: 'image/png', buffer: png });
  await p.waitForFunction(() => /Foto lista para enviar|foto/i.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});
  await debe('Foto lista para enviar');
  if (!(await ve('Foto lista para enviar'))) fallas.push('Mensaje en pantalla: ' + (await p.evaluate(() => (document.querySelector('.toast') || {}).textContent || '(ninguno)')));
  await p.fill('form[data-form="mensaje"] textarea', 'Mira cómo está el estante');
  await p.click('form[data-form="mensaje"] button[type="submit"]');
  await p.waitForFunction(() => document.querySelector('.msj-txt') && /estante/.test(document.querySelector('.hilo').innerText), null, { timeout: 8000 }).catch(() => {});
  await revisar(); await debe('Mira cómo está el estante');
  if (!Object.keys(fotos).length) fallas.push('No se subió la foto');
  // Recordatorio que se repite, con validación
  donde = 'Sara recordatorio';
  await p.goto(BASE + '/pendientes/#/nuevo'); await p.waitForTimeout(200);
  await p.fill('input[name="titulo"]', 'Pagar alquiler'); await p.selectOption('select[name="repite"]', 'mensual');
  await p.click('form[data-form="nuevo"] button[type="submit"]'); await p.waitForTimeout(300); await debe('ponle una fecha');
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
  await p.fill('input[name="vence"]', hoy); await p.click('form[data-form="nuevo"] button[type="submit"]'); await p.waitForTimeout(700);
  await debe('Cada mes'); await revisar();

  // Javier lo ve como nuevo y contesta
  donde = 'Javier'; await como(JAVIER); await revisar();
  await debe('¿Necesitamos lavaplatos?'); if (!(await p.locator('.punto').count())) fallas.push('A Javier no le sale como nuevo');
  if (await ve('Pagar alquiler')) fallas.push('Javier ve el recordatorio privado de Sara');
  await p.click('a.item'); await p.waitForTimeout(800); await revisar();
  await debe('Mira cómo está el estante');
  if (!(await p.locator('.msj img[src^="blob:"]').count())) fallas.push('A Javier no le carga la foto');
  if (await p.locator('[data-acc="cerrar"]').count()) fallas.push('Javier puede cerrar lo que pidió Sara');
  await p.fill('form[data-form="mensaje"] textarea', 'Sí, 2 cajas'); await p.click('form[data-form="mensaje"] button[type="submit"]'); await p.waitForTimeout(800);
  await debe('Sí, 2 cajas');
  for (const t of ['#/pedi', '#/personas', '#/cerrados']) { donde = 'Javier ' + t; await p.goto(BASE + '/pendientes/' + t); await p.waitForTimeout(300); await revisar(); }

  // Sara ve la respuesta, cierra, y el recordatorio repetido sale para el mes siguiente
  donde = 'Sara cierra'; await como(SARA);
  await p.goto(BASE + '/pendientes/#/pedi'); await p.waitForTimeout(300); await debe('Javier: Sí, 2 cajas');
  await p.click('a.item'); await p.waitForTimeout(700);
  await p.click('[data-acc="cerrar"]'); await p.waitForTimeout(800); await debe('Cerrado');
  await p.goto(BASE + '/pendientes/#/mi'); await p.waitForTimeout(300);
  await p.locator('a.item', { hasText: 'Pagar alquiler' }).click(); await p.waitForTimeout(600);
  await p.click('[data-acc="cerrar"]'); await p.waitForTimeout(800); await debe('Ya salió el de la próxima vez');
  await p.goto(BASE + '/pendientes/#/mi'); await p.waitForTimeout(400); await debe('Pagar alquiler');
  // Reabrir no lo duplica: se quita el de la próxima vez
  donde = 'Sara reabre'; await p.goto(BASE + '/pendientes/#/cerrados'); await p.waitForTimeout(400);
  await p.locator('a.item', { hasText: 'Pagar alquiler' }).click(); await p.waitForTimeout(600);
  await p.click('[data-acc="reabrir"]'); await p.waitForTimeout(800); await debe('Reabierto');
  await p.goto(BASE + '/pendientes/#/mi'); await p.waitForTimeout(400);
  const nAlq = await p.locator('a.item', { hasText: 'Pagar alquiler' }).count(); if (nAlq !== 1) fallas.push('Al reabrir quedaron ' + nAlq + ' «Pagar alquiler»');
  if (!(await p.locator('select[name="repite"] option[value="semanas3"]').count())) {
    await p.goto(BASE + '/pendientes/#/nuevo'); await p.waitForTimeout(200);
    if (!(await p.locator('select[name="repite"] option[value="semanas3"]').count())) fallas.push('No sale «Cada 3 semanas»');
    await p.goto(BASE + '/pendientes/#/mi'); await p.waitForTimeout(400);
  }
  // Cambiar y borrar
  donde = 'Sara borra'; await p.locator('a.item', { hasText: 'Pagar alquiler' }).click(); await p.waitForTimeout(600);
  await p.click('[data-acc="editar"]'); await p.click('[data-acc="borrar"]'); await p.waitForTimeout(200); await p.click('[data-acc="borrar-si"]'); await p.waitForTimeout(800);
  await debe('Borrado');
  donde = 'Sara avisos'; await p.selectOption('select[data-cambio="pref"]', 'resumen'); await p.waitForTimeout(500);
  if (sql(`select pend_avisos from personas where id = '${SARA}'`).trim() !== 'resumen') fallas.push('No se guardó la preferencia de avisos');
  for (const t of ['#/pedi', '#/personas', '#/cerrados', '#/p/no-existe', '#/nuevo?para=' + JAVIER]) { donde = 'Sara ' + t; await p.goto(BASE + '/pendientes/' + t); await p.waitForTimeout(300); await revisar(); }

  if (process.env.FOTOS) { await p.goto(BASE + '/pendientes/#/cerrados'); await p.waitForTimeout(400); await p.screenshot({ path: process.env.FOTOS + '/lista.png' });
    await p.locator('a.item').first().click(); await p.waitForTimeout(900); await p.screenshot({ path: process.env.FOTOS + '/detalle.png', fullPage: true }); }
  // Un empleado no entra
  donde = 'empleado'; await como('e0000000-0000-0000-0000-000000000001'); await debe('Solo gerencia');
  await b.close();
  if (fallas.length) { console.error('FALLAS (' + fallas.length + '):\n- ' + fallas.join('\n- ')); process.exit(1); }
  console.log('OK: pendientes de gerencia (pedir, foto, contestar, cerrar, repetir, borrar, privacidad) sin errores.');
})();
