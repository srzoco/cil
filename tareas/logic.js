/* Tareas CIL — reglas (sin interfaz).
   Las mismas reglas viven en supabase.sql; aquí se usan para el modo demo,
   para sugerir reasignaciones y para armar el reporte. */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.TBLogic = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TOLERANCIA = 15; // minutos de diferencia de carga que se aceptan para poder rotar
  var DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  var DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var AJUSTES_BASE = { hora_limite: '08:50', a_tiempo_hasta: '08:35', pool_activo: false, minutos_jornada: 480, solo_en_tienda: false };
  var LAB_BASE = [1, 2, 3, 4, 5, 6];

  // ---------- Fechas (siempre 'AAAA-MM-DD', hora local) ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function hoyISO(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function aFecha(iso) { var p = iso.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 12); }
  function addDias(iso, n) { var d = aFecha(iso); d.setDate(d.getDate() + n); return hoyISO(d); }
  function difDias(a, b) { return Math.round((aFecha(a) - aFecha(b)) / 86400000); }
  function dow(iso) { return aFecha(iso).getDay(); }
  function fmtFecha(iso) { var d = aFecha(iso); return DIAS_CORTOS[d.getDay()] + ' ' + d.getDate() + ' ' + MESES[d.getMonth()]; }
  function fmtFechaLarga(iso) { var d = aFecha(iso); return DIAS[d.getDay()] + ' ' + d.getDate() + ' de ' + MESES[d.getMonth()]; }
  function fmtHora(ts) {
    if (!ts) return '';
    var d = new Date(ts), h = d.getHours(), m = d.getMinutes();
    return (h % 12 || 12) + ':' + pad(m) + (h < 12 ? ' a. m.' : h === 12 ? ' del mediodía' : ' p. m.');
  }
  function fmtHoraTxt(hhmm) { // '08:50' -> '8:50 a. m.'
    var p = String(hhmm || '08:50').split(':').map(Number);
    return (p[0] % 12 || 12) + ':' + pad(p[1] || 0) + (p[0] < 12 ? ' a. m.' : p[0] === 12 ? ' del mediodía' : ' p. m.');
  }
  function minutosTxt(m) {
    m = Math.round(m || 0);
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60), r = m % 60;
    return h + ' h' + (r ? ' ' + r + ' min' : '');
  }
  // ¿Ya pasó la hora límite de hoy?
  function pasoLimite(ajustes, ahora) {
    ahora = ahora || new Date();
    var p = String((ajustes || AJUSTES_BASE).hora_limite || '08:50').split(':').map(Number);
    return ahora.getHours() * 60 + ahora.getMinutes() > p[0] * 60 + (p[1] || 0);
  }
  // «A tiempo» hasta a_tiempo_hasta (8:35); después es tarde. La hora límite (8:50) es otra cosa: desde ahí es falta.
  function aTiempoHasta(ajustes) { var a = ajustes || AJUSTES_BASE; return String(a.a_tiempo_hasta || a.hora_limite || '08:35').slice(0, 5); }
  function pasoATiempo(ajustes, ahora) {
    ahora = ahora || new Date();
    var p = aTiempoHasta(ajustes).split(':').map(Number);
    return ahora.getHours() * 60 + ahora.getMinutes() > p[0] * 60 + (p[1] || 0);
  }
  function llegoTarde(ajustes, llegada) {
    if (!llegada) return false;
    return pasoATiempo(ajustes, new Date(llegada));
  }

  function distanciaM(lat1, lng1, lat2, lng2) {
    var r = Math.PI / 180, a = Math.pow(Math.sin((lat2 - lat1) * r / 2), 2) +
      Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.pow(Math.sin((lng2 - lng1) * r / 2), 2);
    return 6371000 * 2 * Math.asin(Math.sqrt(a));
  }

  // ---------- Locales ----------
  function localDe(db, id) { return (db.locales || []).filter(function (l) { return l.id === id; })[0] || null; }
  function localPrincipal(db) {
    var ls = (db.locales || []).slice().sort(function (a, b) { return (b.principal ? 1 : 0) - (a.principal ? 1 : 0) || (a.creado_en < b.creado_en ? -1 : 1); });
    return ls[0] || null;
  }
  function labDe(db, localId) { var l = localDe(db, localId) || localPrincipal(db); return (l && l.dias_laborables) || LAB_BASE; }

  // ---------- Calendario: feriados, vacaciones y días extra (igual que _laborable / _trabaja en supabase.sql) ----------
  function especial(db, f, localId) {
    var es = db.dias_especiales || [], propio = null, general = null;
    for (var i = 0; i < es.length; i++) {
      if (es[i].fecha !== f) continue;
      if (es[i].local_id && es[i].local_id === localId) propio = es[i];
      else if (!es[i].local_id) general = es[i];
    }
    return propio || general;
  }
  function laborable(db, localId, f) {
    var e = especial(db, f, localId);
    if (e) return e.tipo === 'laborable';
    return labDe(db, localId).indexOf(dow(f)) >= 0;
  }
  function laborableFn(db, localId) { return function (f) { return laborable(db, localId, f); }; }
  function trabaja(db, pe, f) {
    var loc = localDePersona(db, pe);
    if (!laborable(db, loc, f)) return false;
    var dias = pe && pe.dias_trabajo;
    if (!dias || !dias.length || dias.indexOf(dow(f)) >= 0) return true;
    return (db.dias_especiales || []).some(function (e) { return e.fecha === f && e.tipo === 'laborable' && (!e.local_id || e.local_id === loc); });
  }
  function aFn(lab) { return typeof lab === 'function' ? lab : function (f) { return (lab || []).indexOf(dow(f)) >= 0; }; }
  function localDePersona(db, pe) { return pe && pe.local_id ? pe.local_id : ((localPrincipal(db) || {}).id || null); }

  // ---------- Hora límite de cada tarea («antes de las 12») ----------
  function hhmm(t) { return t ? String(t).slice(0, 5) : null; }
  function aMin(t) { var p = String(t).split(':').map(Number); return p[0] * 60 + (p[1] || 0); }
  // ¿Todavía no se puede marcar? (tiene «desde» y aún no llega esa hora hoy)
  function antesDeHora(a, ahora) {
    if (!a.desde || a.estado === 'hecha') return false;
    ahora = ahora || new Date();
    if (a.fecha !== hoyISO(ahora)) return a.fecha > hoyISO(ahora);
    return ahora.getHours() * 60 + ahora.getMinutes() < aMin(hhmm(a.desde));
  }
  // ---------- Rescate de tareas con horario (igual que _urgente / _excusado en supabase.sql) ----------
  function tsHoy(f, hm) { var p = f.split('-').map(Number), h = String(hm).split(':').map(Number); return new Date(p[0], p[1] - 1, p[2], h[0], h[1] || 0).getTime(); }
  function fueraEn(db, personaId, ts) {
    return (db.salidas_rato || []).some(function (x) { return x.persona_id === personaId && new Date(x.salio).getTime() <= ts && (!x.volvio || new Date(x.volvio).getTime() > ts); });
  }
  function esUrgente(db, a, ahora) {
    ahora = ahora || new Date();
    if (a.estado !== 'pendiente' || a.fecha !== hoyISO(ahora) || !a.desde || !a.antes || !a.asignado_a) return false;
    var ini = tsHoy(a.fecha, hhmm(a.desde)), fin = tsHoy(a.fecha, hhmm(a.antes)), t = ahora.getTime();
    if (fin <= ini) return false;
    if (t >= ini + (fin - ini) / 2) return true;
    return !!(db.ajustes && db.ajustes.usar_salidas) && t >= ini && fueraEn(db, a.asignado_a, ini);
  }
  // ¿Tiene excusa quien la tenía? Sin el botón «Salí a despachar» no se puede saber: no se marca incumplida.
  function excusado(db, a) {
    if (!(db.ajustes && db.ajustes.usar_salidas)) return true;
    if (fueraEn(db, a.asignado_a, tsHoy(a.fecha, hhmm(a.desde)))) return true;
    var s = asistenciaDe(db, a.asignado_a, a.fecha);
    return !(s && s.estado === 'presente' && !s.salida);
  }
  function estaFuera(db, personaId, f) { return (db.salidas_rato || []).some(function (x) { return x.persona_id === personaId && x.fecha === f && !x.volvio; }); }

  // 'ok' (sin hora o a tiempo) | 'vencida' (pendiente y ya pasó la hora) | 'tarde' (hecha después de la hora)
  function estadoHora(a, ahora) {
    if (!a.antes) return 'ok';
    var lim = aMin(hhmm(a.antes));
    if (a.estado === 'hecha') {
      if (!a.hecha_en) return 'ok';
      var d = new Date(a.hecha_en);
      if (hoyISO(d) > a.fecha) return 'tarde';
      return d.getHours() * 60 + d.getMinutes() > lim ? 'tarde' : 'ok';
    }
    ahora = ahora || new Date();
    var hoy = hoyISO(ahora);
    if (a.fecha < hoy) return 'vencida';
    if (a.fecha > hoy) return 'ok';
    return ahora.getHours() * 60 + ahora.getMinutes() > lim ? 'vencida' : 'ok';
  }

  // ---------- Calendario de cada tarea ----------
  function siguienteLaborable(iso, lab) {
    var es = aFn(lab), x = iso;
    for (var i = 0; i < 60 && !es(x); i++) x = addDias(x, 1);
    return x;
  }
  function diaDelMes(iso, dia) {
    var d = aFecha(iso), ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12).getDate();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(Math.min(dia, ultimo));
  }
  function mesSiguiente(iso) { var d = aFecha(iso); d.setDate(1); d.setMonth(d.getMonth() + 1); return hoyISO(d); }
  function anteriorLaborable(iso, lab) {
    var es = aFn(lab), x = iso;
    for (var i = 0; i < 60 && !es(x); i++) x = addDias(x, -1);
    return x;
  }
  function lunesDe(iso) { return addDias(iso, -((dow(iso) + 6) % 7)); }

  // ¿Le tocaba a una semanal ese día según su calendario (sin mirar feriados)?
  function semanalCae(p, d) {
    return d >= p.fecha_inicio && (p.dias_semana || []).indexOf(dow(d)) >= 0 &&
      Math.floor(difDias(d, lunesDe(p.fecha_inicio)) / 7) % (p.cada_n || 1) === 0;
  }
  // Igual que _toca: las diarias no salen en días libres; las semanales y mensuales se adelantan al día de trabajo anterior.
  function toca(p, f, lab) {
    var esLab = aFn(lab);
    if (p.frecuencia === 'unica') return f === p.fecha_unica;
    if (f < p.fecha_inicio) return false;
    if (!esLab(f)) return false;
    if (p.frecuencia === 'diaria') return true;
    if (p.frecuencia === 'semanal') {
      if (semanalCae(p, f)) return true;
      for (var i = 1; i <= 60; i++) {
        var d = addDias(f, i);
        if (esLab(d)) break;
        if (semanalCae(p, d)) return true;
      }
      return false;
    }
    if (p.frecuencia === 'mensual') {
      // Cada N meses (cada_n), contando desde el mes de fecha_inicio
      var cae = function (iso) { var n = p.cada_n || 1; var m = (Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7))) - (Number(p.fecha_inicio.slice(0, 4)) * 12 + Number(p.fecha_inicio.slice(5, 7))); return ((m % n) + n) % n === 0; };
      var d1 = diaDelMes(f, p.dia_mes), d2 = diaDelMes(mesSiguiente(f), p.dia_mes);
      return (cae(d1) && f === anteriorLaborable(d1, esLab)) || (cae(d2) && f === anteriorLaborable(d2, esLab));
    }
    return false;
  }

  function frecuenciaTxt(p) {
    if (p.frecuencia === 'diaria') return 'Todos los días';
    if (p.frecuencia === 'unica') return 'Una vez · ' + fmtFecha(p.fecha_unica);
    if (p.frecuencia === 'mensual') return ((p.cada_n || 1) > 1 ? 'Cada ' + p.cada_n + ' meses' : 'Cada mes') + ', día ' + p.dia_mes;
    var dias = (p.dias_semana || []).slice().sort(function (a, b) { return ((a + 6) % 7) - ((b + 6) % 7); })
      .map(function (d) { return DIAS_CORTOS[d].toLowerCase(); }).join(', ');
    return (p.cada_n > 1 ? 'Cada ' + p.cada_n + ' semanas: ' : 'Cada semana: ') + dias;
  }

  // Próximas fechas en que toca (para mostrar en la ficha de la tarea)
  function proximas(p, desde, lab, n) {
    var out = [], f = desde;
    for (var i = 0; i < 400 && out.length < (n || 3); i++) { if (toca(p, f, lab)) out.push(f); f = addDias(f, 1); }
    return out;
  }

  // ---------- Equipos de frío ----------
  // Equipos que pide una tarea con registro: los elegidos en la tarea, o todos los activos de su local
  function equiposDe(db, localId, conEquipos) {
    var sel = (conEquipos && conEquipos.equipos) || [];
    return (db.equipos || []).filter(function (e) { return e.activo !== false && (e.local_id || null) === (localId || null) && (!sel.length || sel.indexOf(e.id) >= 0); })
      .sort(function (a, b) { return (a.orden || 0) - (b.orden || 0) || (a.nombre < b.nombre ? -1 : 1); });
  }
  // En defrost o apagado no se marca fuera de rango
  function fueraDeRango(e, temp, estado) {
    if (estado !== 'normal' || temp === null || temp === undefined || temp === '') return false;
    var t = Number(temp);
    return (e.temp_min !== null && e.temp_min !== undefined && e.temp_min !== '' && t < Number(e.temp_min)) ||
           (e.temp_max !== null && e.temp_max !== undefined && e.temp_max !== '' && t > Number(e.temp_max));
  }
  function rangoTxt(e) {
    var mn = e.temp_min !== null && e.temp_min !== undefined && e.temp_min !== '', mx = e.temp_max !== null && e.temp_max !== undefined && e.temp_max !== '';
    if (mn && mx) return Number(e.temp_min) + ' a ' + Number(e.temp_max) + ' °C';
    if (mn) return 'mín. ' + Number(e.temp_min) + ' °C';
    if (mx) return 'máx. ' + Number(e.temp_max) + ' °C';
    return '';
  }

  // ---------- Carga y estado ----------
  // Empleado de Tareas: activo, no es gerencia y tiene el acceso «tareas» (en la app unificada cada persona tiene sus módulos)
  function esEmpleadoActivo(pe) { return pe.activo && pe.rol === 'empleado' && (!pe.accesos || pe.accesos.indexOf('tareas') >= 0); }
  // Minutos que tiene alguien un día: lo de ese día + lo atrasado con justificación aprobada.
  // Lo atrasado sin justificar no cuenta: se recupera sin que le bajen trabajo nuevo.
  function carga(asigs, personaId, f) {
    return asigs.reduce(function (s, a) {
      if (a.asignado_a !== personaId) return s;
      if (a.fecha === f || (a.arrastra && a.estado === 'pendiente' && a.fecha < f && a.just_estado === 'aprobada')) return s + a.minutos;
      return s;
    }, 0);
  }
  function cabeEn(pe, minutos) { return !(pe && pe.tarea_max) || minutos <= pe.tarea_max; }
  function capacidad(pe) { return Math.max(10, Math.min(100, (pe && pe.capacidad) || 100)); }
  // Carga en proporción a su tiempo para tareas: 60 min al 50% pesan como 120 min.
  function cargaRelativa(asigs, pe, f) { return carga(asigs, pe.id, f) * 100 / capacidad(pe); }
  function asistenciaDe(db, personaId, f) {
    return (db.asistencia || []).filter(function (s) { return s.persona_id === personaId && s.fecha === f; })[0] || null;
  }
  // 'presente' | 'tarde' | 'ausente' (marcado por gerencia) | 'falta' (pasó la hora y no marcó) | 'sin_marcar'
  function estadoAsistencia(db, personaId, f, ahora) {
    var s = asistenciaDe(db, personaId, f), aj = db.ajustes || AJUSTES_BASE;
    if (s && s.estado === 'presente') return llegoTarde(aj, s.llegada) ? 'tarde' : 'presente';
    if (s && s.estado === 'ausente') return 'ausente';
    var pe = persona(db, personaId);
    if (pe && !trabaja(db, pe, f)) return 'libre';
    if (pe && pe.creado_en && f < hoyISO(new Date(pe.creado_en))) return 'libre';
    var hoy = hoyISO(ahora);
    if (f < hoy || (f === hoy && pasoLimite(aj, ahora))) return 'falta';
    return 'sin_marcar';
  }
  function estaPresente(estado) { return estado === 'presente' || estado === 'tarde'; }
  // Igual que _puntualidad en supabase.sql: días que contaban este mes y cuántos llegó a tiempo.
  function sinPuntualidad(db, f) { return (db.dias_sin_puntualidad || []).some(function (x) { return x.fecha === f; }); }
  function puntualidadMes(db, personaId, hoy) {
    var pe = persona(db, personaId), aj = db.ajustes || AJUSTES_BASE, r = { dias: 0, a_tiempo: 0 };
    if (!pe) return r;
    var f = hoy.slice(0, 8) + '01';
    if (pe.creado_en && hoyISO(new Date(pe.creado_en)) > f) f = hoyISO(new Date(pe.creado_en));
    for (; f <= hoy; f = addDias(f, 1)) {
      if (sinPuntualidad(db, f)) continue;
      var s = asistenciaDe(db, personaId, f);
      var cuenta = f === hoy ? !!(s && s.estado === 'presente') : (!!s || trabaja(db, pe, f));
      if (!cuenta) continue;
      r.dias++;
      if (s && s.estado === 'presente' && !llegoTarde(aj, s.llegada)) r.a_tiempo++;
    }
    return r;
  }
  // ¿Marcó «Me voy antes» ese día?
  function seFue(db, personaId, f) { var s = asistenciaDe(db, personaId, f); return !!(s && s.estado === 'presente' && s.salida); }

  function plantillaDe(db, id) { return (db.plantillas || []).filter(function (p) { return p.id === id; })[0] || null; }
  // ¿Puede esta persona hacer la tarea? Personas específicas, o grupos, o cualquiera.
  function puedeSegun(p, pe) {
    var solo = (p && p.solo_pueden) || [], gr = (p && p.grupos) || [];
    if (solo.length) return solo.indexOf(pe.id) >= 0;
    if (gr.length) return (pe.grupos || []).some(function (g) { return gr.indexOf(g) >= 0; });
    return pe.rota !== false;  // el personal administrativo no entra en las tareas «para cualquiera»
  }
  function puedeHacer(db, a, personaId) {
    var p = a.plantilla_id ? plantillaDe(db, a.plantilla_id) : null;
    var pe = persona(db, personaId);
    return !p || !pe ? true : puedeSegun(p, pe);
  }

  // Igual que _elegir_persona en supabase.sql
  function elegirPersona(db, p, f, ahora, excluir) {
    var asigs = db.asignaciones;
    excluir = excluir || [];
    var soloPresentes = p.frecuencia === 'unica' && f === hoyISO(ahora) && pasoLimite(db.ajustes, ahora);
    var cand = db.personas.filter(function (pe) {
      if (!esEmpleadoActivo(pe)) return false;
      if (excluir.indexOf(pe.id) >= 0) return false;  // ya tiene otro puesto de esta misma tarea
      if (localDePersona(db, pe) !== p.local_id) return false;
      if (!trabaja(db, pe, f)) return false;
      if (!puedeSegun(p, pe)) return false;
      var s = asistenciaDe(db, pe.id, f);
      if (s && (s.estado === 'ausente' || s.salida)) return false;
      return !soloPresentes || !!(s && s.estado === 'presente');
    }).map(function (pe) {
      var ultima = null;
      asigs.forEach(function (a) {
        if (a.plantilla_id === p.id && a.asignado_a === pe.id && a.fecha < f && (!ultima || a.fecha > ultima)) ultima = a.fecha;
      });
      return { id: pe.id, nombre: pe.nombre || '', carga: cargaRelativa(asigs, pe, f), ultima: ultima, cabe: cabeEn(pe, p.minutos) };
    });
    if (!cand.length) return null;
    // Si a alguien le cabe en su tope por tarea, solo entre esos; si no, entre todos.
    if (cand.some(function (c) { return c.cabe; })) cand = cand.filter(function (c) { return c.cabe; });
    var min = Math.min.apply(null, cand.map(function (c) { return c.carga; }));
    cand = cand.filter(function (c) { return c.carga <= min + TOLERANCIA + 1e-9; });
    cand.sort(function (a, b) {
      if (a.ultima !== b.ultima) { if (a.ultima === null) return -1; if (b.ultima === null) return 1; return a.ultima < b.ultima ? -1 : 1; }
      if (a.carga !== b.carga) return a.carga - b.carga;
      if (a.nombre !== b.nombre) return a.nombre < b.nombre ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
    return cand[0].id;
  }

  function ordenGeneracion(a, b) {
    function k(p) { return p.frecuencia === 'unica' && (p.asignar_a || p.al_pool) ? 0 : 1; }
    var la = (a.solo_pueden || []).length, lb = (b.solo_pueden || []).length;
    var la0 = la === 0 && !(a.grupos || []).length, lb0 = lb === 0 && !(b.grupos || []).length;
    if (k(a) !== k(b)) return k(a) - k(b);
    if (la0 !== lb0) return la0 ? 1 : -1;
    if (la !== lb) return la - lb;
    var ma = a.minutos * Math.max(1, (a.momentos || []).length), mb = b.minutos * Math.max(1, (b.momentos || []).length);
    if (ma !== mb) return mb - ma;
    return a.titulo < b.titulo ? -1 : 1;
  }

  // Igual que generar_dia: devuelve las asignaciones nuevas (y las agrega a db.asignaciones).
  function generarDia(db, f, nuevoId, ahora) {
    var nuevas = [];
    var principal = (localPrincipal(db) || {}).id || null;
    db.plantillas.forEach(function (p) { if (!p.local_id) p.local_id = principal; });
    db.plantillas.filter(function (p) {
      return p.activa && toca(p, f, laborableFn(db, p.local_id)) && !db.asignaciones.some(function (a) { return a.plantilla_id === p.id && a.fecha === f; });
    }).sort(ordenGeneracion).forEach(function (p) {
      // Tareas de varias personas: un «puesto» por persona; cada una recibe los minutos completos
      var elegidos = [];
      for (var puesto = 0; puesto < personasDe(p); puesto++) {
      var quien, mot;
      if (p.frecuencia === 'unica' && p.al_pool) { quien = null; mot = 'pool'; }
      else if (p.frecuencia === 'unica' && p.asignar_a && puesto === 0) { quien = p.asignar_a; mot = 'fija'; }
      else { quien = elegirPersona(db, p, f, ahora, elegidos); mot = quien ? 'rotacion' : 'pool'; }
      if (quien) elegidos.push(quien);
      var momentos = (p.momentos && p.momentos.length) ? p.momentos : [null];
      momentos.forEach(function (m, i) {
        var a = {
          id: nuevoId(), plantilla_id: p.id, fecha: f, titulo: p.titulo, detalle: p.detalle || null, minutos: p.minutos,
          arrastra: p.frecuencia !== 'diaria', asignado_a: quien, asignado_original: quien, motivo: mot,
          estado: 'pendiente', hecha_en: null, hecha_por: null, creado_en: new Date().toISOString(),
          local_id: p.local_id, momento: i, momento_nombre: (m && String(m.nombre || '').trim()) || null, antes: (m && m.antes) || null,
          desde: (m && m.desde) || null, registro: !!p.registro, equipos: (p.equipos || []).slice(), puesto: puesto
        };
        db.asignaciones.push(a);
        nuevas.push(a);
      });
      }
    });
    return nuevas;
  }
  function personasDe(p) { var n = Number(p && p.personas) || 1; return Math.max(1, Math.min(5, n)); }
  // Los otros puestos de la misma tarea (mismo día y misma vez)
  function companerosDe(db, a) {
    if (!a || !a.plantilla_id) return [];
    return db.asignaciones.filter(function (b) { return b.id !== a.id && b.plantilla_id === a.plantilla_id && b.fecha === a.fecha && b.momento === a.momento && (b.puesto || 0) !== (a.puesto || 0); });
  }

  // ---------- Lo que ve cada quien ----------
  // Tareas de una persona para el día f: las de hoy + las atrasadas que arrastran.
  function tareasDe(db, personaId, f) {
    var hoy = [], atrasadas = [];
    db.asignaciones.forEach(function (a) {
      if (a.asignado_a !== personaId) return;
      if (a.fecha === f) hoy.push(a);
      else if (a.fecha < f && a.arrastra && a.estado === 'pendiente') atrasadas.push(a);
    });
    var ord = function (x, y) {
      if (x.estado !== y.estado) return x.estado === 'pendiente' ? -1 : 1;
      // primero lo que tiene hora, por hora
      var ax = x.desde || x.antes ? hhmm(x.desde || x.antes) : '99', ay = y.desde || y.antes ? hhmm(y.desde || y.antes) : '99';
      if (ax !== ay) return ax < ay ? -1 : 1;
      if (x.minutos !== y.minutos) return y.minutos - x.minutos;
      if (x.titulo !== y.titulo) return x.titulo < y.titulo ? -1 : 1;
      return (x.momento || 0) - (y.momento || 0);
    };
    atrasadas.sort(function (x, y) { return x.fecha < y.fecha ? -1 : 1; });
    return { hoy: hoy.sort(ord), atrasadas: atrasadas };
  }
  function delPool(db, f, localId) {
    return db.asignaciones.filter(function (a) { return a.asignado_a === null && a.estado === 'pendiente' && (a.fecha === f || (a.fecha < f && a.arrastra)) && (!localId || a.local_id === localId); })
      .sort(function (x, y) { return x.fecha < y.fecha ? -1 : x.fecha > y.fecha ? 1 : y.minutos - x.minutos; });
  }

  // ---------- Reasignación sugerida por ausencias ----------
  // Devuelve [{asignacion, de, sugerido}] para las tareas pendientes de quienes faltan.
  function sugerirReasignacion(db, f, ahora, localId) {
    var emps = db.personas.filter(function (pe) { return esEmpleadoActivo(pe) && (!localId || localDePersona(db, pe) === localId); });
    var estados = {};
    emps.forEach(function (pe) { estados[pe.id] = estadoAsistencia(db, pe.id, f, ahora); });
    var fueron = {};
    emps.forEach(function (pe) { fueron[pe.id] = seFue(db, pe.id, f); });
    var faltan = emps.filter(function (pe) { return estados[pe.id] === 'ausente' || estados[pe.id] === 'falta' || fueron[pe.id]; });
    if (!faltan.length) return { faltan: [], items: [], sinCobertura: [], seFueron: [] };
    var presentes = emps.filter(function (pe) { return estaPresente(estados[pe.id]) && !fueron[pe.id]; });
    var cargas = {};
    // misma regla que el reparto: lo atrasado sin justificación aprobada no cuenta como carga
    presentes.forEach(function (pe) { cargas[pe.id] = cargaRelativa(db.asignaciones, pe, f); });
    var items = [];
    faltan.forEach(function (pe) {
      var t = tareasDe(db, pe.id, f);
      t.hoy.concat(t.atrasadas).forEach(function (a) { if (a.estado === 'pendiente') items.push({ asignacion: a, de: pe.id }); });
    });
    items.sort(function (x, y) {
      var rx = puedenCuantos(db, x.asignacion, presentes), ry = puedenCuantos(db, y.asignacion, presentes);
      if (rx !== ry) return rx - ry;
      return y.asignacion.minutos - x.asignacion.minutos;
    });
    var porGrupo = {};
    items.forEach(function (it) {
      var a = it.asignacion;
      var mismoLocal = presentes.filter(function (pe) { return localDePersona(db, pe) === (a.local_id || localDePersona(db, persona(db, it.de))); });
      var ok = mismoLocal.filter(function (pe) { return puedeHacer(db, a, pe.id); });
      ok.sort(function (x, y) {
        var cx = cabeEn(x, a.minutos), cy = cabeEn(y, a.minutos);
        if (cx !== cy) return cx ? -1 : 1;
        return cargas[x.id] - cargas[y.id] || (x.nombre < y.nombre ? -1 : 1);
      });
      // las varias veces del día de una misma tarea van a la misma persona
      var g = a.plantilla_id ? a.plantilla_id + '|' + a.fecha : null;
      it.sugerido = g && porGrupo[g] !== undefined ? porGrupo[g] : (ok.length ? ok[0].id : null);
      if (g) porGrupo[g] = it.sugerido;
      it.opciones = ok.map(function (pe) { return pe.id; });
      if (it.sugerido) cargas[it.sugerido] += a.minutos * 100 / capacidad(persona(db, it.sugerido));
    });
    // Si nadie de su local puede hacerla (p. ej. falta la única persona del segundo local), queda pendiente con su dueño.
    var sinCobertura = items.filter(function (it) { return !it.opciones.length; });
    items = items.filter(function (it) { return it.opciones.length; });
    var faltanCon = faltan.filter(function (pe) { return items.some(function (it) { return it.de === pe.id; }); });
    return { faltan: faltanCon.map(function (pe) { return pe.id; }), items: items, sinCobertura: sinCobertura,
      seFueron: faltanCon.filter(function (pe) { return fueron[pe.id]; }).map(function (pe) { return pe.id; }) };
  }
  // Reparto automático a la hora límite (igual que repartir_faltas en el SQL). Devuelve [{ id, a, oculta }] sin modificar db.
  // Primero a quienes llegaron tarde (el de último primero) mientras no pasen 30 de carga sobre el promedio;
  // lo demás a quien tenga menos carga (empate: quien llegó más tarde). Si nadie puede, al de menos carga pero oculta.
  function repartoAutomatico(db, f, localId) {
    var aj = db.ajustes || AJUSTES_BASE;
    var pres = db.personas.filter(function (pe) {
      if (!esEmpleadoActivo(pe) || localDePersona(db, pe) !== localId) return false;
      var s = asistenciaDe(db, pe.id, f); return !!(s && s.estado === 'presente' && !s.salida);
    }).map(function (pe) {
      var s = asistenciaDe(db, pe.id, f);
      return { id: pe.id, pe: pe, nombre: pe.nombre || '', carga: cargaRelativa(db.asignaciones, pe, f), cap: capacidad(pe), llegada: s.llegada, tarde: llegoTarde(aj, s.llegada) };
    });
    var faltan = db.personas.filter(function (pe) {
      if (!esEmpleadoActivo(pe) || localDePersona(db, pe) !== localId || !trabaja(db, pe, f)) return false;
      var s = asistenciaDe(db, pe.id, f); return !(s && s.estado === 'presente');
    }).map(function (pe) { return pe.id; });
    var puede = function (a, x) { return puedeHacer(db, a, x.id); };
    var items = db.asignaciones.filter(function (a) {
      return a.estado === 'pendiente' && !a.oculta && (a.fecha === f || (a.fecha < f && a.arrastra)) && faltan.indexOf(a.asignado_a) >= 0;
    }).map(function (a) { return { a: a, pueden: pres.filter(function (x) { return puede(a, x); }).length }; });
    items.sort(function (x, y) { return x.pueden - y.pueden || y.a.minutos - x.a.minutos || (x.a.id < y.a.id ? -1 : 1); });
    var porGrupo = {}, res = [];
    var porLlegadaDesc = function (x, y) { return x.llegada < y.llegada ? 1 : x.llegada > y.llegada ? -1 : (x.id < y.id ? -1 : 1); };
    items.forEach(function (it) {
      var a = it.a, g = (a.plantilla_id || a.id) + '|' + a.fecha + '|' + (a.puesto || 0), q = porGrupo[g], oc = false;
      if (q) { oc = q.oc; q = q.id; }
      else {
        var prom = pres.reduce(function (s, x) { return s + x.carga; }, 0) / Math.max(1, pres.length);
        var ok = pres.filter(function (x) {
          return puede(a, x) && !db.asignaciones.some(function (b) { return b.plantilla_id && b.plantilla_id === a.plantilla_id && b.fecha === a.fecha && b.momento === a.momento && b.asignado_a === x.id; });
        });
        if (ok.some(function (x) { return cabeEn(x.pe, a.minutos); })) ok = ok.filter(function (x) { return cabeEn(x.pe, a.minutos); });
        var t = ok.filter(function (x) { return x.tarde && x.carga + a.minutos * 100 / x.cap <= prom + 30 + 1e-9; }).sort(porLlegadaDesc)[0];
        var elegido = t || ok.slice().sort(function (x, y) { return x.carga - y.carga || porLlegadaDesc(x, y) || (x.nombre < y.nombre ? -1 : x.nombre > y.nombre ? 1 : 0); })[0];
        if (!elegido) { elegido = pres.slice().sort(function (x, y) { return x.carga - y.carga || porLlegadaDesc(x, y) || (x.nombre < y.nombre ? -1 : x.nombre > y.nombre ? 1 : 0); })[0]; oc = !!elegido; }
        q = elegido ? elegido.id : null;
        if (q) porGrupo[g] = { id: q, oc: oc };
      }
      if (!q) return;
      res.push({ id: a.id, de: a.asignado_a, a: q, oculta: oc });
      pres.forEach(function (x) { if (x.id === q) x.carga += a.minutos * 100 / x.cap; });
    });
    return res;
  }
  function persona(db, id) { return db.personas.filter(function (p) { return p.id === id; })[0] || null; }
  function puedenCuantos(db, a, gente) { return gente.filter(function (pe) { return puedeHacer(db, a, pe.id); }).length; }

  // ---------- Reporte del día ----------
  function reporteDia(db, f, ahora, localId) {
    var aj = db.ajustes || AJUSTES_BASE;
    return db.personas.filter(function (pe) { return esEmpleadoActivo(pe) && (!localId || localDePersona(db, pe) === localId); }).map(function (pe) {
      var t = tareasDe(db, pe.id, f);
      var todas = t.hoy.concat(t.atrasadas);
      // lo atrasado que hizo ese día también cuenta como hecho ese día
      var hechasOtroDia = db.asignaciones.filter(function (a) {
        return a.hecha_por === pe.id && a.estado === 'hecha' && a.fecha < f && a.hecha_en && hoyISO(new Date(a.hecha_en)) === f;
      });
      var hechas = t.hoy.filter(function (a) { return a.estado === 'hecha'; }).concat(hechasOtroDia);
      var pendientes = todas.filter(function (a) { return a.estado === 'pendiente'; });
      var s = asistenciaDe(db, pe.id, f);
      var sum = function (l) { return l.reduce(function (x, a) { return x + a.minutos; }, 0); };
      return {
        hechasTarde: hechas.filter(function (a) { return estadoHora(a, ahora) === 'tarde'; }),
        persona: pe,
        estado: estadoAsistencia(db, pe.id, f, ahora),
        llegada: s && s.llegada,
        salida: s && s.estado === 'presente' ? s.salida || null : null,
        incumplidas: db.asignaciones.filter(function (a) { return a.rescatada_de === pe.id && a.incumplida && a.fecha === f; }),
        rescates: db.asignaciones.filter(function (a) { return a.asignado_a === pe.id && a.motivo === 'rescate' && a.fecha === f; }),
        salidaMotivo: s && s.salida_motivo || null,
        hechas: hechas,
        pendientes: pendientes,
        minHechos: sum(hechas),
        minPendientes: sum(pendientes),
        minAsignados: sum(hechas) + sum(pendientes),
        jornada: Math.round(aj.minutos_jornada * capacidad(pe) / 100),
        local: s && s.local_id ? s.local_id : null
      };
    });
  }

  function tituloCompleto(a) { return a.titulo + (a.momento_nombre ? ' · ' + a.momento_nombre : ''); }
  // rep: lista de reporteDia; nombreLocal(id) -> nombre, solo si hay más de un local
  function textoReporte(rep, f, nombreLocal, db) {
    var l = ['*Reporte de tareas · ' + fmtFechaLarga(f) + '*'];
    var EST = { presente: '✅ Llegó', tarde: '⏰ Llegó tarde', ausente: '❌ No vino', falta: '❌ No marcó llegada', sin_marcar: '… Sin marcar', libre: '— No trabaja este día' };
    var ultimo = null;
    rep.forEach(function (r) {
      var loc = db ? localDePersona(db, r.persona) : null;
      if (nombreLocal && loc !== ultimo) { l.push('', '— *' + nombreLocal(loc).toUpperCase() + '* —'); ultimo = loc; }
      l.push('');
      l.push('*' + (r.persona.nombre || 'Sin nombre') + '* — ' + EST[r.estado] + (r.llegada ? ' ' + fmtHora(r.llegada) : '') +
        (r.salida ? ' · se fue ' + fmtHora(r.salida) + (r.salidaMotivo ? ' (' + r.salidaMotivo + ')' : '') : '') +
        (nombreLocal && r.local && r.local !== loc ? ' (vino a ' + nombreLocal(r.local) + ')' : ''));
      var total = r.hechas.length + r.pendientes.length;
      if (!total) { l.push('Sin tareas.'); return; }
      l.push('Hizo ' + r.hechas.length + ' de ' + total + ' (' + minutosTxt(r.minHechos) + ' de ' + minutosTxt(r.minAsignados) + ')');
      if (r.hechasTarde && r.hechasTarde.length) l.push('Hechas después de su hora: ' + r.hechasTarde.map(tituloCompleto).join(', '));
      if (r.incumplidas && r.incumplidas.length) l.push('Se le pasó (la hizo otra persona): ' + r.incumplidas.map(tituloCompleto).join(', '));
      if (r.pendientes.length) {
        l.push('Pendiente: ' + r.pendientes.map(function (a) { return tituloCompleto(a) + ' (' + a.minutos + ' min)'; }).join(', '));
        if (r.minAsignados < r.jornada * 0.8 && estaPresente(r.estado)) l.push('_Tenía ' + minutosTxt(r.minAsignados) + ' asignados y ' + minutosTxt(r.jornada) + ' de su jornada para tareas._');
      }
    });
    var sinAsignar = rep.sinAsignar || [];
    if (sinAsignar.length) l.push('', 'Sin asignar: ' + sinAsignar.map(tituloCompleto).join(', '));
    return l.join('\n').trim();
  }

  // ---------- Historial (últimos N días) ----------
  function historial(db, hasta, dias, ahora) {
    var desde = addDias(hasta, -(dias - 1));
    // No contar como faltas los días antes de empezar a usar la app (ni antes de que la persona entrara)
    var primero = null;
    (db.asignaciones || []).forEach(function (x) { if (!primero || x.fecha < primero) primero = x.fecha; });
    (db.asistencia || []).forEach(function (x) { if (!primero || x.fecha < primero) primero = x.fecha; });
    return db.personas.filter(esEmpleadoActivo).map(function (pe) {
      var r = { persona: pe, dias: 0, tardes: 0, faltas: 0, salidas: 0, incumplidas: 0, rescates: 0, asignadas: 0, hechas: 0, minHechos: 0, fueraDeHora: 0 };

      var inicio = desde;
      if (primero && primero > inicio) inicio = primero;
      if (pe.creado_en && hoyISO(new Date(pe.creado_en)) > inicio) inicio = hoyISO(new Date(pe.creado_en));
      for (var f = inicio; f <= hasta; f = addDias(f, 1)) {
        var asigsDia = db.asignaciones.filter(function (a) { return a.asignado_a === pe.id && a.fecha === f; });
        if (!trabaja(db, pe, f) && !asigsDia.length) continue;
        if (f === hasta && !pasoLimite(db.ajustes, ahora) && hasta === hoyISO(ahora)) continue;
        var e = estadoAsistencia(db, pe.id, f, ahora);
        if (estaPresente(e)) r.dias++;
        if (e === 'tarde' && !sinPuntualidad(db, f)) r.tardes++;
        if (e === 'ausente' || e === 'falta') r.faltas++;
        if (seFue(db, pe.id, f)) r.salidas++;
        db.asignaciones.forEach(function (a) {
          if (a.fecha !== f) return;
          if (a.rescatada_de === pe.id && a.incumplida) r.incumplidas++;
          if (a.asignado_a === pe.id && a.motivo === 'rescate') r.rescates++;
        });
        asigsDia.forEach(function (a) {
          r.asignadas++;
          if (a.estado === 'hecha') { r.hechas++; r.minHechos += a.minutos; }
          if (estadoHora(a, ahora) !== 'ok') r.fueraDeHora++;
        });
      }
      r.cumplimiento = r.asignadas ? Math.round(100 * r.hechas / r.asignadas) : null;
      return r;
    });
  }

  // Carga típica: minutos que toca hacer cada día laborable en promedio (próximas 4 semanas)
  function cargaTipica(db, desde, localId) {
    var esLab = laborableFn(db, localId), total = 0, dias = 0;
    for (var i = 0; i < 28; i++) {
      var f = addDias(desde, i);
      if (!esLab(f)) continue;
      dias++;
      db.plantillas.forEach(function (p) {
        if (p.activa && p.frecuencia !== 'unica' && (!localId || p.local_id === localId) && toca(p, f, esLab)) total += p.minutos * Math.max(1, (p.momentos || []).length);
      });
    }
    return dias ? Math.round(total / dias) : 0;
  }

  return {
    TOLERANCIA: TOLERANCIA, DIAS: DIAS, DIAS_CORTOS: DIAS_CORTOS, AJUSTES_BASE: AJUSTES_BASE,
    hoyISO: hoyISO, addDias: addDias, difDias: difDias, dow: dow, fmtFecha: fmtFecha, fmtFechaLarga: fmtFechaLarga,
    fmtHora: fmtHora, fmtHoraTxt: fmtHoraTxt, minutosTxt: minutosTxt, pasoLimite: pasoLimite, llegoTarde: llegoTarde,
    aTiempoHasta: aTiempoHasta, pasoATiempo: pasoATiempo, puntualidadMes: puntualidadMes, sinPuntualidad: sinPuntualidad,
    toca: toca, distanciaM: distanciaM, estadoHora: estadoHora, antesDeHora: antesDeHora,
    equiposDe: equiposDe, fueraDeRango: fueraDeRango, rangoTxt: rangoTxt, esUrgente: esUrgente, excusado: excusado, estaFuera: estaFuera, fueraEn: fueraEn, hhmm: hhmm, tituloCompleto: tituloCompleto,
    localDe: localDe, localPrincipal: localPrincipal, labDe: labDe, laborable: laborable, laborableFn: laborableFn, trabaja: trabaja, especial: especial, localDePersona: localDePersona, frecuenciaTxt: frecuenciaTxt, proximas: proximas, siguienteLaborable: siguienteLaborable,
    seFue: seFue, anteriorLaborable: anteriorLaborable, carga: carga, capacidad: capacidad, cabeEn: cabeEn, estadoAsistencia: estadoAsistencia, estaPresente: estaPresente, asistenciaDe: asistenciaDe,
    esEmpleadoActivo: esEmpleadoActivo, plantillaDe: plantillaDe, puedeHacer: puedeHacer,
    elegirPersona: elegirPersona, puedeSegun: puedeSegun, generarDia: generarDia, repartoAutomatico: repartoAutomatico, personasDe: personasDe, companerosDe: companerosDe, tareasDe: tareasDe, delPool: delPool,
    sugerirReasignacion: sugerirReasignacion, reporteDia: reporteDia, textoReporte: textoReporte,
    historial: historial, cargaTipica: cargaTipica
  };
});
