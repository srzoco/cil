/* Las versiones (?v=) de cada index.html deben estar en la lista ARCHIVOS de sw.js, y cada archivo de la lista debe existir.
   Si no coinciden, el teléfono guarda un archivo y la página pide otro: la app abre más lento o mezcla versiones.
   Uso: node pruebas/versiones.js   (no necesita navegador ni servidor) */
const fs = require('fs'), path = require('path');
const raiz = path.join(__dirname, '..');
const sw = fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8');
const lista = eval(sw.match(/var ARCHIVOS = (\[[\s\S]*?\]);/)[1]);
const fallas = [];
for (const a of lista) {
  const f = a.split('?')[0], real = f === './' ? 'index.html' : /\/$/.test(f) ? f + 'index.html' : f;
  if (!fs.existsSync(path.join(raiz, real))) fallas.push('sw.js guarda «' + a + '» pero ese archivo no existe');
}
for (const pag of ['index.html', 'tareas/index.html', 'pendientes/index.html', 'contenido/index.html', 'mensajes/index.html']) {
  const html = fs.readFileSync(path.join(raiz, pag), 'utf8'), dir = path.dirname(pag);
  for (const m of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)\?v=\d+)"/g)) {
    const ruta = path.posix.normalize(path.posix.join(dir, m[1]));
    if (lista.indexOf(ruta) < 0) fallas.push(pag + ' pide «' + ruta + '» y sw.js no lo tiene en ARCHIVOS (¿faltó subir el ?v= en sw.js?)');
  }
}
if (fallas.length) { console.error('FALLAS:\n- ' + fallas.join('\n- ')); process.exit(1); }
console.log('OK: las versiones de las páginas coinciden con sw.js (' + lista.length + ' archivos).');
