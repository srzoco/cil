/* Contenido con más de 1.000 filas: Supabase entrega máximo 1.000 por consulta. La app debe pedir por páginas y quedarse
   con todo (antes se quedaba solo con las 1.000 más viejas del historial, sin las aprobaciones recientes).
   Uso: node pruebas/contenido-paginas.js   (no necesita navegador ni servidor) */
const ST = require('../contenido/store.js');
const ses = { access_token: 't', refresh_token: 'r', expires_at: 4e9, user: { id: 'sara', email: 's@x.com' } };
ST.LS.set('barquero_sesion', ses); ST.LS.set('bfcontenido_sesion', ses);
const filas = { equipo: 2, ajustes: 1, piezas: 1000, eventos: 2345, grabaciones: 30, grabacion_eventos: 0 };
const pedidos = [];
const fetchFalso = async (url) => {
  const u = new URL(url), tabla = u.pathname.split('/').pop();
  pedidos.push(tabla + u.search);
  const total = filas[tabla], lim = Math.min(+(u.searchParams.get('limit') || 1000), 1000), desde = +(u.searchParams.get('offset') || 0);  // el servidor nunca da más de 1.000
  const out = []; for (let i = desde; i < Math.min(total, desde + lim); i++) out.push({ id: tabla + i });
  return { ok: true, status: 200, text: async () => JSON.stringify(out) };
};
(async () => {
  const s = new ST.SupabaseStore({ supabaseUrl: 'http://sb.test', supabaseKey: 'k', fetch: fetchFalso });
  const d = await s.cargarTodo(), fallas = [];
  if (d.eventos.length !== 2345) fallas.push('eventos: llegaron ' + d.eventos.length + ' de 2345');
  if (new Set(d.eventos.map(e => e.id)).size !== 2345) fallas.push('eventos repetidos entre páginas');
  if (d.eventos[2344].id !== 'eventos2344') fallas.push('falta el evento más reciente');
  if (d.piezas.length !== 1000) fallas.push('piezas: ' + d.piezas.length);
  if (d.grabacion_eventos.length !== 0 || d.grabaciones.length !== 30 || d.equipo.length !== 2 || !d.ajustes) fallas.push('las tablas chicas cambiaron');
  const nEv = pedidos.filter(x => x.indexOf('eventos?') === 0).length, nPz = pedidos.filter(x => x.indexOf('piezas?') === 0).length;
  if (nEv !== 3) fallas.push('eventos: ' + nEv + ' consultas (debían ser 3)');
  if (nPz !== 2) fallas.push('piezas: ' + nPz + ' consultas (1.000 exactas = 2)');
  if (pedidos.some(x => /^(eventos|piezas|grabacion_eventos)\?/.test(x) && !/order=[^&]*id\.asc/.test(x))) fallas.push('una consulta por páginas sin orden fijo (id)');
  // Al abrir (30 días): las piezas se piden con el filtro de «en proceso o recientes» y el historial solo de esas piezas, de 60 en 60
  filas.piezas = 130; filas.eventos = 5; pedidos.length = 0;
  const d2 = await s.cargarTodo(30);
  const pz = pedidos.filter(x => x.indexOf('piezas?') === 0), ev = pedidos.filter(x => x.indexOf('eventos?') === 0);
  if (d2.completo !== false || d.completo !== true) fallas.push('no dice si lo que bajó es todo o solo lo reciente');
  if (pz.length !== 1 || !/fase\.not\.in\.\(publicada,archivada\)/.test(decodeURIComponent(pz[0])) || !/actualizado_en\.gte\.20\d\d-/.test(decodeURIComponent(pz[0]))) fallas.push('las piezas recientes no se piden con el filtro: ' + pz.join(' | '));
  if (ev.length !== 3 || !ev.every(x => /pieza_id=in\.\(piezas\d+/.test(decodeURIComponent(x)))) fallas.push('el historial no se pide solo de las piezas bajadas, de 60 en 60 (' + ev.length + ' consultas)');
  if (d2.piezas.length !== 130 || d2.grabaciones.length !== 30 || !d2.ajustes) fallas.push('lo reciente llegó incompleto');
  // Si el servidor rechaza la consulta de «lo reciente», baja todo como antes en vez de quedarse sin abrir
  const s3 = new ST.SupabaseStore({ supabaseUrl: 'http://sb.test', supabaseKey: 'k', fetch: async (url) => /or=/.test(url) ? { ok: false, status: 400, text: async () => '{"message":"failed to parse logic tree"}' } : fetchFalso(url) });
  const d3 = await s3.cargarTodo(30);
  if (d3.piezas.length !== 130 || d3.completo !== true) fallas.push('si falla la consulta de lo reciente no baja todo (' + d3.piezas.length + ', completo ' + d3.completo + ')');
  if (fallas.length) { console.error('FALLAS:\n- ' + fallas.join('\n- ')); process.exit(1); }
  console.log('OK: Contenido carga todo aunque pase de 1.000 filas (por páginas) y al abrir pide solo lo reciente.');
})();
