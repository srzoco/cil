-- Armador: quien tiene el acceso «aprobar» (Adolfo, 20/11/2026) aprueba el descuento de Yobel y los productos nuevos,
-- pero no puede cambiar el resto del catálogo. Un empleado sin el acceso no puede nada. Corre después de cil.sql.
\set ON_ERROR_STOP 1
begin;
insert into auth.users (id, email) values ('a3000000-0000-0000-0000-000000000001', 'aprueba@x.com'),
  ('e3000000-0000-0000-0000-000000000001', 'sin-aprobar@x.com') on conflict do nothing;
update personas set rol = 'empleado', activo = true, accesos = '{tareas,mensajes,aprobar}' where id = 'a3000000-0000-0000-0000-000000000001';
update personas set rol = 'empleado', activo = true, accesos = '{tareas,mensajes}' where id = 'e3000000-0000-0000-0000-000000000001';
update bot_config set valor = '23:59' where clave = 'descuento_hora_limite';
insert into armador_datos (id) values (1) on conflict (id) do nothing;
update armador_datos set datos = '{"productos":[
   {"id":"jamon","nombre":"Jamón serrano","ficha":"De bellota","presentaciones":[{"texto":"","precio":30,"ref":"Jamón|||||","stock":2,"sin_actualizar":"2026-11-19"},{"texto":"a mano","precio":5}]},
   {"id":"queso","nombre":"Queso","presentaciones":[{"texto":"","precio":9,"ref":"Queso|||||","stock":1}]}],
  "nuevos":[{"ref":"Jamón ibérico|||||","producto":"Jamón ibérico","precio":31,"stock":3},
            {"ref":"Aceite|||1L||","producto":"Aceite","precio":12,"stock":6},
            {"ref":"Rara|||||","producto":"Rara","precio":3,"stock":0}],
  "descartados":[]}'::jsonb where id = 1;
delete from robot_descuentos where fecha = hoy();
insert into robot_descuentos (fecha, descuento, en_yobel, estado) values (hoy(), 43, 41, 'pendiente');

set role authenticated;
-- 1. sin el acceso: no ve ni aprueba nada
set test.uid = 'e3000000-0000-0000-0000-000000000001';
do $$ begin
  if (armador_permisos()->>'aprobar')::boolean then raise exception 'FALLO: empleado sin acceso puede aprobar'; end if;
  begin perform descuento_yobel_hoy(); raise exception 'FALLO: vio el descuento'; exception when others then if sqlerrm like 'FALLO%' then raise; end if; end;
  begin perform armador_cola('no', '{Rara|||||}', null); raise exception 'FALLO: aprobó sin acceso'; exception when others then if sqlerrm like 'FALLO%' then raise; end if; end;
end $$;

-- 2. con el acceso «aprobar»
set test.uid = 'a3000000-0000-0000-0000-000000000001';
do $$ declare d jsonb; begin
  if not (armador_permisos()->>'aprobar')::boolean or (armador_permisos()->>'admin')::boolean then raise exception 'FALLO: permisos %', armador_permisos(); end if;
  if (descuento_yobel_hoy()->>'estado') <> 'pendiente' then raise exception 'FALLO: no ve el descuento'; end if;
  if (descuento_yobel_aprobar(43, true)->>'estado') <> 'aprobado' then raise exception 'FALLO: no aprobó el descuento'; end if;
  -- no puede guardar el catálogo entero
  begin perform guardar_armador('{"productos":[]}'::jsonb, null); raise exception 'FALLO: guardó el catálogo'; exception when others then if sqlerrm like 'FALLO%' then raise; end if; end;
  -- agregar
  perform armador_cola('agregar', '{Aceite|||1L||}', '{"id":"aceite","nombre":"Aceite","presentaciones":[{"texto":"1L","precio":12,"ref":"Aceite|||1L||","stock":6}]}');
  -- juntar con uno que ya está: conserva la presentación a mano
  perform armador_cola('mismo', '{Jamón ibérico|||||}', '{"id":"jamon","nombre":"Jamón ibérico","ficha":"De bellota","presentaciones":[{"texto":"","precio":31,"ref":"Jamón ibérico|||||","stock":3},{"texto":"a mano","precio":5}]}');
  -- no agregar
  perform armador_cola('no', '{Rara|||||}', null);
