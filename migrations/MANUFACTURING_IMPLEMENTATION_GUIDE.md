# GUÍA DE IMPLEMENTACIÓN - SISTEMA DE MANUFACTURA

## 📋 RESUMEN EJECUTIVO

El sistema de manufactura completo está implementado en **7 scripts SQL** que deben ejecutarse en orden secuencial. Estos scripts transforman el POS en un sistema ERP con capacidad de:

- **RESELL**: Productos de reventa (comportamiento actual)
- **SERVICE**: Servicios sin inventario
- **MANUFACTURED ON_DEMAND**: Producción bajo pedido que consume componentes
- **MANUFACTURED TO_STOCK**: Producción a inventario
- **BUNDLE**: Kits/combos que agrupan múltiples productos

## 🗂️ ORDEN DE EJECUCIÓN DE SCRIPTS

### ✅ Prerequisitos (Ya ejecutados)
Según confirmación del usuario, estos scripts ya están aplicados:
- `FIX_STOCK_FUNCTIONS_FOR_BATCHES.sql`
- `ADD_EXPIRATION_ALERTS_REALTIME.sql`
- `FIX_SALE_ROUNDING.sql`

### 📦 Fase 1: Fundación (3 scripts)

#### 1.1. `MANUFACTURING_PHASE1_BASE_TABLES.sql`
**Duración estimada**: 2-3 minutos

**Crea**:
- `bill_of_materials` - Listas de materiales
- `bom_components` - Componentes de cada BOM
- `production_orders` - Órdenes de producción
- `production_order_lines` - Componentes consumidos en producción
- `production_outputs` - Lotes de productos terminados generados
- `bundle_compositions` - Composición de bundles/kits
- `sale_line_components` - Trazabilidad componentes en ventas
- `component_allocations` - Reservas soft de componentes para producción

**Verificar**:
```sql
SELECT COUNT(*) FROM bill_of_materials; -- Debe retornar 0
SELECT COUNT(*) FROM production_orders; -- Debe retornar 0
```

#### 1.2. `MANUFACTURING_PHASE1_ALTER_TABLES.sql`
**Duración estimada**: 1 minuto

**Modifica**:
- `products`: Agrega `inventory_behavior`, `production_type`, `is_component`, `active_bom_id`
- `product_variants`: Agrega mismos 4 campos (herencia opcional)
- `sale_lines`: Agrega `bom_snapshot`, `production_cost`, `components_consumed`

**Migra**: Todos los productos existentes a `inventory_behavior = 'RESELL'`

**Verificar**:
```sql
SELECT inventory_behavior, COUNT(*) 
FROM products 
GROUP BY inventory_behavior;
-- Debe mostrar todos como 'RESELL'

SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'sale_lines' 
  AND column_name IN ('bom_snapshot', 'production_cost', 'components_consumed');
-- Debe retornar 3 columnas
```

#### 1.3. `MANUFACTURING_PHASE1_HELPER_FUNCTIONS.sql`
**Duración estimada**: 30 segundos

**Crea**:
- `production_counters` - Tabla para secuencias de órdenes
- `fn_get_effective_inventory_behavior()` - Resuelve herencia
- `fn_get_effective_production_type()` - Resuelve herencia
- `fn_get_effective_bom()` - Resuelve herencia
- `fn_variant_is_component()` - Verifica si es componente
- `fn_next_production_number()` - Genera números de orden

**Verificar**:
```sql
SELECT fn_get_effective_inventory_behavior(
  'TU-TENANT-ID'::UUID, 
  'ALGUNA-VARIANT-ID'::UUID
);
-- Debe retornar 'RESELL' para productos existentes

SELECT proname 
FROM pg_proc 
WHERE proname LIKE 'fn_%effective%';
-- Debe retornar 3 funciones
```

### 🔧 Fase 2: SERVICE + BOM

#### 2. `MANUFACTURING_PHASE2_SERVICE_BOM.sql`
**Duración estimada**: 1 minuto

**Crea**:
- `fn_validate_bom_availability()` - Valida stock de componentes
- `fn_calculate_bom_cost()` - Calcula costo de BOM
- `fn_detect_bom_circular_reference()` - Previene loops
- `trg_validate_bom_circular` - Trigger de validación

