/* ============================================================================
   SISTEMA DE LOTES CON FECHA DE VENCIMIENTO - FASE 5
   Vistas de alertas, reportes y dashboards
   
   INCLUYE:
   - Vista de productos próximos a vencer
   - Vista de lotes vencidos
   - Reporte de rotación de lotes
   - Dashboard de alertas por sede
   - Consultas optimizadas para UI cajero
   
   REQUERIMIENTOS: Ejecutar fases 1-4 antes
   
   AUTOR: Sistema POS-Lite
   FECHA: 2026-02-15
   ============================================================================ */

-- =========================
-- 1) VISTA: PRODUCTOS PRÓXIMOS A VENCER
-- =========================

CREATE OR REPLACE VIEW vw_expiring_products AS
SELECT 
  ib.tenant_id,
  ib.location_id,
  l.name AS location_name,
  ib.variant_id,
  pv.sku,
  pv.variant_name,
  p.product_id,
  p.name AS product_name,
  cat.name AS category_name,
  -- Información del lote
  ib.batch_id,
  ib.batch_number,
  ib.expiration_date,
  ib.expiration_date - CURRENT_DATE AS days_to_expiry,
  ib.physical_location,
  -- Stock
  ib.on_hand,
  ib.reserved,
  (ib.on_hand - ib.reserved) AS available,
  -- Valorización
  ib.unit_cost,
  ROUND((ib.on_hand - ib.reserved) * ib.unit_cost, 2) AS value_at_cost,
  ROUND((ib.on_hand - ib.reserved) * pv.price, 2) AS value_at_price,
  -- Configuración y alertas
  (SELECT expiration_config->>'warn_days_before_expiration' 
   FROM tenant_settings WHERE tenant_id = ib.tenant_id)::INT AS warn_days,
  (SELECT expiration_config->>'critical_days_before_expiration' 
   FROM tenant_settings WHERE tenant_id = ib.tenant_id)::INT AS critical_days,
  CASE
    WHEN ib.expiration_date < CURRENT_DATE THEN 'EXPIRED'
    WHEN ib.expiration_date <= CURRENT_DATE + 
         COALESCE((SELECT (expiration_config->>'critical_days_before_expiration')::INT 
                   FROM tenant_settings WHERE tenant_id = ib.tenant_id), 7) THEN 'CRITICAL'
    WHEN ib.expiration_date <= CURRENT_DATE + 
         COALESCE((SELECT (expiration_config->>'warn_days_before_expiration')::INT 
                   FROM tenant_settings WHERE tenant_id = ib.tenant_id), 30) THEN 'WARNING'
    ELSE 'OK'
  END AS alert_level,
  -- Timestamps
  ib.received_at,
  ib.updated_at
FROM inventory_batches ib
JOIN locations l ON l.location_id = ib.location_id
JOIN product_variants pv ON pv.variant_id = ib.variant_id AND pv.tenant_id = ib.tenant_id
JOIN products p ON p.product_id = pv.product_id AND p.tenant_id = pv.tenant_id
LEFT JOIN categories cat ON cat.category_id = p.category_id
WHERE ib.is_active = TRUE
  AND ib.expiration_date IS NOT NULL
  AND (ib.on_hand - ib.reserved) > 0
  AND p.is_active = TRUE
  AND pv.is_active = TRUE;

CREATE INDEX idx_vw_expiring_alert 
ON inventory_batches(tenant_id, expiration_date, (on_hand - reserved))
WHERE is_active = TRUE 
  AND expiration_date IS NOT NULL 
  AND (on_hand - reserved) > 0;

COMMENT ON VIEW vw_expiring_products IS 
  'Vista de productos con vencimiento próximo o vencidos. 
   Incluye alertas, valorización y ubicación física.';

-- =========================
-- 2) VISTA AGREGADA: ALERTAS POR VARIANTE
-- =========================

