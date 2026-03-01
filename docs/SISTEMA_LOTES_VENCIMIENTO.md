# SISTEMA DE LOTES CON FECHA DE VENCIMIENTO
## Guía de Implementación y Uso

**Versión:** 1.0  
**Fecha:** 2026-02-15  
**Sistema:** POS-Lite Multi-tenant

---

## ÍNDICE

1. [Resumen Ejecutivo](#resumen-ejecutivo)
2. [Arquitectura](#arquitectura)
3. [Guía de Instalación](#guía-de-instalación)
4. [Configuración](#configuración)
5. [Casos de Uso](#casos-de-uso)
6. [API / Funciones Disponibles](#api-funciones-disponibles)
7. [Integración UI](#integración-ui)
8. [Testing](#testing)
9. [Troubleshooting](#troubleshooting)
10. [Roadmap](#roadmap)

---

## RESUMEN EJECUTIVO

### ¿Qué incluye este sistema?

✅ **Gestión de lotes** por variante con trazabilidad completa  
✅ **Jerarquía producto→variante** para configuración de vencimiento  
✅ **FEFO automático** (First Expired, First Out) en ventas  
✅ **Alertas configurables** (30 días warning, 7 días crítico)  
✅ **Ubicación física** de productos para cajero  
✅ **Reportes y dashboards** de vencimientos  
✅ **Bloqueo de vencidos** configurable por tenant  
✅ **Trazabilidad completa** lote → venta → cliente  

### Beneficios

- **Reducción de pérdidas** por productos vencidos
- **Cumplimiento normativo** INVIMA y regulaciones
- **Optimización de rotación** de inventario
- **Información en tiempo real** para cajeros
- **Reportes ejecutivos** de riesgo de vencimiento

---

## ARQUITECTURA

### Modelo de Datos

```
products (requires_expiration: bool)
  └─ product_variants (requires_expiration: bool NULL = hereda)
       └─ inventory_batches (lotes con vencimiento)
            ├─ batch_number, expiration_date
            ├─ on_hand, reserved
            ├─ physical_location
            └─ unit_cost
            
stock_balances (vista materializada)
  └─ Agrega inventory_batches por tenant/location/variant

sales → sale_lines → sale_line_batches
  └─ Trazabilidad: qué lote se vendió en qué línea
```

### Flujo de Venta con FEFO

```
1. Usuario escanea producto
2. sp_create_sale() llama a fn_allocate_stock_fefo()
3. FEFO asigna lotes por fecha de vencimiento (ASC)
4. Se valida stock disponible vs vencido
5. Se consume stock de cada lote (fn_consume_batch_stock)
6. Se registra en sale_line_batches
7. Se generan alertas si producto por vencer
8. Se actualiza stock_balances (materializada)
9. Venta completa
```

---

## GUÍA DE INSTALACIÓN

### Pre-requisitos

- PostgreSQL 12+
- pgcrypto extension
- Sistema POS-Lite con migraciones base ejecutadas

### Orden de Ejecución

**⚠️ IMPORTANTE: Ejecutar en ventana de mantenimiento (downtime ~1-2 horas)**

```sql
-- 1. Configuración y jerarquía
\i ADD_EXPIRATION_BATCHES_PHASE1.sql

-- 2. Crear tabla de lotes y convertir stock_balances
\i ADD_EXPIRATION_BATCHES_PHASE2.sql

-- 3. Migrar datos existentes
\i ADD_EXPIRATION_BATCHES_PHASE2_MIGRATE.sql

-- 4. Lógica FEFO
\i ADD_EXPIRATION_BATCHES_PHASE3_FEFO.sql

-- 5. Actualizar SP de ventas
\i ADD_EXPIRATION_BATCHES_PHASE4_SALES.sql

-- 6. Vistas y reportes
\i ADD_EXPIRATION_BATCHES_PHASE5_REPORTS.sql
```

### Verificación Post-Instalación

```sql
-- Verificar migración de datos
SELECT 
  'stock_balances_backup' AS table_name,
  SUM(on_hand) AS total_stock
FROM stock_balances_backup
UNION ALL
SELECT 
  'inventory_batches' AS table_name,
  SUM(on_hand) AS total_stock
FROM inventory_batches;

-- Verificar funciones creadas
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_name LIKE '%fefo%' OR routine_name LIKE '%batch%';

-- Verificar vistas
SELECT table_name 
FROM information_schema.views 
WHERE table_name LIKE '%expir%';
```

---

## CONFIGURACIÓN

### 1. Configurar productos que requieren vencimiento

```sql
-- Nivel PRODUCTO (todas las variantes heredan)
UPDATE products 
SET requires_expiration = TRUE 
WHERE product_id = 'UUID-DEL-PRODUCTO';

-- Ejemplo: todos los productos de categoría "Alimentos"
UPDATE products 
SET requires_expiration = TRUE 
WHERE category_id IN (
  SELECT category_id 
  FROM categories 
  WHERE name IN ('Alimentos', 'Medicamentos', 'Lácteos')
);
```

### 2. Override por variante

```sql
-- Variante específica (override del producto)
UPDATE product_variants 
SET requires_expiration = TRUE  -- o FALSE para desactivar
WHERE variant_id = 'UUID-DE-VARIANTE';

-- Ejemplo: activar solo para edición especial
UPDATE product_variants 
SET requires_expiration = TRUE
WHERE product_id = 'UUID-CAMISETA'
  AND variant_name LIKE '%Edición Limitada%';
```

### 3. Configuración por tenant

```sql
UPDATE tenant_settings 
SET expiration_config = jsonb_set(
  expiration_config,
  '{warn_days_before_expiration}',
  '45'::jsonb  -- 45 días para warning (default: 30)
)
WHERE tenant_id = 'UUID-TENANT';

-- Configuración completa
UPDATE tenant_settings 
SET expiration_config = '{
  "warn_days_before_expiration": 30,
  "critical_days_before_expiration": 7,
  "block_sale_when_expired": true,
  "allow_sell_near_expiry": true,
  "alert_on_purchase": true,
  "auto_fefo": true
}'::JSONB
WHERE tenant_id = 'UUID-TENANT';
```

### 4. Verificar configuración efectiva

```sql
-- Ver configuración jerárquica de productos
SELECT * FROM vw_products_expiration_config
WHERE tenant_id = 'UUID-TENANT'
ORDER BY product_name, variant_name;
```

---

## CASOS DE USO

### Caso 1: Recibir mercancía con vencimiento

```sql
-- Insertar lote de Yogurt que vence 2026-04-15
INSERT INTO inventory_batches (
  tenant_id,
  location_id,
  variant_id,
  batch_number,      -- Del proveedor o autogenerado
  expiration_date,
  on_hand,
  unit_cost,
  physical_location,
  received_at,
  created_by
) VALUES (
  'tenant-uuid',
  'location-uuid',
  'variant-yogurt-200g-uuid',
  'LOTE-ALPINA-240215-001',
  '2026-04-15',
  50,
  1500.00,
  'NEVERA-2',
  NOW(),
  'user-uuid'
);

-- O usar función para generar batch_number automático
INSERT INTO inventory_batches (
  tenant_id, location_id, variant_id,
  batch_number,
  expiration_date, on_hand, unit_cost, physical_location
) VALUES (
  'tenant-uuid', 'location-uuid', 'variant-uuid',
  fn_generate_batch_number('tenant-uuid', 'variant-uuid', 'LOTE'),
  '2026-04-15', 50, 1500.00, 'NEVERA-2'
);
```

### Caso 2: Venta con FEFO automático

```sql
-- La venta automáticamente asigna lotes por FEFO
SELECT sp_create_sale(
  'tenant-uuid',
  'location-uuid',
  'cash-session-uuid',
  'customer-uuid',
  'seller-uuid',
  '[
    {"variant_id": "variant-yogurt-uuid", "qty": 10, "unit_price": 2500, "discount": 0}
  ]'::JSONB,
  '[
    {"payment_method_code": "CASH", "amount": 25000}
  ]'::JSONB,
  'Venta regular'
);

-- El sistema:
-- 1. Busca lotes del yogurt en orden de vencimiento
-- 2. Asigna los 10 primeros del lote más próximo a vencer
-- 3. Registra asignación en sale_line_batches
-- 4. Genera alerta si el lote está por vencer
-- 5. Actualiza stock
```

### Caso 3: Consultar productos por vencer

```sql
-- Dashboard de alertas por sede
SELECT * FROM vw_expiration_dashboard
WHERE tenant_id = 'tenant-uuid';

-- Productos críticos (vencen en 7 días o menos)
SELECT 
  sku, 
  product_name, 
  batch_number,
  expiration_date,
  days_to_expiry,
  available,
  physical_location
FROM vw_expiring_products
WHERE tenant_id = 'tenant-uuid'
  AND alert_level = 'CRITICAL'
ORDER BY days_to_expiry ASC;

-- Top 10 productos en riesgo por valor
SELECT * FROM fn_top_at_risk_products('tenant-uuid', NULL, 10);
```

### Caso 4: Reporte mensual de vencimientos

```sql
-- Productos que vencen en próximos 30 días
SELECT * FROM fn_expiration_report('tenant-uuid', NULL, 30);

-- Solo para una sede específica
SELECT * FROM fn_expiration_report('tenant-uuid', 'location-uuid', 30);
```

### Caso 5: Trazabilidad de lote

```sql
-- ¿Qué ventas usaron el lote X?
SELECT 
  sale_number,
  sold_at,
  customer_name,
  quantity
FROM vw_batch_traceability
WHERE tenant_id = 'tenant-uuid'
  AND batch_number = 'LOTE-ALPINA-240215-001'
ORDER BY sold_at DESC;

-- ¿Qué lotes se usaron en venta Y?
SELECT 
  batch_number,
  expiration_date,
  quantity,
  unit_cost
FROM sale_line_batches slb
JOIN inventory_batches ib USING (batch_id)
WHERE slb.sale_id = 'sale-uuid';
```

### Caso 6: Ajuste de inventario en lote

```sql
-- Ajustar cantidad de lote (ej: producto dañado)
UPDATE inventory_batches
SET on_hand = on_hand - 5,
    notes = 'Ajuste: 5 unidades dañadas',
    updated_at = NOW()
WHERE batch_id = 'batch-uuid';

-- O desactivar lote completo
UPDATE inventory_batches
SET is_active = FALSE,
    notes = 'Lote retirado por fecha vencida'
WHERE batch_id = 'batch-uuid';
```

---

## API / FUNCIONES DISPONIBLES

### Funciones de Lote

#### `fn_generate_batch_number(tenant, variant, prefix)`
Genera número de lote automático con formato PREFIX-SKU-YYMMDD-###

```sql
SELECT fn_generate_batch_number(
  'tenant-uuid', 
  'variant-uuid', 
  'BATCH'
);
-- Retorna: 'BATCH-SKU001-260215-001'
```

#### `fn_allocate_stock_fefo(tenant, location, variant, qty)`
Asigna lotes automáticamente usando FEFO

```sql
SELECT * FROM fn_allocate_stock_fefo(
  'tenant-uuid',
  'location-uuid',
  'variant-uuid',
  10  -- cantidad necesaria
);
-- Retorna:
-- total_allocated: 10
-- has_sufficient_stock: true
-- allocation_details: [{batch_id, qty, expiration_date, ...}]
-- warnings: [{type, severity, message, ...}]
```

#### `fn_reserve_batch_stock(tenant, batch_id, qty)`
Reserva stock en lote (Plan Separe)

```sql
SELECT fn_reserve_batch_stock(
  'tenant-uuid',
  'batch-uuid',
  5  -- cantidad a reservar
);
```

#### `fn_consume_batch_stock(tenant, batch_id, qty, from_reserved)`
Consume stock de lote (venta)

```sql
SELECT fn_consume_batch_stock(
  'tenant-uuid',
  'batch-uuid',
  5,       -- cantidad
  FALSE    -- FALSE = venta directa, TRUE = desde reservado
);
```

### Funciones de Reporte

#### `fn_expiration_report(tenant, location, days_ahead)`
Reporte de vencimientos próximos

```sql
SELECT * FROM fn_expiration_report(
  'tenant-uuid',
  NULL,  -- todas las sedes
  30     -- próximos 30 días
);
```

#### `fn_top_at_risk_products(tenant, location, limit)`
Top productos en riesgo por valor

```sql
SELECT * FROM fn_top_at_risk_products(
  'tenant-uuid',
  NULL,  -- todas las sedes
  10     -- top 10
);
```

### Vistas Disponibles

- `vw_expiring_products` - detalle de productos por vencer
- `vw_expiring_by_variant` - agregado por variante
- `vw_expiration_dashboard` - resumen por sede
- `vw_batch_rotation` - análisis de rotación
- `vw_stock_for_cashier` - info optimizada para cajero
- `vw_batch_traceability` - trazabilidad lote→venta
- `vw_products_expiration_config` - configuración efectiva

---

## INTEGRACIÓN UI

### UI Cajero - Consulta de Stock

```javascript
// GET /api/stock/variant/:variantId
{
  sku: "YOGURT-200G",
  product_name: "Yogurt Alpina Natural",
  available: 45,
  next_expiration: "2026-03-15",
  days_to_expire: 28,
  pickup_location: "NEVERA-2",
  expiry_alert: "WARNING", // OK | WARNING | CRITICAL | EXPIRED
  price: 2500
}

// SQL:
SELECT * FROM vw_stock_for_cashier
WHERE tenant_id = ? AND location_id = ? AND variant_id = ?;
```

### UI Cajero - Alertas en Venta

```javascript
// POST /api/sales (después de crear venta)
{
  sale_id: "uuid",
  total: 25000,
  warnings: [
    {
      type: "NEAR_EXPIRY",
      severity: "WARNING",
      message: "Producto lote LOTE-001 vence en 6 días",
      data: {
        variant_id: "uuid",
        batch_number: "LOTE-001",
        expiration_date: "2026-02-21",
        days_to_expiry: 6,
        quantity: 10
      }
    }
  ]
}

// SQL:
SELECT fn_get_sale_warnings(tenant_id, sale_id);
```

### UI Admin - Dashboard de Vencimientos

```javascript
// GET /api/reports/expiration-dashboard
{
  locations: [
    {
      location_name: "Sede Centro",
      expired_count: 2,
      critical_count: 5,
      warning_count: 15,
      expired_value: 45000,
      critical_value: 120000,
      warning_value: 350000,
      total_value_at_risk: 515000
    }
  ]
}

// SQL:
SELECT * FROM vw_expiration_dashboard
WHERE tenant_id = ?
ORDER BY total_value_at_risk DESC;
```

### UI Admin - Reporte de Rotación

```javascript
// GET /api/reports/batch-rotation?days=30
{
  batches: [
    {
      sku: "YOGURT-200G",
      batch_number: "LOTE-001",
      days_in_stock: 15,
      initial_quantity: 50,
      sold_quantity: 30,
      current_on_hand: 20,
      daily_rotation_rate: 2.0,
      estimated_days_to_deplete: 10,
      expiration_date: "2026-04-15"
    }
  ]
}

// SQL:
SELECT * FROM vw_batch_rotation
WHERE tenant_id = ?
  AND days_in_stock <= ?
ORDER BY daily_rotation_rate ASC;
```

---

## TESTING

### Tests Unitarios

```sql
-- Test 1: FEFO asigna lotes en orden correcto
BEGIN;
  -- Crear 3 lotes con diferentes vencimientos
  INSERT INTO inventory_batches (tenant_id, location_id, variant_id, batch_number, expiration_date, on_hand, unit_cost)
  VALUES 
    ('t1', 'l1', 'v1', 'BATCH-1', '2026-03-01', 10, 1000),
    ('t1', 'l1', 'v1', 'BATCH-2', '2026-02-20', 10, 1000),
    ('t1', 'l1', 'v1', 'BATCH-3', '2026-03-15', 10, 1000);
  
  -- Solicitar 15 unidades
  SELECT * FROM fn_allocate_stock_fefo('t1', 'l1', 'v1', 15);
  
  -- Debe asignar: BATCH-2 (10) + BATCH-1 (5)
  -- Verificar
  SELECT 
    (allocation_details->0->>'batch_number' = 'BATCH-2') as first_is_earliest,
    (allocation_details->1->>'batch_number' = 'BATCH-1') as second_is_next
  FROM fn_allocate_stock_fefo('t1', 'l1', 'v1', 15);
ROLLBACK;

-- Test 2: Bloqueo de vencidos
BEGIN;
  UPDATE tenant_settings 
  SET expiration_config = jsonb_set(expiration_config, '{block_sale_when_expired}', 'true'::jsonb)
  WHERE tenant_id = 't1';
  
  INSERT INTO inventory_batches (tenant_id, location_id, variant_id, batch_number, expiration_date, on_hand, unit_cost)
  VALUES ('t1', 'l1', 'v1', 'EXPIRED', '2026-01-01', 10, 1000);
  
  -- Debe fallar o no asignar vencidos
  SELECT has_sufficient_stock 
  FROM fn_allocate_stock_fefo('t1', 'l1', 'v1', 10);
  -- Esperado: false
ROLLBACK;
```

### Tests de Integración

```sql
-- Test: Venta completa con FEFO
BEGIN;
  -- Setup
  INSERT INTO inventory_batches (...);
  
  -- Ejecutar venta
  SELECT sp_create_sale(...);
  
  -- Verificar:
  -- 1. Stock descontado
  SELECT on_hand FROM inventory_batches WHERE batch_id = 'batch-1';
  
  -- 2. Trazabilidad registrada
  SELECT COUNT(*) FROM sale_line_batches WHERE sale_id = ?;
  
  -- 3. stock_balances actualizado
  SELECT on_hand FROM stock_balances WHERE variant_id = ?;
ROLLBACK;
```

---

## TROUBLESHOOTING

### Problema: Stock_balances desactualizado

```sql
-- Solución: Refresh manual
REFRESH MATERIALIZED VIEW CONCURRENTLY stock_balances;

-- O usar función helper
SELECT fn_refresh_stock_balances(TRUE);
```

### Problema: Error "expiration_date required"

```sql
-- Causa: Variante configurada con requires_expiration=true
-- Solución 1: Proporcionar fecha de vencimiento
INSERT INTO inventory_batches (..., expiration_date = '2026-12-31', ...);

-- Solución 2: Desactivar requerimiento
UPDATE product_variants 
SET requires_expiration = FALSE 
WHERE variant_id = 'variant-uuid';
```

### Problema: "Stock insuficiente" pero hay stock

```sql
-- Verificar stock disponible vs reservado
SELECT 
  on_hand, 
  reserved, 
  (on_hand - reserved) as available 
FROM stock_balances 
WHERE variant_id = 'variant-uuid';

-- Verificar lotes bloqueados por vencimiento
SELECT * FROM vw_expiring_products
WHERE variant_id = 'variant-uuid'
  AND alert_level = 'EXPIRED';

-- Verificar configuración block_sale_when_expired
SELECT expiration_config->>'block_sale_when_expired'
FROM tenant_settings WHERE tenant_id = 'tenant-uuid';
```

### Problema: Rendimiento lento en ventas

```sql
-- Verificar índices
SELECT schemaname, tablename, indexname 
FROM pg_indexes 
WHERE tablename = 'inventory_batches';

-- Analizar query FEFO
EXPLAIN ANALYZE
SELECT * FROM fn_allocate_stock_fefo('t1', 'l1', 'v1', 10);

-- Optimizar: vacuum y analyze
VACUUM ANALYZE inventory_batches;
VACUUM ANALYZE stock_balances;
```

---

## ROADMAP

### Fase 6 (Opcional - Futuro)
- [ ] Integración con proveedores (importar lotes automáticamente)
- [ ] Alertas por email/SMS de vencimientos
- [ ] Sugerencias de descuentos para productos por vencer
- [ ] Reporte de mermas y pérdidas por vencimiento
- [ ] Dashboard predictivo con ML
- [ ] Mobile app para gestión de lotes en bodega
- [ ] Integración con etiquetadoras (QR con lote)

---

## SOPORTE

**Documentación técnica:** Ver archivos SQL de cada fase  
**Preguntas frecuentes:** Consultar sección Troubleshooting  
**Issues:** Contactar equipo de desarrollo

---

**Fin de la documentación**
