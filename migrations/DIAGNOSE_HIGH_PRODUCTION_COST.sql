/* ============================================================================
   DIAGNÓSTICO: ¿Por qué el costo de producción es $152,500 en lugar de $12,800?
   ============================================================================ */

-- 1. Información de la orden completada
SELECT 
  '📋 ORDEN DE PRODUCCIÓN' as seccion,
  po.order_number,
  po.quantity_planned,
  po.quantity_produced,
  po.actual_cost as costo_real_orden,
  pv.sku as producto_sku,
  p.name as producto_nombre,
  pv.cost as costo_variante_actual,
  pv.price as precio_venta_actual
FROM production_orders po
JOIN product_variants pv ON pv.variant_id = po.product_variant_id
JOIN products p ON p.product_id = pv.product_id
WHERE po.order_number = 'PO-2026-00010';

-- 2. BOM utilizado y costo teórico
SELECT 
  '📝 COSTO TEÓRICO BOM' as seccion,
  bom.bom_code,
  bom.version,
  SUM(bc.quantity_required * pv2.cost) as costo_teorico_total,
  json_agg(json_build_object(
    'componente', p2.name,
    'sku', pv2.sku,
    'cantidad_requerida', bc.quantity_required,
    'costo_unitario_variante', pv2.cost,
    'costo_total_linea', bc.quantity_required * pv2.cost
  ) ORDER BY p2.name) as componentes_teoricos
FROM production_orders po
JOIN bill_of_materials bom ON bom.bom_id = po.bom_id
JOIN bom_components bc ON bc.bom_id = bom.bom_id
JOIN product_variants pv2 ON pv2.variant_id = bc.component_variant_id
JOIN products p2 ON p2.product_id = pv2.product_id
WHERE po.order_number = 'PO-2026-00010'
GROUP BY bom.bom_code, bom.version;

-- 3. Componentes REALMENTE consumidos (desde inventory_moves)
SELECT 
  '🔧 COMPONENTES CONSUMIDOS REALES' as seccion,
  p.name as componente,
  pv.sku,
  im.quantity as cantidad_consumida,
  im.unit_cost as costo_unitario_usado,
  (im.quantity * im.unit_cost) as costo_total_componente,
  im.created_at as fecha_consumo
FROM inventory_moves im
JOIN product_variants pv ON pv.variant_id = im.variant_id
JOIN products p ON p.product_id = pv.product_id
WHERE im.move_type = 'COMPONENT_CONSUMPTION'
  AND im.source_id = (
    SELECT production_order_id FROM production_orders WHERE order_number = 'PO-2026-00010'
  )
ORDER BY p.name;

-- 4. RESUMEN: Comparación costo teórico vs real
SELECT 
  '⚠️ COMPARACIÓN COSTOS' as seccion,
  po.actual_cost as costo_real_produccion,
  (
    SELECT SUM(bc.quantity_required * pv2.cost)
    FROM bom_components bc
    JOIN product_variants pv2 ON pv2.variant_id = bc.component_variant_id
    WHERE bc.bom_id = po.bom_id
  ) as costo_teorico_bom,
  (
    SELECT SUM(im.quantity * im.unit_cost)
    FROM inventory_moves im
    WHERE im.move_type = 'COMPONENT_CONSUMPTION'
      AND im.source_id = po.production_order_id
  ) as costo_calculado_consumos,
  CASE 
    WHEN po.actual_cost > (
      SELECT SUM(bc.quantity_required * pv2.cost)
      FROM bom_components bc
      JOIN product_variants pv2 ON pv2.variant_id = bc.component_variant_id
      WHERE bc.bom_id = po.bom_id
    ) * 2 THEN '❌ COSTO MUY ALTO (más del doble)'
    ELSE '⚠️ Verificar componentes'
  END as estado
FROM production_orders po
WHERE po.order_number = 'PO-2026-00010';

-- 5. Lotes usados en el consumo (verificar unit_cost de lotes)
SELECT 
  '🏷️ LOTES CONSUMIDOS' as seccion,
  p.name as componente,
  pv.sku,
  ib.batch_number,
  ib.unit_cost as costo_unitario_lote,
  ib.received_at as fecha_recepcion_lote,
  pv.cost as costo_actual_variante,
  CASE 
    WHEN ib.unit_cost > pv.cost * 5 THEN '❌ COSTO LOTE MUY ALTO'
    WHEN ib.unit_cost != pv.cost THEN '⚠️ Costo lote diferente a variante'
    ELSE '✅ OK'
  END as estado_costo
FROM inventory_moves im
JOIN product_variants pv ON pv.variant_id = im.variant_id
JOIN products p ON p.product_id = pv.product_id
LEFT JOIN LATERAL (
  SELECT ib2.batch_number, ib2.unit_cost, ib2.received_at
  FROM inventory_batches ib2
  WHERE ib2.variant_id = im.variant_id
  ORDER BY ib2.received_at DESC
  LIMIT 1
) ib ON TRUE
WHERE im.move_type = 'COMPONENT_CONSUMPTION'
  AND im.source_id = (
    SELECT production_order_id FROM production_orders WHERE order_number = 'PO-2026-00010'
  )
