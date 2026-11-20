/* Armador: quien tiene el acceso «aprobar» (Adolfo) ve el descuento de Yobel por aprobar y los nuevos de Yobel,
   y aprueba por armador_cola (no por guardar_armador). No ve «Editar» ni los ajustes. Sin sesión de CIL, sale el aviso.
   Uso: python3 -m http.server 8765 y luego: node pruebas/armador-aprobar.js */
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
(async () => {
  const fallas = [];
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const datos = { ajustes: {}, productos: [{ id: 'jamon', nombre: 'Jamón serrano', categoria: 'Charcutería', presentaciones: [{ texto: '', precio: 30, ref: 'Jamón serrano|||||', stock: 4 }] }],
    nuevos: [{ ref: 'Aceite de oliva Jaén|||1L||', producto: 'Aceite de oliva Jaén', categoria: 'Grasas', precio: 12, stock: 6 },
             { ref: 'Cosa rara|||||', producto: 'Cosa rara', categoria: '', precio: 3, stock: 0 }] };
  async function abrir(conSesion) {
    const p = await b.newPage({ viewport: { width: 360, height: 800 } });
    p.on('pageerror', e => fallas.push('JS: ' + e.message));
    p.on('dialog', d => d.accept());
    const llamadas = [];
    await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.BARQUERO_CONFIG={supabaseUrl:"http://sb.test",supabaseKey:"k"};' }));
    await p.route('http://sb.test/**', async r => {
      const u = r.request().url(), cuerpo = r.request().postData();
      const j = x => r.fulfill({ contentType: 'application/json', body: JSON.stringify(x) });
      if (u.includes('armador_datos')) return j([{ datos, editado_en: '2026-11-20T00:00:00Z' }]);
      if (u.includes('rpc/armador_permisos')) return j({ admin: false, aprobar: true });
      if (u.includes('rpc/es_admin')) return j(false);
      if (u.includes('rpc/descuento_yobel_hoy')) return j({ fecha: '2026-11-20', descuento: 43, en_yobel: 41, estado: 'pendiente', limite: '12:00' });
      if (u.includes('rpc/armador_cola')) { llamadas.push(JSON.parse(cuerpo)); return j('2026-11-20T13:00:00Z'); }
      if (u.includes('rpc/')) { llamadas.push({ fn: u.split('rpc/')[1], cuerpo }); }
      return r.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"no"}' });
    });
    await p.route('**/mensajesBF/tasas.json*', r => r.fulfill({ contentType: 'application/json', body: '{"descuento":40}' }));
    await p.goto(BASE + '/mensajes/');
    await p.evaluate((s) => { localStorage.clear(); if (s) localStorage.setItem('barquero_sesion', JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: Date.now() / 1000 + 3600, user: { id: 'adolfo' } })); }, conSesion);
    await p.reload(); await p.waitForTimeout(1500);
    return { p, llamadas };
  }
  // 1) con sesión y acceso «aprobar»
  const { p, llamadas } = await abrir(true);
  const yob = await p.locator('#yobel').innerText().catch(() => '');
  if (!/Aprobar 43%/.test(yob)) fallas.push('No le sale el descuento de Yobel por aprobar: ' + yob);
  if (await p.locator('#sin-cil').isVisible()) fallas.push('Con sesión sale el aviso de entrar a CIL');
  await p.click('#tab-catalogo'); await p.waitForTimeout(300);
  if (!(await p.locator('#cola').isVisible())) fallas.push('No le sale «Nuevos de Yobel por aprobar»');
  if (await p.locator('[data-edit]').first().isVisible()) fallas.push('Le sale «Editar» (solo gerencia)');
  if (await p.locator('#ajustes').isVisible()) fallas.push('Le salen los ajustes (solo gerencia)');
  await p.locator('.cola-item', { hasText: 'Aceite de oliva Jaén' }).locator('[data-cola="agregar"]').click(); await p.waitForTimeout(700);
  await p.locator('.cola-item', { hasText: 'Cosa rara' }).locator('[data-cola="no"]').click(); await p.waitForTimeout(700);
  const a = llamadas.find(x => x.p_accion === 'agregar'), n = llamadas.find(x => x.p_accion === 'no');
  if (!a || a.p_refs[0] !== 'Aceite de oliva Jaén|||1L||' || !a.p_producto || a.p_producto.nombre !== 'Aceite de oliva Jaén') fallas.push('Agregar no fue por armador_cola: ' + JSON.stringify(llamadas));
  if (!n || n.p_refs[0] !== 'Cosa rara|||||' || n.p_producto) fallas.push('No agregar no fue por armador_cola: ' + JSON.stringify(llamadas));
  if (llamadas.some(x => x.fn === 'guardar_armador')) fallas.push('Intentó guardar el catálogo entero');
  const w = await p.evaluate(() => document.documentElement.scrollWidth); if (w > 361) fallas.push('Se sale de la pantalla: ' + w);
  // 2) sin sesión de CIL en el teléfono: el aviso para entrar
  const s = await abrir(false);
  if (!(await s.p.locator('#sin-cil').isVisible())) fallas.push('Sin sesión no sale el aviso de entrar a CIL');
  await b.close();
  if (fallas.length) { console.error('FALLAS (' + fallas.length + '):\n- ' + fallas.join('\n- ')); process.exit(1); }
  console.log('OK: quien aprueba ve el descuento de Yobel y los nuevos, aprueba sin tocar el catálogo, y sin sesión se le avisa.');
})();
