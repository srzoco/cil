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
- `pendientes/`: Pendientes de gerencia (solo rol `admin`). Recordatorios propios y pedidos entre gerencia, con conversación y fotos (carpeta privada `pendientes` de Storage, achicadas a 1280 px; se borran 60 días después de cerrar, desde el teléfono de gerencia al abrir la página). Solo lo ven las dos personas; quien lo creó lo cierra; si se repite, al cerrar sale el siguiente. Avisos al momento o resumen 8 a. m. (`personas.pend_avisos`) y el día que vence. Todo por RPC `pend_*`; las tablas no se leen directo.
- `contenido/`: Contenido (reels, carruseles, grabación), movido dentro de CIL el 27/10/2026. Lee `../config.js` como `BF_CONFIG` y usa el `sw.js` de CIL. `srzoco/contenidoBF` quedó solo como redirección (su index.html lleva a `/cil/contenido/` con el mismo `#`, para íconos y avisos viejos); el código se edita aquí. Prueba: `pruebas/contenido.js`.
- `mensajes/`: Armador de mensajes, movido dentro de CIL el 27/10/2026 (un solo `index.html`). Sin clave de GitHub: solo gerencia con su sesión de CIL edita catálogo y descuento (RPC `guardar_armador`, `fijar_descuento`, `forzar_tasas`); al abrir borra la clave vieja del teléfono. Lee `tasas.json` y `data.json` de `/mensajesBF/` (el workflow de tasas sigue allí). `srzoco/mensajesBF/index.html` quedó como redirección. Prueba: `pruebas/armador.js`.
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
- Una tarea de X minutos no se puede marcar antes de que pasen X minutos desde que la persona llegó (o desde su «desde», si es más tarde). Gerencia sí puede (`listaDesde` en logic.js y `_hecha` en SQL). Además, en total lo marcado en el día no puede pasar de 1,5 × el tiempo desde que llegó.
- "Me voy antes" reparte lo pendiente igual que una falta, y después de marcarlo ya no se puede marcar «Hecho» (solo gerencia). "Día que no cuenta" para imprevistos generales.
- Récord de puntualidad oculto para empleados el primer mes (`mostrar_record`).
- Temperaturas de equipos de frío 3 veces al día (8:30, 1 pm, 4 pm), con estado normal, defrost o apagado. Nota obligatoria si está fuera de rango. **Sin fotos** (almacenamiento).
- "Prender contenedores" genera "Apagar contenedores" 45 min después.
- Rescate urgente a mitad de la ventana. "Salí a despachar"/"Volví" es opcional (`usar_salidas`), y sus reglas dependientes se apagan con él.
- "Llegué" solo desde el Wi-Fi del local (IP registrada). **No negociable**: `solo_en_tienda` ya no se puede apagar (restricción en SQL), un local sin Wi-Fi registrado no deja marcar, y «Hecho» exige «Llegué». Única excepción: gerencia marca «hoy no hay Wi-Fi» en un local. **No rastrear ubicaciones.** Desde afuera sale un error genérico, sin explicar por qué.
- Consumibles (Equipo → Consumibles): inventario por local; el empleado pide con un botón sin ver cantidades; entrega gerencia o el encargado (`entrega_consumibles`), anotando quién dio y quién recibió. El café va en una tarea con `consumible_id`: pregunta tazas y descuenta según la receta en vasitos (solo gerencia la edita). Avisos: pedido al momento, inventario bajo 1 vez al día, consumo alto los lunes (+30 % sobre el promedio de 4 semanas).
- Cambios que aplican a lo ya creado de hoy: si gerencia cambia el local, los grupos o las personas de una tarea (o los grupos/«para cualquiera» de una persona), lo pendiente pasa a quien sí puede (`_resincronizar`, `resincronizar` en logic.js); las horas también, si no cambian las veces al día. Al guardar a una persona se reparte lo de hoy que salió sin dueño (`repartir_sin_dueno`).
- Revisiones de calidad: al azar (`asignar_revisiones`) y además a mano desde el día de una persona (`#/persona/<id>`, RPC `revisar_tarea`, `revisiones.manual`; no cuentan en el cupo del azar). Un local puede tener revisora fija (`locales.revisor`, Equipo → Locales): sus revisiones no se reparten entre gerencia (BQTO → Sara, 29/10/2026).
- Hoy (gerencia) ya no lista todas las tareas: «Equipo de hoy» es una tarjeta por persona (asistencia + avance) que abre su día (`#/persona/<id>`, ahí se cambia la asistencia).
- Contenido: los enlaces solo se muestran si empiezan por http(s) (`url()` en contenido/app.js).
- Sin zoom en todas las apps (viewport `user-scalable=no` + `comun/tema.js` frena el pellizco del iPhone y pone los campos a 16 px mínimo).
- Quien no tiene el acceso `tareas` (por ejemplo Verónica, de contenido, que trabaja en línea) no marca "Llegué" ni entra en la rotación.

## Seguridad
- **Sesión en el teléfono** (incidente 27/10/2026: la app abría con la cuenta de otra persona): todas las apps comparten `barquero_sesion` y `bfcontenido_sesion`. Si guardan personas distintas, no se usa ninguna (se borran y se pide entrar). Al renovar nunca se escribe encima de la sesión de otra persona (la pantalla vieja se recarga). Al entrar se borran las demás; al salir, todas. Probado en `pruebas/sesiones.js`. Cambios únicos en SQL van con `cil_migraciones`.
- La clave privada VAPID solo va en los Secrets de Supabase, nunca en el repositorio.
- **Nunca re-ejecutar el `supabase.sql` viejo de contenidoBF**: reabre Contenido a todos los usuarios. Las políticas de Contenido ahora exigen `tiene_acceso('contenido')`.
- Los usuarios se crean en Supabase → Authentication (registro abierto apagado). Se descartó entrar con nombre de usuario: se quiere conservar la recuperación de clave por correo.

