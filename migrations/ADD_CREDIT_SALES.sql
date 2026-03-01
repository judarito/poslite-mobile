-- ===================================================================
-- Migración: Sistema de Ventas a Crédito / Cartera
-- ===================================================================
DO $$ BEGIN RAISE NOTICE '✅ Iniciando migración de cartera / crédito'; END $$;

-- ─── 1. Función atómica para actualizar el saldo de crédito ─────────────
CREATE OR REPLACE FUNCTION fn_update_credit_balance(
  p_credit_account_id UUID,
  p_delta             NUMERIC   -- positivo = suma deuda, negativo = abono
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE customer_credit_accounts
  SET current_balance = current_balance + p_delta
  WHERE credit_account_id = p_credit_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cuenta de crédito no encontrada: %', p_credit_account_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_update_credit_balance(UUID, NUMERIC) TO authenticated;

-- ─── 2. Asegurar columna source en customer_credit_movements ────────────
-- (ya debería existir según InitDB, pero idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customer_credit_movements' AND column_name = 'source'
  ) THEN
    ALTER TABLE customer_credit_movements ADD COLUMN source TEXT NOT NULL DEFAULT 'MANUAL';
  END IF;
END;
$$;

-- ─── 3. Método de pago CREDITO (se agrega como sistema si no existe) ─────
-- Este método es global (sin tenant_id), igual que el método LAYAWAY,
-- pero cada tenant decide si lo activa en su configuración de métodos de pago.
-- NOTA: Si los métodos de pago son por tenant ajusta la lógica aquí.
-- -----------------------------------------------------------------------
-- Si la tabla payment_methods tiene tenant_id: el admin debe crearlo por tenant.
-- Si es global: lo insertamos aquí.
DO $$
DECLARE
  v_has_tenant BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_methods' AND column_name = 'tenant_id'
  ) INTO v_has_tenant;

  IF NOT v_has_tenant THEN
    INSERT INTO payment_methods (code, name, is_active)
    VALUES ('CREDITO', 'Crédito', true)
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;
    RAISE NOTICE '✓ Método de pago CREDITO creado (tabla global)';
  ELSE
    RAISE NOTICE 'ℹ️  payment_methods tiene tenant_id — el admin debe crear el método CREDITO por tenant desde la interfaz';
  END IF;
END;
$$;

-- ─── 4. Vista útil: cartera por cliente con días de antigüedad ──────────
CREATE OR REPLACE VIEW vw_credit_debtors AS
SELECT
  cca.credit_account_id,
  cca.tenant_id,
  cca.customer_id,
  cca.credit_limit,
  cca.current_balance,
  GREATEST(0, cca.credit_limit - cca.current_balance) AS available_credit,
  cca.is_active,
  -- Fecha de la primera deuda sin abonar (aproximación: primer movimiento SALE sin cubrir)
  (
    SELECT MIN(m.created_at)::date
    FROM customer_credit_movements m
    WHERE m.credit_account_id = cca.credit_account_id
      AND m.amount > 0
      AND m.source = 'SALE'
  ) AS oldest_debt_date,
  CURRENT_DATE - (
    SELECT MIN(m.created_at)::date
    FROM customer_credit_movements m
    WHERE m.credit_account_id = cca.credit_account_id
      AND m.amount > 0
      AND m.source = 'SALE'
  ) AS days_overdue
FROM customer_credit_accounts cca
WHERE cca.is_active = true;

GRANT SELECT ON vw_credit_debtors TO authenticated;

-- ─── 5. Menú "Cartera" ───────────────────────────────────────────────────
INSERT INTO menu_items (code, label, icon, route, parent_code, sort_order)
VALUES ('VENTAS.CARTERA', 'Cartera', 'mdi-account-credit-card', '/cartera', 'VENTAS', 26)
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label, icon = EXCLUDED.icon,
      route = EXCLUDED.route, parent_code = EXCLUDED.parent_code,
      sort_order = EXCLUDED.sort_order;

-- ─── 6. Permiso ──────────────────────────────────────────────────────────
INSERT INTO permissions (permission_id, code, description)
SELECT gen_random_uuid(), 'CREDIT.VIEW', 'Ver y gestionar cartera de crédito'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'CREDIT.VIEW');

INSERT INTO menu_permissions (menu_item_id, permission_id)
SELECT mi.menu_item_id, p.permission_id
FROM menu_items mi JOIN permissions p ON p.code = 'CREDIT.VIEW'
WHERE mi.code = 'VENTAS.CARTERA'
ON CONFLICT DO NOTHING;

-- ─── 7. Roles con acceso ──────────────────────────────────────────────────
INSERT INTO role_menu_templates (role_name, menu_item_id)
SELECT 'ADMINISTRADOR', menu_item_id FROM menu_items WHERE code = 'VENTAS.CARTERA'
ON CONFLICT DO NOTHING;

INSERT INTO role_menu_templates (role_name, menu_item_id)
SELECT 'GERENTE', menu_item_id FROM menu_items WHERE code = 'VENTAS.CARTERA'
ON CONFLICT DO NOTHING;

DO $$ BEGIN RAISE NOTICE '✅ Migración de cartera completada'; END $$;
