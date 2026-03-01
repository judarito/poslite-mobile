/* ============================================================================
   INVESTIGAR: ¿Por qué hay 2 unidades si solo se produjo 1?
   ============================================================================ */

-- 1. Información de la orden PO-2026-00010
SELECT 
  '📋 ORDEN DE PRODUCCIÓN' as seccion,
  po.production_order_id,
  po.order_number,
  po.quantity_planned,
  po.quantity_produced,
  po.actual_cost,
  po.status,
  po.started_at,
  po.completed_at,
  pv.sku as producto_sku,
  p.name as producto_nombre
FROM production_orders po
JOIN product_variants pv ON pv.variant_id = po.variant_id
JOIN products p ON p.product_id = pv.product_id
WHERE po.order_number = 'PO-2026-00010';

-- 2. Production outputs (lotes creados)
SELECT 
  '📦 LOTES CREADOS (production_outputs)' as seccion,
  pout.output_id,
  pout.batch_id,
  pout.quantity_produced,
  pout.unit_cost,
  pout.produced_at,
  ib.batch_number,
  ib.on_hand as cantidad_actual_lote,
  ib.received,
  ib.reserved
FROM production_outputs pout
LEFT JOIN inventory_batches ib ON ib.batch_id = pout.batch_id
WHERE pout.production_order_id = (
  SELECT production_order_id FROM production_orders WHERE order_number = 'PO-2026-00010'
);

-- 3. Inventory batches del producto Pantalón Verde
SELECT 
  '🏷️ LOTES PRODUCTO FINAL' as seccion,
  ib.batch_id,
  ib.batch_number,
  ib.variant_id,
  ib.received as cantidad_recibida,
  ib.on_hand as cantidad_actual,
  ib.reserved,
  ib.unit_cost,
  ib.received_at,
  ib.source,
  ib.source_id,
  pv.sku
FROM inventory_batches ib
JOIN product_variants pv ON pv.variant_id = ib.variant_id
WHERE pv.sku LIKE '%PANT%VERDE%'
  AND ib.is_active = TRUE
ORDER BY ib.received_at DESC;

-- 4. Inventory moves del producto Pantalón
SELECT 
  '📊 MOVIMIENTOS INVENTARIO PRODUCTO FINAL' as seccion,
  im.inventory_move_id,
  im.move_type,
  im.quantity,
  im.unit_cost,
  im.source,
  im.source_id,
  im.created_at,
  pv.sku,
  CASE 
    WHEN im.source = 'PRODUCTION' THEN 
      'Orden: ' || (SELECT order_number FROM production_orders WHERE production_order_id = im.source_id)
    ELSE im.source
  END as origen
FROM inventory_moves im
JOIN product_variants pv ON pv.variant_id = im.variant_id
WHERE pv.sku LIKE '%PANT%VERDE%'
ORDER BY im.created_at DESC
LIMIT 10;

-- 5. Stock actual del producto
SELECT 
  '💰 STOCK ACTUAL PRODUCTO FINAL' as seccion,
  sb.variant_id,
  pv.sku,
  p.name,
  sb.on_hand as cantidad_disponible,
  sb.reserved as cantidad_reservada,
  sb.available as cantidad_disponible_venta,
  pv.cost as costo_unitario_producto,
  pv.price as precio_venta
FROM stock_balances sb
JOIN product_variants pv ON pv.variant_id = sb.variant_id
JOIN products p ON p.product_id = pv.product_id
WHERE pv.sku LIKE '%PANT%VERDE%';

-- 6. BOM utilizado y su costo teórico
SELECT 
  '📝 BOM Y COMPONENTES' as seccion,
  bom.bom_code,
  bom.version,
  (
    SELECT SUM(bc.quantity_required * pv2.cost)
    FROM bom_components bc
    JOIN product_variants pv2 ON pv2.variant_id = bc.component_variant_id
    WHERE bc.bom_id = bom.bom_id
  ) as costo_teorico_bom,
  (
    SELECT json_agg(json_build_object(
      'componente', p2.name,
      'sku', pv2.sku,
      'cantidad', bc.quantity_required,
      'costo_unitario', pv2.cost,
      'costo_total', bc.quantity_required * pv2.cost
    ))
    FROM bom_components bc
    JOIN product_variants pv2 ON pv2.variant_id = bc.component_variant_id
    JOIN products p2 ON p2.product_id = pv2.product_id
    WHERE bc.bom_id = bom.bom_id
  ) as componentes
FROM bill_of_materials bom
JOIN product_variants pv ON pv.variant_id = bom.variant_id
WHERE pv.sku LIKE '%PANT%VERDE%'
  AND bom.is_active = TRUE;

-- 7. Consumo de componentes en esta producción
SELECT 
  '🔧 CONSUMO DE COMPONENTES' as seccion,
  im.inventory_move_id,
  p.name as componente,
  pv.sku,
  im.quantity as cantidad_consumida,
  im.unit_cost as costo_unitario,
  (im.quantity * im.unit_cost) as costo_total,
  im.source,
  im.created_at
FROM inventory_moves im
JOIN product_variants pv ON pv.variant_id = im.variant_id
JOIN products p ON p.product_id = pv.product_id
WHERE im.move_type = 'COMPONENT_CONSUMPTION'
  AND im.source_id = (
    SELECT production_order_id FROM production_orders WHERE order_number = 'PO-2026-00010'
  )
ORDER BY im.created_at;

-- 8. RESUMEN DISCREPANCIA
SELECT 
  '⚠️ ANÁLISIS DISCREPANCIA' as seccion,
  po.quantity_produced as cantidad_orden,
  (SELECT SUM(pout.quantity_produced) 
   FROM production_outputs pout 
   WHERE pout.production_order_id = po.production_order_id) as cantidad_production_outputs,
  (SELECT SUM(ib.received) 
   FROM inventory_batches ib 
   JOIN production_outputs pout ON pout.batch_id = ib.batch_id
   WHERE pout.production_order_id = po.production_order_id) as cantidad_lotes,
  sb.on_hand as cantidad_stock_balance,
  CASE 
    WHEN sb.on_hand > po.quantity_produced THEN '❌ HAY MÁS STOCK QUE LO PRODUCIDO'
    WHEN sb.on_hand < po.quantity_produced THEN '❌ HAY MENOS STOCK QUE LO PRODUCIDO'
    ELSE '✅ Stock correcto'
  END as estado
FROM production_orders po
JOIN product_variants pv ON pv.variant_id = po.variant_id
LEFT JOIN stock_balances sb ON sb.variant_id = pv.variant_id
WHERE po.order_number = 'PO-2026-00010';
