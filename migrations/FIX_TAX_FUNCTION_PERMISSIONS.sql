/* ============================================================
   FIX: Permisos para fn_get_tax_rate_for_variant
   ============================================================
   
   La función necesita SECURITY DEFINER para poder leer
   tax_rules y taxes sin problemas de RLS
   
   ============================================================ */

-- Recrear la función con SECURITY DEFINER
CREATE OR REPLACE FUNCTION fn_get_tax_rate_for_variant(
  p_tenant uuid,
  p_variant uuid
) 
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER  -- ← Esto permite que la función ignore RLS
STABLE
AS $$
  WITH v AS (
    SELECT pv.variant_id, pv.product_id, p.category_id
    FROM product_variants pv
    JOIN products p ON p.product_id = pv.product_id
    WHERE pv.tenant_id = p_tenant AND pv.variant_id = p_variant
  ),
  rules AS (
    SELECT tr.*, t.rate,
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
  )
  SELECT COALESCE(
    (SELECT rate
       FROM rules
      ORDER BY scope_weight DESC, priority DESC
      LIMIT 1),
    0
  );
$$;

-- Dar permisos de ejecución a usuarios autenticados
GRANT EXECUTE ON FUNCTION fn_get_tax_rate_for_variant(uuid, uuid) TO authenticated;

-- Mensaje
DO $$
BEGIN
  RAISE NOTICE '✅ Función fn_get_tax_rate_for_variant actualizada con SECURITY DEFINER';
  RAISE NOTICE '📝 Ahora puede ser llamada desde el frontend sin problemas de RLS';
END $$;
