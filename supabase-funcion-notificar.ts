// @ts-nocheck
// Contenido Barquero — función «notificar» (Supabase Edge Function).
// Pegar completo en Supabase → Edge Functions → Deploy a new function → Via Editor, con el nombre: notificar
// Después: en la función, desactivar «Verify JWT» (Enforce JWT verification).
var self = globalThis;

/* Contenido Barquero — reglas del flujo (sin interfaz).
   Funciona en el navegador (window.BFLogic) y en Node (pruebas). */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.BFLogic = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- Constantes ----------
  var PLATAFORMAS = { ig: 'Instagram', tt: 'TikTok' };
  var PLAT_CORTO = { ig: 'IG', tt: 'TikTok' };
  var TIPOS = { reel: 'Reel', carrusel: 'Carrusel' };
  // Reel: una sola revisión (video + copy). Carrusel: texto → diseño + copy. ('copy' solo existe en datos viejos.)
  var ETAPAS = { reel: ['video'], carrusel: ['texto', 'diseno'] };
  var ETAPA_LABEL = { video: 'Video y copy', texto: 'Texto', diseno: 'Diseño y copy', copy: 'Copy' };
  var TIPO_DIA = { reel: 'Reel', carrusel: 'Carrusel', cualquiera: 'Reel o carrusel', historias: 'Solo historias', descanso: 'Descanso' };
  var DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  var DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  // Cronograma por plataforma: tipo de pieza que toca cada día (0 = domingo).
  // 'cualquiera' = reel o carrusel; 'historias' y 'descanso' = no se publica pieza en el feed.
  var CRONOGRAMA_BASE = {
    ig: { '0': 'reel', '1': 'carrusel', '2': 'reel', '3': 'historias', '4': 'reel', '5': 'carrusel', '6': 'descanso' },
    tt: { '0': 'cualquiera', '1': 'cualquiera', '2': 'cualquiera', '3': 'cualquiera', '4': 'cualquiera', '5': 'cualquiera', '6': 'cualquiera' }
  };
  var AJUSTES_BASE = { id: 1, cronograma: CRONOGRAMA_BASE, dias_minimos: 3, dias_entrega: 2, grabacion_dia: 2, grabacion_hora: '11:00' };

  var CHIPS = {
    video: ['Cortar inicio', 'Más corto', 'Ritmo / cortes', 'Texto en pantalla', 'Subtítulos', 'Música / audio', 'Color / luz', 'Logo / marca', 'Precio / dato', 'Portada'],
    texto: ['Gancho (slide 1)', 'Muy largo', 'Orden de slides', 'Precio / dato', 'Ortografía', 'Tono de la marca', 'Llamado a la acción'],
    diseno: ['Tipografía', 'Colores de marca', 'Foto / imagen', 'Legibilidad', 'Alineación / espacios', 'Logo', 'Portada'],
    copy: ['Gancho', 'Más corto', 'Llamado a la acción', 'Hashtags', 'Ortografía', 'Tono de la marca', 'Precio / dato']
  };
  // Grupos de correcciones rápidas por etapa
  function gruposChips(etapa) {
    if (etapa === 'video') return [{ titulo: 'Video', chips: CHIPS.video }, { titulo: 'Copy', chips: CHIPS.copy }];
    if (etapa === 'diseno') return [{ titulo: 'Diseño', chips: CHIPS.diseno }, { titulo: 'Copy', chips: CHIPS.copy }];
    if (etapa === 'texto') return [{ titulo: 'Texto', chips: CHIPS.texto }];
    return [{ titulo: 'Copy', chips: CHIPS.copy }];
  }
  // Cómo se ubica un punto de corrección según la etapa
  var UBICACION = { video: 'Min. 0:12', diseno: 'Slide #', texto: 'Slide #', copy: null };

  var OBJETIVOS = ['Vender un producto', 'Educar / dar a conocer', 'Confianza para comprar en la web', 'Temporada / fecha especial', 'Marca / entretener'];

  function checklistDe(plat) { return plat === 'tt' ? CHECKLIST_PUBLICAR.concat(['Compartido también en historias']) : CHECKLIST_PUBLICAR; }
  var CHECKLIST_PUBLICAR = [
    'Archivo final sin marca de agua de otra app',
    'Portada elegida',
    'Precios verificados hoy en barquerofood.com',
    'Copy aprobado pegado completo'
  ];

  var TIPOS_EVENTO = ['creada', 'idea', 'iniciada', 'editada', 'envio', 'aprobacion', 'correccion', 'comentario',
    'espera', 'llego', 'fechas', 'publicado', 'vistas', 'archivada', 'reabierta'];

  // Columnas del tablero (en orden del flujo)
  var COLUMNAS = [
    { clave: 'ideas', titulo: 'Ideas', icono: '💡' },
    { clave: 'grabar', titulo: 'Por grabar', icono: '🎬' },
    { clave: 'editar', titulo: 'En edición', icono: '✂️' },
    { clave: 'aprobar', titulo: 'Por aprobar', icono: '👀' },
    { clave: 'lista', titulo: 'Listas', icono: '✅' },
    { clave: 'publicada', titulo: 'Publicadas', icono: '🚀' }
  ];

  // ---------- Fechas ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hoyISO(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function partes(iso) { var p = String(iso).slice(0, 10).split('-'); return [+p[0], +p[1], +p[2]]; }
  function utc(iso) { var p = partes(iso); return Date.UTC(p[0], p[1] - 1, p[2]); }
  function addDias(iso, n) { return new Date(utc(iso) + n * 86400000).toISOString().slice(0, 10); }
  function diaSemana(iso) { return new Date(utc(iso)).getUTCDay(); }
  function diffDias(a, b) { return Math.round((utc(b) - utc(a)) / 86400000); } // b - a
  function fmtFecha(iso) {
    if (!iso) return '';
    var p = partes(iso);
    return DIAS_CORTOS[diaSemana(iso)] + ' ' + p[2] + ' ' + MESES[p[1] - 1];
  }
  function fmtFechaLarga(iso) {
    var p = partes(iso);
    return DIAS[diaSemana(iso)] + ' ' + p[2] + ' de ' + MESES_LARGOS[p[1] - 1];
  }
  function horasEntre(t1, t2) { return (new Date(t2).getTime() - new Date(t1).getTime()) / 3600000; }
  function haceCuanto(ts, ahora) {
    var h = horasEntre(ts, ahora || new Date());
    if (h < 1 / 60) return 'justo ahora';
    if (h < 1) return 'hace ' + Math.max(1, Math.round(h * 60)) + ' min';
    if (h < 24) return 'hace ' + Math.round(h) + ' h';
    var d = Math.round(h / 24);
    return d === 1 ? 'hace 1 día' : 'hace ' + d + ' días';
  }
  function fmtHoras(h) {
    if (h == null || isNaN(h)) return '—';
    if (h < 1) return Math.max(1, Math.round(h * 60)) + ' min';
    if (h < 48) return (Math.round(h * 10) / 10).toString().replace('.', ',') + ' h';
    return (Math.round(h / 24 * 10) / 10).toString().replace('.', ',') + ' días';
  }

  // ---------- Piezas ----------
  function plataformasDe(p) { return ['ig', 'tt'].filter(function (k) { return !!p[k]; }); }
  function fechaDe(p, plat) { return p['fecha_' + plat] || null; }
  function publicadoEn(p, plat) { return p['publicado_' + plat + '_en'] || null; }
  function pendientesDePublicar(p) { return plataformasDe(p).filter(function (pl) { return !publicadoEn(p, pl); }); }
  function etapasDe(p) { return ETAPAS[p.tipo] || ETAPAS.reel; }
  // 'copy' (datos viejos) cuenta como la última etapa del tipo
  function etapaNorm(p) { var e = etapasDe(p); return p.etapa === 'copy' || e.indexOf(p.etapa) < 0 ? e[e.length - 1] : p.etapa; }
  function esFinal(p) { var e = etapasDe(p); return etapaNorm(p) === e[e.length - 1]; }
  // ¿Ocupa un espacio del calendario? (cualquier pieza con fecha, menos archivadas o en espera)
  function ocupa(p) { return p.fase !== 'archivada' && !p.en_espera; }
  function entrega(ajustes) { var m = ajustes && ajustes.dias_entrega; return (m == null || isNaN(m)) ? 2 : +m; }
  function proximaFecha(p) {
    var f = pendientesDePublicar(p).map(function (pl) { return fechaDe(p, pl); }).filter(Boolean).sort();
    return f[0] || null;
  }
  // Fecha límite para tener la pieza lista (editada y enviada): N días antes de la primera publicación
  function fechaLimite(p, ajustes) {
    if (p.fase !== 'idea' && p.fase !== 'produccion') return null;
    var f = proximaFecha(p);
    return f ? addDias(f, -entrega(ajustes)) : null;
  }
  function columnaDe(p) {
    if (p.fase === 'idea') return p.grabacion_id ? 'grabar' : 'ideas';
    if (p.fase === 'produccion') return p.turno === 'aprueba' ? 'aprobar' : 'editar';
    if (p.fase === 'aprobada') return 'lista';
    if (p.fase === 'publicada') return 'publicada';
    return 'archivada';
  }
  // A quién le toca mover la pieza: 'edita' | 'aprueba' | 'ambas' | null
  function leToca(p) {
    var c = columnaDe(p);
    if (p.en_espera && (c === 'lista' || c === 'ideas' || c === 'grabar')) return null; // espera la mercancía
    if (c === 'editar') return 'edita';
    if (c === 'aprobar') return 'aprueba';
    if (c === 'grabar') return 'ambas';
    if (c === 'lista') return pendientesDePublicar(p).some(function (pl) { return !fechaDe(p, pl); }) && !p.en_espera ? 'aprueba' : 'edita';
    return null;
  }
  // Pasos del flujo para mostrar el recorrido de la pieza
  function pasosDe(p) {
    var pasos = p.tipo === 'carrusel'
      ? ['Idea', 'Texto', 'Aprobación del texto', 'Diseño y copy', 'Aprobación final', 'Lista', 'Publicada']
      : ['Idea', 'Grabación', 'Edición', 'Aprobación', 'Lista', 'Publicada'];
    var i = 0, terminado = false;
    if (p.fase === 'idea') i = (p.tipo === 'reel' && p.grabacion_id) ? 1 : 0;
    else if (p.fase === 'produccion') {
      var et = etapaNorm(p);
      if (p.tipo === 'carrusel') i = et === 'texto' ? (p.turno === 'aprueba' ? 2 : 1) : (p.turno === 'aprueba' ? 4 : 3);
      else i = p.turno === 'aprueba' ? 3 : 2;
    } else if (p.fase === 'aprobada') i = pasos.length - 2;
    else if (p.fase === 'publicada') { i = pasos.length - 1; terminado = true; }
    else if (p.fase === 'archivada') i = -1;
    return { pasos: pasos, actual: i, terminado: terminado };
  }
  // Acepta también el formato viejo ({ "0": {tipo, plataformas} }): IG sale de ahí y TikTok queda todos los días.
  function cron(ajustes) {
    var c = (ajustes && ajustes.cronograma) || CRONOGRAMA_BASE;
    if (c.ig && c.tt) return c;
    var ig = {}, tt = {};
    for (var i = 0; i < 7; i++) {
      var d = c[String(i)] || {};
      ig[i] = (d.plataformas || []).indexOf('ig') >= 0 || d.tipo === 'historias' || d.tipo === 'descanso' ? (d.tipo || 'descanso') : 'descanso';
      tt[i] = 'cualquiera';
    }
    return { ig: ig, tt: tt };
  }
  function slotTipo(ajustes, plat, iso) { return cron(ajustes)[plat][String(diaSemana(iso))] || 'descanso'; }
  function publicable(t) { return t === 'reel' || t === 'carrusel' || t === 'cualquiera'; }
  function cabe(ajustes, plat, iso, tipo) { var t = slotTipo(ajustes, plat, iso); return t === tipo || (t === 'cualquiera' && !!tipo); }
  function diaCfg(ajustes, iso) { return { tipo: slotTipo(ajustes, 'ig', iso) }; } // tipo del día en Instagram (para mostrar)
  function minimo(ajustes) { var m = ajustes && ajustes.dias_minimos; return (m == null || isNaN(m)) ? 3 : +m; }
  function enBanco(p) {
    return p.fase === 'aprobada' && !p.en_espera &&
      pendientesDePublicar(p).some(function (pl) { return !fechaDe(p, pl); });
  }

  function estadoDe(p, hoy) {
    hoy = hoy || hoyISO();
    if (p.fase === 'archivada') return { clave: 'archivada', texto: 'Archivada', tono: 'gris' };
    if (p.fase === 'idea') return p.grabacion_id ? { clave: 'grabar', texto: 'Por grabar', tono: 'gris' } : { clave: 'idea', texto: 'Idea', tono: 'gris' };
    if (p.fase === 'produccion') {
      var et = ETAPA_LABEL[etapaNorm(p)];
      if (p.turno === 'aprueba') return { clave: 'revisar', texto: 'Por aprobar · ' + et + ' v' + p.version, tono: 'aprueba' };
      if (p.version > 0) return { clave: 'corregir', texto: 'Con correcciones · ' + et, tono: 'corregir' };
      return { clave: 'editar', texto: 'En edición · ' + et, tono: 'edita' };
    }
    if (p.fase === 'publicada') return { clave: 'publicada', texto: 'Publicada', tono: 'ok' };
    if (p.fase === 'aprobada') {
      var pend = pendientesDePublicar(p);
      var publicadas = plataformasDe(p).filter(function (pl) { return publicadoEn(p, pl); });
      var pre = publicadas.length ? 'Publicada en ' + publicadas.map(function (x) { return PLAT_CORTO[x]; }).join(' y ') + ' · ' : '';
      if (pend.some(function (pl) { var f = fechaDe(p, pl); return f && f < hoy; })) return { clave: 'atrasada', texto: pre + 'No se publicó a tiempo', tono: 'atrasada' };
      if (pend.every(function (pl) { return !fechaDe(p, pl); })) return { clave: 'sinfecha', texto: pre + 'Lista · sin fecha', tono: 'banco' };
      return { clave: 'programada', texto: pre + 'Lista · programada', tono: 'ok' };
    }
    return { clave: p.fase, texto: p.fase, tono: 'gris' };
  }

  // ---------- Calendario y sugerencia de fechas ----------
  function ocupado(piezas, plat, iso, excluirId) {
    return piezas.some(function (p) {
      return p.id !== excluirId && ocupa(p) && p[plat] && fechaDe(p, plat) === iso;
    });
  }
  function slotLibre(piezas, ajustes, plat, tipo, desde, excluirId, limite) {
    limite = limite || 120;
    for (var i = 0; i < limite; i++) {
      var d = addDias(desde, i);
      if (cabe(ajustes, plat, d, tipo) && !ocupado(piezas, plat, d, excluirId)) return d;
    }
    return null;
  }
  function maxFecha(a, b) { if (!a) return b; if (!b) return a; return a > b ? a : b; }

  // Sugiere fechas para las plataformas que faltan por publicar.
  // primeroPreferido: 'ig' | 'tt' | null (si es null, va primero la que tenga hueco antes).
  function sugerirFechas(p, piezas, ajustes, desde, primeroPreferido) {
    var pend = pendientesDePublicar(p);
    var min = minimo(ajustes);
    var res = { primero: null, fecha_ig: null, fecha_tt: null };
    if (!pend.length) return res;
    if (pend.length === 1) {
      var pl = pend[0], otra = pl === 'ig' ? 'tt' : 'ig';
      var base = desde;
      var fOtra = p[otra] ? (publicadoEn(p, otra) ? String(publicadoEn(p, otra)).slice(0, 10) : fechaDe(p, otra)) : null;
      if (fOtra) base = maxFecha(desde, addDias(fOtra, min));
      res['fecha_' + pl] = slotLibre(piezas, ajustes, pl, p.tipo, base, p.id);
      res.primero = fOtra ? otra : pl;
      if (p[otra]) res['fecha_' + otra] = fechaDe(p, otra);
      return res;
    }
    var primero = primeroPreferido;
    if (primero !== 'ig' && primero !== 'tt') {
      var a = slotLibre(piezas, ajustes, 'ig', p.tipo, desde, p.id);
      var b = slotLibre(piezas, ajustes, 'tt', p.tipo, desde, p.id);
      primero = !a ? 'tt' : !b ? 'ig' : (b < a ? 'tt' : 'ig');
    }
    var segundo = primero === 'ig' ? 'tt' : 'ig';
    var f1 = slotLibre(piezas, ajustes, primero, p.tipo, desde, p.id);
    var f2 = f1 ? slotLibre(piezas, ajustes, segundo, p.tipo, addDias(f1, min), p.id) : null;
    res.primero = primero;
    res['fecha_' + primero] = f1;
    res['fecha_' + segundo] = f2;
    return res;
  }

  // Avisos (no bloquean) sobre unas fechas propuestas.
  function validarFechas(p, fechas, piezas, ajustes, hoy) {
    var avisos = [];
    var min = minimo(ajustes);
    plataformasDe(p).forEach(function (pl) {
      var f = fechas['fecha_' + pl];
      if (!f || publicadoEn(p, pl)) return;
      var st = slotTipo(ajustes, pl, f);
      var nombreDia = DIAS[diaSemana(f)];
      if (hoy && f < hoy) avisos.push(PLAT_CORTO[pl] + ': la fecha ya pasó.');
      if (!cabe(ajustes, pl, f, p.tipo)) {
        avisos.push(PLAT_CORTO[pl] + ': el ' + nombreDia.toLowerCase() + ' es día de ' + TIPO_DIA[st].toLowerCase() + ' en ' + PLATAFORMAS[pl] + '.');
      }
      var otra = piezas.filter(function (q) { return q.id !== p.id && ocupa(q) && q[pl] && fechaDe(q, pl) === f; })[0];
      if (otra) avisos.push(PLAT_CORTO[pl] + ': ese día ya está «' + otra.titulo + '».');
    });
    if (p.ig && p.tt) {
      var fi = publicadoEn(p, 'ig') ? String(publicadoEn(p, 'ig')).slice(0, 10) : fechas.fecha_ig;
      var ft = publicadoEn(p, 'tt') ? String(publicadoEn(p, 'tt')).slice(0, 10) : fechas.fecha_tt;
      if (fi && ft) {
        var d = Math.abs(diffDias(fi, ft));
        if (d < min) avisos.push('Solo ' + d + (d === 1 ? ' día' : ' días') + ' entre IG y TikTok (mínimo ' + min + ').');
      }
    }
    return avisos;
  }

  function huecos(piezas, ajustes, desde, dias) {
    dias = dias || 7;
    var res = [];
    for (var i = 0; i < dias; i++) {
      var d = addDias(desde, i);
      ['ig', 'tt'].forEach(function (pl) {
        var t = slotTipo(ajustes, pl, d);
        if (publicable(t) && !ocupado(piezas, pl, d, null)) res.push({ fecha: d, plataforma: pl, tipo: t });
      });
    }
    return res;
  }

  // Piezas que pueden ir en un hueco: cualquiera activa, sin fecha en esa plataforma (primero las más avanzadas)
  var ORDEN_COL = { lista: 0, aprobar: 1, editar: 2, grabar: 3, ideas: 4 };
  function candidatosHueco(piezas, hueco) {
    return piezas.filter(function (p) {
      return ['idea', 'produccion', 'aprobada'].indexOf(p.fase) >= 0 && !p.en_espera &&
        (p.tipo === hueco.tipo || hueco.tipo === 'cualquiera') && p[hueco.plataforma] &&
        !publicadoEn(p, hueco.plataforma) && !fechaDe(p, hueco.plataforma);
    }).sort(function (a, b) { return ORDEN_COL[columnaDe(a)] - ORDEN_COL[columnaDe(b)]; });
  }

  // ---------- Acciones (devuelven {patch, match, eventos}) ----------
  function err(msg) { var e = new Error(msg); e.usuario = true; return e; }
  function txt(v) { return v == null ? '' : String(v).trim(); }
  function limpiar(v) { var t = txt(v); return t ? t : null; }

  function nuevaPieza(datos, opciones) {
    opciones = opciones || {};
    var titulo = txt(datos.titulo);
    if (!titulo) throw err('Ponle un título a la pieza.');
    var tipo = datos.tipo === 'carrusel' ? 'carrusel' : 'reel';
    var ig = !!datos.ig, tt = !!datos.tt;
    var esIdea = !!datos.idea || !!datos.grabacion_id;
    if (!ig && !tt) {
      if (esIdea) { ig = true; tt = true; } else throw err('Elige al menos una plataforma.');
    }
    var fila = {
      id: opciones.id,
      titulo: titulo, tipo: tipo, ig: ig, tt: tt,
      producto: limpiar(datos.producto), gancho: limpiar(datos.gancho), objetivo: limpiar(datos.objetivo),
      fase: esIdea ? 'idea' : 'produccion',
      etapa: esIdea ? null : ETAPAS[tipo][0],
      turno: esIdea ? null : 'edita',
      version: 0,
      en_espera: !!datos.en_espera && !!txt(datos.espera_producto),
      espera_producto: datos.en_espera ? limpiar(datos.espera_producto) : null,
      espera_desde: datos.en_espera && txt(datos.espera_producto) ? (opciones.hoy || hoyISO()) : null,
      grabacion_id: datos.grabacion_id || null
    };
    var eventos = [{ tipo: esIdea ? 'idea' : 'creada', texto: null, datos: { tipo: tipo, plataformas: plataformasDe(fila), grabacion_id: fila.grabacion_id || undefined } }];
    if (fila.en_espera) eventos.push({ tipo: 'espera', texto: fila.espera_producto, datos: {} });
    return { fila: fila, eventos: eventos };
  }

  function exigirProduccion(p, turno) {
    if (p.fase !== 'produccion') throw err('Esta pieza ya no está en producción.');
    if (turno && p.turno !== turno) {
      throw err(turno === 'edita' ? 'Esta pieza ya está esperando aprobación.' : 'Esta pieza no está esperando aprobación.');
    }
  }
  function matchDe(p) { return { fase: p.fase, turno: p.turno, version: p.version || 0, etapa: p.etapa }; }
  function copiaRequerida(p, datos, patch, ev) {
    plataformasDe(p).forEach(function (pl) {
      if (!txt(datos['copy_' + pl])) throw err('Falta el copy de ' + PLATAFORMAS[pl] + '.');
      patch['copy_' + pl] = String(datos['copy_' + pl]).trim();
      ev['copy_' + pl] = patch['copy_' + pl];
    });
  }

  function accionEnviar(p, datos) {
    exigirProduccion(p, 'edita');
    datos = datos || {};
    var et = etapaNorm(p);
    var version = (p.version || 0) + 1;
    var patch = { turno: 'aprueba', version: version, etapa: et, nota_version: limpiar(datos.nota), enlace_version: limpiar(datos.enlace) };
    var ev = {};
    if (et === 'texto') {
      if (!txt(datos.texto_carrusel)) throw err('Escribe el texto del carrusel antes de enviarlo.');
      patch.texto_carrusel = String(datos.texto_carrusel).trim();
      ev.texto_carrusel = patch.texto_carrusel;
    }
    if (esFinal(p)) copiaRequerida(p, datos, patch, ev);
    if (datos.resueltas && datos.resueltas.length) ev.resueltas = datos.resueltas;
    if (patch.enlace_version) ev.enlace = patch.enlace_version;
    return {
      patch: patch, match: matchDe(p),
      eventos: [{ tipo: 'envio', etapa: et, version: version, texto: patch.nota_version, datos: ev }]
    };
  }

  function fechasPatch(p, f) {
    f = f || {};
    var out = {};
    ['ig', 'tt'].forEach(function (pl) {
      if (publicadoEn(p, pl)) return; // no se toca una fecha ya publicada
      if (!p[pl]) { if (p['fecha_' + pl]) out['fecha_' + pl] = null; return; }
      if (!(('fecha_' + pl) in f)) return; // solo se cambian las fechas que vienen
      out['fecha_' + pl] = limpiar(f['fecha_' + pl]) || null;
    });
    var prim = f.primero === 'ig' || f.primero === 'tt' ? f.primero : null;
    if (!prim) {
      var fi = out.fecha_ig !== undefined ? out.fecha_ig : p.fecha_ig;
      var ft = out.fecha_tt !== undefined ? out.fecha_tt : p.fecha_tt;
      if (fi && ft) prim = fi <= ft ? 'ig' : 'tt';
      else if (fi) prim = 'ig'; else if (ft) prim = 'tt';
    }
    out.primero = prim;
    return out;
  }

  function accionAprobar(p, datos) {
    exigirProduccion(p, 'aprueba');
    datos = datos || {};
    var etapas = etapasDe(p);
    var et = etapaNorm(p);
    var i = etapas.indexOf(et);
    var ultima = i === etapas.length - 1;
    var ev = { tipo: 'aprobacion', etapa: et, version: p.version, texto: limpiar(datos.comentario), datos: {} };
    // Ajustes menores que hace quien aprueba (sin devolver la pieza)
    var ajustes = {};
    if (et === 'texto' && datos.texto_carrusel != null && txt(datos.texto_carrusel) && txt(datos.texto_carrusel) !== txt(p.texto_carrusel)) {
      ajustes.texto_carrusel = String(datos.texto_carrusel).trim();
    }
    if (ultima) {
      plataformasDe(p).forEach(function (pl) {
        var v = datos['copy_' + pl];
        if (v != null && txt(v) && txt(v) !== txt(p['copy_' + pl])) ajustes['copy_' + pl] = String(v).trim();
        if (!txt(ajustes['copy_' + pl] || p['copy_' + pl])) throw err('Falta el copy de ' + PLATAFORMAS[pl] + ': escríbelo o pide la corrección.');
      });
    }
    var patch = ultima
      ? { fase: 'aprobada', etapa: null, turno: null, nota_version: null, enlace_version: null }
      : { etapa: etapas[i + 1], turno: 'edita', version: 0, nota_version: null, enlace_version: null };
    if (ultima && pendientesDePublicar(p).every(function (pl) { return !fechaDe(p, pl); })) ev.datos.sinfecha = true;
    if (!ultima) ev.datos.siguiente = etapas[i + 1];
    if (Object.keys(ajustes).length) {
      Object.assign(patch, ajustes);
      ev.datos.ajustes = ajustes;
    }
    return { patch: patch, match: matchDe(p), eventos: [ev] };
  }

  function accionCorregir(p, datos) {
    exigirProduccion(p, 'aprueba');
    datos = datos || {};
    var et = etapaNorm(p);
    var chips = (datos.chips || []).filter(Boolean);
    var puntos = (datos.puntos || []).map(function (x) {
      return { ubicacion: limpiar(x.ubicacion), texto: limpiar(x.texto) };
    }).filter(function (x) { return x.texto || x.ubicacion; });
    var comentario = limpiar(datos.comentario);
    if (!chips.length && !puntos.length && !comentario) throw err('Indica al menos una corrección.');
    return {
      patch: { turno: 'edita', etapa: et }, match: matchDe(p),
      eventos: [{ tipo: 'correccion', etapa: et, version: p.version, texto: comentario, datos: { chips: chips, puntos: puntos } }]
    };
  }

  function accionEspera(p, producto, hoy) {
    if (p.fase === 'archivada' || p.fase === 'publicada') throw err('Esta pieza ya no está activa.');
    var prod = txt(producto);
    if (!prod) throw err('¿Qué mercancía se está esperando?');
    var patch = { en_espera: true, espera_producto: prod, espera_desde: hoy || hoyISO() };
    var antes = {};
    pendientesDePublicar(p).forEach(function (pl) {
      if (fechaDe(p, pl)) { antes['fecha_' + pl] = fechaDe(p, pl); patch['fecha_' + pl] = null; }
    });
    return { patch: patch, match: { en_espera: false }, eventos: [{ tipo: 'espera', texto: prod, datos: { fechas_quitadas: antes } }] };
  }

  function accionLlego(p) {
    if (!p.en_espera) throw err('Esta pieza no estaba en espera.');
    return {
      patch: { en_espera: false, espera_producto: null, espera_desde: null }, match: { en_espera: true },
      eventos: [{ tipo: 'llego', texto: p.espera_producto, datos: {} }]
    };
  }

  function accionFechas(p, fechas, ajustes) {
    if (['idea', 'produccion', 'aprobada'].indexOf(p.fase) < 0) throw err(p.fase === 'publicada' ? 'Ya está publicada.' : 'Esta pieza no está activa.');
    if (p.en_espera) throw err('Está en espera de mercancía: marca «Llegó» antes de ponerle fecha.');
    var fp = fechasPatch(p, fechas);
    var cambio = ['ig', 'tt'].some(function (pl) { return fp['fecha_' + pl] !== undefined && (fp['fecha_' + pl] || null) !== (p['fecha_' + pl] || null); });
    if (!cambio) throw err('No cambiaste ninguna fecha.');
    var nueva = Object.assign({}, p, fp);
    var datos = { fecha_ig: fp.fecha_ig, fecha_tt: fp.fecha_tt, primero: fp.primero, fase: p.fase, limite: fechaLimite(nueva, ajustes) };
    if (!fp.fecha_ig && !fp.fecha_tt) datos.sinfecha = true;
    return { patch: fp, match: { en_espera: false }, eventos: [{ tipo: 'fechas', texto: null, datos: datos }] };
  }

  function accionPublicar(p, plat, datos, ahora, hoy) {
    if (p.fase !== 'aprobada') throw err('Esta pieza no está lista para publicar.');
    if (!p[plat]) throw err('Esta pieza no es para ' + PLATAFORMAS[plat] + '.');
    if (publicadoEn(p, plat)) throw err('Ya estaba marcada como publicada en ' + PLATAFORMAS[plat] + '.');
    datos = datos || {};
    var marcados = datos.checklist || [];
    if (marcados.length < checklistDe(plat).length) throw err('Completa la lista antes de publicar.');
    var ts = ahora || new Date().toISOString();
    var patch = {};
    patch['publicado_' + plat + '_en'] = ts;
    patch['enlace_' + plat] = limpiar(datos.enlace);
    if (!fechaDe(p, plat)) patch['fecha_' + plat] = hoy || hoyISO();
    var resto = pendientesDePublicar(p).filter(function (x) { return x !== plat; });
    if (!resto.length) patch.fase = 'publicada';
    var m = { fase: 'aprobada' };
    m['publicado_' + plat + '_en'] = null;
    return { patch: patch, match: m, eventos: [{ tipo: 'publicado', texto: null, datos: { plataforma: plat, enlace: patch['enlace_' + plat] } }] };
  }

  function accionVistas(p, datos) {
    var patch = {}, ev = {};
    ['ig', 'tt'].forEach(function (pl) {
      var v = datos['vistas_' + pl];
      if (v === '' || v == null) return;
      var n = parseInt(String(v).replace(/[.\s,]/g, ''), 10);
      if (isNaN(n) || n < 0) throw err('Las vistas deben ser un número.');
      if (!publicadoEn(p, pl)) return;
      patch['vistas_' + pl] = n; ev['vistas_' + pl] = n;
    });
    if (!Object.keys(patch).length) throw err('Anota al menos un número de vistas.');
    return { patch: patch, match: {}, eventos: [{ tipo: 'vistas', texto: null, datos: ev }] };
  }

  function accionComentario(p, texto) {
    var t = txt(texto);
    if (!t) throw err('Escribe el comentario.');
    return { patch: null, match: {}, eventos: [{ tipo: 'comentario', etapa: p.etapa || null, version: p.version || null, texto: t, datos: {} }] };
  }

  function accionArchivar(p) {
    if (p.fase === 'archivada') throw err('Ya está archivada.');
    return { patch: { fase: 'archivada' }, match: { fase: p.fase }, eventos: [{ tipo: 'archivada', texto: null, datos: { fase_anterior: p.fase } }] };
  }

  function accionReabrir(p, eventos) {
    if (p.fase !== 'archivada') throw err('No está archivada.');
    var ult = (eventos || []).filter(function (e) { return e.pieza_id === p.id && e.tipo === 'archivada'; }).pop();
    var fase = ult && ult.datos && ult.datos.fase_anterior;
    if (!fase) fase = p.etapa ? 'produccion' : (pendientesDePublicar(p).length ? (p.copy_ig || p.copy_tt ? 'aprobada' : 'idea') : 'publicada');
    return { patch: { fase: fase }, match: { fase: 'archivada' }, eventos: [{ tipo: 'reabierta', texto: null, datos: { fase: fase } }] };
  }

  function accionIniciar(p, datos) {
    if (p.fase !== 'idea') throw err('Esta pieza ya empezó.');
    datos = datos || {};
    var tipo = datos.tipo === 'carrusel' ? 'carrusel' : datos.tipo === 'reel' ? 'reel' : p.tipo;
    var ig = datos.ig != null ? !!datos.ig : p.ig, tt = datos.tt != null ? !!datos.tt : p.tt;
    if (!ig && !tt) throw err('Elige al menos una plataforma.');
    var patch = { fase: 'produccion', tipo: tipo, ig: ig, tt: tt, etapa: ETAPAS[tipo][0], turno: 'edita', version: 0 };
    if (datos.titulo != null && txt(datos.titulo)) patch.titulo = txt(datos.titulo);
    ['producto', 'gancho', 'objetivo'].forEach(function (k) { if (datos[k] != null) patch[k] = limpiar(datos[k]); });
    return { patch: patch, match: { fase: 'idea' }, eventos: [{ tipo: 'iniciada', texto: null, datos: { tipo: tipo } }] };
  }

  function accionAGrabacion(p, grabacionId) {
    if (p.fase !== 'idea') throw err('Solo las ideas se planifican para grabar.');
    if ((p.grabacion_id || null) === (grabacionId || null)) throw err(grabacionId ? 'Ya está en esa grabación.' : 'No estaba en ninguna grabación.');
    return { patch: { grabacion_id: grabacionId || null }, match: { fase: 'idea' },
      eventos: [{ tipo: 'editada', texto: grabacionId ? 'planificada para grabar' : 'quitada de la grabación', datos: { grabacion_id: grabacionId || null } }] };
  }

  function puedeCambiarTipo(p) {
    return p.fase === 'idea' || (p.fase === 'produccion' && p.etapa === ETAPAS[p.tipo][0] && (p.version || 0) === 0 && p.turno === 'edita');
  }

  function accionEditar(p, datos) {
    var patch = {}, cambios = [];
    var titulo = txt(datos.titulo);
    if (!titulo) throw err('El título no puede quedar vacío.');
    if (titulo !== p.titulo) { patch.titulo = titulo; cambios.push('título'); }
    ['producto', 'gancho', 'objetivo'].forEach(function (k) {
      var v = limpiar(datos[k]);
      if ((v || null) !== (p[k] || null)) { patch[k] = v; cambios.push(k); }
    });
    if (datos.tipo && datos.tipo !== p.tipo) {
      if (!puedeCambiarTipo(p)) throw err('El tipo ya no se puede cambiar en esta etapa.');
      patch.tipo = datos.tipo;
      if (p.fase === 'produccion') patch.etapa = ETAPAS[datos.tipo][0];
      if (datos.tipo === 'carrusel' && p.fase === 'produccion' && (p.version || 0) > 0) throw err('El tipo ya no se puede cambiar en esta etapa.');
      cambios.push('tipo');
    }
    var ig = datos.ig != null ? !!datos.ig : p.ig, tt = datos.tt != null ? !!datos.tt : p.tt;
    if (!ig && !tt) throw err('Elige al menos una plataforma.');
    ['ig', 'tt'].forEach(function (pl) {
      var v = pl === 'ig' ? ig : tt;
      if (v !== !!p[pl]) {
        if (!v && publicadoEn(p, pl)) throw err('Ya se publicó en ' + PLATAFORMAS[pl] + '; no se puede quitar.');
        patch[pl] = v;
        if (!v) patch['fecha_' + pl] = null;
        cambios.push(PLATAFORMAS[pl] + (v ? ' (agregada)' : ' (quitada)'));
      }
    });
    if (!cambios.length) throw err('No hay cambios que guardar.');
    if (p.fase === 'aprobada' && (patch.ig === true || patch.tt === true)) {
      // Se agregó una plataforma a una pieza ya aprobada: falta su copy.
      var faltaCopy = ['ig', 'tt'].filter(function (pl) { return patch[pl] === true && !txt(p['copy_' + pl]); });
      if (faltaCopy.length) cambios.push('falta copy de ' + faltaCopy.map(function (x) { return PLATAFORMAS[x]; }).join(' y '));
    }
    return { patch: patch, match: {}, eventos: [{ tipo: 'editada', texto: cambios.join(', '), datos: { cambios: cambios } }] };
  }

  // ---------- Pendientes por rol ----------
  function pendientes(piezas, eventos, rol, hoy, ajustes) {
    hoy = hoy || hoyISO();
    var r = { revisar: [], editar: [], publicar: [], programar: [], riesgo: [], vistas: [], espera: [], grabar: [], atrasadas: [], hoy: [], huecos: [] };
    var ent = entrega(ajustes);
    piezas.forEach(function (p) {
      if (p.fase === 'archivada') return;
      if (p.en_espera && p.fase !== 'publicada') r.espera.push(p);
      var col = columnaDe(p);
      if (col === 'grabar') r.grabar.push(p);
      if (col === 'aprobar') r.revisar.push(p);
      if (col === 'editar') r.editar.push(p);
      if (p.fase === 'aprobada' && !p.en_espera) {
        pendientesDePublicar(p).forEach(function (pl) {
          var f = fechaDe(p, pl);
          if (f && f <= hoy) {
            var item = { pieza: p, plataforma: pl, fecha: f, atrasada: f < hoy };
            r.publicar.push(item);
            (item.atrasada ? r.atrasadas : r.hoy).push(item);
          }
        });
        if (pendientesDePublicar(p).some(function (pl) { return !fechaDe(p, pl); })) r.programar.push(p);
      }
      // En riesgo: tiene fecha cerca y todavía no está aprobada
      if ((p.fase === 'idea' || p.fase === 'produccion') && !p.en_espera) {
        var f0 = proximaFecha(p);
        if (f0 && diffDias(hoy, f0) <= ent) r.riesgo.push({ pieza: p, fecha: f0, limite: fechaLimite(p, ajustes) });
      }
      plataformasDe(p).forEach(function (pl) {
        var pub = publicadoEn(p, pl);
        if (pub && p['vistas_' + pl] == null && diffDias(String(pub).slice(0, 10), hoy) >= 7) r.vistas.push({ pieza: p, plataforma: pl });
      });
    });
    var ultimoEnv = {};
    (eventos || []).forEach(function (e) { if (e.tipo === 'envio') ultimoEnv[e.pieza_id] = e.creado_en; });
    var porFecha = function (a, b) { var fa = proximaFecha(a) || '9999', fb = proximaFecha(b) || '9999'; return fa < fb ? -1 : fa > fb ? 1 : 0; };
    r.revisar.sort(function (a, b) {
      var x = porFecha(a, b);
      if (x) return x;
      return String(ultimoEnv[a.id] || a.actualizado_en || '') < String(ultimoEnv[b.id] || b.actualizado_en || '') ? -1 : 1;
    });
    r.editar.sort(function (a, b) {
      var c = (b.version > 0) - (a.version > 0); // correcciones primero si no hay fecha
      var x = porFecha(a, b);
      return x || c;
    });
    r.riesgo.sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
    r.publicar.sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0; });
    r.huecos = huecos(piezas, ajustes, hoy, 7);
    r.total = rol === 'aprueba'
      ? r.revisar.length + r.programar.length
      : r.editar.length + r.publicar.length + r.vistas.length;
    r.totalBase = r.total;
    return r;
  }
  function minFecha(p) { return proximaFecha(p) || '9999-12-31'; }

  // Esperas agrupadas por producto
  function esperasPorProducto(piezas) {
    var g = {};
    piezas.forEach(function (p) {
      if (!p.en_espera || p.fase === 'archivada') return;
      var k = (p.espera_producto || 'Sin nombre').trim();
      var key = k.toLowerCase();
      if (!g[key]) g[key] = { producto: k, piezas: [], desde: p.espera_desde };
      g[key].piezas.push(p);
      if (p.espera_desde && (!g[key].desde || p.espera_desde < g[key].desde)) g[key].desde = p.espera_desde;
    });
    return Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) { return String(a.desde) < String(b.desde) ? -1 : 1; });
  }

  // ---------- Historial y métricas ----------
  function eventosDe(eventos, piezaId) {
    return (eventos || []).filter(function (e) { return e.pieza_id === piezaId; })
      .sort(function (a, b) { return a.creado_en < b.creado_en ? -1 : a.creado_en > b.creado_en ? 1 : 0; });
  }
  function rondasDe(eventos, piezaId) {
    var r = {};
    (eventos || []).forEach(function (e) {
      if (e.pieza_id === piezaId && e.tipo === 'correccion') r[e.etapa] = (r[e.etapa] || 0) + 1;
    });
    return r;
  }
  // Eventos de la etapa actual: los posteriores a la última aprobación / inicio de producción
  function eventosEtapaActual(eventos, p) {
    var lista = eventosDe(eventos, p.id);
    var corte = -1;
    lista.forEach(function (e, i) { if (e.tipo === 'aprobacion' || e.tipo === 'iniciada' || e.tipo === 'reabierta') corte = i; });
    return lista.slice(corte + 1);
  }
  function ultimaCorreccion(eventos, p) {
    var l = eventosEtapaActual(eventos, p).filter(function (e) { return e.tipo === 'correccion'; });
    return l[l.length - 1] || null;
  }
  function ultimoEnvio(eventos, p) {
    var l = eventosEtapaActual(eventos, p).filter(function (e) { return e.tipo === 'envio'; });
    return l[l.length - 1] || null;
  }

  function mediana(xs) {
    if (!xs.length) return null;
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function promedio(xs) { return xs.length ? xs.reduce(function (a, b) { return a + b; }, 0) / xs.length : null; }

  function metricas(piezas, eventos, ajustes, hoy, dias) {
    hoy = hoy || hoyISO();
    dias = dias || 30;
    var desde = addDias(hoy, -dias);
    var evs = (eventos || []).slice().sort(function (a, b) { return a.creado_en < b.creado_en ? -1 : 1; });
    var enPeriodo = function (e) { return String(e.creado_en).slice(0, 10) >= desde; };
    var porPieza = {};
    evs.forEach(function (e) { (porPieza[e.pieza_id] = porPieza[e.pieza_id] || []).push(e); });

    // Rondas por etapa (piezas cuya etapa se aprobó en el período)
    var rondas = {}; // etapa -> [n]
    evs.forEach(function (e) {
      if (e.tipo !== 'aprobacion' || !enPeriodo(e)) return;
      var n = (porPieza[e.pieza_id] || []).filter(function (x) { return x.tipo === 'correccion' && x.etapa === e.etapa; }).length;
      (rondas[e.etapa] = rondas[e.etapa] || []).push(n);
    });
    var rondasEtapa = Object.keys(ETAPA_LABEL).filter(function (k) { return rondas[k] && k !== 'copy'; }).map(function (k) {
      return { etapa: k, label: ETAPA_LABEL[k], promedio: promedio(rondas[k]), piezas: rondas[k].length, sinCorrecciones: rondas[k].filter(function (n) { return n === 0; }).length };
    });

    // Correcciones más frecuentes
    var conteo = {};
    var totalCorrecciones = 0;
    evs.forEach(function (e) {
      if (e.tipo !== 'correccion' || !enPeriodo(e)) return;
      totalCorrecciones++;
      ((e.datos && e.datos.chips) || []).forEach(function (c) {
        var k = (ETAPA_LABEL[e.etapa] || e.etapa) + ' · ' + c;
        conteo[k] = (conteo[k] || 0) + 1;
      });
    });
    var chips = Object.keys(conteo).map(function (k) { return { chip: k, veces: conteo[k] }; })
      .sort(function (a, b) { return b.veces - a.veces; }).slice(0, 8);

    // Tiempos: respuesta de aprobación y de corrección
    var tAprob = [], tCorr = [];
    Object.keys(porPieza).forEach(function (id) {
      var lista = porPieza[id];
      lista.forEach(function (e, i) {
        if (!enPeriodo(e)) return;
        if (e.tipo === 'aprobacion' || e.tipo === 'correccion') {
          for (var j = i - 1; j >= 0; j--) {
            var x = lista[j];
            if (x.tipo === 'envio' && x.etapa === e.etapa && x.version === e.version) { tAprob.push(horasEntre(x.creado_en, e.creado_en)); break; }
          }
        }
        if (e.tipo === 'envio' && e.version > 1) {
          for (var k = i - 1; k >= 0; k--) {
            var y = lista[k];
            if (y.tipo === 'correccion' && y.etapa === e.etapa && y.version === e.version - 1) { tCorr.push(horasEntre(y.creado_en, e.creado_en)); break; }
          }
        }
      });
    });

    // Publicadas y cumplimiento del cronograma (días ya pasados)
    var publicadas = evs.filter(function (e) { return e.tipo === 'publicado' && enPeriodo(e); }).length;
    var slots = 0, llenos = 0;
    for (var i = dias; i >= 1; i--) {
      var d = addDias(hoy, -i);
      ['ig', 'tt'].forEach(function (pl) {
        if (!publicable(slotTipo(ajustes, pl, d))) return;
        slots++;
        var ok = piezas.some(function (p) { return p[pl] && fechaDe(p, pl) === d && publicadoEn(p, pl); });
        if (ok) llenos++;
      });
    }

    // Vistas
    var conVistas = [];
    piezas.forEach(function (p) {
      ['ig', 'tt'].forEach(function (pl) {
        var pub = publicadoEn(p, pl);
        if (p['vistas_' + pl] != null && pub && String(pub).slice(0, 10) >= addDias(hoy, -Math.max(dias, 90))) {
          conVistas.push({ pieza: p, plataforma: pl, vistas: p['vistas_' + pl] });
        }
      });
    });
    conVistas.sort(function (a, b) { return b.vistas - a.vistas; });
    var promVistas = {};
    conVistas.forEach(function (v) {
      var k = v.pieza.tipo + '|' + v.plataforma;
      (promVistas[k] = promVistas[k] || []).push(v.vistas);
    });
    var vistasPorTipo = Object.keys(promVistas).map(function (k) {
      var s = k.split('|');
      return { tipo: s[0], plataforma: s[1], promedio: promedio(promVistas[k]), n: promVistas[k].length };
    }).sort(function (a, b) { return b.promedio - a.promedio; });

    return {
      dias: dias, desde: desde,
      rondasEtapa: rondasEtapa, chips: chips, totalCorrecciones: totalCorrecciones,
      respuestaAprobacion: { mediana: mediana(tAprob), n: tAprob.length },
      respuestaCorreccion: { mediana: mediana(tCorr), n: tCorr.length },
      publicadas: publicadas,
      cumplimiento: { slots: slots, llenos: llenos, pct: slots ? Math.round(llenos / slots * 100) : null },
      topVistas: conVistas.slice(0, 5), vistasPorTipo: vistasPorTipo
    };
  }

  // ---------- Grabación semanal ----------
  function lunesDe(iso) { var w = diaSemana(iso); return addDias(iso, w === 0 ? -6 : 1 - w); }
  function horaValida(h) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(h || '')); }
  function momento(fecha, hora) { var p = partes(fecha), h = String(hora || '00:00').split(':'); return new Date(p[0], p[1] - 1, p[2], +h[0], +h[1]).getTime(); }
  function fmtHora(h) {
    if (!horaValida(h)) return h || '';
    var x = h.split(':'), n = +x[0];
    return (n % 12 === 0 ? 12 : n % 12) + (x[1] === '00' ? '' : ':' + x[1]) + (n < 12 ? ' a. m.' : ' p. m.');
  }
  // Propuesta automática de la semana: el día/hora de Ajustes; si ya pasó, el día siguiente a la misma hora (dentro de la semana).
  function grabacionPorDefecto(ajustes, ahora) {
    ahora = ahora || new Date();
    var hoy = hoyISO(ahora), lunes = lunesDe(hoy);
    var dia = ajustes && ajustes.grabacion_dia != null ? +ajustes.grabacion_dia : 2;
    var hora = ajustes && horaValida(ajustes.grabacion_hora) ? ajustes.grabacion_hora : '11:00';
    var fecha = addDias(lunes, (dia + 6) % 7);
    // Si ese día ya pasó, se propone mañana (si mañana sigue siendo esta semana); si no, hoy mismo.
    if (momento(fecha, hora) < ahora.getTime()) fecha = addDias(hoy, 1) < addDias(lunes, 7) ? addDias(hoy, 1) : hoy;
    return { semana: lunes, fecha: fecha, hora: hora, estado: 'propuesta', confirmaciones: [] };
  }
  function grabacionDeSemana(grabaciones, hoy) {
    var l = lunesDe(hoy || hoyISO());
    return (grabaciones || []).filter(function (g) { return g.semana === l; })[0] || null;
  }
  function estadoGrabacion(g, equipo, ahora) {
    ahora = ahora || new Date();
    var ids = (equipo || []).map(function (e) { return e.user_id; });
    var conf = (g.confirmaciones || []).filter(function (id) { return ids.indexOf(id) >= 0; });
    var faltan = ids.filter(function (id) { return conf.indexOf(id) < 0; });
    var t = momento(g.fecha, g.hora), ms = t - ahora.getTime();
    var abierta = g.estado === 'propuesta' || g.estado === 'confirmada';
    return {
      confirmados: conf, faltan: faltan, completa: faltan.length === 0 && ids.length > 0,
      pasada: abierta && ms < -60 * 60000,                 // pasó hace más de 1 h: preguntar si se grabó
      urgente: g.estado === 'propuesta' && faltan.length > 0 && ms < 24 * 3600000,
      abierta: abierta
    };
  }
  function errG(m) { var e = new Error(m); e.usuario = true; return e; }
  function accionConfirmar(g, userId, equipo) {
    if (g.estado !== 'propuesta' && g.estado !== 'confirmada') throw errG('Esta grabación ya se cerró.');
    if ((g.confirmaciones || []).indexOf(userId) >= 0) throw errG('Ya la confirmaste.');
    var conf = (g.confirmaciones || []).concat([userId]);
    var completa = estadoGrabacion({ fecha: g.fecha, hora: g.hora, estado: g.estado, confirmaciones: conf }, equipo).completa;
    return { patch: { confirmaciones: conf, estado: completa ? 'confirmada' : 'propuesta' }, match: { fecha: g.fecha, hora: g.hora, estado: g.estado },
      eventos: [{ tipo: 'confirmacion', texto: null, datos: { fecha: g.fecha, hora: g.hora, completa: completa } }] };
  }
  function accionReagendar(g, userId, fecha, hora, motivo, hoy) {
    if (g.estado !== 'propuesta' && g.estado !== 'confirmada') throw errG('Esta grabación ya se cerró.');
    if (!fecha) throw errG('Elige el día.');
    if (!horaValida(hora)) throw errG('Elige la hora.');
    if (hoy && fecha < hoy) throw errG('Ese día ya pasó.');
    if (fecha === g.fecha && hora === g.hora) throw errG('Es el mismo día y hora de ahora.');
    return { patch: { fecha: fecha, hora: hora, confirmaciones: [userId], estado: 'propuesta' }, match: { fecha: g.fecha, hora: g.hora, estado: g.estado },
      eventos: [{ tipo: 'reagenda', texto: limpiar(motivo), datos: { antes: { fecha: g.fecha, hora: g.hora }, despues: { fecha: fecha, hora: hora } } }] };
  }
  function accionCerrarGrabacion(g, hecha, motivo) {
    if (g.estado !== 'propuesta' && g.estado !== 'confirmada') throw errG('Esta grabación ya se cerró.');
    if (!hecha && !txt(motivo)) throw errG('Cuenta brevemente por qué no se grabó.');
    return { patch: { estado: hecha ? 'hecha' : 'cancelada', nota: limpiar(motivo) }, match: { estado: g.estado },
      eventos: [{ tipo: hecha ? 'hecha' : 'cancelada', texto: limpiar(motivo), datos: {} }] };
  }
  function accionReabrirGrabacion(g) {
    if (g.estado !== 'hecha' && g.estado !== 'cancelada') throw errG('No está cerrada.');
    return { patch: { estado: 'propuesta', confirmaciones: [], nota: null }, match: { estado: g.estado }, eventos: [{ tipo: 'reabierta', texto: null, datos: {} }] };
  }
  function racha(grabaciones, hoy, semanas) {
    var l = lunesDe(hoy || hoyISO()), r = [];
    for (var i = semanas; i >= 1; i--) {
      var s = addDias(l, -7 * i);
      var g = (grabaciones || []).filter(function (x) { return x.semana === s; })[0];
      r.push({ semana: s, estado: g ? g.estado : 'sin' });
    }
    return r;
  }
  function msgGrabacion(g, tipo, base, nombre) {
    var cuando = fmtFechaLarga(g.fecha) + ' a las ' + fmtHora(g.hora);
    var link = String(base || '').replace(/#.*$/, '') + '#/grabacion/' + g.id;
    if (tipo === 'completa') return '🎬 Confirmada la grabación: ' + cuando + '. ' + link;
    if (tipo === 'reagenda') return '🎬 ' + (nombre ? nombre + ', ' : '') + 'reagendé la grabación para el ' + cuando + '. ¿Te sirve? Confírmala o propón otra hora en la app: ' + link;
    return '🎬 ' + (nombre ? nombre + ', ' : '') + 'yo confirmé la grabación del ' + cuando + '. Falta que la confirmes tú: ' + link;
  }

  // ---------- WhatsApp ----------
  function normalizarTelefono(t) {
    var d = String(t || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.length === 11 && d.charAt(0) === '0') return '58' + d.slice(1); // 0414… → 58414…
    if (d.length === 10 && d.charAt(0) === '4') return '58' + d;          // 414…  → 58414…
    return d;
  }
  function waLink(telefono, texto) {
    var tel = normalizarTelefono(telefono);
    return 'https://wa.me/' + (tel || '') + '?text=' + encodeURIComponent(texto);
  }
  function enlacePieza(base, id) { return String(base || '').replace(/#.*$/, '') + '#/p/' + id; }
  function nombreEtapa(e) { return ETAPA_LABEL[e] || e || ''; }

  function msgEnvio(p, base, nombre) {
    var visual = etapaNorm(p) === 'video' || etapaNorm(p) === 'diseno';
    return (nombre ? 'Hola ' + nombre + ', ' : '') + 'te dejé para revisar: *' + p.titulo + '* — ' + nombreEtapa(etapaNorm(p)) + ' v' + p.version + '.' +
      (visual ? '\nTe mando el archivo por aquí 👇' : '') +
      '\nApruébalo o corrígelo en la app: ' + enlacePieza(base, p.id);
  }
  function msgCorreccion(p, ev, base) {
    var d = (ev && ev.datos) || {};
    var lineas = ['✏️ Correcciones en *' + p.titulo + '* (' + nombreEtapa(ev.etapa) + ' v' + ev.version + '):'];
    (d.chips || []).forEach(function (c) { lineas.push('• ' + c); });
    (d.puntos || []).forEach(function (x) { lineas.push('• ' + (x.ubicacion ? x.ubicacion + ' — ' : '') + (x.texto || '')); });
    if (ev.texto) lineas.push('• ' + ev.texto);
    lineas.push('Detalle en la app: ' + enlacePieza(base, p.id));
    return lineas.join('\n');
  }
  function msgAprobacion(p, ev, base, siguiente) {
    return '✅ Aprobado: *' + p.titulo + '* — ' + nombreEtapa(ev.etapa) + '.' +
      (siguiente ? '\nSigue: ' + nombreEtapa(siguiente) + '.' : (ev.datos && (ev.datos.sinfecha || ev.datos.banco) ? '\nQuedó lista, todavía sin fecha.' : '\nYa tiene fecha en el calendario.')) +
      '\n' + enlacePieza(base, p.id);
  }
  function msgResumenLote(items, base) {
    var ap = items.filter(function (x) { return x.accion === 'aprobada'; });
    var co = items.filter(function (x) { return x.accion === 'correccion'; });
    var l = ['Revisé ' + (ap.length + co.length) + (ap.length + co.length === 1 ? ' pieza' : ' piezas') + ': ✅ ' + ap.length + ' aprobadas, ✏️ ' + co.length + ' con correcciones.'];
    co.forEach(function (x) { l.push('✏️ ' + x.titulo + ' (' + nombreEtapa(x.etapa) + ')'); });
    ap.forEach(function (x) { l.push('✅ ' + x.titulo + ' (' + nombreEtapa(x.etapa) + ')'); });
    l.push('Tus pendientes: ' + String(base || '').replace(/#.*$/, '') + '#/');
    return l.join('\n');
  }

  return {
    PLATAFORMAS: PLATAFORMAS, PLAT_CORTO: PLAT_CORTO, TIPOS: TIPOS, ETAPAS: ETAPAS, ETAPA_LABEL: ETAPA_LABEL, TIPO_DIA: TIPO_DIA,
    DIAS: DIAS, DIAS_CORTOS: DIAS_CORTOS, CRONOGRAMA_BASE: CRONOGRAMA_BASE, AJUSTES_BASE: AJUSTES_BASE,
    CHIPS: CHIPS, UBICACION: UBICACION, OBJETIVOS: OBJETIVOS, CHECKLIST_PUBLICAR: CHECKLIST_PUBLICAR, TIPOS_EVENTO: TIPOS_EVENTO,
    hoyISO: hoyISO, addDias: addDias, diaSemana: diaSemana, diffDias: diffDias, fmtFecha: fmtFecha, fmtFechaLarga: fmtFechaLarga,
    horasEntre: horasEntre, haceCuanto: haceCuanto, fmtHoras: fmtHoras,
    plataformasDe: plataformasDe, fechaDe: fechaDe, publicadoEn: publicadoEn, pendientesDePublicar: pendientesDePublicar,
    etapasDe: etapasDe, etapaNorm: etapaNorm, esFinal: esFinal, gruposChips: gruposChips, COLUMNAS: COLUMNAS, columnaDe: columnaDe, leToca: leToca, pasosDe: pasosDe,
    entrega: entrega, proximaFecha: proximaFecha, fechaLimite: fechaLimite, accionAGrabacion: accionAGrabacion, eventosEtapaActual: eventosEtapaActual, ocupa: ocupa, diaCfg: diaCfg, cron: cron, slotTipo: slotTipo, publicable: publicable, cabe: cabe, checklistDe: checklistDe, minimo: minimo, enBanco: enBanco, estadoDe: estadoDe,
    ocupado: ocupado, slotLibre: slotLibre, sugerirFechas: sugerirFechas, validarFechas: validarFechas,
    huecos: huecos, candidatosHueco: candidatosHueco,
    nuevaPieza: nuevaPieza, accionEnviar: accionEnviar, accionAprobar: accionAprobar, accionCorregir: accionCorregir,
    accionEspera: accionEspera, accionLlego: accionLlego, accionFechas: accionFechas, accionPublicar: accionPublicar,
    accionVistas: accionVistas, accionComentario: accionComentario, accionArchivar: accionArchivar, accionReabrir: accionReabrir,
    accionIniciar: accionIniciar, accionEditar: accionEditar, puedeCambiarTipo: puedeCambiarTipo,
    pendientes: pendientes, esperasPorProducto: esperasPorProducto,
    eventosDe: eventosDe, rondasDe: rondasDe, ultimaCorreccion: ultimaCorreccion, ultimoEnvio: ultimoEnvio, metricas: metricas,
    normalizarTelefono: normalizarTelefono, waLink: waLink, enlacePieza: enlacePieza, nombreEtapa: nombreEtapa,
    msgEnvio: msgEnvio, msgCorreccion: msgCorreccion, msgAprobacion: msgAprobacion, msgResumenLote: msgResumenLote,
    lunesDe: lunesDe, horaValida: horaValida, momento: momento, fmtHora: fmtHora, grabacionPorDefecto: grabacionPorDefecto, grabacionDeSemana: grabacionDeSemana,
    estadoGrabacion: estadoGrabacion, accionConfirmar: accionConfirmar, accionReagendar: accionReagendar, accionCerrarGrabacion: accionCerrarGrabacion,
    accionReabrirGrabacion: accionReabrirGrabacion, racha: racha, msgGrabacion: msgGrabacion
  };
});

/* Contenido Barquero — textos de las notificaciones (quién recibe qué). Usa BFLogic. */
(function (root, factory) {
  var L = root.BFLogic || (typeof require === 'function' ? require('../contenidoBF/logic.js') : null);
  var mod = factory(L);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.BFNotif = mod;
})(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';

  function hoyEn(zona, ahora) {
    var d = ahora || new Date();
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: zona || 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
    catch (e) { return L.hoyISO(d); }
  }
  function corto(t, n) { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; }
  function nombre(equipo, id) { var m = (equipo || []).filter(function (e) { return e.user_id === id; })[0]; return m ? m.nombre : 'Alguien'; }
  // Destinatarios: todo el equipo menos quien hizo la acción, opcionalmente filtrado por rol
  function para(equipo, autor, rol) {
    return (equipo || []).filter(function (e) { return e.user_id !== autor && (!rol || e.rol === rol); }).map(function (e) { return e.user_id; });
  }
  function fechasTxt(x) {
    var p = [];
    if (x.fecha_ig) p.push('IG ' + L.fmtFecha(x.fecha_ig));
    if (x.fecha_tt) p.push('TikTok ' + L.fmtFecha(x.fecha_tt));
    return p.join(' · ');
  }
  function msg(ids, titulo, cuerpo, hash, tag) {
    return ids.map(function (id) { return { user_id: id, titulo: titulo, cuerpo: cuerpo || '', hash: hash, tag: tag }; });
  }

  // Evento de una pieza → lista de mensajes
  function mensajeEvento(ev, p, equipo) {
    if (!ev || !p) return [];
    var d = ev.datos || {};
    var quien = nombre(equipo, ev.autor);
    var t = '«' + corto(p.titulo, 60) + '»';
    var hash = '#/p/' + p.id;
    var tag = 'p-' + p.id;
    var prox = L.proximaFecha(p);
    switch (ev.tipo) {
      case 'envio':
        return msg(para(equipo, ev.autor, 'aprueba'), '👀 Para aprobar: ' + t,
          quien + ' envió ' + L.nombreEtapa(ev.etapa) + ' v' + ev.version + '.' + (prox ? ' Se publica el ' + L.fmtFecha(prox) + '.' : ''), hash, tag);
      case 'correccion': {
        var partes = (d.chips || []).slice();
        (d.puntos || []).forEach(function (x) { partes.push((x.ubicacion ? x.ubicacion + ': ' : '') + (x.texto || '')); });
        if (ev.texto) partes.push(ev.texto);
        return msg(para(equipo, ev.autor, 'edita'), '✏️ Correcciones en ' + t, corto(partes.join(' · '), 160), hash, tag);
      }
      case 'aprobacion':
        return msg(para(equipo, ev.autor, 'edita'), '✅ Aprobado: ' + t,
          d.siguiente ? 'Sigue: ' + L.nombreEtapa(d.siguiente) + '.' : (prox ? 'Se publica el ' + L.fmtFecha(prox) + '.' : 'Quedó lista, todavía sin fecha.'), hash, tag);
      case 'fechas':
        if (d.sinfecha || !prox) return msg(para(equipo, ev.autor), '📅 ' + t + ' quedó sin fecha', 'Ya no tiene día de publicación.', hash, tag);
        return msg(para(equipo, ev.autor), '📅 Nueva fecha: ' + t,
          fechasTxt(p) + (d.limite ? '. Entrégala antes del ' + L.fmtFecha(d.limite) + '.' : ''), hash, tag);
      case 'comentario':
        return msg(para(equipo, ev.autor), '💬 ' + quien + ' comentó en ' + t, corto(ev.texto, 160), hash, tag);
      case 'publicado':
        return msg(para(equipo, ev.autor, 'aprueba'), '🚀 Publicado en ' + (L.PLATAFORMAS[d.plataforma] || '') + ': ' + t, '', hash, tag);
      case 'iniciada':
        return msg(para(equipo, ev.autor, 'edita'), '🎬 Grabado: ' + t, 'Pasa a tu cola de edición.' + (prox ? ' Se publica el ' + L.fmtFecha(prox) + '.' : ''), hash, tag);
      case 'llego':
        return msg(para(equipo, ev.autor), '📦 Llegó ' + corto(ev.texto || 'la mercancía', 40), 'Las piezas que la esperaban ya se pueden programar.', '#/', 'llego-' + String(ev.texto || '').toLowerCase());
      default:
        return [];
    }
  }

  function cuando(fecha, hora) { return L.fmtFechaLarga(fecha) + ', ' + L.fmtHora(hora); }
  function mensajeGrabacion(ev, g, equipo) {
    if (!ev || !g) return [];
    var d = ev.datos || {};
    var quien = nombre(equipo, ev.autor);
    var hash = '#/grabacion/' + g.id;
    var tag = 'g-' + g.id;
    switch (ev.tipo) {
      case 'auto':
        return msg(para(equipo, ev.autor), '🎬 Grabación de esta semana', cuando(g.fecha, g.hora) + '. Confírmala o propón otro día.', hash, tag);
      case 'confirmacion':
        if (d.completa) return msg(para(equipo, ev.autor), '🎬 Grabación confirmada', cuando(d.fecha || g.fecha, d.hora || g.hora) + '.', hash, tag);
        return msg(para(equipo, ev.autor), '✓ ' + quien + ' confirmó la grabación', cuando(d.fecha || g.fecha, d.hora || g.hora) + '. Falta tu confirmación.', hash, tag);
      case 'reagenda':
        return msg(para(equipo, ev.autor), '🔁 ' + quien + ' propone grabar el ' + L.fmtFecha(d.despues.fecha) + ', ' + L.fmtHora(d.despues.hora),
          (ev.texto ? corto(ev.texto, 120) + '. ' : '') + '¿Te sirve? Confírmala en la app.', hash, tag);
      case 'hecha':
        return msg(para(equipo, ev.autor), '✅ Grabación hecha', 'Marca «Grabado ✓» en cada video para que pase a edición.', hash, tag);
      case 'cancelada':
        return msg(para(equipo, ev.autor), '❌ No se grabó esta semana', corto(ev.texto, 120), hash, tag);
      default:
        return [];
    }
  }

  // Resumen de la mañana para cada persona (solo si hay algo que decir)
  function resumenDiario(datos, hoy, ahora) {
    var out = [];
    var aj = datos.ajustes;
    var g = L.grabacionDeSemana(datos.grabaciones || [], hoy);
    (datos.equipo || []).forEach(function (m) {
      var r = L.pendientes(datos.piezas || [], datos.eventos || [], m.rol, hoy, aj);
      var lineas = [];
      if (m.rol === 'edita') {
        var hoyPub = r.publicar.filter(function (x) { return !x.atrasada; });
        if (hoyPub.length) lineas.push('🚀 Publicar hoy: ' + hoyPub.map(function (x) { return corto(x.pieza.titulo, 30) + ' (' + L.PLAT_CORTO[x.plataforma] + ')'; }).join(', '));
        if (r.atrasadas.length) lineas.push('⚠️ Sin publicar desde antes: ' + r.atrasadas.length);
        var vence = r.editar.filter(function (p) { var l = L.fechaLimite(p, aj); return l && l <= hoy; });
        if (vence.length) lineas.push('⏰ Entregar hoy o atrasadas: ' + vence.map(function (p) { return corto(p.titulo, 30); }).join(', '));
        var corr = r.editar.filter(function (p) { return p.version > 0; }).length;
        if (corr) lineas.push('✏️ Correcciones pendientes: ' + corr);
      } else {
        if (r.revisar.length) lineas.push('👀 Por aprobar: ' + r.revisar.length);
        if (r.riesgo.length) lineas.push('⚠️ Se publican pronto sin aprobar: ' + r.riesgo.map(function (x) { return corto(x.pieza.titulo, 30); }).join(', '));
        if (r.programar.length) lineas.push('📅 Listas sin fecha: ' + r.programar.length);
      }
      if (g && (g.estado === 'propuesta' || g.estado === 'confirmada')) {
        var conf = (g.confirmaciones || []).indexOf(m.user_id) >= 0;
        if (g.fecha === hoy) lineas.push('🎬 Hoy se graba a las ' + L.fmtHora(g.hora));
        else if (!conf && g.fecha > hoy) lineas.push('🎬 Falta que confirmes la grabación del ' + L.fmtFecha(g.fecha));
      }
      if (lineas.length) out.push({ user_id: m.user_id, titulo: '☀️ Hoy en Contenido', cuerpo: lineas.join('\n'), hash: '#/', tag: 'diario' });
    });
    return out;
  }

  return { hoyEn: hoyEn, mensajeEvento: mensajeEvento, mensajeGrabacion: mensajeGrabacion, resumenDiario: resumenDiario };
});

/* Web Push sin dependencias (RFC 8291 aes128gcm + RFC 8292 VAPID) con WebCrypto. Funciona en Deno y Node 20+. */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.BFPush = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var subtle = (globalThis.crypto && globalThis.crypto.subtle);
  var enc = new TextEncoder();

  function b64u(bytes) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function deB64u(t) {
    t = String(t).replace(/-/g, '+').replace(/_/g, '/');
    t += '='.repeat((4 - t.length % 4) % 4);
    var raw = atob(t), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function concat() {
    var n = 0, i, partes = Array.prototype.slice.call(arguments);
    for (i = 0; i < partes.length; i++) n += partes[i].length;
    var out = new Uint8Array(n), o = 0;
    for (i = 0; i < partes.length; i++) { out.set(partes[i], o); o += partes[i].length; }
    return out;
  }
  function aleatorio(n) { var b = new Uint8Array(n); globalThis.crypto.getRandomValues(b); return b; }

  // Claves VAPID nuevas: { publico: base64url (65 bytes), privado: JWK }
  async function generarVapid() {
    var par = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    var pub = new Uint8Array(await subtle.exportKey('raw', par.publicKey));
    var jwk = await subtle.exportKey('jwk', par.privateKey);
    return { publico: b64u(pub), privado: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d } };
  }

  async function firmaVapid(endpoint, vapid, sujeto, ahoraSeg) {
    var aud = new URL(endpoint).origin;
    var exp = (ahoraSeg || Math.floor(Date.now() / 1000)) + 12 * 3600;
    var cab = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    var carga = b64u(enc.encode(JSON.stringify({ aud: aud, exp: exp, sub: sujeto || 'mailto:contenido@barquerofood.com' })));
    var clave = await subtle.importKey('jwk', Object.assign({ ext: true, key_ops: ['sign'] }, vapid.privado), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    var firma = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, clave, enc.encode(cab + '.' + carga)));
    return 'vapid t=' + cab + '.' + carga + '.' + b64u(firma) + ', k=' + vapid.publico;
  }

  async function hkdf(sal, ikm, info, largo) {
    var k = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: sal, info: info }, k, largo * 8));
  }

  // Cifra el mensaje para una suscripción { p256dh, auth } → cuerpo binario aes128gcm
  async function cifrar(texto, p256dh, auth, opciones) {
    opciones = opciones || {};
    var uaPub = deB64u(p256dh), secreto = deB64u(auth);
    var as = opciones.parEfimero || await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    var asPub = new Uint8Array(await subtle.exportKey('raw', as.publicKey));
    var uaClave = await subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    var compartido = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: uaClave }, as.privateKey, 256));
    var ikm = await hkdf(secreto, compartido, concat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
    var sal = opciones.sal || aleatorio(16);
    var cek = await hkdf(sal, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
    var nonce = await hkdf(sal, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
    var claro = concat(enc.encode(texto), new Uint8Array([2])); // 0x02 = último registro
    var k = await subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
    var cifrado = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, claro));
    var rs = new Uint8Array([0, 0, 16, 0]); // 4096
    return concat(sal, rs, new Uint8Array([asPub.length]), asPub, cifrado);
  }

  // Envía un mensaje. Devuelve { ok, status, expirada }
  async function enviar(sub, datos, vapid, opciones) {
    opciones = opciones || {};
    var f = opciones.fetch || fetch;
    var cuerpo = await cifrar(JSON.stringify(datos), sub.p256dh, sub.auth);
    var r = await f(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await firmaVapid(sub.endpoint, vapid, opciones.sujeto),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(opciones.ttl || 86400),
        Urgency: opciones.urgencia || 'normal'
      },
      body: cuerpo
    });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, expirada: r.status === 404 || r.status === 410 };
  }

  return { b64u: b64u, deB64u: deB64u, concat: concat, generarVapid: generarVapid, firmaVapid: firmaVapid, cifrar: cifrar, enviar: enviar, hkdf: hkdf };
});