**Verificar**:
```sql
-- Intentar crear referencia circular (debe fallar)
INSERT INTO bill_of_materials(
  tenant_id, product_id, name, is_default, is_active, created_by
) 
VALUES (
  'TU-TENANT-ID'::UUID,
  'TU-PRODUCT-ID'::UUID,
  'Test BOM',
  TRUE,
  TRUE,
  'TU-USER-ID'::UUID
);
-- Debería completarse sin errores si no hay circularidad
```

### ⚙️ Fase 3: ON_DEMAND

#### 3. `MANUFACTURING_PHASE3_ON_DEMAND.sql`
**Duración estimada**: 1-2 minutos

**Crea**:
- `fn_consume_bom_components()` - Consume componentes con FEFO en ventas
- `fn_allocate_fefo_for_component()` - FEFO específico para componentes

**Verificar**:
```sql
SELECT proname 
FROM pg_proc 
WHERE proname IN ('fn_consume_bom_components', 'fn_allocate_fefo_for_component');
-- Debe retornar 2 funciones
```

### 📦 Fase 4-6: Bundles + TO_STOCK + Refinamiento

#### 4. `MANUFACTURING_PHASE456_FINAL.sql`
**Duración estimada**: 2-3 minutos

**Crea**:
- `fn_explode_bundle_components()` - Expande componentes de bundle
- `fn_create_production_order()` - Crea orden de producción
- `fn_start_production()` - Inicia producción
- `fn_complete_production()` - Completa producción y genera lote
- 10 vistas de reportes (análisis, auditoría, costos)
- 2 funciones de auditoría (stock, costos)

**Verificar**:
```sql
SELECT viewname 
FROM pg_views 
WHERE viewname LIKE 'vw_%'
ORDER BY viewname;
-- Debe retornar al menos 10 vistas

SELECT proname 
FROM pg_proc 
WHERE proname LIKE '%production%';
-- Debe retornar 4+ funciones
```

### 🔄 Fase 7: Integración CRÍTICA

#### 5. `MANUFACTURING_SP_CREATE_SALE_INTEGRATED.sql`
**Duración estimada**: 30 segundos

**⚠️ CRÍTICO**: Este script reemplaza `sp_create_sale()`, la función más crítica del sistema.

**Modificaciones**:
- Detecta `inventory_behavior` de cada línea de venta
- Aplica lógica diferenciada según comportamiento:
  - **RESELL**: FEFO normal (actual)
  - **SERVICE**: Skip inventario
  - **ON_DEMAND**: Consume componentes
  - **TO_STOCK**: FEFO producto terminado
  - **BUNDLE**: Consume cada componente
- Preserva FEFO, redondeo, discount_type, price_includes_tax

**Verificar**:
```sql
SELECT 
  prosrc 
FROM pg_proc 
WHERE proname = 'sp_create_sale';
-- Debe contener 'v_behavior' y 'fn_get_effective_inventory_behavior'

-- El COMMENT debe indicar versión 5.0
SELECT 
  obj_description((SELECT oid FROM pg_proc WHERE proname = 'sp_create_sale'), 'pg_proc');
-- Debe contener "v5.0"
```

## 🧪 PLAN DE TESTING OBLIGATORIO

### Test 1: Ventas RESELL (Regresión crítica)
```sql
-- Crear venta normal de producto existente
SELECT sp_create_sale(
  p_tenant := 'YOUR-TENANT-ID'::UUID,
  p_location := 'YOUR-LOCATION-ID'::UUID,
  p_cash_session := NULL,
  p_customer := NULL,
  p_sold_by := 'YOUR-USER-ID'::UUID,
  p_lines := '[{
    "variant_id": "VARIANT-RESELL-ID",
    "qty": 2,
    "unit_price": 10000,
    "discount": 0
  }]'::JSONB,
  p_payments := '[{
    "payment_method_code": "CASH",
    "amount": 20000
  }]'::JSONB,
  p_note := 'Test RESELL - Regresión'
);

-- VERIFICAR:
-- ✓ Stock descontado en inventory_batches
-- ✓ Registro en sale_line_batches
-- ✓ Movimiento en inventory_moves
-- ✓ stock_balances actualizado
-- ✓ NO debe haber entradas en sale_line_components
```

