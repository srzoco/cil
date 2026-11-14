-- Horario de sábados de temporada (14/11/2026): entrada 10:00, salida 16:00, «a tiempo» 10:05, falta desde 10:20,
-- y las horas de las tareas encogidas dentro del horario (8:30 → 10:00, 1 pm → 1 pm, 4 pm → 3 pm). Corre después de cil.sql.
\set ON_ERROR_STOP 1
begin;
update tareas_ajustes set sab_desde = '2026-11-14', sab_hasta = '2026-12-31', sab_entrada = '10:00', sab_salida = '16:00', a_tiempo_hasta = '08:35', hora_limite = '08:50' where id = 1;
insert into auth.users (id, email) values ('5a000000-0000-0000-0000-000000000001', 'sab@x.com'), ('5a000000-0000-0000-0000-0000000000ad', 'gerencia-sab@x.com') on conflict do nothing;
update personas set rol = 'admin', activo = true where id = '5a000000-0000-0000-0000-0000000000ad';
update personas set accesos = '{tareas}', activo = true, rol = 'empleado', dias_trabajo = '{1,2,3,4,5,6}', local_id = (select id from locales order by principal desc limit 1)
 where id = '5a000000-0000-0000-0000-000000000001';
update locales set dias_laborables = '{1,2,3,4,5,6}';
insert into plantillas (titulo, minutos, frecuencia, fecha_inicio, activa, local_id, momentos) values
  ('Temperaturas sab', 5, 'diaria', '2026-11-01', true, (select id from locales order by principal desc limit 1),
   '[{"nombre":"Mañana","desde":"08:30","antes":"09:00"},{"nombre":"Mediodía","desde":"13:00","antes":"13:30"},{"nombre":"Tarde","desde":"16:00","antes":"16:30"}]');
do $$ begin
  if public._a_tiempo('2026-11-21') <> '10:05' or public._limite('2026-11-21') <> '10:20' then raise exception 'FALLO: puntualidad del sábado %, %', public._a_tiempo('2026-11-21'), public._limite('2026-11-21'); end if;
  if public._a_tiempo('2026-11-20') <> '08:35' or public._limite('2026-11-20') <> '08:50' then raise exception 'FALLO: cambió el viernes'; end if;
  if public._a_tiempo('2027-01-02') <> '08:35' then raise exception 'FALLO: sábado fuera de temporada'; end if;
  if public._hora_dia('08:30', '2026-11-21') <> '10:00' or public._hora_dia('13:00', '2026-11-21') <> '13:00' or public._hora_dia('16:00', '2026-11-21') <> '15:00' then raise exception 'FALLO: horas de tareas'; end if;
end $$;
-- se generan las tareas del sábado 21/11 (gerencia, otro día)
set local test.uid = '5a000000-0000-0000-0000-0000000000ad';
do $$ declare r record; begin
  perform public.generar_dia('2026-11-21');
  select string_agg(to_char(desde, 'HH24:MI') || '-' || to_char(antes, 'HH24:MI'), ',' order by momento) as h, count(*) filter (where asignado_a = '5a000000-0000-0000-0000-000000000001') as mias
    into r from asignaciones where fecha = '2026-11-21' and titulo = 'Temperaturas sab';
  if r.h is distinct from '10:00-10:20,13:00-13:20,15:00-15:20' then raise exception 'FALLO: horas del sábado %', r.h; end if;
  if r.mias = 0 then raise exception 'FALLO: a quien trabaja el sábado no le salieron tareas'; end if;
  perform public.generar_dia('2026-11-20');
  select string_agg(to_char(desde, 'HH24:MI'), ',' order by momento) as h into r from asignaciones where fecha = '2026-11-20' and titulo = 'Temperaturas sab';
  if r.h is distinct from '08:30,13:00,16:00' then raise exception 'FALLO: cambió el viernes %', r.h; end if;
end $$;
rollback;
\echo 'OK: sábados de temporada (puntualidad y horas de las tareas)'
