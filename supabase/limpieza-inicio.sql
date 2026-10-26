-- =====================================================================
--  Empezar de cero el martes 27/10/2026 (una sola vez)
--  El lunes 26 no se usó: se programa una limpieza para el martes 27 a las 12:05 a. m. (hora de Venezuela),
--  antes de que lleguen los muchachos. Borra lo anterior al 27:
--   - asistencia (faltas, llegadas tarde, almuerzos, «me voy antes»)
--   - tareas diarias que quedaron sin hacer (con sus notas, temperaturas y revisiones)
--   - salidas a despachar, repartos automáticos y redes Wi-Fi nuevas por aprobar
--  Las semanales, mensuales y únicas del lunes que quedaron sin hacer NO se borran: salen el martes
--  como atrasadas (si se borraran, no volverían hasta la próxima semana o el próximo mes).
--  NO borra: personas, tareas configuradas, locales, equipos, ajustes, las tareas ya hechas
--  ni los días sin puntualidad de la semana de práctica.
--  Después de correr, se borra sola del reloj. Se puede correr otra vez sin problema.
-- =====================================================================
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'limpieza-inicio';
  -- 04:05 en hora universal = 12:05 a. m. en Venezuela
  perform cron.schedule('limpieza-inicio', '5 4 27 10 *', $c$
    delete from public.asistencia   where fecha < date '2026-10-27';
    delete from public.asignaciones a where a.fecha < date '2026-10-27' and a.estado = 'pendiente'
      and not exists (select 1 from public.plantillas p where p.id = a.plantilla_id and p.frecuencia <> 'diaria' and a.momento < 50);
    delete from public.salidas_rato where fecha < date '2026-10-27';
    delete from public.repartos_auto where fecha < date '2026-10-27';
    delete from public.redes_nuevas where fecha < date '2026-10-27';
    select cron.unschedule('limpieza-inicio');
  $c$);
end $$;

-- Para comprobar que quedó programada (debe salir una fila «limpieza-inicio» con 5 4 27 10 *):
select jobname, schedule from cron.job where jobname = 'limpieza-inicio';
