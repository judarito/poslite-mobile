# Configurar Edge Function `deepseek-ocr-proxy` (OCR server-side + DeepSeek)

## 1) Requisitos
- Supabase CLI instalada y autenticada.
- Proyecto Supabase vinculado.

## 2) Crear secreto en Supabase
Ejecuta en la raíz del proyecto:

```bash
supabase secrets set DEEPSEEK_API_KEY=tu_api_key_real
```

## 3) Desplegar la función
```bash
supabase functions deploy deepseek-ocr-proxy
```

## 4) Verificar local (opcional)
```bash
supabase functions serve deepseek-ocr-proxy --env-file ./supabase/.env.local
```

En `supabase/.env.local` agrega:

```env
DEEPSEEK_API_KEY=tu_api_key_real
OCR_SPACE_API_KEY=tu_api_key_ocr_space
```

## 5) Invocación desde frontend
La app móvil invoca:

```js
supabase.functions.invoke('deepseek-ocr-proxy', {
  body: { image, mime_type, prompt, model, temperature, max_tokens },
})
```

No uses API key en frontend.

## 6) Variable opcional en app móvil
Si quieres cambiar el nombre de la función sin tocar código:

```env
EXPO_PUBLIC_DEEPSEEK_OCR_EDGE_FUNCTION=deepseek-ocr-proxy
```

## 7) Permisos de acceso
- La función valida `Authorization` y requiere token de sesión.
- Si no hay token válido, responde `401`.
