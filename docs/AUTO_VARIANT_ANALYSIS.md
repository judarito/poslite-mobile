# 📋 ANÁLISIS: Auto-generación de Variante Única

## 📊 Resumen Ejecutivo

**Objetivo**: Simplificar la creación de productos eliminando la necesidad de agregar manualmente una variante cuando el producto no tiene variaciones (talla, color, etc.).

**Solución propuesta**: Generar automáticamente una variante "ÚNICA" o predeterminada al crear un producto, permitiendo que el usuario comience a trabajar inmediatamente sin pasos adicionales.

---

## 🔍 Análisis del Sistema Actual

### Estado Actual
```
Usuario crea producto → Producto SIN variantes → Usuario debe:
  1. Agregar variante manualmente
  2. Llenar formulario (SKU, nombre, costo, precio)
  3. Guardar variante
  4. Solo entonces puede: vender, ajustar inventario, etc.
```

**Problema**: Para productos simples (sin tallas, colores, etc.), este proceso es innecesariamente complejo.

### Arquitectura Actual

```sql
products (tabla padre)
├── product_id (UUID)
├── name
├── description
├── category_id
├── unit_id
├── inventory_behavior
└── ...

product_variants (tabla hija) ⚠️ OBLIGATORIA para operaciones
├── variant_id (UUID)
├── product_id (FK → products)
├── sku (UNIQUE, NOT NULL)
├── variant_name (nullable)
├── cost, price
├── min_stock, allow_backorder
└── ...
```

**Dependencias críticas**:
- 🔴 **Ventas**: Se registran por `variant_id`, NO por `product_id`
- 🔴 **Inventario**: Stock se maneja por `variant_id`
- 🔴 **Compras**: Se compran por `variant_id`
- 🔴 **Lotes/Vencimientos**: Se asocian a `variant_id`
- 🔴 **Precios**: Se definen en la variante
- 🔴 **BOMs**: Componentes usan `variant_id`

**Conclusión**: Un producto SIN variantes es **inútil** en el sistema actual.

---

## 💡 Solución Propuesta

### Opción 1: Auto-generación en CREATE (Recomendada)

**Cuándo**: Al crear un nuevo producto, generar automáticamente 1 variante predeterminada.

**Ventajas**:
- ✅ UX simple: Crear producto → Listo para usar
- ✅ No requiere migración de datos existentes
- ✅ Usuario puede personalizar después si lo necesita
- ✅ Compatible con productos multi-variante (pueden agregar más)

**Desventajas**:
- ⚠️ Usuario debe proporcionar datos básicos (SKU, costo, precio) al crear producto
- ⚠️ Formulario de creación más largo

### Opción 2: Auto-generación LAZY (Al primer uso)

**Cuándo**: Crear variante automáticamente cuando:
- Usuario intenta vender el producto
- Usuario intenta ajustar inventario
- Usuario carga el formulario de edición

**Ventajas**:
- ✅ Formulario inicial simple
- ✅ Migración automática de productos legacy

**Desventajas**:
- ❌ Lógica compleja y distribuida
- ❌ Puede fallar en operaciones críticas (ventas)
- ❌ Difícil debugging

### Opción 3: Variante Opcional (Cambio arquitectónico)

**Descripción**: Permitir operaciones directamente con `product_id` cuando no hay variantes.

**Ventajas**:
- ✅ Flexibilidad máxima

**Desventajas**:
- ❌ Requiere reescribir TODAS las tablas y stored procedures
- ❌ Alto riesgo de bugs
- ❌ Pérdida de consistencia de datos
- ❌ No recomendable

---

## ✅ Decisión: Opción 1 - Auto-generación en CREATE

Generar automáticamente una variante predeterminada al crear productos.

---

## 📋 Plan de Implementación

### Fase 1: Backend - Stored Procedure (PostgreSQL)

**Archivo**: `migrations/CREATE_AUTO_DEFAULT_VARIANT.sql`

