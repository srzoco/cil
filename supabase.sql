-- =====================================================================
--  Contenido Barquero — base de datos (Supabase)
--  Pegar completo en: Supabase → SQL Editor → New query → Run
--  Se puede volver a ejecutar sin perder datos.
-- =====================================================================

-- ---------- Equipo (quién es quién) ----------
create table if not exists public.equipo (
  user_id    uuid primary key default auth.uid(),
  nombre     text not null check (length(trim(nombre)) > 0),
  rol        text not null check (rol in ('aprueba', 'edita')),
  telefono   text,
  creado_en  timestamptz not null default now()
);

-- ---------- Ajustes (cronograma y regla de días) ----------
create table if not exists public.ajustes (
  id              int primary key default 1 check (id = 1),
  cronograma      jsonb not null,
  dias_minimos    int not null default 3 check (dias_minimos between 0 and 30),
  actualizado_en  timestamptz not null default now()
);

insert into public.ajustes (id, cronograma, dias_minimos)
values (1, '{
  "ig": {"0": "reel", "1": "carrusel", "2": "reel", "3": "historias", "4": "reel", "5": "carrusel", "6": "descanso"},
  "tt": {"0": "cualquiera", "1": "cualquiera", "2": "cualquiera", "3": "cualquiera", "4": "cualquiera", "5": "cualquiera", "6": "cualquiera"}
}'::jsonb, 3)
on conflict (id) do nothing;

-- ---------- Piezas (cada reel o carrusel) ----------
create table if not exists public.piezas (
  id               uuid primary key default gen_random_uuid(),
  titulo           text not null check (length(trim(titulo)) > 0),
  tipo             text not null check (tipo in ('reel', 'carrusel')),
  ig               boolean not null default true,
  tt               boolean not null default false,
  producto         text,
  gancho           text,
  objetivo         text,
  fase             text not null default 'produccion'
                   check (fase in ('idea', 'produccion', 'aprobada', 'publicada', 'archivada')),
  etapa            text check (etapa in ('video', 'texto', 'diseno', 'copy')),
  turno            text check (turno in ('edita', 'aprueba')),
  version          int not null default 0 check (version >= 0),
  texto_carrusel   text,
  copy_ig          text,
  copy_tt          text,
  nota_version     text,
  enlace_version   text,
  primero          text check (primero in ('ig', 'tt')),
  fecha_ig         date,
  fecha_tt         date,
  en_espera        boolean not null default false,
  espera_producto  text,
  espera_desde     date,
  publicado_ig_en  timestamptz,
  publicado_tt_en  timestamptz,
  enlace_ig        text,
  enlace_tt        text,
  vistas_ig        int check (vistas_ig >= 0),
  vistas_tt        int check (vistas_tt >= 0),
  creado_por       uuid default auth.uid(),
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  constraint piezas_alguna_plataforma check (ig or tt),
  constraint piezas_produccion_completa check (fase <> 'produccion' or (etapa is not null and turno is not null))
);

create index if not exists piezas_fase_idx on public.piezas (fase);

-- ---------- Historial (comentarios, correcciones y aprobaciones) ----------
-- No se edita ni se borra: es el registro de todo lo que pasó con cada pieza.
create table if not exists public.eventos (
  id         uuid primary key default gen_random_uuid(),
  pieza_id   uuid not null references public.piezas (id) on delete cascade,
  autor      uuid not null default auth.uid(),
  tipo       text not null check (tipo in ('creada', 'idea', 'iniciada', 'editada', 'envio', 'aprobacion',
                                           'correccion', 'comentario', 'espera', 'llego', 'fechas',
                                           'publicado', 'vistas', 'archivada', 'reabierta')),
  etapa      text,
  version    int,
  texto      text,
  datos      jsonb not null default '{}'::jsonb,
  creado_en  timestamptz not null default now()
);

create index if not exists eventos_pieza_idx on public.eventos (pieza_id, creado_en);

-- ---------- Marca de "última actualización" ----------
create or replace function public.tocar_actualizado() returns trigger
language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end $$;

drop trigger if exists piezas_tocar on public.piezas;
create trigger piezas_tocar before update on public.piezas
  for each row execute function public.tocar_actualizado();

drop trigger if exists ajustes_tocar on public.ajustes;
create trigger ajustes_tocar before update on public.ajustes
  for each row execute function public.tocar_actualizado();

