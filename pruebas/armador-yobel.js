/* Armador → aviso del robot de Yobel: gerencia aprueba el descuento de las 4 cuentas en Bs. con un botón.
   Un empleado no ve nada. Uso: python3 -m http.server 8765 y luego: node pruebas/armador-yobel.js */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
(async () => {
  const fallas = [];
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const datos = { ajustes: {}, productos: [{ id: 'q1', nombre: 'Queso manchego', categoria: 'Quesos', presentaciones: [{ texto: '500 g', precio: 10 }] }] };
  const abrir = async (rol, w) => {
    const p = await b.newPage({ viewport: { width: w || 360, height: 760 } });
    p.on('pageerror', e => fallas.push('JS (' + rol + '): ' + e.message));
    const estado = { y: { fecha: '2026-11-09', descuento: 43, en_yobel: 41, estado: 'pendiente', limite: '12:00' }, aprobar: null };
    await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.BARQUERO_CONFIG={supabaseUrl:"http://sb.test",supabaseKey:"k"};' }));
    await p.route('http://sb.test/**', async r => {
      const u = r.request().url();
      if (u.includes('armador_datos')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ datos, editado_en: '2026-11-07T00:00:00Z' }]) });
      if (u.includes('rpc/es_admin')) return r.fulfill({ contentType: 'application/json', body: rol === 'gerencia' ? 'true' : 'false' });
      if (u.includes('rpc/descuento_yobel_hoy')) return rol === 'gerencia' ? r.fulfill({ contentType: 'application/json', body: JSON.stringify(estado.y) })
        : r.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"Solo gerencia."}' });
      if (u.includes('rpc/descuento_yobel_aprobar')) {
        estado.aprobar = JSON.parse(r.request().postData());
        estado.y = Object.assign({}, estado.y, { estado: estado.aprobar.p_si ? 'aprobado' : 'rechazado' });
        return r.fulfill({ contentType: 'application/json', body: JSON.stringify(estado.y) });
      }
      return r.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"no"}' });
    });
    await p.route('**/mensajesBF/tasas.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ descuento: 43, actualizado: new Date().toISOString() }) }));
    await p.goto(BASE + '/mensajes/#yobel');
    await p.evaluate(() => localStorage.setItem('barquero_sesion', JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: Date.now() / 1000 + 3600, user: { id: 'u1' } })));
    await p.reload(); await p.waitForTimeout(1500);
    return { p, estado };
  };
  // 1. empleado: no ve el aviso
  { const { p } = await abrir('empleado'); if (await p.locator('#yobel').isVisible()) fallas.push('Un empleado ve el aviso de Yobel'); await p.close(); }
  // 2. gerencia: ve la pregunta, aprueba con el número que vio
  for (const w of [320, 390]) {
    const { p, estado } = await abrir('gerencia', w);
    const box = p.locator('#yobel');
    if (!(await box.isVisible())) { fallas.push('Gerencia no ve el aviso a ' + w + ' px'); await p.close(); continue; }
    const t = await box.innerText();
    if (!t.includes('43%') || !t.includes('41%')) fallas.push('El aviso no dice 43% y 41%: ' + t);
    const ancho = await p.evaluate(() => document.documentElement.scrollWidth); if (ancho > w + 1) fallas.push('Se sale de la pantalla a ' + w + ' px');
    await p.click('[data-yobel="si"]'); await p.waitForTimeout(500);
    if (!estado.aprobar || estado.aprobar.p_descuento !== 43 || estado.aprobar.p_si !== true) fallas.push('No mandó la aprobación correcta: ' + JSON.stringify(estado.aprobar));
    if (!(await box.innerText()).includes('aprobado')) fallas.push('No cambió a «aprobado»');
    if (await p.locator('[data-yobel]').count()) fallas.push('Siguen los botones después de aprobar');
    await p.close();
  }
  // 3. gerencia rechaza
  { const { p, estado } = await abrir('gerencia');
    await p.click('[data-yobel="no"]'); await p.waitForTimeout(500);
    if (!estado.aprobar || estado.aprobar.p_si !== false) fallas.push('No mandó el rechazo');
    await p.close(); }
  await b.close();
  if (fallas.length) { console.error('FALLAS (' + fallas.length + '):\n- ' + fallas.join('\n- ')); process.exit(1); }
  console.log('OK: Armador, aprobar el descuento de Yobel.');
})();
