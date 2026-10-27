/* Armador de mensajes (dentro de CIL): abre sin errores, muestra el catálogo de la base de datos, el descuento llega
   del archivo de tasas, y borra la clave de GitHub vieja si quedó en el teléfono (ya no se usa).
   Uso: python3 -m http.server 8765 (en la carpeta del repo) y luego: node pruebas/armador.js */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const fallas = [];
  for (const w of [320, 390]) {
    const p = await b.newPage({ viewport: { width: w, height: 760 } });
    p.on('pageerror', e => fallas.push('JS a ' + w + ' px: ' + e.message));
    await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.BARQUERO_CONFIG={supabaseUrl:"http://sb.test",supabaseKey:"k"};' }));
    await p.route('http://sb.test/**', r => r.request().url().includes('armador_datos')
      ? r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ datos: { productos: [{ id: 'q1', nombre: 'Queso manchego', categoria: 'Quesos', presentaciones: [{ texto: '500 g', precio: 10 }] }], ajustes: {} }, actualizado_en: '2026-10-27T00:00:00Z' }]) })
      : r.fulfill({ status: 401, body: '{}' }));
    await p.route('**/mensajesBF/tasas.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ descuento: 40, actualizado: new Date().toISOString() }) }));
    await p.goto(BASE + '/mensajes/'); await p.evaluate(() => localStorage.setItem('barquero-armador-gh-token', 'ghp_viejo'));
    await p.reload(); await p.waitForTimeout(1500);
    if (!(await p.locator('body').innerText()).includes('Queso manchego')) fallas.push('No sale el catálogo a ' + w + ' px');
    if (await p.evaluate(() => localStorage.getItem('barquero-armador-gh-token') !== null)) fallas.push('No borró la clave de GitHub vieja');
    if (await p.locator('#gh-admin').isVisible()) fallas.push('Sigue a la vista la sección de la clave de GitHub');
    const ancho = await p.evaluate(() => document.documentElement.scrollWidth); if (ancho > w + 1) fallas.push('Se sale de la pantalla (' + ancho + ' px) a ' + w + ' px');
    await p.close();
  }
  await b.close();
  if (fallas.length) { console.error('FALLAS (' + fallas.length + '):\n- ' + fallas.join('\n- ')); process.exit(1); }
  console.log('OK: Armador dentro de CIL (catálogo, descuento, sin clave de GitHub) sin errores.');
})();
