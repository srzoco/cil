/* Contenido: el copy se escribe desde la ficha en cualquier estado, y el corrector no trata como error
   los nombres del catálogo ni las palabras marcadas «Es un nombre» (productos nuevos). Modo demo, 375 px. */
const L = require('../contenido/logic.js');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
const fallas = [];
const ok = (c, m) => { if (!c) fallas.push(m); };
// ---- Reglas ----
const idea = { id: 'x', tipo: 'reel', ig: true, tt: true, fase: 'idea', copy_ig: null, copy_tt: null };
const r1 = L.accionCopy(idea, { copy_ig: ' Hola IG ', copy_tt: '' });
ok(r1.patch.copy_ig === 'Hola IG' && !('copy_tt' in r1.patch), 'accionCopy guarda mal: ' + JSON.stringify(r1.patch));
ok(r1.eventos[0].tipo === 'editada' && /copy de Instagram/.test(r1.eventos[0].texto), 'no queda en el historial');
let lanzo = false; try { L.accionCopy(Object.assign({}, idea, { copy_ig: 'a' }), { copy_ig: 'a' }); } catch (e) { lanzo = true; }
ok(lanzo, 'sin cambios debería avisar');
ok(L.accionCopy(Object.assign({}, idea, { fase: 'publicada' }), { copy_ig: 'b' }).patch.copy_ig === 'b', 'en publicada no deja cambiar el copy');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: 375, height: 760 } });
  p.on('pageerror', e => fallas.push('JS: ' + e.message));
  await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.BARQUERO_CONFIG={};' }));
  // LanguageTool marca «Pistachos» (está en el catálogo) y «Zaatar» (producto nuevo)
  await p.route('https://api.languagetool.org/**', async r => {
    const qs = new URLSearchParams(r.request().postData()), t = qs.get('text');
    if (qs.get('altLanguages') !== 'en-US') fallas.push('No le pide a LanguageTool aceptar palabras en inglés');
    const m = ['Pistachos tostados', 'Zaatar'].filter(w => t.includes(w)).map(w => ({ offset: t.indexOf(w), length: w.length, message: 'Posible error ortográfico.', replacements: [{ value: 'Pistacho' }] }));
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ matches: m }) });
  });
  await p.goto(BASE + '/contenido/'); await p.waitForTimeout(800);
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(900);
  const id = await p.evaluate(() => JSON.parse(localStorage.getItem('bfcontenido_demo_v2')).piezas.find(x => x.fase === 'idea' || x.fase === 'aprobada').id);
  await p.goto(BASE + '/contenido/#/p/' + id); await p.waitForTimeout(600);
  ok(await p.$('[data-act="editar-copy"]'), 'No sale el botón para escribir el copy');
  await p.click('[data-act="editar-copy"]'); await p.waitForTimeout(400);
  const ta = p.locator('form[data-form="copy"] textarea').first();
  await ta.fill('Pistachos tostados y Zaatar con queso manchego');
  await p.locator('form[data-form="copy"] [data-act="ortografia"]').first().click(); await p.waitForTimeout(600);
  let res = await p.locator('form[data-form="copy"] .corrector-res').first().innerHTML();
  ok(!/>Pistachos tostados</.test(res), 'Marcó como error un nombre del catálogo (de varias palabras)');
  ok(/Zaatar/.test(res), 'No marcó la palabra desconocida');
  ok(!/class="rojo"/.test(res), 'El aviso del catálogo sigue saliendo como error (rojo)');
  ok(/producto nuevo/.test(res), 'Falta la explicación de producto nuevo');
  await p.click('form[data-form="copy"] [data-act="es-nombre"]'); await p.waitForTimeout(600);
  res = await p.locator('form[data-form="copy"] .corrector-res').first().innerHTML();
  ok(!/corr-mal/.test(res), 'Después de «Es un nombre» sigue marcando Zaatar');
  await p.click('form[data-form="copy"] button[type="submit"]'); await p.waitForTimeout(700);
  const g = await p.evaluate(id => JSON.parse(localStorage.getItem('bfcontenido_demo_v2')).piezas.find(x => x.id === id), id);
  ok(g.copy_ig === 'Pistachos tostados y Zaatar con queso manchego', 'No guardó el copy: ' + g.copy_ig);
  ok(/Pistachos tostados y Zaatar/.test(await p.textContent('.bloque-copy')), 'No muestra el copy en la ficha');
  const w = await p.evaluate(() => document.documentElement.scrollWidth);
  ok(w <= 376, 'Se sale de la pantalla: ' + w);
  await b.close();
  if (fallas.length) { console.log(fallas.join('\n')); process.exit(1); }
  console.log('OK: copy en cualquier estado y corrector con productos nuevos');
})();
