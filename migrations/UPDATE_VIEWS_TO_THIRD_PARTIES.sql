-- ============================================================
-- UPDATE_VIEWS_TO_THIRD_PARTIES.sql
-- Actualiza todas las vistas y funciones que aún hacen JOIN
-- a la tabla antigua `customers` para que usen `third_parties`.
--
-- EJECUTAR DESPUÉS de MIGRATE_CUSTOMERS_TO_THIRD_PARTIES.sql
-- ============================================================

-- ----------------------------------------------------------------
-- 1) Vista: vw_sales_summary
--    Reemplaza: left join customers c → left join third_parties c
--    Mapeos:    c.full_name → c.legal_name
-- ----------------------------------------------------------------
CREATE OR REPLACE VIEW vw_sales_summary AS
SELECT
  s.tenant_id,
  s.location_id,
  l.name           AS location_name,
  s.sale_id,
  s.sale_number,
  s.status,
  s.sold_at,
  s.customer_id,
  c.legal_name     AS customer_name,
  s.sold_by,
  u.full_name      AS sold_by_name,
  s.subtotal,
  s.discount_total,
  s.tax_total,
  s.total
FROM sales s
JOIN locations l  ON l.location_id = s.location_id
JOIN users u      ON u.user_id     = s.sold_by
LEFT JOIN third_parties c ON c.third_party_id = s.customer_id;

-- ----------------------------------------------------------------
-- 2) Vista: vw_layaway_report
--    Reemplaza: join customers c → join third_parties c
-- ----------------------------------------------------------------
CREATE OR REPLACE VIEW vw_layaway_report AS
SELECT
  lc.tenant_id,
  lc.location_id,
  l.name             AS location_name,
  lc.layaway_id,
  lc.status,
  lc.created_at,
  lc.created_by,
  u.full_name        AS created_by_name,
  lc.customer_id,
  c.legal_name       AS customer_name,
  c.document_number  AS customer_document,
  c.phone            AS customer_phone,
  lc.due_date,
  lc.subtotal,
  lc.discount_total,
  lc.tax_total,
  lc.total,
  lc.initial_deposit,
  lc.paid_total,
  lc.balance,
  lc.sale_id,
  s.sale_number      AS converted_sale_number,
  CASE
    WHEN lc.balance = 0   AND lc.status = 'COMPLETED' THEN 'Completado'
    WHEN lc.balance > 0   AND lc.status = 'ACTIVE'    THEN 'Pendiente'
    WHEN lc.status = 'CANCELLED'                       THEN 'Cancelado'
    WHEN lc.status = 'EXPIRED'                         THEN 'Expirado'
    ELSE lc.status
  END AS status_label,
  CASE
    WHEN lc.total > 0 THEN ROUND((lc.paid_total / lc.total) * 100, 2)
    ELSE 0
  END AS payment_percentage,
  CASE
    WHEN lc.due_date IS NOT NULL AND lc.status = 'ACTIVE' THEN
      CASE
        WHEN lc.due_date  < CURRENT_DATE                        THEN 'Vencido'
        WHEN lc.due_date <= CURRENT_DATE + INTERVAL '7 days'   THEN 'Por vencer'
        ELSE 'Vigente'
      END
    ELSE NULL
  END AS due_status
FROM layaway_contracts lc
JOIN locations l   ON l.location_id  = lc.location_id
JOIN users u       ON u.user_id      = lc.created_by
JOIN third_parties c ON c.third_party_id = lc.customer_id
LEFT JOIN sales s  ON s.sale_id      = lc.sale_id;

-- ----------------------------------------------------------------
-- 3) Vista: vw_layaway_payments_report
--    Reemplaza: join customers c → join third_parties c
-- ----------------------------------------------------------------
CREATE OR REPLACE VIEW vw_layaway_payments_report AS
SELECT
  lp.tenant_id,
  lp.layaway_id,
  lc.status          AS contract_status,
  lp.layaway_payment_id,
  lp.paid_at,
  lp.paid_by,
  u.full_name        AS paid_by_name,
  lp.payment_method_id,
  pm.code            AS payment_method_code,
  pm.name            AS payment_method_name,
  lp.amount,
  lp.reference,
  lp.cash_session_id,
  cs.cash_register_id,
  cr.name            AS cash_register_name,
  lc.location_id,
  l.name             AS location_name,
  lc.customer_id,
  c.legal_name       AS customer_name,
  lc.total           AS contract_total,
  lc.balance         AS contract_balance
FROM layaway_payments lp
JOIN layaway_contracts lc ON lc.layaway_id = lp.layaway_id AND lc.tenant_id = lp.tenant_id
JOIN payment_methods pm   ON pm.payment_method_id = lp.payment_method_id
JOIN locations l          ON l.location_id = lc.location_id
JOIN third_parties c      ON c.third_party_id = lc.customer_id
LEFT JOIN users u         ON u.user_id = lp.paid_by
LEFT JOIN cash_sessions cs ON cs.cash_session_id = lp.cash_session_id
LEFT JOIN cash_registers cr ON cr.cash_register_id = cs.cash_register_id;

