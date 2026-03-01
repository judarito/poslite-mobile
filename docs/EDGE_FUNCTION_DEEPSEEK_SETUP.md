# Configurar Edge Function `deepseek-proxy` (Supabase)

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
supabase functions deploy deepseek-proxy
```

## 4) Verificar local (opcional)
```bash
supabase functions serve deepseek-proxy --env-file ./supabase/.env.local
```

En `supabase/.env.local` agrega:

```env
DEEPSEEK_API_KEY=tu_api_key_real
```

## 5) Invocación desde frontend
La app invoca:

```js
supabase.functions.invoke('deepseek-proxy', { body: { messages, model, temperature, max_tokens } })
```

No uses `VITE_DEEPSEEK_API_KEY` en frontend.

## 6) Permisos de acceso
- La función valida `Authorization` y requiere usuario autenticado.
- Si no hay token válido, responde `401`.
