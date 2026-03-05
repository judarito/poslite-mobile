# Chat a Venta (IA) - Setup e Integración

## Objetivo
Convertir texto libre de chat (WhatsApp, DM, notas) en un borrador de venta precargado en POS.

## Componentes implementados
- Edge Function: `supabase/functions/chat-order-parser/index.ts`
- Servicio app: `src/services/chatOrderAgent.service.js`
- Integración POS: `src/screens/PointOfSaleScreen.js`
- Cache DB: `migrations/ADD_CHAT_ORDER_AI_CACHE.sql`

## Flujo funcional
1. Usuario pega un pedido en texto libre en POS.
2. App invoca la Edge Function `chat-order-parser`.
3. IA devuelve JSON estructurado (`order` + `line_items`).
4. POS hace matching contra catálogo local/remoto.
5. Se precargan líneas al carrito.
6. Se sugiere cliente y nota si la IA los detecta.

## Requisitos
- Proyecto Supabase activo.
- Secret `DEEPSEEK_API_KEY` configurado.
- Usuario autenticado en app (Bearer token válido).

## Deploy Edge Function
```bash
supabase functions deploy chat-order-parser --project-ref mcufhthejdwonndvpmev
```

## Ejecutar migración de cache
Ejecuta:
- `migrations/ADD_CHAT_ORDER_AI_CACHE.sql`

## Secrets requeridos
```bash
supabase secrets set DEEPSEEK_API_KEY=tu_api_key --project-ref mcufhthejdwonndvpmev
```

## Variables de entorno app (opcional)
Si no defines esta variable, la app usa `chat-order-parser` por defecto.

```env
EXPO_PUBLIC_CHAT_ORDER_EDGE_FUNCTION=chat-order-parser
EXPO_PUBLIC_DEEPSEEK_TEXT_MODEL=deepseek-chat
```

## Contrato de entrada (Edge Function)
```json
{
  "chat_text": "Pedido por chat...",
  "model": "deepseek-chat",
  "temperature": 0.1,
  "max_tokens": 1800
}
```

## Contrato de salida (Edge Function)
```json
{
  "order": {
    "customer_name": "Ana Perez",
    "notes": "Entrega hoy",
    "confidence": 0.86
  },
  "line_items": [
    {
      "raw_name": "coca cola 350",
      "sku": null,
      "quantity": 2,
      "unit_hint": "unidad",
      "unit_price": null
    }
  ],
  "model": "deepseek-chat",
  "usage": {}
}
```

## Uso en POS
1. Ir a `Punto de Venta`.
2. Pegar texto en campo de chat.
3. Pulsar `Convertir chat a venta (IA)`.
4. Revisar resumen:
   - `Cargados`
   - `Confianza IA`
   - `Sin match`
   - `Cliente sugerido`
5. Validar carrito y cobrar.

## Reglas y límites actuales
- Requiere conexión online (no disponible en offline).
- No confirma venta automáticamente.
- Si no hay coincidencias de catálogo, no precarga líneas.
- La IA no reemplaza reglas de negocio del POS.
- Primero consulta cache por hash de chat; si existe hit, evita llamada a IA.

## Prueba rápida
Texto de ejemplo:
```txt
Hola, para Ana:
2 cocas 350 ml
1 arroz diana 500g
entrega hoy en la tarde
```

Resultado esperado:
- 2 líneas sugeridas con match de catálogo.
- Cliente sugerido si existe coincidencia por nombre.
- Nota agregada en venta.

## Troubleshooting
- Error `Missing DEEPSEEK_API_KEY`: falta secret en Supabase.
- Error `Invalid or expired token`: sesión vencida en app.
- `La IA no devolvio items`: prompt ambiguo o respuesta no estructurada.
- Muchos `Sin match`: revisar calidad de nombres/SKU en catálogo.

## Siguiente mejora sugerida
- Modal de confirmación por línea con selección manual cuando haya múltiples posibles matches.
