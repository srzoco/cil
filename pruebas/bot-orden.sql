-- Orden de la lista de precios del bot (13/11/2026, regla de Sara, igual que el Armador): primero SIEMPRE lo más caro
-- y cada marca junta (lo que va después del último « - » del nombre). Corre después de cil.sql.
do $$
declare m text; viejo jsonb; pos int[];
begin
  select datos into viejo from armador_datos where id = 1;
  insert into armador_datos (id, datos) values (1, '{"productos":[
    {"id":"a1","nombre":"Queso tipo Manchego Semicurado 1/4 torta - Adarga de Oro","emoji":"🧀","presentaciones":[{"texto":"","precio":76,"medida":"kg"}]},
    {"id":"m1","nombre":"Queso Manchego con DOP 1/4 Torta - Mancha Real","emoji":"🧀","presentaciones":[{"texto":"","precio":100,"medida":"kg"}]},
    {"id":"a2","nombre":"Queso tipo Manchego con trufa 1/4 torta - Adarga de Oro","emoji":"🧀","presentaciones":[{"texto":"","precio":122.5,"medida":"kg"}]},
    {"id":"m2","nombre":"Queso Manchego con DOP 3 Kg - Mancha Real","emoji":"🧀","presentaciones":[{"texto":"la pieza","precio":90,"medida":"kg"},{"texto":"en cuñas","precio":105,"medida":"kg"}]}]}')
  on conflict (id) do update set datos = excluded.datos;
  m := public.precios_bot('manchego', 0)->>'mensaje';
  pos := array[position('trufa' in m), position('Semicurado 1/4' in m), position('DOP 3 Kg' in m), position('DOP 1/4' in m)];
  if 0 = any(pos) or not (pos[1] < pos[2] and pos[2] < pos[3] and pos[3] < pos[4]) then
    raise exception 'FALLO: orden del bot %: %', pos, m; end if;
  if position('en cuñas' in m) > position('la pieza' in m) then raise exception 'FALLO: dentro del producto no va primero lo más caro: %', m; end if;
  if (regexp_match(m, '\$([0-9.]+)'))[1] <> '122.5' then raise exception 'FALLO: el primer precio no es el más caro: %', m; end if;
  if viejo is null then delete from armador_datos where id = 1; else update armador_datos set datos = viejo where id = 1; end if;
  raise notice 'OK: el bot empieza por lo más caro y cada marca va junta';
end $$;
