# Qwen2.5-1.5B Local LLM Setup (POS Command Engine)

## Objetivo
Ejecutar `Qwen2.5-1.5B` como LLM local para comandos de venta y reducir costo cloud.

La app ahora soporta dos modos:
1. `embedded` (cliente final APK: modelo dentro del dispositivo)
2. `endpoint` (desarrollo: app llama un server local con Ollama)

Tambien existe `auto` (default): intenta `embedded` y si falla prueba `endpoint`.

## Variables de entorno de la app

```env
EXPO_PUBLIC_LOCAL_LLM_MODE=auto
EXPO_PUBLIC_LOCAL_LLM_TIMEOUT_MS=2600

# Solo para endpoint mode
EXPO_PUBLIC_LOCAL_LLM_PARSER_URL=http://<HOST>:8080/parse-sale-command

# Solo para embedded mode (descarga del modelo en dispositivo)
EXPO_PUBLIC_EMBEDDED_LLM_MODEL_URL=https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf?download=true
EXPO_PUBLIC_EMBEDDED_LLM_MODEL_FILENAME=Qwen2.5-1.5B-Instruct-Q4_K_M.gguf
EXPO_PUBLIC_EMBEDDED_LLM_CONTEXT_SIZE=2048
```

## A) Modo embedded (recomendado para cliente APK)

### Como funciona
- Primer uso: app descarga el modelo GGUF al almacenamiento local del dispositivo.
- Siguientes usos: usa el archivo local (sin servidor externo).
- Si el dispositivo no soporta el runtime/modelo, el engine puede caer a cloud fallback.

### Requisitos
- Build nativo (`expo run:*` o EAS build), no Expo Go.
- New Architecture habilitada (`app.json -> expo.newArchEnabled: true`).
- Dependencias nativas instaladas:
  - `llama.rn`
  - `expo-file-system`

### Nota operativa
La primera descarga puede tardar varios minutos segun red/equipo.

## B) Modo endpoint (dev/local)

### 1) Preparar Ollama
```bash
ollama pull qwen2.5:1.5b
ollama serve
```

### 2) Levantar adapter del repo
```bash
npm run local-llm:qwen
```

Expone:
- `POST /parse-sale-command`
- `GET /health`

Variables opcionales del adapter:
- `LOCAL_LLM_PORT` (default: `8080`)
- `LOCAL_LLM_HOST` (default: `0.0.0.0`)
- `OLLAMA_URL` (default: `http://127.0.0.1:11434`)
- `OLLAMA_MODEL` (default: `qwen2.5:1.5b`)
- `LOCAL_LLM_REQUEST_TIMEOUT_MS` (default: `4000`)

### 3) Host sugerido para la app
- Android Emulator: `http://10.0.2.2:8080/parse-sale-command`
- iOS Simulator: `http://127.0.0.1:8080/parse-sale-command`
- Dispositivo fisico: `http://<IP_LAN_PC>:8080/parse-sale-command`

## Validacion rapida del adapter

Health:
```bash
curl http://127.0.0.1:8080/health
```

Parser:
```bash
curl -X POST http://127.0.0.1:8080/parse-sale-command \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id":"demo-tenant",
    "input_type":"text",
    "text":"para Ana 2 cocas 350 y 1 arroz diana 500g"
  }'
```

## Flujo final del engine
`cache -> parser deterministico -> local_llm (embedded/endpoint) -> DeepSeek fallback`

## Troubleshooting
- `llama.rn no disponible`: build nativo faltante o dependencia no instalada.
- `Modelo embebido no disponible`: fallo en descarga GGUF (red/espacio).
- `Timeout`: subir `EXPO_PUBLIC_LOCAL_LLM_TIMEOUT_MS` o usar cuantizacion mas ligera.
- Endpoint no responde en fisico: revisar IP LAN y firewall del PC.
