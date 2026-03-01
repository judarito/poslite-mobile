/* ============================================================================
   REPORTE DE COSTOS DE PRODUCCIÓN
   
   Vista consolidada para análisis de costos de manufactura:
   - Costo teórico vs real por orden de producción
   - Desglose de componentes consumidos
   - Yield % y eficiencia
   - Margen de utilidad (si se vendió ON_DEMAND)
   - Variación de costos
   
   Dependencias: Sistema de manufactura completo (MANUFACTURING_PHASE*.sql)
   
   Autor: Sistema POS Lite
   Fecha: 2026-02-18
   ============================================================================ */

-- ============================================================================
-- VISTA: REPORTE CONSOLIDADO DE COSTOS DE PRODUCCIÓN
-- ============================================================================

CREATE OR REPLACE VIEW vw_production_cost_report AS
SELECT 
  po.tenant_id,
  po.production_order_id,
  po.order_number,
  po.status,
  
  -- Producto terminado
  p.name AS product_name,
  pv.sku,
  pv.variant_name,
  p.product_id,
  pv.variant_id,
  
  -- BOM
  bom.bom_id,
  bom.bom_code,
  bom.version AS bom_version,
  
  -- Ubicación
  l.location_id,
  l.name AS location_name,
  
  -- Cantidades
  po.quantity_planned,
  po.quantity_produced,
  CASE 
    WHEN po.quantity_planned > 0 
    THEN ROUND((po.quantity_produced / po.quantity_planned * 100), 2)
    ELSE 0 
  END AS yield_percentage,
  
  -- Costos totales
  po.estimated_cost AS costo_teorico_total,
  po.actual_cost AS costo_real_total,
  po.labor_cost AS mano_obra_directa,
  po.overhead_cost AS costos_indirectos_fabricacion,
  
  -- Variación
  (po.actual_cost - COALESCE(po.estimated_cost, 0)) AS variacion_costo,
  CASE 
    WHEN po.estimated_cost > 0 
    THEN ROUND(((po.actual_cost - po.estimated_cost) / po.estimated_cost * 100), 2)
    ELSE 0 
  END AS variacion_costo_pct,
  
  -- Costos unitarios
  CASE 
    WHEN po.quantity_produced > 0 
    THEN ROUND((po.actual_cost / po.quantity_produced), 4)
    ELSE 0 
  END AS costo_unitario_real,
  CASE 
    WHEN po.quantity_planned > 0 
    THEN ROUND((COALESCE(po.estimated_cost, 0) / po.quantity_planned), 4)
    ELSE 0 
  END AS costo_unitario_teorico,
  
  -- Fechas
  po.scheduled_start AS fecha_programada,
  po.actual_start AS fecha_inicio_real,
  po.actual_end AS fecha_fin_real,
  po.created_at AS fecha_creacion,
  
  -- Duración (horas)
  CASE 
    WHEN po.actual_start IS NOT NULL AND po.actual_end IS NOT NULL
    THEN EXTRACT(EPOCH FROM (po.actual_end - po.actual_start)) / 3600
    ELSE NULL
  END AS duracion_horas,
  
  -- Usuarios
  u_created.full_name AS creado_por,
  u_started.full_name AS iniciado_por,
  u_completed.full_name AS completado_por,
  
  -- Detalle de componentes consumidos (desde production_order_lines)
  (SELECT jsonb_agg(
    jsonb_build_object(
      'component_id', comp_p.product_id,
      'component_name', comp_p.name,
      'variant_id', comp_pv.variant_id,
      'sku', comp_pv.sku,
      'variant_name', comp_pv.variant_name,
      'qty_planned', pol.quantity_required,
      'qty_consumed', pol.quantity_consumed,
      'unit_cost', ROUND(pol.unit_cost, 4),
      'total_cost', ROUND((pol.quantity_consumed * pol.unit_cost), 2),
      'waste_pct', CASE 
        WHEN pol.quantity_required > 0 
        THEN ROUND(((pol.quantity_consumed - pol.quantity_required) / pol.quantity_required * 100), 2)
        ELSE 0 
      END
    ) ORDER BY comp_p.name
  )
  FROM production_order_lines pol
  JOIN product_variants comp_pv ON comp_pv.variant_id = pol.component_variant_id
  JOIN products comp_p ON comp_p.product_id = comp_pv.product_id
  WHERE pol.production_order_id = po.production_order_id
  ) AS componentes_detalle,
  
  -- Conteo de componentes
  (SELECT COUNT(*) 
   FROM production_order_lines 
   WHERE production_order_id = po.production_order_id
  ) AS total_componentes,
  
  -- Margen de utilidad si se vendió posteriormente (buscar en outputs)
  -- Nota: Las órdenes de producción TO_STOCK crean lotes que luego se venden
  -- Los productos ON_DEMAND NO tienen production_order_id (consumen directo en venta)
  (SELECT 
    jsonb_build_object(
      'ventas_realizadas', COUNT(DISTINCT sl.sale_id),
      'cantidad_vendida', SUM(sl.quantity),
      'ingreso_total', SUM(sl.line_total),
      'precio_promedio', AVG(sl.unit_price)
    )
  FROM production_outputs pout
  JOIN inventory_batches ib ON ib.batch_id = pout.batch_id
  JOIN inventory_moves im ON im.variant_id = ib.variant_id 
    AND im.source = 'SALE'
    AND im.move_type = 'SALE_OUT'
  JOIN sales s ON s.sale_id = im.source_id
  JOIN sale_lines sl ON sl.sale_id = s.sale_id 
    AND sl.variant_id = ib.variant_id
  WHERE pout.production_order_id = po.production_order_id
  ) AS venta_info,
  
  -- Outputs (lotes producidos)
  (SELECT jsonb_agg(
    jsonb_build_object(
      'batch_id', pout.batch_id,
      'batch_number', ib.batch_number,
      'quantity_produced', pout.quantity_produced,
      'unit_cost', ROUND(pout.unit_cost, 4),
      'expiration_date', ib.expiration_date,
      'physical_location', ib.physical_location
    )
  )
  FROM production_outputs pout
  JOIN inventory_batches ib ON ib.batch_id = pout.batch_id
  WHERE pout.production_order_id = po.production_order_id
  ) AS outputs_detalle,
  
  -- Notas
  po.notes,
  po.cancellation_reason
  
