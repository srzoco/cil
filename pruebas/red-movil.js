/* «Registrar esta red»: si la red es de datos móviles (ipinfo.io dice Digitel/Movistar/Movilnet), avisa antes de registrar.
   Uso: python3 -m http.server 8765 y luego: node pruebas/red-movil.js */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: 360, height: 760 } });
  await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.BARQUERO_CONFIG={};' }));
  let org = 'AS8048 Digitel', pedidos = 0;
  await p.route('https://ipinfo.io/**', r => { pedidos++; r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ org }) }); });
  const fallas = [];
  p.on('pageerror', e => fallas.push('JS: ' + e.message));
  await p.goto(BASE + '/tareas/'); await p.waitForTimeout(800);
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  await p.goto(BASE + '/tareas/#/equipo/locales'); await p.waitForTimeout(800);
  const boton = 'button[data-acc="registrar-red"]';
  const n0 = await p.$$eval(boton, x => x.length);
  const ids = () => p.$$eval(boton, x => x.map(e => e.dataset.id).join(','));
  const id0 = await ids();
  if (!n0) fallas.push('No hay botón «Registrar esta red»');
  // 1) Digitel: sale el aviso; al cancelar no se registra
  await p.click(boton); await p.waitForTimeout(600);
  const txt = await p.textContent('.hoja').catch(() => '');
  if (!/datos móviles \(Digitel\)/.test(txt || '')) fallas.push('No avisó de datos móviles: ' + txt);
  await p.click('.hoja button[data-acc="cerrar"].btn'); await p.waitForTimeout(400);
  if ((await ids()) !== id0) fallas.push('Registró la red al cancelar');
  // 2) Digitel y «Registrar igual»: se registra
  await p.click(boton); await p.waitForTimeout(600);
  await p.click('button[data-acc="confirmar-si"]'); await p.waitForTimeout(800);
  if ((await ids()) === id0) fallas.push('No registró con «Registrar igual»');
  // 3) Netuno: se registra sin preguntar
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  org = 'AS11562 Net Uno, C.A.';
  await p.click(boton); await p.waitForTimeout(800);
  if (await p.$('.modal')) fallas.push('Preguntó con una red de Netuno');
  if ((await ids()) === id0) fallas.push('No registró la red de Netuno');
  if (pedidos < 3) fallas.push('No consultó la compañía (' + pedidos + ')');
  // 4) ipinfo no responde: registra sin avisar
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  await p.unroute('https://ipinfo.io/**'); await p.route('https://ipinfo.io/**', r => r.abort());
  await p.click(boton); await p.waitForTimeout(800);
  if ((await ids()) === id0) fallas.push('Sin ipinfo no registró');
  await b.close();
  if (fallas.length) { console.log(fallas.join('\n')); process.exit(1); }
  console.log('OK: aviso de datos móviles al registrar la red');
})();
