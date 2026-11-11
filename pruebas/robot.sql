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
  if d->'productos'->10->'presentaciones'->0 ? 'stock' or not (d->'productos'->10->'presentaciones'->0 ? 'sin_actualizar') then
    raise exception 'FALLO: lo que no vino debe quedar con su stock y marcado sin actualizar: %', d->'productos'->10; end if;
  if d->'productos'->11->'presentaciones'->0 ? 'stock' then raise exception 'FALLO: tocó el stock del producto bajo pedido'; end if;
  if (d->'productos'->0->'presentaciones'->0 ? 'sin_actualizar') then raise exception 'FALLO: marcó sin actualizar uno que sí vino'; end if;
  if not exists (select 1 from bot_avisos where tipo = 'robot_pausados' and texto like '%Producto 11%') then raise exception 'FALLO: no avisó de lo que no vino'; end if;
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

-- 9b. Lo que quedó «stock sin actualizar» no se cotiza (pasa a humano sin precio); lo demás sí
reset role;
update armador_datos set datos = jsonb_set(datos, '{productos,10,presentaciones,0,sin_actualizar}', to_jsonb(now())) where id = 1;
do $$ declare r json; begin
  r := precios_bot('producto 11', 40);
  if (r->>'encontrados')::int <> 0 then raise exception 'FALLO: cotizó un producto con stock sin actualizar: %', r; end if;
  r := precios_bot('producto 10', 40);
  if (r->>'encontrados')::int <> 1 then raise exception 'FALLO: no cotizó un producto normal: %', r; end if;
  if not exists (select 1 from bot_avisos where tipo = 'robot_pausados' and urgente) then raise exception 'FALLO: el aviso de lo que no vino no es inmediato'; end if;
end $$;

-- 10. Producto con ficha que desaparece de Yobel: aviso para pasar la ficha
do $$ begin
  if not exists (select 1 from bot_avisos where tipo = 'robot_ficha' and texto like '%Producto 11%') then
    raise exception 'FALLO: no avisó del producto con ficha que desapareció';
  end if;
  if exists (select 1 from bot_avisos where tipo = 'robot_ficha' and texto like '%Producto 12%') then
    raise exception 'FALLO: avisó del producto bajo pedido';
  end if;
end $$;

-- 11. Guardar en el armador después de una subida del robot: no choca y no devuelve stock ni precios viejos
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a1') on conflict do nothing;
insert into personas (id, nombre, rol) values ('00000000-0000-0000-0000-0000000000a1', 'Gerencia prueba', 'admin') on conflict (id) do update set rol = 'admin', activo = true;
create temp table t_abierto as select datos, coalesce(editado_en, actualizado_en) as ver from armador_datos where id = 1;
grant select on t_abierto to authenticated;
-- el robot sube mientras el armador está abierto (precio 77 y stock 3 en el producto 1)
update armador_datos set datos = jsonb_set(jsonb_set(jsonb_set(datos, '{productos,0,presentaciones,0,precio}', '77'),
  '{productos,0,presentaciones,0,stock}', '3'), '{robot,fecha}', to_jsonb(now())), editado_en = coalesce(editado_en, actualizado_en), actualizado_en = clock_timestamp() where id = 1;
set role authenticated;
do $$ begin perform set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false); end $$;
do $$ declare d jsonb; v timestamptz; begin
  -- gerencia cambia la ficha del producto 1 con los datos que tenía al abrir
  select jsonb_set(datos, '{productos,0,ficha}', '"ficha nueva"'), ver into d, v from t_abierto;
  perform guardar_armador(d, v);
  select datos into d from armador_datos where id = 1;
  if d->'productos'->0->>'ficha' <> 'ficha nueva' then raise exception 'FALLO: no guardó la ficha'; end if;
  if (d->'productos'->0->'presentaciones'->0->>'precio')::numeric <> 77 then raise exception 'FALLO: devolvió un precio viejo'; end if;
  if (d->'productos'->0->'presentaciones'->0->>'stock')::numeric <> 3 then raise exception 'FALLO: devolvió un stock viejo'; end if;
  if (d->'robot'->>'fecha') is null then raise exception 'FALLO: borró la fecha del robot'; end if;
  -- un segundo guardado con la versión vieja sí choca (otra persona de gerencia)
  begin
    perform guardar_armador(d, v);
    raise exception 'FALLO: no avisó del guardado al mismo tiempo';
  exception when others then if sqlerrm not like '%al mismo tiempo%' then raise; end if;
  end;
