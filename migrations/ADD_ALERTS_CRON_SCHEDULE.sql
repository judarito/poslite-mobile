-- ===================================================================
-- Alertas Scheduler v1: refresco automatico de system_alerts con pg_cron
-- ===================================================================

DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'No se pudo crear extension pg_cron (puede requerir habilitarla en Supabase): %', SQLERRM;
  END;
END
$$;

DO $$
DECLARE
  v_job_id BIGINT;
  v_command TEXT;
  v_cron_schema TEXT;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    v_cron_schema := 'cron';
  ELSIF to_regclass('extensions.job') IS NOT NULL THEN
    v_cron_schema := 'extensions';
  END IF;

  IF v_cron_schema IS NULL THEN
    RAISE NOTICE 'pg_cron no disponible. Se omite creacion del job.';
    RETURN;
  END IF;

  -- Eliminar version previa del job para evitar duplicados y permitir cambios de frecuencia/comando.
  EXECUTE format(
    'SELECT jobid FROM %I.job WHERE jobname = %L LIMIT 1',
    v_cron_schema,
    'poslite_refresh_all_alerts_hourly'
  )
  INTO v_job_id;

  IF v_job_id IS NOT NULL THEN
    EXECUTE format('SELECT %I.unschedule($1)', v_cron_schema) USING v_job_id;
  END IF;

  IF to_regprocedure('fn_refresh_all_alerts()') IS NOT NULL THEN
    v_command := 'SELECT fn_refresh_all_alerts();';
  ELSIF to_regprocedure('fn_refresh_supplier_payable_alerts()') IS NOT NULL THEN
    v_command := 'SELECT fn_refresh_supplier_payable_alerts();';
  ELSE
    RAISE NOTICE 'No existe funcion de refresh de alertas. Job no creado.';
    RETURN;
  END IF;

  EXECUTE format('SELECT %I.schedule($1, $2, $3)', v_cron_schema)
  USING 'poslite_refresh_all_alerts_hourly', '0 * * * *', v_command; -- cada hora en minuto 0

  RAISE NOTICE 'Job pg_cron creado: poslite_refresh_all_alerts_hourly (schema: %)', v_cron_schema;
END
$$;
