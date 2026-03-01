/* ============================================================================
   SISTEMA DE LOTES CON FECHA DE VENCIMIENTO - FASE 2
   Tabla de lotes (inventory_batches) + conversión de stock_balances
   
   IMPORTANTE: Esta fase modifica la estructura de inventario
   - Crea tabla inventory_batches para gestión granular de lotes
   - Convierte stock_balances en vista materializada
   - Incluye migración de datos existentes
   
   REQUERIMIENTOS: Ejecutar PHASE1 primero
   DOWNTIME: Se requiere ventana de mantenimiento (~1-2 horas)
   
   AUTOR: Sistema POS-Lite
   FECHA: 2026-02-15
   ============================================================================ */

-- =========================
-- 1) TABLA PRINCIPAL: INVENTORY_BATCHES
-- =========================

CREATE TABLE IF NOT EXISTS inventory_batches (
  batch_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(location_id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(variant_id) ON DELETE CASCADE,
  
  -- Identificación del lote
  batch_number TEXT NOT NULL,
  
  -- Fecha de vencimiento (obligatoria si requires_expiration = true)
  expiration_date DATE,
  
  -- Cantidades
  on_hand NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  
  -- Costo y ubicación física
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  physical_location TEXT,  -- 'BODEGA-A1', 'NEVERA-2', 'ESTANTE-B3'
  
  -- Control y auditoría
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(user_id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  
  -- Restricciones y constraints
  UNIQUE(tenant_id, location_id, variant_id, batch_number),
  
  -- Validar que reserved no exceda on_hand
  CHECK (reserved <= on_hand)
);

COMMENT ON TABLE inventory_batches IS 
  'Lotes de inventario con trazabilidad completa. Permite gestión FEFO y control de vencimientos.';

COMMENT ON COLUMN inventory_batches.batch_number IS 
  'Número único de lote dentro de tenant/location/variant. Puede ser del proveedor o generado.';

COMMENT ON COLUMN inventory_batches.expiration_date IS 
  'Fecha de vencimiento. NULL para productos sin vencimiento. Obligatoria si requires_expiration=true.';

COMMENT ON COLUMN inventory_batches.physical_location IS 
  'Ubicación física en la sede: bodega, nevera, estante, etc. Útil para cajero.';

-- =========================
-- 2) ÍNDICES DE RENDIMIENTO
-- =========================

-- Índice principal para consultas de disponibilidad
CREATE INDEX idx_batches_availability 
ON inventory_batches(tenant_id, location_id, variant_id, is_active)
WHERE (on_hand - reserved) > 0;

-- Índice para FEFO (First Expired, First Out)
CREATE INDEX idx_batches_fefo 
ON inventory_batches(tenant_id, location_id, variant_id, expiration_date NULLS LAST, received_at)
WHERE is_active = TRUE AND (on_hand - reserved) > 0;

-- Índice para alertas de vencimiento
CREATE INDEX idx_batches_expiring 
ON inventory_batches(tenant_id, expiration_date)
WHERE is_active = TRUE AND expiration_date IS NOT NULL AND (on_hand - reserved) > 0;

-- Índice para búsqueda por número de lote
CREATE INDEX idx_batches_number 
ON inventory_batches(tenant_id, batch_number);

-- =========================
-- 3) TRIGGER: VALIDAR VENCIMIENTO OBLIGATORIO
-- =========================

CREATE OR REPLACE FUNCTION trg_validate_batch_expiration()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_requires_exp BOOLEAN;
BEGIN
  -- Obtener si la variante requiere vencimiento
  v_requires_exp := fn_variant_requires_expiration(NEW.tenant_id, NEW.variant_id);
  
  -- Si requiere vencimiento y no se proporcionó, error
  IF v_requires_exp AND NEW.expiration_date IS NULL THEN
    RAISE EXCEPTION 'La variante % requiere fecha de vencimiento pero no se proporcionó', NEW.variant_id;
  END IF;
  
  -- Si tiene vencimiento, validar que sea fecha futura
  IF NEW.expiration_date IS NOT NULL AND NEW.expiration_date < CURRENT_DATE THEN
    RAISE WARNING 'Lote % ingresado con fecha de vencimiento pasada: %', NEW.batch_number, NEW.expiration_date;
  END IF;
  
  -- Actualizar timestamp
  NEW.updated_at := NOW();
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_before_batch_insert_or_update
BEFORE INSERT OR UPDATE ON inventory_batches
FOR EACH ROW
EXECUTE FUNCTION trg_validate_batch_expiration();

