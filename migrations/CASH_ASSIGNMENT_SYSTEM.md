# Sistema de Asignación de Cajeros a Cajas

## Descripción General

Este sistema implementa un flujo seguro donde:
1. **Admin asigna cajas a cajeros** (el cajero NO se auto-asigna)
2. **Un cajero solo puede tener 1 sesión OPEN a la vez**
3. **Una caja solo puede tener 1 sesión OPEN a la vez**
4. **Todas las operaciones validan que el cajero sea dueño de la sesión**

## Arquitectura Backend

### Tablas y Restricciones

```sql
-- Tabla de asignaciones
cash_register_assignments
  - assignment_id (PK)
  - tenant_id, cash_register_id, user_id (UNIQUE)
  - is_active (boolean)
  - assigned_at, assigned_by, note

-- Índices únicos para garantizar 1 sesión por usuario y 1 por caja
ux_cash_sessions_one_open_per_user (tenant_id, opened_by) WHERE status='OPEN'
ux_cash_sessions_one_open_per_register (tenant_id, cash_register_id) WHERE status='OPEN'
```

### Funciones Principales

#### fn_pos_home_context(tenant, user)
Retorna el contexto al login:
```sql
{
  open_cash_session_id: uuid | null,
  assigned_registers_count: int,
  single_cash_register_id: uuid | null  -- si solo tiene 1 caja asignada
}
```

#### sp_open_cash_session(tenant, cash_register, user, opening_amount)
- Valida que el usuario esté asignado a la caja
- Valida que no tenga otra sesión abierta
- Valida que la caja no esté en uso
- Retorna el `cash_session_id`

#### sp_close_cash_session_secure(tenant, session_id, user, counted_amount)
- Valida que el usuario sea dueño de la sesión (`opened_by = user`)
- Llama internamente a `sp_close_cash_session` existente

### Vista de Cajas Asignadas

```sql
vw_user_cash_registers
  - user_id, user_name
  - cash_register_id, cash_register_name
  - location_id, location_name
  - is_active, assigned_at, assigned_by
```

## Arquitectura Frontend

### Composable: useCashSession.js

Maneja el estado global de la sesión de caja:

```javascript
const {
  currentCashSession,        // Sesión activa del cajero
  assignedRegisters,          // Cajas asignadas al cajero
  posContext,                 // Contexto del login
  hasOpenSession,             // computed: ¿tiene sesión abierta?
  assignedCount,              // computed: cantidad de cajas asignadas
  singleRegisterId,           // computed: ID si solo tiene 1 caja
  
  loadPOSContext,             // Cargar contexto al login
  openSession,                // Abrir sesión
  closeSession,               // Cerrar sesión
  clearContext                // Limpiar (logout)
} = useCashSession()
```

### Componentes

#### CashSessionCard.vue
Componente principal que muestra:

**Caso 1: Sesión Activa**
- Card verde con información de la sesión
- Botón "Cerrar Caja" para terminar turno

**Caso 2: Sin Sesión + 1 Caja Asignada**
- Muestra directamente campo de monto de apertura
- Botón "Abrir Caja" para comenzar

**Caso 3: Sin Sesión + Múltiples Cajas**
- Dropdown para seleccionar caja
- Campo de monto de apertura
- Botón "Abrir Caja"

**Caso 4: Sin Cajas Asignadas**
- Alert informando que debe contactar a Admin

#### CashRegisterAssignments.vue (Admin)
Vista de administración:
- Tabla de todas las asignaciones
- Filtros por cajero, sede, estado
- Botón "Asignar Caja" que abre dialog
- Acciones: activar/desactivar asignaciones

## Flujo de Uso

### 1. Admin Asigna Cajas

```javascript
// Admin → CashRegisterAssignments.vue
await cashAssignmentService.assignCashRegisterToUser(
  tenantId,
  cashRegisterId,
  userId,
  adminUserId,
  true,  // is_active
  'Asignación inicial'
)
```

Esto ejecuta `sp_assign_cash_register_to_user` que inserta/actualiza en `cash_register_assignments`.

### 2. Cajero Login → Home

```javascript
// Home.vue → CashSessionCard.vue
onMounted(async () => {
  await loadPOSContext()  // Llama fn_pos_home_context
})
```

**Respuesta:**
```json
{
  "open_cash_session_id": "uuid-123",  // Si ya tiene sesión
  "assigned_registers_count": 2,        // Cantidad de cajas
  "single_cash_register_id": null       // null si tiene >1
}
```

**UI según respuesta:**
- Si `open_cash_session_id` existe → Muestra sesión activa + botón cerrar
- Si `assigned_registers_count = 1` → Muestra campo apertura directo
- Si `assigned_registers_count > 1` → Muestra dropdown de cajas
- Si `assigned_registers_count = 0` → Muestra alert "Sin cajas asignadas"

### 3. Abrir Caja

```javascript
// CashSessionCard.vue
const handleOpenSession = async () => {
  const r = await openSession(cashRegisterId, openingAmount)
  if (r.success) {
    router.push('/pos')  // Redirige al POS
  }
}
```

Ejecuta `sp_open_cash_session` que:
1. Valida asignación con `fn_user_can_use_cash_register`
2. Valida unicidad (indices únicos)
3. Inserta en `cash_sessions`
4. Retorna `cash_session_id`

### 4. Operaciones (Venta/Abono/Gasto)

