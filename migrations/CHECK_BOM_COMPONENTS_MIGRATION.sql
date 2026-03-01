/* ============================================================================
   FIX: Soporte para bom_components con unit y unit_id
   
   Este script verifica el estado de la tabla bom_components y muestra
   instrucciones para migrar si es necesario.
   ============================================================================ */

-- Ver estado actual de la tabla bom_components
SELECT 
  'COLUMNAS bom_components' AS seccion,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'bom_components'
  AND column_name IN ('unit', 'unit_id')
ORDER BY column_name;

-- Ver registros actuales (si existen)
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM bom_components;
  
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE 'ESTADO DE bom_components';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Total registros: %', v_count;
  RAISE NOTICE '';
  
  IF v_count > 0 THEN
    RAISE NOTICE 'Ejemplos de datos:';
    FOR i IN 
      SELECT 
        component_id,
        CASE 
          WHEN unit_id IS NOT NULL THEN 'Tiene unit_id ✓'
          ELSE 'SIN unit_id'
        END as estado_unit_id,
        CASE 
          WHEN unit IS NOT NULL THEN 'Tiene unit: ' || unit
          ELSE 'SIN unit'
        END as estado_unit
      FROM bom_components
      LIMIT 5
    LOOP
      RAISE NOTICE '  ID: % | % | %', i.component_id, i.estado_unit_id, i.estado_unit;
    END LOOP;
  END IF;
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
END $$;

-- Instrucciones
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '📋 INSTRUCCIONES:';
  RAISE NOTICE '';
  
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bom_components' AND column_name = 'unit_id'
  ) THEN
    RAISE NOTICE '✓ Tu tabla YA TIENE la columna unit_id (migración aplicada)';
    RAISE NOTICE '';
    RAISE NOTICE '  El código está preparado para trabajar con ambas columnas:';
    RAISE NOTICE '  - unit (TEXT): Para compatibilidad con versión antigua';
    RAISE NOTICE '  - unit_id (UUID): Para nueva integración con units_of_measure';
    RAISE NOTICE '';
  ELSE
    RAISE NOTICE '⚠ Tu tabla NO TIENE la columna unit_id todavía';
    RAISE NOTICE '';
    RAISE NOTICE '  OPCIÓN 1: Ejecutar migración completa (RECOMENDADO)';
    RAISE NOTICE '  ---------------------------------------------------------';
    RAISE NOTICE '  psql -U postgres -d pos_lite -f "migrations/CREATE_UNITS_OF_MEASURE.sql"';
    RAISE NOTICE '';
    RAISE NOTICE '  Esto:';
    RAISE NOTICE '  1. Crea tabla units_of_measure';
    RAISE NOTICE '  2. Agrega columna unit_id a bom_components';
    RAISE NOTICE '  3. Migra datos de unit (TEXT) → unit_id (UUID)';
    RAISE NOTICE '  4. Mantiene unit como DEPRECATED para compatibilidad';
    RAISE NOTICE '';
    RAISE NOTICE '  OPCIÓN 2: Seguir usando unit (TEXT) temporalmente';
    RAISE NOTICE '  ---------------------------------------------------------';
    RAISE NOTICE '  El código actual soporta ambas versiones, puedes seguir';
    RAISE NOTICE '  trabajando con la columna unit hasta que ejecutes la migración.';
    RAISE NOTICE '';
  END IF;
  
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;
