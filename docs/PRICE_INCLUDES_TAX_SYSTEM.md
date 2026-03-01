# Sistema de Impuestos: Precio con IVA Incluido vs IVA Adicional

## 🎯 El Problema

En Colombia (y muchos países), existen **dos formas** de manejar precios con impuestos:

### Caso A: Precio SIN IVA incluido (Adicional)
```
Precio marcado: $10.000
IVA 19%: + $1.900
Total a pagar: $11.900
```
**El cliente paga MÁS del precio marcado.**

### Caso B: Precio CON IVA incluido (Already included)
```
Precio marcado: $10.000 ← Ya incluye IVA
Desglose:
  - Base gravable: $8.403,36
  - IVA 19%: $1.596,64
Total a pagar: $10.000
```
**El cliente paga EXACTAMENTE el precio marcado.**

---

## 📊 Fórmulas Matemáticas

### Caso A: IVA Adicional (price_includes_tax = false)
```
Base = Precio
IVA = Base × Tasa
Total = Base + IVA
```

### Caso B: IVA Incluido (price_includes_tax = true)
```
Total = Precio
Base = Total ÷ (1 + Tasa)
IVA = Total - Base
```

---

## 🔄 Orden Correcto de Cálculo con Descuentos

### ⚠️ IMPORTANTE: El orden es CRÍTICO

```
1. Precio unitario × Cantidad = Subtotal bruto
2. Aplicar descuento de línea → Subtotal con desc. línea
3. Aplicar descuento global (distribuido) → Precio final después de descuentos
4. AQUÍ determinar si incluye o no IVA
5. Separar Base e IVA según el caso
6. Sumar líneas para obtener totales
```

### ❌ ERROR COMÚN
Muchos sistemas separan base/IVA PRIMERO y luego aplican descuentos. **Esto es incorrecto y genera diferencias.**

---

## 💡 Ejemplo Completo: Producto con IVA Incluido

### Datos Iniciales
- Producto: Camisa
- Precio marcado: $10.000 (IVA incluido)
- `price_includes_tax = true`
- Tasa IVA: 19%
- Cantidad: 1

### Paso 1: Subtotal bruto
```
10.000 × 1 = 10.000
```

### Paso 2: Aplicar descuento de línea (10%)
```
10.000 × 10% = 1.000
Subtotal = 10.000 - 1.000 = 9.000
```

### Paso 3: Aplicar descuento global ($500 distribuido a esta línea)
```
9.000 - 500 = 8.500
```

### Paso 4: Descomponer Base e IVA
```
Total = 8.500
Base = 8.500 ÷ 1.19 = 7.142,86
IVA = 8.500 - 7.142,86 = 1.357,14
```

### Resultado Final
```
Cliente paga: $8.500
De los cuales:
  - Base gravable: $7.142,86
  - IVA: $1.357,14
```

---

## 🏗 Estructura en Base de Datos

### Campo Agregado: `product_variants.price_includes_tax`

```sql
ALTER TABLE product_variants 
ADD COLUMN price_includes_tax BOOLEAN DEFAULT false;
```

**Valores:**
- `false` (default): Precio NO incluye IVA → se suma al final
- `true`: Precio YA incluye IVA → se descompone

### Función SQL: `fn_calculate_tax_breakdown`

```sql
fn_calculate_tax_breakdown(
  p_price_after_discount numeric,  -- Precio DESPUÉS de aplicar descuentos
  p_tax_rate numeric,               -- 0.19 para 19%
  p_price_includes_tax boolean      -- true/false
)
RETURNS jsonb
```

**Retorna:**
```json
{
  "base": 7142.86,
  "tax": 1357.14,
  "total": 8500,
  "price_includes_tax": true
}
```

---

## 📋 Flujo de Implementación

### 1. Backend (SQL)

**Stored Procedures que deben actualizarse:**
- `sp_create_sale`: Leer `price_includes_tax` de variant, calcular con `fn_calculate_tax_breakdown`
- `sp_create_layaway`: Mismo cambio

**Cambios necesarios:**

```sql
-- Obtener price_includes_tax del variant
SELECT price_includes_tax 
INTO v_price_includes_tax
FROM product_variants
WHERE variant_id = v_variant_id;

-- Calcular precio después de descuentos
v_price_after_discount := v_subtotal - v_discount_calculated;

-- Obtener tasa de impuesto (ya existe)
v_tax_rate := fn_get_tax_rate_for_variant(p_tenant, v_variant_id);

-- Descomponer base/tax/total según tipo
v_breakdown := fn_calculate_tax_breakdown(
  v_price_after_discount, 
  v_tax_rate, 
  v_price_includes_tax
);

v_base := (v_breakdown->>'base')::numeric;
v_tax := (v_breakdown->>'tax')::numeric;
v_total := (v_breakdown->>'total')::numeric;
```

### 2. Frontend (Vue.js)

**Cambios en `PointOfSale.vue`:**

