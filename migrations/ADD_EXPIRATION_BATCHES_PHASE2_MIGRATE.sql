/* ============================================================================
   MIGRACIÓN DE DATOS EXISTENTES A SISTEMA DE LOTES
   Convierte stock_balances_backup → inventory_batches
   
   IMPORTANTE: Ejecutar después de PHASE2
   Este script:
   - Crea lotes únicos para cada combinación tenant/location/variant existente
   - Asigna batch_number automático
   - Usa costo de la variante como unit_cost
   - No asigna fecha de vencimiento (NULL) ya que datos históricos no la tenían
   
   AUTOR: Sistema POS-Lite
   FECHA: 2026-02-15
   ============================================================================ */

-- =========================
-- 1) VERIFICACIÓN PRE-MIGRACIÓN
-- =========================

DO $$
DECLARE
  v_backup_count INT;
  v_batch_count INT;
BEGIN
  SELECT COUNT(*) INTO v_backup_count FROM stock_balances_backup;
  SELECT COUNT(*) INTO v_batch_count FROM inventory_batches;
  
  RAISE NOTICE '============================================';
  RAISE NOTICE 'INICIO MIGRACIÓN DE DATOS';
  RAISE NOTICE '============================================';
  RAISE NOTICE 'Registros en backup: %', v_backup_count;
  RAISE NOTICE 'Lotes existentes: %', v_batch_count;
  RAISE NOTICE '';
  
  IF v_batch_count > 0 THEN
    RAISE WARNING 'Ya existen lotes en inventory_batches. Esta migración agregará más.';
  END IF;
END;
$$;

-- =========================
-- 2) MIGRACIÓN: STOCK_BALANCES_BACKUP → INVENTORY_BATCHES
-- =========================

INSERT INTO inventory_batches (
  tenant_id,
  location_id,
  variant_id,
  batch_number,
  expiration_date,
  on_hand,
  reserved,
  unit_cost,
  physical_location,
  received_at,
  created_by,
  notes,
  is_active
)
SELECT 
  sb.tenant_id,
  sb.location_id,
  sb.variant_id,
  -- Generar batch_number único para migración
  'MIGRATION-' || sb.variant_id::TEXT || '-' || sb.location_id::TEXT AS batch_number,
  -- Sin fecha de vencimiento (datos históricos)
  NULL AS expiration_date,
  -- Cantidades
  sb.on_hand,
  COALESCE(sb.reserved, 0) AS reserved,
  -- Costo de la variante
  COALESCE(pv.cost, 0) AS unit_cost,
  -- Ubicación genérica
  'MAIN' AS physical_location,
  -- Fecha de recepción = fecha de actualización del backup
  sb.updated_at AS received_at,
  -- Sin usuario (migración automática)
  NULL AS created_by,
  -- Nota de migración
  'Lote creado automáticamente durante migración del ' || CURRENT_DATE::TEXT AS notes,
  -- Activo solo si hay stock
  (sb.on_hand > 0 OR sb.reserved > 0) AS is_active
FROM stock_balances_backup sb
JOIN product_variants pv ON pv.variant_id = sb.variant_id AND pv.tenant_id = sb.tenant_id
-- Solo migrar registros con stock o reservado
WHERE sb.on_hand > 0 OR sb.reserved > 0
-- Evitar duplicados si ya se migró
ON CONFLICT (tenant_id, location_id, variant_id, batch_number) DO NOTHING;

-- =========================
-- 3) REFRESH VISTA MATERIALIZADA
-- =========================

REFRESH MATERIALIZED VIEW stock_balances;

-- =========================
-- 4) VERIFICACIÓN POST-MIGRACIÓN
-- =========================

DO $$
DECLARE
  v_migrated_count INT;
  v_stock_match BOOLEAN;
  v_backup_total NUMERIC;
  v_batch_total NUMERIC;