### Test 2: Ventas SERVICE
```sql
-- 1. Crear producto SERVICE
UPDATE products 
SET inventory_behavior = 'SERVICE'
WHERE product_id = 'YOUR-TEST-PRODUCT-ID';

-- 2. Crear venta
SELECT sp_create_sale(
  p_tenant := 'YOUR-TENANT-ID'::UUID,
  p_location := 'YOUR-LOCATION-ID'::UUID,
  p_cash_session := NULL,
  p_customer := NULL,
  p_sold_by := 'YOUR-USER-ID'::UUID,
  p_lines := '[{
    "variant_id": "VARIANT-SERVICE-ID",
    "qty": 1,
    "unit_price": 50000,
    "discount": 0
  }]'::JSONB,
  p_payments := '[{
    "payment_method_code": "CASH",
    "amount": 50000
  }]'::JSONB,
  p_note := 'Test SERVICE'
);

-- VERIFICAR:
-- ✓ Venta creada correctamente
-- ✓ NO hay descuento de stock
-- ✓ NO hay entradas en sale_line_batches
-- ✓ NO hay movimientos de inventario para el producto SERVICE
-- ✓ stock_balances sin cambios
```

### Test 3: Ventas ON_DEMAND
```sql
-- 1. Crear producto MANUFACTURED ON_DEMAND
UPDATE products 
SET inventory_behavior = 'MANUFACTURED',
    production_type = 'ON_DEMAND'
WHERE product_id = 'PIZZA-PRODUCT-ID';

-- 2. Crear BOM
INSERT INTO bill_of_materials(
  tenant_id, product_id, name, is_default, is_active, created_by
)
VALUES (
  'YOUR-TENANT-ID'::UUID,
  'PIZZA-PRODUCT-ID'::UUID,
  'BOM Pizza Margherita',
  TRUE,
  TRUE,
  'YOUR-USER-ID'::UUID
)
RETURNING bom_id;

-- Anotar bom_id generado

-- 3. Agregar componentes al BOM
INSERT INTO bom_components(bom_id, component_variant_id, quantity, unit, waste_percentage)
VALUES
  ('BOM-ID-GENERADO'::UUID, 'HARINA-VARIANT-ID'::UUID, 100, 'g', 5),
  ('VARIANT-ID-GENERADO'::UUID, 'QUESO-VARIANT-ID'::UUID, 50, 'g', 3),
  ('BOM-ID-GENERADO'::UUID, 'TOMATE-VARIANT-ID'::UUID, 30, 'g', 0);

-- 4. Activar BOM en producto
UPDATE products
SET active_bom_id = 'BOM-ID-GENERADO'::UUID
WHERE product_id = 'PIZZA-PRODUCT-ID';

-- 5. Asegurar stock de componentes
INSERT INTO inventory_batches(
  tenant_id, location_id, variant_id, batch_number,
  received_at, on_hand, unit_cost, is_active
)
VALUES
  ('TENANT'::UUID, 'LOCATION'::UUID, 'HARINA-VARIANT'::UUID, 'HARINA-001', NOW(), 1000, 5, TRUE),
  ('TENANT'::UUID, 'LOCATION'::UUID, 'QUESO-VARIANT'::UUID, 'QUESO-001', NOW(), 500, 10, TRUE),
  ('TENANT'::UUID, 'LOCATION'::UUID, 'TOMATE-VARIANT'::UUID, 'TOMATE-001', NOW(), 300, 8, TRUE);

-- 6. Crear venta ON_DEMAND
SELECT sp_create_sale(
  p_tenant := 'YOUR-TENANT-ID'::UUID,
  p_location := 'YOUR-LOCATION-ID'::UUID,
  p_cash_session := NULL,
  p_customer := NULL,
  p_sold_by := 'YOUR-USER-ID'::UUID,
  p_lines := '[{
    "variant_id": "PIZZA-VARIANT-ID",
    "qty": 2,
    "unit_price": 25000,
    "discount": 0
  }]'::JSONB,
  p_payments := '[{
    "payment_method_code": "CASH",
    "amount": 50000
  }]'::JSONB,
  p_note := 'Test ON_DEMAND - 2 Pizzas'
);

-- VERIFICAR:
-- ✓ Venta creada
-- ✓ sale_lines.production_cost calculado
-- ✓ sale_lines.components_consumed contiene JSON con componentes
-- ✓ sale_line_components tiene 3 entries (Harina, Queso, Tomate)
-- ✓ inventory_batches componentes descontados FEFO
-- ✓ stock_balances componentes actualizado
-- ✓ Pizza NO tiene descuento de stock (producto ON_DEMAND no tiene stock propio)

SELECT 
  sl.sale_line_id,
  pv.name AS producto,
  sl.quantity,
  sl.production_cost,
  sl.components_consumed
FROM sale_lines sl
JOIN product_variants pv ON sl.variant_id = pv.variant_id
WHERE sl.sale_id = 'SALE-ID-GENERADO';

SELECT 
  slc.component_variant_id,
  pv.name AS componente,
  slc.quantity,
  slc.unit_cost,
  slc.total_cost,
  ib.batch_number
FROM sale_line_components slc
JOIN product_variants pv ON slc.component_variant_id = pv.variant_id
LEFT JOIN inventory_batches ib ON slc.batch_id = ib.batch_id
WHERE slc.sale_line_id = 'SALE-LINE-ID-GENERADO';
```

