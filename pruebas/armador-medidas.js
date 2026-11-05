/* Armador: medida del precio (por gramo, por kilo, por litro…). El mensaje dice «$x el gramo», el editor guarda la medida
   y el CSV de Yobel no le quita la medida elegida a mano. Uso: python3 -m http.server 8765 y luego: node pruebas/armador-medidas.js */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
const fs = require('fs');
(async () => {
  const fallas = [];
  // 1. CSV: la medida a mano (gramo) se queda; los de kilo siguen lo que diga el archivo
  const html = fs.readFileSync(__dirname + '/../mensajes/index.html', 'utf8');
  const IMP = new Function(html.slice(html.indexOf('var BarqueroImport'), html.indexOf("if (typeof module !== 'undefined')")) + '; return BarqueroImport;')();
  const prods = [{ id: 'v', nombre: 'Vainilla', presentaciones: [{ texto: '', precio: 0.5, medida: 'g', kilo: false, ref: 'Vainilla|||||' }] }];
  const r = IMP.importCSV('Producto,Precio,Stock\nVainilla,0.6,100\n', prods, '2026-11-05T00:00:00Z');
  const v = r.productos.find(p => p.id === 'v').presentaciones[0];
  if (v.medida !== 'g' || v.precio !== 0.6) fallas.push('CSV: perdió la medida por gramo o no actualizó el precio: ' + JSON.stringify(v));

  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: 360, height: 800 } });
  p.on('pageerror', e => fallas.push('JS: ' + e.message));
  let datos = { ajustes: {}, productos: [
    { id: 'v1', nombre: 'Vainilla en rama', categoria: 'Especias', emoji: '🌿', presentaciones: [{ texto: '', precio: 0.5, medida: 'g', kilo: false }] },
    { id: 'j1', nombre: 'Jamón serrano', categoria: 'Charcutería', emoji: '🍖', presentaciones: [{ texto: 'loncheado', precio: 30, kilo: true }] } ] };
  let guardado = null;
  await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.BARQUERO_CONFIG={supabaseUrl:"http://sb.test",supabaseKey:"k"};' }));
  await p.route('http://sb.test/**', async r => {
    const u = r.request().url();
    if (u.includes('armador_datos')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ datos, actualizado_en: '2026-11-05T12:00:00Z', editado_en: '2026-11-05T00:00:00Z' }]) });
    if (u.includes('rpc/es_admin')) return r.fulfill({ contentType: 'application/json', body: 'true' });
    if (u.includes('rpc/guardar_armador')) { guardado = JSON.parse(r.request().postData()); datos = guardado.p_datos; return r.fulfill({ contentType: 'application/json', body: '"2026-11-05T13:00:00Z"' }); }
    return r.fulfill({ status: 204, body: '' });
  });
  await p.route('**/mensajesBF/tasas.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ descuento: 40, actualizado: new Date().toISOString() }) }));
  await p.goto(BASE + '/mensajes/');
  await p.evaluate(() => localStorage.setItem('barquero_sesion', JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: Date.now() / 1000 + 3600, user: { id: 'u1' } })));
  await p.reload(); await p.waitForTimeout(1500);
  await p.locator('.prod[data-id="v1"]').click();
  await p.locator('.prod[data-id="j1"]').click();
  const msg = await p.locator('#msg').inputValue();
  if (!/el gramo/.test(msg)) fallas.push('El mensaje no dice «el gramo»: ' + msg);
  if (!/el kilo loncheado/.test(msg)) fallas.push('El jamón (dato viejo por kilo) ya no dice «el kilo»: ' + msg);
  // editor: cambiar el jamón a «por unidad» y guardar
  await p.locator('#tab-catalogo').click();
  if (!(await p.locator('#clist').innerText()).includes('/g web')) fallas.push('El catálogo no muestra «/g»');
  await p.locator('[data-edit="j1"]').click();
  const opciones = await p.locator('#v-medida-0 option').allInnerTexts();
  if (!opciones.includes('por gramo') || !opciones.includes('por litro')) fallas.push('Faltan medidas en el editor: ' + opciones.join(', '));
  if ((await p.locator('#v-medida-0').inputValue()) !== 'kg') fallas.push('El editor no reconoce el «por kilo» viejo');
  await p.locator('#v-medida-0').selectOption('u');
  await p.locator('#ed-save').click(); await p.waitForTimeout(800);
  const j = guardado && guardado.p_datos.productos.find(x => x.id === 'j1');
  if (!j || j.presentaciones[0].medida !== 'u' || j.presentaciones[0].kilo !== false) fallas.push('No guardó la medida: ' + JSON.stringify(j && j.presentaciones));
  const ancho = await p.evaluate(() => document.documentElement.scrollWidth); if (ancho > 361) fallas.push('Se sale de la pantalla: ' + ancho);
  await b.close();
  if (fallas.length) { console.error('FALLAS (' + fallas.length + '):\n- ' + fallas.join('\n- ')); process.exit(1); }
  console.log('OK: medidas del precio en el Armador (gramo, kilo viejo, editor y CSV).');
})();
