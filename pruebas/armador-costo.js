/* Armador → «A costo»: cotizador para vender a gerencia. Solo aparece si la base de datos deja cotizar (gerencia o acceso «costos»);
   kilos y unidades, total con costo promedio + margen, sin copiar mensaje; los costos del archivo de Yobel van aparte (costos_subir)
   y nunca al catálogo. Uso: python3 -m http.server 8765 y luego: node pruebas/armador-costo.js */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
(async () => {
  const fallas = [];
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const datos = { ajustes: {}, productos: [
    { id: 'j1', nombre: 'Jamón serrano', categoria: 'Charcutería', presentaciones: [{ texto: 'loncheado', precio: 30, kilo: true, medida: 'kg', ref: 'Jamón serrano|||||' }] },
    { id: 'q1', nombre: 'Queso brie', categoria: 'Quesos', presentaciones: [{ texto: '200 g', precio: 9, ref: 'Queso brie|||200 g||' }] },
    { id: 's1', nombre: 'Otro producto', categoria: 'Otros', presentaciones: [{ texto: 'x', precio: 5, ref: 'Otro producto|||||' }] } ] };
  const costos = [{ ref: 'Jamón serrano|||||', costo: 20, unidad: 'kg', actualizado: '2026-11-07T13:00:00Z' }, { ref: 'Queso brie|||200 g||', costo: 5, unidad: 'und', actualizado: '2026-11-07T13:00:00Z' }];
  const abrir = async (rol) => {
    const p = await b.newPage({ viewport: { width: 360, height: 760 } });
    p.on('pageerror', e => fallas.push('JS (' + rol + '): ' + e.message));
    const llamadas = { subir: null, guardar: null };
    await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.BARQUERO_CONFIG={supabaseUrl:"http://sb.test",supabaseKey:"k"};' }));
    await p.route('http://sb.test/**', async r => {
      const u = r.request().url();
      if (u.includes('armador_datos')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ datos, editado_en: '2026-11-07T00:00:00Z' }]) });
      if (u.includes('rpc/es_admin')) return r.fulfill({ contentType: 'application/json', body: rol === 'gerencia' ? 'true' : 'false' });
      if (u.includes('rpc/costos_cotizar')) return rol === 'sin' ? r.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"Sin acceso a costos."}' })
        : r.fulfill({ contentType: 'application/json', body: JSON.stringify({ margen: 1, costos }) });
      if (u.includes('rpc/costos_subir')) { llamadas.subir = JSON.parse(r.request().postData()); return r.fulfill({ contentType: 'application/json', body: '2' }); }
      if (u.includes('rpc/guardar_armador')) { llamadas.guardar = JSON.parse(r.request().postData()); return r.fulfill({ contentType: 'application/json', body: '"2026-11-07T14:00:00Z"' }); }
      return r.fulfill({ status: 204, body: '' });
    });
    await p.route('**/mensajesBF/tasas.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ descuento: 40, actualizado: new Date().toISOString() }) }));
    await p.goto(BASE + '/mensajes/');
    await p.evaluate(() => localStorage.setItem('barquero_sesion', JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: Date.now() / 1000 + 3600, user: { id: 'u1' } })));
    await p.reload(); await p.waitForTimeout(1500);
    return { p, llamadas };
  };
  // 1. sin acceso: no hay pestaña
  { const { p } = await abrir('sin'); if (await p.locator('#tab-costo').isVisible()) fallas.push('Sin acceso ve la pestaña «A costo»'); await p.close(); }
  // 2. Adolfo: cotiza con kilos y unidades
  { const { p } = await abrir('adolfo');
    if (!(await p.locator('#tab-costo').isVisible())) fallas.push('Adolfo no ve «A costo»');
    await p.click('#tab-costo'); await p.waitForTimeout(300);
    const txt = await p.locator('#klist').innerText();
    if (/Otro producto/.test(txt)) fallas.push('Muestra un producto sin costo');
    if (!/\$20\.2 el kilo/.test(txt) || !/\$5\.05 c\/u/.test(txt)) fallas.push('No aplica costo + 1 %: ' + txt);
    await p.fill('input[data-kref="Jamón serrano|||||"]', '1.5');
    await p.fill('input[data-kref="Queso brie|||200 g||"]', '2');
    const tot = await p.locator('#costo-total').innerText();
    if (!/\$40\.4\b/.test(tot)) fallas.push('Total mal (1,5 kg × 20,2 + 2 × 5,05 = 40,4): ' + tot);   // 30.3 + 10.1
    if (await p.locator('#view-costo button#copy, #view-costo [data-act="copy"]').count()) fallas.push('El cotizador tiene botón de copiar');
    if (await p.evaluate(() => Object.keys(localStorage).some(k => /costo/i.test(k) || /costo/i.test(localStorage.getItem(k) || '')))) fallas.push('Guardó costos en el teléfono');
    await p.click('#k-clear'); await p.waitForTimeout(200);
    if (!/\$0\b/.test(await p.locator('#costo-total').innerText())) fallas.push('Limpiar no deja el total en 0');
    const w = await p.evaluate(() => document.documentElement.scrollWidth); if (w > 361) fallas.push('Se sale de la pantalla: ' + w);
    await p.close(); }
  // 3. gerencia sube el archivo de Yobel: los costos van a costos_subir, no al catálogo
  { const { p, llamadas } = await abrir('gerencia');
    await p.click('#tab-catalogo'); await p.waitForTimeout(300);
    const csv = 'Producto,Categoría,Presentación,Costo unitario,Costo promedio,Precio,Stock,Unidad,Estado\nJamón serrano,Charcutería,,19,20.5,31,4,kg,Activa\nQueso brie,Quesos,200 g,5,5.2,9,3,und,Activa\n';
    await p.setInputFiles('#csv', { name: 'yobel.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await p.waitForTimeout(400);
    await p.click('#imp-ok'); await p.waitForTimeout(1200);
    const s = llamadas.subir && llamadas.subir.p_filas;
    if (!s || s.length !== 2 || s[0].costo !== 20.5 || s[0].unidad !== 'kg') fallas.push('No subió los costos aparte: ' + JSON.stringify(llamadas.subir));
    if (!llamadas.guardar || /costo/i.test(JSON.stringify(llamadas.guardar.p_datos))) fallas.push('Los costos se colaron al catálogo público: ' + JSON.stringify(llamadas.guardar).slice(0, 200));
    await p.close(); }
  await b.close();
  if (fallas.length) { console.error('FALLAS (' + fallas.length + '):\n- ' + fallas.join('\n- ')); process.exit(1); }
  console.log('OK: cotizador a costo (solo con acceso, kilos y unidades, sin copiar; costos aparte del catálogo).');
})();