```sql
-- Función para generar variante predeterminada
CREATE OR REPLACE FUNCTION fn_create_default_variant(
  p_tenant_id UUID,
  p_product_id UUID,
  p_product_name TEXT,
  p_base_cost NUMERIC DEFAULT 0,
  p_base_price NUMERIC DEFAULT 0,
  p_unit_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_variant_id UUID;
  v_sku TEXT;
  v_counter INTEGER;
BEGIN
  -- Generar SKU único (intentar hasta 100 veces)
  v_counter := 0;
  LOOP
    -- Generar SKU: Primeras 3 letras del producto + timestamp corto + random
    v_sku := UPPER(SUBSTRING(REGEXP_REPLACE(p_product_name, '[^A-Za-z0-9]', '', 'g') FROM 1 FOR 3)) 
             || '-' 
             || TO_CHAR(NOW(), 'YYMMDD')
             || '-'
             || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
    
    -- Verificar si existe
    IF NOT EXISTS (
      SELECT 1 FROM product_variants 
      WHERE tenant_id = p_tenant_id AND sku = v_sku
    ) THEN
      EXIT;
    END IF;
    
    v_counter := v_counter + 1;
    IF v_counter > 100 THEN
      RAISE EXCEPTION 'No se pudo generar SKU único después de 100 intentos';
    END IF;
  END LOOP;
  
  -- Insertar variante predeterminada
  INSERT INTO product_variants (
    tenant_id,
    product_id,
    sku,
    variant_name,
    cost,
    price,
    unit_id,
    is_active
  ) VALUES (
    p_tenant_id,
    p_product_id,
    v_sku,
    'Predeterminado',  -- O 'ÚNICA', 'Principal', NULL
    p_base_cost,
    p_base_price,
    p_unit_id,
    TRUE
  )
  RETURNING variant_id INTO v_variant_id;
  
  RETURN v_variant_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger para auto-generar variante al crear producto
CREATE OR REPLACE FUNCTION trg_create_default_variant()
RETURNS TRIGGER AS $$
BEGIN
  -- Solo si el producto NO tiene variantes aún
  IF NOT EXISTS (
    SELECT 1 FROM product_variants 
    WHERE product_id = NEW.product_id AND tenant_id = NEW.tenant_id
  ) THEN
    PERFORM fn_create_default_variant(
      NEW.tenant_id,
      NEW.product_id,
      NEW.name,
      0,  -- Costo inicial 0
      0,  -- Precio inicial 0
      NEW.unit_id
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Activar trigger
DROP TRIGGER IF EXISTS auto_create_default_variant ON products;
CREATE TRIGGER auto_create_default_variant
  AFTER INSERT ON products
  FOR EACH ROW
  EXECUTE FUNCTION trg_create_default_variant();
```

**Impacto**: 
- ✅ Automático para productos nuevos
- ✅ No afecta productos existentes
- ⚠️ Requiere que usuario actualice costo/precio después

---

### Fase 2: Frontend - Ajustar Formulario de Productos

**Archivo**: `src/views/Products.vue`

**Cambios necesarios**:

1. **Agregar campos básicos de variante al formulario de producto**:
```vue
<!-- Después de la unidad de medida -->
<v-divider class="my-4"></v-divider>
<div class="text-subtitle-1 font-weight-bold mb-3">
  <v-icon start color="primary">mdi-tag</v-icon>
  Información de Precio
</div>
<v-row>
  <v-col cols="12" sm="6">
    <v-text-field
      v-model.number="formData.base_cost"
      label="Costo Base"
      prepend-inner-icon="mdi-cash-minus"
      variant="outlined"
      type="number"
      hint="Costo del producto (se aplicará a la variante predeterminada)"
      persistent-hint
      :rules="[rules.positive]"
    ></v-text-field>
  </v-col>
  <v-col cols="12" sm="6">
    <v-text-field
      v-model.number="formData.base_price"
      label="Precio Base"
      prepend-inner-icon="mdi-cash-plus"
      variant="outlined"
      type="number"
      hint="Precio de venta (se aplicará a la variante predeterminada)"
      persistent-hint
      :rules="[rules.positive]"
    ></v-text-field>
  </v-col>
</v-row>
<v-alert type="info" density="compact" class="mb-4">
  Se generará automáticamente una variante predeterminada con estos datos. 
  Puedes agregar más variantes después si lo necesitas.
</v-alert>
```

2. **Actualizar formData**:
```javascript
const formData = ref({
  product_id: null,
  name: '',
  description: '',
  category_id: null,
  unit_id: null,
  base_cost: 0,      // ✅ NUEVO
  base_price: 0,     // ✅ NUEVO
  is_active: true,
  track_inventory: true,
  requires_expiration: false,
  inventory_behavior: 'RESELL',
  production_type: null,
  is_component: false,
  active_bom_id: null
})
```