```javascript
// Al buscar productos, traer también price_includes_tax
const variant = {
  ...productData,
  price_includes_tax: productData.price_includes_tax || false
}

// En recalculateTaxes, usar el campo
const recalculateTaxes = async (line) => {
  // ... calcular descuentos ...
  
  const priceAfterDiscount = subtotal - discountAmount
  
  // Obtener info del impuesto
  const taxInfo = await taxesService.getTaxInfoForVariant(...)
  
  if (line.price_includes_tax) {
    // Caso B: Descomponer
    line.line_total = priceAfterDiscount
    line.base_amount = Math.round(priceAfterDiscount / (1 + taxInfo.rate))
    line.tax_amount = line.line_total - line.base_amount
  } else {
    // Caso A: Adicionar
    line.base_amount = priceAfterDiscount
    line.tax_amount = Math.round(line.base_amount * taxInfo.rate)
    line.line_total = line.base_amount + line.tax_amount
  }
}
```

**Mostrar en UI:**
```vue
<!-- Desktop table -->
<td class="text-right">
  {{ formatMoney(line.unit_price) }}
  <v-chip v-if="line.price_includes_tax" size="x-small" color="info">IVA incl.</v-chip>
</td>
```

---

## ✅ Validación y Testing

### Test Case 1: IVA Adicional
```
Precio: $10.000
IVA: 19%
price_includes_tax: false

Resultado esperado:
  Base: $10.000
  IVA: $1.900
  Total: $11.900
```

### Test Case 2: IVA Incluido
```
Precio: $10.000
IVA: 19%
price_includes_tax: true

Resultado esperado:
  Base: $8.403,36
  IVA: $1.596,64
  Total: $10.000
```

### Test Case 3: IVA Incluido + Descuento
```
Precio: $10.000
Descuento línea: 10% = -$1.000
Precio después desc.: $9.000
IVA: 19%
price_includes_tax: true

Resultado esperado:
  Base: $7.563,03
  IVA: $1.436,97
  Total: $9.000
```

---

## 🚨 Casos Edge y Consideraciones

### 1. Productos sin impuesto
```
tax_rate = 0
price_includes_tax = cualquiera (da igual)

Resultado:
  Base = Precio
  IVA = 0
  Total = Precio
```

### 2. Múltiples impuestos
Si en el futuro soportas múltiples impuestos (IVA + Impuesto al consumo):
- Aplicarlos en cascada
- Documentar el orden claramente
- Validar con contador

### 3. Redondeos
**CRÍTICO:** Redondear en cada línea, no solo al final.

```javascript
// ✅ CORRECTO
line.base_amount = Math.round(calculation * 100) / 100
line.tax_amount = Math.round(calculation * 100) / 100

// ❌ INCORRECTO (solo al final)
totals.tax = Math.round(sum)
```

---

## 📝 Migración de Datos Existentes

```sql
-- Todos los productos existentes asumen IVA adicional (comportamiento actual)
UPDATE product_variants 
SET price_includes_tax = false 
WHERE price_includes_tax IS NULL;

-- Si tienes productos que sabías que ya incluían IVA, actualizar manualmente:
UPDATE product_variants 
SET price_includes_tax = true 
WHERE sku IN ('SKU001', 'SKU002', ...);
```

---

## 🎯 Impacto en Reportes

### Reporte de Ventas
Debe mostrar:
- Subtotal (suma de bases gravables)
- Impuestos (suma de IVA)
- Total

### Factura Electrónica (DIAN)
Debe enviar:
- Base gravable por línea
- IVA por línea
- Total

**El sistema ahora calcula esto correctamente independiente de si el precio incluye o no IVA.**

---

## 🔄 Rollback Plan

Si necesitas revertir:

```sql
-- Eliminar columna
ALTER TABLE product_variants DROP COLUMN IF EXISTS price_includes_tax;

-- Eliminar función
DROP FUNCTION IF EXISTS fn_calculate_tax_breakdown;

-- Volver a stored procedures anteriores
-- (guardar backup antes de migrar)
```

---

## 📚 Referencias

- NIC Colombia: Tratamiento de impuestos en precios
- DIAN: Facturación electrónica, desglose de IVA
- Estándar internacional: Gross vs Net pricing

---

## ✅ Checklist de Implementación

- [ ] Ejecutar migración `ADD_PRICE_INCLUDES_TAX.sql`
- [ ] Actualizar `sp_create_sale` para usar `fn_calculate_tax_breakdown`
- [ ] Actualizar `sp_create_layaway` para usar `fn_calculate_tax_breakdown`
- [ ] Modificar `products.service.js` para incluir `price_includes_tax`
- [ ] Actualizar `PointOfSale.vue` con lógica dual
- [ ] Actualizar `LayawayContracts.vue` con lógica dual
- [ ] Agregar UI para marcar productos como "IVA incluido" en formulario de productos
- [ ] Testing exhaustivo con ambos casos
- [ ] Capacitar usuarios sobre la diferencia
- [ ] Actualizar reportes para reflejar base gravable correcta

---

**Fecha de implementación**: 2026-02-14  
**Versión**: 1.0  
**Estado**: ⚠️ Pendiente de implementación completa
