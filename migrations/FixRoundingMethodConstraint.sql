-- ===================================================================
-- Fix: Corregir constraints que no coinciden con el frontend
-- Fecha: 2026-02-13
-- Descripción: Ajustar valores permitidos para que coincidan con el frontend
-- ===================================================================

-- 1. Eliminar constraints actuales con valores incorrectos
ALTER TABLE tenant_settings 
  DROP CONSTRAINT IF EXISTS tenant_settings_rounding_method_check,
  DROP CONSTRAINT IF EXISTS tenant_settings_print_format_check;

-- 2. Agregar los constraints corregidos con los valores correctos

-- Rounding method: 'normal', 'up', 'down', 'none'
ALTER TABLE tenant_settings
  ADD CONSTRAINT tenant_settings_rounding_method_check 
  CHECK (rounding_method IN ('normal', 'up', 'down', 'none'));

-- Print format: 'thermal', 'letter', 'ticket'
ALTER TABLE tenant_settings
  ADD CONSTRAINT tenant_settings_print_format_check 
  CHECK (print_format IN ('thermal', 'letter', 'ticket'));

-- 3. Actualizar comentarios
COMMENT ON COLUMN tenant_settings.rounding_method IS 'Método para redondear totales (normal, up, down, none)';
COMMENT ON COLUMN tenant_settings.print_format IS 'Formato de impresión (thermal, letter, ticket)';

-- Confirmación
DO $$
BEGIN
  RAISE NOTICE '✅ Constraints corregidos exitosamente';
  RAISE NOTICE '📝 rounding_method: normal, up, down, none';
  RAISE NOTICE '📝 print_format: thermal, letter, ticket';
END $$;