3. **Actualizar método save()**:
```javascript
const save = async () => {
  const { valid } = await form.value.validate()
  if (!valid || !tenantId.value) return
  saving.value = true
  try {
    // Crear producto (trigger creará variante automáticamente)
    const productData = {
      ...formData.value,
      // El backend usará base_cost/base_price para la variante predeterminada
    }
    
    const r = isEditing.value
      ? await productsService.updateProduct(tenantId.value, formData.value.product_id, productData)
      : await productsService.createProduct(tenantId.value, productData)
      
    if (r.success) {
      showMsg(isEditing.value ? 'Producto actualizado' : 'Producto creado con variante predeterminada')
      dialog.value = false
      loadProducts({ page: 1, pageSize: 10, search: '', tenantId: tenantId.value })
    } else {
      showMsg(r.error || 'Error al guardar', 'error')
    }
  } finally { 
    saving.value = false 
  }
}
```

**Impacto**:
- ✅ UX mejorada: Un solo formulario para crear producto listo para usar
- ⚠️ Formulario ligeramente más largo (pero más útil)
- ✅ Usuario puede agregar variantes adicionales después si quiere

---

### Fase 3: Backend - Actualizar Service

**Archivo**: `src/services/products.service.js`

```javascript
async createProduct(tenantId, product) {
  try {
    const { data, error } = await supabaseService.insert(this.table, {
      tenant_id: tenantId,
      name: product.name,
      description: product.description || null,
      category_id: product.category_id || null,
      unit_id: product.unit_id || null,
      base_cost: product.base_cost || 0,           // ✅ NUEVO
      base_price: product.base_price || 0,         // ✅ NUEVO
      is_active: product.is_active !== false,
      track_inventory: product.track_inventory !== false,
      requires_expiration: product.requires_expiration || false,
      inventory_behavior: product.inventory_behavior || 'RESELL',
      production_type: product.production_type || null,
      is_component: product.is_component || false
    })
    if (error) throw error
    
    // ⚠️ IMPORTANTE: El trigger ya creó la variante
    // Opcionalmente, podemos retornar el producto con sus variantes
    const productWithVariants = await this.getProductById(tenantId, data[0].product_id)
    
    return { success: true, data: productWithVariants.data }
  } catch (error) {
    return { success: false, error: error.message }
  }
}
```

**Nota**: `base_cost` y `base_price` son campos **temporales** que solo se usan para crear la variante inicial. NO se almacenan en la tabla `products`.

---

### Fase 4: Migración de Datos Existentes (Opcional)

**Solo si hay productos SIN variantes en producción**:

```sql
-- Migración: Crear variantes predeterminadas para productos sin variantes
DO $$
DECLARE
  product_record RECORD;
  v_variant_id UUID;
BEGIN
  FOR product_record IN
    SELECT p.tenant_id, p.product_id, p.name, p.unit_id
    FROM products p
    LEFT JOIN product_variants pv ON pv.product_id = p.product_id AND pv.tenant_id = p.tenant_id
    WHERE pv.variant_id IS NULL
  LOOP
    -- Crear variante predeterminada
    SELECT fn_create_default_variant(
      product_record.tenant_id,
      product_record.product_id,
      product_record.name,
      0,
      0,
      product_record.unit_id
    ) INTO v_variant_id;
    
    RAISE NOTICE 'Variante creada para producto %: %', product_record.name, v_variant_id;
  END LOOP;
END $$;
```

---

## 📊 Impacto Estimado

### Impacto en Base de Datos
| Tabla | Cambio | Impacto |
|-------|--------|---------|
| `products` | Ninguno (campos `base_cost/base_price` son temporales en backend) | ✅ Bajo |
| `product_variants` | +1 fila por cada producto nuevo | ⚠️ Medio (crece automáticamente) |
| Triggers | +1 trigger `auto_create_default_variant` | ✅ Bajo (solo INSERT) |
| Funciones | +1 función `fn_create_default_variant` | ✅ Bajo |

### Impacto en Performance
- **Crear producto**: +10-50ms (insertar variante adicional)
- **Consultar productos**: Sin cambio
- **Ventas/Inventario**: Sin cambio

### Impacto en UX
| Antes | Después | Mejora |
|-------|---------|--------|
| 1. Crear producto<br>2. Agregar variante<br>3. Llenar formulario<br>4. Guardar variante<br>5. Ya se puede usar | 1. Crear producto (con precio/costo)<br>2. Ya se puede usar | ⭐⭐⭐⭐⭐ |

