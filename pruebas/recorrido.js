/* Recorrido completo de Tareas en modo demo (360 px): como gerencia y como empleado, entra a cada pantalla,
   toca cada botón, llena cada formulario con datos malos (vacíos, negativos, enormes, con <html>) y repite ciclos.
   Falla si hay errores de JavaScript, si algo se sale de la pantalla, si un texto se ejecuta como código
   o si un empleado llega a ver algo de gerencia.
   Uso: python3 -m http.server 8765 (en la carpeta del repo) y luego: node pruebas/recorrido.js */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
const RUTAS_ADMIN = ['/', '/tareas', '/tareas?ver=unica', '/tarea/nueva?tipo=rec', '/tarea/nueva?tipo=unica', '/reporte', '/historial', '/temperaturas',
  '/equipo', '/equipo/personas', '/equipo/grupos', '/equipo/locales', '/equipo/frio', '/equipo/calendario', '/equipo/avisos', '/equipo/ajustes',
  '/perfil', '/balance', '/ayuda'];
// No se tocan: cierran la sesión, borran la demo, salen de la app o piden permisos del teléfono
const NO_TOCAR = ['salir', 'reiniciar-demo', 'copiar', 'activar-avisos', 'aviso-prueba', 'guardar-ubicacion', 'cerrar-ir'];
const XSS = '<img src=x onerror="window.__xss=1">"\'&';
const MALOS = { text: [XSS, '', '   ', 'x'.repeat(400)], number: ['-5', '0', '99999', 'abc'], date: ['2020-01-01', '2099-12-31', ''], time: ['00:00', '23:59'], email: ['no-es-correo', ''], password: ['1', ''] };

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: 360, height: 760 } });
  await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.BARQUERO_CONFIG={};' }));
  const fallas = new Set(); let donde = '';
  p.on('pageerror', e => fallas.add('JS en ' + donde + ': ' + e.message));
  p.on('dialog', d => { fallas.add('Ventana inesperada en ' + donde + ': ' + d.message()); d.dismiss(); });
  const revisar = async () => {
    const r = await p.evaluate(() => ({ xss: !!window.__xss, w: document.documentElement.scrollWidth }));
    if (r.xss) fallas.add('Un texto se ejecutó como código en ' + donde);
    if (r.w > 361) fallas.add('Se sale de la pantalla (' + r.w + ' px) en ' + donde);
  };
  const ir = async (ruta) => { await p.goto(BASE + '/tareas/#' + ruta); await p.waitForTimeout(250); };
  const cerrarModal = async () => {
    for (let i = 0; i < 3; i++) {
      const c = p.locator('#capa-modal [data-acc="cerrar"]').first();
      if (!(await c.count())) break;
      await c.evaluate(e => e.click()); await p.waitForTimeout(120);
    }
  };
  // Llena los formularios visibles con un juego de datos malos y los envía
  const atacarFormularios = async (juego, dentroModal) => {
    const sel = (dentroModal ? '#capa-modal ' : 'main ') + 'form[data-form]';
    const n = await p.locator(sel).count();
    for (let f = 0; f < n; f++) {
      await p.evaluate(({ sel, f, juego, MALOS }) => {
        const form = document.querySelectorAll(sel)[f]; if (!form) return;
        form.querySelectorAll('input, textarea, select').forEach(el => {
          const t = (el.type || el.tagName).toLowerCase();
          if (t === 'checkbox' || t === 'radio') { if (juego % 2) el.click(); return; }
          if (t === 'hidden' || t === 'file') return;
          if (el.tagName === 'SELECT') { if (el.options.length) el.selectedIndex = juego % el.options.length; el.dispatchEvent(new Event('change', { bubbles: true })); return; }
          const lista = MALOS[t] || MALOS.text;
          try { el.value = lista[juego % lista.length]; } catch (e) { /* tipo que no acepta ese valor */ }
          el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const btn = form.querySelector('button[type="submit"], button:not([type])');
        if (btn) btn.click(); else form.requestSubmit && form.requestSubmit();
      }, { sel, f, juego, MALOS });
      await p.waitForTimeout(200);
      await revisar();
    }
  };
  // Toca cada botón de la pantalla (volviendo a entrar antes de cada uno) y ataca lo que abra
  const recorrer = async (ruta, quien) => {
    donde = quien + ' ' + ruta;
    await ir(ruta); await revisar();
    const botones = await p.$$eval('[data-acc]', (els, NO) => els.filter(e => e.offsetParent !== null && NO.indexOf(e.dataset.acc) < 0)
      .map(e => ({ acc: e.dataset.acc, id: e.dataset.id || '' })), NO_TOCAR);
    const vistos = new Set();
    for (const bt of botones.slice(0, 30)) {
      const k = bt.acc + '|' + bt.id; if (vistos.has(k)) continue; vistos.add(k);
      donde = quien + ' ' + ruta + ' → ' + bt.acc;
      await ir(ruta);
      const el = p.locator('[data-acc="' + bt.acc + '"]' + (bt.id ? '[data-id="' + bt.id + '"]' : '')).first();
      if (!(await el.count())) continue;
      await el.evaluate(e => e.click()); await p.waitForTimeout(220); await revisar();
      if (await p.locator('#capa-modal form[data-form]').count()) { await atacarFormularios(0, true); await atacarFormularios(1, true); }
      const si = p.locator('#capa-modal [data-acc="confirmar-si"]').first();
      if (await si.count()) { await si.evaluate(e => e.click()); await p.waitForTimeout(200); await revisar(); }
      await cerrarModal();
    }
    donde = quien + ' ' + ruta + ' (formularios)';
    for (let j = 0; j < 4; j++) { await ir(ruta); await atacarFormularios(j, false); await cerrarModal(); }
  };

  await p.goto(BASE + '/tareas/'); await p.waitForTimeout(600);
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(700);

  // ---------- Gerencia ----------
  for (const r of RUTAS_ADMIN) await recorrer(r, 'gerencia');

  // ---------- Empleado ----------
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(700);
  const emps = await p.$eval('select[data-cambio="demo-usuario"]', s => [...s.options].filter(o => !/gerencia/.test(o.text)).map(o => o.value));
  for (const emp of emps.slice(0, 2)) {
    await ir('/');
    await p.selectOption('select[data-cambio="demo-usuario"]', emp); await p.waitForTimeout(400);
    // Ninguna pantalla de gerencia, ni escribiendo la dirección a mano
    for (const r of RUTAS_ADMIN.filter(x => x !== '/' && x !== '/perfil' && x !== '/ayuda')) {
      donde = 'empleado entra a ' + r;
      await ir(r);
      const ve = await p.evaluate(() => ({
        nav: !!document.querySelector('a[href="#/equipo"], a[href="#/reporte"], a[href="#/tareas"]'),
        h1: (document.querySelector('main h1') || {}).textContent || '',
        admin: !!document.querySelector('form[data-form="tarea"], form[data-form="ajustes"], form[data-form="persona"], [data-acc="editar-persona"], [data-acc="borrar-plantilla"]')
      }));
      if (ve.nav || ve.admin || /^(Tareas|Equipo|Reporte|Historial|Balance|Temperaturas)/.test(ve.h1)) fallas.add('El empleado ve algo de gerencia en ' + r + ' (' + ve.h1 + ')');
    }
    // Ciclos: llegar, marcar y desmarcar varias veces, irse y volver
    donde = 'empleado ciclos';
    await ir('/');
    for (let i = 0; i < 3; i++) { const l = p.locator('[data-acc="llegue"]').first(); if (await l.count()) { await l.evaluate(e => e.click()); await p.waitForTimeout(300); } }
    for (let i = 0; i < 6; i++) {
      const h = p.locator('[data-acc="hecha"]').first(); if (!(await h.count())) break;
      await h.evaluate(e => e.click()); await p.waitForTimeout(250); await revisar();
      if (await p.locator('#capa-modal form[data-form]').count()) await atacarFormularios(i, true);
      await cerrarModal();
    }
    for (const r of ['/', '/perfil', '/ayuda']) await recorrer(r, 'empleado');
    // Sin Wi-Fi del local
    await p.evaluate(() => { const c = document.querySelector('[data-cambio="demo-fuera"]'); if (c && !c.checked) c.click(); });
    await recorrer('/', 'empleado fuera del local');
    await p.evaluate(() => { const c = document.querySelector('[data-cambio="demo-fuera"]'); if (c && c.checked) c.click(); });
  }

  await b.close();
  if (fallas.size) { console.error('FALLAS (' + fallas.size + '):\n- ' + [...fallas].join('\n- ')); process.exit(1); }
  console.log('OK: recorrido completo de gerencia y empleados sin errores.');
})();
