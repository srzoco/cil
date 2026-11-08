-- Robot de Yobel: descuento del día en las cuentas de cobro (robot_descuento_*). Corre después de cil.sql.
\set ON_ERROR_STOP 1
begin;
insert into auth.users (id, email) values ('a2000000-0000-0000-0000-000000000001', 'gerencia-desc@x.com'),
  ('e2000000-0000-0000-0000-000000000001', 'emp-desc@x.com') on conflict do nothing;
update personas set rol = 'admin' where id = 'a2000000-0000-0000-0000-000000000001';
update personas set accesos = '{tareas,mensajes}' where id = 'e2000000-0000-0000-0000-000000000001';
update bot_config set valor = 'gerencia-desc@x.com' where clave = 'avisos_correo';
update bot_config set valor = '23:59' where clave = 'descuento_hora_limite';
update bot_config set valor = 'si' where clave = 'descuento_yobel';
insert into armador_datos (id) values (1) on conflict (id) do nothing;
update armador_datos set descuento_manual = null, descuento_fecha = null where id = 1;
delete from robot_descuentos;
create temp table t_token as select robot_nuevo_token() as t;
grant select on t_token to anon;

set role anon;
-- 1. token falso, descuento con decimales o fuera de rango: rechazado; anon no lee la tabla ni aprueba
do $$ begin perform robot_descuento_pedir('falso', 43, 41); raise exception 'FALLO: token falso';
exception when others then if sqlerrm not like '%no autorizado%' then raise; end if; end $$;
do $$ begin perform robot_descuento_pedir((select t from t_token), 43.5, 41); raise exception 'FALLO: aceptó decimales';
exception when others then if sqlerrm not like '%no válido%' then raise; end if; end $$;
do $$ begin perform robot_descuento_pedir((select t from t_token), 0, 41); raise exception 'FALLO: aceptó 0';
exception when others then if sqlerrm not like '%no válido%' then raise; end if; end $$;
do $$ begin perform 1 from robot_descuentos; raise exception 'FALLO: anon leyó la tabla'; exception when insufficient_privilege then null; end $$;
do $$ begin perform descuento_yobel_aprobar(43, true); raise exception 'FALLO: anon aprobó'; exception when insufficient_privilege then null; end $$;

-- 2. cambio de más de 5 puntos: bloqueado + aviso, y no se vuelve a intentar hoy
do $$ declare r json; begin
  r := robot_descuento_pedir((select t from t_token), 50, 41);
  if r->>'accion' <> 'nada' or r->>'motivo' <> 'bloqueado' then raise exception 'FALLO: no bloqueó 41→50: %', r; end if;
  r := robot_descuento_pedir((select t from t_token), 50, 41);
  if r->>'accion' <> 'nada' then raise exception 'FALLO: reintentó lo bloqueado: %', r; end if;
end $$;
reset role;
do $$ begin if not exists (select 1 from avisos_cola where titulo like '%no lo cambié%' or cuerpo like '%No lo cambié%') then raise exception 'FALLO: no avisó el bloqueo'; end if; end $$;

-- 3. el descuento cambia en el día (43): con aprobación encendida, espera y avisa con enlace al Armador
set role anon;
do $$ declare r json; begin
  r := robot_descuento_pedir((select t from t_token), 43, 41);
  if r->>'accion' <> 'esperar' then raise exception 'FALLO: no esperó aprobación: %', r; end if;
  r := robot_descuento_pedir((select t from t_token), 43, 41);
  if r->>'accion' <> 'esperar' then raise exception 'FALLO: segunda consulta: %', r; end if;
  -- el robot no puede marcar resultado de algo no aprobado
  begin perform robot_descuento_resultado((select t from t_token), 43, true, 'x'); raise exception 'FALLO: resultado sin aprobar';
  exception when others then if sqlerrm not like '%no hay un cambio aprobado%' then raise; end if; end;
end $$;
reset role;
do $$ begin if (select count(*) from avisos_cola where url = 'mensajes/#yobel' and cuerpo like '%¿pongo 43%%') <> 1 then raise exception 'FALLO: aviso de aprobación'; end if; end $$;

-- 4. un empleado no aprueba; gerencia no aprueba otro número; gerencia aprueba
set role authenticated;
set test.uid = 'e2000000-0000-0000-0000-000000000001';
do $$ begin perform descuento_yobel_aprobar(43, true); raise exception 'FALLO: empleado aprobó';
exception when others then if sqlerrm not like '%Solo gerencia%' then raise; end if; end $$;
set test.uid = 'a2000000-0000-0000-0000-000000000001';
do $$ begin perform descuento_yobel_aprobar(44, true); raise exception 'FALLO: aprobó otro número';
exception when others then if sqlerrm not like '%cambió mientras tanto%' then raise; end if; end $$;
do $$ declare r json; begin
  r := descuento_yobel_hoy();
  if r->>'estado' <> 'pendiente' or (r->>'descuento')::numeric <> 43 then raise exception 'FALLO: ver hoy %', r; end if;
  r := descuento_yobel_aprobar(43, true);
  if r->>'estado' <> 'aprobado' then raise exception 'FALLO: aprobar %', r; end if;
