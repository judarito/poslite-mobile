# 📊 ARQUITECTURA DEL SISTEMA DE MANUFACTURA

## 🏗️ VISIÓN GENERAL

```
┌──────────────────────────────────────────────────────────────────┐
│                    SISTEMA POS MULTI-TENANT                       │
│                   + SISTEMA DE MANUFACTURA                        │
└──────────────────────────────────────────────────────────────────┘
                              │
                              │
        ┌─────────────────────┴─────────────────────┐
        │                                           │
        ▼                                           ▼
┌───────────────┐                          ┌───────────────┐
│   PRODUCTS    │                          │ INVENTORY     │
│  + behaviors  │                          │  + batches    │
└───────┬───────┘                          └───────┬───────┘
        │                                          │
        │                                          │
    ┌───┴────┐                                ┌────┴─────┐
    │ RESELL │                                │   FEFO   │
    │SERVICE │                                │  System  │
    │ON_DEM  │                                └────┬─────┘
    │TO_STOCK│                                     │
    │ BUNDLE │                                     │
    └───┬────┘                                     │
        │                                          │
        └──────────┬───────────────────────────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │   sp_create_sale()   │
        │   (Motor de Ventas)  │
        └──────────────────────┘
```

---

## 🔄 FLUJOS POR BEHAVIOR

### 1️⃣ RESELL (Reventa Simple)

```
Cliente compra → POS valida stock → FEFO asigna lotes → 
Descuenta inventario → Registra venta

TABLAS INVOLUCRADAS:
├── sales (header)
├── sale_lines (líneas)
├── sale_line_batches (lotes asignados)
├── inventory_batches (stock descontado)
├── inventory_moves (movimiento OUT)
└── stock_balances (vista materializada actualizada)
```

**Ejemplo**: Venta de Coca-Cola
- Producto: Coca-Cola 500ml
- Behavior: RESELL (comportamiento actual)
- Flujo: Stock → FEFO → Venta → Stock descontado

---

### 2️⃣ SERVICE (Servicios)

```
Cliente compra servicio → POS registra venta → 
NO valida stock → NO descuenta inventario

TABLAS INVOLUCRADAS:
├── sales (header)
└── sale_lines (solo línea de ingreso, sin movimientos de inventario)

⚠️ NO AFECTA:
├── ❌ inventory_batches
├── ❌ sale_line_batches
├── ❌ inventory_moves
└── ❌ stock_balances
```

**Ejemplo**: Consultoría o envío a domicilio
- Producto: Envío Express
- Behavior: SERVICE
- Flujo: Registrar venta → Solo ingreso contable

---

### 3️⃣ MANUFACTURED ON_DEMAND (Producción bajo pedido)

```
Cliente pide → POS valida BOM → Verifica componentes → 
FEFO asigna componentes → Consume componentes → 
Calcula costo real → Registra venta

TABLAS INVOLUCRADAS:
├── sales (header)
├── sale_lines (línea con production_cost, bom_snapshot)
├── sale_line_components (trazabilidad de qué componentes se usaron)
├── inventory_batches (componentes descontados)
├── inventory_moves (movimientos OUT de componentes)
└── stock_balances (componentes actualizados)

⚠️ PRODUCTO NO TIENE STOCK PROPIO:
└── ❌ El producto terminado NO se descuenta (no existe en inventario)

REFERENCIAS:
├── bill_of_materials (BOM activo)
└── bom_components (lista de componentes + cantidades)
```

**Ejemplo**: Pizza hecha al momento
- Producto: Pizza Margherita
- Behavior: MANUFACTURED + Production Type: ON_DEMAND
- BOM: Harina 100g + Queso 50g + Tomate 30g
- Flujo: 
  1. Cliente pide 1 pizza
  2. Sistema verifica BOM configurado
  3. Valida stock de Harina, Queso, Tomate
  4. FEFO asigna lotes de cada componente
  5. Descuenta: Harina -100g, Queso -50g, Tomate -30g
  6. Calcula costo: (100×$5) + (50×$10) + (30×$8) = $1,240
  7. Registra venta con production_cost=$1,240
  8. Pizza NO se descuenta de inventario (se hizo al momento)

---

### 4️⃣ MANUFACTURED TO_STOCK (Producción a inventario)

