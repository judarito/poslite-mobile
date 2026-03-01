-- ===================================================================
-- Migración: Mejorar visualización de información de impuestos
-- Fecha: 2026-02-14
-- Descripción: 
--   1. Nueva función que devuelve información completa del impuesto
--   2. Permite mostrar subtotales y nombre de impuestos en UI
-- ===================================================================

-- =================================================================
-- 1. FUNCIÓN: Obtener información completa del impuesto aplicable
-- =================================================================
CREATE OR REPLACE FUNCTION fn_get_tax_info_for_variant(
  p_tenant uuid,
  p_variant uuid
) 
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  WITH v AS (
    SELECT pv.variant_id, pv.product_id, p.category_id
    FROM product_variants pv
    JOIN products p ON p.product_id = pv.product_id
    WHERE pv.tenant_id = p_tenant AND pv.variant_id = p_variant
  ),
  rules AS (
    SELECT 
      tr.*, 
      t.rate,
      t.code AS tax_code,
      t.name AS tax_name,
      CASE tr.scope
        WHEN 'VARIANT' THEN 4
        WHEN 'PRODUCT' THEN 3
        WHEN 'CATEGORY' THEN 2
        WHEN 'TENANT' THEN 1
        ELSE 0
      END AS scope_weight
    FROM tax_rules tr
    JOIN taxes t ON t.tax_id = tr.tax_id
    JOIN v ON true
    WHERE tr.tenant_id = p_tenant
      AND tr.is_active = true
      AND t.is_active = true
      AND (
        (tr.scope='VARIANT' AND tr.variant_id = v.variant_id) OR
        (tr.scope='PRODUCT' AND tr.product_id = v.product_id) OR
        (tr.scope='CATEGORY' AND tr.category_id = v.category_id) OR
        (tr.scope='TENANT')
      )
  ),
  best_rule AS (
    SELECT rate, tax_code, tax_name
    FROM rules
    ORDER BY scope_weight DESC, priority DESC
    LIMIT 1
  )
  SELECT COALESCE(
    (SELECT jsonb_build_object(
      'rate', rate,
      'code', tax_code,
      'name', tax_name
    ) FROM best_rule),
    jsonb_build_object('rate', 0, 'code', null, 'name', null)
  );
$$;

COMMENT ON FUNCTION fn_get_tax_info_for_variant IS 
'Retorna información completa del impuesto aplicable a una variante.
Respuesta: { "rate": 0.19, "code": "IVA", "name": "Impuesto al Valor Agregado" }';

-- Dar permisos de ejecución
GRANT EXECUTE ON FUNCTION fn_get_tax_info_for_variant(uuid, uuid) TO authenticated;

-- =================================================================
-- Mensajes de confirmación
-- =================================================================
DO $$
BEGIN
  RAISE NOTICE '✅ Función fn_get_tax_info_for_variant creada';
  RAISE NOTICE '📝 Retorna: { "rate": 0.19, "code": "IVA", "name": "Impuesto al Valor Agregado" }';
  RAISE NOTICE '';
  RAISE NOTICE '🔧 Próximo paso: Actualizar taxes.service.js para usar esta función';
END $$;
