# Fix: 3 Problemas en BOM Editor

## 🐛 Problemas Reportados

### 1. Error "column bill_of_materials.components does not exist"

**Causa:** En `manufacturing.service.js` línea 118, se estaba intentando insertar componentes con el campo `unit` (texto) en lugar de `unit_id` (UUID):

```javascript
// ❌ INCORRECTO
unit: c.unit || 'unidad',

// ✅ CORRECTO
unit_id: c.unit_id || null,
```

La tabla `bom_components` no tiene columna `unit` (fue migrada a `unit_id` en el sistema de unidades de medida).

### 2. Unidad de medida no se hereda del componente

**Causa:** Al seleccionar un componente en el BOM, no se heredaba automáticamente su `unit_id`, obligando al usuario a seleccionarla manualmente (posible error).

**Comportamiento deseado:** Cuando selecciono "Tela drill Azul" (que tiene unit_id="metro"), el BOM debe heredar automáticamente "metro" como unidad.

### 3. Uso de `alert()` de JavaScript

**Problema:** Se usaban `alert()` nativos en lugar del sistema estandarizado de mensajes Vuetify de la aplicación.

## ✅ Soluciones Implementadas

### 1. Corregir campo `unit` → `unit_id` (manufacturing.service.js)

**Archivo:** `src/services/manufacturing.service.js` líneas 115-123

```javascript
// Crear los componentes del BOM
if (bom.components && bom.components.length > 0) {
  const components = bom.components.map(c => ({
    tenant_id: tenantId,
    bom_id: bomResult.bom_id,
    component_variant_id: c.component_variant_id,
    quantity_required: c.quantity_required,
    unit_id: c.unit_id || null,  // ✅ Corregido
    waste_percentage: c.waste_percentage || 0,
    is_optional: c.is_optional || false
  }))
  // ...
}
```

### 2. Herencia automática de `unit_id` (BOMEditor.vue)

**A. Cargar `unit_id` en componentes disponibles** (líneas 354-377)

```javascript
const loadComponents = async () => {
  // ...
  componentOptions.value.push({
    variant_id: variant.variant_id,
    sku: variant.sku,
    variant_name: variant.variant_name,
    display_name: `${product.name} - ${variant.variant_name || 'Predeterminado'}`,
    cost: variant.cost || 0,
    unit_id: variant.unit_id || product.unit_id || null,  // ✅ Heredar unit_id
    is_component: true
  })
}
```

**B. Función para heredar automáticamente** (líneas 459-481)

```javascript
const onComponentSelect = (index, variantId) => {
  const comp = formData.value.components[index]
  if (!variantId) {
    comp.unit_cost = 0
    comp.total_cost = 0
    return
  }

  const selectedComponent = componentOptions.value.find(
    c => c.variant_id === variantId
  )
  
  if (selectedComponent) {
    // Heredar unit_id del componente automáticamente
    if (selectedComponent.unit_id) {
      comp.unit_id = selectedComponent.unit_id  // ✅ Herencia automática
    }
    comp.unit_cost = selectedComponent.cost || 0
  }
  
  calculateComponentCost(index)
}
```

**C. Conectar evento** (línea 133)

```vue
<v-autocomplete
  v-model="comp.component_variant_id"
  @update:model-value="onComponentSelect(index, $event)"
  <!-- ✅ Llama a onComponentSelect en lugar de solo calculateComponentCost -->
>
```

### 3. Sistema de mensajes estandarizado

**A. Snackbar agregado al template** (líneas 298-302)

```vue
<!-- Snackbar -->
<v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="3000">
  {{ snackbar.message }}
</v-snackbar>
```

**B. Estado del snackbar** (líneas 329-333)

```javascript
// Snackbar
const snackbar = ref({
  show: false,
  message: '',
  color: 'success'
})
```

**C. Función helper** (líneas 483-485)

```javascript
const showMessage = (message, color = 'success') => {
  snackbar.value = { show: true, message, color }
}
```

**D. Reemplazar todos los `alert()`**

```javascript
// ❌ ANTES
alert('Debe seleccionar un producto o variante para crear el BOM')
alert('Error al guardar el BOM: ' + error.message)

// ✅ AHORA
showMessage('Debe seleccionar un producto o variante para crear el BOM', 'warning')
showMessage('Error al guardar el BOM: ' + error.message, 'error')
```

## 📋 Archivos Modificados

1. ✅ **src/services/manufacturing.service.js** (línea 120)
   - Cambió `unit: c.unit || 'unidad'` → `unit_id: c.unit_id || null`

2. ✅ **src/components/BOMEditor.vue** (múltiples cambios)
   - Agregó `unit_id` a `loadComponents()` (línea 370)
   - Agregó función `onComponentSelect()` para herencia automática (líneas 459-481)
   - Cambió evento `@update:model-value` (línea 133)
   - Agregó snackbar al template (líneas 298-302)
   - Agregó estado `snackbar` (líneas 329-333)
   - Agregó función `showMessage()` (líneas 483-485)
   - Reemplazó 2 `alert()` por `showMessage()` (líneas 593, 631)
   - Expuso `onComponentSelect` y `showMessage` en el return (líneas 664, 668)

## 🎯 Flujo Mejorado

### Crear componente de BOM:

1. Usuario hace clic en "Agregar Componente"
2. Selecciona "Tela drill Azul" del autocomplete
3. **✨ El sistema automáticamente:**
   - Rellena `unit_id` con "Metro" (heredado del producto)
   - Calcula `unit_cost` según el costo del componente
   - Calcula `total_cost` considerando cantidad y desperdicio
4. Usuario solo ajusta cantidad/desperdicio si es necesario
5. Guarda sin errores de columna inexistente

### Mensajes de error/éxito:

- ✅ **Warning amarillo:** "Debe seleccionar un producto o variante"
- ✅ **Error rojo:** "Error al guardar el BOM: [mensaje]"
- ✅ **Success verde:** (cuando se emite desde vista padre)

## ✅ Testing

1. **Crear BOM con componente:**
   - Agregar "Tela drill Azul" como componente
   - Verificar que campo "Unidad" se llena automáticamente con "METRO"
   - Guardar BOM
   - ✅ Debe guardar exitosamente sin error "components does not exist"

2. **Validación de producto/variante:**
   - Intentar guardar BOM sin seleccionar producto
   - ✅ Debe mostrar snackbar amarillo con mensaje de advertencia

3. **Error de guardado:**
   - Simular error (ej: sin conexión)
   - ✅ Debe mostrar snackbar rojo con mensaje de error

4. **Herencia unit_id:**
   - Agregar componente que tiene `unit_id` definido
   - ✅ Campo unidad se llena automáticamente
   - Agregar componente sin `unit_id`
   - ✅ Campo unidad queda vacío (usuario puede seleccionar)

## 🔗 Referencias

- **Sistema Unidades de Medida:** `migrations/CREATE_UNITS_OF_MEASURE.sql`
- **Migración BOM components:** `migrations/MANUFACTURING_PHASE1_BASE_TABLES.sql`
- **Documentación unidades:** `docs/UNITS_OF_MEASURE_SYSTEM.md`
