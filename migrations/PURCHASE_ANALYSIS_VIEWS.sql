/* ============================================================================
   VISTAS Y FUNCIONES PARA ANÁLISIS DE COMPRAS
   
   Este script crea las vistas y funciones necesarias para el sistema de
   sugerencias inteligentes de compra y análisis de rotación de inventario.
   
   Dependencias: Requiere sistema base de inventario (stock_balances, sales, products)
   
   Autor: Sistema
   Fecha: Febrero 2026
   ============================================================================ */

-- =====================================================================
-- VISTA: ANÁLISIS DE ROTACIÓN DE INVENTARIO
-- =====================================================================

CREATE OR REPLACE VIEW vw_inventory_rotation_analysis AS
WITH sales_last_30_days AS (
  SELECT 
    sl.variant_id,
    COUNT(DISTINCT s.sale_id) AS sales_count,
    SUM(sl.quantity) AS total_sold,
    AVG(sl.quantity) AS avg_qty_per_sale,
    MAX(s.sold_at) AS last_sale_date,
    MIN(s.sold_at) AS first_sale_date
  FROM sale_lines sl
  JOIN sales s ON s.sale_id = sl.sale_id
  WHERE s.sold_at >= CURRENT_DATE - INTERVAL '30 days'
    AND s.status = 'COMPLETED'
  GROUP BY sl.variant_id
),
sales_last_90_days AS (
  SELECT 
    sl.variant_id,
    SUM(sl.quantity) AS total_sold_90d
  FROM sale_lines sl
  JOIN sales s ON s.sale_id = sl.sale_id
  WHERE s.sold_at >= CURRENT_DATE - INTERVAL '90 days'
    AND s.status = 'COMPLETED'
  GROUP BY sl.variant_id
),
current_stock AS (
  SELECT 
    sb.tenant_id,
    sb.variant_id,
    SUM(sb.on_hand) AS total_stock,
    ARRAY_AGG(DISTINCT sb.location_id) AS locations,
    COUNT(DISTINCT sb.location_id) AS num_locations
  FROM stock_balances sb
  GROUP BY sb.tenant_id, sb.variant_id
)
SELECT 
  cs.tenant_id,
  pv.variant_id,
  p.product_id,
  p.name AS product_name,
  pv.variant_name,
  pv.sku,
  COALESCE(cs.total_stock, 0) AS current_stock,
  COALESCE(s30.total_sold, 0) AS sold_last_30d,
  COALESCE(s90.total_sold_90d, 0) AS sold_last_90d,
  COALESCE(s30.sales_count, 0) AS transactions_30d,
  COALESCE(s30.avg_qty_per_sale, 0) AS avg_qty_per_sale,
  s30.last_sale_date,
  -- Calcular días desde última venta
  CASE 
    WHEN s30.last_sale_date IS NOT NULL THEN 
      CURRENT_DATE - s30.last_sale_date::date
    ELSE NULL
  END AS days_since_last_sale,
  -- Calcular velocidad de rotación (días promedio entre ventas)
  CASE 
    WHEN s30.sales_count > 1 AND s30.first_sale_date IS NOT NULL THEN
      (s30.last_sale_date::date - s30.first_sale_date::date) / NULLIF(s30.sales_count - 1, 0)
    ELSE NULL
  END AS avg_days_between_sales,
  -- Demanda diaria promedio (últimos 30 días)
  ROUND(COALESCE(s30.total_sold, 0) / 30.0, 2) AS avg_daily_demand,
  -- Días de inventario restante (stock / demanda diaria)
  CASE 
    WHEN COALESCE(s30.total_sold, 0) > 0 THEN
      ROUND((COALESCE(cs.total_stock, 0) * 30.0) / s30.total_sold, 1)
    ELSE NULL
  END AS days_of_stock_remaining,
  -- Tendencia (comparar 30d vs 90d)
  CASE 
    WHEN s90.total_sold_90d > 0 THEN
      ROUND(((s30.total_sold * 3.0) / s90.total_sold_90d - 1) * 100, 1)
    ELSE NULL
  END AS trend_percentage,
  pv.cost AS unit_cost,
  pv.price AS unit_price,
  pv.min_stock,
  pv.allow_backorder,
  cs.locations,
  cs.num_locations,
  p.is_active
FROM product_variants pv
JOIN products p ON p.product_id = pv.product_id
LEFT JOIN current_stock cs ON cs.variant_id = pv.variant_id
LEFT JOIN sales_last_30_days s30 ON s30.variant_id = pv.variant_id
LEFT JOIN sales_last_90_days s90 ON s90.variant_id = pv.variant_id
WHERE p.is_active = TRUE
  AND pv.is_active = TRUE;

COMMENT ON VIEW vw_inventory_rotation_analysis IS 
'Análisis completo de rotación de inventario con métricas de ventas, stock y tendencias.
Usado para sugerencias inteligentes de compra y análisis de demanda.';