```
FASE A: PRODUCCIÓN
Admin crea orden → Sistema reserva componentes → 
Inicia producción → Consume componentes FEFO → 
Genera lote producto terminado → Stock producto incrementa

FASE B: VENTA (igual a RESELL)
Cliente compra → FEFO asigna lote producto terminado → 
Descuenta producto → Registra venta

TABLAS INVOLUCRADAS (PRODUCCIÓN):
├── production_orders (orden de producción)
├── production_order_lines (componentes consumidos)
├── production_outputs (lote generado)
├── component_allocations (reservas soft durante producción)
├── inventory_batches (componentes OUT, producto terminado IN)
└── inventory_moves (movimientos componentes + producto)

TABLAS INVOLUCRADAS (VENTA):
├── sales (header)
├── sale_lines (línea normal)
├── sale_line_batches (lote del producto terminado)
├── inventory_batches (producto terminado descontado)
└── inventory_moves (movimiento OUT producto)

⚠️ COMPONENTES SE CONSUMIERON EN PRODUCCIÓN:
└── ❌ En la venta solo se descuenta el producto terminado
```

**Ejemplo**: Pan fabricado y almacenado
- Producto: Pan Integral
- Behavior: MANUFACTURED + Production Type: TO_STOCK
- BOM: Harina 500g + Levadura 10g + Sal 5g

**Fase Producción**:
1. Admin crea orden: "Producir 50 panes"
2. Sistema valida componentes disponibles
3. Admin inicia producción → Reserva soft componentes
4. Admin completa producción con cantidad real: 48 panes (hubo merma 4%)
5. Sistema:
   - Descuenta: Harina -24kg, Levadura -0.5kg, Sal -0.25kg
   - Calcula costo unitario: $25,000 / 48 = $520.83 por pan
   - Crea lote: "PROD-001-48" con 48 panes @ $520.83 c/u
   - Incrementa stock_balances: Pan +48

**Fase Venta**:
1. Cliente compra 5 panes
2. FEFO asigna del lote "PROD-001-48"
3. Descuenta: Pan -5 (quedan 43 en lote)
4. Registra venta normal
5. Componentes NO se tocan (ya fueron consumidos en producción)

---

### 5️⃣ BUNDLE (Kits/Combos)

```
Cliente compra bundle → POS explota componentes → 
Valida stock de cada componente → FEFO asigna por componente → 
Descuenta cada componente → Registra trazabilidad

TABLAS INVOLUCRADAS:
├── sales (header)
├── sale_lines (línea del bundle)
├── sale_line_components (cada componente descontado)
├── inventory_batches (componentes descontados)
├── inventory_moves (movimientos OUT por componente)
└── stock_balances (componentes actualizados)

⚠️ BUNDLE NO TIENE STOCK PROPIO:
└── ❌ Solo los componentes se desconintan

REFERENCIAS:
└── bundle_compositions (lista de componentes del bundle)
```

**Ejemplo**: Combo Desayuno
- Producto: Combo Desayuno Ejecutivo
- Behavior: BUNDLE
- Composition: Pan 1 + Café 1 + Huevos 2

**Flujo**:
1. Cliente compra 3 combos
2. Sistema expande:
   - Pan: 3 unidades (1 por combo)
   - Café: 3 unidades (1 por combo)
   - Huevos: 6 unidades (2 por combo)
3. FEFO asigna lotes individuales:
   - Pan: Lote PAN-001 → 3 unidades
   - Café: Lote CAFE-002 → 3 unidades
   - Huevos: Lote HUEVO-005 → 6 unidades
4. Descuenta cada componente
5. Registra en sale_line_components trazabilidad
6. Combo NO se descuenta (no tiene stock propio)

---

## 🗄️ ESQUEMA DE TABLAS

### Tablas Core (Existentes)
```
products
├── product_id (PK)
├── name
├── inventory_behavior (NUEVO: RESELL/SERVICE/MANUFACTURED/BUNDLE)
├── production_type (NUEVO: ON_DEMAND/TO_STOCK)
├── is_component (NUEVO: boolean)
└── active_bom_id (NUEVO: FK → bill_of_materials)

product_variants
├── variant_id (PK)
├── product_id (FK)
├── sku
├── price
├── inventory_behavior (NUEVO: nullable, override)
├── production_type (NUEVO: nullable, override)
├── is_component (NUEVO: nullable, override)
└── active_bom_id (NUEVO: nullable, override)

sales
├── sale_id (PK)
├── sale_number
├── total
└── ...

sale_lines
├── sale_line_id (PK)
├── sale_id (FK)
├── variant_id (FK)
├── quantity
├── unit_price
├── unit_cost
├── bom_snapshot (NUEVO: JSONB)
├── production_cost (NUEVO: NUMERIC)
└── components_consumed (NUEVO: JSONB)

inventory_batches
├── batch_id (PK)
├── variant_id (FK)
├── batch_number
├── on_hand
├── unit_cost
├── expiration_date
└── ...
```

