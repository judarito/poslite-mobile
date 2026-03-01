# Sistema de Descuentos Flexibles

## 📋 Resumen

Mejora implementada que permite especificar descuentos por **valor fijo** o **porcentaje** en líneas de venta y plan separé, proporcionando mayor flexibilidad al momento de aplicar promociones y descuentos.

## 🎯 Problema Resuelto

**Antes:** Solo se podía especificar descuentos como valor absoluto
- Ejemplo: Descuento de $5,000

**Ahora:** Se puede elegir entre valor fijo o porcentaje
- Ejemplo 1: Descuento de $5,000 (AMOUNT)
- Ejemplo 2: Descuento del 10% (PERCENT)

## 🔧 Cambios Implementados

### 1. Base de Datos

#### ✅ Migración: `ADD_DISCOUNT_TYPE.sql`

**Tabla `sale_lines`:**
```sql
ALTER TABLE sale_lines 
ADD COLUMN discount_type TEXT DEFAULT 'AMOUNT' 
CHECK (discount_type IN ('AMOUNT', 'PERCENT'));
```

**Tabla `layaway_items`:**
```sql
ALTER TABLE layaway_items 
ADD COLUMN discount_type TEXT DEFAULT 'AMOUNT' 
CHECK (discount_type IN ('AMOUNT', 'PERCENT'));
```

**Función auxiliar:**
```sql
fn_calculate_discount(p_subtotal, p_discount_value, p_discount_type)
```

Esta función centraliza el cálculo del descuento según su tipo:
- **AMOUNT:** Retorna el valor directamente
- **PERCENT:** Calcula `subtotal * (porcentaje / 100)`
- Valida que porcentajes no excedan 100%
- Valida que valores no excedan el subtotal

### 2. Stored Procedures Actualizados

#### ✅ `sp_create_sale` (`UPDATE_SALE_SP_DISCOUNT_TYPE.sql`)

**Cambios:**
- Lee `discount_type` del JSON (default: 'AMOUNT' si no viene)
- Usa `fn_calculate_discount()` para calcular el descuento real
- Inserta tanto `discount_type` como `discount_amount` en `sale_lines`

**Formato JSON esperado:**
```json
{
  "variant_id": "uuid",
  "qty": 2,
  "unit_price": 50000,
  "discount": 10,
  "discount_type": "PERCENT"  // o "AMOUNT"
}
```

#### ✅ `sp_create_layaway` (`UPDATE_LAYAWAY_SP_DISCOUNT_TYPE.sql`)

**Cambios:**
- Lee `discount_type` del JSON (default: 'AMOUNT' si no viene)
- Usa `fn_calculate_discount()` para calcular el descuento real
- Inserta tanto `discount_type` como `discount_amount` en `layaway_items`

**Formato JSON esperado:**
```json
{
  "variant_id": "uuid",
  "qty": 1,
  "unit_price": 30000,
  "discount": 15,
  "discount_type": "PERCENT"
}
```

### 3. Frontend - Utilidad JavaScript

#### ✅ `src/utils/discountCalculator.js`

**Funciones principales:**

1. **`calculateDiscount(subtotal, discountValue, discountType)`**
   - Calcula el monto real del descuento

2. **`calculateLineTotal(line)`**
   - Calcula todos los totales de una línea: subtotal, descuento, impuesto, total

3. **`formatDiscount(discountValue, discountType)`**
   - Formatea para mostrar: "$5,000" o "10%"

4. **`convertDiscountType(subtotal, currentValue, fromType, toType)`**
   - Convierte entre tipos (útil para switching en UI)

5. **`validateDiscount(subtotal, discountValue, discountType)`**
   - Valida que el descuento sea correcto

**Ejemplo de uso:**
```javascript
import { calculateLineTotal, DiscountType } from '@/utils/discountCalculator'

const line = {
  qty: 2,
  unit_price: 50000,
  discount_value: 10,
  discount_type: DiscountType.PERCENT,
  tax_rate: 0.19
}

const totals = calculateLineTotal(line)
// Result:
// {
//   subtotal: 100000,
//   discount: 10000,
//   taxable_base: 90000,
//   tax: 17100,
//   total: 107100
// }
```

## 📊 Comparación de Ejemplos

### Ejemplo 1: Descuento de $5,000

