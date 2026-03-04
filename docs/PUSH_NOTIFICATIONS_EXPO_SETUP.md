# Push Notifications (Expo + Supabase)

## Qué incluye
- Registro de token push en app móvil (`expo-notifications`).
- Persistencia de dispositivos: `user_push_devices`.
- Cola de envíos push: `notification_push_queue`.
- Trigger que encola push al crear una notificación in-app.
- Edge Function `push-dispatcher` para enviar a Expo Push API.

## Archivos
- `migrations/ADD_PUSH_NOTIFICATIONS_EXPO.sql`
- `src/services/pushNotifications.service.js`
- `supabase/functions/push-dispatcher/index.ts`
- `App.js`

## 1) Ejecutar migración SQL
Ejecuta:
- `migrations/ADD_PUSH_NOTIFICATIONS_EXPO.sql`

## 2) Desplegar function
```bash
supabase functions deploy push-dispatcher --project-ref mcufhthejdwonndvpmev
```

## 3) Secrets requeridos
```bash
supabase secrets set PUSH_DISPATCHER_SECRET=tu_secret_seguro --project-ref mcufhthejdwonndvpmev
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key --project-ref mcufhthejdwonndvpmev
```

Opcional (si usas token de acceso de Expo push API):
```bash
supabase secrets set EXPO_ACCESS_TOKEN=tu_expo_access_token --project-ref mcufhthejdwonndvpmev
```

## 4) Disparar dispatcher manualmente
```bash
curl -X POST \
  "https://mcufhthejdwonndvpmev.supabase.co/functions/v1/push-dispatcher" \
  -H "Authorization: Bearer TU_PUSH_DISPATCHER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"limit":50}'
```

## 5) Recomendación operativa
- Ejecutar `push-dispatcher` cada 1-2 minutos desde un cron externo (GitHub Actions, cron server, etc.).
- El dispatcher reintenta con backoff y marca `FAILED` al agotar intentos.

## 6) Build móvil
Instala dependencias y recompila:
```bash
npm install
npx expo run:android
# o
npx expo run:ios
```

Para Expo Go, la recepción push tiene limitaciones; para producción usa build EAS/dev-client.