CREATE OR REPLACE VIEW vw_expiring_by_variant AS
SELECT 
  e.tenant_id,
  e.location_id,
  e.location_name,
  e.variant_id,
  e.sku,
  e.product_name,
  e.variant_name,
  e.category_name,
  -- Agregados
  COUNT(*) AS total_batches,
  MIN(e.expiration_date) AS earliest_expiration,
  MIN(e.days_to_expiry) AS days_to_earliest,
  SUM(e.available) AS total_available,
  SUM(e.value_at_cost) AS total_value_cost,
  SUM(e.value_at_price) AS total_value_price,
  -- Nivel de alerta más crítico
  MIN(
    CASE e.alert_level
      WHEN 'EXPIRED' THEN 1
      WHEN 'CRITICAL' THEN 2
      WHEN 'WARNING' THEN 3
      ELSE 4
    END
  ) AS alert_priority,
  CASE 
    WHEN MIN(CASE e.alert_level WHEN 'EXPIRED' THEN 1 WHEN 'CRITICAL' THEN 2 WHEN 'WARNING' THEN 3 ELSE 4 END) = 1 THEN 'EXPIRED'
    WHEN MIN(CASE e.alert_level WHEN 'EXPIRED' THEN 1 WHEN 'CRITICAL' THEN 2 WHEN 'WARNING' THEN 3 ELSE 4 END) = 2 THEN 'CRITICAL'
    WHEN MIN(CASE e.alert_level WHEN 'EXPIRED' THEN 1 WHEN 'CRITICAL' THEN 2 WHEN 'WARNING' THEN 3 ELSE 4 END) = 3 THEN 'WARNING'
    ELSE 'OK'
  END AS alert_level,
  -- Detalles de lotes
  jsonb_agg(
    jsonb_build_object(
      'batch_id', e.batch_id,
      'batch_number', e.batch_number,
      'expiration_date', e.expiration_date,
      'days_to_expiry', e.days_to_expiry,
      'available', e.available,
      'physical_location', e.physical_location,
      'alert_level', e.alert_level
    ) ORDER BY e.expiration_date
  ) AS batches
FROM vw_expiring_products e
GROUP BY 
  e.tenant_id, e.location_id, e.location_name, 
  e.variant_id, e.sku, e.product_name, e.variant_name, e.category_name;

COMMENT ON VIEW vw_expiring_by_variant IS 
  'Vista agregada de alertas de vencimiento por variante.
   Útil para reportes y dashboards.';

-- =========================
-- 3) VISTA: DASHBOARD DE ALERTAS POR SEDE
-- =========================

CREATE OR REPLACE VIEW vw_expiration_dashboard AS
SELECT 
  e.tenant_id,
  t.name AS tenant_name,
  e.location_id,
  e.location_name,
  -- Contadores por nivel de alerta
  COUNT(*) FILTER (WHERE e.alert_level = 'EXPIRED') AS expired_count,
  COUNT(*) FILTER (WHERE e.alert_level = 'CRITICAL') AS critical_count,
  COUNT(*) FILTER (WHERE e.alert_level = 'WARNING') AS warning_count,
  -- Cantidades
  SUM(e.available) FILTER (WHERE e.alert_level = 'EXPIRED') AS expired_qty,
  SUM(e.available) FILTER (WHERE e.alert_level = 'CRITICAL') AS critical_qty,
  SUM(e.available) FILTER (WHERE e.alert_level = 'WARNING') AS warning_qty,
  -- Valorización
  SUM(e.value_at_cost) FILTER (WHERE e.alert_level = 'EXPIRED') AS expired_value,
  SUM(e.value_at_cost) FILTER (WHERE e.alert_level = 'CRITICAL') AS critical_value,
  SUM(e.value_at_cost) FILTER (WHERE e.alert_level = 'WARNING') AS warning_value,
  -- Total
  SUM(e.value_at_cost) AS total_value_at_risk
FROM vw_expiring_products e
JOIN tenants t ON t.tenant_id = e.tenant_id
WHERE e.alert_level IN ('EXPIRED', 'CRITICAL', 'WARNING')
GROUP BY e.tenant_id, t.name, e.location_id, e.location_name;

