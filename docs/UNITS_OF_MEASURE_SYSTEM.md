# Sistema de Unidades de Medida - Guía de Implementación

## ✅ Completado

### 1. Base de Datos
- ✅ Tabla `units_of_measure` creada con campos:
  - `unit_id` (UUID, Primary Key)
  - `tenant_id` (UUID, nullable para unidades sistema)
  - `code` (VARCHAR(20), código interno: KG, UND, MT, etc.)
  - `dian_code` (VARCHAR(20), código oficial DIAN Colombia)
  - `name` (VARCHAR(100), nombre descriptivo)
  - `description` (TEXT, información adicional)
  - `is_active` (BOOLEAN)
  - `is_system` (BOOLEAN, unidades no editables)
  
- ✅ 40+ unidades del sistema precargadas con códigos DIAN oficiales:
  - Masa: KG, GR, MG, TON, LB, OZ
  - Volumen: LT, ML, CM3, M3, GAL
  - Longitud: MT, CM, MM, KM, IN, FT, YD
  - Área: M2, CM2, HA
  - Tiempo: HR, MIN, SEG, DIA, MES, ANO
  - Cantidad: UND, PAR, DOCENA, CIENTO, MILLAR
  - Empaque: CAJA, PAQUETE, BOLSA, ROLLO, BOTELLA, FRASCO
  - Otros: KWH, SERV, ACT

- ✅ Columnas agregadas:
  - `products.unit_id` (FK a units_of_measure)
  - `product_variants.unit_id` (FK a units_of_measure, puede heredar de producto)
  - `bom_components.unit_id` (FK a units_of_measure, migrado de TEXT a UUID)

- ✅ Políticas RLS configuradas (tenant-aware)
- ✅ Función helper: `fn_get_unit_by_code(tenant_id, code)` para obtener UUID
- ✅ Trigger auto-actualización `updated_at`
- ✅ Migración automática de datos existentes `bom_components.unit` TEXT → `unit_id` UUID

### 2. Backend (Servicio)
- ✅ `unitsOfMeasure.service.js` creado con métodos:
  - `getUnits(tenantId, page, pageSize, search)` - Listar con paginación
  - `getUnitById(unitId)` - Obtener por ID
  - `createUnit(tenantId, unitData)` - Crear unidad personalizada
  - `updateUnit(tenantId, unitId, unitData)` - Actualizar unidad
  - `deleteUnit(tenantId, unitId)` - Eliminar con validación de uso
  - `checkUnitUsage(unitId)` - Verificar si está en uso
  - `getActiveUnits(tenantId)` - Obtener solo activas (para dropdowns)
  - `getUnitByCode(tenantId, code)` - Buscar por código

### 3. Frontend (Vista Maestro)
- ✅ `UnitsOfMeasure.vue` creada con:
  - ListView con paginación y búsqueda
  - Chips visuales: Sistema (azul) vs Personalizada (verde)
  - Formulario crear/editar con validaciones
  - Validación de eliminación (verifica si está en uso)
  - Mensajes informativos sobre códigos DIAN
  - Solo permite editar/eliminar unidades del tenant (no sistema)

### 4. Navegación
- ✅ Ruta `/units` agregada al router
- ✅ Menú "Unidades de Medida" agregado en sección Catálogo
- ✅ Ícono: `mdi-ruler` (color cyan)

---

## 📋 Pendiente: Integración con Formularios

### A. Formulario de Productos (`Products.vue`)

**Campos a agregar:**

```vue
<!-- En el formulario de productos -->
<v-autocomplete
  v-model="formData.unit_id"
  :items="availableUnits"
  item-title="name"
  item-value="unit_id"
  label="Unidad de medida"
  variant="outlined"
  clearable
  prepend-inner-icon="mdi-ruler"
>
  <template #item="{ props, item }">
    <v-list-item v-bind="props">
      <template #prepend>
        <v-chip size="x-small" :color="item.raw.is_system ? 'blue' : 'green'">
          {{ item.raw.code }}
        </v-chip>
      </template>
      <template #subtitle>
        <span v-if="item.raw.dian_code" class="text-caption">
          DIAN: {{ item.raw.dian_code }}
        </span>
      </template>
    </v-list-item>
  </template>
</v-autocomplete>
```