end $$;
do $$ begin perform set_config('test.uid', '', false); end $$;
reset role;

-- 12. Contador de uso: suma una vez cada 10 s, ignora ids que no existen, y el bot ofrece primero el más usado
set role anon;
do $$ begin
  perform armador_usado(array['p3', 'p3', 'no-existe', 'Mal Id']);
  perform armador_usado(array['p3']);
end $$;
do $$ begin
  perform 1 from armador_usos;
  raise exception 'FALLO: anon leyó armador_usos';
exception when insufficient_privilege then null;
end $$;
reset role;
do $$ begin
  if (select veces from armador_usos where id = 'p3') <> 1 then raise exception 'FALLO contador: %', (select veces from armador_usos where id = 'p3'); end if;
  if exists (select 1 from armador_usos where id <> 'p3') then raise exception 'FALLO: contó un id que no existe'; end if;
end $$;

-- Productos con «V» delante (descontinuados en Yobel): no se avisan como nuevos
update armador_datos set datos = jsonb_set(datos, '{robot,fecha}', to_jsonb(now() - interval '1 hour')) where id = 1;
delete from bot_avisos where tipo = 'robot_nuevos';
set role anon;
do $$ begin
  raise notice 'subida: %', robot_subir((select t from t_token), (
    select jsonb_agg(jsonb_build_object('ref', v->>'ref', 'producto', p->>'nombre', 'precio', (v->>'precio')::numeric, 'stock', 5,
      'categoria', case when v->>'ref' = 'P1|||||' then 'Quesos finos' end))
    from armador_datos a, jsonb_array_elements(a.datos->'productos') p, jsonb_array_elements(p->'presentaciones') v where a.id = 1 and v ? 'ref'
  ) || '[{"ref":"VQUESO VIEJO|||||","producto":"VQUESO VIEJO","precio":5,"stock":1},{"ref":"Aceite nuevo|||||","producto":"Aceite nuevo","precio":7,"stock":2}]'::jsonb);
end $$;
reset role;
do $$ declare t text; begin
  select string_agg(texto, ' ') into t from bot_avisos where tipo = 'robot_nuevos';
  if t is null or t not like '%Aceite nuevo%' then raise exception 'FALLO: no avisó el producto nuevo: %', t; end if;
  if t like '%VQUESO%' then raise exception 'FALLO: avisó un descontinuado (V) como nuevo: %', t; end if;
  -- la categoría corregida en Yobel llega al armador; sin categoría en el archivo, no se borra la que había
  if (select p->>'categoria' from armador_datos a, jsonb_array_elements(a.datos->'productos') p where a.id = 1 and p->>'id' = 'p1') <> 'Quesos finos' then
    raise exception 'FALLO: no actualizó la categoría'; end if;
  -- lo nuevo no se crea: queda en la fila «Nuevos por aprobar»
  if exists (select 1 from armador_datos a, jsonb_array_elements(a.datos->'productos') p where a.id = 1 and p->>'nombre' = 'Aceite nuevo') then
    raise exception 'FALLO: creó el producto nuevo sin aprobación'; end if;
  if not exists (select 1 from armador_datos a, jsonb_array_elements(a.datos->'nuevos') x where a.id = 1 and x->>'ref' = 'Aceite nuevo|||||' and (x->>'precio')::numeric = 7) then
    raise exception 'FALLO: el nuevo no quedó en la fila: %', (select datos->'nuevos' from armador_datos where id = 1); end if;
  if exists (select 1 from armador_datos a, jsonb_array_elements(a.datos->'nuevos') x where a.id = 1 and x->>'producto' like 'VQUESO%') then
    raise exception 'FALLO: un descontinuado quedó en la fila'; end if;
end $$;

