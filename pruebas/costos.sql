-- Cotizador a costo: los costos solo los ven gerencia y quien tenga el acceso 'costos'. Corre después de cil.sql.
\set ON_ERROR_STOP 1
begin;
insert into auth.users (id, email) values ('a1000000-0000-0000-0000-000000000001', 'g@x.com'), ('b1000000-0000-0000-0000-000000000001', 'adolfo@x.com'),
  ('e1000000-0000-0000-0000-000000000001', 'emp@x.com') on conflict do nothing;
update personas set rol = 'admin' where id = 'a1000000-0000-0000-0000-000000000001';
update personas set accesos = '{tareas,mensajes,costos}' where id = 'b1000000-0000-0000-0000-000000000001';
update personas set accesos = '{tareas,mensajes}' where id = 'e1000000-0000-0000-0000-000000000001';
create temp table t_token as select robot_nuevo_token() as t;
grant select on t_token to anon;
set role anon;
-- 1. anon no lee la tabla ni cotiza; el robot con token falso no sube
do $$ begin perform 1 from costos; raise exception 'FALLO: anon leyó costos'; exception when insufficient_privilege then null; end $$;
do $$ begin perform costos_cotizar(); raise exception 'FALLO: anon cotizó'; exception when insufficient_privilege then null; end $$;
do $$ begin perform robot_costos('falso', '[{"ref":"A|","costo":5}]'); raise exception 'FALLO: token falso';
exception when others then if sqlerrm not like '%no autorizado%' then raise; end if; end $$;
-- 2. el robot con su token sube; lo inválido se salta
do $$ declare r json; begin
  r := robot_costos((select t from t_token), '[{"ref":"A|","producto":"A","costo":5,"unidad":"und"},{"ref":"B|","costo":"12.5","unidad":"kg"},{"ref":"C|","costo":0},{"ref":"","costo":3},{"ref":"D|","costo":"x"}]');
  if (r->>'costos')::int <> 2 then raise exception 'FALLO: guardó % (esperaba 2)', r; end if;
end $$;
reset role;
-- 3. no se filtran al catálogo público
do $$ begin if exists (select 1 from armador_datos where datos::text like '%costo%') then raise exception 'FALLO: costos en armador_datos'; end if; end $$;
set role authenticated;
-- 4. empleado con «mensajes» pero sin «costos»: no ve costos ni sube
set test.uid = 'e1000000-0000-0000-0000-000000000001';
do $$ begin perform costos_cotizar(); raise exception 'FALLO: empleado sin acceso cotizó'; exception when others then if sqlerrm not like '%Sin acceso%' then raise; end if; end $$;
do $$ begin perform costos_subir('[{"ref":"A|","costo":1}]'); raise exception 'FALLO: empleado subió costos'; exception when others then if sqlerrm not like '%Solo gerencia%' then raise; end if; end $$;
do $$ begin perform 1 from costos; raise exception 'FALLO: authenticated leyó la tabla'; exception when insufficient_privilege then null; end $$;
-- 5. Adolfo (acceso costos) cotiza pero no sube
set test.uid = 'b1000000-0000-0000-0000-000000000001';
do $$ declare r json; begin
  r := costos_cotizar();
  if json_array_length(r->'costos') <> 2 or (r->>'margen')::numeric <> 1 then raise exception 'FALLO: cotizar %', r; end if;
end $$;
do $$ begin perform costos_subir('[{"ref":"A|","costo":1}]'); raise exception 'FALLO: Adolfo subió costos'; exception when others then if sqlerrm not like '%Solo gerencia%' then raise; end if; end $$;
-- 6. gerencia sube el archivo a mano y cotiza
set test.uid = 'a1000000-0000-0000-0000-000000000001';
do $$ begin
  if costos_subir('[{"ref":"A|","costo":6,"unidad":"und"}]') <> 1 then raise exception 'FALLO: gerencia no subió'; end if;
  if (select (x->>'costo')::numeric from json_array_elements(costos_cotizar()->'costos') x where x->>'ref' = 'A|') <> 6 then raise exception 'FALLO: no actualizó'; end if;
end $$;
-- 7. desactivado: no cotiza aunque tenga acceso
reset role;
update personas set activo = false where id = 'b1000000-0000-0000-0000-000000000001';
set role authenticated; set test.uid = 'b1000000-0000-0000-0000-000000000001';
do $$ begin perform costos_cotizar(); raise exception 'FALLO: desactivado cotizó'; exception when others then if sqlerrm not like '%no está activo%' and sqlerrm not like '%Sin acceso%' then raise; end if; end $$;
reset role;
rollback;
\echo 'OK: costos solo para gerencia y acceso «costos»'
