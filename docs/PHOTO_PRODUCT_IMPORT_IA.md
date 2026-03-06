# Carga De Productos Por Foto (IA)

## Objetivo
Permitir cargar productos desde una foto de una hoja escrita, usando OCR + IA, con previsualizacion editable antes de importar a catalogo.

## Flujo Funcional
1. Usuario abre `Carga Masiva`.
2. Toca boton `IA` para desplegar herramientas de foto.
3. Toma foto o selecciona imagen de galeria.
4. La app comprime la imagen (objetivo <= 1MB para OCR.Space).
5. Se invoca Edge Function `product-photo-parser`.
6. La IA devuelve filas estructuradas.
7. Usuario revisa/edita filas en modal.
8. Usuario confirma importacion.
9. Se crean/actualizan productos y variante predeterminada.
10. Si aplica, se registra stock inicial por ubicacion.

## Componentes Implementados
- Edge Function:
  - `supabase/functions/product-photo-parser/index.ts`
- Servicio mobile:
  - `src/services/productPhotoImport.service.js`
- UI mobile:
  - `src/screens/BulkImportsScreen.js`

## Requisitos De Entorno
### Supabase (Edge Secrets)
- `DEEPSEEK_API_KEY`
- `OCR_SPACE_API_KEY`

### Mobile (.env)
- `EXPO_PUBLIC_PRODUCT_PHOTO_PARSER_EDGE_FUNCTION=product-photo-parser`
- Opcional:
  - `EXPO_PUBLIC_DEEPSEEK_TEXT_MODEL=deepseek-chat`

## Deploy De Edge Function
```bash
supabase functions deploy product-photo-parser
```

## Formato Recomendado De Hoja Para Foto
Usar una linea por producto, idealmente:

`Nombre | Precio venta | Costo | Stock`

Ejemplo:
```text
Camiseta blanca talla M | 45000 | 28000 | 20
Camiseta blanca talla L | 45000 | 28000 | 15
Jean slim azul 32 | 99000 | 62000 | 8
```

## Validaciones En Importacion
- Minimo por fila para importar:
  - `product_name` no vacio
  - `unit_price` numerico y > 0
- Defaults configurables en UI:
  - `unit_code` (ej: `UND`)
  - `location_code` (opcional)
  - `category_name` (opcional)

## Reglas De Upsert
- Producto:
  - Busca por `name` (case-insensitive) en el tenant.
  - Si existe: actualiza.
  - Si no existe: crea.
- Variante:
  - Busca por `variant_name` en el producto.
  - Si no encuentra, usa la primera variante del producto.
  - Si no existe ninguna, crea variante con SKU generado.
- Stock inicial:
  - Solo si `initial_stock > 0` y `location_code` informado.
  - Resuelve ubicacion por nombre activo.
  - Inserta `inventory_moves` + ejecuta `fn_apply_stock_delta`.

## Errores Y Advertencias
- Errores de fila se muestran en resumen al final.
- Advertencias comunes:
  - Ubicacion no encontrada para stock inicial.
- La importacion puede ser parcial:
  - algunas filas exitosas y otras fallidas.

## UI (Homogeneidad Con Ventas)
- El bloque IA en `BulkImportsScreen` se muestra/oculta con boton `IA`.
- Usa el mismo patron visual de icono que POS:
  - cerrado: `sparkles-outline`
  - abierto: `sparkles`

## Notas Operativas
- Buena iluminacion y foto centrada mejoran OCR.
- Evitar fondos y texto extra alrededor de la lista.
- Revisar siempre la previsualizacion antes de importar.
