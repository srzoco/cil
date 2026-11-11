/* Contenido, revisar más rápido (11/11/2026): al volver de ver el video dice «Ya lo viste», la fila de revisión no se pierde
   si el teléfono recarga la app, «Tus frecuentes» al corregir y «012» se vuelve «0:12».
   Uso: python3 -m http.server 8765 y luego: node pruebas/contenido-revisar.js */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
(async () => {
  const fallas = []; const ok = (c, m) => { if (!c) fallas.push(m); };
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const ctx = await b.newContext({ viewport: { width: 360, height: 740 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => fallas.push('JS: ' + e.message));
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.BARQUERO_CONFIG={};' }));
  await ctx.route('https://capcut.test/**', r => r.fulfill({ contentType: 'text/html', body: '<p>video</p>' }));
  await p.goto(BASE + '/contenido/'); await p.waitForTimeout(600); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(900);
  // datos: dos piezas por aprobar con enlace, y correcciones viejas que se repiten
  await p.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('bfcontenido_demo_v2'));
    const apr = db.piezas.filter(x => x.fase === 'produccion' && x.turno === 'aprueba');
    apr.forEach((x, i) => { x.enlace_version = 'https://capcut.test/v' + i; x.etapa = 'video'; x.tipo = 'reel'; });
    const sara = db.equipo.find(e => e.rol === 'aprueba').user_id;
    for (let i = 0; i < 3; i++) db.eventos.push({ id: 'ev' + i, pieza_id: apr[0].id, autor: sara, tipo: 'correccion', etapa: 'video', version: 1, texto: 'Sube la voz', datos: { chips: [], puntos: [{ ubicacion: '0:05', texto: 'Quita la pausa del inicio' }] }, creado_en: new Date(Date.now() - (i + 1) * 864e5).toISOString() });
    localStorage.setItem('bfcontenido_demo_v2', JSON.stringify(db));
  });
  await p.reload(); await p.waitForTimeout(800);
  const n = await p.evaluate(() => JSON.parse(localStorage.getItem('bfcontenido_demo_v2')).piezas.filter(x => x.fase === 'produccion' && x.turno === 'aprueba').length);
  ok(n >= 2, 'la demo debía tener al menos 2 piezas por aprobar');
  await p.goto(BASE + '/contenido/#/revisar'); await p.waitForTimeout(600);
  // pasar a la segunda pieza («Saltar») y abrir el video
  await p.locator('[data-act="saltar"]').click(); await p.waitForTimeout(300);
  const titulo2 = await p.locator('.rev-titulo').innerText();
  const [pop] = await Promise.all([ctx.waitForEvent('page'), p.locator('[data-act="ver-video"]').click()]);
  await pop.close();
  // al volver (el teléfono a veces recarga la app): sigue en la misma pieza y dice «Ya lo viste»
  await p.reload(); await p.waitForTimeout(900);
  ok((await p.locator('.rev-titulo').innerText()) === titulo2, 'al recargar la app volvió al principio de la fila');
  ok(/Ya lo viste/.test(await p.locator('.revision').innerText()), 'no dice «Ya lo viste» después de abrir el video');
  ok(/Ver otra vez/.test(await p.locator('[data-act="ver-video"]').innerText()), 'el botón no cambió a «Ver otra vez»');
  // corregir: «Tus frecuentes» y el minuto rápido
  await p.goto(BASE + '/contenido/#/'); await p.waitForTimeout(300);
  await p.locator('[data-act="terminar-lote"]').first().click().catch(() => {});
  await p.goto(BASE + '/contenido/#/revisar'); await p.waitForTimeout(600);
  await p.locator('[data-act="abrir-corregir"]').click(); await p.waitForTimeout(200);
  const fr = await p.locator('.chips.frecuentes .chip').allInnerTexts();
  ok(fr.includes('Quita la pausa del inicio') && fr.includes('Sube la voz'), 'no salen «Tus frecuentes»: ' + JSON.stringify(fr));
  await p.locator('.chips.frecuentes .chip', { hasText: 'Sube la voz' }).click();
  await p.fill('.panel-corregir input.ubic', '012'); await p.locator('.panel-corregir input[name="punto"]').first().click();
  ok((await p.inputValue('.panel-corregir input.ubic')) === '0:12', '«012» no se convirtió en «0:12»');
  await p.fill('.panel-corregir input[name="punto"]', 'Corta antes');
  const tit = await p.locator('.rev-titulo').innerText();
  await p.locator('.panel-corregir button[type=submit]').click(); await p.waitForTimeout(700);
  const ev = await p.evaluate((t) => { const db = JSON.parse(localStorage.getItem('bfcontenido_demo_v2')); const pz = db.piezas.find(x => x.titulo === t); return db.eventos.filter(e => e.pieza_id === pz.id && e.tipo === 'correccion').pop(); }, tit);
  ok(ev && ev.datos.chips.includes('Sube la voz') && ev.datos.puntos.some(x => x.ubicacion === '0:12' && x.texto === 'Corta antes'), 'la corrección no guardó el frecuente o el minuto: ' + JSON.stringify(ev && ev.datos));
  const w = await p.evaluate(() => Math.max(document.documentElement.scrollWidth, ...[...document.querySelectorAll('.desliza, #app')].map(e => e.scrollWidth)));
  ok(w <= 361, 'se sale de la pantalla (' + w + ' px)');
  await b.close();
  if (fallas.length) { console.error('FALLAS (' + fallas.length + '):\n- ' + fallas.join('\n- ')); process.exit(1); }
  console.log('OK: revisar más rápido (ya lo viste, la fila no se pierde, tus frecuentes, minuto rápido).');
})();
