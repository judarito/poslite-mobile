-- ============================================================
-- MIGRATE_CUSTOMERS_TO_THIRD_PARTIES.sql
-- Migra los registros del antiguo tabla `customers` a `third_parties`
-- preservando los UUIDs originales para que las FKs existentes
-- (sales.customer_id, layaway_contracts.customer_id) sigan siendo válidas.
--
-- EJECUTAR EN ORDEN:
-- 1. Asegurarse de que FIX_CUSTOMER_FK_TO_THIRD_PARTIES.sql ya fue ejecutado
--    (FK de sales y layaway_contracts ya apunta a third_parties)
-- 2. Ejecutar este script
-- ============================================================

-- ----------------------------------------------------------------
-- PASO 1: Copiar customers → third_parties preservando UUIDs
-- ----------------------------------------------------------------
INSERT INTO third_parties (
  third_party_id,
  tenant_id,
  type,
  document_type,
  document_number,
  dv,
  legal_name,
  trade_name,
  phone,
  email,
  fiscal_email,
  address,
  city,
  department,
  is_active,
  created_at
)
SELECT
  c.customer_id,                        -- Preservar UUID original
  c.tenant_id,
  'customer'::text,                     -- Tipo: cliente
  NULL,                                 -- document_type desconocido
  c.document,                           -- document_number
  NULL,                                 -- dv
  c.full_name,                          -- legal_name
  NULL,                                 -- trade_name
  c.phone,
  c.email,
  NULL,                                 -- fiscal_email
  CASE
    WHEN c.address IS NULL THEN NULL
    ELSE to_jsonb(c.address)            -- Convertir text → jsonb
  END,
  NULL,                                 -- city
  NULL,                                 -- department
  c.is_active,
  c.created_at
FROM customers c
WHERE NOT EXISTS (
  -- Evitar duplicados si ya fue migrado parcialmente
  SELECT 1 FROM third_parties tp
  WHERE tp.third_party_id = c.customer_id
)
  AND c.tenant_id IS NOT NULL;

-- ----------------------------------------------------------------
-- PASO 2: Verificar resultados
-- ----------------------------------------------------------------
SELECT
  'customers originales' AS tabla,
  COUNT(*) AS total
FROM customers
UNION ALL
SELECT
  'third_parties tipo customer',
  COUNT(*)
FROM third_parties
WHERE type = 'customer'
UNION ALL
SELECT
  'migrados en este script',
  COUNT(*)
FROM customers c
INNER JOIN third_parties tp ON tp.third_party_id = c.customer_id;

-- ----------------------------------------------------------------
-- PASO 3 (opcional): Actualizar las vistas que aún hacen JOIN a customers
-- para que apunten a third_parties.
-- (Ver SpVistasFN.sql para las definiciones originales)
-- ----------------------------------------------------------------

-- Vista de ventas: reemplazar JOIN customers → third_parties
CREATE OR REPLACE VIEW vw_sales_with_customer AS
SELECT
  s.*,
  tp.legal_name   AS customer_name,
  tp.document_number AS customer_document,
  tp.phone        AS customer_phone,
  tp.email        AS customer_email
FROM sales s
LEFT JOIN third_parties tp ON tp.third_party_id = s.customer_id;

-- ----------------------------------------------------------------
-- NOTAS IMPORTANTES
-- ----------------------------------------------------------------
-- • Este script es IDEMPOTENTE gracias a la cláusula WHERE NOT EXISTS.
--   Si se ejecuta más de una vez, no generará duplicados.
--
-- • La tabla `customers` NO se elimina en este script para preservar
--   la compatibilidad con cualquier otra parte del sistema que aún
--   la referencie (customer_credit_accounts, etc.).
--
-- • Si desea eliminar la tabla customers en un futuro, primero debe:
--   1. Migrar customer_credit_accounts a third_parties o crear tabla equivalente.
--   2. Actualizar todos los stored procedures y views que hagan referencia a customers.
--   3. Ejecutar: DROP TABLE customers CASCADE;
