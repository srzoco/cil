-- =====================================================================
--  Barquero — base de datos unificada (Supabase). Se instala en el MISMO proyecto de Contenido.
--  Contiene: personas y accesos por módulo (para todos), Tareas, y los permisos de Contenido.
--  No borra ni cambia los datos de Contenido. Las tablas de Tareas que chocaban de nombre
--  con las de Contenido se llaman tareas_ajustes y tareas_eventos.
--
--  Tareas Barquero — base de datos (Supabase)
--  Pegar completo en: Supabase → SQL Editor → New query → Run
--  Se puede volver a ejecutar sin perder datos.
--
--  Reglas de seguridad:
--   · Gerencia (rol 'admin') ve y cambia todo.
--   · Cada empleado solo ve SUS tareas (y el pool, si está activo).
--   · Los empleados no escriben directo en las tablas: solo pueden
--     marcar "Llegué", marcar "Hecho" y tomar del pool (funciones abajo).
--   · El historial (tareas_eventos) no se edita ni se borra.
-- =====================================================================

-- ---------- Fecha de hoy en Venezuela ----------
create or replace function public.hoy() returns date
language sql stable as $$ select (now() at time zone 'America/Caracas')::date $$;

-- ---------- Locales ----------
-- Cada local tiene sus días de trabajo, su Wi-Fi y su ubicación. Las tareas y las personas son de un local.
create table if not exists public.locales (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null check (length(trim(nombre)) > 0),
  principal       boolean not null default false,
  dias_laborables int[] not null default '{1,2,3,4,5,6}',
  redes           text[] not null default '{}',   -- IP públicas del Wi-Fi del local
  lat             double precision,
  lng             double precision,
  radio_m         int not null default 150 check (radio_m between 30 and 1000),
  creado_en       timestamptz not null default now()
);
create unique index if not exists locales_un_principal on public.locales (principal) where principal;
insert into public.locales (nombre, principal)
select 'Local principal', true where not exists (select 1 from public.locales);

create or replace function public._local_principal() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.locales order by principal desc, creado_en limit 1
$$;

-- ---------- Grupos (por ejemplo «Despacho», «Limpieza») ----------
-- Una persona puede estar en varios grupos; una tarea puede limitarse a uno o más grupos.
create table if not exists public.grupos (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null check (length(trim(nombre)) > 0),
  creado_en timestamptz not null default now()
);

-- ---------- Personas (gerencia y empleados) ----------
create table if not exists public.personas (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  nombre     text not null default '',
  rol        text not null default 'empleado' check (rol in ('admin', 'empleado')),
  activo     boolean not null default true,
  telefono   text,
  creado_en  timestamptz not null default now()
);
alter table public.personas add column if not exists local_id uuid references public.locales (id) on delete set null;
update public.personas set local_id = public._local_principal() where local_id is null;
-- Qué parte de su jornada tiene para tareas (los despachadores, por ejemplo, menos). El reparto es proporcional.
alter table public.personas add column if not exists capacidad int not null default 100 check (capacidad between 10 and 100);
alter table public.personas add column if not exists grupos uuid[] not null default '{}';
-- Tope por tarea: quien pasa poco tiempo seguido en el local (despachadores) solo recibe tareas cortas.
alter table public.personas add column if not exists tarea_max int check (tarea_max between 5 and 600);
-- A qué módulos entra: 'tareas', 'contenido', 'mensajes'. Gerencia (rol admin) entra a todo.
alter table public.personas add column if not exists accesos text[] not null default '{}';
-- Días que trabaja esta persona (0 = domingo … 6 = sábado). Vacío = los días de su local.
alter table public.personas add column if not exists dias_trabajo int[];
-- false = personal administrativo: no recibe las tareas «para cualquiera», solo las de sus grupos o las asignadas a esa persona.
alter table public.personas add column if not exists rota boolean not null default true;

-- Cada usuario creado en Authentication aparece solo aquí como empleado.
create or replace function public._nueva_persona() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.personas (id, email, local_id) values (new.id, new.email, public._local_principal()) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists personas_desde_auth on auth.users;
create trigger personas_desde_auth after insert on auth.users
  for each row execute function public._nueva_persona();

insert into public.personas (id, email, local_id)
select id, email, public._local_principal() from auth.users on conflict (id) do nothing;

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.personas where id = auth.uid() and rol = 'admin' and activo)
$$;

-- ¿Puede entrar a este módulo? Gerencia entra a todo.
create or replace function public.tiene_acceso(p_modulo text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.personas where id = auth.uid() and activo and (rol = 'admin' or p_modulo = any (accesos)))
$$;

-- ---------- Ajustes ----------
create table if not exists public.tareas_ajustes (
  id               int primary key default 1 check (id = 1),
  hora_limite      time not null default '08:50',
  pool_activo      boolean not null default false,
  minutos_jornada  int not null default 480 check (minutos_jornada between 60 and 900),
  actualizado_en   timestamptz not null default now()
);
insert into public.tareas_ajustes (id) values (1) on conflict (id) do nothing;

-- «Llegué» solo en el local: por Wi-Fi (IP pública del local) y, si no, por GPS. Los datos de cada local están en locales.
alter table public.tareas_ajustes add column if not exists solo_en_tienda boolean not null default false;
-- Si no está en el Wi-Fi del local, ¿probar con la ubicación del teléfono? (el teléfono pide permiso)
alter table public.tareas_ajustes add column if not exists usar_gps boolean not null default false;
-- Puntualidad: «a tiempo» hasta esta hora (entrada 8:30 + 5 min). Después es «tarde»; la hora límite (8:50) es para dar la falta.
alter table public.tareas_ajustes add column if not exists a_tiempo_hasta time not null default '08:35';
-- % de la jornada para tareas fijas por día de la semana (0 = domingo). Lo usa el balance de carga para avisar
-- cuando un día se sobrecarga: lunes a miércoles más, jueves y viernes menos porque salen más pedidos.
alter table public.tareas_ajustes add column if not exists carga_dias jsonb not null default '{"0":0,"1":100,"2":100,"3":100,"4":60,"5":60,"6":80}';
-- ¿Cada empleado ve su récord de puntualidad del mes? (apagado = solo lo ve gerencia)
alter table public.tareas_ajustes add column if not exists mostrar_record boolean not null default false;
-- Botón «Salí a despachar» / «Volví» (y las reglas que dependen de él: tarea incumplida y compensación al que la rescata)
alter table public.tareas_ajustes add column if not exists usar_salidas boolean not null default false;
-- Revisiones de calidad al azar por día, repartidas entre gerencia
alter table public.tareas_ajustes add column if not exists revisiones_dia int not null default 4 check (revisiones_dia between 0 and 20);

-- ---------- Tareas (recurrentes y de una sola vez) ----------
create table if not exists public.plantillas (
  id            uuid primary key default gen_random_uuid(),
  titulo        text not null check (length(trim(titulo)) > 0),
  detalle       text,
  minutos       int not null default 15 check (minutos between 1 and 600),
  frecuencia    text not null check (frecuencia in ('diaria', 'semanal', 'mensual', 'unica')),
  dias_semana   int[] not null default '{}',          -- 0 = domingo … 6 = sábado (semanal)
  cada_n        int not null default 1 check (cada_n between 1 and 8),   -- cada N semanas (semanal) o N meses (mensual)
  dia_mes       int check (dia_mes between 1 and 31), -- mensual
  fecha_inicio  date not null default public.hoy(),
  fecha_unica   date,                                 -- unica
  solo_pueden   uuid[] not null default '{}',         -- vacío = cualquiera
  asignar_a     uuid references public.personas (id) on delete set null,  -- unica: a quién
  al_pool       boolean not null default false,       -- unica: dejarla en el pool
  activa        boolean not null default true,
  creado_por    uuid default auth.uid(),
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint plantillas_semanal check (frecuencia <> 'semanal' or cardinality(dias_semana) > 0),
  constraint plantillas_mensual check (frecuencia <> 'mensual' or dia_mes is not null),
  constraint plantillas_unica   check (frecuencia <> 'unica' or fecha_unica is not null)
);
alter table public.plantillas add column if not exists local_id uuid references public.locales (id) on delete cascade;
-- Veces al día: [] = una vez sin hora; [{"nombre": "después del desayuno", "antes": "12:00"}, …] = una casilla por vez.
-- Todas las veces del mismo día las hace la misma persona.
alter table public.plantillas add column if not exists momentos jsonb not null default '[]'::jsonb;
-- Quién puede hacerla: solo_pueden (personas) o grupos; si los dos están vacíos, cualquiera del local.
alter table public.plantillas add column if not exists grupos uuid[] not null default '{}';
-- Registro de temperaturas: al marcarla «Hecho» pide la lectura de cada equipo (equipos vacío = todos los del local).
alter table public.plantillas add column if not exists registro boolean not null default false;
alter table public.plantillas add column if not exists equipos uuid[] not null default '{}';
-- Cuántas personas la hacen juntas (1 = normal). Cada una recibe los minutos completos; con que una la marque, queda hecha.
alter table public.plantillas drop constraint if exists plantillas_cada_n_check;
alter table public.plantillas add constraint plantillas_cada_n_check check (cada_n between 1 and 12);
alter table public.plantillas add column if not exists personas int not null default 1 check (personas between 1 and 5);
-- Tarea que sale sola después de hacer esta (p. ej. «Apagar contenedores» 45 min después de «Prender contenedores»).
alter table public.plantillas add column if not exists seguimiento_titulo text;
alter table public.plantillas add column if not exists seguimiento_despues int not null default 45 check (seguimiento_despues between 1 and 600);
alter table public.plantillas add column if not exists seguimiento_minutos int not null default 5 check (seguimiento_minutos between 1 and 600);
update public.plantillas set local_id = public._local_principal() where local_id is null;

-- ---------- Asignaciones (la tarea de un día, para una persona) ----------
create table if not exists public.asignaciones (
  id                uuid primary key default gen_random_uuid(),
  plantilla_id      uuid references public.plantillas (id) on delete set null,
  fecha             date not null,
  titulo            text not null,
  detalle           text,
  minutos           int not null,
  arrastra          boolean not null default true,  -- si no se hace, sigue pendiente los días siguientes
  asignado_a        uuid references public.personas (id) on delete set null,  -- null = pool / sin asignar
  asignado_original uuid references public.personas (id) on delete set null,
  motivo            text not null default 'rotacion'
                    check (motivo in ('rotacion', 'fija', 'ausencia', 'manual', 'pool', 'tomada', 'devuelta')),
  estado            text not null default 'pendiente' check (estado in ('pendiente', 'hecha')),
  hecha_en          timestamptz,
  hecha_por         uuid references public.personas (id) on delete set null,
  creado_en         timestamptz not null default now()
);
alter table public.asignaciones add column if not exists local_id uuid references public.locales (id) on delete cascade;
alter table public.asignaciones add column if not exists momento int not null default 0;
alter table public.asignaciones add column if not exists momento_nombre text;
alter table public.asignaciones add column if not exists antes time;     -- hacerla antes de esta hora
alter table public.asignaciones add column if not exists desde time;     -- no se puede marcar antes de esta hora
alter table public.asignaciones add column if not exists registro boolean not null default false;  -- pide temperaturas
alter table public.asignaciones add column if not exists equipos uuid[] not null default '{}';     -- cuáles (vacío = todos los del local)
alter table public.asignaciones drop constraint if exists asignaciones_plantilla_id_fecha_key;
-- Tareas de varias personas: un «puesto» por persona (0, 1, …). Cada puesto es una fila con su dueño.
alter table public.asignaciones add column if not exists puesto int not null default 0;
-- Reparto automático: tarea que nadie de los presentes podía hacer. Se asigna igual, pero el empleado
-- no la ve hasta que gerencia la apruebe.
alter table public.asignaciones add column if not exists oculta boolean not null default false;
drop index if exists public.asignaciones_plantilla_fecha_momento;
create unique index if not exists asignaciones_plantilla_fecha_momento_puesto on public.asignaciones (plantilla_id, fecha, momento, puesto);
update public.asignaciones set local_id = public._local_principal() where local_id is null;
-- Justificación de por qué no se hizo. Lo atrasado solo cuenta como carga si gerencia la aprueba.
alter table public.asignaciones add column if not exists justificacion text;
alter table public.asignaciones add column if not exists just_estado text check (just_estado in ('pendiente', 'aprobada', 'rechazada'));
alter table public.asignaciones add column if not exists just_por uuid references public.personas (id) on delete set null;
create index if not exists asignaciones_fecha_idx on public.asignaciones (fecha);
create index if not exists asignaciones_persona_idx on public.asignaciones (asignado_a, estado);

-- ---------- Asistencia ----------
create table if not exists public.asistencia (
  persona_id  uuid not null references public.personas (id) on delete cascade,
  fecha       date not null,
  estado      text not null check (estado in ('presente', 'ausente')),
  llegada     timestamptz,
  marcado_por uuid default auth.uid(),
  primary key (persona_id, fecha)
);
alter table public.asistencia add column if not exists verificado text;  -- 'wifi' | 'gps' | 'gerencia' | null
alter table public.asistencia add column if not exists local_id uuid references public.locales (id) on delete set null;  -- dónde marcó
-- «Me voy antes»: hora en que se fue y motivo (opcional). Lo pendiente se reparte igual que si faltara.
alter table public.asistencia add column if not exists salida timestamptz;
alter table public.asistencia add column if not exists salida_motivo text;

-- «Salí a despachar» / «Volví»: ratos fuera del local durante la jornada
create table if not exists public.salidas_rato (
  id         uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas (id) on delete cascade,
  fecha      date not null,
  salio      timestamptz not null default now(),
  volvio     timestamptz
);
create index if not exists salidas_rato_idx on public.salidas_rato (persona_id, fecha);

-- ---------- Revisiones de calidad (solo gerencia las ve) ----------
create table if not exists public.revisiones (
  id            uuid primary key default gen_random_uuid(),
  asignacion_id uuid not null references public.asignaciones (id) on delete cascade unique,
  fecha         date not null,
  revisor       uuid references public.personas (id) on delete set null,   -- a quién de gerencia le tocó
  calificacion  int check (calificacion between 1 and 3),                  -- 3 bien, 2 regular, 1 mal
  nota          text,
  revisado_por  uuid references public.personas (id) on delete set null,
  revisado_en   timestamptz,
  creado_en     timestamptz not null default now()
);
alter table public.revisiones add column if not exists franja text check (franja in ('manana', 'tarde'));  -- hecha antes o después de las 12
create index if not exists revisiones_fecha_idx on public.revisiones (fecha);
-- Quién la hizo (se guarda al elegirla, para que el historial de calidad no se pierda si la mandan a repetir)
alter table public.revisiones add column if not exists hecho_por uuid references public.personas (id) on delete set null;
alter table public.asignaciones add column if not exists repetir boolean not null default false;  -- gerencia la mandó a repetir
-- Lo que otro hizo por alguien que llegó tarde y ya se le compensó (para no compensar dos veces)
alter table public.asignaciones add column if not exists compensada boolean not null default false;
-- Rescate: una tarea con horario que no se hizo a mitad de su ventana la puede hacer cualquiera del local.
alter table public.asignaciones add column if not exists rescatada_de uuid references public.personas (id) on delete set null;
alter table public.asignaciones add column if not exists incumplida boolean not null default false;  -- se le pasó a rescatada_de sin excusa
alter table public.asignaciones drop constraint if exists asignaciones_motivo_check;
alter table public.asignaciones add constraint asignaciones_motivo_check
  check (motivo in ('rotacion', 'fija', 'ausencia', 'manual', 'pool', 'tomada', 'devuelta', 'compensa', 'rescate'));
