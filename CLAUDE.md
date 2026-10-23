# CIL — herramientas internas (Barquero Food y empresas relacionadas)

## Con quién trabajas
- Sara (srzoco), gerencia de una empresa familiar venezolana de delicatesen. Escribe en español; responde en español.
- Respuestas **muy cortas** (tipo aviso, 3–4 líneas). Pasos cortos con ✅ de verificación, nunca listas eternas.
- Rétala: si algo tiene un problema o hay una alternativa mejor, dilo directo. Pregunta antes de recomendar cuando falte contexto.
- No es programadora: explica sin jerga ("la base de datos", "el reloj de avisos"), y dale el texto exacto para pegar.
- Publicar (push a main): lo que ella pidió explícitamente y los arreglos de errores se publican directo; lo que tú sugieras va primero a la página de aprobación (https://claude.ai/artifact/B3s85DdSYu8ucAxCsfFDiq). Autor de los commits: `srzoco <srzoco00@gmail.com>`.

## Qué es
App web unificada **CIL** en GitHub Pages: https://srzoco.github.io/cil/
- `index.html` + `comun/hub.js`: menú con un solo inicio de sesión. Cada persona ve solo los módulos de `personas.accesos`; rol `admin` (gerencia) ve todo.
- `comun/tema.css` / `tema.js`: colores de marca (azul #001E54, gris #B7B6B5, Gloock en títulos solo peso 400, Montserrat en texto) y botón claro/oscuro (`barquero_tema`). El modo claro es para despachadores al sol. Amarillo y naranja son señales de venta: no se usan en la interfaz.
- `tareas/`: módulo de tareas rotativas del personal de mantenimiento (vanilla JS, sin compilación).
- Contenido y Armador de mensajes todavía abren sus apps viejas (`srzoco/contenidoBF`, `srzoco/mensajesBF`) desde el menú.
- Base de datos: el Supabase de Contenido (proyecto `xooofdppgnpibasambuc`, organización DEB, plan free). `config.js` lleva URL y clave publicable, más `vapidPublicKey`.

## Archivos clave
- `tareas/logic.js`: reglas puras (reparto, puntualidad, urgencias). **Debe coincidir con el SQL**: cualquier regla nueva va en los dos (`logic.js`/`demo.js` y `supabase/cil.sql`).
- `tareas/store.js`: DemoStore (localStorage, imita el SQL) y SupabaseStore (REST/RPC). `tablaReal()` traduce `ajustes` → `tareas_ajustes` y `eventos` → `tareas_eventos`, porque Contenido ya tiene tablas con esos nombres.
- `tareas/app.js`: interfaz SPA (rutas hash, delegación `data-acc` / `data-form`). Equipo es un menú con subpantallas `#/equipo/<personas|grupos|locales|frio|calendario|avisos|ajustes>`. Una sola llamada `datos_app(p_completo)` trae todo, con RLS (security invoker).
- `supabase/cil.sql`: esquema completo y re-ejecutable. Ella lo corre entero en el SQL Editor; no borra datos.
- `supabase/functions/avisos/index.ts`: Edge Function de Web Push (VAPID + aes128gcm propios con WebCrypto). La llama pg_cron cada minuto con el header `x-aviso-secreto`.
- `sw.js`: caché de la app. **Al publicar cambios sube `VERSION` en sw.js y los `?v=` en los `index.html` y en la lista ARCHIVOS.**

## Reglas de negocio ya decididas (no cambiarlas sin preguntar)
- Reparto por carga relativa: minutos × 100 / capacidad (%), tolerancia de 15 min, tope por tarea, grupos, `rota` (fuera de la rotación) y días de trabajo por persona y por local.
- Entrada 8:30. A tiempo hasta 8:35, falta desde 8:50 (en ajustes, globales; se probó y se descartó el horario por local por ahora).
- Llegar tarde no reduce el trabajo: quien llega tarde recibe tareas pendientes de quien lo cubrió por 100–120 % de los minutos cubiertos. Si ninguna combinación cae en ese rango, la más cercana; si hay empate, la de más minutos (`_compensar`).
- Feriados: lo semanal o mensual que cae en día libre pasa al día laboral **anterior**.
- Semanal o mensual sin hacer: sigue con su dueño como atrasada (si vino, no se reasigna sola) y **vence** al salir la siguiente vez (queda en el historial como no hecha). Para que otro pueda hacerla el mismo día, se le pone hora (sale como urgente).
- "Me voy antes" reparte lo pendiente igual que una falta. "Día que no cuenta" para imprevistos generales.
- Récord de puntualidad oculto para empleados el primer mes (`mostrar_record`).
- Temperaturas de equipos de frío 3 veces al día (8:30, 1 pm, 4 pm), con estado normal, defrost o apagado. Nota obligatoria si está fuera de rango. **Sin fotos** (almacenamiento).
- "Prender contenedores" genera "Apagar contenedores" 45 min después.
- Rescate urgente a mitad de la ventana. "Salí a despachar"/"Volví" es opcional (`usar_salidas`), y sus reglas dependientes se apagan con él.
- "Llegué" solo desde el Wi-Fi del local (IP registrada). **No rastrear ubicaciones.** Desde afuera sale un error genérico, sin explicar por qué.
- Quien no tiene el acceso `tareas` (por ejemplo Verónica, de contenido, que trabaja en línea) no marca "Llegué" ni entra en la rotación.

## Seguridad
- La clave privada VAPID solo va en los Secrets de Supabase, nunca en el repositorio.
- **Nunca re-ejecutar el `supabase.sql` viejo de contenidoBF**: reabre Contenido a todos los usuarios. Las políticas de Contenido ahora exigen `tiene_acceso('contenido')`.
- Los usuarios se crean en Supabase → Authentication (registro abierto apagado). Se descartó entrar con nombre de usuario: se quiere conservar la recuperación de clave por correo.

## Estado y pendientes (oct 2026)
- Instalado y funcionando: repositorio, SQL, usuarios, avisos (cron `avisos` cada minuto, 200 OK desde el 20 oct).
- Claves: gerencia las cambia en Equipo → Personas (`cambiar_clave`) y las dice en persona. "Olvidé mi clave" por correo quedó para después (necesita SMTP propio; faltan 2 correos de empleados).
- Sesión compartida con Contenido: CIL escribe y lee `barquero_sesion` y `bfcontenido_sesion` (gana la de `expires_at` mayor) para no pedir la clave dos veces.
- Armador: `supabase/tasas-armador.sql` dispara el workflow de mensajesBF de 8:15 a 8:35 (el cron de GitHub llega tarde). Workflow publicado (fija el descuento del día; `forzar` solo desde gerencia; en equipos sin acceso de administradora el número queda bloqueado). Falta que ella cree el token y corra el SQL (pasos 2 y 3).
- Avisos unificados: la función `notificar` de Contenido ya no manda push; deja los mensajes en `avisos_cola` (url `../contenidoBF/#…`) y los entrega el reloj de avisos de CIL. Se activan una vez en el menú de CIL (`comun/hub.js`, `?avisos` evita la redirección). Contenido usa el tema de CIL (`../cil/comun/tema.*`). Pendiente: mover Contenido a `/cil/contenido/`.
- Fase 3: Armador de mensajes. Se le recomendó pasar productos y precios de `data.json` en GitHub a la base de datos (hoy se editan con un token de GitHub guardado en el teléfono). Ella aún no decide.
- Falta: la lista de quién usa Contenido y quién usa Mensajes, el ícono (hoy dice "CIL" provisional) y cargar su lista real de tareas.
- Gerencia evalúa: premio del mes, "cubre primero" y cuándo activar `usar_salidas`.

## Pruebas
- `.github/workflows/pruebas.yml` corre en cada push: sintaxis, `cil.sql` dos veces sobre `pruebas/stub-supabase.sql` y `pruebas/humo.js` (Playwright, modo demo, 360 px).
- Decisiones de gerencia: página de aprobación https://claude.ai/artifact/B3s85DdSYu8ucAxCsfFDiq (colección `decisiones`). Todo lo que necesite su OK va ahí.
- No hay build ni dependencias. Sirve la carpeta con `python3 -m http.server`. El modo demo sale solo con `config.js` vacío (en pruebas, intercepta `config.js` con Playwright).
- Para el SQL, Postgres local más PostgREST con un stub de `auth.uid()`. Verifica que `logic.js` y SQL den el mismo reparto.
- Permisos: `cil.sql` le quita a `authenticated` el EXECUTE de todas las funciones y devuelve solo las de la lista (Supabase lo da por defecto). Toda RPC nueva va en esa lista; las internas (`_algo`) nunca.
- Revisa la sintaxis JS con `node -e "new Function(require('fs').readFileSync('tareas/app.js','utf8'))"`.