COMMENT ON VIEW vw_expiration_dashboard IS 
  'Dashboard resumen de alertas de vencimiento por sede.
   Incluye contadores, cantidades y valorización por nivel de criticidad.';

-- =========================
-- 4) VISTA: ROTACIÓN DE LOTES
-- =========================

CREATE OR REPLACE VIEW vw_batch_rotation AS
SELECT 
  ib.tenant_id,
  ib.location_id,
  l.name AS location_name,
  ib.variant_id,
  pv.sku,
  p.name AS product_name,
  pv.variant_name,
  ib.batch_id,
  ib.batch_number,
  ib.expiration_date,
  ib.received_at,
  -- Edad del lote
  CURRENT_DATE - ib.received_at::DATE AS days_in_stock,
  -- Stock inicial y actual
  (SELECT SUM(quantity) 
   FROM inventory_moves 
   WHERE batch_id = ib.batch_id 
     AND move_type IN ('PURCHASE_IN', 'RETURN_IN', 'TRANSFER_IN', 'ADJUSTMENT')
  ) AS initial_quantity,
  ib.on_hand AS current_on_hand,
  -- Vendido
  (SELECT COALESCE(SUM(quantity), 0)
   FROM sale_line_batches
   WHERE batch_id = ib.batch_id
  ) AS sold_quantity,
  -- Tasa de rotación
  CASE 
    WHEN (CURRENT_DATE - ib.received_at::DATE) > 0 THEN
      ROUND(
        (SELECT COALESCE(SUM(quantity), 0) FROM sale_line_batches WHERE batch_id = ib.batch_id)::NUMERIC / 
        (CURRENT_DATE - ib.received_at::DATE)::NUMERIC,
        2
      )
    ELSE 0
  END AS daily_rotation_rate,
  -- Proyección de agotamiento
  CASE 
    WHEN (SELECT COALESCE(SUM(quantity), 0) FROM sale_line_batches WHERE batch_id = ib.batch_id) > 0 
      AND (CURRENT_DATE - ib.received_at::DATE) > 0 THEN
      ROUND(
        ib.on_hand / 
        (
          (SELECT COALESCE(SUM(quantity), 0) FROM sale_line_batches WHERE batch_id = ib.batch_id)::NUMERIC / 
          (CURRENT_DATE - ib.received_at::DATE)::NUMERIC
        ),
        0
      )
    ELSE NULL
  END AS estimated_days_to_deplete,
  -- Valorización
  ROUND(ib.on_hand * ib.unit_cost, 2) AS value_at_cost,
  ROUND(ib.on_hand * pv.price, 2) AS value_at_price
FROM inventory_batches ib
JOIN locations l ON l.location_id = ib.location_id
JOIN product_variants pv ON pv.variant_id = ib.variant_id
JOIN products p ON p.product_id = pv.product_id
WHERE ib.is_active = TRUE
  AND ib.on_hand > 0;

COMMENT ON VIEW vw_batch_rotation IS 
  'Análisis de rotación de lotes: edad, ventas, proyección de agotamiento.
   Útil para identificar lotes de baja rotación antes de vencer.';

-- =========================
-- 5) VISTA: INFO RÁPIDA PARA CAJERO
-- =========================

