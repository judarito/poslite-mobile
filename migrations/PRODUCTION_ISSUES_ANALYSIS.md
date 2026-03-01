# ANÁLISIS COMPLETO: Problemas de Producción y Costos

## 📋 PROBLEMAS IDENTIFICADOS

### 1. **Duplicación de Inventario** ⚠️ CRÍTICO
**Síntoma:** 
- Se produce 1 unidad pero aparecen 2 en inventario

**Causa Raíz:**
- `fn_complete_production()` crea manualmente:
  - ✅ inventory_batch (1 unidad)
  - ✅ inventory_move (1 unidad)
  - ✅ production_output

- **TRIGGER** `trg_generate_production_inventory` (en production_outputs) crea:
  - ✅ OTRO inventory_batch (1 unidad) ← DUPLICACIÓN
  - ✅ OTRO inventory_move (1 unidad) ← DUPLICACIÓN

**Resultado:** 2 lotes, 2 movimientos, 2 unidades en stock

**Impacto:**
- Stock incorrecto (doble del real)
- Reportes de inventario con datos erróneos
- Valorización de inventario incorrecta

---

### 2. **Error de Columnas en inventory_moves** ⚠️ CRÍTICO
**Síntoma:**
```
Error: column "reference_type" of relation "inventory_moves" does not exist
```

**Causa:**
- `fn_consume_bom_components()` usaba columnas antiguas:
  - ❌ `reference_type` (no existe)
  - ❌ `reference_id` (no existe)

- Tabla `inventory_moves` usa:
  - ✅ `source` TEXT
  - ✅ `source_id` UUID

**Impacto:**
- Imposible completar órdenes de producción
- Error bloqueante en proceso de manufactura

---

### 3. **Violación de Constraint CHECK** ⚠️ CRÍTICO
**Síntoma:**
```
Error: new row violates check constraint "inventory_moves_quantity_check"
```

**Causa:**
- `fn_consume_bom_components()` insertaba cantidad negativa: `-v_adjusted_qty`
- Tabla `inventory_moves` tiene: `CHECK (quantity > 0)`
- El tipo de movimiento (entrada/salida) se define por `move_type`, no por el signo

**Impacto:**
- Error al consumir componentes
- Bloqueo de producción

---

### 4. **Costos Muy Altos** ⚠️ DATOS INCORRECTOS
**Observado:**
- Costo BOM: $12,800 (usuario reporta "muy alto")
- Costo previo BOM: $28,450 (análisis anterior)

**Componentes sospechosos (análisis previo):**
- **Mano de obra pantalon** (SKU: MAN-260218-4473)
  - Costo actual: $23,500 ← ⚠️ INCORRECTO
  - Costo esperado: ~$2,350 (probablemente error de captura sin punto decimal)

**Componentes actuales (necesita verificación):**
- Tela Drill: $3,000 (1.5m × $2,000)
- Hilo Verde: $1,200 (2un × $600)
- Botones: $100 (1un × $100)
- Cierre: $650 (1un × $650)
- Mano obra: $? (verificar si corregido)
- **Total esperado:** ~$7,300 (si Mano obra $2,350)

**Acción requerida:**
- Revisar costo de cada componente del BOM
- Corregir Mano de obra si sigue en $23,500

---

## ✅ SOLUCIONES IMPLEMENTADAS

### 1. Corregir `fn_consume_bom_components()`
**Cambios:**
```sql
-- ❌ ANTES (INCORRECTO):
INSERT INTO inventory_moves (
  ..., reference_type, reference_id, ...
) VALUES (
  ..., p_source_type, p_source_id
);

-- ✅ AHORA (CORRECTO):
INSERT INTO inventory_moves (
  ..., source, source_id, ...
) VALUES (
  ..., p_source_type, p_source_id
);
```

**Cantidad:**
```sql
-- ❌ ANTES: -v_adjusted_qty (negativo, viola CHECK)
-- ✅ AHORA: v_adjusted_qty (positivo)
```

---

### 2. Corregir `fn_complete_production()`
**Cambios:**
```sql
-- ❌ ANTES (DUPLICACIÓN):
-- 1. Crear inventory_batch manualmente
-- 2. Crear inventory_move manualmente
-- 3. Insertar production_output
-- 4. Trigger crea OTRO inventory_batch + inventory_move

-- ✅ AHORA (SIN DUPLICACIÓN):
-- 1. Calcular v_unit_cost
-- 2. Insertar production_output (con expiration_date, physical_location)
-- 3. Trigger crea inventory_batch + inventory_move automáticamente (SOLO UNA VEZ)
-- 4. Actualizar product_variants.cost/price
-- 5. Actualizar production_orders
```

**Eliminado:**
- `v_batch_number` variable
- INSERT INTO inventory_batches manual
- INSERT INTO inventory_moves manual

**Mantenido:**
- Consumo de componentes (fn_consume_bom_components)
- Cálculo de costo unitario
- Actualización de cost/price en product_variants
- Actualización de production_orders