FROM production_orders po
JOIN bill_of_materials bom ON bom.bom_id = po.bom_id
JOIN product_variants pv ON pv.variant_id = po.product_variant_id
JOIN products p ON p.product_id = pv.product_id
JOIN locations l ON l.location_id = po.location_id
LEFT JOIN users u_created ON u_created.user_id = po.created_by
LEFT JOIN users u_started ON u_started.user_id = po.started_by
LEFT JOIN users u_completed ON u_completed.user_id = po.completed_by
WHERE po.status IN ('COMPLETED', 'IN_PROGRESS', 'SCHEDULED')
ORDER BY po.actual_end DESC NULLS LAST, po.created_at DESC;

COMMENT ON VIEW vw_production_cost_report IS 
  'Reporte consolidado de costos de producción con análisis completo: teórico vs real, componentes, márgenes, yields.';

-- ============================================================================
-- VISTA: RESUMEN DE COSTOS POR PRODUCTO (ÚLTIMOS 90 DÍAS)
-- ============================================================================

CREATE OR REPLACE VIEW vw_production_cost_summary_by_product AS
SELECT 
  p.tenant_id,
  p.product_id,
  p.name AS product_name,
  pv.variant_id,
  pv.sku,
  pv.variant_name,
  
  -- Estadísticas de producción (últimos 90 días)
  COUNT(po.production_order_id) AS total_ordenes,
  COUNT(po.production_order_id) FILTER (WHERE po.status = 'COMPLETED') AS ordenes_completadas,
  COUNT(po.production_order_id) FILTER (WHERE po.status = 'IN_PROGRESS') AS ordenes_en_proceso,
  
  -- Cantidades
  SUM(po.quantity_produced) FILTER (WHERE po.status = 'COMPLETED') AS total_producido,
  AVG(po.quantity_produced) FILTER (WHERE po.status = 'COMPLETED') AS promedio_por_orden,
  
  -- Costos promedio
  AVG(
    CASE 
      WHEN po.quantity_produced > 0 
      THEN po.actual_cost / po.quantity_produced 
      ELSE 0 
    END
  ) FILTER (WHERE po.status = 'COMPLETED') AS costo_unitario_promedio,
  
  MIN(
    CASE 
      WHEN po.quantity_produced > 0 
      THEN po.actual_cost / po.quantity_produced 
      ELSE 0 
    END
  ) FILTER (WHERE po.status = 'COMPLETED') AS costo_unitario_minimo,
  
  MAX(
    CASE 
      WHEN po.quantity_produced > 0 
      THEN po.actual_cost / po.quantity_produced 
      ELSE 0 
    END
  ) FILTER (WHERE po.status = 'COMPLETED') AS costo_unitario_maximo,
  
  -- Eficiencia
  AVG(
    CASE 
      WHEN po.quantity_planned > 0 
      THEN (po.quantity_produced / po.quantity_planned * 100)
      ELSE 0 
    END
  ) FILTER (WHERE po.status = 'COMPLETED') AS yield_promedio,
  
  -- Variación de costos
  AVG(
    CASE 
      WHEN po.estimated_cost > 0 
      THEN ((po.actual_cost - po.estimated_cost) / po.estimated_cost * 100)
      ELSE 0 
    END
  ) FILTER (WHERE po.status = 'COMPLETED') AS variacion_costo_promedio_pct,
  
  -- Última producción
  MAX(po.actual_end) AS ultima_produccion,
  
  -- Costo actual del producto (precio de venta)
  pv.price AS precio_venta_actual,
  pv.cost AS costo_registrado,
  
  -- Margen teórico vs real
  CASE 
    WHEN pv.price > 0 AND AVG(
      CASE 
        WHEN po.quantity_produced > 0 
        THEN po.actual_cost / po.quantity_produced 
        ELSE 0 
      END
    ) FILTER (WHERE po.status = 'COMPLETED') IS NOT NULL
    THEN ROUND((
      (pv.price - AVG(
        CASE 
          WHEN po.quantity_produced > 0 
          THEN po.actual_cost / po.quantity_produced 
          ELSE 0 
        END
      ) FILTER (WHERE po.status = 'COMPLETED')) / pv.price * 100
    ), 2)
    ELSE NULL
  END AS margen_real_pct
  