### Tablas Nuevas (Manufactura)

```
bill_of_materials
├── bom_id (PK)
├── tenant_id
├── product_id (FK)
├── variant_id (FK, nullable)
├── name
├── is_default
└── is_active

bom_components
├── component_id (PK)
├── bom_id (FK)
├── component_variant_id (FK)
├── quantity
├── unit
├── waste_percentage
├── is_optional
└── sort_order

production_orders
├── production_order_id (PK)
├── tenant_id
├── location_id (FK)
├── order_number
├── product_variant_id (FK)
├── quantity_planned
├── quantity_produced
├── status (DRAFT/SCHEDULED/IN_PROGRESS/COMPLETED/CANCELLED)
├── scheduled_date
├── started_at
├── completed_at
├── unit_cost
└── total_cost

production_order_lines
├── line_id (PK)
├── production_order_id (FK)
├── component_variant_id (FK)
├── quantity_planned
├── quantity_consumed
├── unit_cost
├── total_cost
├── batch_id (FK → inventory_batches)
└── consumed_at

production_outputs
├── output_id (PK)
├── production_order_id (FK)
├── product_variant_id (FK)
├── quantity
├── unit_cost
├── batch_id (FK → inventory_batches creado)
└── created_at

bundle_compositions
├── composition_id (PK)
├── tenant_id
├── product_id (FK)
├── variant_id (FK, nullable)
├── component_variant_id (FK)
├── quantity
└── sort_order

sale_line_components
├── slc_id (PK)
├── tenant_id
├── sale_line_id (FK)
├── component_variant_id (FK)
├── quantity
├── unit_cost
├── total_cost
├── batch_id (FK → inventory_batches)
└── created_at

component_allocations (soft reservations)
├── allocation_id (PK)
├── tenant_id
├── production_order_id (FK)
├── variant_id (FK)
├── batch_id (FK)
├── quantity_allocated
├── allocated_at
└── released_at (nullable hasta completar/cancelar producción)
```

---

## 🔀 DIAGRAMA DE FLUJO: sp_create_sale()

```
┌─────────────────────────────────────┐
│   sp_create_sale(líneas, pagos)    │
└──────────────┬──────────────────────┘
               │
               ▼
    ┌──────────────────────┐
    │ Validar parámetros   │
    │ Validar cash_session │
    └──────────┬───────────┘
               │
               ▼
    ┌──────────────────────┐
    │ Crear header (sales) │
    │ sale_number = seq    │
    └──────────┬───────────┘
               │
               ▼
    ╔══════════════════════════╗
    ║ FOR EACH line IN lines   ║
    ╚═══════════┬══════════════╝
                │
                ▼
     ┌─────────────────────────┐
     │ Detectar behavior:      │
     │ fn_get_effective_...()  │
     └─────────┬───────────────┘
               │
               ├── RESELL? ───────────┐
               │                      │
               ├── SERVICE? ──────────┤
               │                      │
               ├── ON_DEMAND? ────────┤
               │                      │
               ├── TO_STOCK? ─────────┤
               │                      │
               └── BUNDLE? ───────────┤
                                      │
                ┌─────────────────────┘
                │
    ┌───────────▼────────────┐
    │   SWITCH (behavior)    │
    └───────────┬────────────┘
                │
    ┌───────────┴─────────────────────────────────┐
    │                                             │
    ▼ RESELL/TO_STOCK                            ▼ SERVICE
┌─────────────────────┐                  ┌──────────────────┐
│ Validar stock       │                  │ Skip validación  │
│ FEFO asigna lotes   │                  │ Skip FEFO        │
│ Descuenta batches   │                  │ Solo registrar   │
│ Registra batches    │                  │ línea ingreso    │
│ Crea inventory_move │                  └──────────────────┘
└─────────────────────┘
                │
    ┌───────────┴──────────────────────────────────┐
    │                                             │
    ▼ ON_DEMAND                                   ▼ BUNDLE
┌─────────────────────┐                  ┌──────────────────┐
│ Validar BOM         │                  │ Explotar compos  │
│ Validar componentes │                  │ FOR componente:  │
│ fn_consume_bom...() │                  │   FEFO asigna    │
│   └─ FOR compon:    │                  │   Descuenta      │
│       FEFO asigna   │                  │   Registra SLC   │
│       Descuenta     │                  └──────────────────┘
│       Registra SLC  │
│ Calcular prod_cost  │
│ Guardar BOM snapshot│
└─────────────────────┘
                │
                ▼
    ╔══════════════════════════╗
    ║ END LOOP                 ║
    ╚═══════════┬══════════════╝
                │
                ▼
    ┌──────────────────────────┐
    │ Aplicar redondeo total   │
    │ fn_apply_rounding()      │
    └──────────┬───────────────┘
                │
                ▼
    ┌──────────────────────────┐
    │ Procesar pagos           │
    │ Validar monto = total    │
    └──────────┬───────────────┘
                │
                ▼
    ┌──────────────────────────┐
    │ Actualizar totales sales │
    │ REFRESH stock_balances   │
    └──────────┬───────────────┘
                │
                ▼
    ┌──────────────────────────┐
    │ RETURN sale_id           │
    └──────────────────────────┘
```