### Test 4: Ventas TO_STOCK
```sql
-- 1. Crear producto MANUFACTURED TO_STOCK
UPDATE products 
SET inventory_behavior = 'MANUFACTURED',
    production_type = 'TO_STOCK'
WHERE product_id = 'PAN-PRODUCT-ID';

-- 2. Crear BOM (similar a ON_DEMAND)
-- ... (mismo proceso que Test 3 pasos 2-4)

-- 3. Crear orden de producción
SELECT fn_create_production_order(
  p_tenant := 'YOUR-TENANT-ID'::UUID,
  p_location := 'YOUR-LOCATION-ID'::UUID,
  p_variant := 'PAN-VARIANT-ID'::UUID,
  p_quantity := 100,
  p_scheduled_date := CURRENT_DATE + 1,
  p_created_by := 'YOUR-USER-ID'::UUID
);
-- Anotar production_order_id

-- 4. Iniciar producción
SELECT fn_start_production(
  p_tenant := 'YOUR-TENANT-ID'::UUID,
  p_order_id := 'ORDER-ID-GENERADO'::UUID
);

-- 5. Completar producción
SELECT fn_complete_production(
  p_tenant := 'YOUR-TENANT-ID'::UUID,
  p_order_id := 'ORDER-ID-GENERADO'::UUID,
  p_quantity_produced := 95  -- Permitir merma (producción parcial)
);
-- Retorna batch_id del producto terminado

-- 6. Verificar lote creado
SELECT * FROM inventory_batches WHERE batch_id = 'BATCH-ID-RETORNADO';

-- 7. Crear venta TO_STOCK (debe comportarse como RESELL)
SELECT sp_create_sale(
  p_tenant := 'YOUR-TENANT-ID'::UUID,
  p_location := 'YOUR-LOCATION-ID'::UUID,
  p_cash_session := NULL,
  p_customer := NULL,
  p_sold_by := 'YOUR-USER-ID'::UUID,
  p_lines := '[{
    "variant_id": "PAN-VARIANT-ID",
    "qty": 10,
    "unit_price": 3000,
    "discount": 0
  }]'::JSONB,
  p_payments := '[{
    "payment_method_code": "CASH",
    "amount": 30000
  }]'::JSONB,
  p_note := 'Test TO_STOCK - Venta de producto terminado'
);

-- VERIFICAR:
-- ✓ Venta creada
-- ✓ Stock de Pan descontado (del lote creado en producción)
-- ✓ sale_line_batches referencia lote de producción
-- ✓ inventory_batches Pan descontado
-- ✓ Componentes (Harina, etc.) SIN cambios (ya consumidos en producción)
-- ✓ production_orders muestra orden completada
-- ✓ production_outputs tiene registro del lote generado
```

