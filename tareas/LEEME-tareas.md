# Tareas Barquero — guía de instalación

App web para repartir las tareas de mantenimiento cada día según quién vino. Cada empleado ve solo sus tareas y marca **Llegué** y **Hecho**. Gerencia ve todo, aprueba la reasignación cuando alguien falta y recibe el reporte del día. Funciona en celular y computadora, no necesita cuenta de Claude y cuesta $0 (GitHub Pages + Supabase gratis). Es la misma base que Contenido Barquero.

**Tiempo total: ~55 minutos.** Hazlo en orden; cada paso termina con un ✅ para confirmar antes de seguir.

---

## Paso 1 · Subir la app a GitHub (10 min)

1. En github.com, toca **New repository**. Nombre: `tareasCIL`, **Public**, **Create repository**.
2. Toca **uploading an existing file**, arrastra **todos los archivos** de la carpeta (no la carpeta) y toca **Commit changes**.
3. **Settings → Pages** → Branch `main` y `/ (root)` → **Save**.
4. En 1–2 minutos tu dirección será `https://srzoco.github.io/tareasCIL/`.

✅ **Checkpoint:** abres el link y ves la franja amarilla de **Modo demo**. Con «Ver como» arriba pruebas la vista de gerencia y la de un empleado.

## Paso 2 · Crear la base de datos (10 min)

**Usa un proyecto NUEVO de Supabase, no el de Contenido.** En el de Contenido cualquier usuario puede editar todo; si metes ahí a los empleados, podrían tocar tus piezas. El plan gratis permite 2 proyectos.

1. supabase.com → **New project**. Nombre `tareas-barquero`, inventa una contraseña de base de datos (guárdala), región **East US**, plan **Free**.
2. **SQL Editor → New query**, pega **todo** `supabase.sql` y toca **Run**.

✅ **Checkpoint:** dice *Success*. En **Table Editor** ves 10 tablas: `ajustes`, `asignaciones`, `asistencia`, `dias_especiales`, `eventos`, `grupos`, `locales`, `personas`, `plantillas`, `revisiones`.

## Paso 3 · Crear los usuarios y cerrar la puerta (10 min)

1. **Authentication → Users → Add user → Create new user.** Correo + clave + **Auto Confirm User**. Hazlo para las 4 personas de gerencia y los 4 empleados.
   - Si un empleado no tiene correo, inventa uno: `jose@equipo.barquerofood.com`. No tiene que existir; solo es su usuario para entrar. Anota usuario y clave.
2. **Authentication → Sign In / Providers** → desactiva **Allow new users to sign up**.
3. **SQL Editor → New query**, pega esto con los 4 correos de gerencia y toca **Run**:

   ```sql
   update public.personas set rol = 'admin'
   where email in ('tu@correo.com', 'papa@correo.com', 'hermano@correo.com', 'mama@correo.com');
   ```

✅ **Checkpoint:** en **Table Editor → personas** ves 8 filas: 4 con rol `admin` y 4 con `empleado`.

## Paso 4 · Conectar la app (3 min)

1. Supabase → **Project Settings → API** (o *Data API* / *API Keys*). Copia la **Project URL** y la clave **publishable** (`sb_publishable_…`) o **anon public**. Nunca la *secret* ni la *service_role*.
2. En GitHub abre `config.js`, toca el lápiz ✏️, pega los dos datos entre las comillas y **Commit changes**.

✅ **Checkpoint:** en 1–2 minutos la app ya no tiene la franja amarilla y pide correo y clave. Entras, pones tu nombre y ves **Hoy** vacío.

## Paso 5 · Cargar las tareas y probar con un empleado (10 min)

1. En **Tareas → Nueva tarea que se repite**, carga las tareas diarias primero (título, minutos, quién puede). Luego las semanales y mensuales.
2. Revisa arriba **«de trabajo un día normal»**: si queda muy por debajo de la jornada, faltan tareas por cargar.
3. Entra en el celular de un empleado con su usuario. Que ponga su nombre, toque **Llegué** y marque una tarea **Hecho**.
4. Instálenla como app: **Android** menú ⋮ → *Agregar a pantalla principal*. **iPhone** Compartir → *Agregar a inicio*.

