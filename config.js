/* =====================================================================
   CONFIGURACIÓN — lo único que hay que editar. Vale para todos los módulos.
   Es la misma base de datos de Contenido.
     supabaseUrl: la "Project URL"
     supabaseKey: la clave pública "publishable" (sb_publishable_…) o "anon public". NUNCA la "secret".
   Si los dos quedan vacíos, Tareas funciona en MODO DEMO (datos de ejemplo en el teléfono).
   ===================================================================== */
window.BARQUERO_CONFIG = {
  supabaseUrl: 'https://xooofdppgnpibasambuc.supabase.co',
  supabaseKey: 'sb_publishable_-rf7ZUzMdnuLHs9dGnj44Q_amcRfcTY',
  // Avisos en el teléfono de Tareas (opcional): la clave PÚBLICA que genera la app en Equipo → Avisos.
  vapidPublicKey: 'BMsI8ZFML31Bx8LRcTzH6yJxx5YrBpaWvhwqgDU_TrvNp7_TuCJEKsjTxPfYK3rXtjYhDQsi7egI_FyRDVoGKhk'
};
window.TB_CONFIG = window.BARQUERO_CONFIG;
