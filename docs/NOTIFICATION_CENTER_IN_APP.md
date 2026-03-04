# Centro de Notificaciones In-App (MVP)

## Qué incluye
- Tabla de eventos: `notification_events`
- Inbox por usuario: `notifications`
- Preferencias por usuario/evento: `user_notification_prefs`
- RPCs:
  - `fn_emit_notification_event(...)`
  - `fn_list_my_notifications(...)`
  - `fn_mark_notification_read(...)`
  - `fn_mark_all_notifications_read()`
  - `fn_set_my_notification_pref(...)`
- Integración automática con `system_alerts` (trigger `trg_system_alerts_to_notifications`).
- Realtime habilitado para `notifications`.

## Despliegue
1. Ejecuta la migración:
```sql
-- migrations/ADD_IN_APP_NOTIFICATION_CENTER.sql
```
2. Verifica que `notifications` esté en publication `supabase_realtime`.

## Uso desde frontend
Servicio: `src/services/notifications.service.js`

### Listar inbox
```js
const result = await listMyNotifications({ limit: 30, onlyUnread: false })
```

### Conteo no leídas
```js
const result = await getUnreadNotificationsCount()
```

### Marcar una como leída
```js
await markNotificationRead(notificationId)
```

### Marcar todas
```js
await markAllNotificationsRead()
```

### Preferencias por evento
```js
await setMyNotificationPreference({
  eventType: 'system.stock',
  enabled: true,
  minSeverity: 'WARNING',
  muteUntil: null,
})
```

### Emitir una notificación manual
```js
await emitInAppNotification({
  tenantId,
  eventType: 'sales.failed',
  severity: 'CRITICAL',
  title: 'Error de venta',
  message: 'La venta no pudo sincronizarse',
  dedupeKey: `sale_failed:${tenantId}:${operationId}`,
  payload: { operationId },
  targetRole: 'CAJERO',        // opcional
  locationId: null,            // opcional (filtra por sede asignada)
  cashRegisterId: null,        // opcional (filtra por caja asignada)
})
```

### Ejemplo: solo cajeros de una sede
```js
await emitInAppNotification({
  tenantId,
  eventType: 'cash.shift.warning',
  severity: 'WARNING',
  title: 'Cierre pendiente',
  message: 'Recuerda cerrar caja al final del turno.',
  targetRole: 'CAJERO',
  locationId: selectedLocationId,
  dedupeKey: `cash_shift_warning:${tenantId}:${selectedLocationId}`,
})
```

### Realtime
```js
const channel = subscribeMyNotifications({
  tenantId,
  userId,
  onInsert: (n) => console.log('nueva', n),
  onUpdate: (n) => console.log('actualizada', n),
})

// al desmontar
await unsubscribeNotifications(channel)
```

## Nota de dedupe_key
`dedupe_key` evita spam de la misma alerta lógica dentro de una ventana de tiempo.
Ejemplo: `low_stock:{tenant}:{location}:{variant}`
