-- ===================================================================
-- Migrar FK customer_id de la tabla vieja `customers`
-- a la nueva tabla `third_parties`.
--
-- Afecta:
--   sales.customer_id
--   layaway_contracts.customer_id
--
-- NOTA: Los UUIDs en third_parties se generaron al migrar desde
--       customers, por lo que los registros existentes en sales /
--       layaway_contracts que tenían un customer_id válido
--       seguirán funcionando si los datos ya fueron migrados.
--       Si NO hay datos previos que referencien la tabla vieja,
--       el script es seguro de ejecutar directamente.
-- ===================================================================

-- 1. sales.customer_id  →  third_parties
ALTER TABLE sales
  DROP CONSTRAINT IF EXISTS sales_customer_id_fkey;

ALTER TABLE sales
  ADD CONSTRAINT sales_customer_id_fkey
    FOREIGN KEY (customer_id)
    REFERENCES third_parties(third_party_id)
    ON DELETE SET NULL;

-- 2. layaway_contracts.customer_id  →  third_parties
ALTER TABLE layaway_contracts
  DROP CONSTRAINT IF EXISTS layaway_contracts_customer_id_fkey;

ALTER TABLE layaway_contracts
  ADD CONSTRAINT layaway_contracts_customer_id_fkey
    FOREIGN KEY (customer_id)
    REFERENCES third_parties(third_party_id)
    ON DELETE RESTRICT;

DO $$ BEGIN
  RAISE NOTICE '✅ FK customer_id migrada a third_parties en sales y layaway_contracts';
END $$;