BEGIN
  -- Contar lotes migrados
  SELECT COUNT(*) INTO v_migrated_count 
  FROM inventory_batches 
  WHERE batch_number LIKE 'MIGRATION-%';
  
  -- Verificar totales
  SELECT SUM(on_hand) INTO v_backup_total FROM stock_balances_backup;
  SELECT SUM(on_hand) INTO v_batch_total FROM inventory_batches WHERE is_active = TRUE;
  
  v_stock_match := (v_backup_total = v_batch_total);
  
  RAISE NOTICE '============================================';
  RAISE NOTICE 'RESULTADO DE MIGRACIÓN';
  RAISE NOTICE '============================================';
  RAISE NOTICE 'Lotes migrados: %', v_migrated_count;
  RAISE NOTICE 'Stock total backup: %', v_backup_total;
  RAISE NOTICE 'Stock total lotes: %', v_batch_total;
  RAISE NOTICE 'Coincidencia: %', CASE WHEN v_stock_match THEN 'OK ✓' ELSE 'ERROR ✗' END;
  RAISE NOTICE '';
  
  IF NOT v_stock_match THEN
    RAISE WARNING 'Los totales no coinciden. Revisar migración.';
  ELSE
    RAISE NOTICE 'Migración completada exitosamente.';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE 'PRÓXIMOS PASOS:';
  RAISE NOTICE '1. Verificar datos migrados';
  RAISE NOTICE '2. Configurar productos que requieren vencimiento';
  RAISE NOTICE '3. Ejecutar PHASE3 (lógica FEFO)';
  RAISE NOTICE '============================================';
END;
$$;

-- =========================
-- 5) QUERY DE VERIFICACIÓN MANUAL
-- =========================

-- Comparativa backup vs lotes
CREATE TEMP VIEW temp_migration_check AS
SELECT 
  'BACKUP' AS source,
  sb.tenant_id,
  sb.location_id,
  sb.variant_id,
  sb.on_hand,
  sb.reserved
FROM stock_balances_backup sb
UNION ALL
SELECT 
  'BATCHES' AS source,
  ib.tenant_id,
  ib.location_id,
  ib.variant_id,
  SUM(ib.on_hand) AS on_hand,
  SUM(ib.reserved) AS reserved
FROM inventory_batches ib
WHERE ib.is_active = TRUE
GROUP BY ib.tenant_id, ib.location_id, ib.variant_id;

-- Query para revisar discrepancias
COMMENT ON VIEW temp_migration_check IS 
  'Vista temporal para verificar migración. 
   Usar: SELECT * FROM temp_migration_check ORDER BY tenant_id, location_id, variant_id, source;';

-- =========================
-- 6) FUNCIÓN: CORREGIR DISCREPANCIAS (SI ES NECESARIO)
-- =========================

CREATE OR REPLACE FUNCTION fn_fix_migration_discrepancies()
RETURNS TABLE (
  tenant_id UUID,
  location_id UUID,
  variant_id UUID,
  backup_qty NUMERIC,
  batch_qty NUMERIC,
  difference NUMERIC,
  action TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH comparison AS (
    SELECT 
      COALESCE(b.tenant_id, l.tenant_id) AS tenant_id,
      COALESCE(b.location_id, l.location_id) AS location_id,
      COALESCE(b.variant_id, l.variant_id) AS variant_id,
      COALESCE(b.on_hand, 0) AS backup_on_hand,
      COALESCE(SUM(l.on_hand), 0) AS batch_on_hand
    FROM stock_balances_backup b
    FULL OUTER JOIN inventory_batches l 
      ON l.tenant_id = b.tenant_id 
      AND l.location_id = b.location_id 
      AND l.variant_id = b.variant_id
      AND l.is_active = TRUE
    GROUP BY 
      COALESCE(b.tenant_id, l.tenant_id),
      COALESCE(b.location_id, l.location_id),
      COALESCE(b.variant_id, l.variant_id),
      b.on_hand
  )
  SELECT 
    c.tenant_id,
    c.location_id,
    c.variant_id,
    c.backup_on_hand,
    c.batch_on_hand,
    (c.backup_on_hand - c.batch_on_hand) AS difference,
    CASE 
      WHEN c.backup_on_hand > c.batch_on_hand THEN 'CREAR_LOTE_AJUSTE'
      WHEN c.backup_on_hand < c.batch_on_hand THEN 'REDUCIR_LOTE'
      ELSE 'OK'
    END AS action
  FROM comparison c
  WHERE c.backup_on_hand != c.batch_on_hand;
END;
$$;

COMMENT ON FUNCTION fn_fix_migration_discrepancies IS 
  'Identifica discrepancias entre backup y lotes migrados. 
   Usar: SELECT * FROM fn_fix_migration_discrepancies();';

-- =========================
-- FIN MIGRACIÓN
-- =========================
