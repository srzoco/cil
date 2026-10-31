/* Contenido: checklist antes de enviar (fase 1), aprobación sola con 5 seguidas sin correcciones (fase 2),
   revisión después de publicar para gerencia y corrector del copy (LanguageTool simulado). Modo demo, 375 px. */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: 375, height: 760 } });
  const fallas = [];
  p.on('pageerror', e => fallas.push('JS: ' + e.message));
  await p.addInitScript(() => { Math.random = () => 0.1; });  // el sorteo de «revisar después» siempre sale
  await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.BARQUERO_CONFIG={};' }));
  await p.route('https://api.languagetool.org/**', r => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ matches: [{ offset: 0, length: 7, message: 'Posible error ortográfico.', replacements: [{ value: 'Prueba' }] }] }) }));
  await p.goto(BASE + '/contenido/'); await p.waitForTimeout(800);
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(900);
  const ids = await p.$$eval('[data-act="demo-rol"]', bs => bs.map(x => x.dataset.id));
  const edi = ids.find(x => /veronica/.test(x)), sara = ids.find(x => /sara/.test(x));
  const como = async (id) => { await p.locator('[data-act="demo-rol"][data-id="' + id + '"]').first().click(); await p.waitForTimeout(400); };
  // dos reels por editar
  const piezas = await p.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('bfcontenido_demo_v2'));
    const r = db.piezas.filter(x => x.fase === 'produccion' && x.turno === 'edita' && x.tipo === 'reel');
    // el segundo, como si fuera nuevo (sin correcciones previas)
    return r.slice(0, 2).map(x => x.id);
  });
  if (piezas.length < 2) {
    await p.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('bfcontenido_demo_v2'));
      const base = db.piezas.find(x => x.tipo === 'reel');
      for (let i = 0; i < 2; i++) db.piezas.push(Object.assign({}, base, { id: 'prueba-' + i, titulo: 'Reel de prueba ' + i, fase: 'produccion', etapa: 'video', turno: 'edita', version: 0, revisar_despues: false, publicado_ig_en: null, publicado_tt_en: null }));
      localStorage.setItem('bfcontenido_demo_v2', JSON.stringify(db));
    });
    await p.reload(); await p.waitForTimeout(800);
  }
  const lista = await p.evaluate(() => JSON.parse(localStorage.getItem('bfcontenido_demo_v2')).piezas.filter(x => x.fase === 'produccion' && x.turno === 'edita' && x.tipo === 'reel').map(x => x.id));
  const [p1, p2] = lista;
  await como(edi);
  const enviar = async (id, todo) => {
    await p.goto(BASE + '/contenido/#/p/' + id); await p.waitForTimeout(500);
    const f = p.locator('form[data-form="enviar"]');
    if (!(await f.count())) { fallas.push('No sale el formulario de envío'); return; }
    if (todo) await f.locator('[name="chk"]').evaluateAll(cs => cs.forEach(c => { c.checked = true; }));
    await f.locator('[name="enlace"]').fill('https://www.capcut.com/s/prueba');
    for (const t of await f.locator('textarea[name^="copy_"]').all()) await t.fill('Pruebaa este Queso manchego curado');
    await f.evaluate(x => x.querySelectorAll('[required]').forEach(e => e.removeAttribute('required')));  // que llegue a la validación de la app
    await f.locator('button[type="submit"]').click(); await p.waitForTimeout(600);
  };
  // 1) sin la checklist no se envía
  await enviar(p1, false);
  const t1 = await p.evaluate(() => (document.querySelector('#capa-toast') || {}).textContent || '');
  if (!/Falta marcar/.test(t1)) fallas.push('Sin la checklist debería decir «Falta marcar»: ' + t1);
  // 2) corrector: marca el error y lo arregla con un toque
  await p.locator('[data-act="ortografia"]').first().click(); await p.waitForTimeout(500);
  if (!(await p.locator('.corr-mal').count())) fallas.push('El corrector no mostró el error');
  await p.locator('[data-act="aplicar-corr"]').first().click(); await p.waitForTimeout(500);
  const v = await p.locator('textarea[name^="copy_"]').first().inputValue();
  if (!/^Prueba /.test(v)) fallas.push('No aplicó la corrección: ' + v);
  // 3) con la checklist se envía (racha < 5: espera aprobación)
  await enviar(p1, true);
  let est = await p.evaluate(id => JSON.parse(localStorage.getItem('bfcontenido_demo_v2')).piezas.find(x => x.id === id), p1);
  if (est.turno !== 'aprueba') fallas.push('Con la checklist completa no se envió: ' + est.turno);
  // 4) racha de 5 aprobaciones seguidas → la siguiente se aprueba sola y le sale a gerencia para revisar
  await p.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('bfcontenido_demo_v2'));
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) db.eventos.push({ id: 'r' + i, pieza_id: db.piezas[0].id, autor: 'demo-sara', tipo: 'aprobacion', etapa: 'video', version: 1, texto: null, datos: {}, creado_en: new Date(t0 + i).toISOString() });
    localStorage.setItem('bfcontenido_demo_v2', JSON.stringify(db));
  });
  await p.reload(); await p.waitForTimeout(700);
  await enviar(p2, true);
  est = await p.evaluate(id => JSON.parse(localStorage.getItem('bfcontenido_demo_v2')).piezas.find(x => x.id === id), p2);
  if (est.fase !== 'aprobada' || !est.revisar_despues) fallas.push('Con 5 seguidas debió aprobarse sola y quedar para revisar: ' + est.fase + ' ' + est.revisar_despues);
  // 5) gerencia la ve en «Te toca hoy» y la marca «Quedó bien»
  await como(sara);
  await p.goto(BASE + '/contenido/#/'); await p.waitForTimeout(500);
  if (!(await p.getByText('Revisar después de publicar').count())) fallas.push('No sale «Revisar después de publicar» en el inicio de gerencia');
  await p.goto(BASE + '/contenido/#/p/' + p2); await p.waitForTimeout(500);
  await p.locator('[data-act="despues-bien"]').click(); await p.waitForTimeout(600);
  est = await p.evaluate(id => JSON.parse(localStorage.getItem('bfcontenido_demo_v2')).piezas.find(x => x.id === id), p2);
  if (est.revisar_despues) fallas.push('«Quedó bien» no quitó la revisión pendiente');
  await b.close();
  if (fallas.length) { console.error('FALLAS:\n- ' + fallas.join('\n- ')); process.exit(1); }
  console.log('OK: checklist, corrector, aprobación sola y revisión después de publicar.');
})();
