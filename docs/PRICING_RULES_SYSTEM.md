# Sistema de Políticas de Precio

## Descripción General

El sistema de **Políticas de Precio** permite configurar de manera centralizada cómo se calculan los precios de venta de los productos, similar al sistema de reglas de impuestos. En lugar de configurar el método de precio en cada variante individualmente, se definen políticas que se aplican automáticamente según una jerarquía de prioridades.

## Niveles de Alcance

Las políticas de precio pueden configurarse en 5 niveles diferentes, del más general al más específico:

1. **TENANT** (Global) - Aplica a todo el negocio
2. **LOCATION** (Sede) - Aplica a una sede específica
3. **CATEGORY** (Categoría) - Aplica a todos los productos de una categoría
4. **PRODUCT** (Producto) - Aplica a todas las variantes de un producto
5. **VARIANT** (Variante) - Aplica solo a una variante específica

### Jerarquía de Prioridades

El sistema busca la política aplicable en este orden:
```
VARIANT > PRODUCT > CATEGORY > LOCATION > TENANT > DEFAULT
```

**Ejemplo:**
- Si existe una política para la variante "iPhone 15 Pro 256GB Negro", se usa esa
- Si no existe, busca política para el producto "iPhone 15 Pro"
- Si no existe, busca política para la categoría "Electrónicos"
- Si no existe, busca política para la sede "Sucursal Centro"
- Si no existe, usa la política global del Tenant
- Si no existe ninguna, usa valores por defecto (MARKUP 20%)

## Configuración de Política

Cada política de precio incluye:

### 1. Método de Precio
- **MARKUP** (Automático): Calcula el precio sumando un porcentaje de ganancia al costo
- **FIXED** (Manual): Mantiene el precio fijado manualmente en la variante

### 2. Porcentaje de Ganancia (Markup)
- Solo aplica cuando el método es MARKUP
- Porcentaje que se suma al costo para obtener el precio de venta
- Ejemplo: Costo $100 + Markup 30% = Precio $130

### 3. Redondeo
Opciones para redondear el precio calculado:
- **NONE**: Sin redondeo
- **UP**: Redondear hacia arriba
- **DOWN**: Redondear hacia abajo
- **NEAREST**: Redondear al más cercano

### 4. Redondear a múltiplo de
Define el múltiplo al que se redondeará:
- `1`: Redondeo a unidades
- `10`: Redondeo a decenas
- `100`: Redondeo a centenas
- `1000`: Redondeo a miles

**Ejemplos de redondeo:**
| Precio Calculado | Redondeo | Múltiplo | Resultado |
|------------------|----------|----------|-----------|
| 127.50 | UP | 10 | 130 |
| 127.50 | DOWN | 10 | 120 |
| 127.50 | NEAREST | 10 | 130 |
| 127.50 | UP | 100 | 200 |
| 127.50 | NEAREST | 100 | 100 |

### 5. Prioridad
- Número entero para resolver conflictos
- Mayor número = mayor prioridad
- Útil cuando hay múltiples políticas del mismo alcance

### 6. Estado
- **Activo**: La política se aplica
- **Inactivo**: La política se ignora

## Casos de Uso

### Caso 1: Política Global
**Objetivo:** Aplicar 25% de ganancia a todos los productos

```
Alcance: TENANT
Método: MARKUP
Markup: 25%
Redondeo: NEAREST
Múltiplo: 10
```

**Resultado:** Todos los productos calculan su precio con 25% de ganancia, redondeado a la decena más cercana.

### Caso 2: Política por Categoría
**Objetivo:** Diferentes márgenes para diferentes categorías

```
Política 1:
  Alcance: CATEGORY (Electrónicos)
  Método: MARKUP
  Markup: 35%
  Redondeo: UP
  Múltiplo: 100

Política 2:
  Alcance: CATEGORY (Ropa)
  Método: MARKUP
  Markup: 50%
  Redondeo: NEAREST
  Múltiplo: 10
```

**Resultado:** 
- Productos electrónicos: 35% ganancia, redondeo a centenas hacia arriba
- Productos de ropa: 50% ganancia, redondeo a decenas al más cercano

### Caso 3: Política por Sede
**Objetivo:** Precios diferentes en diferentes sucursales

```
Política 1:
  Alcance: LOCATION (Sucursal Centro)
  Método: MARKUP
  Markup: 30%
  Redondeo: UP
  Múltiplo: 10

Política 2:
  Alcance: LOCATION (Sucursal Norte)
  Método: MARKUP
  Markup: 25%
  Redondeo: UP
  Múltiplo: 10
```

**Resultado:** La sucursal Centro vende con 30% de ganancia, la Norte con 25%.

### Caso 4: Precio Fijo para Producto Específico
**Objetivo:** Un producto debe tener precio manual, no automático

```
Alcance: PRODUCT (iPhone 15 Pro)
Método: FIXED
```

**Resultado:** Las variantes de iPhone 15 Pro mantienen su precio manual sin recalcular.

