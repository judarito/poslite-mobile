# Fix: Error BOM "violates check constraint"

## 🐛 Problema

Al intentar guardar una lista de materiales (BOM), aparecía el error:

```
new row for relation "bill_of_materials" violates check constraint "bill_of_materials_check"
```

## 🔍 Causa Raíz

La tabla `bill_of_materials` tiene un constraint CHECK que requiere **EXACTAMENTE UNO** de estos campos:

- `product_id` (BOM a nivel de producto)
- `variant_id` (BOM a nivel de variante)

**No puede tener ambos, no puede tener ninguno.**

```sql
CHECK (
  (product_id IS NOT NULL AND variant_id IS NULL) OR 
  (product_id IS NULL AND variant_id IS NOT NULL)
)
```

### ❌ Error Original

En `src/views/BOMs.vue` línea 330:

```javascript
const openCreateBOM = () => {
  bomEditor.value.open(null, null, null)  // ❌ Ambos null
}
```

El formulario se abría sin asociar el BOM a ningún producto ni variante, violando el constraint.

## ✅ Solución Implementada

### 1. Validación en Backend (`manufacturing.service.js`)

**createBOM():**

```javascript
async createBOM(tenantId, bom) {
  // Validar que se proporcione EXACTAMENTE uno
  const hasProductId = !!bom.product_id
  const hasVariantId = !!bom.variant_id
  
  if (!hasProductId && !hasVariantId) {
    throw new Error('Debe especificar un product_id O variant_id')
  }
  if (hasProductId && hasVariantId) {
    throw new Error('Solo puede especificar product_id O variant_id, no ambos')
  }
  // ...
}
```

**updateBOM():**

```javascript
async updateBOM(tenantId, bomId, updates) {
  // Validar si se intenta modificar product_id/variant_id
  if (updates.product_id !== undefined || updates.variant_id !== undefined) {
    // ... misma validación
  }
  // ...
}
```

### 2. Selector en Frontend (`BOMEditor.vue`)

Se agregó un **campo de selección obligatorio** para elegir el producto o variante:

```vue
<v-autocomplete
  v-if="!isEditing"
  v-model="selectedProductVariant"
  :items="productVariantOptions"
  label="Producto / Variante *"
  :rules="[rules.required]"
  hint="Selecciona el producto o variante para el cual crear este BOM"
>
```

**Funciones agregadas:**

- `loadProductVariantOptions()` - Carga todos los productos MANUFACTURED disponibles
- `onProductVariantChange()` - Actualiza `formData.product_id` o `formData.variant_id` según selección

**Validación adicional en save():**

```javascript
if (!formData.value.product_id && !formData.value.variant_id) {
  alert('Debe seleccionar un producto o variante para crear el BOM')
  return
}
```

## 📋 Archivos Modificados

1. ✅ `src/services/manufacturing.service.js`
   - Validación en `createBOM()` líneas 84-95
   - Validación en `updateBOM()` líneas 141-152

2. ✅ `src/components/BOMEditor.vue`
   - Campo v-autocomplete para seleccionar producto/variante (líneas 30-61)
   - Variables reactivas `productVariantOptions` y `selectedProductVariant`
   - Funciones `loadProductVariantOptions()` y `onProductVariantChange()`
   - Validación adicional en `save()` (líneas 558-562)

## 🎯 Flujo Corregido

### Crear BOM desde vista BOMs:

1. Usuario hace clic en "Nuevo BOM"
2. **Se abre formulario con selector de producto/variante**
3. Usuario **DEBE seleccionar** un producto o variante
4. Usuario ingresa nombre, componentes, etc.
5. Al guardar, validación backend confirma `product_id` XOR `variant_id`

### Crear BOM desde vista Productos:

1. Usuario está editando un producto específico
2. Hace clic en "Crear BOM"
3. Formulario se abre **con producto pre-seleccionado** (readonly)
4. Usuario ingresa componentes
5. Guarda exitosamente con `product_id` asignado

## ✅ Testing

Prueba estos escenarios:

1. **Crear BOM para producto:**
   - Ir a BOMs → Nuevo BOM
   - Seleccionar "Camisas (Producto)" en el selector
   - Agregar componentes → Guardar
   - ✅ Debe crear BOM con `product_id` y `variant_id=null`

2. **Crear BOM para variante específica:**
   - Ir a BOMs → Nuevo BOM
   - Seleccionar "Camisas - Talla M (Variante)" en el selector
   - Agregar componentes → Guardar
   - ✅ Debe crear BOM con `product_id=null` y `variant_id`

3. **Editar BOM existente:**
   - Abrir BOM existente
   - Producto/variante se muestra pero NO es editable
   - Modificar solo componentes/nombre
   - ✅ Guarda sin modificar asociación

4. **Validación negativa:**
   - Intentar guardar sin seleccionar producto/variante
   - ✅ Debe mostrar "Debe seleccionar un producto o variante"

## 🔗 Referencias

- **Constraint definición:** `migrations/MANUFACTURING_PHASE1_BASE_TABLES.sql` línea 45-48
- **Documentación BOM:** `MANUFACTURING_FRS.md` sección CONS-001
