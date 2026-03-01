-- ===================================================================
-- Migración: Columna sort_order en payment_methods
-- Permite al administrador controlar el orden de aparición
-- en el POS y demás dropdowns.
-- ===================================================================
DO $$ BEGIN RAISE NOTICE '✅ Agregando sort_order a payment_methods'; END $$;

ALTER TABLE payment_methods
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Inicializar sort_order según el orden alfabético actual para no romper nada
UPDATE payment_methods pm
SET sort_order = sub.rn
FROM (
  SELECT payment_method_id,
         ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY name) AS rn
  FROM payment_methods
) sub
WHERE pm.payment_method_id = sub.payment_method_id;

DO $$ BEGIN RAISE NOTICE '✅ sort_order agregado y valores iniciales asignados'; END $$;
