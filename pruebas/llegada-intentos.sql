-- «Llegué» con la red nueva: si gerencia la registra después, la llegada cuenta desde el primer intento. Corre después de cil.sql.
\set ON_ERROR_STOP 1
begin;
insert into auth.users (id, email) values ('f1000000-0000-0000-0000-000000000001', 'llega@x.com'), ('f2000000-0000-0000-0000-000000000001', 'otra@x.com') on conflict do nothing;
update personas set accesos = '{tareas}', activo = true, local_id = (select id from locales order by principal desc limit 1)
 where id in ('f1000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001');
update locales set redes = '{}', sin_wifi_fecha = null;
update locales set dias_laborables = '{0,1,2,3,4,5,6}';
delete from asistencia where persona_id in ('f1000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001');
set local request.headers = '{"x-real-ip": "190.1.2.3"}';
set role authenticated;
set test.uid = 'f1000000-0000-0000-0000-000000000001';
-- 1. red desconocida: no deja marcar y anota el intento
do $$ begin
  if (marcar_llegada()->>'error') is null then raise exception 'FALLO: marcó desde una red desconocida'; end if;
end $$;
reset role;
do $$ begin if not exists (select 1 from llegada_intentos where persona_id = 'f1000000-0000-0000-0000-000000000001' and ip = '190.1.2.3') then raise exception 'FALLO: no anotó el intento'; end if; end $$;
-- el intento fue hace 40 minutos; gerencia registra la red después
-- (nunca antes de la medianoche de Caracas: la prueba también corre de madrugada)
update llegada_intentos set creado_en = greatest(now() - interval '40 minutes', (hoy()::timestamp at time zone 'America/Caracas')) where persona_id = 'f1000000-0000-0000-0000-000000000001';
insert into llegada_intentos (persona_id, ip, creado_en) values ('f2000000-0000-0000-0000-000000000001', '200.9.9.9', now() - interval '50 seconds');  -- intento desde otra red (la casa)
update locales set redes = '{190.1.2.3}' where id = (select id from locales order by principal desc limit 1);
set role authenticated;
-- 2. ahora marca: la llegada es la del primer intento
set test.uid = 'f1000000-0000-0000-0000-000000000001';
do $$ declare r json; begin r := marcar_llegada(); if r->>'error' is not null then raise exception 'FALLO: %', r; end if; end $$;
-- 3. otra persona que solo intentó desde otra red: llegada de ahora
set test.uid = 'f2000000-0000-0000-0000-000000000001';
do $$ declare r json; begin r := marcar_llegada(); if r->>'error' is not null then raise exception 'FALLO: %', r; end if; end $$;
reset role;
do $$ declare a timestamptz; b timestamptz; begin
  select llegada into a from asistencia where persona_id = 'f1000000-0000-0000-0000-000000000001' and fecha = hoy();
  select llegada into b from asistencia where persona_id = 'f2000000-0000-0000-0000-000000000001' and fecha = hoy();
  if a is null or a <> (select creado_en from llegada_intentos where persona_id = 'f1000000-0000-0000-0000-000000000001' and ip = '190.1.2.3') then raise exception 'FALLO: no tomó el primer intento: %', a; end if;
  if b is null or b < now() - interval '40 seconds' then raise exception 'FALLO: a quien no intentó antes le cambió la hora: %', b; end if;
end $$;
-- 4. un intento desde otra red (por ejemplo la casa) no cuenta
do $$ begin
  if exists (select 1 from asistencia where persona_id = 'f2000000-0000-0000-0000-000000000001' and fecha = hoy() and llegada < now() - interval '40 seconds') then raise exception 'FALLO'; end if;