/* Función «notificar» (Supabase Edge Function): recibe avisos de la base de datos y manda las notificaciones. */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.BFFuncion = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };
  function json(cuerpo, status) {
    return new Response(JSON.stringify(cuerpo), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS) });
  }

  // deps: { L, N, WP, env: { url, clave, zona }, fetch, ahora }
  function crear(deps) {
    var L = deps.L, N = deps.N, WP = deps.WP, env = deps.env;
    var f = deps.fetch || fetch;
    var base = String(env.url || '').replace(/\/+$/, '');

    function cab(extra) {
      var h = { apikey: env.clave, 'Content-Type': 'application/json' };
      if (/^eyJ/.test(env.clave || '')) h.Authorization = 'Bearer ' + env.clave;
      return Object.assign(h, extra || {});
    }
    async function db(metodo, ruta, cuerpo, prefer) {
      var r = await f(base + '/rest/v1/' + ruta, { method: metodo, headers: cab(prefer ? { Prefer: prefer } : {}), body: cuerpo == null ? undefined : JSON.stringify(cuerpo) });
      var t = await r.text();
      if (!r.ok) throw new Error('BD ' + metodo + ' ' + ruta.split('?')[0] + ': ' + r.status + ' ' + t.slice(0, 200));
      return t ? JSON.parse(t) : null;
    }
    async function config() {
      var filas = await db('GET', 'push_config?id=eq.1&select=*');
      if (filas && filas[0]) return filas[0];
      var v = await WP.generarVapid();
      var secreto = WP.b64u(globalThis.crypto.getRandomValues(new Uint8Array(24)));
      await db('POST', 'push_config', { id: 1, vapid_publico: v.publico, vapid_privado: v.privado, secreto: secreto, url: base + '/functions/v1/notificar' }, 'resolution=ignore-duplicates,return=minimal');
      filas = await db('GET', 'push_config?id=eq.1&select=*');
      return filas[0];
    }
    async function enviarMensajes(mensajes, cfg) {
      if (!mensajes.length) return { enviadas: 0, fallidas: 0 };
      var ids = mensajes.map(function (m) { return m.user_id; }).filter(function (x, i, a) { return a.indexOf(x) === i; });
      var subs = await db('GET', 'push_subs?select=*&user_id=in.(' + ids.join(',') + ')');
      var vapid = { publico: cfg.vapid_publico, privado: cfg.vapid_privado };
      var enviadas = 0, fallidas = 0;
      for (var i = 0; i < mensajes.length; i++) {
        var m = mensajes[i];
        var suyas = subs.filter(function (s) { return s.user_id === m.user_id; });
        for (var j = 0; j < suyas.length; j++) {
          try {
            var r = await WP.enviar(suyas[j], { titulo: m.titulo, cuerpo: m.cuerpo, hash: m.hash, tag: m.tag }, vapid, { fetch: f });
            if (r.ok) enviadas++; else fallidas++;
            if (r.expirada) await db('DELETE', 'push_subs?endpoint=eq.' + encodeURIComponent(suyas[j].endpoint)).catch(function () { /* se reintenta la próxima vez */ });
          } catch (e) { fallidas++; }
        }
      }
      return { enviadas: enviadas, fallidas: fallidas };
    }
    async function usuarioDe(req) {
      var a = req.headers.get('authorization') || '';
      if (!/^Bearer /.test(a)) return null;
      var r = await f(base + '/auth/v1/user', { headers: { apikey: env.clave, Authorization: a } });
      if (!r.ok) return null;
      var u = await r.json();
      return u && u.id ? u.id : null;
    }
    function hoy() { return N.hoyEn(env.zona || 'America/Caracas', deps.ahora ? deps.ahora() : new Date()); }

    async function manejar(req) {
      try {
        if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
        var u = new URL(req.url);
        if (req.method === 'GET') {
          if (u.searchParams.get('accion') !== 'clave') return json({ error: 'acción desconocida' }, 400);
          var c0 = await config();
          return json({ publica: c0.vapid_publico });
        }
        if (req.method !== 'POST') return json({ error: 'método no permitido' }, 405);
        var cuerpo = await req.json().catch(function () { return {}; });
        var cfg = await config();
        if (cuerpo.tipo === 'prueba') {
          var uid = await usuarioDe(req);
          if (!uid) return json({ error: 'Inicia sesión para probar.' }, 401);
          var r0 = await enviarMensajes([{ user_id: uid, titulo: '🔔 Prueba de Contenido Barquero', cuerpo: 'Si ves esto, las notificaciones funcionan en este dispositivo.', hash: '#/ajustes', tag: 'prueba' }], cfg);
          return json(r0);
        }
        if (req.headers.get('x-bf-secreto') !== cfg.secreto) return json({ error: 'no autorizado' }, 401);
        var equipo = await db('GET', 'equipo?select=*');
        if (cuerpo.tipo === 'evento') {
          var mensajes = [];
          if (cuerpo.tabla === 'eventos') {
            var ev = (await db('GET', 'eventos?select=*&id=eq.' + encodeURIComponent(cuerpo.id)))[0];
            var p = ev && (await db('GET', 'piezas?select=*&id=eq.' + encodeURIComponent(ev.pieza_id)))[0];
            mensajes = N.mensajeEvento(ev, p, equipo);
          } else if (cuerpo.tabla === 'grabacion_eventos') {
            var ge = (await db('GET', 'grabacion_eventos?select=*&id=eq.' + encodeURIComponent(cuerpo.id)))[0];
            var g = ge && (await db('GET', 'grabaciones?select=*&id=eq.' + encodeURIComponent(ge.grabacion_id)))[0];
            mensajes = N.mensajeGrabacion(ge, g, equipo);
          }
          return json(await enviarMensajes(mensajes, cfg));
        }
        if (cuerpo.tipo === 'diario') {
          var datos = {
            equipo: equipo,
            ajustes: (await db('GET', 'ajustes?select=*'))[0],
            piezas: await db('GET', 'piezas?select=*&fase=neq.archivada'),
            eventos: [],
            grabaciones: await db('GET', 'grabaciones?select=*&order=semana.desc&limit=4')
          };
          return json(await enviarMensajes(N.resumenDiario(datos, hoy()), cfg));
        }
        return json({ error: 'tipo desconocido' }, 400);
      } catch (e) {
        return json({ error: String(e && e.message || e) }, 500);
      }
    }
    return { manejar: manejar, config: config };
  }
  return { crear: crear };
});

const _funcion = globalThis.BFFuncion.crear({
  L: globalThis.BFLogic, N: globalThis.BFNotif, WP: globalThis.BFPush,
  env: { url: Deno.env.get('SUPABASE_URL'), clave: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), zona: 'America/Caracas' }
});
Deno.serve((req) => _funcion.manejar(req));