### Test 5: Ventas BUNDLE
```sql
-- 1. Crear producto BUNDLE
UPDATE products 
SET inventory_behavior = 'BUNDLE'
WHERE product_id = 'COMBO-DESAYUNO-ID';

-- 2. Configurar composición del bundle
INSERT INTO bundle_compositions(
  tenant_id, product_id, component_variant_id, quantity, sort_order
)
VALUES
  ('TENANT'::UUID, 'COMBO-DESAYUNO-ID'::UUID, 'PAN-VARIANT-ID'::UUID, 1, 1),
  ('TENANT'::UUID, 'COMBO-DESAYUNO-ID'::UUID, 'CAFE-VARIANT-ID'::UUID, 1, 2),
  ('TENANT'::UUID, 'COMBO-DESAYUNO-ID'::UUID, 'HUEVOS-VARIANT-ID'::UUID, 2, 3);

-- 3. Asegurar stock de componentes
-- ... (similar a Test 3)

-- 4. Crear venta BUNDLE
SELECT sp_create_sale(
  p_tenant := 'YOUR-TENANT-ID'::UUID,
  p_location := 'YOUR-LOCATION-ID'::UUID,
  p_cash_session := NULL,
  p_customer := NULL,
  p_sold_by := 'YOUR-USER-ID'::UUID,
  p_lines := '[{
    "variant_id": "COMBO-DESAYUNO-VARIANT-ID",
    "qty": 3,
    "unit_price": 15000,
    "discount": 0
  }]'::JSONB,
  p_payments := '[{
    "payment_method_code": "CASH",
    "amount": 45000
  }]'::JSONB,
  p_note := 'Test BUNDLE - 3 Combos'
);

-- VERIFICAR:
-- ✓ Venta creada
-- ✓ sale_line_components tiene 3 entries (Pan, Café, Huevos)
-- ✓ Componentes descontados con cantidades correctas:
--   • Pan: -3 (1 por combo × 3 combos)
--   • Café: -3 (1 por combo × 3 combos)
--   • Huevos: -6 (2 por combo × 3 combos)
-- ✓ Combo mismo NO tiene descuento de stock
-- ✓ FEFO aplicado a cada componente individual

SELECT 
  pv.name AS componente,
  slc.quantity,
  slc.unit_cost,
  slc.total_cost
FROM sale_line_components slc
JOIN product_variants pv ON slc.component_variant_id = pv.variant_id
WHERE slc.sale_line_id = 'SALE-LINE-ID-GENERADO';
```

## 🔍 VALIDACIONES POST-IMPLEMENTACIÓN

### Verificar integridad de datos

```sql
-- 1. Verificar herencia de behaviors
SELECT 
  p.name AS producto,
  p.inventory_behavior AS behavior_producto,
  pv.sku,
  pv.inventory_behavior AS behavior_variant,
  fn_get_effective_inventory_behavior(p.tenant_id, pv.variant_id) AS behavior_efectivo
FROM products p
JOIN product_variants pv ON p.product_id = pv.product_id
WHERE p.tenant_id = 'YOUR-TENANT-ID'
LIMIT 10;

-- 2. Verificar consistencia de stock (debe estar vacío)
SELECT * FROM fn_audit_stock_consistency()
WHERE status = 'MISMATCH';

-- 3. Verificar consistencia de costos ON_DEMAND (debe estar vacío)
SELECT * FROM fn_audit_cost_consistency()
WHERE status = 'MISMATCH';

-- 4. Contar types de productos
SELECT 
  COALESCE(inventory_behavior, 'NULL') AS behavior,
  COALESCE(production_type, 'N/A') AS prod_type,
  COUNT(*) AS cantidad
FROM products
WHERE tenant_id = 'YOUR-TENANT-ID'
GROUP BY inventory_behavior, production_type
ORDER BY behavior, prod_type;
```

### Monitorear logs

```sql
-- Ver últimas ventas con sus behaviors
SELECT 
  s.sale_id,
  s.sale_number,
  s.created_at,
  jsonb_agg(
    jsonb_build_object(
      'variant', pv.sku,
      'behavior', fn_get_effective_inventory_behavior(s.tenant_id, sl.variant_id),
      'qty', sl.quantity,
      'production_cost', sl.production_cost
    )
  ) AS lines
FROM sales s
JOIN sale_lines sl ON s.sale_id = sl.sale_id
JOIN product_variants pv ON sl.variant_id = pv.variant_id
WHERE s.tenant_id = 'YOUR-TENANT-ID'
  AND s.created_at >= NOW() - INTERVAL '1 day'
GROUP BY s.sale_id, s.sale_number, s.created_at
ORDER BY s.created_at DESC
LIMIT 10;
```

## 🚨 ROLLBACK SI FALLA

Si encuentras errores críticos después de ejecutar `MANUFACTURING_SP_CREATE_SALE_INTEGRATED.sql`:

### Opción 1: Restaurar versión anterior de sp_create_sale

```sql
-- RE-EJECUTAR el script previo que funcionaba:
\i FIX_SALE_ROUNDING.sql
```

### Opción 2: Desactivar behaviors temporalmente