-- =========================
-- 4) TRIGGER: ACTUALIZAR TIMESTAMP
-- =========================

CREATE OR REPLACE FUNCTION trg_update_batch_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_before_batch_update_timestamp
BEFORE UPDATE ON inventory_batches
FOR EACH ROW
EXECUTE FUNCTION trg_update_batch_timestamp();

-- =========================
-- 5) BACKUP DE STOCK_BALANCES ORIGINAL
-- =========================

-- Crear tabla de backup antes de convertir a vista
CREATE TABLE IF NOT EXISTS stock_balances_backup AS 
SELECT * FROM stock_balances;

COMMENT ON TABLE stock_balances_backup IS 
  'Backup de stock_balances original antes de migración a sistema de lotes. Fecha: 2026-02-15';

-- =========================
-- 6) MIGRACIÓN: CONVERTIR STOCK_BALANCES A VISTA MATERIALIZADA
-- =========================

-- Primero, eliminar la tabla stock_balances (si existe)
-- ADVERTENCIA: Esto debe hacerse en ventana de mantenimiento
DROP TABLE IF EXISTS stock_balances CASCADE;

-- Crear vista materializada que agrega los lotes
CREATE MATERIALIZED VIEW stock_balances AS
SELECT 
  tenant_id,
  location_id,
  variant_id,
  SUM(on_hand) AS on_hand,
  SUM(reserved) AS reserved,
  MAX(updated_at) AS updated_at
FROM inventory_batches
WHERE is_active = TRUE
GROUP BY tenant_id, location_id, variant_id;

-- Índice único para refresh concurrente
CREATE UNIQUE INDEX idx_stock_balances_pk 
ON stock_balances(tenant_id, location_id, variant_id);

-- Índice para lookups rápidos
CREATE INDEX idx_stock_balances_lookup 
ON stock_balances(tenant_id, location_id, variant_id);

COMMENT ON MATERIALIZED VIEW stock_balances IS 
  'Vista materializada que agrega inventory_batches. Se actualiza vía trigger o manual.';

-- =========================
-- 7) FUNCIÓN: REFRESH STOCK_BALANCES
-- =========================

CREATE OR REPLACE FUNCTION fn_refresh_stock_balances(
  p_concurrent BOOLEAN DEFAULT TRUE
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_concurrent THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY stock_balances;
  ELSE
    REFRESH MATERIALIZED VIEW stock_balances;
  END IF;
END;
$$;

COMMENT ON FUNCTION fn_refresh_stock_balances IS 
  'Actualiza la vista materializada stock_balances. Usar concurrent=true para no bloquear lecturas.';

-- =========================
-- 8) TRIGGER: AUTO-REFRESH STOCK_BALANCES
-- =========================

CREATE OR REPLACE FUNCTION trg_refresh_stock_after_batch_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Refresh selectivo: solo la combinación tenant/location/variant afectada
  -- Nota: Para alto volumen, considerar queue con refresh periódico
  PERFORM fn_refresh_stock_balances(TRUE);
  RETURN NULL;
END;
$$;

-- Trigger después de INSERT/UPDATE/DELETE en lotes
CREATE TRIGGER trg_after_batch_change_refresh_stock
AFTER INSERT OR UPDATE OR DELETE ON inventory_batches
FOR EACH STATEMENT
EXECUTE FUNCTION trg_refresh_stock_after_batch_change();

-- =========================
-- 9) VISTA: DISPONIBILIDAD CON DETALLES
-- =========================

