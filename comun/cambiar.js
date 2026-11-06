/* CIL — cambiar de herramienta sin pasar por el menú.
   El botón que antes llevaba al menú de CIL (☰, «‹ Menú de CIL», el logo de Pendientes) ahora abre una hoja abajo
   con las otras herramientas de la persona; el menú completo sigue al final de la hoja.
   Los accesos salen del menú guardado en el teléfono (barquero_cache_menu_<id>); si no hay, el botón lleva al menú como antes. */
(function () {
  'use strict';
  var MODULOS = [
    { id: 'tareas', nombre: 'Tareas', ic: '✅', href: '../tareas/' },
    { id: 'contenido', nombre: 'Contenido', ic: '🎬', href: '../contenido/' },
    { id: 'pendientes', nombre: 'Pendientes', ic: '📋', href: '../pendientes/', soloGerencia: true },
    { id: 'mensajes', nombre: 'Armador de mensajes', ic: '💬', href: '../mensajes/' }
  ];
  function leer(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function actual() { var m = location.pathname.match(/\/(tareas|contenido|pendientes|mensajes)\//); return m ? m[1] : null; }
  function mios() {
    var s = leer('barquero_sesion'), p = s && s.user && leer('barquero_cache_menu_' + s.user.id);
    if (!p) return null;
    var admin = p.rol === 'admin';
    return MODULOS.filter(function (m) { return admin || (!m.soloGerencia && (p.accesos || []).indexOf(m.id) >= 0); });
  }
  function esBotonMenu(a) {
    if (!a || a.getAttribute('href') !== '../') return false;
    return /(^|\s)(menu-btn|menu-cil|volver-cil|marca)(\s|$)/.test(a.className);
  }
  function cerrar() { var h = document.getElementById('cambiar-hoja'); if (h) h.remove(); }
  function abrir(lista) {
    cerrar();
    var aqui = actual();
    var otros = lista.filter(function (m) { return m.id !== aqui; });
    var d = document.createElement('div');
    d.id = 'cambiar-hoja';
    d.innerHTML = '<div class="cambiar-fondo" data-cambiar="cerrar"></div><div class="cambiar-panel" role="dialog" aria-modal="true" aria-label="Cambiar de herramienta">' +
      '<p class="cambiar-t">Ir a</p>' + otros.map(function (m) {
        return '<a class="cambiar-op" href="' + m.href + '"><span class="cambiar-ic" aria-hidden="true">' + m.ic + '</span>' + m.nombre + '</a>';
      }).join('') + '<a class="cambiar-op cambiar-menu" href="../"><span class="cambiar-ic" aria-hidden="true">🏠</span>Menú de CIL</a></div>';
    document.body.appendChild(d);
    var pr = d.querySelector('.cambiar-op'); if (pr) try { pr.focus({ preventScroll: true }); } catch (e) { /* nada */ }
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-cambiar="cerrar"]')) { cerrar(); return; }
    var a = e.target.closest && e.target.closest('a');
    if (!esBotonMenu(a) || e.metaKey || e.ctrlKey) return;
    var lista = mios();
    if (!lista || lista.filter(function (m) { return m.id !== actual(); }).length < 1) return;  // sin otras herramientas: al menú, como antes
    e.preventDefault(); e.stopPropagation();
    abrir(lista);
  }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrar(); });
  window.addEventListener('pageshow', cerrar);  // al volver con «atrás», la hoja no queda abierta

  var css = document.createElement('style');
  css.textContent = '#cambiar-hoja{position:fixed;inset:0;z-index:1000}' +
    '.cambiar-fondo{position:absolute;inset:0;background:rgba(0,10,30,.45)}' +
    '.cambiar-panel{position:absolute;left:0;right:0;bottom:0;background:var(--card,#fff);color:var(--ink,#0E1A33);border-radius:18px 18px 0 0;' +
    'padding:14px 16px calc(16px + env(safe-area-inset-bottom));box-shadow:0 -6px 24px rgba(0,30,84,.18);max-width:560px;margin:0 auto;display:flex;flex-direction:column;gap:8px}' +
    '.cambiar-t{margin:0 0 2px;font:700 .8rem var(--sans,system-ui);text-transform:uppercase;letter-spacing:.06em;color:var(--muted,#4D5870)}' +
    '.cambiar-op{display:flex;align-items:center;gap:12px;min-height:52px;padding:0 14px;border:1.5px solid var(--line,#D9DFEA);border-radius:14px;' +
    'text-decoration:none;color:var(--ink,#0E1A33);font:600 1rem var(--sans,system-ui);background:var(--card,#fff)}' +
    '.cambiar-op:active{background:var(--accent-bg,#E5EBF5)}' +
    '.cambiar-ic{font-size:1.25rem;width:28px;text-align:center}' +
    '.cambiar-menu{border-style:dashed;color:var(--muted,#4D5870)}';
  document.head.appendChild(css);
})();
