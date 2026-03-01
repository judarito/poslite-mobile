/* ============================================================================
   SISTEMA DE LOTES CON FECHA DE VENCIMIENTO - FASE 1
   Configuración jerárquica producto/variante + estructura base
   
   CARACTERÍSTICAS:
   - Jerarquía: producto define default, variante puede override
   - Función helper para obtener configuración efectiva
   - Parámetros configurables por tenant
   - Compatible con sistema existente
   
   AUTOR: Sistema POS-Lite
   FECHA: 2026-02-15
   ============================================================================ */

-- =========================
-- 1) CONFIGURACIÓN EN PRODUCTOS Y VARIANTES
-- =========================

-- Agregar control de vencimiento en productos (nivel padre)
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS requires_expiration BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN products.requires_expiration IS 
  'Define si el producto requiere fecha de vencimiento por defecto. Heredado por variantes.';

-- Agregar control de vencimiento en variantes (puede override)
ALTER TABLE product_variants 
ADD COLUMN IF NOT EXISTS requires_expiration BOOLEAN DEFAULT NULL;

COMMENT ON COLUMN product_variants.requires_expiration IS 
  'Override de requires_expiration del producto. NULL = hereda del producto.';

-- =========================
-- 2) FUNCIÓN HELPER: JERARQUÍA DE CONFIGURACIÓN
-- =========================

CREATE OR REPLACE FUNCTION fn_variant_requires_expiration(
  p_tenant UUID, 
  p_variant UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT COALESCE(
    pv.requires_expiration,      -- Prioridad 1: configuración de la variante
    p.requires_expiration,        -- Prioridad 2: configuración del producto
    FALSE                         -- Prioridad 3: default del sistema
  )
  FROM product_variants pv
  JOIN products p ON p.product_id = pv.product_id AND p.tenant_id = pv.tenant_id
  WHERE pv.tenant_id = p_tenant 
    AND pv.variant_id = p_variant;
$$;

COMMENT ON FUNCTION fn_variant_requires_expiration IS 
  'Determina si una variante requiere fecha de vencimiento siguiendo jerarquía: variante > producto > false';

-- =========================
-- 3) PARÁMETROS CONFIGURABLES POR TENANT
-- =========================

ALTER TABLE tenant_settings 
ADD COLUMN IF NOT EXISTS expiration_config JSONB DEFAULT 
'{
  "warn_days_before_expiration": 30,
  "critical_days_before_expiration": 7,
  "block_sale_when_expired": true,
  "allow_sell_near_expiry": true,
  "alert_on_purchase": true,
  "auto_fefo": true
}'::JSONB;

COMMENT ON COLUMN tenant_settings.expiration_config IS 
  'Configuración de alertas y reglas de vencimiento:
  - warn_days_before_expiration: días para alerta amarilla
  - critical_days_before_expiration: días para alerta roja
  - block_sale_when_expired: bloquear venta de productos vencidos
  - allow_sell_near_expiry: permitir venta de productos por vencer
  - alert_on_purchase: alertar al comprar producto con vencimiento
  - auto_fefo: aplicar FEFO automáticamente en ventas';

-- =========================
-- 4) ÍNDICES PARA OPTIMIZACIÓN
-- =========================

CREATE INDEX IF NOT EXISTS idx_products_expiration 
ON products(tenant_id, requires_expiration) 
WHERE requires_expiration = TRUE;

CREATE INDEX IF NOT EXISTS idx_variants_expiration 
ON product_variants(tenant_id, requires_expiration) 
WHERE requires_expiration IS NOT NULL;

-- =========================
-- 5) VISTA DE PRODUCTOS CON VENCIMIENTO
-- =========================

CREATE OR REPLACE VIEW vw_products_expiration_config AS
SELECT 
  p.tenant_id,
  p.product_id,
  p.name AS product_name,
  p.requires_expiration AS product_requires_expiration,
  pv.variant_id,
  pv.sku,
  pv.variant_name,
  pv.requires_expiration AS variant_requires_expiration,
  -- Configuración efectiva
  COALESCE(pv.requires_expiration, p.requires_expiration, FALSE) AS effective_requires_expiration,
  -- Info de origen
  CASE 
    WHEN pv.requires_expiration IS NOT NULL THEN 'VARIANT_OVERRIDE'
    WHEN p.requires_expiration IS TRUE THEN 'PRODUCT_DEFAULT'
    ELSE 'SYSTEM_DEFAULT'
  END AS config_source
FROM products p
JOIN product_variants pv ON pv.product_id = p.product_id AND pv.tenant_id = p.tenant_id
WHERE p.is_active = TRUE AND pv.is_active = TRUE;

COMMENT ON VIEW vw_products_expiration_config IS 
  'Vista de configuración efectiva de vencimiento para cada variante con su origen';

-- =========================
-- 6) FUNCIÓN HELPER: OBTENER CONFIGURACIÓN DE TENANT
-- =========================

CREATE OR REPLACE FUNCTION fn_get_expiration_config(
  p_tenant UUID,
  p_config_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE SQL
STABLE
AS $$
  SELECT 
    CASE 
      WHEN p_config_key IS NULL THEN expiration_config
      ELSE expiration_config->p_config_key
    END
  FROM tenant_settings
  WHERE tenant_id = p_tenant;
$$;

COMMENT ON FUNCTION fn_get_expiration_config IS 
  'Obtiene configuración de vencimiento del tenant. Si se pasa key, retorna solo ese valor.';

-- =========================
-- 7) VALIDACIONES
-- =========================

-- Trigger para validar configuración en JSON
CREATE OR REPLACE FUNCTION trg_validate_expiration_config()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Validar que los valores numéricos sean positivos
  IF (NEW.expiration_config->>'warn_days_before_expiration')::INT < 0 THEN
    RAISE EXCEPTION 'warn_days_before_expiration debe ser >= 0';
  END IF;
  
  IF (NEW.expiration_config->>'critical_days_before_expiration')::INT < 0 THEN
    RAISE EXCEPTION 'critical_days_before_expiration debe ser >= 0';
  END IF;
  
  -- Validar que warn >= critical
  IF (NEW.expiration_config->>'warn_days_before_expiration')::INT < 
     (NEW.expiration_config->>'critical_days_before_expiration')::INT THEN
    RAISE EXCEPTION 'warn_days debe ser >= critical_days';
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_before_update_expiration_config
BEFORE INSERT OR UPDATE OF expiration_config ON tenant_settings
FOR EACH ROW
EXECUTE FUNCTION trg_validate_expiration_config();

-- =========================
-- FIN FASE 1
-- =========================
