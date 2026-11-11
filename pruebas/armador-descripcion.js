/* Armador: la columna «Descripcion» del CSV de Yobel llega al producto (la usa el bot vía ficha_producto).
   Si viene vacía no borra la que había; si varía por presentación, cada una lleva su nombre; los nuevos la traen al aprobarlos.
   Uso: python3 -m http.server 8765 y luego: node pruebas/armador-descripcion.js */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
(async () => {
  const fallas = [];
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: 360, height: 800 } });
  p.on('pageerror', e => fallas.push('JS: ' + e.message));
  p.on('dialog', d => d.accept());
  let datos = { ajustes: {}, productos: [
    { id: 'jamon', nombre: 'Jamón serrano', categoria: 'Charcutería', ficha: 'Curado 18 meses', presentaciones: [{ texto: '', precio: 30, medida: 'kg', kilo: true, ref: 'Jamón serrano|||||', stock: 4 }] },
    { id: 'fuet', nombre: 'Fuet', categoria: 'Charcutería', presentaciones: [
      { texto: 'Ajo', precio: 12, ref: 'Fuet|||Ajo||', stock: 3 }, { texto: 'Ibérico', precio: 12, ref: 'Fuet|||Ibérico||', stock: 3 }] },
    { id: 'queso', nombre: 'Queso brie', categoria: 'Quesos', descripcion: 'Queso francés cremoso.', presentaciones: [{ texto: '', precio: 13, ref: 'Queso brie|||||', stock: 2 }] } ],
    nuevos: [] };
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
  // Mismas columnas que la exportación real de Yobel
  const csv = 'Producto,Categoria,Descripcion,SKU,Color,Talla,Tamaño,Medida,Capacidad,Presentación,Material,Sabor,Modelo,Peso,Otros atributos,Costo unitario,Costo promedio,Precio,Stock,Unidad,Estado\n' +
    'Jamón serrano,Charcutería,"Jamón de cerdo blanco, curado en Teruel.",,,,,,,,,,,,,20,20,30,4,kg,Activa\n' +
    'Fuet,Charcutería,Embutido catalán con ajo.,,,,,,,,,Ajo,,,,4,4,12,3,,Activa\n' +
    'Fuet,Charcutería,Embutido de cerdo ibérico.,,,,,,,,,Ibérico,,,,4,4,12,3,,Activa\n' +
    'Queso brie,Quesos,,,,,,,,,,,,,,5,5,13,2,,Activa\n' +
    'Aceite nuevo,Grasas,Aceite de oliva virgen extra de Jaén.,,,,,,,,,,,,,5,5,20,6,,Activa\n';
  await p.setInputFiles('#csv', { name: 'catalogo.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }); await p.waitForTimeout(400);
  const inf = await p.locator('#report').innerText();
  if (!/Descripciones de Yobel .*\(2\)/.test(inf)) fallas.push('El informe no cuenta 2 descripciones: ' + inf);
  await p.click('#imp-ok'); await p.waitForTimeout(1000);
  const pr = id => guardado && guardado.p_datos.productos.find(x => x.id === id);
  if (!pr('jamon') || pr('jamon').descripcion !== 'Jamón de cerdo blanco, curado en Teruel.' || pr('jamon').ficha !== 'Curado 18 meses') fallas.push('Jamón: ' + JSON.stringify(pr('jamon')));
  if (!pr('fuet') || pr('fuet').descripcion !== 'Ajo: Embutido catalán con ajo.\n\nIbérico: Embutido de cerdo ibérico.') fallas.push('Fuet: ' + JSON.stringify(pr('fuet') && pr('fuet').descripcion));
  if (!pr('queso') || pr('queso').descripcion !== 'Queso francés cremoso.') fallas.push('Vacía en Yobel borró la descripción del queso');
  const n = guardado && guardado.p_datos.nuevos.find(f => f.producto === 'Aceite nuevo');
  if (!n || n.descripcion !== 'Aceite de oliva virgen extra de Jaén.') fallas.push('La fila de nuevos no trae la descripción: ' + JSON.stringify(n));
  // Al aprobar el nuevo, entra con su descripción
  await p.waitForTimeout(300);
  await p.locator('.cola-item', { hasText: 'Aceite nuevo' }).locator('[data-cola="agregar"]').click(); await p.waitForTimeout(900);
  const a = guardado.p_datos.productos.find(x => x.nombre === 'Aceite nuevo');
  if (!a || a.descripcion !== 'Aceite de oliva virgen extra de Jaén.') fallas.push('El nuevo no entró con descripción: ' + JSON.stringify(a));
  // El editor la muestra (solo lectura) y guardar no la borra
  await p.locator('.crow', { hasText: 'Jamón serrano' }).locator('[data-edit]').click(); await p.waitForTimeout(300);
  if (!(await p.locator('#f-desc-box').isVisible()) || !/curado en Teruel/.test(await p.locator('#f-desc').innerText())) fallas.push('El editor no muestra la descripción');
  await p.fill('#f-usos', 'Tapas'); await p.click('#ed-save'); await p.waitForTimeout(900);
  if (pr('jamon').descripcion !== 'Jamón de cerdo blanco, curado en Teruel.' || pr('jamon').usos !== 'Tapas') fallas.push('Guardar el producto perdió la descripción: ' + JSON.stringify(pr('jamon')));
  const w = await p.evaluate(() => document.documentElement.scrollWidth); if (w > 361) fallas.push('Se sale de la pantalla: ' + w);
  await b.close();
  if (fallas.length) { console.log('FALLAS:\n- ' + fallas.join('\n- ')); process.exit(1); }
  console.log('OK: la descripción de Yobel llega al armador (CSV, nuevos, editor) sin borrar la ficha');
})();
