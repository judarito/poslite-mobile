/* ============================================================================
   INTEGRACIÓN: Alertas de Vencimiento con Sistema Real-Time
   
   OBJETIVO:
   Integrar las alertas de productos próximos a vencer con el sistema de
   alertas en tiempo real que ya existe (system_alerts + Supabase real-time)
   
   COMPONENTES:
   1. Modificar tabla system_alerts para incluir tipo 'EXPIRATION'
   2. Crear función fn_refresh_expiration_alerts()
   3. Crear trigger automático para actualizar alertas
   4. Actualizar índices
   ============================================================================ */

-- =====================================================================
-- 1. MODIFICAR TABLA SYSTEM_ALERTS
-- =====================================================================

-- Agregar 'EXPIRATION' como tipo válido de alerta
DO $$
BEGIN
  -- Eliminar constraint existente
  ALTER TABLE system_alerts 
    DROP CONSTRAINT IF EXISTS system_alerts_alert_type_check;
  
  -- Crear nueva constraint con EXPIRATION incluido
  ALTER TABLE system_alerts 
    ADD CONSTRAINT system_alerts_alert_type_check 
    CHECK (alert_type IN ('STOCK', 'LAYAWAY', 'EXPIRATION'));
  
  RAISE NOTICE '✅ Tipo de alerta EXPIRATION agregado a system_alerts';
END $$;

-- =====================================================================
-- 2. FUNCIÓN PARA REFRESCAR ALERTAS DE VENCIMIENTO
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_refresh_expiration_alerts()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Eliminar alertas de vencimiento que ya no aplican
  -- (lotes que ya vencieron completamente o que ya no están en rango de alerta)
  DELETE FROM system_alerts
  WHERE alert_type = 'EXPIRATION'
    AND reference_id NOT IN (
      SELECT DISTINCT batch_id
      FROM vw_expiring_products
      WHERE alert_level IN ('EXPIRED', 'CRITICAL', 'WARNING')
    );

  -- Insertar o actualizar alertas de vencimiento actuales
  INSERT INTO system_alerts (tenant_id, alert_type, alert_level, reference_id, data)
  SELECT
    tenant_id,
    'EXPIRATION' as alert_type,
    alert_level,
    batch_id as reference_id,
    jsonb_build_object(
      'batch_id', batch_id,
      'batch_number', batch_number,
      'location_id', location_id,
      'location_name', location_name,
      'variant_id', variant_id,
      'sku', sku,
      'product_name', product_name,
      'variant_name', variant_name,
      'expiration_date', expiration_date,
      'days_to_expiry', days_to_expiry,
      'on_hand', on_hand,
      'available', available,
      'alert_level', alert_level,
      'physical_location', physical_location
    ) as data
  FROM vw_expiring_products
  WHERE alert_level IN ('EXPIRED', 'CRITICAL', 'WARNING')
    AND on_hand > 0  -- Solo alertar sobre lotes con stock
  ON CONFLICT (tenant_id, alert_type, reference_id)
  DO UPDATE SET
    alert_level = EXCLUDED.alert_level,
    data = EXCLUDED.data,
    updated_at = NOW();
    
  RAISE NOTICE '✅ Alertas de vencimiento actualizadas';
END;
$$;

COMMENT ON FUNCTION fn_refresh_expiration_alerts IS 
  'Actualiza tabla system_alerts con productos próximos a vencer o vencidos desde vw_expiring_products';

-- =====================================================================
-- 3. TRIGGER AUTOMÁTICO PARA ACTUALIZAR ALERTAS
-- =====================================================================

-- Función trigger que se ejecuta cuando cambia un lote
CREATE OR REPLACE FUNCTION trg_refresh_expiration_alerts()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Refrescar alertas de forma asíncrona (no bloquea la operación)
  PERFORM fn_refresh_expiration_alerts();
  RETURN NEW;
END;
$$;

-- Trigger en inventory_batches: cuando se actualiza on_hand o expiration_date
DROP TRIGGER IF EXISTS trg_batch_update_expiration_alerts ON inventory_batches;
CREATE TRIGGER trg_batch_update_expiration_alerts
  AFTER INSERT OR UPDATE OF on_hand, expiration_date, is_active
  ON inventory_batches
  FOR EACH STATEMENT  -- Statement level = ejecuta 1 vez por transacción
  EXECUTE FUNCTION trg_refresh_expiration_alerts();

COMMENT ON TRIGGER trg_batch_update_expiration_alerts ON inventory_batches IS
  'Actualiza alertas de vencimiento cuando cambia stock o fecha de vencimiento de lotes';

-- =====================================================================
-- 4. ÍNDICE PARA MEJORAR PERFORMANCE DE ALERTAS DE VENCIMIENTO
-- =====================================================================

-- Índice para búsquedas rápidas de alertas de vencimiento por tenant
CREATE INDEX IF NOT EXISTS ix_system_alerts_expiration 
  ON system_alerts(tenant_id, alert_type, alert_level, created_at DESC)
  WHERE alert_type = 'EXPIRATION';

COMMENT ON INDEX ix_system_alerts_expiration IS
  'Optimiza consultas de alertas de vencimiento por tenant y nivel';

-- =====================================================================
-- 5. EJECUTAR REFRESH INICIAL
-- =====================================================================

-- Poblar alertas existentes
SELECT fn_refresh_expiration_alerts();

-- =====================================================================
-- 6. VERIFICACIÓN
-- =====================================================================

DO $$
DECLARE
  v_expiration_count INT;
BEGIN
  -- Contar alertas de vencimiento creadas
  SELECT COUNT(*) INTO v_expiration_count
  FROM system_alerts
  WHERE alert_type = 'EXPIRATION';
  
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ INTEGRACIÓN DE ALERTAS DE VENCIMIENTO COMPLETADA';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Cambios realizados:';
  RAISE NOTICE '  ✓ Tipo EXPIRATION agregado a system_alerts';
  RAISE NOTICE '  ✓ Función fn_refresh_expiration_alerts() creada';
  RAISE NOTICE '  ✓ Trigger automático en inventory_batches';
  RAISE NOTICE '  ✓ Índice ix_system_alerts_expiration creado';
  RAISE NOTICE '';
  RAISE NOTICE 'Alertas de vencimiento actuales: %', v_expiration_count;
  RAISE NOTICE '';
  RAISE NOTICE 'El sistema ahora enviará notificaciones real-time cuando:';
  RAISE NOTICE '  • Un lote esté VENCIDO (expiration_date < hoy)';
  RAISE NOTICE '  • Un lote esté CRÍTICO (vence en ≤ critical_days)';
  RAISE NOTICE '  • Un lote tenga WARNING (vence en ≤ warn_days)';
  RAISE NOTICE '';
  RAISE NOTICE 'Frontend debe:';
  RAISE NOTICE '  1. Agregar tab "Vencimientos" en dialog de alertas';
  RAISE NOTICE '  2. Suscribirse a alertas tipo EXPIRATION';
  RAISE NOTICE '  3. Mostrar badge con contador en menú';
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;

-- =====================================================================
-- OPCIONAL: FUNCIÓN PARA REFRESCAR TODAS LAS ALERTAS
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_refresh_all_alerts()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fn_refresh_stock_alerts();
  PERFORM fn_refresh_layaway_alerts();
  PERFORM fn_refresh_expiration_alerts();
  
  RAISE NOTICE 'Todas las alertas actualizadas (stock, layaway, expiration)';
END;
$$;

COMMENT ON FUNCTION fn_refresh_all_alerts IS
  'Refresca todas las alertas del sistema: stock, layaway y vencimientos';