## Estado y pendientes (oct 2026)
- Instalado y funcionando: repositorio, SQL, usuarios, avisos (cron `avisos` cada minuto, 200 OK desde el 20 oct).
- Claves: gerencia las cambia en Equipo → Personas (`cambiar_clave`) y las dice en persona. "Olvidé mi clave" por correo: descartado por ahora (decisión de Sara, 29/10/2026); no volver a proponerlo.
- Sesión compartida con Contenido: CIL escribe y lee `barquero_sesion` y `bfcontenido_sesion` (gana la de `expires_at` mayor) para no pedir la clave dos veces.
- Armador: `supabase/tasas-armador.sql` dispara el workflow de mensajesBF de 8:15 a 8:35 (el cron de GitHub llega tarde). Workflow publicado (fija el descuento del día; `forzar` solo desde gerencia; en equipos sin acceso de administradora el número queda bloqueado). Instalado el 28/10/2026 (clave `github_mensajes` en el Vault, reloj `tasas-armador`); «Actualizar tasas ahora» probado.
- Avisos unificados: la función `notificar` de Contenido ya no manda push; deja los mensajes en `avisos_cola` (url `../contenidoBF/#…`) y los entrega el reloj de avisos de CIL. Se activan una vez en el menú de CIL (`comun/hub.js`, `?avisos` evita la redirección). Contenido usa el tema de CIL (`../cil/comun/tema.*`). Contenido ya está en `/cil/contenido/` (los avisos viejos con `../contenidoBF/#…` pasan por la redirección).
- Armador: productos y precios en la base de datos (`armador_datos`); la clave de GitHub en el teléfono ya no se usa.
- Bot de Instagram y robot de Yobel (27/10/2026): tablas `bot_config`, `bot_mensajes`, `bot_avisos` y RPC `precios_bot`, `ficha_producto`, `robot_subir`, `robot_error` al final de `cil.sql`. El bot es la Edge Function `bot` (no está en este repo). El robot corre en la PC de la tienda (usuario de Windows «robot») 9:15, 12:30 y 5 pm con 0–14 min al azar; solo sube precio y stock (nunca costos). Avisos del bot por `avisos_cola` (🔴 urgentes, resumen 8:45). `verificar_robot` = `si` solo cuando el robot ya corra.
- Armador con stock (28/10/2026): muestra el stock de Yobel (Agotado / Stock N / Bajo pedido); al elegir un producto entran solo las presentaciones con stock. El editor tiene «bajo pedido», «ficha» y «usos». Copiar un mensaje suma al contador `armador_usos` (RPC `armador_usado`, anon, 1 vez cada 10 s por producto); `precios_bot` ofrece primero los más usados. El CSV manual ya no borra lo que falta ni le cambia el stock: lo marca «stock sin actualizar» (`sin_actualizar`, se quita cuando vuelve a venir en un CSV o del robot). El robot hace lo mismo (29/10: antes ponía stock 0) y avisa al momento (`robot_pausados`, urgente); el bot NO cotiza lo que tiene `sin_actualizar` (pasa a humano sin precio), salvo bajo pedido. Sábados del robot: `robot_sabados_desde`/`hasta` en bot_config (2026-11-07 a 2026-12-31). Productos nuevos en Yobel: solo avisar (decidido). Bajo pedido entra completo al mensaje aunque esté en 0; lo agotado se puede agregar tocándolo. `guardar_armador` choca solo con guardados de gerencia (`editado_en`) y toma de la base de datos el stock (siempre) y el precio (si el robot subió después de abrir). `robot_subir` avisa (`robot_ficha`) si desaparece un producto con ficha. Prueba: `pruebas/armador-stock.js`.
- Contenido solo lo usan Sara y Verónica. Mensajes: Sara y Adolfo (es «Percebe» en CIL, el empleado de BQTO, accesos tareas + mensajes). La Carlota: nadie marca llegada todavía; Sara registra el Wi-Fi cuando vaya. (Lista de tareas ya cargada; el ícono se queda como «CIL».)
- Premio del mes, "cubre primero" y `usar_salidas`: ya hechos; gerencia solo decide cuándo prenderlos. No hay trabajo pendiente ahí.

## Pruebas
- `.github/workflows/pruebas.yml` corre en cada push: sintaxis, `cil.sql` dos veces sobre `pruebas/stub-supabase.sql`, `pruebas/robot.sql` (frenos del robot de Yobel) y `pruebas/humo.js` (Playwright, modo demo, 360 px), `recorrido.js` y `pendientes.js` (responde las llamadas de la página con psql, como la persona de la sesión).
- Decisiones de gerencia: página de aprobación https://claude.ai/artifact/B3s85DdSYu8ucAxCsfFDiq (colección `decisiones`). Todo lo que necesite su OK va ahí.
- No hay build ni dependencias. Sirve la carpeta con `python3 -m http.server`. El modo demo sale solo con `config.js` vacío (en pruebas, intercepta `config.js` con Playwright).
- Para el SQL, Postgres local más PostgREST con un stub de `auth.uid()`. Verifica que `logic.js` y SQL den el mismo reparto.
- Permisos: `cil.sql` le quita a `authenticated` el EXECUTE de todas las funciones y devuelve solo las de la lista (Supabase lo da por defecto). Toda RPC nueva va en esa lista; las internas (`_algo`) nunca.
- Revisa la sintaxis JS con `node -e "new Function(require('fs').readFileSync('tareas/app.js','utf8'))"`.
