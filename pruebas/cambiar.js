/* Cambiar de herramienta: el botón del menú abre una hoja con las otras herramientas de la persona (sin pasar por el menú).
   Se prueba en el Armador (con base de datos simulada). Uso: python3 -m http.server 8765 y luego: node pruebas/cambiar.js */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
(async () => {
  const fallas = [];
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: 360, height: 760 } });
  p.on('pageerror', e => fallas.push('JS: ' + e.message));
  await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.BARQUERO_CONFIG={supabaseUrl:"http://sb.test",supabaseKey:"k"};' }));
  await p.route('http://sb.test/**', r => r.request().url().includes('armador_datos')
    ? r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ datos: { productos: [], ajustes: {} }, actualizado_en: '2026-11-06T00:00:00Z' }]) })
    : r.fulfill({ status: 401, body: '{}' }));
  await p.route('**/mensajesBF/tasas.json*', r => r.fulfill({ contentType: 'application/json', body: '{"descuento":40}' }));
  const entrar = async (persona) => {
    await p.goto(BASE + '/mensajes/');
    await p.evaluate((pe) => {
      localStorage.clear();
      localStorage.setItem('barquero_sesion', JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: Date.now() / 1000 + 3600, user: { id: 'u1' } }));
      if (pe) localStorage.setItem('barquero_cache_menu_u1', JSON.stringify(pe));
    }, persona);
    await p.reload(); await p.waitForTimeout(1200);
  };
  // gerencia: ve las otras 3 herramientas y el menú
  await entrar({ nombre: 'Sara', rol: 'admin', accesos: [], activo: true });
  await p.click('a.volver-cil'); await p.waitForTimeout(300);
  const ops = await p.locator('#cambiar-hoja .cambiar-op').allInnerTexts();
  const txt = ops.join(' | ');
  if (!/Tareas/.test(txt) || !/Contenido/.test(txt) || !/Pendientes/.test(txt) || !/Menú de CIL/.test(txt)) fallas.push('Gerencia no ve sus herramientas: ' + txt);
  if (/Armador/.test(txt)) fallas.push('Ofrece la herramienta en la que ya está');
  if (!/\/mensajes\/$/.test(p.url())) fallas.push('Se fue de la página en vez de abrir la hoja: ' + p.url());
  await p.click('.cambiar-fondo', { position: { x: 20, y: 20 } }); await p.waitForTimeout(200);
  if (await p.$('#cambiar-hoja')) fallas.push('No se cierra al tocar afuera');
  await p.click('a.volver-cil'); await p.waitForTimeout(200);
  await p.click('#cambiar-hoja a[href="../contenido/"]'); await p.waitForTimeout(800);
  if (!/\/contenido\/$/.test(p.url())) fallas.push('No abrió Contenido: ' + p.url());
  // empleado con mensajes y tareas: no ve Pendientes
  await entrar({ nombre: 'Adolfo', rol: 'empleado', accesos: ['tareas', 'mensajes'], activo: true });
  await p.click('a.volver-cil'); await p.waitForTimeout(300);
  const t2 = (await p.locator('#cambiar-hoja .cambiar-op').allInnerTexts()).join(' | ');
  if (!/Tareas/.test(t2) || /Pendientes|Contenido/.test(t2)) fallas.push('El empleado ve herramientas que no tiene: ' + t2);
  // sin menú guardado: el botón lleva al menú como antes
  await entrar(null);
  await p.click('a.volver-cil'); await p.waitForTimeout(800);
  if (/\/mensajes\/$/.test(p.url())) fallas.push('Sin menú guardado no llevó al menú');
  await b.close();
  if (fallas.length) { console.error('FALLAS (' + fallas.length + '):\n- ' + fallas.join('\n- ')); process.exit(1); }
  console.log('OK: cambiar de herramienta sin pasar por el menú.');
})();