✅ **Checkpoint:** en tu **Hoy** ves a esa persona «A tiempo» y la tarea con ✓.
❗ Si al empleado no le carga, no sigas: avísame.

## Paso 6 · Locales y «Llegué» solo en el local (5 min por local, hazlo EN cada local)

1. En **Equipo → Locales**, el «Local principal» ya existe. Cámbiale el nombre si quieres y marca sus días de trabajo. Para el otro local toca **Agregar local**, ponle nombre y sus días, y **Guardar local**.
2. En **Equipo**, abre a cada empleado: elige su **Local** y su **Tiempo para tareas** (por ejemplo Johandre y Josbel 50% porque despachan, Yureidy 70% porque prepara pedidos, María 100%). Ahí mismo marca sus **Grupos** y, a los despachadores, un **Tope por tarea** (por ejemplo 20 min).
3. Estando **en cada local**, conectada a su Wi-Fi: en la tarjeta de ese local toca **Registrar esta red**. (La ubicación solo hace falta si activas la opción de GPS.)
4. En **Ajustes**, marca **«Llegué» solo en el local** y **Guardar ajustes**.

✅ **Checkpoint:** con un empleado: conectado al Wi-Fi de su local, «Llegué» funciona. Con datos móviles o desde la calle, le sale «No se pudo marcar tu llegada» (sin explicar por qué). Conectado al Wi-Fi del otro local, funciona y sale como «Vino a …».
❗ Si dentro del local y con Wi-Fi no lo deja, avísame: hay que revisar cómo llega la red.

**Si un día deja de reconocer el Wi-Fi** (el proveedor cambió la dirección de internet), nadie podrá marcar en ese local hasta que alguien de gerencia, desde ahí, toque **Registrar esta red**. Mientras tanto, márcales la llegada desde **Hoy → Asistencia**.

**Opcional:** en Ajustes puedes activar «probar con la ubicación del teléfono». Así funciona también con datos móviles, pero el teléfono les pedirá permiso de ubicación (eso no se puede ocultar). La ubicación nunca se guarda; solo se compara con la del local.

## Paso 7 · Calendario (5 min)

En **Equipo → Calendario** ya están los feriados nacionales de 2026, 2027 y 2028 (desde octubre de 2028 la app te avisa que faltan los del año siguiente). Agrega:
- **Vacaciones colectivas** (cuando tengas las fechas): botón **Cargar vacaciones colectivas**, elige desde–hasta y agrega.
- **Sábados de diciembre** (si el segundo local trabaja): «Día de trabajo extra», 1 al 31 de diciembre, marca «Solo los sábados» y elige el local.
- Si deciden trabajar un feriado, quítalo con la ×.

✅ **Checkpoint:** en la lista del calendario ves los días agregados.

## Paso 8 · Avisos en el teléfono (opcional, 20 min)

1. En la app: **Equipo → Avisos en el teléfono → Generar claves**. Copia las dos (pública y privada) a un lugar seguro.
2. En GitHub, en `config.js`, pega la **pública** en `vapidPublicKey` y **Commit changes**.
3. Supabase → **Edge Functions → Deploy a new function → Via editor**. Nombre: `avisos`. Borra el ejemplo, pega todo `supabase/functions/avisos/index.ts` y **Deploy**.
4. En esa función → **Details/Settings**: apaga **Verify JWT** (o «Enforce JWT verification») y guarda.
5. Supabase → **Edge Functions → Secrets** (o Project Settings → Edge Functions): agrega
   `VAPID_PUBLIC` (la pública), `VAPID_PRIVATE` (la privada), `VAPID_SUBJECT` (`mailto:tu@correo.com`) y `AVISOS_SECRETO` (inventa una palabra larga, sin espacios).
6. Supabase → **Database → Extensions**: activa **pg_cron** y **pg_net**.
7. **SQL Editor → New query**, cambia `TU-PROYECTO` (el código de tu Project URL) y `TU-SECRETO`, y **Run**:

   ```sql
   select cron.schedule('avisos-tareas', '* * * * *', $$
     select net.http_post(
       url := 'https://TU-PROYECTO.supabase.co/functions/v1/avisos',
       headers := '{"Content-Type": "application/json", "x-aviso-secreto": "TU-SECRETO"}'::jsonb,
       body := '{}'::jsonb)
   $$);
   ```