CREATE OR REPLACE VIEW vw_stock_for_cashier AS
SELECT 
  sb.tenant_id,
  sb.location_id,
  sb.variant_id,
  pv.sku,
  p.name AS product_name,
  pv.variant_name,
  pv.price,
  -- Stock
  sb.on_hand,
  sb.reserved,
  (sb.on_hand - sb.reserved) AS available,
  -- Vencimiento
  (SELECT MIN(expiration_date) 
   FROM inventory_batches 
   WHERE tenant_id = sb.tenant_id 
     AND location_id = sb.location_id 
     AND variant_id = sb.variant_id 
     AND is_active = TRUE 
     AND (on_hand - reserved) > 0
     AND expiration_date IS NOT NULL
  ) AS next_expiration,
  (SELECT MIN(expiration_date) - CURRENT_DATE
   FROM inventory_batches 
   WHERE tenant_id = sb.tenant_id 
     AND location_id = sb.location_id 
     AND variant_id = sb.variant_id 
     AND is_active = TRUE 
     AND (on_hand - reserved) > 0
     AND expiration_date IS NOT NULL
  ) AS days_to_expire,
  -- Ubicación más próxima a vencer
  (SELECT physical_location
   FROM inventory_batches 
   WHERE tenant_id = sb.tenant_id 
     AND location_id = sb.location_id 
     AND variant_id = sb.variant_id 
     AND is_active = TRUE 
     AND (on_hand - reserved) > 0
   ORDER BY expiration_date NULLS LAST, received_at ASC
   LIMIT 1
  ) AS pickup_location,
  -- Alerta
  CASE
    WHEN EXISTS (
      SELECT 1 FROM inventory_batches 
      WHERE tenant_id = sb.tenant_id 
        AND location_id = sb.location_id 
        AND variant_id = sb.variant_id 
        AND is_active = TRUE 
        AND (on_hand - reserved) > 0
        AND expiration_date < CURRENT_DATE
    ) THEN 'EXPIRED'
    WHEN EXISTS (
      SELECT 1 FROM inventory_batches 
      WHERE tenant_id = sb.tenant_id 
        AND location_id = sb.location_id 
        AND variant_id = sb.variant_id 
        AND is_active = TRUE 
        AND (on_hand - reserved) > 0
        AND expiration_date <= CURRENT_DATE + 7
    ) THEN 'CRITICAL'
    WHEN EXISTS (
      SELECT 1 FROM inventory_batches 
      WHERE tenant_id = sb.tenant_id 
        AND location_id = sb.location_id 
        AND variant_id = sb.variant_id 
        AND is_active = TRUE 
        AND (on_hand - reserved) > 0
        AND expiration_date <= CURRENT_DATE + 30
    ) THEN 'WARNING'
    ELSE 'OK'
  END AS expiry_alert
FROM stock_balances sb
JOIN product_variants pv ON pv.variant_id = sb.variant_id AND pv.tenant_id = sb.tenant_id
JOIN products p ON p.product_id = pv.product_id AND p.tenant_id = pv.tenant_id
WHERE p.is_active = TRUE 
  AND pv.is_active = TRUE
  AND (sb.on_hand - sb.reserved) > 0;

COMMENT ON VIEW vw_stock_for_cashier IS 
  'Vista optimizada para UI de cajero: stock, ubicación, alertas de vencimiento.
   Incluye solo productos disponibles con info esencial.';

-- =========================
-- 6) FUNCIÓN: REPORTE DE VENCIMIENTOS DEL MES
-- =========================

CREATE OR REPLACE FUNCTION fn_expiration_report(
  p_tenant UUID,
  p_location UUID DEFAULT NULL,
  p_days_ahead INT DEFAULT 30
)
RETURNS TABLE (
  date DATE,
  location_name TEXT,
  sku TEXT,
  product_name TEXT,
  batch_number TEXT,
  quantity NUMERIC,
  value_at_cost NUMERIC,
  physical_location TEXT
)
LANGUAGE SQL
STABLE
AS $$
  SELECT 
    ib.expiration_date AS date,
    l.name AS location_name,
    pv.sku,
    p.name AS product_name,
    ib.batch_number,
    (ib.on_hand - ib.reserved) AS quantity,
    ROUND((ib.on_hand - ib.reserved) * ib.unit_cost, 2) AS value_at_cost,
    ib.physical_location
  FROM inventory_batches ib
  JOIN locations l ON l.location_id = ib.location_id
  JOIN product_variants pv ON pv.variant_id = ib.variant_id
  JOIN products p ON p.product_id = pv.product_id
  WHERE ib.tenant_id = p_tenant
    AND (p_location IS NULL OR ib.location_id = p_location)
    AND ib.is_active = TRUE
    AND ib.expiration_date IS NOT NULL
    AND ib.expiration_date <= CURRENT_DATE + p_days_ahead
    AND (ib.on_hand - ib.reserved) > 0
    AND p.is_active = TRUE
  ORDER BY ib.expiration_date, l.name, pv.sku;
