# POS Command Engine Multimodal

## Objetivo
Centralizar la interpretacion de comandos de venta para texto y voz con estrategia:

1. Offline-first
2. Parser deterministico local
3. STT local (Vosk)
4. LLM local (Qwen2.5-1.5B)
5. Cache unificada
6. Fallback cloud (DeepSeek)

## Estado implementado en mobile

- `src/services/commandEngine/commandEngine.service.js`
  - Router de inferencia por capas:
    - `cache_lookup`
    - `deterministic_parser`
    - `local_llm`
    - `cloud_llm`
- `src/services/commandEngine/deterministicParser.service.js`
  - Parser local de comandos de venta por texto.
- `src/services/commandEngine/localCache.service.js`
  - Cache unificada local por `tenant + input_type + catalog_fingerprint + text_hash`.
- `src/services/commandEngine/localLlm.service.js`
  - Router de LLM local por modo: `embedded | endpoint | auto`.
- `src/services/commandEngine/embeddedModel.service.js`
  - Descarga y estado del modelo GGUF en almacenamiento local del dispositivo.
- `src/services/commandEngine/embeddedLlm.service.js`
  - Inferencia embedded on-device via `llama.rn`.
- `src/services/commandEngine/metrics.service.js`
  - Metricas persistidas por capa (`hit-rate`, latencia promedio y p95).
- `src/services/commandEngine/voskStt.service.js`
  - Integracion Vosk con captura de voz (`start/stop/cancel`, parcial/final).
- `src/screens/PointOfSaleScreen.js`
  - Flujo "Convertir chat a venta" ya usa `Command Engine`.
  - Boton "Comando por voz (Vosk)" conectado al mismo pipeline.
  - Se removio restriccion obligatoria online para este flujo.

## Actualizacion Marzo 2026 (foto + OCR + control de calidad)

### 1) Flujo de foto unificado con Command Engine

- La entrada por camara ya no termina en carga directa de items.
- Ahora el flujo es:
  - OCR (cloud-first si hay internet; native fallback)
  - texto OCR -> `runCommandToCart(...)`
  - `cache -> parser local -> llm local -> llm cloud`
- Esto unifica voz, chat e imagen en el mismo pipeline de interpretacion y matching.

Archivos:
- `src/screens/PointOfSaleScreen.js`
- `src/services/commandEngine/commandEngine.service.js`

### 2) OCR nativo y OCR cloud

- Nuevo servicio OCR nativo local-first:
  - `expo-text-extractor` (preferido)
  - `react-native-mlkit-ocr` (si existe en build)
- En POS:
  - online: OCR cloud primero, OCR nativo como fallback
  - offline: OCR nativo obligatorio
- Se mantiene resumen de OCR en Logs IA (`motor`, `chars`, `lineas`, `preview`).

Archivos:
- `src/services/commandEngine/nativeOcr.service.js`
- `src/services/commandEngine/index.js`
- `src/screens/PointOfSaleScreen.js`

### 3) Cache compartida entre voz/chat/foto

- Se introdujo `cacheInputType` en `resolveSaleCommandFromText`.
- POS usa `cacheInputType: 'text'` para reutilizar cache entre tipos de entrada.
- Un comando OCR de imagen puede resolver por cache generado desde voz/chat (y viceversa).

Archivo:
- `src/services/commandEngine/commandEngine.service.js`

### 4) Metricas por fuente final (lo que realmente resolvio)

- Se agrego bloque `resolution` en metricas:
  - `sources`: `local_cache`, `deterministic_parser`, `local_llm`, `cloud_llm`
  - `input_types`
  - `cache_cross_input_hits`
- En UI (Logs IA) se muestran conteos y porcentaje por fuente:
  - Uso cache
  - Uso parser local
  - Uso LLM local
  - Uso LLM cloud

Archivos:
- `src/services/commandEngine/metrics.service.js`
- `src/services/commandEngine/commandEngine.service.js`
- `src/screens/PointOfSaleScreen.js`

### 5) Control anti-falsos positivos (caso OCR ruidoso)

- Matching con threshold configurable:
  - `matchInvoiceLinesToCatalog(..., { minTokenConfidence })`
- Para imagen se endurece matching por tokens (evita aceptar ruido OCR como producto valido).
- Si la calidad de matching en imagen es baja:
  - no se acepta resultado temprano de parser
  - fuerza fallback a LLM local/cloud antes de cargar
  - si sigue incierto, evita cargar productos automaticamente

Archivos:
- `src/services/invoiceAgent.service.js`
- `src/screens/PointOfSaleScreen.js`

### 6) Regla de talla estricta

- Si el texto solicita talla y existe familia con tallas, pero no hay solape exacto, retorna `no match` (no cruza a otra talla).

Archivo:
- `src/services/invoiceAgent.service.js`

## Variables de entorno nuevas

- `EXPO_PUBLIC_LOCAL_LLM_PARSER_URL` (opcional)
- `EXPO_PUBLIC_LOCAL_LLM_MODE` (`embedded|endpoint|auto`)
- `EXPO_PUBLIC_LOCAL_LLM_TIMEOUT_MS` (opcional)
- `EXPO_PUBLIC_COMMAND_CACHE_TTL_HOURS` (opcional)
- `EXPO_PUBLIC_EMBEDDED_LLM_MODEL_URL` (opcional)
- `EXPO_PUBLIC_EMBEDDED_LLM_MODEL_FILENAME` (opcional)
- `EXPO_PUBLIC_EMBEDDED_LLM_CONTEXT_SIZE` (opcional)

Ejemplo recomendado:

```env
EXPO_PUBLIC_LOCAL_LLM_MODE=auto
EXPO_PUBLIC_LOCAL_LLM_TIMEOUT_MS=2600
EXPO_PUBLIC_LOCAL_LLM_PARSER_URL=http://127.0.0.1:8080/parse-sale-command
```

Implementacion local disponible en repo para Qwen2.5-1.5B:

```bash
npm run local-llm:qwen
```

Referencia completa:
- `/docs/QWEN_LOCAL_LLM_SETUP.md`

Contrato esperado del endpoint local:

```json
{
  "order": {
    "customer_name": "string|null",
    "notes": "string|null",
    "confidence": 0.0
  },
  "line_items": [
    {
      "raw_name": "string",
      "sku": "string|null",
      "quantity": 1,
      "unit_hint": "string|null",
      "unit_price": null
    }
  ],
  "model": "qwen2.5:1.5b",
  "usage": {}
}
```

## Siguientes pasos recomendados

1. Agregar switch por entorno para politica OCR (`cloud-first`, `native-first`, `auto`).
2. Incorporar preprocesado de imagen para factura manuscrita (deskew/contrast/binarizacion).
3. Afinar thresholds de matching OCR por tenant/categoria (moda, ferreteria, etc).
4. Exponer dashboard de metricas de `resolution.sources` para soporte operativo.