end $$;
do $$ begin perform descuento_yobel_aprobar(43, true); raise exception 'FALLO: aprobó dos veces';
exception when others then if sqlerrm not like '%No hay ningún cambio%' then raise; end if; end $$;
reset role;

-- 5. el robot lo pone y lo reporta; después ya no hace nada hoy
set role anon;
do $$ declare r json; begin
  r := robot_descuento_pedir((select t from t_token), 43, 41);
  if r->>'accion' <> 'aplicar' or (r->>'descuento')::numeric <> 43 then raise exception 'FALLO: no dijo aplicar: %', r; end if;
  perform robot_descuento_resultado((select t from t_token), 43, true, 'ok');
  r := robot_descuento_pedir((select t from t_token), 43, 43);
  if r->>'accion' <> 'nada' then raise exception 'FALLO: repitió lo aplicado: %', r; end if;
end $$;
reset role;
do $$ begin if (select estado from robot_descuentos where fecha = hoy()) <> 'aplicado' then raise exception 'FALLO: estado final'; end if; end $$;

-- 6. gerencia fija el descuento a mano: el robot no puede pedir otro número
update armador_datos set descuento_manual = 44, descuento_fecha = hoy() where id = 1;
set role anon;
do $$ begin perform robot_descuento_pedir((select t from t_token), 45, 43); raise exception 'FALLO: ignoró el descuento a mano';
exception when others then if sqlerrm not like '%fijado a mano%' then raise; end if; end $$;
-- y con el número a mano (44) vuelve a decidir desde cero
do $$ declare r json; begin
  r := robot_descuento_pedir((select t from t_token), 44, 43);
  if r->>'accion' <> 'esperar' then raise exception 'FALLO: cambio en el día: %', r; end if;
end $$;
reset role;

-- 7. sin aprobación (descuento_aprobar = no): aplica directo; si Yobel ya lo tiene, no hace nada
delete from robot_descuentos;
update armador_datos set descuento_manual = null, descuento_fecha = null where id = 1;
update bot_config set valor = 'no' where clave = 'descuento_aprobar';
set role anon;
do $$ declare r json; begin
  r := robot_descuento_pedir((select t from t_token), 42, 41);
  if r->>'accion' <> 'aplicar' then raise exception 'FALLO: sin aprobación %', r; end if;
  perform robot_descuento_resultado((select t from t_token), 42, false, 'no se abrió la ventana');
  r := robot_descuento_pedir((select t from t_token), 42, 41);
  if r->>'accion' <> 'nada' then raise exception 'FALLO: reintentó lo fallido %', r; end if;
end $$;
reset role;
delete from robot_descuentos;
set role anon;
do $$ declare r json; begin
  r := robot_descuento_pedir((select t from t_token), 41, 41);
  if r->>'accion' <> 'nada' or r->>'motivo' <> 'ya_estaba' then raise exception 'FALLO: ya estaba %', r; end if;
end $$;
reset role;

-- 8. hora límite: lo pendiente vence, avisa y no se puede aprobar
delete from robot_descuentos;
update bot_config set valor = 'si' where clave = 'descuento_aprobar';
set role anon;
do $$ declare r json; begin r := robot_descuento_pedir((select t from t_token), 43, 41); end $$;
reset role;
update bot_config set valor = '00:00' where clave = 'descuento_hora_limite';
set role authenticated;
set test.uid = 'a2000000-0000-0000-0000-000000000001';
do $$ begin perform descuento_yobel_aprobar(43, true); raise exception 'FALLO: aprobó fuera de hora';
exception when others then if sqlerrm not like '%hora límite%' then raise; end if; end $$;
reset role;
set role anon;
do $$ declare r json; begin
  r := robot_descuento_pedir((select t from t_token), 43, 41);
  if r->>'motivo' <> 'vencido' then raise exception 'FALLO: no venció %', r; end if;
end $$;
reset role;

-- 9. interruptor apagado: no hace nada; vigilancia avisa si el robot no apareció
delete from robot_descuentos;
update bot_config set valor = 'no' where clave = 'descuento_yobel';
set role anon;
do $$ declare r json; begin
  r := robot_descuento_pedir((select t from t_token), 43, 41);
  if r->>'motivo' <> 'apagado' then raise exception 'FALLO: interruptor %', r; end if;
end $$;
reset role;
update bot_config set valor = 'si' where clave = 'descuento_yobel';
select descuento_yobel_vigilar();
do $$ begin if not exists (select 1 from avisos_cola where cuerpo like '%no revisó el descuento de hoy%') then raise exception 'FALLO: vigilancia'; end if; end $$;

rollback;
\echo 'OK: robot del descuento de Yobel'