update public.revisiones r set hecho_por = coalesce(a.hecha_por, a.asignado_a) from public.asignaciones a where a.id = r.asignacion_id and r.hecho_por is null;

-- ---------- Equipos de frío y sus lecturas ----------
create table if not exists public.equipos (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null check (length(trim(nombre)) > 0),
  local_id  uuid references public.locales (id) on delete cascade,
  temp_min  numeric(5,1),   -- rango aceptable (°C); vacío = sin límite
  temp_max  numeric(5,1),
  activo    boolean not null default true,
  orden     int not null default 0,
  creado_en timestamptz not null default now()
);
create table if not exists public.lecturas (
  id            uuid primary key default gen_random_uuid(),
  asignacion_id uuid not null references public.asignaciones (id) on delete cascade,
  equipo_id     uuid not null references public.equipos (id) on delete cascade,
  fecha         date not null,
  temperatura   numeric(5,1),
  estado        text not null check (estado in ('normal', 'defrost', 'apagado')),
  fuera_rango   boolean not null default false,
  nota          text,
  registrado_por uuid references public.personas (id) on delete set null,
  registrado_en timestamptz not null default now()
);
create index if not exists lecturas_fecha_idx on public.lecturas (fecha);
create index if not exists lecturas_equipo_idx on public.lecturas (equipo_id, fecha);

-- ---------- Historial (no se edita ni se borra) ----------
create table if not exists public.tareas_eventos (
  id             uuid primary key default gen_random_uuid(),
  asignacion_id  uuid references public.asignaciones (id) on delete cascade,
  tipo           text not null,
  de             uuid,
  a              uuid,
  autor          uuid default auth.uid(),
  texto          text,
  creado_en      timestamptz not null default now()
);
create index if not exists eventos_asig_idx on public.tareas_eventos (asignacion_id);
alter table public.tareas_eventos drop constraint if exists eventos_tipo_check;
alter table public.tareas_eventos add constraint eventos_tipo_check check (tipo in ('generada', 'hecha', 'deshecha', 'reasignada', 'devuelta', 'tomada', 'justificada', 'just_aprobada', 'just_rechazada', 'revisada', 'repetir'));

-- Al borrar un local, su gente pasa al principal (nunca queda sin local). El principal no se puede borrar.
create or replace function public._borrar_local() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.principal then raise exception 'El local principal no se puede borrar.'; end if;
  update personas set local_id = (select id from locales where principal limit 1) where local_id = old.id;
  return old;
end $$;
drop trigger if exists locales_borrar on public.locales;
create trigger locales_borrar before delete on public.locales for each row execute function public._borrar_local();

create or replace function public._borrar_grupo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update personas set grupos = array_remove(grupos, old.id) where old.id = any (grupos);
  update plantillas set grupos = array_remove(grupos, old.id) where old.id = any (grupos);
  return old;
end $$;
drop trigger if exists grupos_borrar on public.grupos;
create trigger grupos_borrar before delete on public.grupos for each row execute function public._borrar_grupo();

create or replace function public._con_local() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.local_id is null then new.local_id := public._local_principal(); end if;
  return new;
end $$;
drop trigger if exists plantillas_local on public.plantillas;
create trigger plantillas_local before insert on public.plantillas for each row execute function public._con_local();

-- =====================================================================
--  Reglas de calendario
-- =====================================================================
-- Días especiales: feriados, vacaciones colectivas (libre) y días de trabajo extra (laborable).
-- local_id null = todos los locales; un día de un local concreto manda sobre uno general.
create table if not exists public.dias_especiales (
  id        uuid primary key default gen_random_uuid(),
  fecha     date not null,
  local_id  uuid references public.locales (id) on delete cascade,
  tipo      text not null check (tipo in ('libre', 'laborable')),
  nombre    text not null default '',
  creado_en timestamptz not null default now()
);
create unique index if not exists dias_especiales_uno on public.dias_especiales (fecha, coalesce(local_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Feriados nacionales de Venezuela (LOTTT art. 184 y Ley de Fiestas Nacionales). Se pueden borrar si deciden trabajarlos.
insert into public.dias_especiales (fecha, tipo, nombre)
select f::date, 'libre', n from (values
  ('2026-01-01', 'Año Nuevo'), ('2026-02-16', 'Carnaval'), ('2026-02-17', 'Carnaval'),
  ('2026-04-02', 'Jueves Santo'), ('2026-04-03', 'Viernes Santo'), ('2026-04-19', '19 de Abril'),
  ('2026-05-01', 'Día del Trabajador'), ('2026-06-24', 'Batalla de Carabobo'), ('2026-07-05', 'Día de la Independencia'),
  ('2026-07-24', 'Natalicio del Libertador'), ('2026-10-12', 'Día de la Resistencia Indígena'),
  ('2026-12-24', 'Nochebuena'), ('2026-12-25', 'Navidad'), ('2026-12-31', 'Fin de Año'),
  ('2027-01-01', 'Año Nuevo'), ('2027-02-08', 'Carnaval'), ('2027-02-09', 'Carnaval'),
  ('2027-03-25', 'Jueves Santo'), ('2027-03-26', 'Viernes Santo'), ('2027-04-19', '19 de Abril'),
  ('2027-05-01', 'Día del Trabajador'), ('2027-06-24', 'Batalla de Carabobo'), ('2027-07-05', 'Día de la Independencia'),
  ('2027-07-24', 'Natalicio del Libertador'), ('2027-10-12', 'Día de la Resistencia Indígena'),
  ('2027-12-24', 'Nochebuena'), ('2027-12-25', 'Navidad'), ('2027-12-31', 'Fin de Año'),
  ('2028-01-01', 'Año Nuevo'), ('2028-02-28', 'Carnaval'), ('2028-02-29', 'Carnaval'),
  ('2028-04-13', 'Jueves Santo'), ('2028-04-14', 'Viernes Santo'), ('2028-04-19', '19 de Abril'),
  ('2028-05-01', 'Día del Trabajador'), ('2028-06-24', 'Batalla de Carabobo'), ('2028-07-05', 'Día de la Independencia'),
  ('2028-07-24', 'Natalicio del Libertador'), ('2028-10-12', 'Día de la Resistencia Indígena'),
  ('2028-12-24', 'Nochebuena'), ('2028-12-25', 'Navidad'), ('2028-12-31', 'Fin de Año')
) v(f, n)
where not exists (select 1 from public.dias_especiales d where d.fecha = v.f::date and d.local_id is null);

-- Días que no cuentan para la puntualidad (imprevistos que afectan a todos: paro de transporte, tranca grande).
-- Aplican a todos por igual; ese día no suma ni resta en el récord del mes ni como tardanza en el historial.
create table if not exists public.dias_sin_puntualidad (
  id        uuid primary key default gen_random_uuid(),
  fecha     date not null unique,
  motivo    text not null default '',
  creado_por uuid default auth.uid(),
  creado_en timestamptz not null default now()
);

-- ¿Ese local trabaja ese día?
create or replace function public._laborable(f date, p_local uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select tipo = 'laborable' from dias_especiales where fecha = f and local_id = p_local),
    (select tipo = 'laborable' from dias_especiales where fecha = f and local_id is null),
    extract(dow from f)::int = any (coalesce((select dias_laborables from locales where id = p_local), '{}'::int[]))
  )
$$;

-- ¿Esa persona trabaja ese día? Si su local trabaja y es uno de sus días (o un día extra para todos).
create or replace function public._trabaja(pe public.personas, f date) returns boolean
language sql stable security definer set search_path = public as $$
  select public._laborable(f, pe.local_id) and (
    pe.dias_trabajo is null or cardinality(pe.dias_trabajo) = 0
    or extract(dow from f)::int = any (pe.dias_trabajo)
    or exists (select 1 from dias_especiales d where d.fecha = f and d.tipo = 'laborable' and (d.local_id = pe.local_id or d.local_id is null))
  )
$$;

drop function if exists public._toca(public.plantillas, date, int[]);
drop function if exists public._siguiente_laborable(date, int[]);
create or replace function public._siguiente_laborable(d date, p_local uuid) returns date
language plpgsql stable as $$
declare x date := d; i int := 0;
begin
  while not public._laborable(x, p_local) and i < 60 loop x := x + 1; i := i + 1; end loop;
  return x;
end $$;

create or replace function public._anterior_laborable(d date, p_local uuid) returns date
language plpgsql stable as $$
declare x date := d; i int := 0;
begin
  while not public._laborable(x, p_local) and i < 60 loop x := x - 1; i := i + 1; end loop;
  return x;
end $$;

create or replace function public._dia_del_mes(f date, dia int) returns date
language sql immutable as $$
  select make_date(extract(year from f)::int, extract(month from f)::int,
         least(dia, extract(day from (date_trunc('month', f) + interval '1 month - 1 day'))::int))
$$;

-- ¿Le tocaba a una tarea semanal ese día según su calendario (sin mirar feriados)?
create or replace function public._semanal_cae(p public.plantillas, d date) returns boolean
language sql immutable as $$
  select d >= p.fecha_inicio and extract(dow from d)::int = any (p.dias_semana)
     and ((d - (p.fecha_inicio - ((extract(dow from p.fecha_inicio)::int + 6) % 7))) / 7) % p.cada_n = 0
$$;

-- ¿Toca esta tarea ese día? Las diarias no salen en días libres (feriados, vacaciones);
-- las semanales y mensuales que caen en día libre se adelantan al día de trabajo ANTERIOR (una sola vez).
-- Por eso los feriados y vacaciones hay que cargarlos con anticipación.
create or replace function public._mes_toca(p public.plantillas, d date) returns boolean
language sql immutable as $$
  select (((extract(year from d) * 12 + extract(month from d)) - (extract(year from p.fecha_inicio) * 12 + extract(month from p.fecha_inicio)))::int
          % greatest(1, p.cada_n) + greatest(1, p.cada_n)) % greatest(1, p.cada_n) = 0
$$;

create or replace function public._toca(p public.plantillas, f date) returns boolean
language plpgsql stable as $$
declare d date; i int;
begin
  if p.frecuencia = 'unica' then return f = p.fecha_unica; end if;
  if f < p.fecha_inicio then return false; end if;
  if not public._laborable(f, p.local_id) then return false; end if;
  if p.frecuencia = 'diaria' then return true; end if;
  if p.frecuencia = 'semanal' then
    if public._semanal_cae(p, f) then return true; end if;
    -- hacia adelante por los días libres seguidos justo después de f
    for i in 1 .. 60 loop
      d := f + i;
      exit when public._laborable(d, p.local_id);
      if public._semanal_cae(p, d) then return true; end if;
    end loop;
    return false;
  end if;
  if p.frecuencia = 'mensual' then
    -- cada N meses (cada_n), contando desde el mes de fecha_inicio
    d := public._dia_del_mes(f, p.dia_mes);
    if public._mes_toca(p, d) and f = public._anterior_laborable(d, p.local_id) then return true; end if;
    d := public._dia_del_mes((f + interval '1 month')::date, p.dia_mes);
    return public._mes_toca(p, d) and f = public._anterior_laborable(d, p.local_id);
  end if;
  return false;
end $$;

-- Elige a quién le toca: entre quienes pueden hacerla y no faltaron (una tarea de una vez creada pasada la hora límite va solo a quien marcó llegada),
-- primero los menos cargados del día (con 15 min de tolerancia) y, entre ellos, quien la hizo hace más tiempo (o nunca).
-- La carga se mide en proporción a su capacidad: 60 min para alguien al 50% pesan como 120 min.
-- Lo atrasado solo cuenta como carga si su justificación fue aprobada; si no, se recupera sin bajarle trabajo nuevo.
-- Nadie recibe tareas más largas que su «tope por tarea», salvo que no haya otra persona que pueda.
drop function if exists public._elegir_persona(public.plantillas, date);
create or replace function public._elegir_persona(p public.plantillas, f date, p_excluir uuid[] default '{}') returns uuid
language sql stable security definer set search_path = public as $$
  with todos as (
    select pe.id, pe.nombre, (pe.tarea_max is null or p.minutos <= pe.tarea_max) as cabe,
      coalesce((select sum(a.minutos) from asignaciones a
                where a.asignado_a = pe.id and (a.fecha = f or (a.arrastra and a.estado = 'pendiente' and a.fecha < f and a.just_estado = 'aprobada'))), 0)
        * 100.0 / greatest(pe.capacidad, 10) as carga,
      (select max(a.fecha) from asignaciones a where a.plantilla_id = p.id and a.asignado_a = pe.id and a.fecha < f) as ultima
    from personas pe
    where pe.activo and pe.rol = 'empleado' and 'tareas' = any (pe.accesos) and pe.local_id = p.local_id and public._trabaja(pe, f)
      and not (pe.id = any (p_excluir))  -- ya tiene otro puesto de esta misma tarea
      and (cardinality(p.solo_pueden) = 0 or pe.id = any (p.solo_pueden))
      and (cardinality(p.solo_pueden) > 0 or cardinality(p.grupos) = 0 or pe.grupos && p.grupos)
      -- el personal administrativo (rota = false) no entra en las tareas «para cualquiera»
      and (cardinality(p.solo_pueden) > 0 or cardinality(p.grupos) > 0 or pe.rota)
      and not exists (select 1 from asistencia s where s.persona_id = pe.id and s.fecha = f and (s.estado = 'ausente' or s.salida is not null))
      -- tarea de una vez creada hoy pasada la hora límite: solo entra quien marcó llegada
      -- (las recurrentes se reparten entre todos y lo de quien falte se reasigna aparte)
      and not (p.frecuencia = 'unica' and f = public.hoy()
               and (now() at time zone 'America/Caracas')::time > (select hora_limite from tareas_ajustes where id = 1)
               and not exists (select 1 from asistencia s where s.persona_id = pe.id and s.fecha = f and s.estado = 'presente'))
  ),
  -- Si hay alguien a quien la tarea le cabe en su tope, solo entre esos; si no, entre todos (para que no quede sin dueño).
  cand as (select * from todos where cabe or not exists (select 1 from todos where cabe))
  select id from cand
  where carga <= (select min(carga) from cand) + 15
  order by ultima asc nulls first, carga asc, nombre asc, id
  limit 1
$$;

-- =====================================================================
--  Funciones que usa la app
-- =====================================================================

-- Crea las tareas del día (no repite: se puede llamar muchas veces).
create or replace function public.generar_dia(p_fecha date default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  f date := coalesce(p_fecha, public.hoy());
  p public.plantillas;
  quien uuid; mot text; n int := 0; nueva uuid; i int; nm int; m jsonb; pu int; elegidos uuid[];
begin
  if auth.uid() is null then raise exception 'Inicia sesión.'; end if;
  if f <> public.hoy() and not public.es_admin() then raise exception 'Solo gerencia puede generar otros días.'; end if;
  perform pg_advisory_xact_lock(hashtext('generar_dia:' || f::text));

  for p in
    select pl.* from plantillas pl
    where pl.activa and public._toca(pl, f)
      and not exists (select 1 from asignaciones a where a.plantilla_id = pl.id and a.fecha = f)
    order by (pl.frecuencia = 'unica' and (pl.asignar_a is not null or pl.al_pool)) desc,
             (cardinality(pl.solo_pueden) = 0 and cardinality(pl.grupos) = 0), cardinality(pl.solo_pueden),
             pl.minutos * greatest(1, jsonb_array_length(pl.momentos)) desc, pl.titulo
  loop
    elegidos := '{}';
    for pu in 0 .. greatest(1, least(5, p.personas)) - 1 loop
    if p.frecuencia = 'unica' and p.al_pool then quien := null; mot := 'pool';
    elsif p.frecuencia = 'unica' and p.asignar_a is not null and pu = 0 then quien := p.asignar_a; mot := 'fija';
    else
      quien := public._elegir_persona(p, f, elegidos);
      mot := case when quien is null then 'pool' else 'rotacion' end;
    end if;
    if quien is not null then elegidos := elegidos || quien; end if;

    nm := greatest(1, jsonb_array_length(p.momentos));
    for i in 0 .. nm - 1 loop
      m := p.momentos -> i;  -- null si es una sola vez sin hora
      insert into asignaciones (plantilla_id, fecha, titulo, detalle, minutos, arrastra, asignado_a, asignado_original, motivo,
                                local_id, momento, momento_nombre, antes, desde, registro, equipos, puesto)
      values (p.id, f, p.titulo, p.detalle, p.minutos, p.frecuencia <> 'diaria', quien, quien, mot,
              p.local_id, i, nullif(trim(m->>'nombre'), ''), nullif(m->>'antes', '')::time, nullif(m->>'desde', '')::time, p.registro, p.equipos, pu)
      on conflict (plantilla_id, fecha, momento, puesto) do nothing
      returning id into nueva;
      if nueva is not null then
        insert into tareas_eventos (asignacion_id, tipo, a, texto) values (nueva, 'generada', quien, mot);
        n := n + 1;
      end if;
    end loop;
    end loop;
  end loop;
  return n;
end $$;

-- Compensación: quien NO hizo su parte (p_debe) recibe tareas pendientes de hoy de quien sí la hizo por él (p_hizo),
-- por los mismos minutos o hasta 20% más (la menor combinación); si ninguna cae ahí, la más cercana (empate: la más larga).
-- Solo tareas que p_debe pueda hacer, de su local, que no pasen su tope por tarea; cada tarea va con todas sus veces del día.
create or replace function public._compensar(p_hizo uuid, p_debe uuid, p_minutos int) returns json
language plpgsql security definer set search_path = public as $$
declare pe public.personas; claves text[]; totales int[]; elegidas text[]; n int; mask int; i int; tot int; dif int;
  mejor int; mejor_tot int; mejor_dentro boolean; mejor_dif int; dentro boolean; u record;
begin
  select * into pe from personas where id = p_debe;
  if pe.id is null or p_minutos is null or p_minutos <= 0 then return json_build_object('unidades', 0, 'minutos', 0); end if;
    -- unidades = una tarea con todas sus veces del día (van juntas, a la misma persona); hasta 12, las más largas
    select coalesce(array_agg(clave order by total desc, clave collate "C"), '{}'), coalesce(array_agg(total order by total desc, clave collate "C"), '{}')
      into claves, totales
    from (
      select coalesce(x.plantilla_id::text, x.id::text) as clave, sum(x.minutos)::int as total, max(x.minutos) as una
      from asignaciones x left join plantillas p on p.id = x.plantilla_id
      where x.asignado_a = p_hizo and x.fecha = public.hoy() and x.motivo <> 'fija' and x.local_id is not distinct from pe.local_id
        and (p.id is null or (
              (cardinality(p.solo_pueden) = 0 or p_debe = any (p.solo_pueden))
          and (cardinality(p.solo_pueden) > 0 or cardinality(p.grupos) = 0 or pe.grupos && p.grupos)
          and (cardinality(p.solo_pueden) > 0 or cardinality(p.grupos) > 0 or pe.rota)))
      group by 1
      having bool_and(x.estado = 'pendiente') and (pe.tarea_max is null or max(x.minutos) <= pe.tarea_max)
      order by sum(x.minutos) desc, coalesce(x.plantilla_id::text, x.id::text) collate "C"
      limit 12
    ) u;
    n := coalesce(array_length(claves, 1), 0);
    if n = 0 then return json_build_object('unidades', 0, 'minutos', 0); end if;
    -- La combinación que da los mismos minutos o hasta 20% más (la menor). Si ninguna cae ahí, la más cercana.
    mejor := 0; mejor_tot := 0; mejor_dentro := false; mejor_dif := null;
    for mask in 1 .. (1 << n) - 1 loop
      tot := 0;
      for i in 1 .. n loop
        if (mask >> (i - 1)) & 1 = 1 then tot := tot + totales[i]; end if;
      end loop;
      dentro := tot >= p_minutos and tot * 10 <= p_minutos * 12;
      if dentro then
        if not mejor_dentro or tot < mejor_tot then mejor := mask; mejor_tot := tot; mejor_dentro := true; end if;
      elsif not mejor_dentro then
        dif := abs(tot - p_minutos);
        if mejor_dif is null or dif < mejor_dif or (dif = mejor_dif and tot > mejor_tot) then
          mejor := mask; mejor_tot := tot; mejor_dif := dif;
        end if;
      end if;
    end loop;
    elegidas := '{}';
    for i in 1 .. n loop
      if (mejor >> (i - 1)) & 1 = 1 then elegidas := elegidas || claves[i]; end if;
    end loop;
    for u in
      update asignaciones x set asignado_a = p_debe, asignado_original = p_debe, motivo = 'compensa'
      where x.asignado_a = p_hizo and x.fecha = public.hoy() and x.estado = 'pendiente'
        and coalesce(x.plantilla_id::text, x.id::text) = any (elegidas)
      returning x.id
    loop
      insert into tareas_eventos (asignacion_id, tipo, de, a, texto) values (u.id, 'reasignada', p_hizo, p_debe, 'compensa');
    end loop;
  return json_build_object('unidades', cardinality(elegidas), 'minutos', mejor_tot);
end $$;

-- Marca presente a alguien y le devuelve lo que se le pasó a otro por su ausencia (si no se ha hecho).
-- Si quien lo cubrió YA hizo algo suyo, llegar tarde no le baja el trabajo: recibe tareas pendientes de hoy
-- de esa persona por los mismos minutos o hasta 20% más (nunca menos, si alcanza), que pueda hacer y de su mismo local.
drop function if exists public._llegada(uuid);
drop function if exists public._llegada(uuid, text);
drop function if exists public._llegada(uuid, text, uuid);
create or replace function public._llegada(p_persona uuid, p_verif text default null, p_local uuid default null, p_hora timestamptz default null) returns json
language plpgsql security definer set search_path = public as $$
declare aj public.tareas_ajustes; ya public.asistencia; dev int := 0; comp int := 0; min_comp int := 0; r record; u record;
  -- Marcado sin conexión: vale la hora en que lo tocó (hasta 3 horas antes y del mismo día); si no, la de ahora
  ahora timestamptz := case when p_hora is not null and p_hora <= now() and p_hora >= now() - interval '3 hours'
                              and (p_hora at time zone 'America/Caracas')::date = public.hoy() then p_hora else now() end;
  pe public.personas; inicio timestamptz := (public.hoy()::timestamp at time zone 'America/Caracas');
  v json;
begin
  select * into aj from tareas_ajustes where id = 1;
  select * into pe from personas where id = p_persona;
  select * into ya from asistencia where persona_id = p_persona and fecha = public.hoy();
  if ya.persona_id is not null and ya.estado = 'presente' then
    return json_build_object('llegada', ya.llegada, 'devueltas', 0, 'compensadas', 0, 'ya', true);
  end if;
  insert into asistencia (persona_id, fecha, estado, llegada, marcado_por, verificado, local_id)
  values (p_persona, public.hoy(), 'presente', ahora, auth.uid(), p_verif, coalesce(p_local, pe.local_id))
  on conflict (persona_id, fecha) do update set estado = 'presente', llegada = ahora, marcado_por = auth.uid(), verificado = p_verif,
    salida = null, salida_motivo = null, local_id = coalesce(p_local, pe.local_id);

  -- 1) Lo que se repartió HOY por su ausencia y sigue pendiente vuelve a ella.
  --    Lo de días anteriores ya es responsabilidad de quien lo cubrió.
  for r in
    update asignaciones x set asignado_a = p_persona, motivo = 'devuelta', oculta = false
    where x.asignado_original = p_persona and x.motivo = 'ausencia' and x.estado = 'pendiente'
      and x.asignado_a is distinct from p_persona and x.fecha <= public.hoy()
      and (x.fecha = public.hoy() or exists (select 1 from tareas_eventos e where e.asignacion_id = x.id and e.tipo = 'reasignada' and e.texto = 'ausencia'
                                             and (e.creado_en at time zone 'America/Caracas')::date = public.hoy()))
    returning x.id
  loop
    insert into tareas_eventos (asignacion_id, tipo, a, texto) values (r.id, 'devuelta', p_persona, 'Llegó: se le devuelve');
    dev := dev + 1;
  end loop;

  -- 2) Lo que otro ya hizo por ella hoy: se compensa con tareas pendientes de esa persona.
  for r in
    select x.hecha_por as quien, sum(x.minutos)::int as minutos from asignaciones x
    where x.asignado_original = p_persona and x.motivo = 'ausencia' and x.estado = 'hecha' and not x.compensada
      and x.hecha_por is not null and x.hecha_por <> p_persona and x.hecha_en >= inicio
    group by x.hecha_por
  loop
    update asignaciones set compensada = true
    where asignado_original = p_persona and motivo = 'ausencia' and estado = 'hecha' and not compensada and hecha_por = r.quien and hecha_en >= inicio;
    v := public._compensar(r.quien, p_persona, r.minutos);
    comp := comp + (v->>'unidades')::int; min_comp := min_comp + (v->>'minutos')::int;
  end loop;
  return json_build_object('llegada', ahora, 'devueltas', dev, 'compensadas', comp, 'min_compensados', min_comp, 'ya', false,
                           'local', coalesce(p_local, pe.local_id));
