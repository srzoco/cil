-- Pruebas del robot de Yobel (robot_subir / robot_error). Se corre después de cil.sql.
-- Cada bloque falla con un error si algo no se cumple.
\set ON_ERROR_STOP 1
begin;

-- Catálogo de prueba: 12 productos con 1 presentación cada uno (uno marcado bajo pedido)
update armador_datos set datos = null where id = 1;
insert into armador_datos(id, datos) values (1, null) on conflict (id) do nothing;
update armador_datos set datos = jsonb_build_object('productos', (
  select jsonb_agg(jsonb_build_object('id', 'p' || i, 'nombre', 'Producto ' || i, 'bajo_pedido', i = 12, 'ficha', 'ficha ' || i,
    'presentaciones', jsonb_build_array(jsonb_build_object('texto', 'unidad', 'precio', 10 * i, 'ref', 'P' || i || '|||||'))))
  from generate_series(1, 12) i)) where id = 1;

create temp table t_token as select robot_nuevo_token() as t;
grant select on t_token to anon;
create temp table t_filas as select jsonb_agg(jsonb_build_object('ref', 'P' || i || '|||||', 'producto', 'Producto ' || i,
  'precio', 10 * i + 1, 'stock', 5, 'costo', 999)) as f from generate_series(1, 11) i;
grant select on t_filas to anon;

set role anon;

-- 1. Token falso: rechazado
do $$ begin
  perform robot_subir('falso', (select f from t_filas));
  raise exception 'FALLO: aceptó un token falso';
exception when others then
  if sqlerrm not like '%no autorizado%' then raise; end if;
end $$;

-- 2. anon no puede crear tokens
do $$ begin
  perform robot_nuevo_token();
  raise exception 'FALLO: anon creó un token';
exception when insufficient_privilege then null;
end $$;

-- 3. anon no lee las tablas del bot
do $$ begin
  perform 1 from bot_config;
  raise exception 'FALLO: anon leyó bot_config';
exception when insufficient_privilege then null;
end $$;

-- 4. Subida normal (P11 con precio 0 se ignora y queda pausado; los costos no se guardan)
do $$ declare r json; d jsonb; begin
  r := robot_subir((select t from t_token), (select jsonb_agg(case when x->>'ref' = 'P11|||||' then x || '{"precio":0}' else x end) from t_filas, jsonb_array_elements(f) x));
  if (r->>'ok')::boolean is not true then raise exception 'FALLO subida normal: %', r; end if;
  reset role;
  select datos into d from armador_datos where id = 1;
  if d::text like '%costo%' or d::text like '%999%' then raise exception 'FALLO: se guardaron costos'; end if;
  if (d->'productos'->0->'presentaciones'->0->>'precio')::numeric <> 11 then raise exception 'FALLO: precio no actualizado'; end if;
  if (d->'productos'->10->'presentaciones'->0->>'stock')::numeric <> 0 then raise exception 'FALLO: precio 0 no se pausó'; end if;
  if d->'productos'->11->'presentaciones'->0 ? 'stock' then raise exception 'FALLO: tocó el producto bajo pedido'; end if;
  if d->'productos'->0->>'ficha' <> 'ficha 1' then raise exception 'FALLO: tocó la ficha'; end if;
  set role anon;
end $$;

-- 5. Dos subidas seguidas: la segunda se frena
do $$ declare r json; begin
  r := robot_subir((select t from t_token), (select f from t_filas));
  if r->>'error' is distinct from 'muy_seguido' then raise exception 'FALLO freno de 3 min: %', r; end if;
end $$;

reset role;
update armador_datos set datos = jsonb_set(datos, '{robot,fecha}', to_jsonb(now() - interval '1 hour')) where id = 1;
set role anon;

-- 6. Cambio masivo de precios: no se aplica y avisa urgente
do $$ declare r json; begin
  r := robot_subir((select t from t_token), (select jsonb_agg(x || jsonb_build_object('precio', (x->>'precio')::numeric * 3)) from t_filas, jsonb_array_elements(f) x));
  if r->>'error' is distinct from 'cambio_masivo' then raise exception 'FALLO freno cambio masivo: %', r; end if;
  reset role;
  if (select (datos->'productos'->0->'presentaciones'->0->>'precio')::numeric from armador_datos where id = 1) <> 11 then raise exception 'FALLO: aplicó el cambio masivo'; end if;
  if not exists (select 1 from bot_avisos where tipo = 'robot_cambio_masivo' and urgente) then raise exception 'FALLO: no avisó el cambio masivo'; end if;
  set role anon;
end $$;

-- 7. Con robot_forzar = si se aplica una vez y vuelve a no
reset role;
update bot_config set valor = 'si' where clave = 'robot_forzar';
set role anon;
do $$ declare r json; begin
  r := robot_subir((select t from t_token), (select jsonb_agg(x || jsonb_build_object('precio', (x->>'precio')::numeric * 3)) from t_filas, jsonb_array_elements(f) x));
  if (r->>'ok')::boolean is not true then raise exception 'FALLO forzar: %', r; end if;
  reset role;
  if (select valor from bot_config where clave = 'robot_forzar') <> 'no' then raise exception 'FALLO: robot_forzar no volvió a no'; end if;
  update armador_datos set datos = jsonb_set(datos, '{robot,fecha}', to_jsonb(now() - interval '1 hour')) where id = 1;
  set role anon;
end $$;

-- 8. Pocas filas: no se aplica
do $$ declare r json; begin
  r := robot_subir((select t from t_token), (select jsonb_agg(x) from t_filas, jsonb_array_elements(f) with ordinality e(x, n) where n <= 3));
  if r->>'error' is distinct from 'pocas_filas' then raise exception 'FALLO freno pocas filas: %', r; end if;
end $$;

-- 9. robot_error: token falso rechazado y máximo 5 avisos distintos al día
do $$ begin
  perform robot_error('falso', 'x');
  raise exception 'FALLO: robot_error aceptó token falso';
exception when others then
  if sqlerrm not like '%no autorizado%' then raise; end if;
end $$;
do $$ begin
  for i in 1..9 loop perform robot_error((select t from t_token), 'problema distinto número ' || i || ' ' || md5(i::text)); end loop;
end $$;
reset role;
do $$ begin
  if (select count(*) from bot_avisos where tipo like 'robot_error:%') <> 5 then raise exception 'FALLO: tope de avisos del robot'; end if;
end $$;

rollback;
\echo 'OK: pruebas del robot'