$$;

COMMENT ON FUNCTION fn_expiration_report IS 
  'Reporte de productos que vencen en los próximos N días.
   Parámetros: tenant_id, location_id (opcional), days_ahead (default 30)';

-- =========================
-- 7) FUNCIÓN: TOP PRODUCTOS EN RIESGO
-- =========================

CREATE OR REPLACE FUNCTION fn_top_at_risk_products(
  p_tenant UUID,
  p_location UUID DEFAULT NULL,
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  variant_id UUID,
  sku TEXT,
  product_name TEXT,
  total_value NUMERIC,
  earliest_expiration DATE,
  days_to_expiry INT,
  batches_count INT
)
LANGUAGE SQL
STABLE
AS $$
  SELECT 
    e.variant_id,
    e.sku,
    e.product_name,
    SUM(e.value_at_cost) AS total_value,
    MIN(e.expiration_date) AS earliest_expiration,
    MIN(e.days_to_expiry) AS days_to_expiry,
    COUNT(*)::INT AS batches_count
  FROM vw_expiring_products e
  WHERE e.tenant_id = p_tenant
    AND (p_location IS NULL OR e.location_id = p_location)
    AND e.alert_level IN ('EXPIRED', 'CRITICAL', 'WARNING')
  GROUP BY e.variant_id, e.sku, e.product_name
  ORDER BY total_value DESC, days_to_expiry ASC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION fn_top_at_risk_products IS 
  'Top N productos con mayor valor en riesgo por vencimiento.
   Ordenado por valor y proximidad de vencimiento.';

-- =========================
-- FIN FASE 5
-- =========================

DO $$
DECLARE
  v_expiring_count INT;
  v_expired_count INT;
  v_critical_count INT;
BEGIN
  -- Contar productos con alertas
  SELECT 
    COUNT(*) FILTER (WHERE alert_level IN ('EXPIRED', 'CRITICAL', 'WARNING')),
    COUNT(*) FILTER (WHERE alert_level = 'EXPIRED'),
    COUNT(*) FILTER (WHERE alert_level = 'CRITICAL')
  INTO v_expiring_count, v_expired_count, v_critical_count
  FROM vw_expiring_products;
  
  RAISE NOTICE '============================================';
  RAISE NOTICE 'FASE 5 COMPLETADA - Vistas y reportes';
  RAISE NOTICE '============================================';
  RAISE NOTICE 'Vistas creadas:';
  RAISE NOTICE '  ✓ vw_expiring_products - detalle de vencimientos';
  RAISE NOTICE '  ✓ vw_expiring_by_variant - agregado por variante';
  RAISE NOTICE '  ✓ vw_expiration_dashboard - resumen por sede';
  RAISE NOTICE '  ✓ vw_batch_rotation - análisis de rotación';
  RAISE NOTICE '  ✓ vw_stock_for_cashier - info para cajero';
  RAISE NOTICE '';
  RAISE NOTICE 'Funciones de reporte:';
  RAISE NOTICE '  ✓ fn_expiration_report - vencimientos próximos';
  RAISE NOTICE '  ✓ fn_top_at_risk_products - top en riesgo';
  RAISE NOTICE '';
  RAISE NOTICE 'ESTADO ACTUAL:';
  RAISE NOTICE '  - Productos con alertas: %', v_expiring_count;
  RAISE NOTICE '  - Vencidos: %', v_expired_count;
  RAISE NOTICE '  - Críticos (< 7 días): %', v_critical_count;
  RAISE NOTICE '';
  RAISE NOTICE 'SISTEMA DE LOTES COMPLETADO';
  RAISE NOTICE 'Consultar documentación para uso en UI';
  RAISE NOTICE '============================================';
END;
$$;
