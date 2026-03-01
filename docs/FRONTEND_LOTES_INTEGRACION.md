# Integración Frontend - Sistema de Lotes y Vencimiento

## ✅ Completado

### 1. Servicios
- ✅ **batches.service.js** (340 líneas)
  - Operaciones CRUD de lotes
  - Reportes de vencimiento
  - Generación automática de números de lote
  - Funciones auxiliares para alertas

### 2. Componentes
- ✅ **ExpirationAlerts.vue** (280 líneas)
  - Widget de alertas de vencimiento
  - Filtros por nivel de alerta
  - Vista de detalles
  - Actualización automática configurable

### 3. Vistas Principales
- ✅ **BatchManagement.vue** (500+ líneas)
  - Gestión completa de lotes
  - 3 pestañas: Lotes / Alertas / Reportes
  - Filtros por sede y estado
  - CRUD completo de lotes
  - Tablero de reportes
  - Top 10 productos en riesgo

- ✅ **Inventory.vue** (actualizado)
  - Nueva pestaña "Lotes"
  - Muestra desglose por lote de cada producto
  - Información de vencimiento y alertas
  - Filtros por sede

- ✅ **Products.vue** (actualizado)
  - Campo `requires_expiration` en productos
  - Campo `requires_expiration` en variantes (nullable, sobreescribe)
  - Tooltips explicativos

### 4. Enrutador
- ✅ Ruta `/batches` agregada
- ✅ Componente BatchManagement importado

### 5. Navegación
- ✅ Menú "Lotes y Vencimientos" agregado en sección Inventario

---

## ⏳ Pendiente: Integración en Punto de Venta

### Objetivo
Mostrar alertas de vencimiento durante la venta para informar al cajero sobre productos próximos a vencer.

### Cambios Necesarios en PointOfSale.vue

#### 1. Usar vista `vw_stock_for_cashier` en lugar de tablas directas

**Ubicación:** Al cargar productos disponibles para venta

**Antes:**
```javascript
// Consulta directa a stock_balances
const { data, error } = await supabase
  .from('stock_balances')
  .select('*, variant:product_variants(*)')
  .eq('location_id', currentLocation.value)
  .gt('on_hand', 0)
```

**Después:**
```javascript
// Usar vista con información de vencimiento
const { data, error } = await supabase
  .from('vw_stock_for_cashier')
  .select('*')
  .eq('location_id', currentLocation.value)
  .gt('available_stock', 0)
```

#### 2. Mostrar alertas visuales en la lista de productos

**Agregar indicadores visuales:**
```vue
<template>
  <!-- En el listado de productos -->
  <v-list-item v-for="product in availableProducts" :key="product.variant_id">
    <template #prepend>
      <!-- Icono de alerta si hay vencimiento próximo -->
      <v-icon 
        v-if="product.alert_level === 'CRITICAL'"
        color="error"
        size="small"
      >
        mdi-alert-circle
      </v-icon>
      <v-icon 
        v-else-if="product.alert_level === 'WARNING'"
        color="warning"
        size="small"
      >
        mdi-alert
      </v-icon>
    </template>
    
    <v-list-item-title>{{ product.product_name }}</v-list-item-title>
    <v-list-item-subtitle>
      SKU: {{ product.sku }}
      <!-- Mostrar ubicación física si existe -->
      <v-chip 
        v-if="product.physical_location" 
        size="x-small" 
        class="ml-2"
      >
        {{ product.physical_location }}
      </v-chip>
      <!-- Mostrar tiempo al vencimiento -->
      <span 
        v-if="product.nearest_expiration"
        class="ml-2"
        :class="getDaysClass(product.alert_level)"
      >
        Vence: {{ formatExpirationDate(product.nearest_expiration) }}
      </span>
    </v-list-item-subtitle>
  </v-list-item>
</template>

<script setup>
// Función auxiliar para formatear fecha de vencimiento
const formatExpirationDate = (dateStr) => {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const today = new Date()
  const days = Math.floor((date - today) / (1000 * 60 * 60 * 24))
  
  if (days < 0) return '⚠️ VENCIDO'
  if (days === 0) return '⚠️ Vence HOY'
  if (days === 1) return '⚠️ Vence mañana'
  return `${days} día(s)`
}

const getDaysClass = (alertLevel) => {
  return {
    'CRITICAL': 'text-error font-weight-bold',
    'WARNING': 'text-warning',
    'OK': ''
  }[alertLevel] || ''
}
</script>
```

