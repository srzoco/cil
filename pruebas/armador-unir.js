/* Armador: «Es el mismo que…» junta un producto al que le cambiaron el nombre en Yobel (el viejo quedó «stock sin actualizar»)
   con el nuevo: queda el id, ficha, usos, medida y bajo pedido del viejo, con nombre, referencias, precio y stock del nuevo.
   Uso: python3 -m http.server 8765 y luego: node pruebas/armador-unir.js */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
(async () => {
  const fallas = [];
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: 360, height: 800 } });
  p.on('pageerror', e => fallas.push('JS: ' + e.message));
  let datos = { ajustes: {}, productos: [
    { id: 'vainilla', nombre: 'Vaina vainilla', categoria: 'Especias', emoji: '🌿', ficha: 'Origen Madagascar', usos: 'Postres', bajo_pedido: true, pregunta: '¿Cuántos gramos?',
      presentaciones: [{ texto: '', precio: 0.5, medida: 'g', kilo: false, ref: 'Vaina vainilla|||||', stock: 10, sin_actualizar: '2026-11-08T12:00:00Z' }, { texto: 'a mano', precio: 3, medida: '' }] },
    { id: 'vaina-de-vainilla-bourbon', nombre: 'Vaina de vainilla Bourbon', categoria: 'Especias', emoji: '🔹', presentaciones: [{ texto: '', precio: 0.55, kilo: false, ref: 'Vaina de vainilla Bourbon|||||', stock: 40 }] },
    { id: 'jamon', nombre: 'Jamón serrano', categoria: 'Charcutería', presentaciones: [{ texto: 'loncheado', precio: 30, medida: 'kg', kilo: true, ref: 'Jamón serrano|||||', stock: 4 }] } ] };
  let guardado = null;
  await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.BARQUERO_CONFIG={supabaseUrl:"http://sb.test",supabaseKey:"k"};' }));
  await p.route('http://sb.test/**', async r => {
    const u = r.request().url();
    if (u.includes('armador_datos')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ datos, editado_en: '2026-11-08T00:00:00Z' }]) });
    if (u.includes('rpc/es_admin')) return r.fulfill({ contentType: 'application/json', body: 'true' });
    if (u.includes('rpc/guardar_armador')) { guardado = JSON.parse(r.request().postData()); datos = guardado.p_datos; return r.fulfill({ contentType: 'application/json', body: '"2026-11-08T13:00:00Z"' }); }
    return r.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"no"}' });
  });
  await p.route('**/mensajesBF/tasas.json*', r => r.fulfill({ contentType: 'application/json', body: '{"descuento":40}' }));
  await p.goto(BASE + '/mensajes/');
  await p.evaluate(() => localStorage.setItem('barquero_sesion', JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: Date.now() / 1000 + 3600, user: { id: 'u1' } })));
  await p.reload(); await p.waitForTimeout(1500);
  await p.click('#tab-catalogo'); await p.waitForTimeout(300);
  // un producto sin «stock sin actualizar» no muestra la opción
  await p.locator('[data-edit="jamon"]').click(); await p.waitForTimeout(300);
  if (await p.locator('#unir-box').isVisible()) fallas.push('Ofrece juntar en un producto que está al día');
  await p.click('#ed-cancel'); await p.waitForTimeout(200);
  await p.locator('[data-edit="vainilla"]').click(); await p.waitForTimeout(300);
  if (!(await p.locator('#unir-box').isVisible())) fallas.push('No ofrece «Es el mismo que…» en el producto pausado');
  const ops = await p.locator('#unir-sel option').allInnerTexts();
  if (!/★ Vaina de vainilla Bourbon/.test(ops[1] || '')) fallas.push('No sugiere primero el parecido: ' + ops.join(' | '));
  await p.selectOption('#unir-sel', 'vaina-de-vainilla-bourbon');
  if (process.env.FOTOS) { await p.locator('#unir-box').scrollIntoViewIfNeeded(); await p.screenshot({ path: process.env.FOTOS + '/unir.png' }); }
  await p.click('#unir-ok'); await p.waitForTimeout(1000);
  const ps = guardado && guardado.p_datos.productos;
  if (!ps) fallas.push('No guardó');
  else {
    const j = ps.find(x => x.id === 'vainilla');
    if (ps.some(x => x.id === 'vaina-de-vainilla-bourbon')) fallas.push('El nuevo sigue repetido');
    if (!j) fallas.push('Se perdió el producto (y su contador de uso)');
    else {
      if (j.nombre !== 'Vaina de vainilla Bourbon') fallas.push('No tomó el nombre nuevo: ' + j.nombre);
      if (j.ficha !== 'Origen Madagascar' || j.usos !== 'Postres' || !j.bajo_pedido || j.emoji !== '🌿' || j.pregunta !== '¿Cuántos gramos?') fallas.push('Perdió ficha/usos/bajo pedido/emoji/pregunta: ' + JSON.stringify(j));
      const y = j.presentaciones.find(v => v.ref);
      if (!y || y.ref !== 'Vaina de vainilla Bourbon|||||' || y.precio !== 0.55 || y.stock !== 40 || y.sin_actualizar) fallas.push('No tomó referencia/precio/stock nuevos: ' + JSON.stringify(y));
      if (!y || y.medida !== 'g') fallas.push('Perdió la medida «por gramo»: ' + JSON.stringify(y));
      if (!j.presentaciones.some(v => !v.ref && v.texto === 'a mano')) fallas.push('Perdió la presentación agregada a mano');
      if (j.presentaciones.some(v => v.ref === 'Vaina vainilla|||||')) fallas.push('Quedó la referencia vieja');
    }
    if (!ps.some(x => x.id === 'jamon')) fallas.push('Tocó otro producto');
  }
  const w = await p.evaluate(() => document.documentElement.scrollWidth); if (w > 361) fallas.push('Se sale de la pantalla: ' + w);
  await b.close();
  if (fallas.length) { console.error('FALLAS (' + fallas.length + '):\n- ' + fallas.join('\n- ')); process.exit(1); }
  console.log('OK: «Es el mismo que…» junta el producto renombrado en Yobel sin perder ficha, usos, medida ni historial.');
})();
