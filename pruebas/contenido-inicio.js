/* Contenido, rediseño del 10/11/2026 (modo demo, 360 px):
   - 4 pestañas abajo (Métricas pasó a Ajustes y sigue abriendo).
   - Inicio: «Hoy se publica», «Te toca», «Videos pendientes» (cada número abre su lista) y «Esta semana».
   - El tablero ya no tiene la columna de publicadas: están en «Publicadas» y salen al buscar por nombre.
   - Planificar en un paso: desde un día sin pieza se escribe el nombre y queda la idea con ese día.
   Uso: python3 -m http.server 8765 y luego: node pruebas/contenido-inicio.js */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: 360, height: 740 } });
  const fallas = []; const ok = (c, m) => { if (!c) fallas.push(m); };
  p.on('pageerror', e => fallas.push('JS: ' + e.message));
  await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.BARQUERO_CONFIG={};' }));
  await p.goto(BASE + '/contenido/'); await p.waitForTimeout(600); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(900);
  const db = () => p.evaluate(() => JSON.parse(localStorage.getItem('bfcontenido_demo_v2')));
  // pestañas
  const tabs = await p.$$eval('nav.tabs a', as => as.map(a => a.textContent.trim()));
  ok(tabs.length === 4 && !tabs.some(t => /M.tricas/.test(t)), 'La barra de abajo debía tener 4 pestañas sin Métricas: ' + tabs.join(', '));
  // inicio
  const t = await p.locator('main').innerText();
  for (const x of ['Hoy se publica', 'Te toca', 'Videos pendientes', 'Esta semana']) ok(t.includes(x), 'Falta «' + x + '» en el inicio');
  ok(await p.locator('.hoy-fila').count() === 2, '«Hoy se publica» debía tener una fila por plataforma');
  const d0 = await db(), activas = d0.piezas.filter(x => x.fase !== 'archivada');
  const nApr = activas.filter(x => x.fase === 'produccion' && x.turno === 'aprueba').length;
  ok(+(await p.locator('.embudo-paso.c-aprobar b').innerText()) === nApr, 'El número de «Por aprobar» no coincide con los datos (' + nApr + ')');
  ok(await p.locator('.embudo-paso').count() === 5, '«Videos pendientes» debía tener 5 pasos (sin publicadas)');
  await p.locator('.embudo-paso.c-lista').click(); await p.waitForTimeout(400);
  ok(/tablero/.test(p.url()) && await p.locator('.col.c-lista.sel').count() === 1, 'Tocar «Listas» no abrió esa lista del tablero');
  // tablero sin publicadas
  ok(await p.locator('.col-chip').count() === 5 && await p.locator('.col-chip.c-publicada').count() === 0, 'El tablero todavía muestra la columna de publicadas');
  const pub = d0.piezas.find(x => x.fase === 'publicada');
  if (pub) {
    ok(!(await p.locator('.col.c-publicada').isVisible()), 'Las publicadas se ven en el tablero sin buscar');
    await p.fill('[data-buscar-en]', pub.titulo.slice(0, 12)); await p.waitForTimeout(400);
    ok(await p.locator('.col.c-publicada .tarjeta:not([hidden])').count() >= 1 && await p.locator('.col.c-publicada').isVisible(), 'Al buscar una publicada por nombre no aparece');
    await p.fill('[data-buscar-en]', ''); await p.waitForTimeout(300);
    await p.goto(BASE + '/contenido/#/tablero?f=publicadas'); await p.waitForTimeout(400);
    ok((await p.locator('main').innerText()).includes(pub.titulo), '«Publicadas» no lista la pieza publicada');
  } else fallas.push('La demo no trae ninguna pieza publicada para probar');
  // métricas desde ajustes
  await p.goto(BASE + '/contenido/#/ajustes'); await p.waitForTimeout(300);
  await p.locator('a[href="#/metricas"]').click(); await p.waitForTimeout(300);
  ok((await p.locator('main h1').first().innerText()).match(/M.tricas/), 'Métricas no abre desde Ajustes');
  // planificar en un paso
  await p.goto(BASE + '/contenido/#/calendario'); await p.waitForTimeout(400);
  const hueco = p.locator('.cal-hueco:not(.cal-extra)').first();
  const fecha = await hueco.getAttribute('data-fecha'), plat = await hueco.getAttribute('data-plat');
  await hueco.click(); await p.waitForTimeout(300);
  await p.fill('form[data-form="hueco-nueva"] [name="titulo"]', 'Idea de prueba <b>x</b>');
  await p.locator('form[data-form="hueco-nueva"] button[type=submit]').click(); await p.waitForTimeout(700);
  const nueva = (await db()).piezas.find(x => x.titulo === 'Idea de prueba <b>x</b>');
  ok(nueva && nueva.fase === 'idea' && nueva['fecha_' + plat] === fecha, 'La idea creada desde el día sin pieza no quedó con esa fecha: ' + JSON.stringify(nueva && [nueva.fase, nueva.fecha_ig, nueva.fecha_tt]));
  ok(nueva && (await db()).eventos.filter(e => e.pieza_id === nueva.id).map(e => e.tipo).join() === 'idea,fechas', 'La idea nueva no dejó su historial (idea, fechas)');
  ok(await p.locator('main b:text-is("x")').count() === 0, 'El nombre de la idea se pintó como código');
  // como quien edita: mismo inicio, sin errores ni desbordes
  const ids = await p.$$eval('[data-act="demo-rol"]', bs => bs.map(x => x.dataset.id));
  await p.goto(BASE + '/contenido/#/'); await p.waitForTimeout(300);
  await p.locator('[data-act="demo-rol"][data-id="' + ids[1] + '"]').first().click(); await p.waitForTimeout(500);
  const t2 = await p.locator('main').innerText();
  ok(t2.includes('Hoy se publica') && t2.includes('Videos pendientes'), 'Quien edita no ve el inicio nuevo');
  const w = await p.evaluate(() => Math.max(document.documentElement.scrollWidth, ...[...document.querySelectorAll('.desliza, #app')].map(e => e.scrollWidth)));
  ok(w <= 361, 'El inicio se sale de la pantalla (' + w + ' px)');
  await b.close();
  if (fallas.length) { console.error('FALLAS (' + fallas.length + '):\n- ' + fallas.join('\n- ')); process.exit(1); }
  console.log('OK: inicio nuevo de Contenido, tablero sin publicadas, Métricas en Ajustes y planificar en un paso.');
})();