#### 3. Mostrar diálogo de confirmación si hay productos críticos en el carrito

**Antes de confirmar la venta:**
```javascript
const confirmSale = async () => {
  // Verificar si hay items con alerta crítica en el carrito
  const criticalItems = cartItems.value.filter(item => 
    item.alert_level === 'CRITICAL' || item.alert_level === 'EXPIRED'
  )
  
  if (criticalItems.length > 0) {
    const confirmed = await showConfirmDialog({
      title: 'Productos con Alerta de Vencimiento',
      message: `El carrito contiene ${criticalItems.length} producto(s) próximos a vencer o vencidos. ¿Desea continuar?`,
      items: criticalItems.map(item => ({
        name: item.product_name,
        expiration: item.nearest_expiration,
        days: calculateDaysToExpiry(item.nearest_expiration)
      }))
    })
    
    if (!confirmed) return
  }
  
  // Continuar con la venta
  await processSale()
}
```

#### 4. Registro automático de advertencias (ya implementado en backend)

El procedimiento almacenado `sp_create_sale()` ya está implementado para:
- ✅ Llamar a `fn_allocate_stock_fefo()` automáticamente
- ✅ Consumir lotes en orden FEFO
- ✅ Crear registros en `sale_warnings` si hay alertas
- ✅ Crear registros en `sale_line_batches` para trazabilidad

**No requiere cambios adicionales en frontend para esto.**

---

## 🏠 Integración en Home/Dashboard

### Agregar widget de alertas en vista Home.vue

**Ubicación:** Agregar el componente ExpirationAlerts en la vista principal

```vue
<template>
  <v-container>
    <v-row>
      <!-- Otros widgets existentes -->
      
      <!-- Widget de alertas de vencimiento -->
      <v-col cols="12" md="6" lg="4">
        <ExpirationAlerts 
          :tenant-id="tenantId" 
          :auto-refresh="true"
          :refresh-interval="300000"
        />
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup>
import ExpirationAlerts from '@/components/ExpirationAlerts.vue'
import { useTenant } from '@/composables/useTenant'

const { tenantId } = useTenant()
</script>
```

---

## 📊 Reportes Automáticos

### Vista Materializada Automática
El sistema actualiza la vista `stock_balances` automáticamente mediante triggers:
- Cuando se crea/actualiza un lote en `inventory_batches`
- La vista se refresca con `REFRESH MATERIALIZED VIEW CONCURRENTLY`

### Tiempo de Actualización
La vista se actualiza en cada operación crítica:
- ✅ Creación de lote
- ✅ Venta (consumo de stock)
- ✅ Ajuste de inventario
- ✅ Traslado entre sedes

---

## 🧪 Pruebas Manuales

### 1. Crear producto con vencimiento requerido
1. Ir a **Productos** → Nuevo Producto
2. Activar switch "Requiere control de vencimiento"
3. Guardar producto
4. Crear variante

### 2. Crear lote con vencimiento
1. Ir a **Inventario → Lotes y Vencimientos**
2. Pestaña "Lotes" → Nuevo Lote
3. Completar formulario:
   - Sede
   - Producto/Variante
   - Número de lote (o generar automáticamente)
   - **Fecha de vencimiento** (requerida si el producto la necesita)
   - Cantidad
   - Costo unitario
   - Ubicación física (opcional)
4. Guardar

### 3. Verificar alertas
1. Crear lotes con diferentes fechas:
   - Vencido (fecha pasada)
   - Crítico (7 días o menos)
   - Advertencia (30 días o menos)
   - OK (más de 30 días)
2. Ir a pestaña **"Alertas"** en Lotes
3. Filtrar por nivel de alerta
4. Verificar que se muestran correctamente

### 4. Verificar reportes
1. Ir a pestaña **"Reportes"** en Lotes
2. Ver tablero por sede
3. Ver Top 10 productos en riesgo
4. Verificar valores calculados

### 5. Verificar en inventario
1. Ir a **Inventario → Stock y Kardex**
2. Seleccionar pestaña **"Lotes"**
3. Ver desglose de lotes por producto
4. Verificar filtros por sede