---

## 🎯 FUNCIONES CLAVE

### Herencia de Behaviors

```sql
fn_get_effective_inventory_behavior(tenant, variant)
  → Retorna: COALESCE(
      variant.inventory_behavior,
      product.inventory_behavior,
      'RESELL'  -- default
    )

fn_get_effective_production_type(tenant, variant)
  → Retorna: COALESCE(
      variant.production_type,
      product.production_type,
      NULL  -- opcional
    )

fn_get_effective_bom(tenant, variant)
  → Retorna: COALESCE(
      variant.active_bom_id,
      product.active_bom_id,
      NULL
    )
```

### Validación BOM

```sql
fn_validate_bom_availability(tenant, bom_id, quantity, location)
  → Retorna TABLE:
    ├── component_variant_id
    ├── required_quantity (con waste_percentage)
    ├── available_quantity (stock actual)
    └── is_sufficient (bool)

fn_calculate_bom_cost(tenant, bom_id, location)
  → Retorna NUMERIC:
    └── SUM(component.qty * lote_mas_antiguo.cost)
        considerando waste_percentage

fn_detect_bom_circular_reference(bom_id)
  → Retorna BOOLEAN:
    └── TRUE si hay loop circular en BOM tree
```

### Consumo de Componentes

```sql
fn_consume_bom_components(tenant, variant, qty, location, sale_line_id)
  → Para cada componente del BOM:
    1. Calcular requerido = component.qty * sale_qty * (1+waste%)
    2. fn_allocate_fefo_for_component() → asignar lotes FEFO
    3. FOR cada lote: UPDATE inventory_batches descuento
    4. INSERT sale_line_components trazabilidad
    5. INSERT inventory_moves
  → Retorna: JSONB con array de componentes consumidos

fn_allocate_fefo_for_component(tenant, variant, qty, location)
  → Similar a fn_allocate_stock_fefo pero para componentes
  → Retorna TABLE: batch_id, allocated, unit_cost
  → ORDER BY expiration_date ASC NULLS LAST
```

### Producción TO_STOCK

```sql
fn_create_production_order(tenant, location, variant, qty, date, user)
  → Validaciones:
    - Producto debe ser MANUFACTURED + TO_STOCK
    - Debe tener BOM configurado
  → Crea production_orders con status='DRAFT'
  → Crea production_order_lines (componentes planeados)
  → Retorna: production_order_id

fn_start_production(tenant, order_id)
  → Validaciones:
    - Status debe ser DRAFT o SCHEDULED
    - Componentes deben tener stock suficiente
  → UPDATE status → 'IN_PROGRESS'
  → INSERT component_allocations (soft reservations)
  → UPDATE started_at

fn_complete_production(tenant, order_id, qty_produced)
  → Validaciones:
    - Status debe ser IN_PROGRESS
    - qty_produced <= qty_planned
  → FOR cada componente:
    - Ajustar qty por producción real
    - FEFO consumir del inventario
    - UPDATE production_order_lines
  → DELETE component_allocations (liberar reservas)
  → Calcular unit_cost = SUM(componentes) / qty_produced
  → INSERT inventory_batches (producto terminado)
    - batch_number = 'PROD-{order_number}-{qty}'
    - on_hand = qty_produced
    - unit_cost = calculado
  → INSERT production_outputs
  → UPDATE production_orders:
    - quantity_produced
    - unit_cost
    - total_cost
    - completed_at
    - status = 'COMPLETED'
  → REFRESH stock_balances
  → Retorna: batch_id del producto terminado
```

### Bundles

