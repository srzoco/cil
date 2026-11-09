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
update llegada_intentos set creado_en = now() - interval '40 minutes' where persona_id = 'f1000000-0000-0000-0000-000000000001';
insert into llegada_intentos (persona_id, ip, creado_en) values ('f2000000-0000-0000-0000-000000000001', '200.9.9.9', now() - interval '50 minutes');  -- intento desde otra red (la casa)
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
  if a is null or a > now() - interval '39 minutes' then raise exception 'FALLO: no tomó el primer intento: %', a; end if;
  if b is null or b < now() - interval '1 minute' then raise exception 'FALLO: a quien no intentó antes le cambió la hora: %', b; end if;
end $$;
-- 4. un intento desde otra red (por ejemplo la casa) no cuenta
do $$ begin
  if exists (select 1 from asistencia where persona_id = 'f2000000-0000-0000-0000-000000000001' and fecha = hoy() and llegada < now() - interval '1 minute') then raise exception 'FALLO'; end if;
end $$;
rollback;
\echo 'OK: la llegada cuenta desde el primer intento en la red del local'