### Caso 5: Combinación de Políticas
**Objetivo:** Global 25%, pero Electrónicos 35% y iPad precio fijo

```
Política 1 (Global):
  Alcance: TENANT
  Método: MARKUP
  Markup: 25%
  Prioridad: 0

Política 2 (Categoría):
  Alcance: CATEGORY (Electrónicos)
  Método: MARKUP
  Markup: 35%
  Prioridad: 10

Política 3 (Producto):
  Alcance: PRODUCT (iPad Pro)
  Método: FIXED
  Prioridad: 20
```

**Resultado:**
- Ropa, muebles, etc.: 25% (usa política global)
- Laptops, celulares, etc.: 35% (usa política de categoría)
- iPad Pro: Precio manual (usa política de producto)

## Uso en la Aplicación

### Crear una Política

1. Ir a **Configuración > Políticas de Precio**
2. Clic en **Nueva Política**
3. Seleccionar el **Alcance** (TENANT, LOCATION, CATEGORY, PRODUCT, VARIANT)
4. Seleccionar el elemento específico si aplica (sede, categoría, producto, variante)
5. Configurar:
   - **Método**: MARKUP o FIXED
   - **Markup %**: Si es MARKUP
   - **Redondeo**: Tipo y múltiplo
   - **Prioridad**: Número mayor = más prioridad
6. Guardar

### Editar una Política

1. Buscar la política en la lista
2. Clic en el icono de edición
3. Modificar configuración (no se puede cambiar el alcance ni el elemento)
4. Guardar

### Eliminar una Política

1. Buscar la política en la lista
2. Clic en el icono de eliminación
3. Confirmar

### Filtrar Políticas

Usa los filtros en la parte superior:
- **Alcance**: Ver solo políticas de un nivel específico
- **Estado**: Ver solo activas o inactivas

## Integración con Compras

Cuando se registra una compra:
1. El sistema actualiza el costo promedio ponderado de la variante
2. Busca la política de precio aplicable
3. Si la política es MARKUP, recalcula automáticamente el precio de venta
4. Si la política es FIXED, mantiene el precio actual

**Función en Base de Datos:**
```sql
SELECT * FROM fn_get_pricing_policy(
  p_tenant := 'uuid-del-tenant',
  p_variant := 'uuid-de-la-variante',
  p_location := 'uuid-de-la-sede' -- Opcional
);
```

**Calcular Precio:**
```sql
SELECT fn_calculate_price(
  p_tenant := 'uuid-del-tenant',
  p_variant := 'uuid-de-la-variante',
  p_cost := 100.00,
  p_location := 'uuid-de-la-sede' -- Opcional
);
```

## Ventajas del Sistema

✅ **Centralizado**: Una sola configuración para múltiples productos
✅ **Flexible**: Políticas generales con excepciones específicas
✅ **Automático**: Los precios se recalculan al actualizar costos
✅ **Transparente**: Se sabe qué política aplica a cada producto
✅ **Fácil mantenimiento**: Cambiar precios de toda una categoría en un solo lugar

## Migración desde Sistema Anterior

Si ya tienes variantes con configuración de precio individual:
1. Las variantes existentes conservan su configuración actual
2. Puedes crear políticas de precio gradualmente
3. Las políticas nuevas sobrescriben la configuración individual
4. Para productos que requieren precio manual, crea una política FIXED

## Base de Datos

### Tabla: pricing_rules
```sql
- pricing_rule_id (UUID, PK)
- tenant_id (UUID, FK)
- scope (TEXT) -- TENANT | LOCATION | CATEGORY | PRODUCT | VARIANT
- location_id (UUID, FK, nullable)
- category_id (UUID, FK, nullable)
- product_id (UUID, FK, nullable)
- variant_id (UUID, FK, nullable)
- pricing_method (TEXT) -- MARKUP | FIXED
- markup_percentage (NUMERIC)
- price_rounding (TEXT) -- NONE | UP | DOWN | NEAREST
- rounding_to (NUMERIC)
- priority (INTEGER)
- is_active (BOOLEAN)
- created_at (TIMESTAMPTZ)
- updated_at (TIMESTAMPTZ)
```

### Funciones Principales
- `fn_get_pricing_policy()`: Obtiene la política aplicable
- `fn_calculate_price()`: Calcula el precio según la política

## Permisos Requeridos

Para gestionar políticas de precio se requiere:
- `SETTINGS.TAXES.MANAGE` (mismo permiso que reglas de impuestos)

## Notas Importantes

⚠️ **Las políticas FIXED requieren que el precio esté establecido en la variante**
⚠️ **Los cambios en políticas no afectan precios ya registrados en ventas anteriores**
⚠️ **Solo la compra actualiza el costo y recalcula el precio automáticamente**
⚠️ **Se puede tener solo UNA política activa por combinación de alcance y elemento**

## Soporte y Mantenimiento

Para agregar nuevas opciones de redondeo o métodos de precio, editar:
- Migración: `migrations/PricingRules.sql`
- Servicio: `src/services/pricingRules.service.js`
- Vista: `src/views/PricingRules.vue`
