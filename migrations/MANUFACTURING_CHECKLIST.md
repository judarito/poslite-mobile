# ✅ CHECKLIST DE EJECUCIÓN - SISTEMA DE MANUFACTURA

## 📋 RESUMEN

Se han creado **8 archivos** en `\migrations\`:

### Scripts SQL (7 archivos - Ejecutar en orden)
1. `MANUFACTURING_PHASE1_BASE_TABLES.sql` ⬅️ Ejecutar primero
2. `MANUFACTURING_PHASE1_ALTER_TABLES.sql`
3. `MANUFACTURING_PHASE1_HELPER_FUNCTIONS.sql`
4. `MANUFACTURING_PHASE2_SERVICE_BOM.sql`
5. `MANUFACTURING_PHASE3_ON_DEMAND.sql`
6. `MANUFACTURING_PHASE456_FINAL.sql`
7. `MANUFACTURING_SP_CREATE_SALE_INTEGRATED.sql` ⬅️ Ejecutar último (CRÍTICO)

### Documentación
8. `MANUFACTURING_IMPLEMENTATION_GUIDE.md` ⬅️ Guía completa con tests

---

## 🚀 EJECUCIÓN PASO A PASO

### PASO 0: Backup (OBLIGATORIO)

```bash
# Tomar backup completo de la base de datos
pg_dump -U postgres -d tu_database > backup_pre_manufacturing_$(date +%Y%m%d_%H%M%S).sql
```

O desde Supabase Dashboard:
- Settings → Database → Backups → Create backup

---

### PASO 1: Tablas Base (2-3 min)

**Archivo**: `MANUFACTURING_PHASE1_BASE_TABLES.sql`

**Acción**:
1. Abrir Supabase SQL Editor
2. Copiar contenido del archivo
3. Ejecutar

**Verificar**:
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_name IN (
  'bill_of_materials',
  'bom_components', 
  'production_orders',
  'production_order_lines',
  'production_outputs',
  'bundle_compositions',
  'sale_line_components',
  'component_allocations'
);
-- Debe retornar 8 tablas
```

**✅ Marca aquí cuando completes**: [ ]

---

### PASO 2: Modificar Tablas Existentes (1 min)

**Archivo**: `MANUFACTURING_PHASE1_ALTER_TABLES.sql`

**Acción**: Ejecutar en Supabase SQL Editor

**Verificar**:
```sql
SELECT inventory_behavior, COUNT(*) 
FROM products 
GROUP BY inventory_behavior;
-- Todos los productos deben ser 'RESELL'

SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'sale_lines' 
  AND column_name IN ('bom_snapshot', 'production_cost', 'components_consumed');
-- Debe retornar 3 columnas
```

**✅ Marca aquí cuando completes**: [ ]

---

### PASO 3: Funciones Helper (30 seg)

**Archivo**: `MANUFACTURING_PHASE1_HELPER_FUNCTIONS.sql`

**Acción**: Ejecutar en Supabase SQL Editor

**Verificar**:
```sql
-- Reemplaza con tu tenant_id y variant_id reales
SELECT fn_get_effective_inventory_behavior(
  'YOUR-TENANT-ID'::UUID,
  'ANY-VARIANT-ID'::UUID
);
-- Debe retornar 'RESELL'
```

**✅ Marca aquí cuando completes**: [ ]

---

### PASO 4: SERVICE + BOM (1 min)

**Archivo**: `MANUFACTURING_PHASE2_SERVICE_BOM.sql`

**Acción**: Ejecutar en Supabase SQL Editor

**Verificar**:
```sql
SELECT proname 
FROM pg_proc 
WHERE proname IN (
  'fn_validate_bom_availability',
  'fn_calculate_bom_cost',
  'fn_detect_bom_circular_reference'
);
-- Debe retornar 3 funciones
```

**✅ Marca aquí cuando completes**: [ ]

---

### PASO 5: ON_DEMAND (1-2 min)

**Archivo**: `MANUFACTURING_PHASE3_ON_DEMAND.sql`

**Acción**: Ejecutar en Supabase SQL Editor

**Verificar**:
```sql
SELECT proname 
FROM pg_proc 
WHERE proname IN (
  'fn_consume_bom_components',
  'fn_allocate_fefo_for_component'
);
-- Debe retornar 2 funciones
```

**✅ Marca aquí cuando completes**: [ ]

---

### PASO 6: Bundles + TO_STOCK + Vistas (2-3 min)

**Archivo**: `MANUFACTURING_PHASE456_FINAL.sql`

**Acción**: Ejecutar en Supabase SQL Editor

**Verificar**:
```sql
-- Verificar vistas
SELECT viewname 
FROM pg_views 
WHERE viewname LIKE 'vw_%manufacture%' OR viewname LIKE 'vw_%bom%'
ORDER BY viewname;
-- Debe retornar 10+ vistas

-- Verificar funciones de producción
SELECT proname 
FROM pg_proc 
WHERE proname LIKE '%production%';
-- Debe incluir: fn_create_production_order, fn_start_production, fn_complete_production
```

