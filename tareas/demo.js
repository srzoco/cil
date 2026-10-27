/* Tareas CIL — datos de ejemplo para el modo demo (nombres inventados). */
(function (root, factory) {
  var mod = factory(root.TBLogic || (typeof require === 'function' ? require('./logic.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.TBDemo = mod;
})(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';

  // Feriados nacionales (los mismos que carga supabase.sql)
  var FERIADOS = [
    ['2026-01-01', 'Año Nuevo'], ['2026-02-16', 'Carnaval'], ['2026-02-17', 'Carnaval'], ['2026-04-02', 'Jueves Santo'], ['2026-04-03', 'Viernes Santo'],
    ['2026-04-19', '19 de Abril'], ['2026-05-01', 'Día del Trabajador'], ['2026-06-24', 'Batalla de Carabobo'], ['2026-07-05', 'Día de la Independencia'],
    ['2026-07-24', 'Natalicio del Libertador'], ['2026-10-12', 'Día de la Resistencia Indígena'], ['2026-12-24', 'Nochebuena'], ['2026-12-25', 'Navidad'], ['2026-12-31', 'Fin de Año'],
    ['2027-01-01', 'Año Nuevo'], ['2027-02-08', 'Carnaval'], ['2027-02-09', 'Carnaval'], ['2027-03-25', 'Jueves Santo'], ['2027-03-26', 'Viernes Santo'],
    ['2027-04-19', '19 de Abril'], ['2027-05-01', 'Día del Trabajador'], ['2027-06-24', 'Batalla de Carabobo'], ['2027-07-05', 'Día de la Independencia'],
    ['2027-07-24', 'Natalicio del Libertador'], ['2027-10-12', 'Día de la Resistencia Indígena'], ['2027-12-24', 'Nochebuena'], ['2027-12-25', 'Navidad'], ['2027-12-31', 'Fin de Año'],
    ['2028-01-01', 'Año Nuevo'], ['2028-02-28', 'Carnaval'], ['2028-02-29', 'Carnaval'], ['2028-04-13', 'Jueves Santo'], ['2028-04-14', 'Viernes Santo'],
    ['2028-04-19', '19 de Abril'], ['2028-05-01', 'Día del Trabajador'], ['2028-06-24', 'Batalla de Carabobo'], ['2028-07-05', 'Día de la Independencia'],
    ['2028-07-24', 'Natalicio del Libertador'], ['2028-10-12', 'Día de la Resistencia Indígena'], ['2028-12-24', 'Nochebuena'], ['2028-12-25', 'Navidad'], ['2028-12-31', 'Fin de Año']
  ];

  function semilla(hoy, ahora) {
    hoy = hoy || L.hoyISO();
    ahora = ahora || new Date();
    var n = 0;
    function id(pref) { n++; return pref + '-' + String(n).padStart(4, '0') + '-demo'; }
    function persona(nombre, rol, email) { return { id: id('p'), email: email, nombre: nombre, rol: rol, activo: true, telefono: null }; }

    var principal = { id: id('l'), nombre: 'Local principal', principal: true, dias_laborables: [1, 2, 3, 4, 5, 6], redes: ['190.200.10.20'], lat: null, lng: null, radio_m: 150, creado_en: '2026-01-01T00:00:00Z' };
    var segundo = { id: id('l'), nombre: 'Segundo local', principal: false, dias_laborables: [1, 2, 3, 4, 5], redes: ['190.200.10.21'], lat: null, lng: null, radio_m: 150, creado_en: '2026-01-02T00:00:00Z' };
    var sara = persona('Sara', 'admin', 'sara@demo'), papa = persona('Papá', 'admin', 'papa@demo');
    // Johandre y Josbel despachan (50% de su tiempo para tareas); Yureidy también prepara pedidos (70%); María solo limpieza (100%).
    var jose = persona('Johandre', 'empleado', 'johandre@demo'), yuli = persona('Josbel', 'empleado', 'josbel@demo');
    var luis = persona('María', 'empleado', 'maria@demo'), carmen = persona('Yureidy', 'empleado', 'yureidy@demo');
    jose.capacidad = 50; yuli.capacidad = 50; luis.capacidad = 100; carmen.capacidad = 70;
    jose.tarea_max = 20; yuli.tarea_max = 20;  // despachan: pasan ratos cortos en el local
    jose.despacha = true; yuli.despacha = true;
    var andrea = persona('Wendy', 'empleado', 'wendy@demo');
    var personas = [sara, papa, jose, yuli, luis, carmen, andrea];
    var gDespacho = { id: id('g'), nombre: 'Despacho', creado_en: '2026-01-01T00:00:00Z' };
    var gLimpieza = { id: id('g'), nombre: 'Limpieza', creado_en: '2026-01-02T00:00:00Z' };
    personas.forEach(function (p) { p.local_id = principal.id; if (!p.capacidad) p.capacidad = 100; p.grupos = []; p.accesos = p.rol === 'admin' ? [] : ['tareas']; });
    jose.grupos = [gDespacho.id]; yuli.grupos = [gDespacho.id]; luis.grupos = [gLimpieza.id]; carmen.grupos = [gLimpieza.id];
    andrea.local_id = segundo.id;
    var inicio = L.addDias(hoy, -21);

    function pl(titulo, minutos, frecuencia, extra) {
      return Object.assign({ id: id('t'), titulo: titulo, detalle: null, minutos: minutos, frecuencia: frecuencia, dias_semana: [], cada_n: 1,
        dia_mes: null, fecha_inicio: inicio, fecha_unica: null, solo_pueden: [], asignar_a: null, al_pool: false, activa: true,
        momentos: [], grupos: [], local_id: principal.id, creado_por: sara.id, creado_en: new Date().toISOString() }, extra || {});
    }
    var consumibles = [
      { id: id('c'), local_id: principal.id, nombre: 'Lavaplatos', unidad: 'galón', stock: 3, minimo: 1, activo: true, orden: 1 },
      { id: id('c'), local_id: principal.id, nombre: 'Desinfectante', unidad: 'litro', stock: 8, minimo: 2, activo: true, orden: 2 },
      { id: id('c'), local_id: principal.id, nombre: 'Café', unidad: 'paquete de 500 g', stock: 4, minimo: 1, activo: true, orden: 3,
        vasitos_por_taza: 0.2, vasitos_por_unidad: 20, agua_ml_por_taza: 150 },
      { id: id('c'), local_id: principal.id, nombre: 'Tirro', unidad: 'rollo', stock: 6, minimo: 2, activo: true, orden: 4 }
    ];
    var plantillas = [
      pl('Barrer y coletear el local', 30, 'diaria', { detalle: 'Incluye detrás de las neveras y la entrada.' }),
      pl('Limpiar neveras exhibidoras', 45, 'diaria', { detalle: 'Vidrio por dentro y por fuera, bandejas y empaques.', grupos: [gLimpieza.id] }),
      pl('Ordenar el área de despacho', 20, 'diaria', { grupos: [gDespacho.id] }),
      pl('Lavar las cavas de despacho', 30, 'semanal', { dias_semana: [5], grupos: [gDespacho.id] }),
      pl('Sacar la basura y reciclaje', 10, 'diaria'),
      pl('Limpiar vidrios de la entrada', 20, 'diaria'),
      pl('Limpiar el baño', 25, 'diaria', { grupos: [gLimpieza.id] }),
      pl('Ordenar y limpiar anaqueles', 40, 'diaria', { detalle: 'Frentear productos y quitar polvo.' }),
      pl('Limpiar la rebanadora', 20, 'diaria', { detalle: 'Desarmar, lavar y secar. Con guantes.', solo_pueden: [carmen.id, jose.id] }),
      pl('Limpiar y ordenar el depósito', 60, 'semanal', { dias_semana: [3] }),
      pl('Lavar cavas y bandejas', 45, 'semanal', { dias_semana: [1, 4] }),
      pl('Limpiar lámparas y techo', 60, 'semanal', { dias_semana: [6], cada_n: 2 }),
      pl('Revisar fechas de vencimiento', 40, 'semanal', { dias_semana: [2], solo_pueden: [carmen.id] }),
      pl('Descongelar el freezer', 90, 'mensual', { dia_mes: 1 }),
      pl('Registrar temperaturas', 5, 'diaria', { registro: true, detalle: 'Mira el termómetro de cada equipo y anota si está en defrost.',
        momentos: [{ nombre: 'apertura', desde: '08:30', antes: '09:00' }, { nombre: 'mediodía', desde: '13:00', antes: '13:30' }, { nombre: 'tarde', desde: '16:00', antes: '16:30' }] }),
      pl('Prender contenedores', 5, 'diaria', { seguimiento_titulo: 'Apagar contenedores', seguimiento_despues: 45, seguimiento_minutos: 5 }),
      pl('Hacer café', 10, 'diaria', { consumible_id: consumibles[2].id, momentos: [{ nombre: '', antes: '10:00' }] }),
      pl('Fregar', 20, 'diaria', { detalle: 'Platos, vasos y la cafetera.', momentos: [{ nombre: 'después del desayuno', antes: '12:00' }, { nombre: 'después del almuerzo', antes: '16:00' }] }),
      // Segundo local: administración
      pl('Cuadre de caja del día anterior', 30, 'diaria', { local_id: segundo.id, momentos: [{ nombre: '', antes: '10:00' }] }),
      pl('Cargar facturas de compra', 45, 'diaria', { local_id: segundo.id }),
      pl('Conciliar cuentas por cobrar', 60, 'semanal', { local_id: segundo.id, dias_semana: [5] })
    ];
    var db = {
      version: 15,
      locales: [principal, segundo],
      grupos: [gDespacho, gLimpieza],
      dias_especiales: FERIADOS.map(function (x) { return { id: id('d'), fecha: x[0], local_id: null, tipo: 'libre', nombre: x[1] }; }),
      revisiones: [],
      dias_sin_puntualidad: [],
      equipos: [
        { id: id('e'), nombre: 'Contenedor 1', local_id: principal.id, temp_min: -22, temp_max: -18, activo: true, orden: 1 },
        { id: id('e'), nombre: 'Cava de quesos', local_id: principal.id, temp_min: 2, temp_max: 6, activo: true, orden: 2 },
        { id: id('e'), nombre: 'Nevera exhibidora', local_id: principal.id, temp_min: 0, temp_max: 4, activo: true, orden: 3 }
      ],
      lecturas: [],
      personas: personas,
      ajustes: { id: 1, hora_limite: '08:50', a_tiempo_hasta: '08:35', mostrar_record: false, pool_activo: false, minutos_jornada: 480, solo_en_tienda: true, usar_gps: false, revisiones_dia: 4 },
      plantillas: plantillas, asignaciones: [], asistencia: [], eventos: [],
      consumibles: consumibles, consumibles_mov: [], consumibles_pedidos: []
    };

    // Historia: 3 semanas con algunas tardanzas y faltas, para ver el reporte y el historial con datos.
    var azar = 7;
    function rnd() { azar = (azar * 9301 + 49297) % 233280; return azar / 233280; }
    function ts(f, h, m) { var p = f.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], h, m).toISOString(); }
    var emps = [jose, yuli, luis, carmen, andrea];
    for (var f = inicio; f < hoy; f = L.addDias(f, 1)) {
      emps.forEach(function (pe) {
        if (!L.trabaja(db, pe, f)) return;
        var x = rnd();
        if (x < 0.07) db.asistencia.push({ persona_id: pe.id, fecha: f, estado: 'ausente', llegada: null, marcado_por: sara.id });
        else {
          var tarde = rnd() < 0.15;
          db.asistencia.push({ persona_id: pe.id, fecha: f, estado: 'presente', llegada: tarde ? ts(f, 9, 2 + Math.floor(rnd() * 35)) : ts(f, 8, 15 + Math.floor(rnd() * 33)), marcado_por: pe.id });
        }
      });
      L.generarDia(db, f, function () { return id('a'); });
      db.asignaciones.filter(function (a) { return a.fecha <= f && a.estado === 'pendiente'; }).forEach(function (a) {
        var s = L.asistenciaDe(db, a.asignado_a, f);
        if (!s || s.estado !== 'presente') return;
        var cumple = 0.88;
        if (rnd() < cumple) {
          a.estado = 'hecha'; a.hecha_por = a.asignado_a;
          a.hecha_en = a.desde ? ts(f, Number(a.desde.slice(0, 2)), 5 + Math.floor(rnd() * 20)) : ts(f, 10 + Math.floor(rnd() * 7), Math.floor(rnd() * 59));
          if (a.registro) db.equipos.forEach(function (e) {
            var defrost = rnd() < 0.08, medio = (e.temp_min + e.temp_max) / 2, t = Math.round((medio + (rnd() - 0.5) * (e.temp_max - e.temp_min) * 0.8) * 10) / 10;
            if (rnd() < 0.04) t = Math.round((e.temp_max + 1 + rnd() * 2) * 10) / 10;
            if (defrost) t = Math.round((e.temp_max + 6 + rnd() * 4) * 10) / 10;
            var fuera = L.fueraDeRango(e, t, defrost ? 'defrost' : 'normal');
            db.lecturas.push({ id: id('r'), asignacion_id: a.id, equipo_id: e.id, fecha: f, temperatura: t, estado: defrost ? 'defrost' : 'normal', fuera_rango: fuera,
              nota: fuera ? 'Se avisó a gerencia' : null, registrado_por: a.asignado_a, registrado_en: a.hecha_en });
          });
        }
      });
    }

    // Hoy: Johandre y Yureidy llegaron a tiempo, Josbel tarde, María no ha marcado.
    var limite = L.pasoLimite(db.ajustes, ahora);
    db.asistencia.push({ persona_id: jose.id, fecha: hoy, estado: 'presente', llegada: ts(hoy, 8, 31), marcado_por: jose.id });
    db.asistencia.push({ persona_id: carmen.id, fecha: hoy, estado: 'presente', llegada: ts(hoy, 8, 44), marcado_por: carmen.id });
    if (limite) db.asistencia.push({ persona_id: yuli.id, fecha: hoy, estado: 'presente', llegada: ts(hoy, 9, 7), marcado_por: yuli.id });
    if (L.trabaja(db, andrea, hoy)) db.asistencia.push({ persona_id: andrea.id, fecha: hoy, estado: 'presente', llegada: ts(hoy, 8, 40), marcado_por: andrea.id, verificado: 'wifi' });
    db.plantillas.push(pl('Mover cajas del pedido nuevo al depósito', 30, 'unica', { fecha_unica: hoy, asignar_a: jose.id }));
    L.generarDia(db, hoy, function () { return id('a'); }, ahora);
    var hechasHoy = 0;
    db.asignaciones.forEach(function (a) {
      if (a.fecha === hoy && a.asignado_a === jose.id && hechasHoy < 2) { a.estado = 'hecha'; a.hecha_por = jose.id; a.hecha_en = ts(hoy, 8, 58 + hechasHoy); hechasHoy++; }
    });
    // Un ejemplo de justificación por revisar: la tarea semanal atrasada más reciente
    var atr = db.asignaciones.filter(function (a) { return a.fecha < hoy && a.arrastra && a.asignado_a === jose.id; })
      .sort(function (x, y) { return x.fecha < y.fecha ? 1 : -1; })[0];
    if (atr) {
      atr.estado = 'pendiente'; atr.hecha_en = null; atr.hecha_por = null;
      atr.justificacion = 'Ese día llegó un pedido grande y estuve despachando.'; atr.just_estado = 'pendiente';
    }
    db.asignaciones.forEach(function (a) {
      if (a.fecha === hoy && a.asignado_a === andrea.id && a.antes) { a.estado = 'hecha'; a.hecha_por = andrea.id; a.hecha_en = ts(hoy, 9, 12); }
    });
    return db;
  }

  return { semilla: semilla, FERIADOS: FERIADOS };
});