8. En tu teléfono (con la app instalada): **Equipo → Avisos → Activar**, y luego **Enviarme uno de prueba**.

✅ **Checkpoint:** en menos de un minuto te llega «Aviso de prueba».
❗ Si no llega: Supabase → Edge Functions → avisos → **Logs**. Si dice «base de datos: 401», agrega el secreto `CLAVE_SECRETA` con la clave **secret** (`sb_secret_…`) de Project Settings → API Keys.

Cada empleado activa los avisos en su propio teléfono (le sale el botón **Activar** en su pantalla). En iPhone hace falta iOS 16.4 o más y abrir la app desde el ícono de inicio. Algunos teléfonos bloquean avisos para ahorrar batería: son una ayuda, no una garantía.

---

## Cómo funciona

**Cada mañana** la app reparte sola las tareas del día la primera vez que alguien la abre. Reparte entre los empleados activos, equilibrando minutos y rotando: a cada uno le toca primero lo que hace más tiempo no hace. Las tareas que «solo pueden» ciertas personas se reparten solo entre ellas.

**Empleados**
1. Al llegar: **Llegué**.
2. Marcan **Hecho** en cada tarea al terminarla (la hora queda guardada sola). Si se equivocan, pueden desmarcar el mismo día.
3. Ven solo lo suyo. Lo semanal o mensual que no hagan les sigue apareciendo como **Atrasada** hasta hacerlo; lo diario no se arrastra (al día siguiente hay uno nuevo).
4. Si se van antes de terminar, tocan **Me voy antes de terminar** (motivo opcional). Lo que les quedó pendiente aparece en **Hoy** de gerencia para repartirlo, igual que cuando alguien falta. Si se les olvida, gerencia lo marca en **Asistencia → Se fue**.
5. En las tareas de varias veces al día, la segunda vez no se puede marcar antes de la hora límite de la primera (no se marcan las dos juntas en la mañana).

**Gerencia**
1. **A tiempo hasta** (por defecto 8:35, entrada 8:30): después cuenta como **Tarde**. **Hora límite** (por defecto 8:50): quien no marcó «Llegué» aparece como **No marcó**. La app muestra arriba cuántas tareas quedaron sin dueño y, en **Revisar**, a quién sugiere pasarlas (el que tenga menos carga y pueda hacerlas). Cambias lo que quieras y **Apruebas**.
2. Si alguien avisa temprano que no viene, toca su nombre en **Asistencia → No viene hoy** y reparte de una vez.
3. **Si llega tarde** y marca «Llegué», lo que se le pasó a otro **ese mismo día** y todavía no se ha hecho vuelve a él automáticamente. Lo que el otro **ya hizo** por él se compensa: recibe tareas pendientes de hoy de esa persona por los mismos minutos o hasta 20% más (nunca menos). Si ninguna combinación de tareas cae en ese rango, recibe la más cercana. Así llegar tarde no le baja el trabajo. Lo de días anteriores sigue siendo de quien lo cubrió.
4. **Puntualidad:** en **Historial** ves la puntualidad del mes de todos. Si activas en **Ajustes** «Cada empleado ve su récord», cada uno ve solo el suyo («Este mes: X de Y días a tiempo»); apagado, no les llega ni el dato.
5. **Imprevisto que afecta a todos** (paro de transporte, tranca grande): en **Hoy → Asistencia** o en **Historial**, «Marcar un día que no cuenta». Ese día no suma ni resta en la puntualidad de nadie. Siempre para todos por igual.
4. **Una vez** (botón + abajo): tareas puntuales. Eliges el día y si se la das a alguien, si la app elige, o si va al pool.
5. **Reporte**: por empleado, qué hizo, qué dejó y cuánto tenía asignado frente a su jornada. **Enviar por WhatsApp** arma el mensaje listo. Después de las 5 p. m. aparece el atajo en **Hoy**.
6. **Historial** (desde Reporte): tardanzas, faltas y % de cumplimiento de 7 o 30 días.