-- Lo que gerencia descartó no vuelve a la fila
update armador_datos set datos = jsonb_set(jsonb_set(datos, '{descartados}', '["Aceite nuevo|||||"]'), '{robot,fecha}', to_jsonb(now() - interval '1 hour')) where id = 1;
delete from bot_avisos where tipo = 'robot_nuevos';
set role anon;
do $$ begin
  perform robot_subir((select t from t_token), (
    select jsonb_agg(jsonb_build_object('ref', v->>'ref', 'producto', p->>'nombre', 'precio', (v->>'precio')::numeric, 'stock', 5))
    from armador_datos a, jsonb_array_elements(a.datos->'productos') p, jsonb_array_elements(p->'presentaciones') v where a.id = 1 and v ? 'ref'
  ) || '[{"ref":"Aceite nuevo|||||","producto":"Aceite nuevo","precio":7,"stock":2}]'::jsonb);
end $$;
reset role;
do $$ begin
  if jsonb_array_length((select datos->'nuevos' from armador_datos where id = 1)) <> 0 then raise exception 'FALLO: volvió a la fila algo descartado'; end if;
  if exists (select 1 from bot_avisos where tipo = 'robot_nuevos') then raise exception 'FALLO: avisó un descartado'; end if;
end $$;

-- Descripción de Yobel (11/11/2026): el robot la trae, no se borra si viene vacía y el bot la ve en ficha_producto
update armador_datos set datos = jsonb_set(datos, '{robot,fecha}', to_jsonb(now() - interval '1 hour')) where id = 1;
set role anon;
do $$ begin
  perform robot_subir((select t from t_token), (
    select jsonb_agg(jsonb_build_object('ref', v->>'ref', 'producto', p->>'nombre', 'precio', (v->>'precio')::numeric, 'stock', 5)
      || case when p->>'id' = 'p1' then '{"descripcion":"Queso de vaca madurado."}'::jsonb else '{}'::jsonb end)
    from armador_datos a, jsonb_array_elements(a.datos->'productos') p, jsonb_array_elements(p->'presentaciones') v where a.id = 1 and v ? 'ref'));
end $$;
reset role;
update armador_datos set datos = jsonb_set(datos, '{robot,fecha}', to_jsonb(now() - interval '1 hour')) where id = 1;
set role anon;
do $$ begin
  perform robot_subir((select t from t_token), (
    select jsonb_agg(jsonb_build_object('ref', v->>'ref', 'producto', p->>'nombre', 'precio', (v->>'precio')::numeric, 'stock', 5, 'descripcion', ''))
    from armador_datos a, jsonb_array_elements(a.datos->'productos') p, jsonb_array_elements(p->'presentaciones') v where a.id = 1 and v ? 'ref'));
end $$;
reset role;
do $$ declare nom text; f json; begin
  select p->>'nombre' into nom from armador_datos a, jsonb_array_elements(a.datos->'productos') p where a.id = 1 and p->>'id' = 'p1';
  if (select p->>'descripcion' from armador_datos a, jsonb_array_elements(a.datos->'productos') p where a.id = 1 and p->>'id' = 'p1') is distinct from 'Queso de vaca madurado.' then
    raise exception 'FALLO: la descripción del robot no llegó o se borró'; end if;
  update armador_datos a set datos = jsonb_set(datos, '{productos}', (select jsonb_agg(case when p->>'id' = 'p1' then p || '{"notas":"Combina con membrillo."}' else p end) from jsonb_array_elements(a.datos->'productos') p)) where id = 1;
  f := ficha_producto(nom);
  if f::text not like '%Queso de vaca madurado.%' then raise exception 'FALLO: el bot no ve la descripción: %', f; end if;
  if f::text not like '%Notas del equipo: Combina con membrillo.%' then raise exception 'FALLO: el bot no ve las notas: %', f; end if;
  if (select count(*) from bot_config where clave = 'reglas' and valor like '%DATOS DEL PRODUCTO (origen%') <> 1
     or (select valor from bot_config where clave = 'reglas') like '%DATOS DEL PRODUCTO (origen%DATOS DEL PRODUCTO (origen%'
     or (select valor from bot_config where clave = 'reglas') like '%DATOS TÉCNICOS%' then raise exception 'FALLO: reglas de la ficha'; end if;
end $$;

rollback;
\echo 'OK: pruebas del robot'