-- ----------------------------------------------------------------
-- 4) Vista: vw_layaway_inventory
--    Reemplaza: join customers c → join third_parties c
-- ----------------------------------------------------------------
CREATE OR REPLACE VIEW vw_layaway_inventory AS
SELECT
  li.tenant_id,
  lc.location_id,
  l.name             AS location_name,
  li.layaway_id,
  lc.status          AS contract_status,
  lc.customer_id,
  c.legal_name       AS customer_name,
  li.variant_id,
  pv.sku,
  p.product_id,
  p.name             AS product_name,
  pv.variant_name,
  li.quantity,
  li.unit_price,
  li.discount_amount,
  li.line_total,
  sb.on_hand,
  sb.reserved,
  (sb.on_hand - sb.reserved) AS available,
  lc.created_at      AS contract_created_at,
  lc.due_date
FROM layaway_items li
JOIN layaway_contracts lc ON lc.layaway_id = li.layaway_id AND lc.tenant_id = li.tenant_id
JOIN locations l          ON l.location_id   = lc.location_id
JOIN third_parties c      ON c.third_party_id = lc.customer_id
JOIN product_variants pv  ON pv.variant_id   = li.variant_id
JOIN products p           ON p.product_id    = pv.product_id
LEFT JOIN stock_balances sb ON sb.tenant_id  = li.tenant_id
  AND sb.location_id = lc.location_id
  AND sb.variant_id  = li.variant_id;

-- ----------------------------------------------------------------
-- 5) Vista: vw_income_consolidated
--    Dos partes: ventas y abonos plan separe, ambas con JOIN a customers
-- ----------------------------------------------------------------
CREATE OR REPLACE VIEW vw_income_consolidated AS
-- Ventas
SELECT
  s.tenant_id,
  s.location_id,
  l.name             AS location_name,
  'VENTA'            AS income_type,
  s.sale_id          AS source_id,
  s.sale_number::text AS source_number,
  s.sold_at          AS income_date,
  s.customer_id,
  c.legal_name       AS customer_name,
  sp.payment_method_id,
  pm.code            AS payment_method_code,
  pm.name            AS payment_method_name,
  sp.amount,
  sp.cash_session_id,
  s.sold_by          AS handled_by,
  u.full_name        AS handled_by_name
FROM sales s
JOIN sale_payments sp   ON sp.sale_id = s.sale_id AND sp.tenant_id = s.tenant_id
JOIN locations l        ON l.location_id = s.location_id
JOIN payment_methods pm ON pm.payment_method_id = sp.payment_method_id
JOIN users u            ON u.user_id = s.sold_by
LEFT JOIN third_parties c ON c.third_party_id = s.customer_id
WHERE s.status IN ('COMPLETED', 'PARTIAL_RETURN', 'RETURNED')

UNION ALL

-- Abonos Plan Separé
SELECT
  lc.tenant_id,
  lc.location_id,
  l.name             AS location_name,
  'ABONO_SEPARE'     AS income_type,
  lp.layaway_payment_id AS source_id,
  lc.layaway_id::text   AS source_number,
  lp.paid_at         AS income_date,
  lc.customer_id,
  c.legal_name       AS customer_name,
  lp.payment_method_id,
  pm.code            AS payment_method_code,
  pm.name            AS payment_method_name,
  lp.amount,
  lp.cash_session_id,
  lp.paid_by         AS handled_by,
  u.full_name        AS handled_by_name
FROM layaway_payments lp
JOIN layaway_contracts lc ON lc.layaway_id = lp.layaway_id AND lc.tenant_id = lp.tenant_id
JOIN locations l          ON l.location_id = lc.location_id
JOIN payment_methods pm   ON pm.payment_method_id = lp.payment_method_id
JOIN third_parties c      ON c.third_party_id = lc.customer_id
LEFT JOIN users u         ON u.user_id = lp.paid_by;