**Grupos:** en **Equipo → Grupos** creas grupos como «Despacho» o «Limpieza» y asignas a cada persona (puede estar en varios). En cada tarea eliges si la puede hacer cualquiera del local, uno o más grupos, o personas específicas. Si entra alguien nuevo a un grupo, le empiezan a tocar esas tareas sin editar nada más.

**Reparto justo según el tiempo de cada uno:** el reparto es proporcional al «tiempo para tareas» de cada persona. Alguien al 50% recibe más o menos la mitad de minutos que alguien al 100%.

**Días de cada persona:** en **Equipo**, al abrir a alguien, marca los días que trabaja si no son los mismos de su local. Esos días no recibe tareas ni cuenta como falta.

**Revisiones de calidad:** cada día la app elige al azar 4 tareas hechas: 2 de lo hecho antes de las 12 (se eligen al mediodía) y 2 de lo hecho desde las 12 (se eligen a las 4 p. m.) y las reparte entre gerencia. Aparecen en **Hoy → Revisiones de calidad** con el nombre de a quién le toca. Se califican Bien, Regular o Mal; con «Mal» puedes mandarla a repetir: vuelve a la lista de quien la hizo y sigue ahí (también los días siguientes) hasta que la rehaga. Solo se revisan tareas hechas por empleados. Los empleados no saben cuáles se revisan. La calificación es final: solo quien calificó puede corregirla.

**Decisiones de gerencia:** cuando alguien de gerencia aprueba o rechaza una justificación, es final. Solo esa misma persona puede corregirla si fue un error.

**Tope por tarea:** a quien pasa ratos cortos en el local (despachadores) no le tocan tareas más largas que su tope, salvo que nadie más pueda hacerlas. Si una tarea larga es solo de despachadores, conviene partirla en dos más cortas.

**Atrasadas y justificaciones:** lo atrasado sin justificar se recupera además de lo del día, sin bajarle trabajo nuevo. Si no se pudo hacer por un motivo válido, el empleado lo explica en la app («¿Por qué no se hizo?») y gerencia lo aprueba o rechaza en **Hoy**. Solo si se aprueba cuenta como carga y le llegan menos tareas nuevas hasta recuperarla.

**Locales:** cada local tiene sus días de trabajo, su Wi-Fi, su ubicación, sus tareas y sus empleados. La rotación y las reasignaciones nunca mezclan locales. Si alguien de un local va a trabajar al otro (por ejemplo Wendy al principal), puede marcar «Llegué» allá y en **Hoy** sale como «Vino a Local principal», pero sus tareas siguen siendo las de su local. Si alguien falta y nadie más de su local puede hacer sus tareas, quedan pendientes con su nombre (Hoy lo avisa) o las reasignas tú a mano.

**Feriados y vacaciones:** lo diario no sale en días libres. Lo semanal y mensual que cae en un día libre **se adelanta al día de trabajo anterior** (una sola vez, aunque las vacaciones duren varias semanas). Por eso los feriados y vacaciones hay que cargarlos **con anticipación**: si cargas un feriado el mismo día, lo de ese día ya no se puede adelantar.

**Personal administrativo:** en **Equipo**, al abrir a la persona, desmarca **Entra en las tareas «para cualquiera»**. Solo recibe las tareas de sus grupos (por ejemplo, crea el grupo «Administración») o las que le asignes. Igual marca «Llegué», sale en el reporte y en el historial.

**Velocidad:** la app abre al instante con lo último que se vio en ese teléfono y se actualiza por detrás (la flechita de arriba gira mientras tanto). «Hecho» se marca al momento y se guarda por detrás; si no se pudo guardar, se desmarca sola y avisa.

**Veces al día:** una tarea puede salir 1, 2 o 3 veces el mismo día (por ejemplo «Fregar · después del desayuno» y «· después del almuerzo»), siempre para la misma persona. Cada vez puede tener una hora límite: si no la marcan antes, se ve en rojo y queda en el reporte como «fuera de hora».

**Temperaturas:** en **Equipo → Equipos de frío** creas cada nevera, cava o contenedor con su rango. Una tarea con «Pide anotar temperaturas» abre, al marcarla, un formulario con cada equipo: temperatura y estado (normal, defrost, apagado). Fuera de rango exige una nota y te sale en rojo en **Hoy**. El historial de 35 días está en **Reporte → Temperaturas**, con descarga para Excel. No se guardan fotos.