end $$;

-- IP pública desde la que llega la petición (Supabase la pasa en los encabezados)
create or replace function public._ip_cliente() returns text
language plpgsql stable as $$
declare h json; ip text;
begin
  begin h := current_setting('request.headers', true)::json; exception when others then return null; end;
  if h is null then return null; end if;
  ip := coalesce(h->>'cf-connecting-ip', h->>'x-real-ip', split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1));
  ip := nullif(trim(ip), '');
  -- IPv6: cada teléfono tiene su propia dirección dentro de la misma red; se compara la red (/64), no el teléfono
  if ip like '%:%' then
    begin ip := host(network(set_masklen(ip::inet, 64))) || '/64'; exception when others then null; end;
  end if;
  return ip;
end $$;
-- Redes IPv6 guardadas antes como dirección de un solo teléfono: se pasan a su red /64
update public.locales l set redes = (
  select coalesce(array_agg(distinct case when x like '%:%' and x not like '%/64'
                                          then host(network(set_masklen(x::inet, 64))) || '/64' else x end), '{}')
  from unnest(l.redes) x)
where exists (select 1 from unnest(l.redes) x where x like '%:%' and x not like '%/64');

create or replace function public._distancia_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 6371000 * 2 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2) +
         cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- Dónde está: primero su propio local, después cualquier otro (por ejemplo, alguien del segundo local que vino al principal).
-- Devuelve {verif: 'wifi'|'gps'|'libre', local: uuid} o null si no está en ningún local.
drop function if exists public._en_tienda(uuid, double precision, double precision, double precision);
drop function if exists public._en_tienda(double precision, double precision, double precision);
-- «Hoy no hay Wi-Fi»: gerencia lo marca y ese día en ese local se puede marcar «Llegué» sin revisar la red.
alter table public.locales add column if not exists sin_wifi_fecha date;
-- Redes desde las que alguien intentó marcar «Llegué» y no se reconocieron (el proveedor pudo cambiar la dirección).
-- Gerencia recibe un aviso y decide si es la del local. Solo se guarda la red, nunca la ubicación.
create table if not exists public.redes_nuevas (
  id         uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas (id) on delete cascade,
  ip         text not null,
  fecha      date not null default public.hoy(),
  creado_en  timestamptz not null default now(),
  unique (ip, fecha, persona_id)
);
alter table public.redes_nuevas enable row level security;
revoke all on public.redes_nuevas from anon, authenticated;
grant select, delete on public.redes_nuevas to authenticated;
drop policy if exists redes_nuevas_admin on public.redes_nuevas;
create policy redes_nuevas_admin on public.redes_nuevas for all to authenticated using (public.es_admin()) with check (public.es_admin());

create or replace function public._ubicar(p_persona uuid, p_lat double precision, p_lng double precision, p_precision double precision) returns json
language plpgsql stable security definer set search_path = public as $$
declare propio uuid; ip text := public._ip_cliente(); lo record;
begin
  select local_id into propio from personas where id = p_persona;
  if not (select solo_en_tienda from tareas_ajustes where id = 1) then return json_build_object('verif', 'libre', 'local', propio); end if;
  -- Wi-Fi: su local primero
  for lo in select id, redes from locales order by (id = propio) desc, principal desc loop
    if ip is not null and ip = any (lo.redes) then return json_build_object('verif', 'wifi', 'local', lo.id); end if;
  end loop;
  -- Gerencia marcó que hoy no hay Wi-Fi en su local
  if exists (select 1 from locales where id = propio and sin_wifi_fecha = public.hoy()) then
    return json_build_object('verif', 'sin_wifi', 'local', propio);
  end if;
  -- Ubicación (solo si gerencia la activó): su local primero, si no el más cercano dentro de su radio.
  -- No se guarda la ubicación de nadie: solo se compara y se descarta.
  if (select usar_gps from tareas_ajustes where id = 1) and p_lat is not null and p_lng is not null then
    for lo in
      select id, public._distancia_m(p_lat, p_lng, lat, lng) as d, radio_m from locales
      where lat is not null order by (id = propio) desc, public._distancia_m(p_lat, p_lng, lat, lng)
    loop
      if lo.d <= lo.radio_m + least(coalesce(p_precision, 0), 150) then return json_build_object('verif', 'gps', 'local', lo.id); end if;
    end loop;
  end if;
  return null;
