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
  await b.close();
  if (fallas.length) { console.error('FALLAS (' + fallas.length + '):\n- ' + fallas.join('\n- ')); process.exit(1); }
  console.log('OK: consumibles se pueden entregar también a gerencia.');
})();
