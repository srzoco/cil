-- Prueba de seguridad: un empleado (E1), alguien de Contenido (C) y alguien desactivado (X) intentan todo lo
-- que no deberían. Cada línea dice BLOQUEADO o PERMITIDO (n filas). pruebas.yml falla si algo que debía
-- bloquearse pasa (RPC/INTERNA/TABLA con filas > 0, o LEER más de lo esperado).
insert into auth.users (id, email) values
 ('a0000000-0000-0000-0000-000000000001','adm@x.com'), ('e0000000-0000-0000-0000-000000000001','e1@x.com'),
 ('e0000000-0000-0000-0000-000000000002','e2@x.com'), ('c0000000-0000-0000-0000-000000000001','c@x.com'),
 ('d0000000-0000-0000-0000-000000000001','x@x.com');
update personas set rol='admin', nombre='Adm' where id='a0000000-0000-0000-0000-000000000001';
update personas set nombre='E1', accesos='{tareas}' where id='e0000000-0000-0000-0000-000000000001';
update personas set nombre='E2', accesos='{tareas}' where id='e0000000-0000-0000-0000-000000000002';
update personas set nombre='C', accesos='{contenido}' where id='c0000000-0000-0000-0000-000000000001';
update personas set nombre='X', accesos='{tareas}', activo=false where id='d0000000-0000-0000-0000-000000000001';
update locales set dias_laborables='{0,1,2,3,4,5,6}';
insert into plantillas (titulo, minutos, frecuencia, fecha_inicio, activa) values ('T1', 10, 'diaria', public.hoy()-1, true), ('T2', 15, 'diaria', public.hoy()-1, true), ('T3', 20, 'diaria', public.hoy()-1, true);
set test.uid='a0000000-0000-0000-0000-000000000001';
select public.generar_dia(public.hoy());
insert into asistencia (persona_id, fecha, estado, llegada) values ('e0000000-0000-0000-0000-000000000002', public.hoy(), 'presente', now());
create or replace function public.prueba(etq text, q text, uid uuid) returns text language plpgsql as $f$
declare n int; begin
  perform set_config('test.uid', uid::text, true);
  execute 'set local role authenticated';
  begin execute q; get diagnostics n = row_count;
  exception when others then execute 'reset role'; return rpad(etq, 58) || ' BLOQUEADO: ' || left(sqlerrm, 60); end;
  execute 'reset role';
  return rpad(etq, 58) || ' PERMITIDO (' || n || ' filas)';
