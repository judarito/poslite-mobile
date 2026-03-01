-- ===================================================================
-- Configuracion del bucket dataimport y politicas de seguridad
-- ===================================================================

DO $$
BEGIN
  PERFORM storage.create_bucket('dataimport'::TEXT, FALSE::BOOLEAN);
EXCEPTION
  WHEN duplicate_object THEN
    -- Ya existe, nada que hacer
  WHEN undefined_function THEN
    RAISE NOTICE 'storage.create_bucket no disponible (crea el bucket dataimport vía la consola o la API)';
END $$;

-- Función helper para obtener el tenant del usuario autenticado
CREATE OR REPLACE FUNCTION public.fn_current_user_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT tenant_id
  FROM public.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$;

-- Activar RLS sobre storage.objects (Supabase storage)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- POLÍTICAS: permitir sólo al tenant propietario acceder al bucket dataimport
DROP POLICY IF EXISTS "dataimport_select" ON storage.objects;
CREATE POLICY "dataimport_select" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'dataimport'
    AND metadata->>'tenant_id' = fn_current_user_tenant_id()::TEXT
  );

DROP POLICY IF EXISTS "dataimport_insert" ON storage.objects;
CREATE POLICY "dataimport_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'dataimport'
    AND metadata->>'tenant_id' = fn_current_user_tenant_id()::TEXT
  );

DROP POLICY IF EXISTS "dataimport_update" ON storage.objects;
CREATE POLICY "dataimport_update" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'dataimport'
    AND metadata->>'tenant_id' = fn_current_user_tenant_id()::TEXT
  )
  WITH CHECK (
    bucket_id = 'dataimport'
    AND metadata->>'tenant_id' = fn_current_user_tenant_id()::TEXT
  );

DROP POLICY IF EXISTS "dataimport_delete" ON storage.objects;
CREATE POLICY "dataimport_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'dataimport'
    AND metadata->>'tenant_id' = fn_current_user_tenant_id()::TEXT
  );

-- Trigger para garantizar que la metadata del bucket contiene el tenant_id actual
CREATE OR REPLACE FUNCTION public.fn_set_dataimport_tenant_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_tenant uuid := fn_current_user_tenant_id();
BEGIN
  IF NEW.bucket_id = 'dataimport' AND current_tenant IS NOT NULL THEN
    NEW.metadata := jsonb_set(
      COALESCE(NEW.metadata, '{}'::jsonb),
      '{tenant_id}',
      to_jsonb(current_tenant::TEXT),
      true
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dataimport_metadata_before_insert ON storage.objects;
CREATE TRIGGER dataimport_metadata_before_insert
BEFORE INSERT ON storage.objects
FOR EACH ROW
WHEN (NEW.bucket_id = 'dataimport')
EXECUTE FUNCTION public.fn_set_dataimport_tenant_metadata();

DO $$ BEGIN
  RAISE NOTICE 'Politicas de seguridad del bucket dataimport configuradas';
END $$;