**Desde / antes de:** cada vez del día puede tener «desde» (no se puede marcar antes) y «antes de» (después sale en rojo). Ej.: temperaturas 8:30–9:00, 1:00–1:30 y 4:00–4:30.

**Tarea que sale después:** en una tarea puedes marcar «Al hacerla, sale otra tarea después» (ej. «Apagar contenedores» 45 min después de «Prender contenedores»). Sale para la misma persona a esa hora, con 15 min para marcarla. La app no suena alarmas: si es crítico, que pongan un temporizador.

**Tareas urgentes (rescate):** una tarea con «desde» y «antes de» que no se hizo a mitad de su ventana (ej. 8:45 para 8:30–9:00) le sale a todos los presentes de su local como **Urgente** con el botón **La hago yo**.

**«Salí a despachar» / «Volví» (opcional, en Ajustes, apagado de fábrica):** si alguien lo marcó antes de que empiece la ventana, su tarea es urgente desde el inicio y pasa a otro sin penalizarlo. Si no lo marcó y otra persona tuvo que hacerla, queda como **«se le pasó»** en el reporte y el historial, y le compensa los minutos a quien la hizo (100–120%, como con las llegadas tarde). Con el botón apagado, las urgentes igual las puede hacer cualquiera, pero sin penalización ni compensación (no se puede saber si estaba fuera).

**Pool (opcional):** se activa en **Equipo → Ajustes**. Las tareas que dejes en el pool las ve cualquier empleado y la toma el primero. Si lo apagas, lo que quede sin dueño solo lo ve gerencia como «Sin asignar».

**Lo que no hace todavía:** el reporte no llega solo al final del día; hay que abrirlo y tocar *Enviar por WhatsApp*. Automatizarlo es posible, pero necesita un paso extra en Supabase.

---

## Mantenimiento

- **Empleado nuevo:** Supabase → Authentication → Add user (Paso 3.1). Aparece en **Equipo** como empleado y entra solo en la rotación.
- **Alguien se va:** en **Equipo**, desactívalo. Deja de recibir tareas, su historial se guarda y lo que tenía pendiente queda «sin asignar» en **Hoy** para que lo repartas.
- **Pausar una tarea** sin borrar su historial: ábrela y desmarca **Activa**. Desaparece de hoy en adelante; lo atrasado de esa tarea se sigue debiendo.
- **Pausa del plan gratis:** si nadie abre la app en **7 días**, Supabase pausa el proyecto. Con uso diario no pasa, **pero sí en las vacaciones colectivas de enero**: que alguien de gerencia abra la app al menos una vez por semana durante las vacaciones. Si igual se pausa, se reactiva en supabase.com con **Restore** (lo de la app Contenido tiene el mismo riesgo).
- **Actualizar la app:** reemplaza en GitHub todos los archivos **menos `config.js`**. Si cambia `supabase.sql`, vuelve a ejecutarlo completo (no borra datos). Los teléfonos toman la versión nueva al abrir la app (puede tardar hasta 10 minutos).
- **Si alguien cambia el código:** sube el número `v=` en `index.html` (y `demo.js?v=` en `app.js`) y `VERSION` en `sw.js`; si no, los teléfonos siguen con la versión guardada.
- **Clave olvidada:** Supabase → Authentication → Users → el usuario → *Send password recovery* o crea una nueva.
- **Respaldo:** Table Editor → cada tabla → *Export to CSV*.

## Archivos

| Archivo | Para qué |
|---|---|
| `index.html`, `app.js`, `styles.css` | La app |
| `logic.js` | Reglas: reparto, rotación, sugerencia de reasignación y reporte |
| `store.js` | Conexión con la base de datos (o modo demo) |
| `demo.js` | Datos de ejemplo del modo demo |
| `config.js` | **Lo único que se edita**: los dos datos de Supabase |
| `supabase.sql` | Crea la base de datos, las reglas de reparto y la seguridad |
| `manifest.webmanifest`, `icon-*.png` | Para instalarla como app en el celular |