end $$;

-- Empleado: "Llegué". Si la regla del local está activa, primero se prueba el Wi-Fi;
-- si no está en una red conocida, la app manda la ubicación y se prueba el GPS.
drop function if exists public.marcar_llegada();
drop function if exists public.marcar_llegada(double precision, double precision, double precision);
create or replace function public.marcar_llegada(p_lat double precision default null, p_lng double precision default null, p_precision double precision default null,
                                                 p_hora timestamptz default null) returns json
language plpgsql security definer set search_path = public as $$
declare v json; v_ip text := public._ip_cliente(); nom text; nuevo uuid;
begin
  if not exists (select 1 from personas where id = auth.uid() and activo) then raise exception 'Tu usuario no está activo.'; end if;
  if exists (select 1 from asistencia where persona_id = auth.uid() and fecha = public.hoy() and estado = 'presente') then
    return public._llegada(auth.uid());
  end if;
  v := public._ubicar(auth.uid(), p_lat, p_lng, p_precision);
  if v is null then
    if p_lat is null and (select usar_gps from tareas_ajustes where id = 1) then raise exception 'NO_TIENDA: Falta tu ubicación'; end if;
    -- Red desconocida: se anota para gerencia (una vez por red y día) y se devuelve el error sin deshacer ese registro
    if v_ip is not null then
      insert into redes_nuevas (persona_id, ip) values (auth.uid(), v_ip) on conflict do nothing returning id into nuevo;
      if nuevo is not null and not exists (select 1 from redes_nuevas r where r.ip = v_ip and r.fecha = public.hoy() and r.id <> nuevo) then
        select coalesce(nullif(nombre, ''), email) into nom from personas where id = auth.uid();
        insert into avisos_cola (persona_id, titulo, cuerpo, url)
        select ad.id, nom || ' no pudo marcar «Llegué»', 'Lo intentó desde una red que la app no conoce. Si es el Wi-Fi del local, regístrala en Equipo → Locales.', './#/equipo/locales'
        from personas ad where ad.activo and ad.rol = 'admin';
      end if;
    end if;
    return json_build_object('error', 'No se pudo marcar tu llegada. Si el problema sigue, avísale a gerencia.');
  end if;
  perform public.generar_dia(public.hoy());
  -- La hora del teléfono (marcado sin internet) solo vale si gerencia marcó que hoy no hay Wi-Fi en ese local.
  -- Si no, cuenta la hora en que llega al servidor desde el Wi-Fi del local.
  if v->>'verif' = 'sin_wifi' and p_hora is not null and p_hora < now() - interval '2 minutes' then
    return public._llegada(auth.uid(), 'sin_conexion', (v->>'local')::uuid, p_hora);
  end if;
  return public._llegada(auth.uid(), nullif(v->>'verif', 'libre'), (v->>'local')::uuid);
end $$;

-- Gerencia: ver desde qué red está conectada y registrarla como red de la tienda.
create or replace function public.mi_red() returns json
language plpgsql stable security definer set search_path = public as $$
declare ip text := public._ip_cliente();
begin
  if not public.es_admin() then raise exception 'Solo gerencia.'; end if;
  return json_build_object('ip', ip, 'locales',
    coalesce((select json_agg(id) from locales where ip is not null and ip = any (redes)), '[]'::json));
end $$;

