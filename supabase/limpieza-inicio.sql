-- =====================================================================
--  Empezar de cero el lunes 26/10/2026 (una sola vez)
--  Programa una limpieza para el lunes 26 a las 12:05 a. m. (hora de Venezuela), antes de que
--  lleguen los muchachos. Borra lo anterior al 26:
--   - asistencia (faltas, llegadas tarde, almuerzos, «me voy antes»)
--   - tareas que quedaron sin hacer (con sus notas, temperaturas y revisiones)
--   - salidas a despachar, repartos automáticos y redes Wi-Fi nuevas por aprobar
--  NO borra: personas, tareas configuradas, locales, equipos, ajustes, las tareas ya hechas
--  ni los días sin puntualidad de la semana de práctica.
--  Después de correr, se borra sola del reloj. Se puede correr otra vez sin problema.
-- =====================================================================
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'limpieza-inicio';
  -- 04:05 en hora universal = 12:05 a. m. en Venezuela
  perform cron.schedule('limpieza-inicio', '5 4 26 10 *', $c$
    delete from public.asistencia   where fecha < date '2026-10-26';
    delete from public.asignaciones where fecha < date '2026-10-26' and estado = 'pendiente';
    delete from public.salidas_rato where fecha < date '2026-10-26';
    delete from public.repartos_auto where fecha < date '2026-10-26';
    delete from public.redes_nuevas where fecha < date '2026-10-26';
    select cron.unschedule('limpieza-inicio');
  $c$);
end $$;

-- Para comprobar que quedó programada (debe salir una fila «limpieza-inicio»):
select jobname, schedule from cron.job where jobname = 'limpieza-inicio';
