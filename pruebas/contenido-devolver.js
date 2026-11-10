/* Contenido (10/11/2026): devolver una pieza al paso anterior desde cualquier paso, y anotar en la grabación videos ya creados
   (la grabación los muestra en dos grupos: «Por grabar» y «Grabados»).
   Uso: python3 -m http.server 8765 y luego: node pruebas/contenido-devolver.js */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const L = require('../contenido/logic.js');
const BASE = process.env.BASE || 'http://localhost:8765';
(async () => {
  const fallas = []; const ok = (c, m) => { if (!c) fallas.push(m); };
  // --- reglas ---
  const base = { id: 'x', titulo: 'T', tipo: 'reel', ig: true, tt: true, version: 2 };
  const paso = (p) => { const d = L.pasoAnterior(p); return d && d.a; };
  ok(paso({ ...base, fase: 'aprobada' }) === 'aprobar', 'lista → por aprobar');
  ok(paso({ ...base, fase: 'aprobada', publicado_ig_en: '2026-11-01T00:00:00Z' }) === null, 'lo publicado no se devuelve');
  ok(paso({ ...base, fase: 'produccion', etapa: 'video', turno: 'aprueba' }) === 'editar', 'por aprobar → en edición');
  ok(paso({ ...base, fase: 'produccion', etapa: 'video', turno: 'edita' }) === 'ideas', 'en edición → ideas');
  ok(paso({ ...base, fase: 'produccion', etapa: 'video', turno: 'edita', grabacion_id: 'g' }) === 'grabar', 'en edición (venía de una grabación) → por grabar');
  ok(paso({ ...base, tipo: 'carrusel', fase: 'produccion', etapa: 'diseno', turno: 'edita' }) === 'etapa', 'carrusel en diseño → texto por aprobar');
  ok(paso({ ...base, fase: 'idea', grabacion_id: 'g' }) === 'ideas' && paso({ ...base, fase: 'idea' }) === null && paso({ ...base, fase: 'publicada' }) === null, 'por grabar → ideas; idea y publicada no tienen paso anterior');
  let r = L.accionPasoAnterior({ ...base, fase: 'produccion', etapa: 'video', turno: 'aprueba' });
  ok(r.patch.turno === 'edita' && r.patch.version === undefined && r.match.turno === 'aprueba' && r.eventos[0].tipo === 'editada', 'devolver de «por aprobar» no cambia la versión y deja historial');
  r = L.accionPasoAnterior({ ...base, fase: 'produccion', etapa: 'video', turno: 'edita', grabacion_id: 'g' });
  ok(r.patch.fase === 'idea' && r.patch.version === 0 && !('grabacion_id' in r.patch), 'devolver a «por grabar» conserva la grabación');
  r = L.accionPasoAnterior({ ...base, tipo: 'carrusel', fase: 'produccion', etapa: 'diseno', turno: 'edita' });
  ok(r.patch.etapa === 'texto' && r.patch.turno === 'aprueba', 'carrusel vuelve al texto por aprobar');
  let tiro = false; try { L.accionPasoAnterior({ ...base, fase: 'publicada' }); } catch (e) { tiro = true; } ok(tiro, 'devolver algo publicado debía fallar');
  r = L.accionAGrabacion({ ...base, fase: 'produccion', etapa: 'video', turno: 'edita' }, 'g1');
  ok(r.patch.grabacion_id === 'g1' && r.match.fase === 'produccion' && Object.keys(r.patch).length === 1, 'anotar un video ya creado en la grabación no lo cambia de paso');
  tiro = false; try { L.accionAGrabacion({ ...base, fase: 'publicada' }, 'g1'); } catch (e) { tiro = true; } ok(tiro, 'no se anota algo publicado');
  // --- pantalla (demo) ---
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: 360, height: 740 } });
  p.on('pageerror', e => fallas.push('JS: ' + e.message));
  p.on('dialog', d => d.accept());
  await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.BARQUERO_CONFIG={};' }));
  await p.goto(BASE + '/contenido/'); await p.waitForTimeout(600); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(900);
  const db = () => p.evaluate(() => JSON.parse(localStorage.getItem('bfcontenido_demo_v2')));
  let d = await db();
  const apr = d.piezas.find(x => x.fase === 'produccion' && x.turno === 'aprueba');
  await p.goto(BASE + '/contenido/#/p/' + apr.id); await p.waitForTimeout(500);
  ok(/Devolver a «En edición»/.test(await p.locator('.devolver').innerText()), 'La pieza por aprobar no ofrece «Devolver a En edición»');
  await p.locator('.devolver').click(); await p.waitForTimeout(700);
  d = await db(); const tras = d.piezas.find(x => x.id === apr.id);
  ok(tras.turno === 'edita' && tras.version === apr.version, 'El botón no devolvió la pieza a edición: ' + tras.turno);
  ok(d.eventos.some(e => e.pieza_id === apr.id && /paso anterior/.test(e.texto || '')), 'Devolver no quedó en el historial');
  ok(/Devolver a «(Ideas|Por grabar)»/.test(await p.locator('.devolver').innerText()), 'Ya en edición, debía ofrecer devolver a Ideas o Por grabar');
  // grabación: dos grupos y «videos ya creados»
  const g = d.grabaciones.find(x => x.estado !== 'cancelada' && x.estado !== 'hecha') || d.grabaciones[0];
  await p.goto(BASE + '/contenido/#/grabacion/' + g.id); await p.waitForTimeout(600);
  const t = await p.locator('main').innerText();
  ok(/Por grabar/.test(t), 'La grabación no tiene el grupo «Por grabar»');
  const suelto = p.locator('details.plegable [data-act="a-grabacion"]').first();
  ok(await suelto.count() === 1, 'No salen los videos ya creados para anotarlos en la grabación');
  const idS = await suelto.getAttribute('data-id');
  await p.locator('details.plegable > summary').click(); await suelto.click(); await p.waitForTimeout(700);
  d = await db(); const ps = d.piezas.find(x => x.id === idS);
  ok(ps.grabacion_id === g.id && ps.fase !== 'idea', 'El video ya creado no quedó anotado en la grabación (o cambió de paso)');
  ok(/Grabados/.test(await p.locator('main').innerText()), 'No aparece el grupo «Grabados»');
  const w = await p.evaluate(() => Math.max(document.documentElement.scrollWidth, ...[...document.querySelectorAll('.desliza, #app')].map(e => e.scrollWidth)));
  ok(w <= 361, 'La grabación se sale de la pantalla (' + w + ' px)');
  await b.close();
  if (fallas.length) { console.error('FALLAS (' + fallas.length + '):\n- ' + fallas.join('\n- ')); process.exit(1); }
  console.log('OK: devolver al paso anterior desde cualquier paso y anotar videos ya creados en la grabación.');
})();