-- ----------------------------------------------------------------
-- 6) Función: fn_refresh_layaway_alerts
--    Reemplaza: join customers c → join third_parties c
--    Mapeos:    c.full_name → c.legal_name, c.document → c.document_number
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_refresh_layaway_alerts()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Eliminar alertas que ya no aplican
  DELETE FROM system_alerts
  WHERE alert_type = 'LAYAWAY'
    AND reference_id NOT IN (
      SELECT layaway_id
      FROM layaway_contracts
      WHERE status = 'ACTIVE'
        AND due_date IS NOT NULL
        AND due_date <= CURRENT_DATE + INTERVAL '7 days'
    );

  -- Insertar o actualizar alertas actuales
  INSERT INTO system_alerts (tenant_id, alert_type, alert_level, reference_id, data)
  SELECT
    lc.tenant_id,
    'LAYAWAY' AS alert_type,
    CASE
      WHEN lc.due_date  < CURRENT_DATE                       THEN 'EXPIRED'
      WHEN lc.due_date <= CURRENT_DATE + INTERVAL '7 days'  THEN 'DUE_SOON'
      ELSE 'UPCOMING'
    END AS alert_level,
    lc.layaway_id AS reference_id,
    jsonb_build_object(
      'layaway_id',        lc.layaway_id,
      'location_id',       lc.location_id,
      'location_name',     l.name,
      'customer_id',       lc.customer_id,
      'customer_name',     c.legal_name,
      'customer_document', c.document_number,
      'customer_phone',    c.phone,
      'due_date',          lc.due_date,
      'total',             lc.total,
      'paid_total',        lc.paid_total,
      'balance',           lc.balance,
      'days_until_due',    (lc.due_date - CURRENT_DATE),
      'alert_level', CASE
        WHEN lc.due_date  < CURRENT_DATE                       THEN 'EXPIRED'
        WHEN lc.due_date <= CURRENT_DATE + INTERVAL '7 days'  THEN 'DUE_SOON'
        ELSE 'UPCOMING'
      END
    ) AS data
  FROM layaway_contracts lc
  JOIN locations l     ON l.location_id     = lc.location_id
  JOIN third_parties c ON c.third_party_id  = lc.customer_id
  WHERE lc.status = 'ACTIVE'
    AND lc.due_date IS NOT NULL
    AND lc.due_date <= CURRENT_DATE + INTERVAL '7 days'
  ON CONFLICT (tenant_id, alert_type, reference_id)
  DO UPDATE SET
    alert_level = excluded.alert_level,
    data        = excluded.data,
    updated_at  = now();
END;
$$;

-- ----------------------------------------------------------------
-- 7) Vista: vw_layaway_summary  (definida en PlanSepare.sql)
--    Reemplaza: join customers c → join third_parties c
-- ----------------------------------------------------------------
CREATE OR REPLACE VIEW vw_layaway_summary AS
SELECT
  lc.tenant_id,
  lc.location_id,
  l.name             AS location_name,
  lc.layaway_id,
  lc.status,
  lc.created_at,
  lc.due_date,
  lc.customer_id,
  c.legal_name       AS customer_name,
  lc.subtotal,
  lc.discount_total,
  lc.tax_total,
  lc.total,
  lc.paid_total,
  lc.balance,
  lc.sale_id
FROM layaway_contracts lc
JOIN locations l     ON l.location_id    = lc.location_id
JOIN third_parties c ON c.third_party_id = lc.customer_id;

-- ----------------------------------------------------------------
-- 8) Vista: vw_batch_traceability  (definida en ADD_EXPIRATION_BATCHES_PHASE3_FEFO.sql)
--    Reemplaza: left join customers c → left join third_parties c
-- ----------------------------------------------------------------
-- Nota: recrear la vista completa requiere leer el SELECT completo.
-- Solo se redefine el JOIN final aquí; si existen dependencias,
-- ejecutar DROP VIEW vw_batch_traceability CASCADE primero.
CREATE OR REPLACE VIEW vw_batch_traceability AS
SELECT
  slb.tenant_id,
  slb.sale_id,
  s.sale_number,
  s.sold_at,
  s.customer_id,
  c.legal_name    AS customer_name,
  slb.batch_id,
  ib.batch_number,
  ib.expiration_date,
  pv.sku,
  p.name          AS product_name,
  pv.variant_name,
  slb.quantity,
  slb.unit_cost,
  (slb.quantity * slb.unit_cost) AS total_cost
FROM sale_line_batches slb
JOIN sales s             ON s.sale_id   = slb.sale_id AND s.tenant_id = slb.tenant_id
LEFT JOIN third_parties c ON c.third_party_id = s.customer_id
JOIN inventory_batches ib ON ib.batch_id = slb.batch_id
JOIN product_variants pv  ON pv.variant_id = ib.variant_id
JOIN products p           ON p.product_id  = pv.product_id
WHERE s.status NOT IN ('VOIDED', 'CANCELLED');

-- ----------------------------------------------------------------
-- VERIFICACIÓN
-- ----------------------------------------------------------------
-- Ejecutar estas consultas para confirmar que las vistas funcionan:
--
-- SELECT * FROM vw_sales_summary LIMIT 5;
-- SELECT * FROM vw_layaway_report LIMIT 5;
-- SELECT * FROM vw_layaway_payments_report LIMIT 5;
-- SELECT * FROM vw_layaway_inventory LIMIT 5;
-- SELECT * FROM vw_income_consolidated LIMIT 5;
-- SELECT fn_refresh_layaway_alerts();