-- Gerencia: hoy no hay Wi-Fi en este local (se puede marcar «Llegué» sin revisar la red). Se apaga solo al día siguiente.
create or replace function public.sin_wifi_hoy(p_local uuid, p_activo boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'Solo gerencia.'; end if;
  update locales set sin_wifi_fecha = case when p_activo then public.hoy() else null end where id = p_local;
end $$;
-- Gerencia: la red nueva sí es del local. Se registra y se borran los intentos desde esa red.
create or replace function public.aceptar_red(p_red uuid, p_local uuid) returns void
language plpgsql security definer set search_path = public as $$
declare x text;
begin
  if not public.es_admin() then raise exception 'Solo gerencia.'; end if;
  select ip into x from redes_nuevas where id = p_red;
  if x is null then raise exception 'Esa red ya no está en la lista.'; end if;
  update locales set redes = array_remove(redes, x) where id <> p_local and x = any (redes);
  update locales set redes = array_append(array_remove(redes, x), x) where id = p_local;
  delete from redes_nuevas where ip = x;
end $$;

drop function if exists public.registrar_red();
create or replace function public.registrar_red(p_local uuid) returns json
language plpgsql security definer set search_path = public as $$
declare ip text := public._ip_cliente(); r text[];
begin
  if not public.es_admin() then raise exception 'Solo gerencia.'; end if;
  if ip is null then raise exception 'No se pudo detectar la red. Intenta de nuevo.'; end if;
  -- una red pertenece a un solo local
  update locales set redes = array_remove(redes, ip) where id <> p_local and ip = any (redes);
  select redes into r from locales where id = p_local;
  if r is null then raise exception 'Ese local no existe.'; end if;
  if not ip = any (r) then
    r := (array_append(r, ip))[greatest(1, cardinality(r) + 1 - 4):];  -- se guardan las últimas 5
    update locales set redes = r where id = p_local;
  end if;
  return json_build_object('ip', ip, 'redes', cardinality(r));
end $$;

-- Empleado: marcar o desmarcar "Hecho" (solo lo suyo; deshacer solo el mismo día)
create or replace function public._hora_txt(t time) returns text language sql immutable as $$
  select to_char(t, 'FMHH12:MI') || case when t < '12:00' then ' a. m.' when t < '13:00' then ' del mediodía' else ' p. m.' end
$$;

create or replace function public._hecha(p_id uuid, p_hecha boolean, p_con_registro boolean) returns void
language plpgsql security definer set search_path = public as $$
declare a public.asignaciones; adm boolean := public.es_admin(); p public.plantillas; t time; quien uuid;
begin
  select * into a from asignaciones where id = p_id for update;
  if a.id is null then raise exception 'Esa tarea ya no existe.'; end if;
  if not adm and a.asignado_a is distinct from auth.uid() then raise exception 'Esa tarea no está asignada a ti.'; end if;
  select * into p from plantillas where id = a.plantilla_id;
  if p_hecha then
    if a.estado = 'hecha' then return; end if;
    if a.fecha > public.hoy() then raise exception 'Esa tarea es para otro día.'; end if;
    if a.registro and not p_con_registro then raise exception 'Esa tarea pide registrar las temperaturas.'; end if;
    -- no antes de su hora («desde»)
    if not adm and a.desde is not null and a.fecha = public.hoy() and (now() at time zone 'America/Caracas')::time < a.desde then
      raise exception 'Esa tarea todavía no toca: es desde las %', public._hora_txt(a.desde);
    end if;
    -- «después del almuerzo» no se puede marcar antes de que pase la hora de «después del desayuno»
    if not adm and a.momento > 0 and a.fecha = public.hoy() and exists (
         select 1 from asignaciones b where b.plantilla_id = a.plantilla_id and b.fecha = a.fecha and b.momento = a.momento - 1
           and b.antes is not null and (now() at time zone 'America/Caracas')::time < b.antes) then
      raise exception 'Esa tarea todavía no toca: es para %.', coalesce(a.momento_nombre, 'más tarde');
    end if;
    if not adm and not exists (select 1 from asistencia where persona_id = auth.uid() and fecha = public.hoy() and estado = 'presente') then
      if (select solo_en_tienda from tareas_ajustes where id = 1) then raise exception 'Primero marca «Llegué».'; end if;
      perform public._llegada(auth.uid());
    end if;
    update asignaciones set estado = 'hecha', hecha_en = now(), hecha_por = coalesce(a.asignado_a, auth.uid()), repetir = false where id = p_id;
    insert into tareas_eventos (asignacion_id, tipo, a) values (p_id, 'hecha', coalesce(a.asignado_a, auth.uid()));
    -- Tarea de varias personas: con que una la marque, queda hecha para todos. Cada puesto queda como hecho
    -- por su dueño (la hicieron juntos: nadie le debe minutos a nadie).
    with b as (
      update asignaciones x set estado = 'hecha', hecha_en = (select y.hecha_en from asignaciones y where y.id = p_id),
             hecha_por = coalesce(x.asignado_a, a.asignado_a, auth.uid()), repetir = false
      where x.plantilla_id = a.plantilla_id and x.fecha = a.fecha and x.momento = a.momento and x.puesto <> a.puesto and x.estado = 'pendiente'
      returning x.id, x.hecha_por)
    insert into tareas_eventos (asignacion_id, tipo, a) select b.id, 'hecha', b.hecha_por from b;
    -- La rescató alguien porque a quien le tocaba se le pasó sin excusa: esa persona le compensa los minutos
    if a.motivo = 'rescate' and a.incumplida and not a.compensada and a.rescatada_de is not null then
      update asignaciones set compensada = true where id = p_id;
      perform public._compensar(coalesce(a.asignado_a, auth.uid()), a.rescatada_de, a.minutos);
    end if;
    -- Tarea que sale después (p. ej. «Apagar contenedores» 45 min después), para la misma persona
    if p.id is not null and nullif(trim(coalesce(p.seguimiento_titulo, '')), '') is not null and a.momento < 50 and a.fecha = public.hoy() then
      t := date_trunc('minute', (now() at time zone 'America/Caracas') + make_interval(mins => p.seguimiento_despues))::time;
      quien := coalesce(a.asignado_a, auth.uid());
      insert into asignaciones (plantilla_id, fecha, titulo, minutos, arrastra, asignado_a, asignado_original, motivo, local_id,
                                momento, momento_nombre, desde, antes)
      values (p.id, a.fecha, trim(p.seguimiento_titulo), p.seguimiento_minutos, false, quien, quien, 'fija', a.local_id,
              a.momento + 50, a.momento_nombre, t, (t + interval '15 minutes')::time)
      on conflict (plantilla_id, fecha, momento, puesto) do update set desde = excluded.desde, antes = excluded.antes,
        asignado_a = excluded.asignado_a, asignado_original = excluded.asignado_original
        where asignaciones.estado = 'pendiente';
    end if;
  else
    if a.estado <> 'hecha' then return; end if;
    if not adm and (a.hecha_en at time zone 'America/Caracas')::date <> public.hoy() then
      raise exception 'Solo se puede deshacer el mismo día.';
    end if;
    update asignaciones set estado = 'pendiente', hecha_en = null, hecha_por = null where id = p_id;
    insert into tareas_eventos (asignacion_id, tipo, a) values (p_id, 'deshecha', a.asignado_a);
    -- los compañeros que quedaron hechos junto con esta vuelven a pendiente
    with b as (
      update asignaciones x set estado = 'pendiente', hecha_en = null, hecha_por = null
      where x.plantilla_id = a.plantilla_id and x.fecha = a.fecha and x.momento = a.momento and x.puesto <> a.puesto
        and x.estado = 'hecha' and x.hecha_en = a.hecha_en
      returning x.id, x.asignado_a)
    insert into tareas_eventos (asignacion_id, tipo, a) select b.id, 'deshecha', b.asignado_a from b;
    delete from lecturas where asignacion_id = p_id;
    -- si se desmarca «Prender», se quita el «Apagar» que todavía no se hizo
    if a.momento < 50 then
      delete from asignaciones where plantilla_id = a.plantilla_id and fecha = a.fecha and momento = a.momento + 50 and estado = 'pendiente';
    end if;
  end if;
end $$;

-- Empleado: marcar o desmarcar "Hecho" (solo lo suyo; deshacer solo el mismo día)
create or replace function public.marcar_hecha(p_id uuid, p_hecha boolean) returns void
language plpgsql security definer set search_path = public as $$
begin perform public._hecha(p_id, p_hecha, false); end $$;

-- Empleado: registrar las temperaturas de una tarea con registro y marcarla hecha.
-- p_lecturas = [{"equipo": "<uuid>", "temperatura": -18.5, "estado": "normal|defrost|apagado", "nota": "..."}]
create or replace function public.registrar_lecturas(p_id uuid, p_lecturas jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare a public.asignaciones; p public.plantillas; e record; l jsonb; temp numeric; est text; nota text; fuera boolean; nfuera int := 0;
begin
  select * into a from asignaciones where id = p_id;
  if a.id is null then raise exception 'Esa tarea ya no existe.'; end if;
  if not a.registro then raise exception 'Esa tarea no pide temperaturas.'; end if;
  if not public.es_admin() and a.asignado_a is distinct from auth.uid() then raise exception 'Esa tarea no está asignada a ti.'; end if;
  if a.estado = 'hecha' then raise exception 'Esa tarea ya está hecha.'; end if;
  if not public.es_admin() and a.desde is not null and a.fecha = public.hoy() and (now() at time zone 'America/Caracas')::time < a.desde then
    raise exception 'Esa tarea todavía no toca: es desde las %', public._hora_txt(a.desde);
  end if;
  select * into p from plantillas where id = a.plantilla_id;
  delete from lecturas where asignacion_id = p_id;
  for e in
    select q.* from equipos q
    where q.activo and q.local_id is not distinct from a.local_id
      and (cardinality(a.equipos) = 0 or q.id = any (a.equipos))
    order by q.orden, q.nombre
  loop
    select x.value into l from jsonb_array_elements(coalesce(p_lecturas, '[]'::jsonb)) as x where x.value->>'equipo' = e.id::text limit 1;
    if l is null then raise exception 'Escribe la lectura de «%».', e.nombre; end if;
    est := coalesce(l->>'estado', 'normal');
    if est not in ('normal', 'defrost', 'apagado') then raise exception 'Escribe un estado válido para «%».', e.nombre; end if;
    temp := round(nullif(l->>'temperatura', '')::numeric, 1);
    if temp is null and est <> 'apagado' then raise exception 'Escribe la temperatura de «%».', e.nombre; end if;
    nota := nullif(trim(coalesce(l->>'nota', '')), '');
    -- en defrost o apagado no se marca fuera de rango (se ve el estado)
    fuera := est = 'normal' and temp is not null and ((e.temp_min is not null and temp < e.temp_min) or (e.temp_max is not null and temp > e.temp_max));
    if fuera and nota is null then raise exception 'Escribe una nota: «%» está fuera de rango.', e.nombre; end if;
    if fuera then nfuera := nfuera + 1; end if;
    insert into lecturas (asignacion_id, equipo_id, fecha, temperatura, estado, fuera_rango, nota, registrado_por)
    values (p_id, e.id, a.fecha, temp, est, fuera, nota, auth.uid());
  end loop;
  perform public._hecha(p_id, true, true);
  return json_build_object('fuera', nfuera);
end $$;

-- Empleado: explicar por qué no se hizo una tarea (queda pendiente de revisión de gerencia).
create or replace function public.justificar(p_id uuid, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.asignaciones; adm boolean := public.es_admin();
begin
  if length(trim(coalesce(p_texto, ''))) < 3 then raise exception 'Escribe el motivo.'; end if;
  select * into a from asignaciones where id = p_id for update;
  if a.id is null then raise exception 'Esa tarea ya no existe.'; end if;
  if not adm and a.asignado_a is distinct from auth.uid() then raise exception 'Esa tarea no está asignada a ti.'; end if;
  if a.estado <> 'pendiente' then raise exception 'Esa tarea ya está hecha.'; end if;
  if a.just_estado in ('aprobada', 'rechazada') then raise exception 'Esa justificación ya fue revisada.'; end if;
  update asignaciones set justificacion = trim(p_texto), just_estado = case when adm then 'aprobada' else 'pendiente' end,
    just_por = case when adm then auth.uid() else null end where id = p_id;
  insert into tareas_eventos (asignacion_id, tipo, a, texto) values (p_id, case when adm then 'just_aprobada' else 'justificada' end, a.asignado_a, trim(p_texto));
end $$;

-- Gerencia: aprobar o rechazar una justificación.
create or replace function public.revisar_justificacion(p_id uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare a public.asignaciones;
begin
  if not public.es_admin() then raise exception 'Solo gerencia.'; end if;
  select * into a from asignaciones where id = p_id for update;
  if a.id is null or a.justificacion is null then raise exception 'Esa justificación ya no existe.'; end if;
  -- La decisión de un jefe es final; solo quien decidió puede corregirla si fue un error.
  if a.just_estado in ('aprobada', 'rechazada') and a.just_por is distinct from auth.uid() then
    raise exception 'Esa justificación ya la revisó otra persona de gerencia.';
  end if;
  update asignaciones set just_estado = case when p_ok then 'aprobada' else 'rechazada' end, just_por = auth.uid() where id = p_id;
  insert into tareas_eventos (asignacion_id, tipo, a, texto) values (p_id, case when p_ok then 'just_aprobada' else 'just_rechazada' end, a.asignado_a, a.justificacion);
end $$;

-- Gerencia: elige al azar tareas hechas hoy para revisar y las reparte entre gerencia.
-- La mitad sale de lo hecho ANTES de las 12 (se eligen desde las 12, cuando ya se puede escoger entre todo lo de la mañana)
-- y la otra mitad de lo hecho DESDE las 12 (se eligen desde las 4 p. m.). Prefiere personas que aún no tienen revisión hoy.
create or replace function public.asignar_revisiones() returns int
language plpgsql security definer set search_path = public as $$
declare
  ahora time := (now() at time zone 'America/Caracas')::time;
  n int := (select revisiones_dia from tareas_ajustes where id = 1);
  fr text; meta int; ya int; nuevas int := 0; a record; quien uuid;
begin
  if not public.es_admin() then return 0; end if;
  perform pg_advisory_xact_lock(hashtext('revisiones:' || public.hoy()::text));
  foreach fr in array array['manana', 'tarde'] loop
    continue when (fr = 'manana' and ahora < '12:00') or (fr = 'tarde' and ahora < '16:00');
    meta := case when fr = 'manana' then ceil(n / 2.0)::int else floor(n / 2.0)::int end;
    select count(*) into ya from revisiones where fecha = public.hoy() and franja = fr;
    while ya < meta loop
      select x.id, x.hecha_por into a from asignaciones x
      where x.estado = 'hecha' and (x.hecha_en at time zone 'America/Caracas')::date = public.hoy()
        and ((fr = 'manana') = ((x.hecha_en at time zone 'America/Caracas')::time < '12:00'))
        and x.hecha_por is not null and not exists (select 1 from revisiones r where r.asignacion_id = x.id)
        and exists (select 1 from personas pe where pe.id = x.hecha_por and pe.rol = 'empleado')
      order by exists (select 1 from revisiones r where r.fecha = public.hoy() and r.hecho_por = x.hecha_por), random()
      limit 1;
      exit when a.id is null;
      select pe.id into quien from personas pe
      where pe.rol = 'admin' and pe.activo
      order by (select count(*) from revisiones r where r.revisor = pe.id and r.fecha = public.hoy()), random()
      limit 1;
      insert into revisiones (asignacion_id, fecha, revisor, franja, hecho_por) values (a.id, public.hoy(), quien, fr, a.hecha_por) on conflict do nothing;
      ya := ya + 1; nuevas := nuevas + 1;
      a := null;
    end loop;
  end loop;
  return nuevas;
end $$;

-- Gerencia: calificar una tarea revisada. p_repetir = la tarea vuelve a la lista de quien la hizo.
create or replace function public.calificar(p_id uuid, p_calificacion int, p_nota text, p_repetir boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r public.revisiones; a public.asignaciones;
begin
  if not public.es_admin() then raise exception 'Solo gerencia.'; end if;
  select * into r from revisiones where id = p_id for update;
  if r.id is null then raise exception 'Esa revisión ya no existe.'; end if;
  if r.calificacion is not null and r.revisado_por is distinct from auth.uid() then
    raise exception 'Esa tarea ya la calificó otra persona de gerencia.';
  end if;
  update revisiones set calificacion = p_calificacion, nota = nullif(trim(coalesce(p_nota, '')), ''), revisado_por = auth.uid(), revisado_en = now() where id = p_id;
  select * into a from asignaciones where id = r.asignacion_id;
  insert into tareas_eventos (asignacion_id, tipo, a, texto) values (a.id, 'revisada', a.hecha_por, p_calificacion::text || coalesce(': ' || nullif(trim(p_nota), ''), ''));
  if p_repetir then
    -- sigue en su lista (también los días siguientes) hasta que la rehaga
    update asignaciones set estado = 'pendiente', hecha_en = null, hecha_por = null, repetir = true, arrastra = true,
      asignado_a = coalesce(a.hecha_por, a.asignado_a) where id = a.id;
    insert into tareas_eventos (asignacion_id, tipo, a, texto) values (a.id, 'repetir', coalesce(a.hecha_por, a.asignado_a), nullif(trim(p_nota), ''));
  end if;
end $$;

-- Empleado: tomar una tarea del pool
create or replace function public.tomar_del_pool(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.asignaciones;
begin
  if not (select pool_activo from tareas_ajustes where id = 1) then raise exception 'El pool está desactivado.'; end if;
  select * into a from asignaciones where id = p_id for update;
  if a.id is null or a.asignado_a is not null or a.estado <> 'pendiente' or a.fecha > public.hoy() or (a.fecha < public.hoy() and not a.arrastra) then
    raise exception 'Alguien ya la tomó.';
  end if;
  if a.local_id is distinct from (select local_id from personas where id = auth.uid()) then raise exception 'Esa tarea es de otro local.'; end if;
  if (select solo_en_tienda from tareas_ajustes where id = 1)
     and not exists (select 1 from asistencia where persona_id = auth.uid() and fecha = public.hoy() and estado = 'presente') then
    raise exception 'Primero marca «Llegué».';
  end if;
  update asignaciones set asignado_a = auth.uid(), asignado_original = auth.uid(), motivo = 'tomada' where id = p_id;
  insert into tareas_eventos (asignacion_id, tipo, a) values (p_id, 'tomada', auth.uid());
end $$;

-- Gerencia: reasignar varias tareas. p_items = [{"id": "...", "a": "<persona o null>"}]
-- p_motivo 'ausencia' guarda a quién le tocaba, para devolvérsela si llega tarde.
create or replace function public.reasignar(p_items jsonb, p_motivo text default 'manual') returns int
language plpgsql security definer set search_path = public as $$
declare it jsonb; a public.asignaciones; nuevo uuid; n int := 0;
begin
  if not public.es_admin() then raise exception 'Solo gerencia puede reasignar.'; end if;
  if p_motivo not in ('ausencia', 'manual') then raise exception 'Motivo no válido.'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into a from asignaciones where id = (it->>'id')::uuid for update;
    continue when a.id is null or a.estado <> 'pendiente';
    nuevo := nullif(it->>'a', '')::uuid;
    continue when nuevo is not distinct from a.asignado_a;
    if nuevo is not null and not exists (select 1 from personas where id = nuevo and activo) then
      raise exception 'Esa persona no está activa.';
    end if;
    update asignaciones set
      asignado_a = nuevo,
      asignado_original = case when p_motivo = 'ausencia' then a.asignado_original else nuevo end,
      motivo = case when p_motivo = 'ausencia' then 'ausencia' when nuevo is null then 'pool' else 'manual' end
    where id = a.id;
    insert into tareas_eventos (asignacion_id, tipo, de, a, texto) values (a.id, 'reasignada', a.asignado_a, nuevo, p_motivo);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Empleado: «Me voy antes». Queda la hora; lo pendiente lo reparte gerencia (igual que una ausencia).
create or replace function public.marcar_salida(p_motivo text default null) returns json
language plpgsql security definer set search_path = public as $$
declare s public.asistencia;
begin
  select * into s from asistencia where persona_id = auth.uid() and fecha = public.hoy() for update;
  if s.persona_id is null or s.estado <> 'presente' then raise exception 'Primero marca «Llegué».'; end if;
  if s.salida is not null then return json_build_object('salida', s.salida, 'ya', true); end if;
  update asistencia set salida = now(), salida_motivo = nullif(trim(coalesce(p_motivo, '')), '')
  where persona_id = auth.uid() and fecha = public.hoy();
  -- lo que deja pendiente se reparte solo, con la misma regla de las faltas
  perform public._repartir_local((select local_id from personas where id = auth.uid()),
                                 now() >= public._ts_hoy((select hora_limite from tareas_ajustes where id = 1)));
  return json_build_object('salida', now(), 'ya', false);
end $$;

-- Gerencia: marcar asistencia de alguien (p. ej. "no viene hoy", "sí llegó", "se fue")
create or replace function public.marcar_asistencia(p_persona uuid, p_estado text) returns json
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'Solo gerencia.'; end if;
  if p_estado = 'presente' then return public._llegada(p_persona, 'gerencia'); end if;
  if p_estado = 'ausente' then
    insert into asistencia (persona_id, fecha, estado, llegada, marcado_por)
    values (p_persona, public.hoy(), 'ausente', null, auth.uid())
    on conflict (persona_id, fecha) do update set estado = 'ausente', llegada = null, salida = null, salida_motivo = null, marcado_por = auth.uid();
    return json_build_object('ok', true);
  end if;
  if p_estado = 'sin_marcar' then
    delete from asistencia where persona_id = p_persona and fecha = public.hoy();
    return json_build_object('ok', true);
  end if;
  if p_estado = 'salida' then
    update asistencia set salida = coalesce(salida, now()) where persona_id = p_persona and fecha = public.hoy() and estado = 'presente';
    if not found then raise exception 'Primero marca su llegada.'; end if;
    perform public._repartir_local((select local_id from personas where id = p_persona),
                                   now() >= public._ts_hoy((select hora_limite from tareas_ajustes where id = 1)));
    return json_build_object('ok', true);
  end if;
  if p_estado = 'sin_salida' then
    update asistencia set salida = null, salida_motivo = null where persona_id = p_persona and fecha = public.hoy();
    return json_build_object('ok', true);
  end if;
  raise exception 'Estado no válido.';
end $$;

-- Cualquiera: su propio nombre y teléfono
create or replace function public.mi_perfil(p_nombre text, p_telefono text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if length(trim(coalesce(p_nombre, ''))) = 0 then raise exception 'Escribe tu nombre.'; end if;
  update personas set nombre = trim(p_nombre), telefono = nullif(trim(coalesce(p_telefono, '')), '') where id = auth.uid();
end $$;

-- Si gerencia cambia una tarea, se actualiza lo pendiente de hoy en adelante.
create or replace function public._sync_plantilla() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.actualizado_en := now();
  if old.activa and not new.activa then
    -- pausada: se quita lo pendiente de hoy en adelante (lo atrasado sigue debiéndose)
    delete from asignaciones where plantilla_id = new.id and estado = 'pendiente' and fecha >= public.hoy();
  else
    update asignaciones set titulo = new.titulo, detalle = new.detalle, minutos = new.minutos, registro = new.registro, equipos = new.equipos
    where plantilla_id = new.id and estado = 'pendiente' and fecha >= public.hoy() and momento < 50;
  end if;
  return new;
end $$;
drop trigger if exists plantillas_sync on public.plantillas;
create trigger plantillas_sync before update on public.plantillas
  for each row execute function public._sync_plantilla();

-- ¿Estaba fuera (marcó «Salí a despachar») en ese momento?
create or replace function public._fuera_en(p_persona uuid, p_ts timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from salidas_rato s where s.persona_id = p_persona and s.salio <= p_ts and (s.volvio is null or s.volvio > p_ts))
$$;

-- Inicio de la ventana de una tarea de hoy, como momento exacto
create or replace function public._ts_hoy(t time) returns timestamptz
language sql stable as $$ select (public.hoy() + t)::timestamp at time zone 'America/Caracas' $$;

-- ¿Ya es urgente? Tareas de hoy con «desde» y «antes de», pendientes: a mitad de la ventana cualquiera del local la puede hacer.
-- Si quien la tiene marcó que estaba fuera al empezar la ventana (y el botón está activo), es urgente desde el inicio.
create or replace function public._urgente(a public.asignaciones) returns boolean
language sql stable security definer set search_path = public as $$
  select a.estado = 'pendiente' and a.fecha = public.hoy() and a.desde is not null and a.antes is not null and a.antes > a.desde
    and a.asignado_a is not null
    and (
      now() >= public._ts_hoy(a.desde) + (a.antes - a.desde) / 2
      or ((select usar_salidas from tareas_ajustes where id = 1) and now() >= public._ts_hoy(a.desde) and public._fuera_en(a.asignado_a, public._ts_hoy(a.desde)))
    )
$$;

-- ¿Tiene excusa quien la tenía? Sin el botón activo no se puede saber, así que no se marca incumplida.
create or replace function public._excusado(a public.asignaciones) returns boolean
language sql stable security definer set search_path = public as $$
  select not (select usar_salidas from tareas_ajustes where id = 1)
    or public._fuera_en(a.asignado_a, public._ts_hoy(a.desde))
    or not exists (select 1 from asistencia s where s.persona_id = a.asignado_a and s.fecha = a.fecha and s.estado = 'presente' and s.salida is null)
$$;

-- Empleado: «Salí a despachar» (p_fuera = true) / «Volví» (false)
create or replace function public.marcar_fuera(p_fuera boolean) returns json
language plpgsql security definer set search_path = public as $$
declare abierta public.salidas_rato;
begin
  if not (select usar_salidas from tareas_ajustes where id = 1) then raise exception 'Esa opción está apagada.'; end if;
  if not exists (select 1 from asistencia where persona_id = auth.uid() and fecha = public.hoy() and estado = 'presente') then
    raise exception 'Primero marca «Llegué».';
  end if;
  select * into abierta from salidas_rato where persona_id = auth.uid() and fecha = public.hoy() and volvio is null order by salio desc limit 1;
  if p_fuera then
    if abierta.id is null then insert into salidas_rato (persona_id, fecha) values (auth.uid(), public.hoy()); end if;
  else
    if abierta.id is not null then update salidas_rato set volvio = now() where id = abierta.id; end if;
  end if;
  return json_build_object('fuera', p_fuera);
end $$;

-- Empleado: «La hago yo» en una tarea urgente de otra persona del mismo local.
create or replace function public.rescatar(p_id uuid) returns json
language plpgsql security definer set search_path = public as $$
declare a public.asignaciones; pe public.personas; p public.plantillas; inc boolean;
begin
  select * into a from asignaciones where id = p_id for update;
  if a.id is null then raise exception 'Esa tarea ya no existe.'; end if;
  if a.asignado_a = auth.uid() then raise exception 'Esa tarea ya es tuya.'; end if;
  if not public._urgente(a) then raise exception 'Alguien ya la tomó.'; end if;
  select * into pe from personas where id = auth.uid();
  if a.local_id is distinct from pe.local_id then raise exception 'Esa tarea es de otro local.'; end if;
  if not exists (select 1 from asistencia where persona_id = auth.uid() and fecha = public.hoy() and estado = 'presente' and salida is null) then
    raise exception 'Primero marca «Llegué».';
  end if;
  select * into p from plantillas where id = a.plantilla_id;
  if p.id is not null and not (
        (cardinality(p.solo_pueden) = 0 or pe.id = any (p.solo_pueden))
    and (cardinality(p.solo_pueden) > 0 or cardinality(p.grupos) = 0 or pe.grupos && p.grupos)) then
    raise exception 'Esa tarea solo la pueden hacer otras personas.';
  end if;
  inc := not public._excusado(a);
  update asignaciones set asignado_a = auth.uid(), rescatada_de = a.asignado_a, incumplida = inc, motivo = 'rescate' where id = p_id;
  insert into tareas_eventos (asignacion_id, tipo, de, a, texto) values (p_id, 'reasignada', a.asignado_a, auth.uid(), case when inc then 'rescate' else 'rescate_excusa' end);
  return json_build_object('incumplida', inc);
end $$;

-- Puntualidad de una persona en el mes en curso: días que contaban y días que llegó a tiempo.
-- Cuenta cada día que trabajaba (hoy solo si ya marcó). Un día que faltó también rompe el «todos a tiempo».
create or replace function public._puntualidad(p_persona uuid) returns json
language sql stable security definer set search_path = public as $$
  with pe as (select * from personas where id = p_persona),
  dias as (
    select d::date as f from pe, generate_series(greatest(date_trunc('month', public.hoy())::date, (pe.creado_en at time zone 'America/Caracas')::date),
                                                  public.hoy(), interval '1 day') d
  ),
  x as (
    select d.f, s.estado, s.llegada,
      case when d.f = public.hoy() then coalesce(s.estado = 'presente', false)
           else s.persona_id is not null or public._trabaja(pe, d.f) end as cuenta
    from dias d cross join pe left join asistencia s on s.persona_id = p_persona and s.fecha = d.f
    where not exists (select 1 from dias_sin_puntualidad n where n.fecha = d.f)
  )
  select json_build_object('dias', count(*) filter (where cuenta),
    'a_tiempo', count(*) filter (where cuenta and estado = 'presente'
       and date_trunc('minute', (llegada at time zone 'America/Caracas')::time) <= (select a_tiempo_hasta from tareas_ajustes where id = 1)))
  from x
$$;

-- La propia puntualidad (cada quien solo la suya)
-- Si gerencia no la muestra todavía, al empleado no le llega (null).
create or replace function public.mi_puntualidad() returns json
language sql stable security definer set search_path = public as $$
  select case when public.es_admin() or (select mostrar_record from tareas_ajustes where id = 1) then public._puntualidad(auth.uid()) end
$$;

-- Todo lo que necesita la app en UNA sola consulta (más rápido con internet lento).
-- Corre con los permisos de quien la llama: cada quien recibe solo lo que puede ver.
-- p_completo = false: hoy, lo pendiente y lo hecho hoy (pantalla Hoy y Mi día).
-- p_completo = true:  además los últimos 35 días (Reporte de otros días e Historial).
-- Gerencia: quién tiene los avisos activos en al menos un teléfono (para ver a quién se le apagaron)
create or replace function public._con_avisos() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_admin() then return '[]'::json; end if;
  return (select coalesce(json_agg(distinct s.persona_id), '[]'::json) from suscripciones s);
end $$;

-- Con quién hace cada quien sus tareas de varias personas: {asignacion_id: "María, Luis"}.
-- security definer porque un empleado no ve las filas ni los nombres de los demás.
create or replace function public._companeros(p_fecha date) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_object_agg(a.id, c.nombres), '{}'::json)
  from asignaciones a
  join lateral (select string_agg(coalesce(nullif(pe.nombre, ''), pe.email), ', ' order by b.puesto) as nombres
                from asignaciones b join personas pe on pe.id = b.asignado_a
                where b.plantilla_id = a.plantilla_id and b.fecha = a.fecha and b.momento = a.momento and b.puesto <> a.puesto) c on c.nombres is not null
  where a.fecha >= p_fecha - 7 and a.plantilla_id is not null and (a.asignado_a = auth.uid() or public.es_admin())
$$;

create or replace function public.datos_app(p_completo boolean default false) returns json
language plpgsql security invoker set search_path = public as $$
declare
  hoy date := public.hoy();
  v_desde date := case when p_completo then public.hoy() - 35 else public.hoy() end;
  inicio timestamptz := (public.hoy()::timestamp at time zone 'America/Caracas');
begin
  perform public.generar_dia(hoy);
  perform public.repartir_faltas();
  perform public.asignar_revisiones();
  return json_build_object(
    'hoy', hoy,
    'completo', p_completo,
    'mi_mes', public.mi_puntualidad(),
    'companeros', public._companeros(hoy),
    'redes_nuevas', (select coalesce(json_agg(json_build_object('id', r.id, 'ip', r.ip, 'persona_id', r.persona_id, 'creado_en', r.creado_en) order by r.creado_en desc), '[]'::json)
                     from redes_nuevas r where r.fecha >= hoy - 3),
    'con_avisos', public._con_avisos(),
    'personas', (select coalesce(json_agg(x order by x.nombre), '[]'::json) from personas x),
    'ajustes', (select row_to_json(x) from tareas_ajustes x where x.id = 1),
    'plantillas', (select coalesce(json_agg(x order by x.titulo), '[]'::json) from plantillas x),
    'asignaciones', (select coalesce(json_agg(x order by x.fecha, x.id), '[]'::json) from asignaciones x
                     where x.fecha >= v_desde or (x.estado = 'pendiente' and (x.arrastra or x.oculta)) or x.hecha_en >= inicio),
    'asistencia', (select coalesce(json_agg(x), '[]'::json) from asistencia x where x.fecha >= v_desde),
    'locales', (select coalesce(json_agg(x order by x.principal desc, x.creado_en), '[]'::json) from locales x),
    'grupos', (select coalesce(json_agg(x order by x.nombre), '[]'::json) from grupos x),
    'dias_especiales', (select coalesce(json_agg(x order by x.fecha), '[]'::json) from dias_especiales x where x.fecha >= hoy - 400),
    'revisiones', (select coalesce(json_agg(x), '[]'::json) from revisiones x where x.fecha >= v_desde),
    'dias_sin_puntualidad', (select coalesce(json_agg(x order by x.fecha), '[]'::json) from dias_sin_puntualidad x where x.fecha >= hoy - 70),
    'equipos', (select coalesce(json_agg(x order by x.orden, x.nombre), '[]'::json) from equipos x),
    'salidas_rato', (select coalesce(json_agg(x order by x.salio), '[]'::json) from salidas_rato x where x.fecha >= v_desde),
    'lecturas', (select coalesce(json_agg(x order by x.registrado_en), '[]'::json) from lecturas x where x.fecha >= v_desde)
  );
end $$;

-- =====================================================================
--  Avisos en el teléfono (notificaciones push)
--  Una función de Supabase («avisos», ver supabase/functions/avisos) corre cada minuto,
--  llama a avisos_pendientes() y los manda a los teléfonos suscritos.
-- =====================================================================
create table if not exists public.suscripciones (
  id         uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  creado_en  timestamptz not null default now()
);
create table if not exists public.avisos_enviados (
  clave      text primary key,
  enviado_en timestamptz not null default now()
);
-- Avisos sueltos (por ejemplo, el de prueba)
create table if not exists public.avisos_cola (
  id         uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas (id) on delete cascade,
  titulo     text not null,
  cuerpo     text not null default '',
  creado_en  timestamptz not null default now()
);
alter table public.avisos_cola add column if not exists url text not null default './#/';

-- El teléfono guarda su suscripción (cada quien solo la suya)
create or replace function public.guardar_suscripcion(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Inicia sesión.'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then raise exception 'Esa suscripción no es válida.'; end if;
  insert into suscripciones (persona_id, endpoint, p256dh, auth) values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set persona_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, creado_en = now();
end $$;

create or replace function public.borrar_suscripcion(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from suscripciones where endpoint = p_endpoint and (persona_id = auth.uid() or public.es_admin())
$$;

-- Gerencia: mandarse un aviso de prueba (sale en el próximo minuto)
create or replace function public.aviso_prueba() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'Solo gerencia.'; end if;
  if not exists (select 1 from suscripciones where persona_id = auth.uid()) then raise exception 'Primero activa los avisos en este teléfono.'; end if;
  insert into avisos_cola (persona_id, titulo, cuerpo) values (auth.uid(), 'Aviso de prueba', 'Si ves esto, los avisos funcionan.');
end $$;

-- =====================================================================
--  Reparto automático de lo de quien falta (a la hora límite, una vez al día por local)
--  1) Primero a quienes llegaron tarde, empezando por quien llegó de último, mientras no pasen
--     30 de carga (minutos al 100 %) por encima del promedio de los presentes.
--  2) Lo demás, equitativo: a quien tenga menos carga (si empatan, a quien llegó más tarde).
--  3) Si ninguno de los presentes puede hacerla, se asigna igual a quien tenga menos carga, pero
--     oculta: el empleado no la ve hasta que gerencia la apruebe, y gerencia recibe un aviso.
--  Igual que repartoAutomatico() en logic.js.
-- =====================================================================
create table if not exists public.repartos_auto (
  fecha    date not null,
  local_id uuid not null references public.locales (id) on delete cascade,
  hecho_en timestamptz not null default now(),
  primary key (fecha, local_id)
);
alter table public.repartos_auto enable row level security;
revoke all on public.repartos_auto from anon, authenticated;

create or replace function public._repartir_local(p_local uuid, p_con_faltas boolean) returns int
language plpgsql security definer set search_path = public as $$
declare aj public.tareas_ajustes; f date := public.hoy(); it record; n int := 0; nocultas int := 0;
  quien uuid; oc boolean; prom numeric; grupo text; asignados jsonb; ocultos jsonb;
begin
  select * into aj from tareas_ajustes where id = 1;
  perform pg_advisory_xact_lock(hashtext('repartir:' || p_local::text || ':' || f::text));
  create temp table if not exists _pres (id uuid primary key, nombre text, carga numeric, cap int, tarea_max int, grupos uuid[], rota boolean,
                                         llegada timestamptz, tarde boolean) on commit drop;
  delete from _pres where true;
  create temp table if not exists _ok (id uuid) on commit drop;
  insert into _pres
  select pe.id, coalesce(pe.nombre, ''), 
         coalesce((select sum(a.minutos) from asignaciones a where a.asignado_a = pe.id and (a.fecha = f or (a.arrastra and a.estado = 'pendiente' and a.fecha < f and a.just_estado = 'aprobada'))), 0)
           * 100.0 / greatest(least(pe.capacidad, 100), 10),
         greatest(least(pe.capacidad, 100), 10), pe.tarea_max, pe.grupos, pe.rota, s.llegada,
         date_trunc('minute', s.llegada at time zone 'America/Caracas')::time > aj.a_tiempo_hasta
  from personas pe join asistencia s on s.persona_id = pe.id and s.fecha = f and s.estado = 'presente' and s.salida is null
  where pe.activo and pe.rol = 'empleado' and 'tareas' = any (pe.accesos) and pe.local_id = p_local;
  asignados := '{}'; ocultos := '{}';
  for it in
    select a.*, (select count(*) from _pres x where public._puede(a.plantilla_id, x.id)) as pueden
    from asignaciones a join personas pf on pf.id = a.asignado_a
    where a.estado = 'pendiente' and not a.oculta and (a.fecha = f or (a.fecha < f and a.arrastra))
      and pf.activo and pf.rol = 'empleado' and pf.local_id = p_local and public._trabaja(pf, f)
      -- faltó (si ya pasó la hora límite) o se fue antes («Me voy antes»): se trata igual
      and ((p_con_faltas and not exists (select 1 from asistencia s where s.persona_id = pf.id and s.fecha = f and s.estado = 'presente'))
           or exists (select 1 from asistencia s where s.persona_id = pf.id and s.fecha = f and s.estado = 'presente' and s.salida is not null))
    order by pueden, a.minutos desc, a.id
  loop
    grupo := coalesce(it.plantilla_id::text, it.id::text) || '|' || it.fecha || '|' || it.puesto;
    quien := (asignados->>grupo)::uuid; oc := false;
    if quien is null then
      prom := (select avg(carga) from _pres);
      -- quienes pueden, sin el compañero que ya tiene otro puesto de esta misma tarea; si a alguno le cabe en su tope, solo esos
      delete from _ok where true;
      insert into _ok select x.id from _pres x where public._puede(it.plantilla_id, x.id)
        and not exists (select 1 from asignaciones b where b.plantilla_id = it.plantilla_id and b.fecha = it.fecha and b.momento = it.momento and b.asignado_a = x.id);
      if exists (select 1 from _ok o join _pres x on x.id = o.id where x.tarea_max is null or it.minutos <= x.tarea_max) then
        delete from _ok o using _pres x where x.id = o.id and not (x.tarea_max is null or it.minutos <= x.tarea_max);
      end if;
      select x.id into quien from _ok o join _pres x on x.id = o.id
        where x.tarde and x.carga + it.minutos * 100.0 / x.cap <= prom + 30
        order by x.llegada desc, x.id limit 1;
      if quien is null then
        select x.id into quien from _ok o join _pres x on x.id = o.id order by x.carga, x.llegada desc, x.nombre, x.id limit 1;
      end if;
      if quien is null then
        select x.id into quien from _pres x order by x.carga, x.llegada desc, x.nombre, x.id limit 1;
        oc := quien is not null;
      end if;
      if quien is not null then asignados := asignados || jsonb_build_object(grupo, quien); ocultos := ocultos || jsonb_build_object(grupo, oc); end if;
    else
      oc := coalesce((ocultos->>grupo)::boolean, false);  -- las varias veces del día de una tarea van juntas
    end if;
    continue when quien is null;
    update asignaciones set asignado_a = quien, motivo = 'ausencia', oculta = oc where id = it.id;
    insert into tareas_eventos (asignacion_id, tipo, de, a, texto) values (it.id, 'reasignada', it.asignado_a, quien, 'ausencia');
    update _pres set carga = carga + it.minutos * 100.0 / cap where id = quien;
    n := n + 1;
    if oc then nocultas := nocultas + 1; end if;
  end loop;
  if nocultas > 0 then
    insert into avisos_cola (persona_id, titulo, cuerpo, url)
    select ad.id, nocultas || case when nocultas = 1 then ' tarea necesita tu aprobación' else ' tareas necesitan tu aprobación' end,
           'Nadie de los presentes podía hacerla. La asigné a quien tiene menos carga, pero no la ve hasta que la apruebes en Hoy.', './#/'
    from personas ad where ad.activo and ad.rol = 'admin';
    nocultas := 0;
  end if;
  return n;
end $$;

create or replace function public.repartir_faltas() returns int
language plpgsql security definer set search_path = public as $$
declare aj public.tareas_ajustes; f date := public.hoy(); lo record; n int := 0;
begin
  select * into aj from tareas_ajustes where id = 1;
  if now() < public._ts_hoy(aj.hora_limite) then return 0; end if;
  perform pg_advisory_xact_lock(hashtext('repartir_faltas:' || f::text));
  for lo in select l.id from locales l where not exists (select 1 from repartos_auto r where r.fecha = f and r.local_id = l.id) loop
    insert into repartos_auto (fecha, local_id) values (f, lo.id);
    n := n + public._repartir_local(lo.id, true);
  end loop;
  return n;
end $$;

-- ¿Puede esta persona hacer esta tarea? (solo_pueden, grupos y «fuera de la rotación»). Igual que puedeSegun() en logic.js.
create or replace function public._puede(p_plantilla uuid, p_persona uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when cardinality(p.solo_pueden) > 0 then pe.id = any (p.solo_pueden)
                when cardinality(p.grupos) > 0 then pe.grupos && p.grupos
                else pe.rota end
    from plantillas p, personas pe where p.id = p_plantilla and pe.id = p_persona), true)
$$;

-- Gerencia reprograma una tarea oculta: vuelve a su dueño original en otro día
create or replace function public.reprogramar_oculta(p_id uuid, p_fecha date) returns void
language plpgsql security definer set search_path = public as $$
declare a public.asignaciones; quien uuid;
begin
  if not public.es_admin() then raise exception 'Solo gerencia.'; end if;
  select * into a from asignaciones where id = p_id for update;
  if a.id is null then raise exception 'Esa tarea ya no existe.'; end if;
  if p_fecha is null or p_fecha <= public.hoy() then raise exception 'Elige un día a partir de mañana.'; end if;
  if a.plantilla_id is not null and exists (select 1 from asignaciones b where b.plantilla_id = a.plantilla_id and b.fecha = p_fecha
                                            and b.momento = a.momento and b.puesto = a.puesto and b.id <> a.id) then
    raise exception 'Esa tarea ya está programada ese día. Elige otro.';
  end if;
  quien := coalesce(a.asignado_original, a.asignado_a);
  update asignaciones set fecha = p_fecha, asignado_a = quien, oculta = false, motivo = 'manual' where id = p_id;
  insert into tareas_eventos (asignacion_id, tipo, de, a, texto) values (p_id, 'reasignada', a.asignado_a, quien, 'reprogramada para ' || to_char(p_fecha, 'DD/MM'));
end $$;

-- Gerencia aprueba una tarea oculta (y puede cambiar a quién va)
create or replace function public.aprobar_oculta(p_id uuid, p_persona uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare a public.asignaciones;
begin
  if not public.es_admin() then raise exception 'Solo gerencia.'; end if;
  select * into a from asignaciones where id = p_id;
  if a.id is null then raise exception 'Esa tarea ya no existe.'; end if;
  -- si es de un día anterior, queda como atrasada para que aparezca en su lista
  update asignaciones set oculta = false, asignado_a = coalesce(p_persona, asignado_a), arrastra = arrastra or fecha < public.hoy() where id = p_id;
  if p_persona is not null and p_persona is distinct from a.asignado_a then
    insert into tareas_eventos (asignacion_id, tipo, de, a, texto) values (p_id, 'reasignada', a.asignado_a, p_persona, 'ausencia');
  end if;
end $$;

-- Gerencia agrega a una persona desde la app (sin entrar a Supabase). Queda confirmada y puede entrar de una vez
-- con el correo y la clave que gerencia le dé en persona.
create or replace function public.crear_persona(p_email text, p_clave text, p_nombre text, p_local uuid, p_accesos text[], p_rol text default 'empleado')
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := gen_random_uuid(); correo text := lower(trim(coalesce(p_email, '')));
begin
  if not public.es_admin() then raise exception 'Solo gerencia.'; end if;
  if correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Ese correo no es válido.'; end if;
  if length(coalesce(p_clave, '')) < 8 then raise exception 'La clave debe tener al menos 8 caracteres.'; end if;
  if trim(coalesce(p_nombre, '')) = '' then raise exception 'Escribe el nombre.'; end if;
  if p_rol not in ('admin', 'empleado') then raise exception 'Rol no válido.'; end if;
  if exists (select 1 from auth.users where lower(email) = correo) then raise exception 'Ya hay una persona con ese correo.'; end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', correo, crypt(p_clave, gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text, 'email', jsonb_build_object('sub', uid::text, 'email', correo, 'email_verified', true), now(), now(), now());
  -- el trigger personas_desde_auth ya creó su fila; se completa
  update personas set nombre = trim(p_nombre), rol = p_rol, local_id = coalesce(p_local, public._local_principal()),
                      accesos = coalesce(p_accesos, '{}') where id = uid;
  return uid;
end $$;

-- Menú de CIL: cuántas cosas esperan por esta persona en cada módulo (un número por módulo, sin detalle).
create or replace function public.menu_pendientes() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare yo public.personas; r jsonb := '{}'; n int; rol_c text;
begin
  select * into yo from personas where id = auth.uid() and activo;
  if not found then return r; end if;
  if yo.rol = 'admin' or 'tareas' = any (yo.accesos) then
    if yo.rol = 'admin' then
      -- tareas de hoy que ya pasaron su hora sin hacerse
      select count(*) into n from asignaciones a where a.fecha = public.hoy() and a.estado = 'pendiente'
        and a.antes is not null and public._ts_hoy(a.antes) < now();
    else
      select count(*) into n from asignaciones a where a.fecha = public.hoy() and a.estado = 'pendiente' and a.asignado_a = yo.id;
    end if;
    r := r || jsonb_build_object('tareas', n);
  end if;
  if (yo.rol = 'admin' or 'contenido' = any (yo.accesos)) and to_regclass('public.piezas') is not null and to_regclass('public.equipo') is not null then
    execute 'select rol from public.equipo where user_id = $1' into rol_c using yo.id;
    if rol_c is not null then
      execute 'select count(*) from public.piezas where fase = ''produccion'' and turno = $1' into n using rol_c;
      r := r || jsonb_build_object('contenido', n);
    end if;
  end if;
  return r;
end $$;

-- Al desactivar a alguien: se cierran sus sesiones en todos los teléfonos y deja de recibir avisos.
create or replace function public._al_desactivar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.activo and not new.activo then
    delete from suscripciones where persona_id = new.id;
    if to_regclass('auth.sessions') is not null then execute 'delete from auth.sessions where user_id = $1' using new.id; end if;
    if to_regclass('auth.refresh_tokens') is not null then execute 'delete from auth.refresh_tokens where user_id = $1::text' using new.id; end if;
  end if;
  return new;
end $$;
drop trigger if exists personas_al_desactivar on public.personas;
create trigger personas_al_desactivar after update of activo on public.personas for each row execute function public._al_desactivar();

-- Gerencia cambia la clave de un empleado (sin correo: se la dice en persona).
create extension if not exists pgcrypto with schema extensions;
create or replace function public.cambiar_clave(p_persona uuid, p_clave text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.es_admin() then raise exception 'Solo gerencia.'; end if;
  if length(coalesce(p_clave, '')) < 8 then raise exception 'La clave debe tener al menos 8 caracteres.'; end if;
  if p_persona <> auth.uid() and exists (select 1 from personas where id = p_persona and rol = 'admin') then
    raise exception 'No puedes cambiar la clave de otra persona de gerencia.';
  end if;
  update auth.users set encrypted_password = crypt(p_clave, gen_salt('bf')), updated_at = now() where id = p_persona;
  if not found then raise exception 'Esa persona no existe.'; end if;
end $$;

-- Lo que hay que avisar ahora. Cada aviso sale una sola vez (avisos_enviados) y solo si su hora fue hace menos de 10 minutos.
-- Solo la puede llamar la función del servidor (rol service_role).
create or replace function public.avisos_pendientes() returns table (persona_id uuid, endpoint text, p256dh text, auth text, titulo text, cuerpo text, url text)
language plpgsql security definer set search_path = public as $$
declare aj public.tareas_ajustes; ahora timestamptz := now(); hoy date := public.hoy(); hace timestamptz := now() - interval '10 minutes';
begin
  select * into aj from tareas_ajustes where id = 1;
  perform public.repartir_faltas();
  create temp table if not exists _avisos (persona_id uuid, clave text, titulo text, cuerpo text, url text) on commit drop;
  delete from _avisos where true;

  -- 1) Te toca ahora: tareas con «desde», para quien la tiene
  insert into _avisos
  select a.asignado_a, 'desde:' || a.id, 'Te toca: ' || a.titulo || coalesce(' · ' || a.momento_nombre, ''),
         case when a.antes is not null then 'Antes de las ' || public._hora_txt(a.antes) else 'Ya la puedes marcar.' end, './#/'
  from asignaciones a
  where a.fecha = hoy and a.estado = 'pendiente' and a.asignado_a is not null and a.desde is not null
    and public._ts_hoy(a.desde) <= ahora and public._ts_hoy(a.desde) > hace;

  -- 2) Urgente: a mitad de la ventana, a quien la tiene y a todos los presentes de su local
  insert into _avisos
  select pe.id, 'urg:' || a.id || ':' || pe.id,
         case when pe.id = a.asignado_a then 'Se te está pasando: ' || a.titulo else 'Urgente: ' || a.titulo end,
         case when pe.id = a.asignado_a then 'Si no la haces ya, la puede hacer otra persona.' else 'Se está pasando la hora. Si puedes, tócala y «La hago yo».' end, './#/'
  from asignaciones a
  join personas pe on pe.local_id = a.local_id and pe.activo and pe.rol = 'empleado' and 'tareas' = any (pe.accesos)
  where a.fecha = hoy and a.estado = 'pendiente' and a.asignado_a is not null and a.desde is not null and a.antes is not null and a.antes > a.desde
    and public._ts_hoy(a.desde) + (a.antes - a.desde) / 2 <= ahora and public._ts_hoy(a.desde) + (a.antes - a.desde) / 2 > hace
    and exists (select 1 from asistencia s where s.persona_id = pe.id and s.fecha = hoy and s.estado = 'presente' and s.salida is null)
    and (pe.id = a.asignado_a or not public._fuera_en(pe.id, ahora));

  -- 3) ¿Ya llegaste? A la hora de entrada (5 min antes de «a tiempo hasta»), a quien trabaja hoy y no ha marcado
  insert into _avisos
  select pe.id, 'llegada:' || hoy || ':' || pe.id, '¿Ya llegaste?', 'Marca «Llegué» en la app.', './#/'
  from personas pe
  where pe.activo and pe.rol = 'empleado' and 'tareas' = any (pe.accesos) and public._trabaja(pe, hoy)
    and public._ts_hoy(aj.a_tiempo_hasta - interval '5 minutes') <= ahora and public._ts_hoy(aj.a_tiempo_hasta - interval '5 minutes') > hace
    and not exists (select 1 from asistencia s where s.persona_id = pe.id and s.fecha = hoy);

  -- 4) Gerencia: un solo resumen de asistencia a las 9:30 a. m., y solo si alguien faltó o llegó tarde
  --    (las temperaturas fuera de rango y las salidas antes de hora siguen avisando al momento)
  insert into _avisos
  select ad.id, 'resumen:' || hoy || ':' || ad.id,
         'Asistencia de hoy: ' || concat_ws(' · ', case when f.nf > 0 then f.nf || case when f.nf = 1 then ' falta' else ' faltas' end end,
                                                 case when f.nt > 0 then f.nt || ' tarde' end),
         concat_ws('. ', case when f.nf > 0 then 'Faltan: ' || f.faltan end, case when f.nt > 0 then 'Tarde: ' || f.tarde end) || '.', './#/'
  from personas ad,
       (select count(*) filter (where s.persona_id is null) as nf,
               string_agg(coalesce(nullif(pe.nombre, ''), pe.email), ', ' order by pe.nombre) filter (where s.persona_id is null) as faltan,
               count(*) filter (where s.estado = 'presente' and date_trunc('minute', s.llegada at time zone 'America/Caracas')::time > aj.a_tiempo_hasta) as nt,
               string_agg(coalesce(nullif(pe.nombre, ''), pe.email) || ' ' || to_char(s.llegada at time zone 'America/Caracas', 'HH12:MI'), ', ' order by s.llegada)
                 filter (where s.estado = 'presente' and date_trunc('minute', s.llegada at time zone 'America/Caracas')::time > aj.a_tiempo_hasta) as tarde
        from personas pe left join asistencia s on s.persona_id = pe.id and s.fecha = hoy
        where pe.activo and pe.rol = 'empleado' and 'tareas' = any (pe.accesos) and public._trabaja(pe, hoy)) f
  where ad.activo and ad.rol = 'admin' and (f.nf > 0 or f.nt > 0)
    and public._ts_hoy(time '09:30') <= ahora and public._ts_hoy(time '09:30') > hace;

  -- 4b) Gerencia: cierre a las 5:10 p. m., solo si quedan tareas de hoy sin hacer
  insert into _avisos
  select ad.id, 'cierre:' || hoy || ':' || ad.id,
         c.n || case when c.n = 1 then ' tarea sin hacer hoy' else ' tareas sin hacer hoy' end, c.detalle || '.', './#/'
  from personas ad,
       (select coalesce(sum(x.k), 0)::int as n, string_agg(x.quien || ' ' || x.k, ', ' order by x.k desc, x.quien) as detalle
        from (select coalesce(nullif(pe.nombre, ''), pe.email, 'Sin asignar') as quien, count(*) as k
              from asignaciones a left join personas pe on pe.id = a.asignado_a
              where a.fecha = hoy and a.estado = 'pendiente' and not a.oculta
              group by 1) x) c
  where ad.activo and ad.rol = 'admin' and c.n > 0
    and public._ts_hoy(time '17:10') <= ahora and public._ts_hoy(time '17:10') > hace;

  -- 4c) Gerencia: resumen de la semana anterior, los lunes a las 9:00 a. m.
  if extract(isodow from hoy) = 1 and public._ts_hoy(time '09:00') <= ahora and public._ts_hoy(time '09:00') > hace then
    insert into _avisos
    select ad.id, 'semana:' || hoy || ':' || ad.id, 'Semana pasada: ' || coalesce(w.pct, 0) || ' % de tareas hechas',
           w.tardes || case when w.tardes = 1 then ' llegada tarde' else ' llegadas tarde' end || ' · ' ||
           w.faltas || case when w.faltas = 1 then ' falta' else ' faltas' end || '. Detalle en Reporte → Historial.', './#/historial'
    from personas ad,
         (select (select round(100.0 * count(*) filter (where a.estado = 'hecha') / nullif(count(*), 0))::int
                  from asignaciones a where a.fecha between hoy - 7 and hoy - 1 and not a.oculta) as pct,
                 (select count(*) from asistencia s where s.fecha between hoy - 7 and hoy - 1 and s.estado = 'presente'
                    and date_trunc('minute', s.llegada at time zone 'America/Caracas')::time > aj.a_tiempo_hasta
                    and not exists (select 1 from dias_sin_puntualidad d where d.fecha = s.fecha)) as tardes,
                 (select count(*) from personas pe, generate_series(hoy - 7, hoy - 1, interval '1 day') g(d)
                    where pe.activo and pe.rol = 'empleado' and 'tareas' = any (pe.accesos) and public._trabaja(pe, g.d::date)
                      and pe.creado_en::date <= g.d::date
                      and not exists (select 1 from asistencia s where s.persona_id = pe.id and s.fecha = g.d::date and s.estado = 'presente')) as faltas) w
    where ad.activo and ad.rol = 'admin';
  end if;

  -- 5) Gerencia: temperatura fuera de rango
  insert into _avisos
  select ad.id, 'temp:' || l.id || ':' || ad.id, 'Temperatura fuera de rango: ' || e.nombre,
         coalesce(l.temperatura::text || ' °C', '') || coalesce(' (rango ' || e.temp_min || ' a ' || e.temp_max || ')', '') || coalesce('. «' || l.nota || '»', ''), './#/'
  from lecturas l join equipos e on e.id = l.equipo_id, personas ad
  where l.fuera_rango and l.registrado_en > hace and ad.activo and ad.rol = 'admin';

  -- 6) Gerencia: alguien se fue antes
  insert into _avisos
  select ad.id, 'salida:' || hoy || ':' || s.persona_id || ':' || ad.id, coalesce(nullif(pe.nombre, ''), pe.email) || ' se fue antes',
         coalesce('«' || s.salida_motivo || '». ', '') || 'Lo que dejó pendiente ya se repartió entre los presentes.', './#/'
  from asistencia s join personas pe on pe.id = s.persona_id, personas ad
  where s.fecha = hoy and s.salida is not null and s.salida > hace and ad.activo and ad.rol = 'admin';

  -- 7) Avisos sueltos (prueba)
  insert into _avisos select c.persona_id, 'cola:' || c.id, c.titulo, c.cuerpo, c.url from avisos_cola c where c.creado_en > now() - interval '1 day';
  delete from avisos_cola where creado_en <= now() - interval '1 day' or id::text in (select substr(clave, 6) from _avisos where clave like 'cola:%');

  -- Solo los que no se han mandado; se marcan como mandados y se devuelven con cada teléfono de esa persona
  return query
  with nuevos as (
    insert into avisos_enviados (clave) select v.clave from _avisos v on conflict (clave) do nothing returning avisos_enviados.clave
  )
  select v.persona_id, su.endpoint, su.p256dh, su.auth, v.titulo, v.cuerpo, v.url
  from _avisos v join nuevos n on n.clave = v.clave join suscripciones su on su.persona_id = v.persona_id;
  delete from avisos_enviados where enviado_en < now() - interval '3 days';