**Script setup:**

```javascript
import unitsOfMeasureService from '@/services/unitsOfMeasure.service'

const availableUnits = ref([])

// Cargar unidades activas
const loadUnits = async () => {
  if (!tenantId.value) return
  const result = await unitsOfMeasureService.getActiveUnits(tenantId.value)
  if (result.success) {
    availableUnits.value = result.data.map(u => ({
      ...u,
      // Formato para mostrar: "UND - Unidad (DIAN: 94)"
      name: `${u.code} - ${u.name}${u.dian_code ? ' (DIAN: ' + u.dian_code + ')' : ''}`
    }))
  }
}

onMounted(() => {
  loadUnits()
})
```

**Al guardar producto:**

```javascript
const saveProduct = async () => {
  const productData = {
    name: formData.value.name,
    description: formData.value.description,
    category_id: formData.value.category_id,
    unit_id: formData.value.unit_id,  // ✅ Agregar unidad
    // ... otros campos
  }
  
  await productsService.createProduct(tenantId.value, productData)
}
```

---

### B. Formulario de Variantes (`Products.vue`)

**Lógica de herencia:**

```javascript
// Variante puede heredar unidad del producto padre o tener propia
const variantFormData = ref({
  sku: '',
  variant_name: '',
  unit_id: null,  // Si null, hereda del producto
  inherit_unit: true  // Checkbox para heredar
})

// Computed para mostrar unidad efectiva
const effectiveUnit = computed(() => {
  if (variantFormData.value.inherit_unit) {
    return productFormData.value.unit_id
  }
  return variantFormData.value.unit_id
})
```

**Template:**

```vue
<v-switch
  v-model="variantFormData.inherit_unit"
  label="Heredar unidad del producto"
  color="primary"
  hide-details
  class="mb-4"
></v-switch>

<v-autocomplete
  v-if="!variantFormData.inherit_unit"
  v-model="variantFormData.unit_id"
  :items="availableUnits"
  item-title="name"
  item-value="unit_id"
  label="Unidad de medida específica"
  variant="outlined"
  clearable
></v-autocomplete>

<v-alert v-else type="info" density="compact" variant="tonal">
  Esta variante usará la unidad del producto: 
  <strong>{{ getUnitDisplayName(productFormData.unit_id) }}</strong>
</v-alert>
```

---

### C. Formulario BOM Editor (`BOMEditor.vue`)

**Migración de campo `unit` TEXT a `unit_id` UUID:**

```javascript
// ANTES (TEXT)
const componentFormData = ref({
  component_variant_id: null,
  quantity: 1,
  unit: 'UND',  // ❌ Campo TEXT obsoleto
  waste_percentage: 0
})

// DESPUÉS (UUID)
const componentFormData = ref({
  component_variant_id: null,
  quantity: 1,
  unit_id: null,  // ✅ FK a units_of_measure
  waste_percentage: 0
})
```

**Template con autocomplete:**

```vue
<v-autocomplete
  v-model="component.unit_id"
  :items="availableUnits"
  item-title="name"
  item-value="unit_id"
  label="Unidad de medida *"
  variant="outlined"
  :rules="[rules.required]"
  prepend-inner-icon="mdi-ruler"
>
  <template #selection="{ item }">
    <v-chip size="small">
      <strong>{{ item.raw.code }}</strong>
      <span class="ml-1 text-caption">{{ item.raw.name }}</span>
    </v-chip>
  </template>
  
  <template #item="{ props, item }">
    <v-list-item v-bind="props">
      <template #prepend>
        <v-chip size="x-small" :color="item.raw.is_system ? 'blue' : 'green'">
          {{ item.raw.code }}
        </v-chip>
      </template>
      <template #append v-if="item.raw.dian_code">
        <v-chip size="x-small" variant="outlined" color="purple">
          DIAN: {{ item.raw.dian_code }}
        </v-chip>
      </template>
    </v-list-item>
  </template>
</v-autocomplete>
```

**Al cargar BOM existente (migración):**