```sql
fn_explode_bundle_components(tenant, variant, qty)
  → SELECT bundle_compositions WHERE product/variant
  → Retorna TABLE:
    ├── component_variant_id
    └── component_quantity = composition.qty * sale_qty
```

---

## 📊 VISTAS DE REPORTES

### Análisis de Costos
- `vw_bom_cost_analysis` - Comparar costo actual BOM vs histórico
- `vw_manufactured_product_margin` - Margen real ON_DEMAND (price - production_cost)
- `vw_product_cost_breakdown` - Desglose de costos por componente

### Análisis de Producción
- `vw_production_efficiency` - Yield % (qty_produced / qty_planned)
- `vw_production_order_status` - Dashboard órdenes agrupadas
- `vw_bom_tree_exploded` - BOM multinivel expandido recursivamente

### Análisis de Inventario
- `vw_bom_availability` - Stock disponible vs requerido por BOM
- `vw_component_usage_report` - Top componentes consumidos (últimos 30 días)
- `vw_component_expiration_risk` - Componentes próximos vencer con órdenes pendientes

### Análisis de Ventas
- `vw_sale_production_analysis` - Ventas ON_DEMAND con costos reales

---

## 🔐 SEGURIDAD Y PERMISOS

### RLS (Row Level Security)

Todas las tablas nuevas tienen:
```sql
ENABLE ROW LEVEL SECURITY

--- Policy para SELECT
CREATE POLICY "users_read_own_tenant"
ON {tabla}
FOR SELECT
USING (tenant_id = auth.uid_tenant());

-- Policy para INSERT/UPDATE/DELETE (admin)
CREATE POLICY "admins_full_access"
ON {tabla}
FOR ALL
USING (
  tenant_id = auth.uid_tenant() 
  AND has_permission('admin')
);
```

### Permisos Requeridos

| Acción | Rol Mínimo | Tablas |
|--------|-----------|--------|
| Ver productos | Cajero | products, product_variants |
| Vender RESELL/SERVICE | Cajero | sales, sale_lines |
| Vender ON_DEMAND | Cajero + BOM configurado | + sale_line_components |
| Configurar BOM | Admin | bill_of_materials, bom_components |
| Crear orden producción | Admin/Supervisor | production_orders |
| Completar producción | Admin/Supervisor | production_outputs |
| Ver reportes | Admin/Gerente | vw_* (vistas) |

---

## 📈 MÉTRICAS CLAVE

### KPIs de Manufactura

```sql
-- 1. Eficiencia de producción promedio
SELECT AVG(efficiency_percentage)
FROM vw_production_efficiency
WHERE completed_at >= NOW() - INTERVAL '30 days';

-- 2. Margen promedio productos ON_DEMAND
SELECT AVG(margin_percentage)
FROM vw_manufactured_product_margin
WHERE sale_date >= NOW() - INTERVAL '30 days';

-- 3. Top 10 componentes más consumidos
SELECT *
FROM vw_component_usage_report
WHERE period_start >= NOW() - INTERVAL '30 days'
ORDER BY total_quantity_used DESC
LIMIT 10;

-- 4. Componentes en riesgo de expiración
SELECT COUNT(*)
FROM vw_component_expiration_risk
WHERE days_to_expiry <= 7;

-- 5. Órdenes de producción pendientes
SELECT COUNT(*)
FROM production_orders
WHERE status IN ('DRAFT', 'SCHEDULED', 'IN_PROGRESS');
```

---

## 🔧 MANTENIMIENTO

### Auditorías Recomendadas

**Diario** (2am):
```sql
-- Detectar inconsistencias de stock
SELECT * FROM fn_audit_stock_consistency()
WHERE status = 'MISMATCH';
```

**Semanal** (Lunes 6am):
```sql
-- Detectar inconsistencias de costos ON_DEMAND
SELECT * FROM fn_audit_cost_consistency()
WHERE status = 'MISMATCH';
```

**Mensual** (Día 1):
```sql
-- Análisis de eficiencia de producción
SELECT * FROM vw_production_efficiency
WHERE completed_at >= date_trunc('month', NOW() - INTERVAL '1 month')
ORDER BY efficiency_percentage ASC
LIMIT 20;

-- Márgenes de productos manufacturados
SELECT * FROM vw_manufactured_product_margin
WHERE sale_date >= date_trunc('month', NOW() - INTERVAL '1 month')
ORDER BY margin_percentage ASC
LIMIT 20;
```

---

**Última actualización**: 2024  
**Versión**: 1.0
