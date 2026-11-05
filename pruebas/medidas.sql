-- Medidas del precio del Armador (por gramo, por kilo…): el bot dice «$x el gramo». Corre después de cil.sql.
do $$
declare m text; viejo jsonb;
begin
  select datos into viejo from armador_datos where id = 1;
  insert into armador_datos (id, datos) values (1, '{"productos":[{"id":"vai","nombre":"Vainilla en rama","emoji":"🌿","presentaciones":[{"texto":"","precio":0.5,"medida":"g","kilo":false},{"texto":"de la barra","precio":20,"kilo":true},{"texto":"de 1 l","precio":7,"medida":"l"}]}]}')
  on conflict (id) do update set datos = excluded.datos;
  m := public.precios_bot('vainilla', 0)->>'mensaje';
  if m not like '%$0.5 el gramo%' then raise exception 'Falta «el gramo»: %', m; end if;
  if m not like '%$20 el kilo de la barra%' then raise exception 'Los datos viejos (kilo) ya no dicen «el kilo»: %', m; end if;
  if m not like '%$7 el litro de 1 l%' then raise exception 'Falta «el litro»: %', m; end if;
  if viejo is null then delete from armador_datos where id = 1; else update armador_datos set datos = viejo where id = 1; end if;
  raise notice 'OK: medidas del precio en el bot';
end $$;