-- ---------- Seguridad: solo usuarias con sesión iniciada ----------
alter table public.equipo  enable row level security;
alter table public.ajustes enable row level security;
alter table public.piezas  enable row level security;
alter table public.eventos enable row level security;

revoke all on public.equipo, public.ajustes, public.piezas, public.eventos from anon, authenticated;
grant select, insert, update on public.equipo  to authenticated;
grant select, update         on public.ajustes to authenticated;
grant select, insert, update on public.piezas  to authenticated;
grant select, insert         on public.eventos to authenticated;

drop policy if exists equipo_ver on public.equipo;
create policy equipo_ver on public.equipo for select to authenticated using (true);
drop policy if exists equipo_crear_propio on public.equipo;
create policy equipo_crear_propio on public.equipo for insert to authenticated with check (user_id = auth.uid());
drop policy if exists equipo_editar_propio on public.equipo;
create policy equipo_editar_propio on public.equipo for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists ajustes_ver on public.ajustes;
create policy ajustes_ver on public.ajustes for select to authenticated using (true);
drop policy if exists ajustes_editar on public.ajustes;
create policy ajustes_editar on public.ajustes for update to authenticated using (true) with check (true);

drop policy if exists piezas_ver on public.piezas;
create policy piezas_ver on public.piezas for select to authenticated using (true);
drop policy if exists piezas_crear on public.piezas;
create policy piezas_crear on public.piezas for insert to authenticated with check (true);
drop policy if exists piezas_editar on public.piezas;
create policy piezas_editar on public.piezas for update to authenticated using (true) with check (true);

drop policy if exists eventos_ver on public.eventos;
create policy eventos_ver on public.eventos for select to authenticated using (true);
drop policy if exists eventos_crear on public.eventos;
create policy eventos_crear on public.eventos for insert to authenticated with check (autor = auth.uid());

-- ---------- Grabación semanal ----------
alter table public.ajustes add column if not exists grabacion_dia  int  not null default 2 check (grabacion_dia between 0 and 6);
alter table public.ajustes add column if not exists grabacion_hora text not null default '11:00';