**✅ Marca aquí cuando completes**: [ ]

---

### ⚠️ PASO 7: Integración sp_create_sale (CRÍTICO - 30 seg)

**Archivo**: `MANUFACTURING_SP_CREATE_SALE_INTEGRATED.sql`

**⚠️ IMPORTANTE**: Este paso modifica la función más crítica del sistema (todas las ventas pasan por aquí)

**Pre-verificación**:
```sql
-- Asegurar que el sistema esté estable
SELECT COUNT(*) FROM sales WHERE created_at >= NOW() - INTERVAL '5 minutes';
-- Si hay ventas recientes, espera a que no haya actividad
```

**Acción**: Ejecutar en Supabase SQL Editor

**Verificar inmediatamente**:
```sql
-- Verificar versión
SELECT obj_description(
  (SELECT oid FROM pg_proc WHERE proname = 'sp_create_sale'), 
  'pg_proc'
);
-- Debe contener "v5.0" y "MANUFACTURED"

-- Verificar que contiene nueva lógica
SELECT COUNT(*) 
FROM pg_proc 
WHERE proname = 'sp_create_sale' 
  AND prosrc LIKE '%v_behavior%';
-- Debe retornar 1
```

**✅ Marca aquí cuando completes**: [ ]

---

## 🧪 TESTING INMEDIATO (CRÍTICO)

### ⚡ Test Regresión: Venta Normal RESELL

**Objetivo**: Asegurar que ventas normales siguen funcionando

```sql
-- IMPORTANTE: Reemplaza todos los UUIDs con valores reales de tu sistema
SELECT sp_create_sale(
  p_tenant := 'TU-TENANT-ID'::UUID,
  p_location := 'TU-LOCATION-ID'::UUID,
  p_cash_session := NULL,
  p_customer := NULL,
  p_sold_by := 'TU-USER-ID'::UUID,
  p_lines := '[{
    "variant_id": "UN-VARIANT-ID-QUE-EXISTE",
    "qty": 1,
    "unit_price": 5000,
    "discount": 0
  }]'::JSONB,
  p_payments := '[{
    "payment_method_code": "CASH",
    "amount": 5000
  }]'::JSONB,
  p_note := 'Test regresión post-manufactura'
);
```

**Resultado esperado**:
- ✅ Retorna UUID de venta (sin errores)
- ✅ Stock descontado normalmente
- ✅ `sale_line_batches` tiene registros
- ✅ `stock_balances` actualizado

**Si falla**: 
1. Ver `MANUFACTURING_IMPLEMENTATION_GUIDE.md` → Sección "ROLLBACK SI FALLA"
2. Re-ejecutar `FIX_SALE_ROUNDING.sql` inmediatamente

**✅ Test pasó**: [ ]

---

### 🆕 Test Nuevo: Venta SERVICE

```sql
-- 1. Crear producto SERVICE de prueba
INSERT INTO products (
  tenant_id, name, inventory_behavior, is_active, created_by
)
VALUES (
  'TU-TENANT-ID'::UUID,
  'Servicio de Consultoría (TEST)',
  'SERVICE',
  TRUE,
  'TU-USER-ID'::UUID
)
RETURNING product_id;
-- Anotar product_id

-- 2. Crear variant
INSERT INTO product_variants (
  tenant_id, product_id, sku, name, price, is_active, created_by
)
VALUES (
  'TU-TENANT-ID'::UUID,
  'PRODUCT-ID-ANOTADO'::UUID,
  'SVC-TEST-001',
  'Consultoría por hora',
  50000,
  TRUE,
  'TU-USER-ID'::UUID
)
RETURNING variant_id;
-- Anotar variant_id

-- 3. Probar venta
SELECT sp_create_sale(
  p_tenant := 'TU-TENANT-ID'::UUID,
  p_location := 'TU-LOCATION-ID'::UUID,
  p_cash_session := NULL,
  p_customer := NULL,
  p_sold_by := 'TU-USER-ID'::UUID,
  p_lines := '[{
    "variant_id": "VARIANT-ID-ANOTADO",
    "qty": 2,
    "unit_price": 50000,
    "discount": 0
  }]'::JSONB,
  p_payments := '[{
    "payment_method_code": "CASH",
    "amount": 100000
  }]'::JSONB,
  p_note := 'Test SERVICE'
);
```

**Verificar**:
```sql
-- No debe haber movimientos de inventario
SELECT COUNT(*) 
FROM inventory_moves 
WHERE source_id = 'SALE-ID-RETORNADO' 
  AND variant_id = 'VARIANT-ID-SERVICE';
-- Debe ser 0

-- No debe haber batches asignados
SELECT COUNT(*) 
FROM sale_line_batches slb
JOIN sale_lines sl ON slb.sale_line_id = sl.sale_line_id
WHERE sl.sale_id = 'SALE-ID-RETORNADO';
-- Debe ser 0
```