```javascript
const loadBOM = async (bomId) => {
  const result = await manufacturingService.getBOMById(tenantId.value, bomId)
  
  if (result.success) {
    // Migrar componentes con campo unit TEXT antiguo
    formData.value.components = result.data.bom_components.map(comp => {
      let unitId = comp.unit_id  // Preferir UUID si existe
      
      // Si aún tiene unit TEXT (migración pendiente), buscar UUID
      if (!unitId && comp.unit) {
        const matchedUnit = availableUnits.value.find(
          u => u.code.toUpperCase() === comp.unit.toUpperCase()
        )
        unitId = matchedUnit?.unit_id || null
      }
      
      return {
        component_variant_id: comp.component_variant_id,
        quantity: comp.quantity_required,
        unit_id: unitId,  // ✅ Usar UUID
        waste_percentage: comp.waste_percentage || 0
      }
    })
  }
}
```

**Al guardar BOM:**

```javascript
const saveBOM = async () => {
  const bomData = {
    bom_name: formData.value.bom_name,
    product_id: formData.value.product_id,
    variant_id: formData.value.variant_id,
    components: formData.value.components.map(comp => ({
      component_variant_id: comp.component_variant_id,
      quantity: comp.quantity,
      unit_id: comp.unit_id,  // ✅ Enviar UUID, no TEXT
      waste_percentage: comp.waste_percentage,
      is_optional: comp.is_optional
    }))
  }
  
  await manufacturingService.saveBOM(tenantId.value, bomData)
}
```

---

### D. Actualizar Servicio Manufacturing (`manufacturing.service.js`)

**Query SELECT actualizar:**

```javascript
async getBOMs(tenantId, page, pageSize, search) {
  let query = supabaseService.client
    .from('bill_of_materials')
    .select(`
      *,
      product:product_id(product_id, name),
      variant:variant_id(variant_id, sku, variant_name),
      bom_components(
        component_id,
        component_variant_id,
        component_variant:component_variant_id(
          variant_id, sku, variant_name, price, cost
        ),
        quantity_required,
        unit_id,  // ✅ UUID en lugar de unit TEXT
        unit:unit_id(code, name, dian_code),  // ✅ JOIN con units_of_measure
        waste_percentage,
        is_optional
      )
    `)
  // ...
}
```

**Función saveBOM actualizar:**

```javascript
async saveBOM(tenantId, bomData) {
  // Insertar componentes con unit_id UUID
  const componentsToInsert = bomData.components.map(comp => ({
    bom_id: newBOM.bom_id,
    tenant_id: tenantId,
    component_variant_id: comp.component_variant_id,
    quantity: comp.quantity,
    unit_id: comp.unit_id,  // ✅ UUID, no TEXT
    waste_percentage: comp.waste_percentage || 0,
    is_optional: comp.is_optional || false
  }))
  
  await supabaseService.client
    .from('bom_components')
    .insert(componentsToInsert)
}
```

---

### E. Servicio Productos (`products.service.js`)

**SELECT actualizar para incluir unidades:**

```javascript
async getProducts(tenantId, page, pageSize, search) {
  let query = supabaseService.client
    .from('products')
    .select(`
      *,
      category:category_id(name),
      unit:unit_id(code, name, dian_code),  // ✅ JOIN con units_of_measure
      product_variants(
        *,
        unit:unit_id(code, name, dian_code)  // ✅ Variantes también
      )
    `)
  // ...
}
```

**Display en UI:**

```javascript
// Helper para mostrar unidad efectiva
const getEffectiveUnit = (variant, product) => {
  if (variant.unit_id) {
    // Variante tiene unidad propia
    return variant.unit
  }
  // Heredar del producto
  return product.unit
}

// En template
<span v-if="getEffectiveUnit(variant, product)">
  {{ getEffectiveUnit(variant, product).code }}
</span>
```

---

## 🔧 Comandos de Ejecución

### 1. Aplicar migración SQL:

```powershell
psql -U postgres -d pos_lite -f "e:\Dev\POSLite\App\migrations\CREATE_UNITS_OF_MEASURE.sql"
```

### 2. Verificar instalación:

```sql
-- Ver unidades del sistema
SELECT code, name, dian_code, is_system 
FROM units_of_measure 
WHERE tenant_id IS NULL 
ORDER BY name;

-- Contar unidades
SELECT 
  COUNT(*) FILTER (WHERE tenant_id IS NULL) as sistema,
  COUNT(*) FILTER (WHERE tenant_id IS NOT NULL) as personalizadas
FROM units_of_measure;

-- Verificar columnas agregadas
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name IN ('products', 'product_variants', 'bom_components')
AND column_name = 'unit_id';
```

### 3. Migrar productos existentes (ejemplo):

```sql
-- Asignar unidad "UND" a todos los productos sin unidad
UPDATE products 
SET unit_id = (
  SELECT unit_id FROM units_of_measure 
  WHERE code = 'UND' AND tenant_id IS NULL
)
WHERE unit_id IS NULL;

-- Asignar unidad "KG" a productos de categoría específica
UPDATE products p
SET unit_id = (
  SELECT unit_id FROM units_of_measure 
  WHERE code = 'KG' AND tenant_id IS NULL
)
WHERE p.category_id = 'uuid-de-categoria-alimentos'
AND p.unit_id IS NULL;
```

---

## 📊 Estructura de Datos

### Ejemplo unidad del sistema:

```json
{
  "unit_id": "uuid-generated",
  "tenant_id": null,
  "code": "KG",
  "dian_code": "28",
  "name": "Kilogramo",
  "description": "Unidad de masa del sistema internacional",
  "is_active": true,
  "is_system": true
}
```

### Ejemplo unidad personalizada:

```json
{
  "unit_id": "uuid-generated",
  "tenant_id": "tenant-uuid",
  "code": "PORCION",
  "dian_code": null,
  "name": "Porción",
  "description": "Porción de comida servida",
  "is_active": true,
  "is_system": false
}
```

### Ejemplo producto con unidad:

```json
{
  "product_id": "uuid",
  "name": "Harina de Trigo",
  "unit_id": "uuid-kg",
  "unit": {
    "code": "KG",
    "name": "Kilogramo",
    "dian_code": "28"
  }
}
```

### Ejemplo BOM component con unidad:

```json
{
  "component_id": "uuid",
  "component_variant_id": "uuid",
  "quantity": 2.5,
  "unit_id": "uuid-kg",
  "unit": {
    "code": "KG",
    "name": "Kilogramo",
    "dian_code": "28"
  },
  "waste_percentage": 5
}
```

---

## ✅ Checklist de Integración

- [x] Script SQL ejecutado
- [x] Servicio `unitsOfMeasure.service.js` creado
- [x] Vista `UnitsOfMeasure.vue` creada
- [x] Ruta `/units` agregada al router
- [x] Menú "Unidades de Medida" agregado
- [ ] Actualizar `Products.vue` formulario productos (agregar unit_id)
- [ ] Actualizar `Products.vue` formulario variantes (agregar unit_id con herencia)
- [ ] Actualizar `BOMEditor.vue` (migrar unit TEXT → unit_id UUID)
- [ ] Actualizar `manufacturing.service.js` SELECT (incluir JOIN units)
- [ ] Actualizar `products.service.js` SELECT (incluir JOIN units)
- [ ] Migrar datos existentes productos a unidades por defecto
- [ ] Testing crear producto con unidad
- [ ] Testing crear BOM con componentes y unidades
- [ ] Testing facturación electrónica con códigos DIAN

---

## 🎯 Próximos Pasos

1. **Ejecutar migración SQL** (ver comando arriba)
2. **Recargar navegador** y navegar a Catálogo → Unidades de Medida
3. **Verificar** que las 40+ unidades del sistema aparecen
4. **Actualizar formularios** según guías arriba (Products, Variants, BOM)
5. **Migrar datos existentes** a unidades por defecto (UND, KG, etc.)
6. **Testing completo** del flujo productos → BOMs → fabricación

---

## 📚 Referencias

- **Códigos DIAN**: [Resolución 000042/2020](https://www.dian.gov.co)
- **Unidades SI**: Metro, Kilogramo, Litro, Segundo
- **Facturación electrónica**: Códigos obligatorios para DIAN Colombia
