/* Equipo → Locales (10/11/2026): el Wi-Fi de cada local va arriba con su botón de registrar; los intentos desde redes sin
   registrar van al final, plegados, solo con el número y sin botones «Es de …»; una red que se registró sola se puede deshacer.
   Uso: python3 -m http.server 8765 y luego: node pruebas/locales-wifi.js */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: 360, height: 760 } });
  await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.BARQUERO_CONFIG={};' }));
  await p.route('https://ipinfo.io/**', r => r.abort());
  const fallas = []; const ok = (c, m) => { if (!c) fallas.push(m); };
  p.on('pageerror', e => fallas.push('JS: ' + e.message));
  await p.goto(BASE + '/tareas/'); await p.waitForTimeout(700);
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
  // dos intentos desde una red sin registrar y una red que se registró sola
  await p.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('tareasbf_demo_v1')), emp = db.personas.filter(x => x.rol === 'empleado'), lo = db.locales[0];
    const ahora = new Date().toISOString();
    db.redes_nuevas = [{ id: 'r1', ip: '200.1.1.1', persona_id: emp[0].id, creado_en: ahora }, { id: 'r2', ip: '200.1.1.1', persona_id: emp[1].id, creado_en: ahora }, { id: 'r3', ip: '201.2.2.2', persona_id: emp[0].id, creado_en: ahora }];
    db.redes_auto = [{ id: 'a1', local_id: lo.id, ip: '190.5.77.7', personas: [emp[0].id, emp[1].id], creado_en: ahora, deshecha: false }];
    lo.redes = (lo.redes || []).concat(['190.5.77.7']);
    localStorage.setItem('tareasbf_demo_v1', JSON.stringify(db));
  });
  await p.reload(); await p.waitForTimeout(700);  // primero recargar: la página abierta guardaría sus datos encima
  await p.goto(BASE + '/tareas/#/equipo/locales'); await p.waitForTimeout(900);
  const pos = async sel => { const e = await p.$(sel); return e ? (await e.boundingBox() || {}).y : null; };
  const yWifi = await pos('.wifi-locales'), yLocal = await pos('form[data-form="local"]'), yRedes = await pos('.redes-nuevas'), yBtn = await pos('button[data-acc="registrar-red"]');
  ok(yWifi != null && yBtn != null && yLocal != null && yWifi < yLocal && yBtn < yLocal, 'El botón de registrar el Wi-Fi no quedó arriba de los locales');
  ok(yRedes != null && yRedes > yLocal, 'Los intentos desde redes sin registrar no quedaron al final');
  ok(await p.locator('.redes-nuevas[open]').count() === 0, 'La lista de intentos no está plegada');
  ok((await p.locator('.redes-nuevas .cuenta-n').innerText()).trim() === '3', 'El número de intentos no es 3');
  ok(await p.locator('[data-acc="aceptar-red"]').count() === 0 && !/Es de /.test(await p.locator('.redes-nuevas').innerText()), 'Siguen los botones «Es de …»');
  ok(await p.locator('form[data-form="local"] [data-acc="registrar-red"]').count() === 0, 'El botón de registrar sigue repetido dentro de cada local');
  await p.locator('.redes-nuevas > summary').click(); await p.waitForTimeout(200);
  ok(await p.locator('.redes-nuevas [data-acc="ignorar-red"]').count() === 2, 'Al abrir la lista debían salir 2 redes con «Quitar»');
  // deshacer la red que se registró sola
  ok(/Se registró sola/.test(await p.locator('.wifi-locales').innerText()), 'No muestra la red que se registró sola');
  await p.locator('[data-acc="deshacer-red"]').click(); await p.waitForTimeout(300);
  await p.click('button[data-acc="confirmar-si"]'); await p.waitForTimeout(800);
  const d = await p.evaluate(() => { const db = JSON.parse(localStorage.getItem('tareasbf_demo_v1')); return { redes: db.locales[0].redes, des: db.redes_auto[0].deshecha }; });
  ok(d.des && d.redes.indexOf('190.5.77.7') < 0, 'Deshacer no quitó la red: ' + JSON.stringify(d));
  ok(await p.locator('[data-acc="deshacer-red"]').count() === 0, 'La red deshecha sigue en pantalla');
  const w = await p.evaluate(() => Math.max(document.documentElement.scrollWidth, ...[...document.querySelectorAll('.desliza, #app')].map(e => e.scrollWidth)));
  ok(w <= 361, 'Locales se sale de la pantalla (' + w + ' px)');
  await b.close();
  if (fallas.length) { console.error('FALLAS (' + fallas.length + '):\n- ' + fallas.join('\n- ')); process.exit(1); }
  console.log('OK: Locales con el Wi-Fi arriba, intentos plegados al final sin «Es de …» y deshacer la red que se registró sola.');
})();