end $$;

-- =====================================================================
--  Seguridad (Row Level Security)
-- =====================================================================
alter table public.locales      enable row level security;
alter table public.grupos       enable row level security;
alter table public.dias_especiales enable row level security;
alter table public.revisiones   enable row level security;
alter table public.dias_sin_puntualidad enable row level security;
alter table public.equipos      enable row level security;
alter table public.salidas_rato enable row level security;
alter table public.suscripciones enable row level security;
alter table public.avisos_enviados enable row level security;
alter table public.avisos_cola  enable row level security;
alter table public.lecturas     enable row level security;
alter table public.personas     enable row level security;
alter table public.tareas_ajustes      enable row level security;
alter table public.plantillas   enable row level security;
alter table public.asignaciones enable row level security;
alter table public.asistencia   enable row level security;
alter table public.tareas_eventos      enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
           and tablename in ('locales','grupos','dias_especiales','dias_sin_puntualidad','equipos','lecturas','salidas_rato','suscripciones','avisos_enviados','avisos_cola','revisiones','personas','tareas_ajustes','plantillas','asignaciones','asistencia','tareas_eventos') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy locales_ver   on public.locales for select to authenticated using (true);
create policy grupos_ver    on public.grupos for select to authenticated using (true);
create policy especiales_ver   on public.dias_especiales for select to authenticated using (true);
create policy especiales_admin on public.dias_especiales for all to authenticated using (public.es_admin()) with check (public.es_admin());
create policy revisiones_admin on public.revisiones for select to authenticated using (public.es_admin());
create policy sinpunt_ver   on public.dias_sin_puntualidad for select to authenticated using (true);
create policy equipos_ver   on public.equipos for select to authenticated using (true);
create policy salidas_ver   on public.salidas_rato for select to authenticated using (persona_id = auth.uid() or public.es_admin());
create policy suscr_ver     on public.suscripciones for select to authenticated using (persona_id = auth.uid() or public.es_admin());
create policy equipos_admin on public.equipos for all to authenticated using (public.es_admin()) with check (public.es_admin());
-- Las lecturas solo las ve gerencia; se escriben con registrar_lecturas
create policy lecturas_ver  on public.lecturas for select to authenticated using (public.es_admin());
create policy lecturas_borrar_admin on public.lecturas for delete to authenticated using (public.es_admin());
create policy sinpunt_admin on public.dias_sin_puntualidad for all to authenticated using (public.es_admin()) with check (public.es_admin());
create policy grupos_admin  on public.grupos for all to authenticated using (public.es_admin()) with check (public.es_admin());
create policy locales_admin on public.locales for all to authenticated using (public.es_admin()) with check (public.es_admin());

