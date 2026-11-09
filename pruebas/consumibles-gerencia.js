/* Consumibles: gerencia también aparece en «¿A quién?» al entregar (además del equipo del local). Modo demo, 360 px. */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
(async () => {
  const fallas = [];
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: 360, height: 760 } });
  p.on('pageerror', e => fallas.push('JS: ' + e.message));
  await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.BARQUERO_CONFIG={};' }));
  await p.goto(BASE + '/tareas/'); await p.waitForTimeout(800);
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  await p.goto(BASE + '/tareas/#/equipo/consumibles'); await p.waitForTimeout(500);
  const btn = p.locator('button[data-acc="entregar"]').first();
  if (!(await btn.count())) { fallas.push('No hay botón Entregar en Consumibles'); }
  else {
    await btn.click(); await p.waitForTimeout(400);
    const grupos = await p.locator('form[data-form="entregar"] optgroup').evaluateAll(gs => gs.map(g => g.label + ': ' + [...g.querySelectorAll('option')].map(o => o.textContent).join(', ')));
    const g = grupos.find(x => x.startsWith('Gerencia'));
    if (!g || !/Sara/.test(g)) fallas.push('Gerencia no aparece para recibir: ' + JSON.stringify(grupos));
    if (!grupos.some(x => x.startsWith('Equipo'))) fallas.push('Desapareció el equipo: ' + JSON.stringify(grupos));
    // entregar a alguien de gerencia
    const val = await p.locator('form[data-form="entregar"] optgroup[label="Gerencia"] option').first().getAttribute('value');
    await p.selectOption('form[data-form="entregar"] select[name="persona"]', val);
    await p.click('form[data-form="entregar"] button[type="submit"]'); await p.waitForTimeout(600);
    const t = await p.evaluate(() => (document.querySelector('.toast') || {}).textContent || '');
    if (!/Entrega anotada/.test(t)) fallas.push('No anotó la entrega a gerencia: ' + t);
  }
  // Un empleado pide; gerencia quita el pedido (sin entregar ni descontar)
  const emp = await p.$eval('select[data-cambio="demo-usuario"]', s => [...s.options].find(o => !/gerencia/.test(o.text)).value);
  const ger = await p.$eval('select[data-cambio="demo-usuario"]', s => [...s.options].find(o => /gerencia/.test(o.text)).value);
  await p.selectOption('select[data-cambio="demo-usuario"]', emp); await p.waitForTimeout(500);
  await p.goto(BASE + '/tareas/#/'); await p.waitForTimeout(400);
  const pedir = p.locator('button[data-acc="pedir"]').first();
  if (!(await pedir.count())) fallas.push('El empleado no tiene botón «Pedir»');
  else {
    await pedir.click(); await p.waitForTimeout(500);
    if (!(await p.locator('[data-acc="cancelar-pedido"]').count())) fallas.push('El pedido no quedó');
    if (!/pedido hoy, /i.test(await p.locator('.pedido').first().innerText())) fallas.push('El pedido no dice el día');
    await p.selectOption('select[data-cambio="demo-usuario"]', ger); await p.waitForTimeout(500);
    await p.goto(BASE + '/tareas/#/equipo/consumibles'); await p.waitForTimeout(500);
    const antes = await p.locator('[data-acc="quitar-pedido"]').count();
    if (!antes) fallas.push('Gerencia no ve el botón «Quitar»');
    else {
      if (!/Hoy, /.test(await p.locator('[data-acc="quitar-pedido"]').first().locator('xpath=ancestor::div[contains(@class,"item")]').innerText())) fallas.push('El pedido no dice «Hoy»');
      await p.locator('[data-acc="quitar-pedido"]').first().click(); await p.waitForTimeout(300);
      await p.click('button[data-acc="confirmar-si"]'); await p.waitForTimeout(600);
      if ((await p.locator('[data-acc="quitar-pedido"]').count()) !== antes - 1) fallas.push('No quitó el pedido');
    }
  }
  await b.close();
  if (fallas.length) { console.error('FALLAS (' + fallas.length + '):\n- ' + fallas.join('\n- ')); process.exit(1); }
  console.log('OK: consumibles se pueden entregar también a gerencia.');
})();