**Configuración:**
- Cantidad: 2
- Precio unitario: $50,000
- **Descuento:** $5,000 (AMOUNT)
- IVA: 19%

**Cálculos:**
```
Subtotal      = 2 × $50,000     = $100,000
Descuento     = $5,000          = $5,000
Base imponible= $100,000 - $5,000 = $95,000
IVA 19%       = $95,000 × 0.19  = $18,050
Total         = $95,000 + $18,050 = $113,050
```

### Ejemplo 2: Descuento del 10%

**Configuración:**
- Cantidad: 2
- Precio unitario: $50,000
- **Descuento:** 10% (PERCENT)
- IVA: 19%

**Cálculos:**
```
Subtotal      = 2 × $50,000     = $100,000
Descuento     = $100,000 × 10%  = $10,000
Base imponible= $100,000 - $10,000 = $90,000
IVA 19%       = $90,000 × 0.19  = $17,100
Total         = $90,000 + $17,100 = $107,100
```

## 🎨 Implementación en UI (Sugerida)

### Componente de Línea de Venta

```vue
<template>
  <v-row>
    <!-- Cantidad y Precio -->
    <v-col cols="3">
      <v-text-field v-model.number="line.qty" label="Cantidad" />
    </v-col>
    <v-col cols="3">
      <v-text-field v-model.number="line.unit_price" label="Precio" />
    </v-col>
    
    <!-- Descuento con botón de cambio de tipo -->
    <v-col cols="4">
      <v-text-field 
        v-model.number="line.discount_value" 
        label="Descuento"
        type="number"
        :suffix="line.discount_type === 'PERCENT' ? '%' : '$'"
        :rules="[validateDiscount]"
      >
        <template v-slot:append>
          <v-btn-toggle 
            v-model="line.discount_type" 
            mandatory 
            density="compact"
            @update:model-value="onDiscountTypeChange"
          >
            <v-btn value="AMOUNT" size="small">$</v-btn>
            <v-btn value="PERCENT" size="small">%</v-btn>
          </v-btn-toggle>
        </template>
      </v-text-field>
    </v-col>
    
    <!-- Total calculado -->
    <v-col cols="2">
      <v-text-field 
        :model-value="formatMoney(lineTotal)" 
        label="Total" 
        readonly 
      />
    </v-col>
  </v-row>
</template>

<script setup>
import { computed, watch } from 'vue'
import { 
  calculateLineTotal, 
  validateDiscount, 
  convertDiscountType,
  DiscountType
} from '@/utils/discountCalculator'

const props = defineProps({
  line: Object,
  taxRate: Number
})

// Calcular total de la línea
const lineTotal = computed(() => {
  const totals = calculateLineTotal({
    ...props.line,
    tax_rate: props.taxRate
  })
  return totals.total
})

// Validar descuento
const validateDiscountRule = (value) => {
  if (!value) return true
  
  const subtotal = props.line.qty * props.line.unit_price
  const validation = validateDiscount(
    subtotal, 
    value, 
    props.line.discount_type
  )
  
  return validation.valid || validation.error
}

// Convertir descuento al cambiar de tipo
const onDiscountTypeChange = (newType) => {
  const oldType = props.line.discount_type === 'AMOUNT' ? 'PERCENT' : 'AMOUNT'
  const subtotal = props.line.qty * props.line.unit_price
  
  props.line.discount_value = convertDiscountType(
    subtotal,
    props.line.discount_value,
    oldType,
    newType
  )
}

// Formatear dinero
const formatMoney = (value) => {
  return `$${Math.round(value).toLocaleString()}`
}
</script>
```

## 🔄 Flujo de Trabajo

### Crear Venta con Descuento

1. **Usuario selecciona producto**
2. **Define cantidad y precio**
3. **Aplica descuento:**
   - Click en botón $ o % para elegir tipo
   - Ingresa valor (ej: 10 para 10% o 10000 para $10,000)
4. **Sistema calcula automáticamente:**
   - Subtotal de línea
   - Descuento real aplicado
   - Base imponible
   - Impuestos
   - Total final

### JSON enviado al backend

```javascript
const saleData = {
  lines: [
    {
      variant_id: "uuid-123",
      qty: 2,
      unit_price: 50000,
      discount: 10,
      discount_type: "PERCENT"  // ← NUEVO campo
    }
  ],
  payments: [ /* ... */ ]
}

// Llamar al SP
await salesService.createSale(tenantId, locationId, saleData)
```