---

## 🎯 Opciones de Naming para Variante Predeterminada

1. **"Predeterminado"** (Recomendado)
   - Pro: Claro, profesional, español neutro
   - Con: Un poco largo

2. **"Principal"**
   - Pro: Corto, claro
   - Con: Implica jerarquía (¿hay secundarias?)

3. **"ÚNICA"** (Propuesta original del usuario)
   - Pro: Expresa claramente que no hay variaciones
   - Con: Si el usuario agrega más variantes, queda raro

4. **NULL (sin nombre)**
   - Pro: Simple, no ocupa espacio
   - Con: Puede verse como dato incompleto en reportes

5. **"Estándar"**
   - Pro: Neutro, profesional
   - Con: Suena genérico

**Recomendación**: Usar **"Predeterminado"** por defecto, pero hacerlo **configurable** en settings del tenant.

---

## ⚠️ Consideraciones y Riesgos

### Riesgos Técnicos

1. **SKU Duplicados**
   - Mitigación: Algoritmo con retry (hasta 100 intentos)
   - Formato: `[3 letras]-[fecha]-[random 4 dígitos]`

2. **Trigger Falla**
   - Mitigación: Try-catch en frontend, validar que producto tenga al menos 1 variante

3. **Migración de Productos Legacy**
   - Mitigación: Script de migración manual, NO automático al desplegar

### Riesgos de Negocio

1. **Usuario no entiende el concepto**
   - Mitigación: Alert explicativo en formulario + documentación

2. **Usuario quiere múltiples variantes desde el inicio**
   - Mitigación: Mantener botón "Agregar variante" disponible siempre

---

## 📅 Cronograma de Implementación

| Fase | Tarea | Tiempo Estimado |
|------|-------|-----------------|
| 1 | Crear stored procedure y trigger | 2 horas |
| 2 | Actualizar frontend (formulario + save) | 3 horas |
| 3 | Actualizar backend service | 1 hora |
| 4 | Testing unitario | 2 horas |
| 5 | Testing integración | 2 horas |
| 6 | Migración datos legacy (si aplica) | 1 hora |
| 7 | Documentación y capacitación | 1 hora |
| **TOTAL** | | **12 horas (~1.5 días)** |

---

## ✅ Checklist de Testing

- [ ] Crear producto nuevo → Verificar variante creada automáticamente
- [ ] Consultar producto creado → Verificar campos correctos (SKU, costo, precio)
- [ ] Vender producto recién creado → Verificar venta exitosa
- [ ] Ajustar inventario de variante auto-generada → Verificar stock actualizado
- [ ] Agregar segunda variante → Verificar convivencia con variante predeterminada
- [ ] Editar producto existente → Verificar NO se duplican variantes
- [ ] Eliminar producto → Verificar variante se elimina en cascada
- [ ] Crear producto sin costo/precio → Verificar variante con valores 0
- [ ] Reportes de inventario → Verificar variante aparece correctamente
- [ ] Exportar productos → Verificar formato correcto

---

## 📖 Documentación para Usuario

### ¿Qué cambió?

Antes tenías que:
1. Crear el producto
2. Agregar una variante manualmente
3. Llenar el formulario de variante

Ahora:
1. Creas el producto (con precio y costo)
2. **¡Listo!** Se genera automáticamente una variante predeterminada

### ¿Puedo tener múltiples variantes?

¡Sí! La variante predeterminada NO te impide agregar más. Funciona así:

- **Producto simple** (1 variante): La variante "Predeterminado" es suficiente
- **Producto con variaciones** (múltiples variantes): Agrega más variantes (tallas, colores) normalmente

### ¿Puedo cambiar el nombre "Predeterminado"?

Sí, edita la variante y cambia su nombre.

### ¿Qué pasa con mis productos existentes?

Los productos creados antes del cambio NO se afectan. Solo los productos NUEVOS tendrán auto-generación.

---

## 🎬 Conclusión

**Recomendación**: Implementar **Opción 1** (Auto-generación en CREATE) por:
- ✅ Simplifica UX dramáticamente
- ✅ Implementación predecible y segura
- ✅ Compatible con modelo actual
- ✅ Sin riesgos de romper funcionalidad existente

**Próximo paso**: Aprobación del equipo y arranque de Fase 1 (Backend).