-- =====================================================================
-- FUNCIÓN: GENERAR SUGERENCIAS INTELIGENTES DE COMPRA
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_get_purchase_suggestions(
  p_tenant_id UUID,
  p_min_priority INTEGER DEFAULT 1, -- 1=Crítico, 2=Alto, 3=Medio, 4=Bajo
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE(
  variant_id UUID,
  product_name TEXT,
  variant_name TEXT,
  sku TEXT,
  current_stock NUMERIC,
  min_stock NUMERIC,
  suggested_order_qty NUMERIC,
  priority INTEGER,
  priority_label TEXT,
  reason TEXT,
  days_of_stock NUMERIC,
  avg_daily_demand NUMERIC,
  sold_last_30d NUMERIC,
  unit_cost NUMERIC,
  estimated_cost NUMERIC,
  last_sale_date TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH suggestions AS (
    SELECT 
      ira.variant_id,
      ira.product_name,
      ira.variant_name,
      ira.sku,
      ira.current_stock,
      ira.min_stock,
      -- Calcular cantidad sugerida de pedido
      CASE
        -- Si está agotado y tiene ventas, pedir para 30 días
        WHEN ira.current_stock <= 0 AND ira.avg_daily_demand > 0 THEN
          CEIL(ira.avg_daily_demand * 30)
        -- Si está bajo mínimo, completar hasta 30 días de stock
        WHEN ira.current_stock < COALESCE(ira.min_stock, 0) AND ira.avg_daily_demand > 0 THEN
          GREATEST(
            COALESCE(ira.min_stock, 0) - ira.current_stock,
            CEIL(ira.avg_daily_demand * 30 - ira.current_stock)
          )
        -- Si tiene menos de 7 días de stock, pedir para 30 días
        WHEN ira.days_of_stock_remaining < 7 AND ira.avg_daily_demand > 0 THEN
          CEIL(ira.avg_daily_demand * 30 - ira.current_stock)
        -- Si tiene entre 7 y 15 días, pedir para 20 días
        WHEN ira.days_of_stock_remaining < 15 AND ira.avg_daily_demand > 0 THEN
          CEIL(ira.avg_daily_demand * 20)
        ELSE 0
      END AS suggested_qty,
      -- Determinar prioridad
      CASE
        -- CRÍTICO: Agotado con ventas recientes (últimos 7 días)
        WHEN ira.current_stock <= 0 
          AND ira.sold_last_30d > 0 
          AND ira.days_since_last_sale <= 7 THEN 1
        -- ALTO: Bajo mínimo o menos de 7 días de stock
        WHEN ira.current_stock < COALESCE(ira.min_stock, 0)
          OR (ira.days_of_stock_remaining < 7 AND ira.avg_daily_demand > 0) THEN 2
        -- MEDIO: Menos de 15 días de stock con demanda creciente
        WHEN ira.days_of_stock_remaining < 15 
          AND ira.trend_percentage > 10 THEN 3
        ELSE 4
      END AS priority_level,
      -- Razón de la sugerencia
      CASE
        WHEN ira.current_stock <= 0 AND ira.sold_last_30d > 0 THEN
          'AGOTADO con demanda activa (última venta hace ' || ira.days_since_last_sale || ' días)'
        WHEN ira.current_stock < COALESCE(ira.min_stock, 0) THEN
          'Stock bajo mínimo (' || COALESCE(ira.min_stock, 0) || ' unidades)'
        WHEN ira.days_of_stock_remaining < 7 THEN
          'Quedan solo ' || ROUND(ira.days_of_stock_remaining, 1) || ' días de stock'
        WHEN ira.days_of_stock_remaining < 15 AND ira.trend_percentage > 10 THEN
          'Demanda creciente (+' || ira.trend_percentage || '%), ' || ROUND(ira.days_of_stock_remaining, 1) || ' días de stock'
        ELSE 'Stock preventivo'
      END AS reason_text,
      ira.days_of_stock_remaining,
      ira.avg_daily_demand,
      ira.sold_last_30d,
      ira.unit_cost,
      ira.last_sale_date
    FROM vw_inventory_rotation_analysis ira
    WHERE ira.tenant_id = p_tenant_id
      AND ira.is_active = TRUE
      -- Solo productos con ventas o bajo mínimo
      AND (
        ira.sold_last_30d > 0 
        OR ira.current_stock < COALESCE(ira.min_stock, 0)
      )
  )
  SELECT 
    s.variant_id,
    s.product_name,
    s.variant_name,
    s.sku,
    s.current_stock,
    s.min_stock,
    s.suggested_qty,
    s.priority_level,
    CASE s.priority_level
      WHEN 1 THEN 'CRÍTICO'
      WHEN 2 THEN 'ALTO'
      WHEN 3 THEN 'MEDIO'
      ELSE 'BAJO'
    END,
    s.reason_text,
    s.days_of_stock_remaining,
    s.avg_daily_demand,
    s.sold_last_30d,
    s.unit_cost,
    ROUND(s.suggested_qty * s.unit_cost, 2),
    s.last_sale_date
  FROM suggestions s
  WHERE s.priority_level <= p_min_priority
    AND s.suggested_qty > 0
  ORDER BY 
    s.priority_level ASC,
    s.days_of_stock_remaining ASC NULLS LAST,
    s.sold_last_30d DESC
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION fn_get_purchase_suggestions IS 
'Genera sugerencias inteligentes de compra basadas en rotación de inventario,
patrones de venta y tendencias. Calcula automáticamente cantidades óptimas
y prioriza productos críticos.

Parámetros:
- p_tenant_id: ID del tenant
- p_min_priority: Nivel mínimo de prioridad (1=Crítico, 2=Alto, 3=Medio, 4=Bajo)
- p_limit: Número máximo de sugerencias a retornar';

-- =====================================================================
-- VERIFICACIÓN
-- =====================================================================

DO $$
BEGIN
  RAISE NOTICE '✓ Vista vw_inventory_rotation_analysis creada';
  RAISE NOTICE '✓ Función fn_get_purchase_suggestions creada';
  RAISE NOTICE '';
  RAISE NOTICE 'Sistema de análisis de compras instalado correctamente';
  RAISE NOTICE 'Ahora puede usar las sugerencias inteligentes de compra en el módulo de Compras';
END;
$$;
