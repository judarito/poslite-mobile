# Generador Automático de SKU

## Descripción

El sistema incluye un generador automático de SKUs únicos para las variantes de productos. El SKU se genera basándose en tres componentes principales:
1. **Categoría del producto**
2. **Nombre del producto**
3. **Nombre de la variante**

## Uso

### En el módulo de Productos

1. Al crear o editar un producto, haz clic en "Agregar variante"
2. En el formulario de variante, verás el campo SKU con un botón **"Generar"**
3. Completa primero:
   - El nombre del producto (requerido)
   - La categoría (opcional pero recomendado)
   - El nombre de la variante (opcional)
4. Haz clic en el botón **"Generar"** para crear automáticamente un SKU único

## Formato del SKU

### Formato Completo
```
CCCCC-PPPPPPPP-VVVVV-XXXX
```

Donde:
- **CCCCC**: Hasta 5 caracteres de la categoría
- **PPPPPPPP**: Hasta 8 caracteres del nombre del producto
- **VVVVV**: Hasta 5 caracteres del nombre de la variante
- **XXXX**: Sufijo aleatorio de 4 caracteres para garantizar unicidad

### Ejemplos

#### Ejemplo 1: Producto completo
- Categoría: `Camisetas`
- Producto: `Camiseta Polo Manga Corta`
- Variante: `Azul M`

**SKU generado**: `CAMISETAS-CAMISPOLOCORTA-AZULM-A3K9`

#### Ejemplo 2: Sin categoría
- Categoría: *(vacío)*
- Producto: `Mouse Gamer RGB`
- Variante: `Negro`

**SKU generado**: `MOUSEGAM-NEGRO-B7R2`

#### Ejemplo 3: Sin variante
- Categoría: `Electrónicos`
- Producto: `Cable HDMI`
- Variante: *(vacío)*

**SKU generado**: `ELECT-CABLEH-M9P4`

## Características

### Normalización Automática
El generador automáticamente:
- Convierte todo a mayúsculas
- Elimina acentos y caracteres especiales
- Elimina espacios
- Mantiene solo letras y números

**Ejemplos de normalización:**
- `Ñoño` → `NONO`
- `Café Molido` → `CAFEMOLIDO`
- `100% Algodón` → `100ALGODON`

### Unicidad Garantizada
- Cada SKU incluye un sufijo aleatorio de 4 caracteres
- La combinación hace virtualmente imposible generar SKUs duplicados
- Si el SKU ya existe, puedes regenerarlo haciendo clic nuevamente en "Generar"

### Validación
El sistema valida que:
- El SKU no esté vacío
- El SKU sea único dentro del tenant
- El formato sea correcto (solo alfanuméricos y guiones)

## API del Generador

El archivo `src/utils/skuGenerator.js` exporta las siguientes funciones:

### `generateSKU(productName, categoryName, variantName)`
Genera un SKU completo usando todos los componentes.

```javascript
import { generateSKU } from '@/utils/skuGenerator'

const sku = generateSKU('Mouse Gamer', 'Electrónicos', 'RGB')
// Resultado: ELECT-MOUSEGAM-RGB-X7K2
```

### `generateShortSKU(productName, variantName)`
Genera un SKU más corto omitiendo la categoría.

```javascript
import { generateShortSKU } from '@/utils/skuGenerator'

const sku = generateShortSKU('Teclado', 'Mecánico')
// Resultado: TEC-MEC-P5M
```

### `isValidSKU(sku)`
Valida el formato de un SKU.

```javascript
import { isValidSKU } from '@/utils/skuGenerator'

isValidSKU('PROD-VAR-123')  // true
isValidSKU('invalid sku')    // false
isValidSKU('')               // false
```

### `generateNumericSKU()`
Genera un SKU numérico simple basado en timestamp.

```javascript
import { generateNumericSKU } from '@/utils/skuGenerator'

const sku = generateNumericSKU()
// Resultado: 12345678-234
```

## Buenas Prácticas

### ✅ Recomendado
- Usar categorías descriptivas para mejor organización
- Mantener nombres de productos claros y concisos
- Usar nombres de variantes descriptivos (color, talla, etc.)
- Regenerar el SKU si no te gusta el resultado

### ❌ Evitar
- Nombres de productos demasiado largos (serán truncados)
- Caracteres especiales innecesarios
- SKUs manuales sin estructura (dificulta búsquedas)

## Edición Manual

Si prefieres, siempre puedes:
- Escribir un SKU manualmente en lugar de generarlo
- Modificar un SKU generado antes de guardar
- Usar tu propio sistema de nomenclatura

El botón "Generar" es opcional y está ahí para facilitarte el trabajo.

## Restricciones de Base de Datos

El SKU debe ser:
- Único por tenant (no pueden existir 2 SKUs iguales en tu tienda)
- No nulo (campo requerido)
- Tipo texto (sin límite práctico de longitud)

## Migración de Datos Existentes

Si ya tienes productos con SKUs manuales:
- No hay problema, el sistema respeta los SKUs existentes
- Puedes editar cada variante y regenerar el SKU si lo deseas
- Los nuevos productos pueden usar el generador automático

## Soporte

Si necesitas personalizar el formato del SKU:
1. Edita el archivo `src/utils/skuGenerator.js`
2. Modifica la función `generateSKU` según tus necesidades
3. Ajusta las longitudes máximas de cada segmento
4. Cambia el separador (`-`) si lo prefieres