end $$;
reset role;
do $$ declare d jsonb; begin
  select datos into d from armador_datos where id = 1;
  if jsonb_array_length(d->'nuevos') <> 0 then raise exception 'FALLO: la fila no quedó vacía %', d->'nuevos'; end if;
  if jsonb_array_length(d->'productos') <> 3 then raise exception 'FALLO: productos %', d->'productos'; end if;
  if not (d->'descartados') ? 'Rara|||||' then raise exception 'FALLO: no descartó'; end if;
  if (select p->>'nombre' from jsonb_array_elements(d->'productos') p where p->>'id' = 'jamon') <> 'Jamón ibérico' then raise exception 'FALLO: no juntó'; end if;
  if (select p->>'nombre' from jsonb_array_elements(d->'productos') p where p->>'id' = 'queso') <> 'Queso' then raise exception 'FALLO: tocó otro producto'; end if;
end $$;

-- 3. lo que no se puede por aquí: cambiar otro producto, meter un código que no está por aprobar, repetir
update armador_datos set datos = jsonb_set(datos, '{nuevos}', '[{"ref":"Nuevo|||||","producto":"Nuevo","precio":4,"stock":1}]') where id = 1;
set role authenticated;
do $$ begin
  begin perform armador_cola('mismo', '{Nuevo|||||}', '{"id":"queso","nombre":"Queso","presentaciones":[{"texto":"","precio":0.01,"ref":"Queso|||||"}]}');
    raise exception 'FALLO: cambió el precio de otro producto'; exception when others then if sqlerrm like 'FALLO%' then raise; end if; end;
  begin perform armador_cola('mismo', '{Nuevo|||||}', '{"id":"queso","nombre":"Nuevo","presentaciones":[{"texto":"","precio":4,"ref":"Nuevo|||||"},{"texto":"inventada","precio":0.01}]}');
    raise exception 'FALLO: metió una presentación a mano inventada'; exception when others then if sqlerrm like 'FALLO%' then raise; end if; end;
  begin perform armador_cola('agregar', '{Queso|||||}', '{"id":"queso2","nombre":"Q","presentaciones":[{"ref":"Queso|||||","precio":1}]}');
    raise exception 'FALLO: aprobó algo que no estaba por aprobar'; exception when others then if sqlerrm like 'FALLO%' then raise; end if; end;
  begin perform armador_cola('agregar', '{Nuevo|||||}', '{"id":"queso","nombre":"Nuevo","presentaciones":[{"ref":"Nuevo|||||","precio":4}]}');
    raise exception 'FALLO: pisó un producto al agregar'; exception when others then if sqlerrm like 'FALLO%' then raise; end if; end;
end $$;
-- 4. el acceso «catalogo» (se quita en Equipo → Personas): edita el catálogo y el descuento del día; sin él, no
do $$ begin
  begin perform fijar_descuento(40); raise exception 'FALLO: fijó el descuento sin «catalogo»'; exception when others then if sqlerrm like 'FALLO%' then raise; end if; end;
  if (armador_permisos()->>'editar')::boolean then raise exception 'FALLO: editar sin el acceso'; end if;
end $$;
reset role;
update personas set accesos = '{tareas,mensajes,catalogo}' where id = 'a3000000-0000-0000-0000-000000000001';
create temp table t_ver as select coalesce(editado_en, actualizado_en) as v from armador_datos where id = 1;
grant select on t_ver to authenticated;
set role authenticated;
do $$ begin
  if not (armador_permisos()->>'editar')::boolean then raise exception 'FALLO: no sale «editar»'; end if;
  perform guardar_armador('{"productos":[{"id":"x","nombre":"X","presentaciones":[]}]}'::jsonb, (select v from t_ver));
  perform fijar_descuento(40);
  begin perform costos_subir('[]'::jsonb); raise exception 'FALLO: subió costos sin el acceso «costos»'; exception when others then if sqlerrm like 'FALLO%' then raise; end if; end;
end $$;
reset role;
do $$ begin
  if (select jsonb_array_length(datos->'productos') from armador_datos where id = 1) <> 1 then raise exception 'FALLO: no guardó el catálogo'; end if;
  if (select descuento_manual from armador_datos where id = 1) <> 40 then raise exception 'FALLO: no fijó el descuento'; end if;
end $$;
rollback;
\echo 'OK: «aprobar» aprueba el descuento y los productos nuevos y nada más; «catalogo» edita el catálogo'
