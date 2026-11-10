-- La red nueva se registra sola SOLO con las dos condiciones: misma familia que una red registrada en persona en ese local
-- y 2 personas distintas de ese local. Con aviso a gerencia y «deshacer». Corre después de cil.sql.
\set ON_ERROR_STOP 1
begin;
insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000009', 'uno@x.com'), ('e2000000-0000-0000-0000-000000000009', 'dos@x.com'),
  ('e3000000-0000-0000-0000-000000000009', 'otro-local@x.com'), ('ea000000-0000-0000-0000-000000000009', 'jefa@x.com') on conflict do nothing;
insert into locales (nombre, principal) select 'Otro local de prueba', false;
update locales set redes = '{}', redes_persona = '{}', sin_wifi_fecha = null, dias_laborables = '{0,1,2,3,4,5,6}';
update personas set nombre = split_part(email, '@', 1), rol = 'empleado', accesos = '{tareas}', activo = true, local_id = (select id from locales where principal)
 where id in ('e1000000-0000-0000-0000-000000000009', 'e2000000-0000-0000-0000-000000000009');
update personas set nombre = 'otro', rol = 'empleado', accesos = '{tareas}', activo = true, local_id = (select id from locales where nombre = 'Otro local de prueba') where id = 'e3000000-0000-0000-0000-000000000009';
update personas set nombre = 'jefa', rol = 'admin', activo = true where id = 'ea000000-0000-0000-0000-000000000009';
delete from asistencia; delete from llegada_intentos; delete from redes_nuevas; delete from redes_auto; delete from avisos_cola;
create function pg_temp.intenta(p uuid, ip text) returns json language plpgsql as $$
declare r json; begin
  perform set_config('request.headers', json_build_object('x-real-ip', ip)::text, true);
  perform set_config('test.uid', p::text, true);
  execute 'set local role authenticated'; r := public.marcar_llegada(); execute 'reset role'; return r;
end $$;
create function pg_temp.presente(p uuid) returns boolean language sql as $$ select exists (select 1 from asistencia where persona_id = p and fecha = hoy() and estado = 'presente') $$;
-- Gerencia registra en persona la red del local principal (190.5.x.x)
set local request.headers = '{"x-real-ip": "190.5.1.1"}';
set test.uid = 'ea000000-0000-0000-0000-000000000009'; set role authenticated;
select registrar_red((select id from locales where principal)) \gset
reset role;
do $$ declare r json; pr uuid := (select id from locales where principal); begin
  if (select redes_persona from locales where id = pr) <> '{190.5.1.1}' then raise exception 'FALLO: registrar_red no la anotó como registrada en persona'; end if;
  -- A) otra familia (200.x), 2 personas del local: NO se registra
  r := pg_temp.intenta('e1000000-0000-0000-0000-000000000009', '200.9.9.9'); r := pg_temp.intenta('e2000000-0000-0000-0000-000000000009', '200.9.9.9');
  if r->>'error' is null or exists (select 1 from locales where '200.9.9.9' = any (redes)) then raise exception 'FALLO: registró sola una red de otra familia'; end if;
  -- B) misma familia, 1 sola persona (aunque lo intente varias veces): NO
  r := pg_temp.intenta('e1000000-0000-0000-0000-000000000009', '190.5.77.7'); r := pg_temp.intenta('e1000000-0000-0000-0000-000000000009', '190.5.77.7');
  if r->>'error' is null or exists (select 1 from locales where '190.5.77.7' = any (redes)) then raise exception 'FALLO: registró sola una red con una sola persona'; end if;
  -- C) misma familia, la segunda persona es de OTRO local: NO
  r := pg_temp.intenta('e3000000-0000-0000-0000-000000000009', '190.5.77.7');
  if r->>'error' is null or exists (select 1 from locales where '190.5.77.7' = any (redes)) then raise exception 'FALLO: contó a alguien de otro local'; end if;
  if pg_temp.presente('e1000000-0000-0000-0000-000000000009') then raise exception 'FALLO: marcó a alguien sin registrar la red'; end if;
  -- D) misma familia y la 2.ª persona del mismo local: SÍ. Las dos quedan marcadas y a quien tocó el botón le sale bien.
  r := pg_temp.intenta('e2000000-0000-0000-0000-000000000009', '190.5.77.7');
  if r->>'error' is not null then raise exception 'FALLO: con las dos condiciones no se registró: %', r; end if;
  if not exists (select 1 from locales where id = pr and '190.5.77.7' = any (redes)) then raise exception 'FALLO: la red no quedó en el local'; end if;
  if exists (select 1 from locales where id = pr and '190.5.77.7' = any (redes_persona)) then raise exception 'FALLO: la red sola quedó como registrada en persona'; end if;
  if not (pg_temp.presente('e1000000-0000-0000-0000-000000000009') and pg_temp.presente('e2000000-0000-0000-0000-000000000009')) then raise exception 'FALLO: no quedaron marcadas las dos'; end if;
  -- quien es de otro local pero lo intentó desde esa misma red estaba ahí: queda marcado en ESTE local (igual que con cualquier Wi-Fi registrado)
  if (select local_id from asistencia where persona_id = 'e3000000-0000-0000-0000-000000000009' and fecha = hoy()) is distinct from pr then raise exception 'FALLO: la persona del otro local no quedó marcada en este local'; end if;
  if (select llegada from asistencia where persona_id = 'e1000000-0000-0000-0000-000000000009' and fecha = hoy())
     <> (select min(creado_en) from llegada_intentos where persona_id = 'e1000000-0000-0000-0000-000000000009' and ip = '190.5.77.7') then raise exception 'FALLO: la llegada no es la del primer intento'; end if;
  if (select count(*) from avisos_cola where persona_id = 'ea000000-0000-0000-0000-000000000009' and titulo like '%se registró una red nueva sola%') <> 1 then raise exception 'FALLO: no avisó a gerencia'; end if;
  if (select count(*) from redes_auto where ip = '190.5.77.7' and not deshecha and cardinality(personas) = 2) <> 1 then raise exception 'FALLO: no quedó anotada para deshacer'; end if;
  if exists (select 1 from redes_nuevas where ip = '190.5.77.7') then raise exception 'FALLO: siguió en redes nuevas'; end if;