## ✅ Compatibilidad Hacia Atrás

- ✅ **Registros existentes:** Se actualizan automáticamente con `discount_type = 'AMOUNT'`
- ✅ **Sin especificar tipo:** Por defecto usa `'AMOUNT'`
- ✅ **Cálculos anteriores:** Siguen funcionando igual

## 📝 Orden de Ejecución de Migraciones

Ejecutar en este orden:

1. `ADD_DISCOUNT_TYPE.sql` - Agrega columnas y función
2. `UPDATE_SALE_SP_DISCOUNT_TYPE.sql` - Actualiza SP de ventas
3. `UPDATE_LAYAWAY_SP_DISCOUNT_TYPE.sql` - Actualiza SP de plan separé

```bash
# Ejemplo en psql
psql -U postgres -d poslite -f migrations/ADD_DISCOUNT_TYPE.sql
psql -U postgres -d poslite -f migrations/UPDATE_SALE_SP_DISCOUNT_TYPE.sql
psql -U postgres -d poslite -f migrations/UPDATE_LAYAWAY_SP_DISCOUNT_TYPE.sql
```

## 🧪 Casos de Prueba

### Backend (SQL)

```sql
-- Prueba 1: Descuento por valor fijo
SELECT fn_calculate_discount(50000, 5000, 'AMOUNT');
-- Resultado esperado: 5000

-- Prueba 2: Descuento por porcentaje
SELECT fn_calculate_discount(50000, 10, 'PERCENT');
-- Resultado esperado: 5000

-- Prueba 3: Descuento 0%
SELECT fn_calculate_discount(50000, 0, 'PERCENT');
-- Resultado esperado: 0

-- Prueba 4: Error - Porcentaje > 100%
SELECT fn_calculate_discount(50000, 150, 'PERCENT');
-- Debe lanzar excepción

-- Prueba 5: Error - Descuento > Subtotal
SELECT fn_calculate_discount(50000, 60000, 'AMOUNT');
-- Debe lanzar excepción
```

### Frontend (JavaScript)

```javascript
import { calculateDiscount, DiscountType } from '@/utils/discountCalculator'

// Test 1: Descuento fijo
console.assert(calculateDiscount(50000, 5000, DiscountType.AMOUNT) === 5000)

// Test 2: Descuento porcentual
console.assert(calculateDiscount(50000, 10, DiscountType.PERCENT) === 5000)

// Test 3: Descuento 0
console.assert(calculateDiscount(50000, 0, DiscountType.AMOUNT) === 0)

// Test 4: Error en porcentaje > 100%
try {
  calculateDiscount(50000, 150, DiscountType.PERCENT)
  console.error('Debería lanzar excepción')
} catch (e) {
  console.log('✓ Validación correcta')
}
```

## 💡 Casos de Uso Reales

### 1. Promoción Porcentual
**"20% de descuento en toda la tienda"**
- discount_type: `PERCENT`
- discount: `20`

### 2. Descuento Fijo por Cantidad
**"$5,000 de descuento por comprar 2 o más"**
- discount_type: `AMOUNT`
- discount: `5000`

### 3. Descuento por Cliente Preferencial
**"15% de descuento para clientes VIP"**
- discount_type: `PERCENT`
- discount: `15`

### 4. Descuento por Producto Defectuoso
**"$10,000 de descuento por rayón"**
- discount_type: `AMOUNT`
- discount: `10000`

## 🚀 Próximos Pasos (Opcional)

1. **Vista de Administración:**
   - Configurar descuentos automáticos por producto/categoría
   - Reglas de promociones programadas

2. **Reporting:**
   - Reporte de descuentos aplicados
   - Análisis de efectividad de promociones

3. **Validaciones Adicionales:**
   - Límite de descuento por usuario/rol
   - Requieren autorización para descuentos > X%

## 📚 Referencias

- Tabla: `sale_lines`, `layaway_items`
- Función: `fn_calculate_discount()`
- SP: `sp_create_sale()`, `sp_create_layaway()`
- Utilidad: `src/utils/discountCalculator.js`

---

**Implementado:** 14 de Febrero, 2026  
**Versión:** 1.0  
**Estado:** ✅ Completo
