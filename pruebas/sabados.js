/* Sábados de temporada en tareas/logic.js: deben dar lo mismo que _a_tiempo/_limite/_hora_dia de cil.sql (pruebas/sabados.sql).
   Uso: node pruebas/sabados.js */
const L = require('../tareas/logic.js');
const a = { a_tiempo_hasta: '08:35', hora_limite: '08:50', sab_desde: '2026-11-14', sab_hasta: '2026-12-31', sab_entrada: '10:00:00', sab_salida: '16:00:00' };
const casos = [
  [L.aTiempoHasta(a, '2026-11-21'), '10:05'], [L.horaLimite(a, '2026-11-21'), '10:20'], [L.aTiempoHasta(a, '2026-11-20'), '08:35'],
  [L.horaDia(a, '2026-11-21', '08:30'), '10:00'], [L.horaDia(a, '2026-11-21', '13:00'), '13:00'], [L.horaDia(a, '2026-11-21', '16:00'), '15:00'],
  [L.horaDia(a, '2027-01-02', '16:00'), '16:00'], [L.llegoTarde(a, '2026-11-21T10:04:00'), false], [L.llegoTarde(a, '2026-11-21T10:06:00'), true],
  [L.llegoTarde(a, '2026-11-20T09:00:00'), true], [L.aTiempoHasta({ a_tiempo_hasta: '08:35' }, '2026-11-21'), '08:35']
];
const mal = casos.map((c, i) => c[0] === c[1] ? null : i + ': ' + c[0] + ' ≠ ' + c[1]).filter(Boolean);
if (mal.length) { console.log('FALLAS:\n- ' + mal.join('\n- ')); process.exit(1); }
console.log('OK: sábados de temporada en logic.js igual que en el SQL');
