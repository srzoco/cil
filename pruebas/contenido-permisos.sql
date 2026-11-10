-- Contenido: quién puede ver y tocar sus tablas (las tablas se crean en cil.sql desde el 10/11/2026, así que ahora se prueban).
-- Solo gerencia y quien tenga el acceso «contenido»; nadie se pone «aprueba» solo; nadie escribe historial a nombre de otro.
\set ON_ERROR_STOP 1
begin;
insert into auth.users (id, email) values
  ('ca000000-0000-0000-0000-00000000000c', 'cont@x.com'), ('ce000000-0000-0000-0000-00000000000c', 'emp@x.com'),
  ('cd000000-0000-0000-0000-00000000000c', 'adm-c@x.com') on conflict do nothing;
update personas set nombre = 'Vero', rol = 'empleado', accesos = '{contenido}', activo = true where id = 'ca000000-0000-0000-0000-00000000000c';
update personas set nombre = 'Emp', rol = 'empleado', accesos = '{tareas}', activo = true where id = 'ce000000-0000-0000-0000-00000000000c';
update personas set nombre = 'Adm', rol = 'admin', activo = true where id = 'cd000000-0000-0000-0000-00000000000c';
insert into piezas (id, titulo, tipo, fase, etapa, turno) values ('11111111-0000-0000-0000-00000000000c', 'Pieza de prueba', 'historia', 'produccion', 'video', 'edita');
create function pg_temp.como(uid uuid, q text) returns text language plpgsql as $$
declare n int; begin
  perform set_config('test.uid', uid::text, true);
  execute 'set local role authenticated';
  begin execute q; get diagnostics n = row_count;
  exception when others then execute 'reset role'; return 'error: ' || sqlerrm; end;
  execute 'reset role'; return n::text;
end $$;
do $$
declare r text; vero uuid := 'ca000000-0000-0000-0000-00000000000c'; emp uuid := 'ce000000-0000-0000-0000-00000000000c'; adm uuid := 'cd000000-0000-0000-0000-00000000000c';
begin
  -- quien tiene Contenido y gerencia ven y tocan
  if pg_temp.como(vero, 'select * from piezas') <> '1' then raise exception 'FALLO: Contenido no ve las piezas'; end if;
  if pg_temp.como(adm, 'select * from piezas') <> '1' then raise exception 'FALLO: gerencia no ve las piezas'; end if;
  if pg_temp.como(vero, $q$update piezas set titulo = 'Nuevo' where id = '11111111-0000-0000-0000-00000000000c'$q$) <> '1' then raise exception 'FALLO: Contenido no puede editar'; end if;
  r := pg_temp.como(vero, $q$insert into eventos (pieza_id, autor, tipo) values ('11111111-0000-0000-0000-00000000000c', 'ca000000-0000-0000-0000-00000000000c', 'editada')$q$);
  if r <> '1' then raise exception 'FALLO: Contenido no escribe el historial: %', r; end if;
  -- un empleado de Tareas no ve ni toca nada de Contenido
  foreach r in array array['select * from piezas', 'select * from eventos', 'select * from equipo', 'select * from ajustes', 'select * from grabaciones',
                           $q$update piezas set titulo = 'x'$q$, $q$update ajustes set dias_minimos = 1$q$] loop
    if pg_temp.como(emp, r) not in ('0') and pg_temp.como(emp, r) not like 'error:%' then raise exception 'FALLO: un empleado sin Contenido pudo: % (%)', r, pg_temp.como(emp, r); end if;
  end loop;
  if pg_temp.como(emp, $q$insert into piezas (titulo, tipo) values ('x', 'reel')$q$) not like 'error:%' then raise exception 'FALLO: un empleado sin Contenido creó una pieza'; end if;
  if pg_temp.como(emp, 'delete from piezas') not like 'error:%' then raise exception 'FALLO: alguien pudo borrar piezas'; end if;
  -- nadie escribe historial a nombre de otra persona
  if pg_temp.como(vero, $q$insert into eventos (pieza_id, autor, tipo) values ('11111111-0000-0000-0000-00000000000c', 'cd000000-0000-0000-0000-00000000000c', 'aprobacion')$q$) not like 'error:%' then raise exception 'FALLO: Contenido escribió una aprobación a nombre de gerencia'; end if;
  -- el papel «aprueba» solo lo pone gerencia
  if pg_temp.como(vero, $q$insert into equipo (user_id, nombre, rol) values ('ca000000-0000-0000-0000-00000000000c', 'Vero', 'aprueba')$q$) not like 'error:%' then raise exception 'FALLO: quien edita se puso el papel «aprueba»'; end if;
  if pg_temp.como(vero, $q$insert into equipo (user_id, nombre, rol) values ('ca000000-0000-0000-0000-00000000000c', 'Vero', 'edita')$q$) <> '1' then raise exception 'FALLO: Contenido no puede elegir «edita»'; end if;
  if pg_temp.como(vero, $q$update equipo set rol = 'aprueba' where user_id = 'ca000000-0000-0000-0000-00000000000c'$q$) not like 'error:%' then raise exception 'FALLO: quien edita se cambió a «aprueba»'; end if;
  -- anónimo (sin sesión): nada
  set local role anon;
  begin perform 1 from piezas; raise exception 'FALLO: sin sesión se leen las piezas'; exception when insufficient_privilege then null; end;
  reset role;
end $$;
rollback;
\echo 'OK: Contenido solo para gerencia y quien tiene el acceso; nadie se pone «aprueba» ni firma por otro'
