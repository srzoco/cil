-- =====================================================================
--  Armador de mensajes: descuento del día puntual (8:15 a 8:35 a. m.)
--  El reloj de GitHub llega tarde (hasta una hora). El de Supabase es puntual, así que es él
--  quien le pide a GitHub que calcule el descuento a las 8:15, 8:20, 8:25, 8:30 y 8:35.
--  El primer intento que funcione fija el descuento del día; los siguientes no lo cambian.
--
--  Antes de correr esto (una sola vez):
--   1. En GitHub crea una clave (Settings → Developer settings → Fine-grained tokens) solo para
--      el repositorio mensajesBF, con el permiso «Actions: Read and write».
--   2. Guárdala en Supabase con esta línea (cambia TU_CLAVE por la clave, sin espacios):
--        select vault.create_secret('TU_CLAVE', 'github_mensajes');
--   3. Corre este archivo entero. Se puede volver a correr sin problema.
-- =====================================================================
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'github_mensajes') then
    raise exception 'Falta guardar la clave de GitHub (paso 2).';
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'tasas-armador';
  -- 12:15–12:35 en hora universal = 8:15–8:35 a. m. en Venezuela
  perform cron.schedule('tasas-armador', '15,20,25,30,35 12 * * *', $c$
    select net.http_post(
      url := 'https://api.github.com/repos/srzoco/mensajesBF/actions/workflows/tasas.yml/dispatches',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_mensajes'),
        'Accept', 'application/vnd.github+json', 'User-Agent', 'cil-supabase', 'Content-Type', 'application/json'),
      body := '{"ref":"main"}'::jsonb)
  $c$);
end $$;
