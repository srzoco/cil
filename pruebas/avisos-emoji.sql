-- Avisos (10/11/2026): emoji de la herramienta, 🔴 delante de lo que hay que revisar primero, y los que llegan juntos
-- suenan como uno solo. Los que no son 🔴 esperan 2 minutos sin avisos nuevos (máximo 8). Corre después de cil.sql.
\set ON_ERROR_STOP 1
begin;
insert into auth.users (id, email) values ('aa000000-0000-0000-0000-00000000000a', 'jefa-avisos@x.com') on conflict do nothing;
update personas set nombre = 'Jefa', rol = 'admin', activo = true where id = 'aa000000-0000-0000-0000-00000000000a';
delete from avisos_cola; delete from avisos_log; delete from avisos_enviados; delete from suscripciones;
insert into suscripciones (persona_id, endpoint, p256dh, auth) values ('aa000000-0000-0000-0000-00000000000a', 'https://push.test/1', 'k', 'a');
create temp table t_envios (n int, titulo text, cuerpo text, url text);
create function pg_temp.tic(p_n int) returns void language sql as $$
  insert into t_envios select p_n, a.titulo, a.cuerpo, a.url from public.avisos_pendientes() a where a.persona_id = 'aa000000-0000-0000-0000-00000000000a' $$;
-- 1) Cuatro avisos de hace 3 minutos: uno 🔴 del bot y tres normales de herramientas distintas
insert into avisos_cola (persona_id, titulo, cuerpo, url, creado_en) values
  ('aa000000-0000-0000-0000-00000000000a', 'Pedido de café', 'Lo pidió Ana', './#/', now() - interval '3 minutes'),
  ('aa000000-0000-0000-0000-00000000000a', '🔴 El robot no subió el stock', 'Revisa la PC', './', now() - interval '3 minutes'),
  ('aa000000-0000-0000-0000-00000000000a', 'Pieza por aprobar', 'Queso manchego', '../contenidoBF/#/p/1', now() - interval '3 minutes'),
  ('aa000000-0000-0000-0000-00000000000a', 'Te pidieron algo', 'Llamar al proveedor', 'pendientes/#/p/1', now() - interval '3 minutes');
select pg_temp.tic(1);
do $$ declare r record; begin
  if (select count(*) from t_envios where n = 1) <> 2 then raise exception 'FALLO: debían sonar 2 (uno 🔴 y uno con el resto), sonaron %: %', (select count(*) from t_envios where n = 1), (select json_agg(titulo) from t_envios); end if;
  if not exists (select 1 from t_envios where titulo = '🔴 💬 El robot no subió el stock' and url = './') then raise exception 'FALLO: el 🔴 del robot: %', (select json_agg(titulo) from t_envios); end if;
  select * into r from t_envios where titulo = '🔔 3 avisos';
  if r.titulo is null then raise exception 'FALLO: no agrupó los 3 normales: %', (select json_agg(titulo) from t_envios); end if;
  if r.cuerpo not like '%✅ Pedido de café%' or r.cuerpo not like '%🎬 Pieza por aprobar%' or r.cuerpo not like '%📋 Te pidieron algo%' then raise exception 'FALLO: el aviso agrupado no dice de qué herramienta es cada uno: %', r.cuerpo; end if;
  if r.url <> './?bandeja' then raise exception 'FALLO: el agrupado de varias herramientas debía abrir la bandeja: %', r.url; end if;
  -- en la bandeja quedan los 4, uno por uno, con su emoji
  if (select count(*) from avisos_log where persona_id = 'aa000000-0000-0000-0000-00000000000a') <> 4
     or not exists (select 1 from avisos_log where titulo = '🎬 Pieza por aprobar') or not exists (select 1 from avisos_log where titulo = '🔴 💬 El robot no subió el stock')
  then raise exception 'FALLO: la bandeja: %', (select json_agg(titulo) from avisos_log); end if;
  if exists (select 1 from avisos_cola) then raise exception 'FALLO: quedaron avisos ya enviados en la cola'; end if;
end $$;
-- 2) Uno normal recién llegado espera; uno 🔴 recién llegado suena ya
insert into avisos_cola (persona_id, titulo, cuerpo, url) values
  ('aa000000-0000-0000-0000-00000000000a', 'Otro pedido', '', './#/'), ('aa000000-0000-0000-0000-00000000000a', '🔴 Urgente del bot', '', './');
select pg_temp.tic(2);
do $$ begin
  if (select json_agg(titulo)::text from t_envios where n = 2) is distinct from '["🔴 💬 Urgente del bot"]' then raise exception 'FALLO: recién llegados: %', (select json_agg(titulo) from t_envios where n = 2); end if;
  if (select count(*) from avisos_cola where titulo = 'Otro pedido') <> 1 then raise exception 'FALLO: el normal recién llegado no quedó esperando'; end if;
end $$;
-- 3) Pasan los 2 minutos sin nada nuevo: sale (solo, con su título y su enlace)
update avisos_cola set creado_en = now() - interval '130 seconds';
select pg_temp.tic(3);
do $$ begin
  if not exists (select 1 from t_envios where n = 3 and titulo = '✅ Otro pedido' and url = './#/') then raise exception 'FALLO: después de 2 minutos no salió: %', (select json_agg(titulo) from t_envios where n = 3); end if;
end $$;
-- 4) Siguen llegando avisos cada minuto: a los 8 minutos del primero salen todos juntos (no esperan para siempre)
insert into avisos_cola (persona_id, titulo, cuerpo, url, creado_en) values
  ('aa000000-0000-0000-0000-00000000000a', 'Viejo', '', './#/', now() - interval '9 minutes'), ('aa000000-0000-0000-0000-00000000000a', 'Nuevo', '', './#/', now());
select pg_temp.tic(4);
do $$ begin
  if not exists (select 1 from t_envios where n = 4 and titulo = '🔔 2 avisos' and url = './#/') then raise exception 'FALLO: a los 8 minutos no salieron juntos: %', (select json_agg(titulo) from t_envios where n = 4); end if;
end $$;
-- 5) El aviso de prueba sale al momento
insert into avisos_cola (persona_id, titulo, cuerpo) values ('aa000000-0000-0000-0000-00000000000a', 'Aviso de prueba', 'x');
select pg_temp.tic(5);
do $$ begin
  if not exists (select 1 from t_envios where n = 5 and titulo = '✅ Aviso de prueba') then raise exception 'FALLO: el aviso de prueba no salió al momento: %', (select json_agg(titulo) from t_envios where n = 5); end if;
end $$;
rollback;
\echo 'OK: avisos con emoji de la herramienta, 🔴 para lo urgente y agrupados'
