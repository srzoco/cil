/* Armador: lo nuevo de Yobel no se crea solo; queda en «Nuevos por aprobar» con el motivo, y gerencia decide:
   agregar, juntar con el viejo (cambio de nombre) o no agregar (no vuelve). El CSV manual tampoco crea productos.
   Uso: python3 -m http.server 8765 y luego: node pruebas/armador-cola.js */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
(async () => {
  const fallas = [];
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: 360, height: 800 } });
  p.on('pageerror', e => fallas.push('JS: ' + e.message));
  p.on('dialog', d => d.accept());
  let datos = { ajustes: {}, productos: [
    { id: 'vainilla', nombre: 'Vaina vainilla Madagascar', categoria: 'Especias', emoji: '🌿', ficha: 'Origen Madagascar', presentaciones: [{ texto: '', precio: 0.5, medida: 'g', ref: 'Vaina vainilla Madagascar|||||', stock: 10, sin_actualizar: '2026-11-09T12:00:00Z' }] },
    { id: 'jamon', nombre: 'Jamón serrano', categoria: 'Charcutería', presentaciones: [{ texto: 'loncheado', precio: 30, medida: 'kg', kilo: true, ref: 'Jamón serrano|||||', stock: 4 }] } ],
    nuevos: [
      { ref: 'Vaina de vainilla Madagascar|||||', producto: 'Vaina de vainilla Madagascar', categoria: 'Especias', precio: 0.55, stock: 40 },
      { ref: 'Aceite de oliva Jaén|||1L||', producto: 'Aceite de oliva Jaén', categoria: 'Grasas', precio: 12, stock: 6 },
      { ref: 'Cosa rara|||||', producto: 'Cosa rara', categoria: '', precio: 3, stock: 0 } ] };
  let guardado = null;
  await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.BARQUERO_CONFIG={supabaseUrl:"http://sb.test",supabaseKey:"k"};' }));
  await p.route('http://sb.test/**', async r => {
    const u = r.request().url();
    if (u.includes('armador_datos')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ datos, editado_en: '2026-11-09T00:00:00Z' }]) });
    if (u.includes('rpc/es_admin')) return r.fulfill({ contentType: 'application/json', body: 'true' });
    if (u.includes('rpc/guardar_armador')) { guardado = JSON.parse(r.request().postData()); datos = guardado.p_datos; return r.fulfill({ contentType: 'application/json', body: '"2026-11-09T13:00:00Z"' }); }
    return r.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"no"}' });
  });
  await p.route('**/mensajesBF/tasas.json*', r => r.fulfill({ contentType: 'application/json', body: '{"descuento":40}' }));
  await p.goto(BASE + '/mensajes/');
  await p.evaluate(() => localStorage.setItem('barquero_sesion', JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: Date.now() / 1000 + 3600, user: { id: 'u1' } })));
  await p.reload(); await p.waitForTimeout(1500);
  await p.click('#tab-catalogo'); await p.waitForTimeout(300);
  const txt = await p.locator('#cola').innerText().catch(() => '');
  if (!/Nuevos de Yobel por aprobar/.test(txt)) fallas.push('No sale la fila «Nuevos por aprobar»');
  if (!/Parece «Vaina vainilla Madagascar» con otro nombre/.test(txt)) fallas.push('Motivo del cambio de nombre: ' + txt);
  if (!/Producto nuevo en Yobel/.test(txt)) fallas.push('Motivo de producto nuevo: ' + txt);
  if (!/sin stock en Yobel/.test(txt)) fallas.push('No avisa «sin stock»');
  if (process.env.FOTOS) await p.locator('#cola').screenshot({ path: process.env.FOTOS + '/cola.png' });
  // 1) cambio de nombre: «Es el mismo: juntar»
  await p.locator('.cola-item', { hasText: 'Vaina de vainilla Madagascar' }).locator('[data-cola="mismo-sug"]').click(); await p.waitForTimeout(900);
  let v = guardado && guardado.p_datos.productos.find(x => x.id === 'vainilla');
  if (!v || v.nombre !== 'Vaina de vainilla Madagascar' || v.ficha !== 'Origen Madagascar' || v.presentaciones[0].medida !== 'g' || v.presentaciones[0].ref !== 'Vaina de vainilla Madagascar|||||') fallas.push('No juntó bien: ' + JSON.stringify(v));
  if (guardado && guardado.p_datos.nuevos.some(f => f.producto.startsWith('Vaina'))) fallas.push('El juntado sigue en la fila');
  // 2) producto nuevo de verdad: «Agregar»
  await p.locator('.cola-item', { hasText: 'Aceite de oliva Jaén' }).locator('[data-cola="agregar"]').click(); await p.waitForTimeout(900);
  const a = guardado.p_datos.productos.find(x => x.nombre === 'Aceite de oliva Jaén');
  if (!a || a.presentaciones[0].precio !== 12 || a.presentaciones[0].ref !== 'Aceite de oliva Jaén|||1L||' || a.presentaciones[0].texto !== '1L') fallas.push('No agregó bien: ' + JSON.stringify(a));
  // 3) «No agregar»: no vuelve
  await p.locator('.cola-item', { hasText: 'Cosa rara' }).locator('[data-cola="no"]').click(); await p.waitForTimeout(900);
  if (!(guardado.p_datos.descartados || []).includes('Cosa rara|||||') || guardado.p_datos.productos.some(x => x.nombre === 'Cosa rara')) fallas.push('No descartó');
  if (guardado.p_datos.nuevos.length) fallas.push('La fila no quedó vacía: ' + JSON.stringify(guardado.p_datos.nuevos));
  if (!(await p.locator('#cola').isHidden())) fallas.push('La fila vacía sigue a la vista');
  // 4) el CSV manual no crea productos: los nuevos van a la fila (y lo descartado no vuelve)
  const csv = 'Producto,Categoría,Precio,Stock\nJamón serrano,Charcutería,31,4\nQueso nuevo,Quesos,9,3\nCosa rara,,3,1\n';
  await p.setInputFiles('#csv', { name: 'yobel.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }); await p.waitForTimeout(400);
  await p.click('#imp-ok'); await p.waitForTimeout(1000);
  if (guardado.p_datos.productos.some(x => x.nombre === 'Queso nuevo')) fallas.push('El CSV creó un producto sin aprobación');
  const q = guardado.p_datos.nuevos.map(f => f.producto).join(',');
  if (q !== 'Queso nuevo') fallas.push('La fila después del CSV: ' + q);
  const w = await p.evaluate(() => document.documentElement.scrollWidth); if (w > 361) fallas.push('Se sale de la pantalla: ' + w);
  await b.close();
  if (fallas.length) { console.error('FALLAS (' + fallas.length + '):\n- ' + fallas.join('\n- ')); process.exit(1); }
  console.log('OK: nuevos de Yobel en la fila de aprobar (motivo, juntar, agregar, descartar; el CSV tampoco crea).');
})();
