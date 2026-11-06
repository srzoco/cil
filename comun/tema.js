/* Tema claro/oscuro: se aplica antes de pintar (va en el <head>) y se recuerda en este teléfono.
   Sin elección guardada, sigue el modo del teléfono. */
(function () {
  var K = 'barquero_tema';
  function leer() { try { return localStorage.getItem(K); } catch (e) { return null; } }
  function aplicar(t) { if (t === 'claro' || t === 'oscuro') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); }
  aplicar(leer());
  // Sin zoom: la app ya está hecha a la medida de la pantalla. El iPhone ignora «user-scalable=no» del viewport,
  // así que se frena el gesto de pellizcar; y los campos van a 16 px como mínimo (con menos, el iPhone se acerca solo al escribir).
  var st = document.createElement('style');
  st.textContent = 'html{-webkit-text-size-adjust:100%;text-size-adjust:100%;touch-action:pan-x pan-y}input,select,textarea{font-size:max(16px,1em)}';
  document.head.appendChild(st);
  ['gesturestart', 'gesturechange'].forEach(function (ev) { document.addEventListener(ev, function (e) { e.preventDefault(); }, { passive: false }); });
  function actual() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t) return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
  }
  var SOL = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var LUNA = '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';
  window.BarqueroTema = {
    actual: actual,
    boton: function () { var o = actual() === 'oscuro'; return '<button class="boton-tema" data-tema-cambiar aria-label="' + (o ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro') + '" title="' + (o ? 'Modo claro' : 'Modo oscuro') + '">' + (o ? SOL : LUNA) + '</button>'; },
    cambiar: function () { var n = actual() === 'oscuro' ? 'claro' : 'oscuro'; try { localStorage.setItem(K, n); } catch (e) { /* sin almacenamiento */ } aplicar(n); return n; }
  };
  // Versión nueva publicada (avisa sw.js): recién abierta y sin nadie escribiendo, se recarga sola; si no, botón «Actualizar»
  var T0 = Date.now();
  function escribiendo() { var a = document.activeElement; return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); }
  function botonActualizar() {
    if (document.getElementById('cil-actualizar')) return;
    var d = document.createElement('button'); d.id = 'cil-actualizar'; d.type = 'button'; d.textContent = '↻ Hay una versión nueva · Actualizar';
    d.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(96px + env(safe-area-inset-bottom));z-index:900;border:0;border-radius:999px;' +
      'padding:12px 18px;background:var(--accent,#001E54);color:var(--accent-ink,#fff);font:600 .9rem var(--sans,system-ui);box-shadow:0 6px 18px rgba(0,30,84,.25);max-width:calc(100% - 32px)';
    d.onclick = function () { location.reload(); };
    document.body.appendChild(d);
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', function (e) {
    if (!e.data || e.data.tipo !== 'nueva-version') return;
    var ya = 0; try { ya = +sessionStorage.getItem('cil_recargado') || 0; } catch (x) { /* nada */ }
    if (Date.now() - T0 < 8000 && !escribiendo() && Date.now() - ya > 30000) {
      try { sessionStorage.setItem('cil_recargado', String(Date.now())); } catch (x) { /* nada */ }
      location.reload();
    } else botonActualizar();
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-tema-cambiar]'); if (!b) return;
    window.BarqueroTema.cambiar();
    b.outerHTML = window.BarqueroTema.boton();
  });
})();