FROM products p
JOIN product_variants pv ON pv.product_id = p.product_id
LEFT JOIN production_orders po ON po.product_variant_id = pv.variant_id
  AND po.actual_end >= NOW() - INTERVAL '90 days'
WHERE p.inventory_behavior = 'MANUFACTURED'
  AND EXISTS (
    SELECT 1 FROM production_orders 
    WHERE product_variant_id = pv.variant_id
  )
GROUP BY 
  p.tenant_id, p.product_id, p.name,
  pv.variant_id, pv.sku, pv.variant_name, pv.price, pv.cost
ORDER BY total_ordenes DESC, ultima_produccion DESC NULLS LAST;

COMMENT ON VIEW vw_production_cost_summary_by_product IS 
  'Resumen de costos de producción por producto (últimos 90 días). Útil para análisis de rentabilidad.';

-- ============================================================================
-- FUNCIÓN: TOP PRODUCTOS MANUFACTURADOS POR MARGEN
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_top_manufactured_products_by_margin(
  p_tenant_id UUID,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  product_name TEXT,
  sku TEXT,
  variant_name TEXT,
  total_producido NUMERIC,
  costo_unitario_real NUMERIC,
  precio_venta NUMERIC,
  margen_absoluto NUMERIC,
  margen_porcentaje NUMERIC,
  ordenes_completadas BIGINT
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pcs.product_name,
    pcs.sku,
    pcs.variant_name,
    pcs.total_producido,
    ROUND(pcs.costo_unitario_promedio, 2) AS costo_unitario_real,
    pcs.precio_venta_actual AS precio_venta,
    ROUND((pcs.precio_venta_actual - pcs.costo_unitario_promedio), 2) AS margen_absoluto,
    pcs.margen_real_pct AS margen_porcentaje,
    pcs.ordenes_completadas
  FROM vw_production_cost_summary_by_product pcs
  WHERE pcs.tenant_id = p_tenant_id
    AND pcs.ordenes_completadas > 0
    AND pcs.margen_real_pct IS NOT NULL
  ORDER BY pcs.margen_real_pct DESC
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION fn_top_manufactured_products_by_margin IS 
  'Retorna top productos manufacturados con mejor margen de utilidad.';

-- ============================================================================
-- VERIFICACIÓN
-- ============================================================================

DO $$ 
DECLARE
  v_view_count INT;
  v_completed_orders INT;
BEGIN
  -- Verificar que las vistas existen
  SELECT COUNT(*) INTO v_view_count
  FROM information_schema.views
  WHERE table_schema = 'public'
    AND table_name IN ('vw_production_cost_report', 'vw_production_cost_summary_by_product');
  
  -- Contar órdenes completadas
  SELECT COUNT(*) INTO v_completed_orders
  FROM production_orders
  WHERE status = 'COMPLETED';
  
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '📊 REPORTE DE COSTOS DE PRODUCCIÓN INSTALADO';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '✅ Componentes creados:';
  RAISE NOTICE '  • vw_production_cost_report - Reporte detallado por orden';
  RAISE NOTICE '  • vw_production_cost_summary_by_product - Resumen por producto';
  RAISE NOTICE '  • fn_top_manufactured_products_by_margin() - Top por margen';
  RAISE NOTICE '';
  RAISE NOTICE '📈 Datos disponibles:';
  RAISE NOTICE '  • Órdenes completadas: %', v_completed_orders;
  RAISE NOTICE '';
  RAISE NOTICE '🔍 Consultas de ejemplo:';
  RAISE NOTICE '';
  RAISE NOTICE '  -- Reporte detallado todas las órdenes';
  RAISE NOTICE '  SELECT * FROM vw_production_cost_report';
  RAISE NOTICE '  WHERE tenant_id = ''tu-tenant-id''';
  RAISE NOTICE '  ORDER BY fecha_fin_real DESC;';
  RAISE NOTICE '';
  RAISE NOTICE '  -- Resumen por producto (últimos 90 días)';
  RAISE NOTICE '  SELECT product_name, total_producido, costo_unitario_promedio,';
  RAISE NOTICE '         precio_venta_actual, margen_real_pct';
  RAISE NOTICE '  FROM vw_production_cost_summary_by_product';
  RAISE NOTICE '  WHERE tenant_id = ''tu-tenant-id'';';
  RAISE NOTICE '';
  RAISE NOTICE '  -- Top 10 productos por margen';
  RAISE NOTICE '  SELECT * FROM fn_top_manufactured_products_by_margin(''tu-tenant-id'', 10);';
  RAISE NOTICE '';
  RAISE NOTICE '💡 Campos clave en vw_production_cost_report:';
  RAISE NOTICE '  • costo_teorico_total vs costo_real_total';
  RAISE NOTICE '  • variacion_costo (diferencia absoluta)';
  RAISE NOTICE '  • yield_percentage (eficiencia producción)';
  RAISE NOTICE '  • componentes_detalle (JSON desglose componentes)';
  RAISE NOTICE '  • venta_info (JSON margen si se vendió ON_DEMAND)';
  RAISE NOTICE '';
END $$;