end $$;
-- E) un empleado no puede deshacer ni llamar lo interno; gerencia sí
set test.uid = 'e1000000-0000-0000-0000-000000000009'; set role authenticated;
do $$ begin
  begin perform deshacer_red_sola((select id from redes_auto limit 1)); raise exception 'FALLO: un empleado deshizo';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; end;
  begin perform _registrar_red_sola('190.5.3.3'); raise exception 'FALLO: un empleado llamó la función interna';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; end;
  if (select count(*) from redes_auto) <> 0 then raise exception 'FALLO: un empleado ve las redes registradas solas'; end if;
end $$;
set test.uid = 'ea000000-0000-0000-0000-000000000009';
do $$ declare r json; begin
  r := deshacer_red_sola((select id from redes_auto limit 1));
  if r->>'personas' not like '%uno%' then raise exception 'FALLO: deshacer no dijo quiénes marcaron: %', r; end if;
end $$;
reset role;
do $$ declare r json; begin
  if exists (select 1 from locales where '190.5.77.7' = any (redes)) then raise exception 'FALLO: deshacer no quitó la red'; end if;
  if not exists (select 1 from locales where principal and '190.5.1.1' = any (redes)) then raise exception 'FALLO: deshacer quitó la red registrada en persona'; end if;
  -- F) una red deshecha no se vuelve a registrar sola
  delete from asistencia;
  r := pg_temp.intenta('e1000000-0000-0000-0000-000000000009', '190.5.77.7'); r := pg_temp.intenta('e2000000-0000-0000-0000-000000000009', '190.5.77.7');
  if r->>'error' is null then raise exception 'FALLO: una red deshecha se volvió a registrar sola'; end if;
  -- G) un local sin ninguna red registrada en persona nunca registra sola
  update locales set redes_persona = '{}';
  r := pg_temp.intenta('e1000000-0000-0000-0000-000000000009', '190.5.88.8'); r := pg_temp.intenta('e2000000-0000-0000-0000-000000000009', '190.5.88.8');
  if r->>'error' is null then raise exception 'FALLO: registró sola sin ninguna red registrada en persona'; end if;
  if public._familia_red('190.5.77.7') <> '190.5' or public._familia_red('2800:484:1:2::/64') is null or public._familia_red('basura') is not null then raise exception 'FALLO: familia de red'; end if;
end $$;
rollback;
\echo 'OK: la red nueva se registra sola solo con las dos condiciones, avisa y se puede deshacer'