CREATE OR REPLACE VIEW vw_stock_with_batches AS
SELECT 
  sb.tenant_id,
  sb.location_id,
  l.name AS location_name,
  sb.variant_id,
  pv.sku,
  pv.variant_name,
  p.product_id,
  p.name AS product_name,
  -- Stock agregado
  sb.on_hand,
  sb.reserved,
  (sb.on_hand - sb.reserved) AS available,
  -- Detalles de lotes
  (SELECT COUNT(*) 
   FROM inventory_batches ib 
   WHERE ib.tenant_id = sb.tenant_id 
     AND ib.location_id = sb.location_id 
     AND ib.variant_id = sb.variant_id 
     AND ib.is_active = TRUE
     AND (ib.on_hand - ib.reserved) > 0
  ) AS active_batches,
  (SELECT MIN(expiration_date) 
   FROM inventory_batches ib 
   WHERE ib.tenant_id = sb.tenant_id 
     AND ib.location_id = sb.location_id 
     AND ib.variant_id = sb.variant_id 
     AND ib.is_active = TRUE
     AND ib.expiration_date IS NOT NULL
     AND (ib.on_hand - ib.reserved) > 0
  ) AS earliest_expiration,
  -- Timestamp
  sb.updated_at
FROM stock_balances sb
JOIN locations l ON l.location_id = sb.location_id
JOIN product_variants pv ON pv.variant_id = sb.variant_id AND pv.tenant_id = sb.tenant_id
JOIN products p ON p.product_id = pv.product_id AND p.tenant_id = pv.tenant_id
WHERE p.is_active = TRUE AND pv.is_active = TRUE;

COMMENT ON VIEW vw_stock_with_batches IS 
  'Vista de stock con información agregada de lotes y vencimientos';

-- =========================
-- 10) FUNCIÓN: GENERAR NÚMERO DE LOTE AUTOMÁTICO
-- =========================

CREATE OR REPLACE FUNCTION fn_generate_batch_number(
  p_tenant UUID,
  p_variant UUID,
  p_prefix TEXT DEFAULT 'BATCH'
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_sku TEXT;
  v_date TEXT;
  v_seq INT;
  v_batch_number TEXT;
BEGIN
  -- Obtener SKU
  SELECT sku INTO v_sku
  FROM product_variants
  WHERE tenant_id = p_tenant AND variant_id = p_variant;
  
  -- Fecha en formato YYMMDD
  v_date := TO_CHAR(CURRENT_DATE, 'YYMMDD');
  
  -- Secuencia del día
  SELECT COALESCE(MAX(
    NULLIF(regexp_replace(batch_number, '\D', '', 'g'), '')::INT
  ), 0) + 1
  INTO v_seq
  FROM inventory_batches
  WHERE tenant_id = p_tenant
    AND variant_id = p_variant
    AND received_at::DATE = CURRENT_DATE;
  
  -- Formato: PREFIX-SKU-YYMMDD-###
  v_batch_number := format('%s-%s-%s-%s', p_prefix, v_sku, v_date, LPAD(v_seq::TEXT, 3, '0'));
  
  RETURN v_batch_number;
END;
$$;

COMMENT ON FUNCTION fn_generate_batch_number IS 
  'Genera número de lote automático con formato PREFIX-SKU-YYMMDD-###';

-- =========================
-- FIN FASE 2
-- =========================

-- Verificación post-migración
DO $$
BEGIN
  RAISE NOTICE '============================================';
  RAISE NOTICE 'FASE 2 COMPLETADA';
  RAISE NOTICE '============================================';
  RAISE NOTICE 'Tabla inventory_batches: CREADA';
  RAISE NOTICE 'Vista stock_balances: CONVERTIDA A MATERIALIZADA';
  RAISE NOTICE 'Backup original: stock_balances_backup';
  RAISE NOTICE '';
  RAISE NOTICE 'PRÓXIMOS PASOS:';
  RAISE NOTICE '1. Ejecutar migración de datos (PHASE2_MIGRATE)';
  RAISE NOTICE '2. Implementar lógica FEFO (PHASE3)';
  RAISE NOTICE '3. Actualizar SP de ventas (PHASE4)';
  RAISE NOTICE '============================================';
END;
$$;