create table if not exists public.grabaciones (
  id              uuid primary key default gen_random_uuid(),
  semana          date not null unique,              -- lunes de la semana
  fecha           date not null,
  hora            text not null check (hora ~ '^[0-2][0-9]:[0-5][0-9]$'),
  estado          text not null default 'propuesta' check (estado in ('propuesta', 'confirmada', 'hecha', 'cancelada')),
  confirmaciones  uuid[] not null default '{}',
  nota            text,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

-- Historial de la grabación (propuestas, confirmaciones, reagendas). No se edita ni se borra.
create table if not exists public.grabacion_eventos (
  id             uuid primary key default gen_random_uuid(),
  grabacion_id   uuid not null references public.grabaciones (id) on delete cascade,
  autor          uuid not null default auth.uid(),
  tipo           text not null check (tipo in ('auto', 'confirmacion', 'reagenda', 'hecha', 'cancelada', 'reabierta')),
  texto          text,
  datos          jsonb not null default '{}'::jsonb,
  creado_en      timestamptz not null default now()
);

alter table public.piezas add column if not exists grabacion_id uuid references public.grabaciones (id) on delete set null;

drop trigger if exists grabaciones_tocar on public.grabaciones;
create trigger grabaciones_tocar before update on public.grabaciones
  for each row execute function public.tocar_actualizado();

alter table public.grabaciones       enable row level security;
alter table public.grabacion_eventos enable row level security;
revoke all on public.grabaciones, public.grabacion_eventos from anon, authenticated;
grant select, insert, update on public.grabaciones       to authenticated;
grant select, insert         on public.grabacion_eventos to authenticated;

drop policy if exists grabaciones_ver on public.grabaciones;
create policy grabaciones_ver on public.grabaciones for select to authenticated using (true);
drop policy if exists grabaciones_crear on public.grabaciones;
create policy grabaciones_crear on public.grabaciones for insert to authenticated with check (true);
drop policy if exists grabaciones_editar on public.grabaciones;
create policy grabaciones_editar on public.grabaciones for update to authenticated using (true) with check (true);
drop policy if exists grab_eventos_ver on public.grabacion_eventos;
create policy grab_eventos_ver on public.grabacion_eventos for select to authenticated using (true);
drop policy if exists grab_eventos_crear on public.grabacion_eventos;
create policy grab_eventos_crear on public.grabacion_eventos for insert to authenticated with check (autor = auth.uid());

-- =====================================================================
--  v4 — flujo simplificado, fechas en cualquier etapa y notificaciones
-- =====================================================================

-- Días de anticipación para entregar (fecha límite = publicación − N días)
alter table public.ajustes add column if not exists dias_entrega int not null default 2 check (dias_entrega between 0 and 14);

-- Migración: video y copy ahora se aprueban juntos.
--   Reel en etapa 'copy'     → etapa 'video' (video + copy)
--   Carrusel en etapa 'copy' → etapa 'diseno' (diseño + copy)
update public.piezas set etapa = 'video'  where etapa = 'copy' and tipo = 'reel';
update public.piezas set etapa = 'diseno' where etapa = 'copy' and tipo = 'carrusel';

-- ---------- Suscripciones a notificaciones (un registro por dispositivo) ----------
create table if not exists public.push_subs (
  endpoint    text primary key,
  user_id     uuid not null default auth.uid(),
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  creado_en   timestamptz not null default now()
);
alter table public.push_subs enable row level security;
revoke all on public.push_subs from anon, authenticated;
grant select, insert, update, delete on public.push_subs to authenticated;
drop policy if exists push_ver on public.push_subs;
create policy push_ver on public.push_subs for select to authenticated using (user_id = auth.uid());
drop policy if exists push_crear on public.push_subs;
create policy push_crear on public.push_subs for insert to authenticated with check (user_id = auth.uid());
drop policy if exists push_editar on public.push_subs;
create policy push_editar on public.push_subs for update to authenticated using (true) with check (user_id = auth.uid());
drop policy if exists push_borrar on public.push_subs;
create policy push_borrar on public.push_subs for delete to authenticated using (user_id = auth.uid());

-- ---------- Configuración privada de notificaciones ----------
-- La llena sola la función «notificar» la primera vez (claves, dirección y secreto).
-- Nadie con sesión puede leerla: solo el servidor.
create table if not exists public.push_config (
  id             int primary key default 1 check (id = 1),
  vapid_publico  text not null,
  vapid_privado  jsonb not null,
  secreto        text not null,
  url            text not null,
  creado_en      timestamptz not null default now()
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;

-- ---------- Avisos automáticos ----------
-- Extensiones de Supabase para llamar a la función y programar el resumen diario.
do $$ begin create extension if not exists pg_net; exception when others then raise notice 'pg_net no disponible: %', sqlerrm; end $$;
do $$ begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron no disponible: %', sqlerrm; end $$;

-- Llama a la función «notificar» sin frenar nunca el guardado (si algo falla, solo no se avisa).
create or replace function public.bf_avisar(cuerpo jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare c public.push_config;
begin
  select * into c from public.push_config where id = 1;
  if c is null then return; end if;
  perform net.http_post(
    url := c.url,
    body := cuerpo,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-bf-secreto', c.secreto)
  );
exception when others then
  raise notice 'aviso no enviado: %', sqlerrm;
end $$;
revoke all on function public.bf_avisar(jsonb) from public, anon, authenticated;

create or replace function public.bf_aviso_evento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.bf_avisar(jsonb_build_object('tipo', 'evento', 'tabla', TG_TABLE_NAME, 'id', new.id));
  return new;
end $$;

drop trigger if exists eventos_avisar on public.eventos;
create trigger eventos_avisar after insert on public.eventos
  for each row execute function public.bf_aviso_evento();
drop trigger if exists grabacion_eventos_avisar on public.grabacion_eventos;
create trigger grabacion_eventos_avisar after insert on public.grabacion_eventos
  for each row execute function public.bf_aviso_evento();

-- Resumen diario a las 7:30 a. m. de Venezuela (11:30 UTC)
do $$
begin
  begin perform cron.unschedule('bf-resumen-diario'); exception when others then null; end;
  perform cron.schedule('bf-resumen-diario', '30 11 * * *', $cron$select public.bf_avisar('{"tipo":"diario"}'::jsonb)$cron$);
exception when others then
  raise notice 'No se pudo programar el resumen diario: %', sqlerrm;
end $$;

-- Listo. Siguiente paso de la guía: crear los dos usuarios en Authentication → Users.