**✅ Test pasó**: [ ]

---

## 📊 VALIDACIÓN FINAL

```sql
-- 1. Auditoría de stock (NO debe haber mismatches)
SELECT * FROM fn_audit_stock_consistency()
WHERE status = 'MISMATCH';
-- Debe estar vacío

-- 2. Verificar que todas las funciones existen
SELECT COUNT(*) FROM pg_proc WHERE proname LIKE 'fn_%manufacturing%';
-- Debe ser > 0

-- 3. Verificar que todas las tablas existen
SELECT COUNT(*) 
FROM information_schema.tables 
WHERE table_name IN (
  'bill_of_materials',
  'bom_components',
  'production_orders',
  'bundle_compositions'
);
-- Debe ser 4

-- 4. Verificar vistas
SELECT COUNT(*) 
FROM pg_views 
WHERE viewname LIKE 'vw_bom%' OR viewname LIKE 'vw_production%';
-- Debe ser >= 5
```

**✅ Todas las validaciones pasaron**: [ ]

---

## 📈 ESTADO FINAL

### ✅ Sistema Completo Incluye:

**Behaviors soportados**:
- ✅ RESELL (actual - sin cambios para usuarios)
- ✅ SERVICE (nuevo - servicios sin inventario)
- ✅ MANUFACTURED ON_DEMAND (nuevo - producción bajo pedido)
- ✅ MANUFACTURED TO_STOCK (nuevo - producción a inventario)
- ✅ BUNDLE (nuevo - kits/combos)

**Funcionalidad preservada**:
- ✅ FEFO (First Expired First Out)
- ✅ Redondeo configurable
- ✅ Discount type (AMOUNT/PERCENT)
- ✅ Price includes tax
- ✅ Trazabilidad completa de lotes
- ✅ RLS (Row Level Security)

**Nuevas capacidades**:
- ✅ Gestión de BOMs (Listas de Materiales)
- ✅ Órdenes de producción
- ✅ Trazabilidad de consumo de componentes
- ✅ Cálculo de costos reales de producción
- ✅ 10+ vistas de reportes
- ✅ Funciones de auditoría

---

## 📝 PRÓXIMOS PASOS

### Configuración Inicial

1. **Crear primer producto SERVICE** (Ej: Envío a domicilio, Consultoría)
2. **Crear primer producto ON_DEMAND** con BOM simple (Ej: Pizza con 3 componentes)
3. **Crear primer BUNDLE** (Ej: Combo desayuno)
4. **Probar flujo completo TO_STOCK** (Orden → Producción → Venta)

### Desarrollo Frontend

- [ ] Modificar `Products.vue` → Agregar selector `inventory_behavior`
- [ ] Crear `BOMEditor.vue` → Modal gestión de BOMs
- [ ] Crear `ProductionOrders.vue` → Módulo órdenes de producción
- [ ] Modificar `PointOfSale.vue` → Validaciones según behavior

### Monitoreo

- [ ] Configurar job diario: `fn_audit_stock_consistency()`
- [ ] Configurar job semanal: `fn_audit_cost_consistency()`
- [ ] Crear dashboards con vistas de reportes

---

## 🆘 EN CASO DE PROBLEMAS

### Contacto
- Revisar `MANUFACTURING_IMPLEMENTATION_GUIDE.md` (guía completa con troubleshooting)
- Logs en Supabase: Dashboard → Database → Logs

### Rollback Rápido

Si hay problemas con ventas después de Paso 7:

```sql
-- 1. Re-ejecutar versión anterior
\i FIX_SALE_ROUNDING.sql

-- 2. O revertir behaviors temporalmente
UPDATE products SET inventory_behavior = 'RESELL';
UPDATE product_variants SET inventory_behavior = NULL;
```

---

## ✅ CHECKLIST FINAL

Marca cuando hayas completado TODO:

- [ ] Paso 1: Tablas base ejecutadas
- [ ] Paso 2: ALTER tables ejecutado
- [ ] Paso 3: Helper functions ejecutadas
- [ ] Paso 4: SERVICE + BOM ejecutado
- [ ] Paso 5: ON_DEMAND ejecutado
- [ ] Paso 6: Bundles + TO_STOCK ejecutado
- [ ] Paso 7: sp_create_sale integrado ⚠️
- [ ] Test regresión RESELL pasó ✅
- [ ] Test SERVICE pasó ✅
- [ ] Auditoría stock sin mismatches
- [ ] Backup tomado antes de empezar
- [ ] Documentación leída y entendida

---

**Última actualización**: 2024  
**Versión**: 1.0  
**Archivos totales**: 8 (7 SQL + 1 guía completa)

**¡ÉXITO! Sistema de manufactura completamente implementado 🎉**