end $f$;
\pset tuples_only on
select id as t2 from asignaciones where asignado_a='e0000000-0000-0000-0000-000000000002' limit 1 \gset
select id as t1 from asignaciones where asignado_a='e0000000-0000-0000-0000-000000000001' limit 1 \gset
\set E1 '''e0000000-0000-0000-0000-000000000001'''
select public.prueba('RPC reasignar', format($q$select public.reasignar('[{"id":"%s","a":"e0000000-0000-0000-0000-000000000001"}]'::jsonb)$q$, :'t2'), :E1);
select public.prueba('RPC marcar_asistencia otro', $$select public.marcar_asistencia('e0000000-0000-0000-0000-000000000002','ausente')$$, :E1);
select public.prueba('RPC cambiar_clave otro', $$select public.cambiar_clave('e0000000-0000-0000-0000-000000000002','12345678')$$, :E1);
select public.prueba('RPC crear_persona', $$select public.crear_persona('Z','z@x.com','12345678',null,'{tareas}','admin')$$, :E1);
select public.prueba('RPC aprobar_oculta', $$select public.aprobar_oculta('$$ || :'t2' || $$', null)$$, :E1);
select public.prueba('RPC reprogramar_oculta', $$select public.reprogramar_oculta('$$ || :'t2' || $$', public.hoy()+3)$$, :E1);
select public.prueba('RPC registrar_red', $$select public.registrar_red((select id from locales limit 1))$$, :E1);
select public.prueba('RPC sin_wifi_hoy', $$select public.sin_wifi_hoy((select id from locales limit 1), true)$$, :E1);
select public.prueba('RPC revisar_justificacion', $$select public.revisar_justificacion('$$ || :'t2' || $$', true)$$, :E1);
select public.prueba('RPC guardar_armador', $$select public.guardar_armador('{"productos":[]}'::jsonb, null)$$, :E1);
select public.prueba('RPC fijar_descuento', $$select public.fijar_descuento(10)$$, :E1);
select public.prueba('RPC forzar_tasas', $$select public.forzar_tasas()$$, :E1);
select public.prueba('RPC generar_dia mañana', $$select public.generar_dia(public.hoy()+1)$$, :E1);
select public.prueba('RPC mi_red (admin)', $$select public.mi_red()$$, :E1);
select public.prueba('RPC marcar_almuerzo por otro', $$select public.marcar_almuerzo('e0000000-0000-0000-0000-000000000002')$$, :E1);
select public.prueba('RPC marcar_hecha tarea de otro', $$select public.marcar_hecha('$$ || :'t2' || $$', true)$$, :E1);
select public.prueba('RPC justificar tarea de otro', $$select public.justificar('$$ || :'t2' || $$', 'no pude')$$, :E1);
select public.prueba('RPC registrar_lecturas de otro', $$select public.registrar_lecturas('$$ || :'t2' || $$', '[]'::jsonb)$$, :E1);
select public.prueba('RPC rescatar tarea no urgente', $$select public.rescatar('$$ || :'t2' || $$')$$, :E1);
select public.prueba('RPC tomar_del_pool asignada', $$select public.tomar_del_pool('$$ || :'t2' || $$')$$, :E1);
select public.prueba('INTERNA _llegada', $$select public._llegada('e0000000-0000-0000-0000-000000000001','gerencia')$$, :E1);
select public.prueba('INTERNA _hecha', $$select public._hecha('$$ || :'t2' || $$', true, true)$$, :E1);
select public.prueba('INTERNA _repartir_local', $$select public._repartir_local((select id from locales limit 1), true)$$, :E1);
select public.prueba('INTERNA _compensar', $$select public._compensar('e0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000001',30)$$, :E1);
select public.prueba('INTERNA avisos_pendientes', $$select * from public.avisos_pendientes()$$, :E1);
select public.prueba('TABLA hacerme admin', $$update personas set rol='admin' where id='e0000000-0000-0000-0000-000000000001'$$, :E1);
select public.prueba('TABLA darme accesos', $$update personas set accesos='{tareas,contenido,mensajes}' where id='e0000000-0000-0000-0000-000000000001'$$, :E1);
select public.prueba('TABLA editar otra persona', $$update personas set nombre='hack' where id='e0000000-0000-0000-0000-000000000002'$$, :E1);
select public.prueba('TABLA crear plantilla', $$insert into plantillas (titulo, minutos, frecuencia, fecha_inicio) values ('h',5,'diaria',public.hoy())$$, :E1);
select public.prueba('TABLA editar plantilla', $$update plantillas set minutos=1$$, :E1);
select public.prueba('TABLA quitarme tarea', $$update asignaciones set asignado_a='e0000000-0000-0000-0000-000000000002' where id='$$ || :'t1' || $$'$$, :E1);
select public.prueba('TABLA marcar hecha directo', $$update asignaciones set estado='hecha' where id='$$ || :'t1' || $$'$$, :E1);
select public.prueba('TABLA borrar tareas', $$delete from asignaciones$$, :E1);
select public.prueba('TABLA crear tarea', $$insert into asignaciones (fecha, titulo, minutos) values (public.hoy(),'x',1)$$, :E1);
select public.prueba('TABLA marcarme llegada directo', $$insert into asistencia (persona_id, fecha, estado, llegada) values ('e0000000-0000-0000-0000-000000000001', public.hoy(), 'presente', now()-interval '3 hours')$$, :E1);
select public.prueba('TABLA cambiar asistencia otro', $$update asistencia set estado='ausente'$$, :E1);
select public.prueba('TABLA ajustes', $$update tareas_ajustes set hora_limite='12:00'$$, :E1);
select public.prueba('TABLA locales (redes)', $$update locales set redes='{1.1.1.1}'$$, :E1);
select public.prueba('TABLA crear local', $$insert into locales (nombre) values ('h')$$, :E1);
select public.prueba('TABLA días especiales', $$insert into dias_especiales (fecha, tipo, nombre) values (public.hoy(),'libre','h')$$, :E1);
select public.prueba('TABLA día sin puntualidad', $$insert into dias_sin_puntualidad (fecha) values (public.hoy())$$, :E1);
select public.prueba('TABLA suscripción a nombre de otro', $$insert into suscripciones (persona_id, endpoint, p256dh, auth) values ('e0000000-0000-0000-0000-000000000002','https://x','a','b')$$, :E1);
select public.prueba('TABLA armador', $$update armador_datos set datos='{}'$$, :E1);
select public.prueba('TABLA eventos', $$insert into tareas_eventos (tipo) values ('x')$$, :E1);
select public.prueba('TABLA avisos_cola', $$insert into avisos_cola (persona_id, titulo) values ('e0000000-0000-0000-0000-000000000002','spam')$$, :E1);
select public.prueba('TABLA grupos', $$insert into grupos (nombre) values ('h')$$, :E1);
select public.prueba('TABLA equipos', $$update equipos set temp_min=-100$$, :E1);
select public.prueba('LEER personas (debe ser 1)', $$select * from personas$$, :E1);
select public.prueba('LEER asistencia de otros (0)', $$select * from asistencia where persona_id<>'e0000000-0000-0000-0000-000000000001'$$, :E1);
select public.prueba('LEER tareas de otros (0)', $$select * from asignaciones where asignado_a<>'e0000000-0000-0000-0000-000000000001'$$, :E1);
select public.prueba('LEER plantillas (0)', $$select * from plantillas$$, :E1);
select public.prueba('LEER historial eventos (0)', $$select * from tareas_eventos$$, :E1);
select public.prueba('LEER revisiones (0)', $$select * from revisiones$$, :E1);
select public.prueba('LEER lecturas (0)', $$select * from lecturas$$, :E1);
select public.prueba('LEER suscripciones otros (0)', $$select * from suscripciones where persona_id<>'e0000000-0000-0000-0000-000000000001'$$, :E1);
select public.prueba('LEER avisos_cola (0)', $$select * from avisos_cola$$, :E1);
select public.prueba('LEER avisos_enviados (0)', $$select * from avisos_enviados$$, :E1);
select public.prueba('LEER redes_nuevas (0)', $$select * from redes_nuevas$$, :E1);
select public.prueba('LEER repartos_auto (0)', $$select * from repartos_auto$$, :E1);
select public.prueba('C (contenido) marcar_llegada', $$select public.marcar_llegada()$$, 'c0000000-0000-0000-0000-000000000001');
select public.prueba('X (desactivado) marcar_llegada', $$select public.marcar_llegada()$$, 'd0000000-0000-0000-0000-000000000001');
select public.prueba('X (desactivado) marcar_hecha', $$select public.marcar_hecha((select id from asignaciones limit 1), true)$$, 'd0000000-0000-0000-0000-000000000001');
select public.prueba('RPC reasignar', format($q$select public.reasignar('[{"id":"%s","a":"e0000000-0000-0000-0000-000000000001"}]'::jsonb)$q$, :'t2'), 'e0000000-0000-0000-0000-000000000001');
select public.prueba('E1 datos_app asignaciones ajenas', $q$select 1 from json_array_elements(public.datos_app(true)->'asignaciones') x where x->>'asignado_a' <> 'e0000000-0000-0000-0000-000000000001'$q$, 'e0000000-0000-0000-0000-000000000001');
select public.prueba('E1 menu_pendientes', 'select public.menu_pendientes()', 'e0000000-0000-0000-0000-000000000001');
insert into consumibles (local_id, nombre, unidad, stock) select id, 'Café prueba', 'paquete', 5 from locales where principal on conflict do nothing;
select id as cons from consumibles limit 1 \gset
select public.prueba('RPC entregar consumible', format($q$select public.entregar_consumible(%L, 'e0000000-0000-0000-0000-000000000001', 1, null)$q$, :'cons'), :E1);
select public.prueba('RPC compra consumible', format($q$select public.mover_consumible(%L, 'compra', 5, null)$q$, :'cons'), :E1);
select public.prueba('RPC conteo consumible', format($q$select public.mover_consumible(%L, 'ajuste', 99, null)$q$, :'cons'), :E1);
select public.prueba('TABLA consumibles stock', $q$update consumibles set stock = 999$q$, :E1);
select public.prueba('TABLA crear consumible', $q$insert into consumibles (local_id, nombre) select id, 'x' from locales limit 1$q$, :E1);
select public.prueba('TABLA movimiento directo', $q$insert into consumibles_mov (consumible_id, tipo, cantidad) select id, 'compra', 1 from consumibles limit 1$q$, :E1);
select public.prueba('LEER inventario (0)', 'select * from consumibles', :E1);
select public.prueba('LEER movimientos (0)', 'select * from consumibles_mov', :E1);
select public.prueba('LEER pedidos (0)', 'select * from consumibles_pedidos', :E1);
select public.prueba('C (contenido) pedir consumible', format($q$select public.pedir_consumible(%L, null)$q$, :'cons'), 'c0000000-0000-0000-0000-000000000001');
select public.prueba('E1 manda aviso de prueba a E2', $q$select public.aviso_prueba('e0000000-0000-0000-0000-000000000002')$q$, 'e0000000-0000-0000-0000-000000000001');
select public.prueba('E1 ve pendientes de gerencia', $q$select public.pend_datos()$q$, 'e0000000-0000-0000-0000-000000000001');
select public.prueba('E1 crea un pendiente', $q$select public.pend_crear('x', null)$q$, 'e0000000-0000-0000-0000-000000000001');
select public.prueba('E1 lee la tabla de pendientes', $q$select * from public.pendientes$q$, 'e0000000-0000-0000-0000-000000000001');
select public.prueba('X (desactivado) ve pendientes', $q$select public.pend_datos()$q$, 'd0000000-0000-0000-0000-000000000001');