```sql
-- Revertir todos los productos a RESELL
UPDATE products
SET inventory_behavior = 'RESELL',
    production_type = NULL,
    active_bom_id = NULL;

UPDATE product_variants
SET inventory_behavior = NULL,
    production_type = NULL,
    active_bom_id = NULL;
```

## 📊 REPORTES Y VISTAS DISPONIBLES

Después de la implementación completa, tienes acceso a:

### Vistas de Análisis
- `vw_bom_availability` - Disponibilidad de componentes por BOM
- `vw_component_usage_report` - Consumo de componentes (últimos 30 días)
- `vw_production_efficiency` - Eficiencia de órdenes de producción
- `vw_bom_cost_analysis` - Análisis de costos de BOMs
- `vw_manufactured_product_margin` - Márgenes de productos ON_DEMAND
- `vw_component_expiration_risk` - Componentes próximos a vencer
- `vw_production_order_status` - Dashboard de órdenes de producción
- `vw_bom_tree_exploded` - BOMs multinivel expandidos
- `vw_product_cost_breakdown` - Desglose de costos por componente
- `vw_sale_production_analysis` - Análisis de ventas con producción

### Funciones de Auditoría
- `fn_audit_stock_consistency()` - Detecta desbalances de inventario
- `fn_audit_cost_consistency()` - Detecta inconsistencias de costos

### Ejemplos de uso

```sql
-- Análisis de márgenes de productos ON_DEMAND
SELECT * FROM vw_manufactured_product_margin
WHERE margin_percentage < 20  -- Productos con margen bajo
ORDER BY total_sales DESC
LIMIT 10;

-- Componentes próximos a vencer con órdenes pendientes
SELECT * FROM vw_component_expiration_risk
WHERE days_to_expiry <= 7
ORDER BY days_to_expiry;

-- Eficiencia de producción
SELECT * FROM vw_production_efficiency
WHERE efficiency_percentage < 90  -- Órdenes con baja eficiencia
ORDER BY completed_at DESC;
```

## 🎯 PRÓXIMOS PASOS

### Frontend (Pendiente)

1. **Products.vue**: Agregar dropdown para `inventory_behavior`
2. **BOMEditor.vue** (nuevo): Modal para configurar BOMs
3. **ProductionOrders.vue** (nuevo): Gestión de órdenes de producción
4. **PointOfSale.vue**: Validaciones según behavior

### Capacitación de Usuarios

1. Documentar nuevos flujos de trabajo
2. Crear videos tutoriales para:
   - Configurar productos MANUFACTURED
   - Crear y editar BOMs
   - Gestionar órdenes de producción
   - Interpretar reportes de costos

### Monitoreo Continuo

1. Configurar alertas automáticas:
   - `fn_audit_stock_consistency()` diariamente
   - `fn_audit_cost_consistency()` semanalmente
   - Componentes próximos a vencer
2. Revisar reportes de eficiencia mensualmente

## 📝 CHECKLIST FINAL

Antes de considerar la implementación completa:

- [ ] Los 7 scripts ejecutados sin errores
- [ ] Test RESELL pasado (regresión crítica)
- [ ] Test SERVICE pasado
- [ ] Test ON_DEMAND pasado (con BOM real)
- [ ] Test TO_STOCK pasado (producción completa)
- [ ] Test BUNDLE pasado
- [ ] `fn_audit_stock_consistency()` sin mismatches
- [ ] `fn_audit_cost_consistency()` sin mismatches
- [ ] Vistas funcionando correctamente
- [ ] Backup de base de datos tomado
- [ ] Plan de rollback documentado
- [ ] Equipo capacitado en nuevos flujos

## 🆘 SOPORTE

### Problemas Comunes

**Error: "Variant not found/active"**
- Verificar que `pv.is_active = TRUE`
- Revisar que el variant_id exista en la base

**Error: "Componentes faltantes"**
- Verificar stock de componentes con `fn_validate_bom_availability()`
- Revisar que los lotes tengan `is_active = TRUE`

**Error: "Circular BOM reference"**
- Un componente del BOM tiene a su vez un BOM que referencia el producto original
- Revisar y corregir estructura de BOMs

**Desbalance de inventario**
- Ejecutar `SELECT * FROM fn_audit_stock_consistency()`
- Si hay mismatch, ejecutar `REFRESH MATERIALIZED VIEW stock_balances`

---

**Versión**: 1.0  
**Última actualización**: 2024  
**Autor**: Sistema POS Multi-Tenant