---

### 3. Limpieza de Datos Duplicados
**Script incluye:**
- Identificar lotes duplicados de PO-2026-00010
- Eliminar lote SIN production_output asociado (el creado manualmente)
- Eliminar movimiento PRODUCTION_IN más antiguo
- Recalcular stock_balances desde inventory_batches

---

## 📝 PRÓXIMOS PASOS

### 1. **Ejecutar script de corrección** (INMEDIATO)
```powershell
psql -U postgres -d pos_lite -f "e:\Dev\POSLite\App\migrations\FIX_PRODUCTION_COMPLETE.sql"
```

**Resultado esperado:**
- ✅ fn_consume_bom_components v1.1 actualizada
- ✅ fn_complete_production v3.0 actualizada
- ✅ Datos duplicados de PO-2026-00010 eliminados
- ✅ Stock corregido (2 → 1 unidad)

---

### 2. **Verificar y corregir costos componentes BOM** (IMPORTANTE)
```sql
-- Ver componentes actuales del BOM Pantalón Verde
SELECT 
  p.name as componente,
  pv.sku,
  bc.quantity_required as cantidad,
  pv.cost as costo_unitario,
  (bc.quantity_required * pv.cost) as costo_total
FROM bill_of_materials bom
JOIN bom_components bc ON bc.bom_id = bom.bom_id
JOIN product_variants pv ON pv.variant_id = bc.component_variant_id
JOIN products p ON p.product_id = pv.product_id
WHERE bom.is_active = TRUE
  AND bom.variant_id IN (
    SELECT variant_id FROM product_variants WHERE sku LIKE '%PANT%VERDE%'
  );
```

**Acción:**
- Si Mano de obra = $23,500 → Corregir a $2,350 (o valor correcto)
- Verificar que todos los componentes tengan costo razonable
- Costo total esperado: ~$7,300 por pantalón

---

### 3. **Probar nueva producción** (VALIDACIÓN)
```
1. Crear nueva orden de producción (1 pantalón)
2. Iniciar orden
3. Completar orden
```

**Verificar:**
- ✅ Solo 1 lote creado
- ✅ Solo 1 inventory_move PRODUCTION_IN
- ✅ Stock aumenta en 1 (no en 2)
- ✅ actual_cost calculado correctamente (~$7,300)
- ✅ product_variants.cost actualizado
- ✅ product_variants.price calculado con markup

---

### 4. **Ejecutar diagnóstico final** (OPCIONAL)
```powershell
psql -U postgres -d pos_lite -f "e:\Dev\POSLite\App\migrations\INVESTIGATE_DOUBLE_INVENTORY.sql"
```

---

## 🔍 LECCIONES APRENDIDAS

### Arquitectura Correcta:
```
fn_complete_production()
  ├─ fn_consume_bom_components() → Consume insumos (ANTES)
  ├─ Calcular v_unit_cost
  ├─ INSERT production_outputs
  │    └─ [TRIGGER] fn_generate_production_inventory()
  │        ├─ INSERT inventory_batches (SOLO UNA VEZ)
  │        ├─ INSERT inventory_moves (SOLO UNA VEZ)
  │        └─ UPDATE NEW.batch_id
  ├─ fn_calculate_price() → Calcular precio venta
  ├─ UPDATE product_variants (cost/price)
  └─ UPDATE production_orders (status='COMPLETED', actual_cost)
```

### Principios:
1. **No duplicar lógica:** Si hay trigger, no crear manualmente
2. **Columnas correctas:** Verificar schema actual antes escribir queries
3. **Constraints CHECK:** Respetar siempre (quantity > 0)
4. **Validar datos:** Costos de $23,500 son sospechosos, revisar antes producir

---

## 📊 RESUMEN DE ARCHIVOS

| Archivo | Propósito | Estado |
|---------|-----------|--------|
| `FIX_PRODUCTION_COMPLETE.sql` | Script consolidado correcciones | ✅ Listo ejecutar |
| `FIX_MANUFACTURED_COST_PRICE_AUTO_UPDATE.sql` | fn_complete_production v3.0 | ✅ Corregido |
| `MANUFACTURING_PHASE3_ON_DEMAND.sql` | fn_consume_bom_components | ✅ Corregido |
| `FIX_PRODUCTION_INVENTORY.sql` | Trigger fn_generate_production_inventory | ✅ Ya aplicado |
| `INVESTIGATE_DOUBLE_INVENTORY.sql` | Script diagnóstico | ✅ Disponible |

---

## ⚠️ IMPORTANTE

**ANTES de producir nuevamente:**
1. ✅ Ejecutar FIX_PRODUCTION_COMPLETE.sql
2. ✅ Verificar costos componentes BOM
3. ✅ Corregir Mano de obra si necesario
4. ✅ Probar en orden de prueba primero

**NO producir sin ejecutar correcciones:** Se seguirá duplicando inventario.