ORDER BY p.name;

-- 6. Todos los lotes de cada componente (para verificar costos)
SELECT 
  '📦 TODOS LOS LOTES DE COMPONENTES' as seccion,
  p.name as componente,
  pv.sku,
  ib.batch_number,
  ib.unit_cost as costo_unitario,
  ib.on_hand as cantidad_disponible,
  ib.received_at,
  CASE 
    WHEN ib.unit_cost > 50000 THEN '❌ COSTO SOSPECHOSAMENTE ALTO'
    WHEN ib.unit_cost = 0 THEN '⚠️ Costo en cero'
    ELSE '✅ Normal'
  END as estado
FROM inventory_batches ib
JOIN product_variants pv ON pv.variant_id = ib.variant_id
JOIN products p ON p.product_id = pv.product_id
WHERE pv.variant_id IN (
  SELECT bc.component_variant_id
  FROM production_orders po
  JOIN bom_components bc ON bc.bom_id = po.bom_id
  WHERE po.order_number = 'PO-2026-00010'
)
  AND ib.is_active = TRUE
ORDER BY p.name, ib.received_at DESC;

-- 7. Historial de compras de componentes (verificar costos originales)
SELECT 
  '🛒 HISTORIAL COMPRAS COMPONENTES' as seccion,
  p.name as componente,
  pv.sku,
  im.move_type,
  im.quantity,
  im.unit_cost,
  (im.quantity * im.unit_cost) as total,
  im.created_at,
  im.source
FROM inventory_moves im
JOIN product_variants pv ON pv.variant_id = im.variant_id
JOIN products p ON p.product_id = pv.product_id
WHERE pv.variant_id IN (
  SELECT bc.component_variant_id
  FROM production_orders po
  JOIN bom_components bc ON bc.bom_id = po.bom_id
  WHERE po.order_number = 'PO-2026-00010'
)
  AND im.move_type IN ('PURCHASE_IN', 'ADJUSTMENT')
ORDER BY pv.sku, im.created_at DESC;

-- 8. IDENTIFICAR COMPONENTE PROBLEMÁTICO
SELECT 
  '🚨 ANÁLISIS DETALLADO POR COMPONENTE' as seccion,
  p.name as componente,
  pv.sku,
  -- Costo teórico (del BOM)
  (SELECT bc.quantity_required * pv.cost
   FROM bom_components bc
   WHERE bc.bom_id = (SELECT bom_id FROM production_orders WHERE order_number = 'PO-2026-00010')
     AND bc.component_variant_id = pv.variant_id
  ) as costo_teorico_componente,
  -- Costo real consumido
  (SELECT SUM(im.quantity * im.unit_cost)
   FROM inventory_moves im
   WHERE im.variant_id = pv.variant_id
     AND im.move_type = 'COMPONENT_CONSUMPTION'
     AND im.source_id = (SELECT production_order_id FROM production_orders WHERE order_number = 'PO-2026-00010')
  ) as costo_real_consumido,
  -- Diferencia
  (SELECT SUM(im.quantity * im.unit_cost)
   FROM inventory_moves im
   WHERE im.variant_id = pv.variant_id
     AND im.move_type = 'COMPONENT_CONSUMPTION'
     AND im.source_id = (SELECT production_order_id FROM production_orders WHERE order_number = 'PO-2026-00010')
  ) - (SELECT bc.quantity_required * pv.cost
       FROM bom_components bc
       WHERE bc.bom_id = (SELECT bom_id FROM production_orders WHERE order_number = 'PO-2026-00010')
         AND bc.component_variant_id = pv.variant_id
      ) as diferencia,
  -- Estado
  CASE 
    WHEN (SELECT SUM(im.quantity * im.unit_cost)
          FROM inventory_moves im
          WHERE im.variant_id = pv.variant_id
            AND im.move_type = 'COMPONENT_CONSUMPTION'
            AND im.source_id = (SELECT production_order_id FROM production_orders WHERE order_number = 'PO-2026-00010')
         ) > (SELECT bc.quantity_required * pv.cost
              FROM bom_components bc
              WHERE bc.bom_id = (SELECT bom_id FROM production_orders WHERE order_number = 'PO-2026-00010')
                AND bc.component_variant_id = pv.variant_id
             ) * 10 THEN '❌ ESTE ES EL PROBLEMA'
    ELSE '✅ OK'
  END as diagnostico
FROM product_variants pv
JOIN products p ON p.product_id = pv.product_id
WHERE pv.variant_id IN (
  SELECT bc.component_variant_id
  FROM production_orders po
  JOIN bom_components bc ON bc.bom_id = po.bom_id
  WHERE po.order_number = 'PO-2026-00010'
)
ORDER BY diagnostico DESC, diferencia DESC NULLS LAST;
