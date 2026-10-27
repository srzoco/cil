/* Contenido (dentro de CIL) en modo demo a 320, 375 y 430 px: cada pantalla como quien aprueba y como quien edita.
   Falla si hay errores de JavaScript, si algo se sale de la pantalla o si la barra de abajo no queda pegada abajo. */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
const RUTAS = ['#/', '#/tablero', '#/nueva', '#/nueva?modo=idea', '#/nueva?modo=grabar', '#/calendario', '#/metricas', '#/ajustes', '#/revisar'];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const fallas = new Set();
  for (const w of [320, 375, 430]) {
    const p = await b.newPage({ viewport: { width: w, height: 720 } });
    let donde = '';
    p.on('pageerror', e => fallas.add('JS en ' + donde + ': ' + e.message));
    await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.BARQUERO_CONFIG={};' }));
    await p.goto(BASE + '/contenido/'); await p.waitForTimeout(800);
    await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(900);
    const quienes = await p.$$eval('[data-act="demo-rol"]', bs => bs.map(x => x.dataset.id));
    for (const q of quienes) {
      await p.locator('[data-act="demo-rol"][data-id="' + q + '"]').first().click(); await p.waitForTimeout(400);
      for (const r of RUTAS) {
        donde = w + ' px ' + r;
        await p.goto(BASE + '/contenido/' + r); await p.waitForTimeout(350);
        const m = await p.evaluate(() => {
          const t = document.querySelector('.tabs');
          return { w: Math.max(document.documentElement.scrollWidth, ...[...document.querySelectorAll('.desliza, #app')].map(e => e.scrollWidth)),
                   barra: t ? Math.round(t.getBoundingClientRect().bottom) - innerHeight : 0 };
        });
        if (m.w > w + 1) fallas.add('Se sale de la pantalla (' + m.w + ' px) en ' + donde);
        if (Math.abs(m.barra) > 1) fallas.add('La barra de abajo no está pegada abajo en ' + donde);
      }
    }
    await p.close();
  }
  await b.close();
  if (fallas.size) { console.error('FALLAS (' + fallas.size + '):\n- ' + [...fallas].join('\n- ')); process.exit(1); }
  console.log('OK: Contenido en 3 tamaños de pantalla, cada pantalla y cada papel, sin errores.');
})();
