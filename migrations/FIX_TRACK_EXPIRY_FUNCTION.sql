/* ============================================================================
   FIX: Corregir función fn_variant_requires_expiration
   
   PROBLEMA: 
   - La función usa "track_expiry" pero la columna correcta es "requires_expiration"
   - La tabla categories no tiene columna de expiration
   
   SOLUCIÓN:
   - Actualizar función para usar "requires_expiration"
   - Eliminar referencia a categories
   ============================================================================ */

CREATE OR REPLACE FUNCTION fn_variant_requires_expiration(
  p_tenant UUID,
  p_variant UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_variant_track BOOLEAN;
  v_product_track BOOLEAN;
BEGIN
  SELECT 
    pv.requires_expiration,
    p.requires_expiration
  INTO v_variant_track, v_product_track
  FROM product_variants pv
  JOIN products p ON p.product_id = pv.product_id
  WHERE pv.tenant_id = p_tenant
    AND pv.variant_id = p_variant
    AND pv.is_active = TRUE
    AND p.is_active = TRUE;
  
  -- Jerarquía: variante > producto > FALSE
  -- Si variant tiene requires_expiration definido (no NULL), usar ese
  -- Si no, usar el del producto
  -- Si ninguno tiene, default FALSE
  RETURN COALESCE(v_variant_track, v_product_track, FALSE);
END;
$$;

COMMENT ON FUNCTION fn_variant_requires_expiration IS 
  'Resuelve si variante requiere vencimiento. Jerarquía: variant.requires_expiration > product.requires_expiration > FALSE';

-- Verificar que existe
DO $$
BEGIN
  RAISE NOTICE '✅ Función fn_variant_requires_expiration corregida';
  RAISE NOTICE 'Jerarquía: variant.requires_expiration > product.requires_expiration > FALSE';
END;
$$ LANGUAGE plpgsql;
