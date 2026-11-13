/* Contenido: el enlace de CapCut del PROYECTO (capcut.com/sv2/…) no se puede ver: Sara se queda en «Cargando proyecto».
   Verónica ve el aviso al pegarlo y no lo puede enviar; Sara ve el aviso en la ficha si ya llegó uno así (13/11/2026).
   Uso: python3 -m http.server 8765 y luego: node pruebas/contenido-enlace.js */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const L = require('../contenido/logic.js');
const BASE = process.env.BASE || 'http://localhost:8765';
(async () => {
  const fallas = []; const ok = (c, m) => { if (!c) fallas.push(m); };
  ok(L.enlaceProyecto('https://www.capcut.com/sv2/ZS9fx7GuLeGXb-5altg/'), 'no reconoce el enlace de proyecto');
  ok(!L.enlaceProyecto('https://www.capcut.com/s/abc'), 'marca como proyecto un enlace normal');
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: 360, height: 800 } });
  p.on('pageerror', e => fallas.push('JS: ' + e.message));
  await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.BARQUERO_CONFIG={};' }));
  await p.goto(BASE + '/contenido/'); await p.waitForTimeout(800);
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(900);
  const ids = await p.$$eval('[data-act="demo-rol"]', bs => bs.map(x => x.dataset.id));
  const edi = ids.find(x => /veronica/.test(x)), sara = ids.find(x => /sara/.test(x));
  const como = async (id) => { await p.locator('[data-act="demo-rol"][data-id="' + id + '"]').first().click(); await p.waitForTimeout(400); };
  const [pe, pa] = await p.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('bfcontenido_demo_v2'));
    const base = db.piezas.find(x => x.tipo === 'reel');
    db.piezas.push(Object.assign({}, base, { id: 'enl-1', titulo: 'Reel por editar', fase: 'produccion', etapa: 'video', turno: 'edita', version: 0, enlace_version: null, revisar_despues: false }));
    db.piezas.push(Object.assign({}, base, { id: 'enl-2', titulo: 'Reel por aprobar', fase: 'produccion', etapa: 'video', turno: 'aprueba', version: 1, enlace_version: 'https://www.capcut.com/sv2/ZS9fx7GuLeGXb-5altg/', revisar_despues: false }));
    localStorage.setItem('bfcontenido_demo_v2', JSON.stringify(db));
    return ['enl-1', 'enl-2'];
  });
  await p.reload(); await p.waitForTimeout(800);
  // Verónica pega el enlace del proyecto: sale el aviso y no se envía
  await como(edi);
  await p.goto(BASE + '/contenido/#/p/' + pe); await p.waitForTimeout(500);
  const f = p.locator('form[data-form="enviar"]');
  ok(await f.count(), 'no sale el formulario de envío');
  ok(await f.locator('[data-aviso-enlace]').isHidden(), 'el aviso sale antes de pegar nada');
  await f.locator('[name="enlace"]').fill('https://www.capcut.com/sv2/ZS9fx7GuLeGXb-5altg/');
  ok(await f.locator('[data-aviso-enlace]').isVisible(), 'no avisa al pegar el enlace del proyecto');
  await f.locator('[name="chk"]').evaluateAll(cs => cs.forEach(c => { c.checked = true; }));
  for (const t of await f.locator('textarea[name^="copy_"]').all()) await t.fill('Queso manchego curado');
  await f.evaluate(x => x.querySelectorAll('[required]').forEach(e => e.removeAttribute('required')));
  await f.locator('button[type="submit"]').click(); await p.waitForTimeout(600);
  let fase = await p.evaluate(id => JSON.parse(localStorage.getItem('bfcontenido_demo_v2')).piezas.find(x => x.id === id).turno, pe);
  ok(fase === 'edita', 'se envió con el enlace del proyecto');
  // con un enlace bueno el aviso se va y se envía
  await f.locator('[name="enlace"]').fill('https://www.capcut.com/s/revisar123');
  ok(await f.locator('[data-aviso-enlace]').isHidden(), 'el aviso no se quita con un enlace bueno');
  await f.locator('button[type="submit"]').click(); await p.waitForTimeout(800);
  fase = await p.evaluate(id => JSON.parse(localStorage.getItem('bfcontenido_demo_v2')).piezas.find(x => x.id === id), pe);
  ok(fase.turno === 'aprueba' || fase.fase === 'aprobada', 'no se envió con el enlace bueno: ' + fase.turno);
  // Sara abre una que llegó con el enlace del proyecto: ve el aviso
  await como(sara);
  await p.goto(BASE + '/contenido/#/p/' + pa); await p.waitForTimeout(600);
  ok(/Este enlace es del proyecto/.test(await p.locator('.archivo').first().innerText().catch(() => '')), 'Sara no ve el aviso en la ficha');
  const w = await p.evaluate(() => document.documentElement.scrollWidth); ok(w <= 361, 'se sale de la pantalla: ' + w);
  await b.close();
  if (fallas.length) { console.log('FALLAS:\n- ' + fallas.join('\n- ')); process.exit(1); }
  console.log('OK: el enlace del proyecto de CapCut avisa a Verónica, no se envía y Sara ve el aviso.');
})();