Todas las operaciones usan `currentCashSession.cash_session_id`:

```javascript
// PointOfSale.vue
await salesService.createSale({
  cashSessionId: currentCashSession.value.cash_session_id,
  // ... resto de datos
})

// LayawayDetail.vue
await layawayService.addPayment({
  cashSessionId: currentCashSession.value.cash_session_id,
  // ... resto de datos
})
```

**Backend valida** (recomendado agregar a SPs existentes):
```sql
perform 1 from cash_sessions cs
where cs.tenant_id = p_tenant
  and cs.cash_session_id = p_cash_session
  and cs.status = 'OPEN'
  and cs.opened_by = p_user;  -- Valida que sea el dueño

if not found then raise exception 'Invalid session or not owned by user'; end if;
```

### 5. Cerrar Caja

```javascript
// CashSessionCard.vue
const handleCloseSession = async () => {
  const r = await closeSession(countedAmount)
  if (r.success) {
    router.push('/cash-sessions')  // Ver historial
  }
}
```

Ejecuta `sp_close_cash_session_secure` que:
1. Valida que `cs.opened_by = p_closed_by`
2. Llama a `sp_close_cash_session` (lógica de cierre existente)
3. Actualiza status a 'CLOSED'

## Seguridad

### Nivel 1: UI
- Componentes solo muestran cajas asignadas
- Botones deshabilitados si no cumple condiciones
- Permisos validados con `usePermissions()`

### Nivel 2: Servicio
- `cashAssignmentService` usa RPC de Supabase
- Solo llama funciones específicas del usuario

### Nivel 3: Base de Datos
- **RLS (Row Level Security)** en todas las tablas
- **Índices únicos** garantizan 1 sesión por usuario/caja
- **Stored procedures** validan asignación y propiedad
- **Foreign keys** previenen datos inconsistentes

## Permisos Requeridos

### Cajero
- `CASH.SESSION.OPEN` - Abrir sesión
- `CASH.SESSION.CLOSE` - Cerrar sesión
- `CASH.VIEW` - Ver información de caja
- `SALES.CREATE`, `PAYMENTS.APPLY`, etc. (operativos)

### Admin
- `CASH.ASSIGN` - Asignar cajas a cajeros
- `SECURITY.USERS.MANAGE` - Gestionar usuarios
- `CASH.REGISTER.MANAGE` - Gestionar cajas registradoras

## Migraciones

### Orden de ejecución:

```sql
-- 1. Ejecutar SpVistasFN.sql (incluye sección 8: asignaciones)
\i migrations/SpVistasFN.sql

-- 2. Agregar permiso CASH.ASSIGN
\i migrations/InitPermissions.sql

-- 3. Inicializar roles (si ya existe tenant)
SELECT fn_init_tenant_roles('tu-tenant-uuid');
```

## Casos de Uso

### Caso 1: Cajero con 1 caja asignada
1. Login → Ve card "Abrir Caja" con monto de apertura
2. Ingresa $50,000
3. Click "Abrir Caja"
4. Redirige a /pos
5. Opera durante el día
6. Click "Cerrar Caja"
7. Ingresa efectivo contado
8. Sistema calcula diferencia

### Caso 2: Cajero con múltiples cajas
1. Login → Ve dropdown con sus cajas
2. Selecciona "Caja Principal - Sede Centro"
3. Ingresa monto apertura
4. Click "Abrir Caja"
5. Continúa como caso 1

### Caso 3: Admin asigna caja
1. Admin → Menú "Asignación de Cajas"
2. Click "Asignar Caja"
3. Selecciona cajero: "Juan Pérez"
4. Selecciona caja: "Caja 2 - Sede Norte"
5. Nota: "Asignación temporal"
6. Click "Asignar"
7. Cajero puede usar esa caja en su próximo turno

### Caso 4: Cajero intenta abrir caja no asignada
1. Intenta modificar request a caja no asignada
2. Backend rechaza: `sp_open_cash_session` valida con `fn_user_can_use_cash_register`
3. Error: "User is not assigned to this cash register"

### Caso 5: Intento de 2 sesiones simultáneas
1. Cajero tiene sesión abierta en Caja 1
2. Intenta abrir Caja 2
3. DB rechaza por índice único `ux_cash_sessions_one_open_per_user`
4. Frontend muestra: "Ya tienes una sesión activa"

## Troubleshooting

### Error: "User is not assigned to this cash register"
**Solución:** Admin debe asignar la caja en `/cash-assignments`

### Error: "Cash session not found/OPEN or not owned by user"
**Solución:** El cajero intentó cerrar sesión de otro usuario. Validar `currentCashSession`.

### Cajero no ve cajas asignadas
**Verificar:**
```sql
SELECT * FROM vw_user_cash_registers 
WHERE tenant_id = '...' AND user_id = '...' AND is_active = true;
```

### No puede abrir segunda caja
**Esperado:** El sistema solo permite 1 sesión activa. Debe cerrar la primera.

## Mejoras Futuras

1. **Notificaciones:** Alert cuando sesión lleva >8 horas abierta
2. **Dashboard Admin:** Ver todas las sesiones abiertas en tiempo real
3. **Historial:** Reporte de rotación de cajas por cajero
4. **Auto-cierre:** Job nocturno que sugiere cerrar sesiones antiguas
5. **Multi-sede:** Validar que cajero solo opere en su sede asignada