create policy personas_ver    on public.personas for select to authenticated using (id = auth.uid() or public.es_admin());
create policy personas_admin  on public.personas for update to authenticated using (public.es_admin()) with check (public.es_admin());

create policy ajustes_ver     on public.tareas_ajustes for select to authenticated using (true);
create policy ajustes_admin   on public.tareas_ajustes for update to authenticated using (public.es_admin()) with check (public.es_admin());

create policy plantillas_admin on public.plantillas for all to authenticated using (public.es_admin()) with check (public.es_admin());

create policy asig_ver on public.asignaciones for select to authenticated using (
  public.es_admin()
  or (asignado_a = auth.uid() and not oculta)
  or hecha_por = auth.uid()
  or rescatada_de = auth.uid()
  or (local_id = (select local_id from public.personas where id = auth.uid()) and public._urgente(asignaciones))
  or (asignado_a is null and estado = 'pendiente' and (fecha = public.hoy() or (fecha < public.hoy() and arrastra))
      and (select pool_activo from public.tareas_ajustes where id = 1)
      and local_id = (select local_id from public.personas where id = auth.uid()))
);
create policy asig_borrar_admin on public.asignaciones for delete to authenticated using (public.es_admin());

create policy asistencia_ver on public.asistencia for select to authenticated using (persona_id = auth.uid() or public.es_admin());

