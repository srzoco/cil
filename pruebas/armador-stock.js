/* Armador: stock de Yobel, bajo pedido, ficha y usos, contador de uso e importación de CSV que no borra fichas.
   Uso: python3 -m http.server 8765 (en la carpeta del repo) y luego: node pruebas/armador-stock.js */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
const fs = require('fs');
(async () => {
  const fallas = [];
  // 1. Importación de CSV (lógica pura): lo que falta queda agotado y conserva la ficha; el stock se lee del CSV
  const html = fs.readFileSync(__dirname + '/../mensajes/index.html', 'utf8');
  const code = html.slice(html.indexOf('var BarqueroImport'), html.indexOf("if (typeof module !== 'undefined')"));
  const IMP = new Function(code + '; return BarqueroImport;')();
  const prods = [
    { id: 'a', nombre: 'Aceite', ficha: 'Acidez 0,2', usos: 'Ensaladas', presentaciones: [{ texto: '500 ml', precio: 10, ref: 'Aceite|||||' }] },
    { id: 'b', nombre: 'Bacalao', bajo_pedido: true, presentaciones: [{ texto: 'kg', precio: 20, ref: 'Bacalao|||||' }] },
    { id: 'c', nombre: 'Caviar', ficha: 'Beluga', presentaciones: [{ texto: '30 g', precio: 90, ref: 'Caviar|||||', stock: 4 }] },
  ];
  const r = IMP.importCSV('Producto,Precio,Stock\nAceite,12,7\n', prods, '2026-10-28T00:00:00Z');
  const a = r.productos.find(p => p.id === 'a'), b = r.productos.find(p => p.id === 'b'), c = r.productos.find(p => p.id === 'c');
  if (!a || a.ficha !== 'Acidez 0,2' || a.usos !== 'Ensaladas' || a.presentaciones[0].precio !== 12 || a.presentaciones[0].stock !== 7) fallas.push('CSV: no conservó ficha/usos o no leyó precio y stock');
  if (!c || c.ficha !== 'Beluga' || c.presentaciones[0].stock !== 4 || !c.presentaciones[0].sin_actualizar) fallas.push('CSV: borró el que falta, le cambió el stock o no lo marcó sin actualizar');
  if (!b || b.presentaciones[0].stock !== undefined || !b.presentaciones[0].sin_actualizar) fallas.push('CSV: bajo pedido que falta: ' + JSON.stringify(b));
  if (r.informe.eliminadas.length !== 2) fallas.push('CSV: informe de los que faltan = ' + r.informe.eliminadas.length);
  const r2 = IMP.importCSV('Producto,Precio,Stock\nAceite,12,7\nCaviar,90,2\n', r.productos);
  const c2 = r2.productos.find(p => p.id === 'c');
  if (c2.presentaciones[0].sin_actualizar || c2.presentaciones[0].stock !== 2) fallas.push('CSV: al volver a venir no quitó la marca «sin actualizar»');

  // 2. Página: etiquetas de stock, campos del editor y contador
  const b2 = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b2.newPage({ viewport: { width: 390, height: 800 } });
  p.on('pageerror', e => fallas.push('JS: ' + e.message));
  let datos = { robot: { fecha: new Date().toISOString(), filas: 3 }, ajustes: {}, productos: [
    { id: 'q1', nombre: 'Queso manchego', categoria: 'Quesos', emoji: '🧀', presentaciones: [{ texto: 'entero', precio: 30, ref: 'Q|e', stock: 0 }, { texto: 'medio', precio: 16, ref: 'Q|m', stock: 5 }] },
    { id: 't1', nombre: 'Tinta de calamar', categoria: 'Mariscos', emoji: '🦑', bajo_pedido: true, ficha: 'Origen España', presentaciones: [{ texto: '4 g', precio: 5, ref: 'T|', stock: 0 }] } ] };
  let guardado = null; const usos = [];
  await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.BARQUERO_CONFIG={supabaseUrl:"http://sb.test",supabaseKey:"k"};' }));
  await p.route('http://sb.test/**', async r => {
    const u = r.request().url();
    if (u.includes('armador_datos')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ datos, actualizado_en: '2026-10-28T12:00:00Z', editado_en: '2026-10-27T00:00:00Z' }]) });
    if (u.includes('rpc/es_admin')) return r.fulfill({ contentType: 'application/json', body: 'true' });
    if (u.includes('rpc/armador_usado')) { usos.push(JSON.parse(r.request().postData())); return r.fulfill({ status: 204, body: '' }); }
    if (u.includes('rpc/guardar_armador')) { guardado = JSON.parse(r.request().postData()); datos = guardado.p_datos; return r.fulfill({ contentType: 'application/json', body: '"2026-10-28T13:00:00Z"' }); }
    return r.fulfill({ status: 401, body: '{}' });
  });
  await p.route('**/mensajesBF/tasas.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ descuento: 40, actualizado: new Date().toISOString() }) }));
  await p.goto(BASE + '/mensajes/');
  await p.evaluate(() => localStorage.setItem('barquero_sesion', JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: Date.now() / 1000 + 3600, user: { id: 'u1' } })));
  await p.reload(); await p.waitForTimeout(1500);
  const txt = await p.locator('#plist').innerText();
  if (!txt.includes('Agotado')) fallas.push('No marca «Agotado» en la lista');
  if (!txt.includes('Bajo pedido')) fallas.push('No marca «Bajo pedido» en la lista');
  // al elegir el queso solo entra la presentación con stock
  await p.locator('.prod[data-id="q1"]').click();
  const msg = await p.locator('#msg').inputValue();
  if (msg.includes('entero') || !msg.includes('medio')) fallas.push('Al elegir, metió la presentación agotada: ' + msg);
  await p.locator('.prod[data-id="t1"]').click();
  if (!(await p.locator('#msg').inputValue()).includes('4 g')) fallas.push('No deja enviar el precio del producto bajo pedido sin stock');
  await p.locator('.prod[data-id="t1"]').click();
  await p.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await p.locator('#bar-open').click().catch(() => {});
  await p.locator('#copy').click(); await p.waitForTimeout(300);
  await p.locator('#copy').click(); await p.waitForTimeout(300);
  if (usos.length !== 1 || JSON.stringify(usos[0].p_ids) !== '["q1"]') fallas.push('Contador de uso: ' + JSON.stringify(usos));
  // catálogo: número de stock y edición de ficha/usos/bajo pedido sin perder el stock
  await p.locator('#tab-catalogo').click();
  const cat = await p.locator('#clist').innerText();
  if (!cat.includes('Stock 5')) fallas.push('El catálogo no muestra el stock');
  if (!(await p.locator('#cat-sub').innerText()).includes('Yobel')) fallas.push('No dice cuándo subió el robot');
  await p.locator('[data-edit="q1"]').click();
  await p.locator('#f-pedido').check();
  await p.locator('#f-ficha').fill('Curado 12 meses');
  await p.locator('#f-usos').fill('Tabla de quesos');
  await p.locator('#ed-save').click(); await p.waitForTimeout(800);
  const q = guardado && guardado.p_datos.productos.find(x => x.id === 'q1');
  if (!q) fallas.push('No guardó');
  else {
    if (q.ficha !== 'Curado 12 meses' || q.usos !== 'Tabla de quesos' || q.bajo_pedido !== true) fallas.push('No guardó ficha/usos/bajo pedido');
    if (q.presentaciones[1].stock !== 5 || q.presentaciones[0].ref !== 'Q|e') fallas.push('Al editar perdió el stock o la referencia');
    if (guardado.p_antes !== '2026-10-27T00:00:00Z') fallas.push('Usó la versión del robot y no la de gerencia: ' + guardado.p_antes);
    if (!guardado.p_datos.robot) fallas.push('Borró la fecha del robot');
  }
  const t = guardado && guardado.p_datos.productos.find(x => x.id === 't1');
  if (!t || t.ficha !== 'Origen España' || !t.bajo_pedido) fallas.push('Guardar un producto tocó la ficha de otro');
  const ancho = await p.evaluate(() => document.documentElement.scrollWidth); if (ancho > 391) fallas.push('Se sale de la pantalla: ' + ancho);
  await b2.close();
  if (fallas.length) { console.error('FALLAS (' + fallas.length + '):\n- ' + fallas.join('\n- ')); process.exit(1); }
  console.log('OK: Armador con stock, bajo pedido, ficha, usos, contador y CSV sin borrar fichas.');
})();
