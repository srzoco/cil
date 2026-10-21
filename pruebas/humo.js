/* Prueba de humo de Tareas en modo demo: recorre todas las pantallas como gerencia y como empleado,
   marca «Llegué» y una tarea, y falla si hay errores de JavaScript o algo se sale de la pantalla (360 px).
   Uso: python3 -m http.server 8765 (en la carpeta del repo) y luego: node pruebas/humo.js */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
const RUTAS = ['/', '/tareas', '/tarea/nueva?tipo=unica', '/reporte', '/historial', '/temperaturas', '/equipo',
  '/equipo/personas', '/equipo/grupos', '/equipo/locales', '/equipo/frio', '/equipo/calendario', '/equipo/avisos', '/equipo/ajustes', '/perfil', '/balance', '/ayuda'];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: 360, height: 760 } });
  await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.BARQUERO_CONFIG={};' }));
  const fallas = [];
  p.on('pageerror', e => fallas.push('JS: ' + e.message));
  const ancho = async (donde) => {
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    if (w > 361) fallas.push('Se sale de la pantalla (' + w + ' px) en ' + donde);
  };
  await p.goto(BASE + '/tareas/'); await p.waitForTimeout(800);
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  for (const r of RUTAS) {
    await p.goto(BASE + '/tareas/#' + r); await p.waitForTimeout(300);
    if (!(await p.$('main.contenido'))) fallas.push('No pintó ' + r);
    await ancho(r);
  }
  // Abrir la ficha de una persona
  await p.goto(BASE + '/tareas/#/equipo/personas'); await p.waitForTimeout(300);
  await p.click('.persona-fila >> nth=2'); await p.waitForTimeout(300);
  if (!(await p.$('.hoja form[data-form="persona"]'))) fallas.push('No abrió la ficha de persona');
  // Como empleado
  const emp = await p.$eval('select[data-cambio="demo-usuario"]', s => [...s.options].find(o => !/gerencia/.test(o.text)).value);
  await p.goto(BASE + '/tareas/#/'); await p.waitForTimeout(300);
  await p.selectOption('select[data-cambio="demo-usuario"]', emp); await p.waitForTimeout(500);
  const llegue = await p.$('[data-acc="llegue"]');
  if (llegue) { await llegue.click(); await p.waitForTimeout(600); }
  await ancho('Mi día');
  const casilla = await p.$('.tarea:not(.hecha) [data-acc="hecha"], [data-acc="hecha"]');
  if (casilla) { await casilla.click(); await p.waitForTimeout(500); }
  await b.close();
  if (fallas.length) { console.error('FALLAS:\n- ' + fallas.join('\n- ')); process.exit(1); }
  console.log('OK: ' + RUTAS.length + ' pantallas, ficha de persona, llegada y tarea sin errores.');
})();