create policy eventos_ver on public.tareas_eventos for select to authenticated using (public.es_admin());

-- Nadie entra sin sesión
revoke all on all tables in schema public from anon;
-- Supabase da permiso a «authenticated» sobre toda función nueva: se le quita a todas y se devuelve solo a las de la lista.
-- Sin esto, un empleado podría llamar funciones internas (por ejemplo _llegada) y saltarse las reglas.
revoke execute on all functions in schema public from anon, authenticated, public;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;
grant execute on function public.hoy(), public.es_admin(), public.tiene_acceso(text), public._urgente(public.asignaciones), public.generar_dia(date),
  public.marcar_llegada(double precision, double precision, double precision, timestamptz), public.mi_red(), public.registrar_red(uuid),
  public.sin_wifi_hoy(uuid, boolean), public.aceptar_red(uuid, uuid),
  public.marcar_hecha(uuid, boolean), public.tomar_del_pool(uuid), public.reasignar(jsonb, text),
  public.marcar_asistencia(uuid, text), public.mi_perfil(text, text),
  public.justificar(uuid, text), public.revisar_justificacion(uuid, boolean),
  public.asignar_revisiones(), public.calificar(uuid, int, text, boolean),
  public.marcar_salida(text), public.datos_app(boolean), public.mi_puntualidad(), public.registrar_lecturas(uuid, jsonb),
  public.marcar_fuera(boolean), public.rescatar(uuid),
  public.guardar_suscripcion(text, text, text), public.borrar_suscripcion(text), public.aviso_prueba(), public.cambiar_clave(uuid, text),
  public.crear_persona(text, text, text, uuid, text[], text), public.menu_pendientes(), public.aprobar_oculta(uuid, uuid), public.reprogramar_oculta(uuid, date),
  -- las llama datos_app, que corre con los permisos de quien entra
  public._companeros(date), public._con_avisos(), public.repartir_faltas() to authenticated;
-- Solo la función del servidor (avisos) puede pedir los avisos pendientes
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.avisos_pendientes() to service_role';
    execute 'grant select, delete on public.suscripciones to service_role';
  end if;
end $$;
-- Las funciones internas (_toca, _elegir_persona, _llegada, _hecha…) no se pueden llamar desde la app:
-- no están en la lista de arriba y se les quitó el permiso que Supabase da por defecto.

-- =====================================================================
--  Contenido: permisos por módulo
--  Antes, cualquiera con usuario podía ver y editar Contenido. Ahora solo gerencia
--  y quien tenga el acceso «contenido». Quien ya estaba en el equipo de Contenido
--  recibe ese acceso automáticamente, así que nadie pierde lo que tenía.
--  OJO: no vuelvas a ejecutar el supabase.sql viejo de Contenido: dejaría todo abierto otra vez.
-- =====================================================================
do $$
declare t text;
begin
  if to_regclass('public.equipo') is null then
    raise notice 'No hay tablas de Contenido en este proyecto: se salta esta parte.';
    return;
  end if;

  -- Quien ya estaba en el equipo de Contenido conserva su acceso
  update public.personas p set accesos = array_append(p.accesos, 'contenido')
  where p.id in (select user_id from public.equipo) and not ('contenido' = any (p.accesos));

  execute $p$drop policy if exists equipo_ver on public.equipo$p$;
  execute $p$create policy equipo_ver on public.equipo for select to authenticated using (public.tiene_acceso('contenido'))$p$;
  execute $p$drop policy if exists equipo_crear_propio on public.equipo$p$;
  execute $p$create policy equipo_crear_propio on public.equipo for insert to authenticated with check (user_id = auth.uid() and public.tiene_acceso('contenido'))$p$;
  execute $p$drop policy if exists equipo_editar_propio on public.equipo$p$;
  execute $p$create policy equipo_editar_propio on public.equipo for update to authenticated using (user_id = auth.uid() and public.tiene_acceso('contenido')) with check (user_id = auth.uid())$p$;

  foreach t in array array['ajustes', 'piezas', 'grabaciones'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists %I on public.%I', t || '_ver', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.tiene_acceso(''contenido''))', t || '_ver', t);
    execute format('drop policy if exists %I on public.%I', t || '_editar', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.tiene_acceso(''contenido'')) with check (public.tiene_acceso(''contenido''))', t || '_editar', t);
    if t <> 'ajustes' then
      execute format('drop policy if exists %I on public.%I', t || '_crear', t);
      execute format('create policy %I on public.%I for insert to authenticated with check (public.tiene_acceso(''contenido''))', t || '_crear', t);
    end if;
  end loop;

  if to_regclass('public.eventos') is not null then
    execute $p$drop policy if exists eventos_ver on public.eventos$p$;
    execute $p$create policy eventos_ver on public.eventos for select to authenticated using (public.tiene_acceso('contenido'))$p$;
    execute $p$drop policy if exists eventos_crear on public.eventos$p$;
    execute $p$create policy eventos_crear on public.eventos for insert to authenticated with check (autor = auth.uid() and public.tiene_acceso('contenido'))$p$;
  end if;
  if to_regclass('public.grabacion_eventos') is not null then
    execute $p$drop policy if exists grab_eventos_ver on public.grabacion_eventos$p$;
    execute $p$create policy grab_eventos_ver on public.grabacion_eventos for select to authenticated using (public.tiene_acceso('contenido'))$p$;
    execute $p$drop policy if exists grab_eventos_crear on public.grabacion_eventos$p$;
    execute $p$create policy grab_eventos_crear on public.grabacion_eventos for insert to authenticated with check (autor = auth.uid() and public.tiene_acceso('contenido'))$p$;
  end if;
  -- Papel en Contenido («aprueba» / «edita»): cada quien lo elegía en su perfil, así que quien edita podía
  -- ponerse «aprueba» y aprobarse su propio trabajo. Ahora «aprueba» solo lo pone gerencia.
  execute $f$create or replace function public._equipo_rol() returns trigger
    language plpgsql security definer set search_path = public as $b$
    begin
      if new.rol = 'aprueba' and (tg_op = 'INSERT' or old.rol is distinct from 'aprueba') and not public.es_admin() then
        raise exception 'Solo gerencia puede tener el papel «Apruebo». Elige «Edito y publico».';
      end if;
      return new;
    end $b$ $f$;
  execute 'drop trigger if exists equipo_rol on public.equipo';
  execute 'create trigger equipo_rol before insert or update of rol on public.equipo for each row execute function public._equipo_rol()';
  -- Avisos de Contenido: antes cualquier usuario podía reasignarse los teléfonos suscritos de otros
  -- (update «using (true)»). Ahora solo el equipo de Contenido toca esa tabla.
  if to_regclass('public.push_subs') is not null then
    execute $p$drop policy if exists push_editar on public.push_subs$p$;
    execute $p$create policy push_editar on public.push_subs for update to authenticated using (public.tiene_acceso('contenido')) with check (user_id = auth.uid() and public.tiene_acceso('contenido'))$p$;
    execute $p$drop policy if exists push_crear on public.push_subs$p$;
    execute $p$create policy push_crear on public.push_subs for insert to authenticated with check (user_id = auth.uid() and public.tiene_acceso('contenido'))$p$;
  end if;
end $$;

-- Listo. Siguiente paso de la guía: poner tu correo (y los de gerencia) como admin.