end $$;
-- 5. Gerencia aprueba la red 5 horas después: quien lo intentó queda con la llegada marcada sola, a la hora del primer intento,
--    con aviso; quien intentó desde otra red, no. (Antes había que volver a tocar «Llegué» y pasadas 3 horas contaba «ahora».)
insert into auth.users (id, email) values ('f3000000-0000-0000-0000-000000000001', 'tres@x.com'), ('fa000000-0000-0000-0000-000000000001', 'jefa@x.com') on conflict do nothing;
update personas set accesos = '{tareas}', activo = true, local_id = (select id from locales order by principal desc limit 1) where id = 'f3000000-0000-0000-0000-000000000001';
update personas set rol = 'admin', activo = true where id = 'fa000000-0000-0000-0000-000000000001';
delete from asistencia where persona_id in ('f2000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001');
delete from llegada_intentos; delete from redes_nuevas; delete from avisos_cola;
set local request.headers = '{"x-real-ip": "190.7.7.7"}';
set role authenticated;
set test.uid = 'f3000000-0000-0000-0000-000000000001';
do $$ begin if (marcar_llegada()->>'error') is null then raise exception 'FALLO: marcó desde una red desconocida'; end if; end $$;
reset role;
update llegada_intentos set creado_en = greatest(now() - interval '5 hours', (hoy()::timestamp at time zone 'America/Caracas') + interval '1 second');
insert into llegada_intentos (persona_id, ip) values ('f2000000-0000-0000-0000-000000000001', '200.9.9.9');
set role authenticated;
set test.uid = 'fa000000-0000-0000-0000-000000000001';
select aceptar_red((select id from redes_nuevas where ip = '190.7.7.7' limit 1), (select id from locales order by principal desc limit 1));
reset role;
do $$ declare a public.asistencia; t timestamptz; begin
  select creado_en into t from llegada_intentos where persona_id = 'f3000000-0000-0000-0000-000000000001' and ip = '190.7.7.7';
  select * into a from asistencia where persona_id = 'f3000000-0000-0000-0000-000000000001' and fecha = hoy();
  if a.estado is distinct from 'presente' then raise exception 'FALLO: al aprobar la red no quedó marcada la llegada'; end if;
  if a.llegada <> t then raise exception 'FALLO: la llegada no es la del primer intento: % (intento %)', a.llegada, t; end if;
  if a.verificado is distinct from 'wifi' then raise exception 'FALLO: verificado = %', a.verificado; end if;
  if exists (select 1 from asistencia where persona_id = 'f2000000-0000-0000-0000-000000000001' and fecha = hoy()) then raise exception 'FALLO: marcó a quien intentó desde otra red'; end if;
  if (select count(*) from avisos_cola where persona_id = 'f3000000-0000-0000-0000-000000000001' and titulo = 'Tu llegada quedó marcada') <> 1 then raise exception 'FALLO: no le avisó'; end if;
  if exists (select 1 from redes_nuevas where ip = '190.7.7.7') then raise exception 'FALLO: la red sigue por revisar'; end if;
end $$;
-- 6. «Registrar esta red» desde el teléfono de gerencia hace lo mismo; un empleado no puede
delete from asistencia where persona_id = 'f3000000-0000-0000-0000-000000000001';
update locales set redes = '{}';
insert into redes_nuevas (persona_id, ip) values ('f3000000-0000-0000-0000-000000000001', '190.7.7.7');
set role authenticated;
set test.uid = 'f3000000-0000-0000-0000-000000000001';
do $$ begin
  begin perform registrar_red((select id from locales order by principal desc limit 1)); raise exception 'FALLO: un empleado registró una red';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; end;
  begin perform _llegadas_de_red('190.7.7.7', null); raise exception 'FALLO: un empleado llamó la función interna';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; end;
end $$;
set test.uid = 'fa000000-0000-0000-0000-000000000001';
select registrar_red((select id from locales order by principal desc limit 1));
reset role;
do $$ begin
  if not exists (select 1 from asistencia where persona_id = 'f3000000-0000-0000-0000-000000000001' and fecha = hoy() and estado = 'presente' and verificado = 'wifi') then raise exception 'FALLO: registrar_red no marcó la llegada'; end if;
  if exists (select 1 from redes_nuevas where ip = '190.7.7.7') then raise exception 'FALLO: registrar_red dejó la red por revisar'; end if;
end $$;
rollback;
\echo 'OK: la llegada cuenta desde el primer intento en la red del local'
