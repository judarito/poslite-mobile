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

1. Integrar bundle de modelo Vosk (es-CO/es-ES) en build nativo.
2. Afinar thresholds de parser local y aliases de catalogo por tenant.
3. Afinar cuantizacion/tamano de Qwen para gamas bajas de dispositivos.
4. Exponer dashboard de metricas del engine para soporte operativo.
