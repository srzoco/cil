/* Contenido: historias (tercer tipo). Reglas en Node y luego la pantalla en modo demo (375 px):
   se crea una historia para grabar, no ocupa el puesto del plan y se le puede poner cualquier día. */
const L = require('../contenido/logic.js');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
const fallas = [];
const ok = (c, m) => { if (!c) fallas.push(m); };
// ---- Reglas ----
const aj = L.AJUSTES_BASE || { cronograma: null };
const lunes = '2026-11-02';  // lunes: IG toca carrusel
const reel = { id: 'r', tipo: 'reel', ig: true, tt: true, fase: 'aprobada', fecha_ig: lunes, fecha_tt: lunes };
const h = { id: 'h', tipo: 'historia', ig: true, tt: true, fase: 'produccion', etapa: 'video', turno: 'edita', version: 0 };
const nueva = L.nuevaPieza({ titulo: 'Historia del pulpo', tipo: 'historia', ig: true, tt: true, idea: true }).fila;
ok(nueva.tipo === 'historia', 'nuevaPieza no guarda el tipo historia');
const prod = L.nuevaPieza({ titulo: 'H', tipo: 'historia', ig: true }).fila;
ok(prod.etapa === 'video', 'la historia no empieza en edición de video');
ok(L.cabe(aj, 'ig', '2026-11-07', 'historia'), 'la historia no cabe un sábado (descanso)');
ok(!L.ocupado([Object.assign({}, h, { fecha_ig: lunes })], 'ig', lunes, null), 'la historia ocupa el puesto del plan');
const s = L.sugerirFechas(h, [reel], aj, lunes, null);
ok(s.fecha_ig === lunes && s.fecha_tt === lunes, 'no sugiere el mismo día en IG y TikTok: ' + JSON.stringify(s));
const av = L.validarFechas(h, { fecha_ig: lunes, fecha_tt: lunes }, [reel], aj, lunes);
ok(!av.length, 'avisos de más para la historia: ' + av.join(' | '));
ok(!L.fueraDeTipo(h, { fecha_ig: '2026-11-07' }, aj).length, 'pide motivo por poner una historia un sábado');
ok(L.fechaLimite(Object.assign({}, h, { fecha_ig: lunes }), aj) === lunes, 'la historia debe entregarse el mismo día');
ok(!L.candidatosHueco([Object.assign({}, h, { fase: 'aprobada' })], { fecha: lunes, plataforma: 'ig', tipo: 'cualquiera' }).length, 'la historia sale para llenar un hueco del plan');
ok(L.pasosDe(Object.assign({}, h, { fase: 'idea', grabacion_id: 'g' })).actual === 1, 'pasos de la historia por grabar');
ok(L.huecos([Object.assign({}, h, { fecha_ig: lunes, fase: 'aprobada' })], aj, lunes, 1).some(x => x.plataforma === 'ig'), 'la historia tapa el hueco del lunes');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: 375, height: 760 } });
  p.on('pageerror', e => fallas.push('JS: ' + e.message));
  await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.BARQUERO_CONFIG={};' }));
  await p.goto(BASE + '/contenido/'); await p.waitForTimeout(800);
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(900);
  await p.goto(BASE + '/contenido/#/nueva'); await p.waitForTimeout(500);
  ok(await p.$('input[name="tipo"][value="historia"]'), 'No sale «Historia» en Nueva pieza');
  await p.fill('form[data-form="nueva"] input[name="titulo"]', 'Historia de prueba');
  await p.click('label.op-historia'); await p.click('form[data-form="nueva"] button[type="submit"]'); await p.waitForTimeout(700);
  const guardada = await p.evaluate(() => JSON.parse(localStorage.getItem('bfcontenido_demo_v2')).piezas.find(x => x.titulo === 'Historia de prueba'));
  ok(guardada && guardada.tipo === 'historia', 'No se guardó como historia');
  ok(/Historia/.test(await p.textContent('body')), 'No muestra la etiqueta Historia');
  // ancho de pantalla
  const w = await p.evaluate(() => document.documentElement.scrollWidth);
  ok(w <= 376, 'Se sale de la pantalla: ' + w);
  await p.goto(BASE + '/contenido/#/calendario'); await p.waitForTimeout(500);
  ok(/Historia \(no ocupa/.test(await p.textContent('body')), 'Falta la leyenda de historias en el calendario');
  await b.close();
  if (fallas.length) { console.log(fallas.join('\n')); process.exit(1); }
  console.log('OK: historias en Contenido');
})();
