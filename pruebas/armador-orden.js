/* Armador: orden del mensaje (13/11/2026, pedido de Sara). Primero SIEMPRE lo más caro; cada marca junta (lo que va después
   del último « - » del nombre), sin intercalar, aunque se toquen en desorden. Uso: python3 -m http.server 8765 y node pruebas/armador-orden.js */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
(async () => {
  const fallas = [];
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: 360, height: 800 } });
  p.on('pageerror', e => fallas.push('JS: ' + e.message));
  const pr = (precio, texto) => ({ texto, precio, medida: 'kg', kilo: true });
  const datos = { ajustes: {}, productos: [
    { id: 'a1', nombre: 'Queso tipo Manchego Semicurado 1/4 torta - Adarga de Oro', categoria: 'Quesos', emoji: '🧀', presentaciones: [pr(76, '')] },
    { id: 'm1', nombre: 'Queso Manchego con DOP 1/4 Torta - Mancha Real', categoria: 'Quesos', emoji: '🧀', presentaciones: [pr(100, '')] },
    { id: 'a2', nombre: 'Queso tipo Manchego con trufa 1/4 torta - Adarga de Oro', categoria: 'Quesos', emoji: '🧀', presentaciones: [pr(122.5, '')] },
    { id: 'm2', nombre: 'Queso Manchego con DOP 3 Kg - Mancha Real', categoria: 'Quesos', emoji: '🧀', presentaciones: [pr(90, 'la pieza'), pr(105, 'en cuñas')] },
    { id: 's1', nombre: 'Queso de cabra', categoria: 'Quesos', emoji: '🧀', presentaciones: [pr(50, '')] } ] };
  await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.BARQUERO_CONFIG={supabaseUrl:"http://sb.test",supabaseKey:"k"};' }));
  await p.route('http://sb.test/**', async r => {
    const u = r.request().url();
    if (u.includes('armador_datos')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ datos, actualizado_en: '2026-11-13T12:00:00Z', editado_en: '2026-11-13T00:00:00Z' }]) });
    return r.fulfill({ status: 204, body: '' });
  });
  await p.route('**/mensajesBF/tasas.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ descuento: 0, actualizado: new Date().toISOString(), fecha: new Date(Date.now() - 4 * 36e5).toISOString().slice(0, 10) }) }));
  await p.goto(BASE + '/mensajes/'); await p.waitForTimeout(1500);
  // se tocan intercalados: Adarga, Mancha, sin marca, Adarga, Mancha
  for (const id of ['a1', 'm1', 's1', 'a2', 'm2']) await p.locator('.prod[data-id="' + id + '"]').click();
  // las dos presentaciones de m2
  const chips = p.locator('.sitem[data-id="m2"] .vchip');
  for (let i = 0; i < await chips.count(); i++) if ((await chips.nth(i).getAttribute('aria-pressed')) !== 'true') await chips.nth(i).click();
  const msg = await p.locator('#msg').inputValue();
  const orden = ['trufa', 'Semicurado 1/4', 'DOP 3 Kg', 'DOP 1/4', 'cabra'].map(t => msg.indexOf(t));
  if (orden.some(x => x < 0) || orden.some((x, i) => i && x < orden[i - 1])) fallas.push('Orden de productos: ' + JSON.stringify(orden) + '\n' + msg);
  if (msg.indexOf('en cuñas') > msg.indexOf('la pieza')) fallas.push('Dentro del producto no va primero lo más caro');
  const precios = (msg.match(/\$\s?[\d.,]+/g) || []);
  if (!/122/.test(precios[0] || '')) fallas.push('El primer precio no es el más caro: ' + precios.join(' '));
  await b.close();
  if (fallas.length) { console.log('FALLAS:\n- ' + fallas.join('\n- ')); process.exit(1); }
  console.log('OK: el mensaje empieza por lo más caro y cada marca va junta.');
})();
