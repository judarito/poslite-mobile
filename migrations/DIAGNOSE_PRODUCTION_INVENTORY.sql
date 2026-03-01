-- =====================================================================
-- DIAGNÓSTICO: Sistema de inventario de producción
-- =====================================================================

-- 1. Verificar si el trigger existe
SELECT 
  'Trigger existe?' AS verificacion,
  CASE 
    WHEN COUNT(*) > 0 THEN '✅ SÍ'
    ELSE '❌ NO - ejecuta FIX_PRODUCTION_INVENTORY.sql'
  END AS resultado
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE tgname = 'trg_generate_production_inventory';

-- 2. Verificar si la función existe
SELECT 
  'Función existe?' AS verificacion,
  CASE 
    WHEN COUNT(*) > 0 THEN '✅ SÍ'
    ELSE '❌ NO - ejecuta FIX_PRODUCTION_INVENTORY.sql'
  END AS resultado
FROM pg_proc
WHERE proname = 'fn_generate_production_inventory';

-- 3. Conteo de registros
SELECT 
  tabla,
  cantidad,
  CASE 
    WHEN tabla LIKE '%COMPLETED' AND cantidad = '0' THEN '⚠️  Necesitas completar una orden de producción'
    WHEN tabla LIKE '%outputs' AND cantidad = '0' THEN '⚠️  No se ha insertado en production_outputs'
    WHEN tabla LIKE '%batches%' AND cantidad = '0' THEN '❌ No se generó inventory_batch (trigger no funciona)'
    WHEN tabla LIKE '%moves%' AND cantidad = '0' THEN '❌ No se generó inventory_move (trigger no funciona)'
    ELSE '✅ OK'
  END AS estado
FROM (
  SELECT 'production_orders COMPLETED' AS tabla, COUNT(*)::text AS cantidad
  FROM production_orders WHERE status = 'COMPLETED'
  UNION ALL
  SELECT 'production_outputs', COUNT(*)::text
  FROM production_outputs
  UNION ALL
  SELECT 'inventory_batches (PRD-)', COUNT(*)::text
  FROM inventory_batches WHERE batch_number LIKE 'PRD-%'
  UNION ALL
  SELECT 'inventory_moves (PRODUCTION_IN)', COUNT(*)::text
  FROM inventory_moves WHERE move_type = 'PRODUCTION_IN'
) t;

-- 4. Órdenes completadas (últimas 5)
SELECT 
  order_number,
  status,
  quantity_planned,
  quantity_produced,
  product_variant_id,
  TO_CHAR(completed_at, 'YYYY-MM-DD HH24:MI') AS completado
FROM production_orders
WHERE status = 'COMPLETED'
ORDER BY completed_at DESC
LIMIT 5;

-- 5. Production outputs (últimos 5)
SELECT 
  output_id,
  production_order_id,
  variant_id,
  quantity_produced,
  batch_id,
  unit_cost,
  TO_CHAR(produced_at, 'YYYY-MM-DD HH24:MI') AS producido
FROM production_outputs
ORDER BY produced_at DESC
LIMIT 5;

-- 6. Columnas de production_outputs
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'production_outputs'
ORDER BY ordinal_position;