### 6. Verificar FEFO en venta
1. Crear varios lotes del mismo producto con diferentes fechas de vencimiento
2. Ir a **Punto de Venta**
3. Agregar producto al carrito
4. Completar venta
5. **Verificar en base de datos:**
   ```sql
   -- Ver qué lotes se consumieron
   SELECT * FROM sale_line_batches 
   WHERE sale_line_id IN (
     SELECT sale_line_id FROM sale_lines 
     WHERE sale_id = [ID_DE_LA_VENTA]
   )
   ORDER BY batch_consumed_date;
   
   -- Verificar que se consumió primero el que vence antes
   ```

### 7. Verificar advertencias en ventas
```sql
-- Ver advertencias generadas en venta
SELECT sw.*, sl.quantity, b.batch_number, b.expiration_date, v.sku
FROM sale_warnings sw
JOIN sale_lines sl ON sw.sale_line_id = sl.sale_line_id
JOIN inventory_batches b ON sw.batch_id = b.batch_id
JOIN product_variants v ON sl.variant_id = v.variant_id
WHERE sw.sale_id = [ID_DE_LA_VENTA]
ORDER BY sw.severity;
```

---

## 🔧 Personalización Adicional

### Configuración de umbrales de alerta

Los umbrales están definidos en `batches.service.js`:

```javascript
// Línea ~60-80 en batches.service.js
static getAlertLevel(expirationDate) {
  if (!expirationDate) return 'NONE'
  
  const today = new Date()
  const expDate = new Date(expirationDate)
  const days = Math.floor((expDate - today) / (1000 * 60 * 60 * 24))
  
  if (days < 0) return 'EXPIRED'      // Ya vencido
  if (days <= 7) return 'CRITICAL'    // 7 días o menos → CAMBIAR AQUÍ
  if (days <= 30) return 'WARNING'    // 30 días o menos → CAMBIAR AQUÍ
  return 'OK'
}
```

**Para personalizar:**
1. Editar los valores `7` y `30` según necesidades del negocio
2. Ejemplo para productos perecederos:
   ```javascript
   if (days <= 3) return 'CRITICAL'   // Más estricto
   if (days <= 14) return 'WARNING'   // Advertencia más temprana
   ```

### Configuración de actualización automática en alertas

En `ExpirationAlerts.vue`:

```javascript
// Props del componente (línea ~280)
defineProps({
  tenantId: { type: String, required: true },
  autoRefresh: { type: Boolean, default: false },
  refreshInterval: { type: Number, default: 300000 } // 5 min → CAMBIAR AQUÍ
})
```

---

## 📝 Notas Importantes

### Jerarquía de configuración
1. **producto.requires_expiration** = Valor por defecto
2. **variant.requires_expiration** = Si es NULL, hereda del producto
3. **variant.requires_expiration** = Si es TRUE/FALSE, sobreescribe al producto

### Función auxiliar de backend
```sql
-- Usar esta función para resolver la configuración efectiva
SELECT fn_variant_requires_expiration(variant_id) AS requires_exp
FROM product_variants
WHERE variant_id = [ID];
```

### Rendimiento
- La vista `stock_balances` es **MATERIALIZADA** para mejorar el rendimiento
- Se actualiza automáticamente en cada operación crítica
- Para actualización manual: `REFRESH MATERIALIZED VIEW CONCURRENTLY stock_balances;`

---

## 🚀 Próximos Pasos Sugeridos

1. ✅ Integrar alertas en PointOfSale.vue (ver sección arriba)
2. ✅ Agregar widget ExpirationAlerts en Home.vue
3. ⏳ Crear reportes PDF/Excel de productos próximos a vencer
4. ⏳ Notificaciones push cuando hay productos críticos
5. ⏳ Tablero gerencial con KPIs de vencimiento
6. ⏳ Integración con sistema de compras para reposición inteligente

---

## 📞 Soporte

Para más información, consultar:
- `docs/SISTEMA_LOTES_VENCIMIENTO.md` - Documentación técnica completa
- `docs/LOTES_PLAN_IMPLEMENTACION.md` - Plan de implementación
- `migrations/ADD_EXPIRATION_BATCHES_PHASE*.sql` - Scripts SQL implementados

---

**Última actualización:** Febrero 2026
**Versión:** 1.0
**Estado:** Listo para pruebas e integración en POS
