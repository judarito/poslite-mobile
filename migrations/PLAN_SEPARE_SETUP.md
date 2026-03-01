# Plan Separe (Layaway) - Guía de Instalación y Uso

## Descripción General

El módulo de **Plan Separe** permite gestionar contratos de apartado/layaway con las siguientes características:

- ✅ Reserva automática de inventario al crear contrato
- ✅ Registro de abonos parciales asociados a caja
- ✅ Conversión a factura cuando el saldo es 0
- ✅ Validación de stock disponible (on_hand - reserved)
- ✅ Liberación de inventario al cancelar o expirar
- ✅ Control de permisos por rol

---

## 1. Instalación de Base de Datos

### Orden de Ejecución

Ejecutar los siguientes scripts en Supabase SQL Editor en este orden:

```sql
-- 1. Primero: Script base (si no está ejecutado)
\i migrations/InitDB.sql

-- 2. Permisos actualizados
\i migrations/InitPermissions.sql

-- 3. Funciones y vistas
\i migrations/SpVistasFN.sql

-- 4. Políticas RLS
\i migrations/RLS_Security.sql

-- 5. Plan Separe (tablas, funciones, vistas)
\i migrations/PlanSepare.sql
```

### Verificación

```sql
-- Verificar que existen las tablas
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name LIKE 'layaway%';

-- Debe retornar:
-- layaway_contracts
-- layaway_items
-- layaway_installments
-- layaway_payments
-- stock_reservations_log

-- Verificar que existe el método de pago LAYAWAY
SELECT * FROM payment_methods WHERE code = 'LAYAWAY';

-- Verificar que existen los permisos
SELECT * FROM permissions WHERE code LIKE 'LAYAWAY%';
```

---

## 2. Configuración de Permisos

### Permisos del Módulo

| Código | Descripción |
|--------|-------------|
| `LAYAWAY.CREATE` | Crear contrato plan separe |
| `LAYAWAY.VIEW` | Ver contratos plan separe |
| `LAYAWAY.PAYMENT.ADD` | Registrar abonos |
| `LAYAWAY.COMPLETE` | Completar contrato (convertir a factura) |
| `LAYAWAY.CANCEL` | Cancelar o expirar contrato |

### Inicializar Roles

Por defecto, el rol **CAJERO** tiene permisos de:
- `LAYAWAY.CREATE`
- `LAYAWAY.VIEW`
- `LAYAWAY.PAYMENT.ADD`
- `LAYAWAY.COMPLETE`

Para actualizar los permisos de un tenant:

```sql
-- Reemplazar 'tu-tenant-id' con el UUID real
SELECT fn_init_tenant_roles('tu-tenant-id');
```

---

## 3. Modelo de Datos

### Diagrama Relacional

```
layaway_contracts (contrato principal)
├── layaway_items (productos apartados)
├── layaway_payments (abonos realizados)
├── layaway_installments (cuotas pactadas - opcional)
└── stock_reservations_log (log de reservas)

stock_balances (inventario)
├── on_hand (stock físico)
├── reserved (stock reservado)
└── available = on_hand - reserved (calculado en vista)
```

### Estados del Contrato

| Estado | Descripción |
|--------|-------------|
| `ACTIVE` | Contrato activo, puede recibir abonos |
| `COMPLETED` | Pagado completamente y convertido a factura |
| `CANCELLED` | Cancelado manualmente |
| `EXPIRED` | Expirado por fecha límite |

---

## 4. Flujo de Operaciones

### 4.1 Crear Contrato

```javascript
const result = await layawayService.createLayaway(tenantId, {
  location_id: 'uuid-sede',
  customer_id: 'uuid-cliente', // OBLIGATORIO
  created_by: 'uuid-usuario',
  items: [
    {
      variant_id: 'uuid-variante',
      qty: 2,
      unit_price: 50000,
      discount: 0
    }
  ],
  due_date: '2026-03-31', // opcional
  note: 'Contrato para evento X',
  initial_payment: { // opcional
    payment_method_code: 'CASH',
    amount: 20000,
    reference: null,
    cash_session_id: 'uuid-sesion' // opcional
  },
  installments: null // opcional, no implementado en UI
})
```

**Efectos:**
- ✅ Crea contrato en estado `ACTIVE`
- ✅ Reserva inventario: `stock_balances.reserved += qty`
- ✅ Registra log en `stock_reservations_log` (acción: RESERVE)
- ✅ Si hay abono inicial, lo registra y afecta caja
- ✅ Calcula totales automáticamente

### 4.2 Registrar Abono

```javascript
const result = await layawayService.addPayment(tenantId, layawayId, {
  payment_method_code: 'CASH',
  amount: 30000,
  paid_by: 'uuid-usuario',
  cash_session_id: 'uuid-sesion', // opcional
  reference: 'Abono #2'
})
```

**Efectos:**
- ✅ Registra pago en `layaway_payments`
- ✅ Actualiza `paid_total` y `balance` del contrato
- ✅ Afecta sesión de caja si se proporciona

### 4.3 Completar Contrato (Convertir a Factura)

**Requisito:** `balance = 0`

```javascript
const result = await layawayService.completeLayaway(
  tenantId, 
  layawayId, 
  soldBy, 
  'Nota adicional'
)
```

**Efectos:**
- ✅ Crea registro en `sales` (factura)
- ✅ Copia líneas de `layaway_items` a `sale_lines`
- ✅ **Libera reserva:** `reserved -= qty`
- ✅ **Descuenta stock físico:** `on_hand -= qty`
- ✅ Registra movimiento de inventario (SALE_OUT)
- ✅ Crea pago contable con método `LAYAWAY` (sin afectar caja)
- ✅ Actualiza contrato a estado `COMPLETED`

### 4.4 Cancelar o Expirar

```javascript
const result = await layawayService.cancelLayaway(
  tenantId,
  layawayId,
  cancelledBy,
  'CANCELLED', // o 'EXPIRED'
  'Motivo de cancelación'
)
```

**Efectos:**
- ✅ Libera todo el inventario reservado
- ✅ Registra log de liberación (acción: RELEASE)
- ✅ **NO realiza reembolsos automáticos** (política de negocio)

---

## 5. Validaciones Importantes

### Stock Disponible

El sistema valida contra **stock disponible** en dos momentos:

1. **Al crear contrato:**
   ```sql
   available = on_hand - reserved
   IF available < qty THEN ERROR
   ```

2. **Al crear venta normal:**
   ```sql
   -- sp_create_sale ahora valida contra disponible
   available = on_hand - reserved
   IF available < qty THEN ERROR
   ```

### Políticas de Negocio

- ✅ Cliente es obligatorio en contratos
- ✅ No se puede completar si `balance > 0`
- ✅ No se puede cancelar un contrato `COMPLETED`
- ✅ Los abonos solo se aceptan en contratos `ACTIVE`
- ✅ El inventario `reserved` nunca puede ser negativo

---

## 6. Vistas y Reportes

### Vista Resumen de Contratos

```sql
SELECT * FROM vw_layaway_summary
WHERE tenant_id = 'tu-tenant-id'
  AND status = 'ACTIVE'
ORDER BY created_at DESC;
```

Columnas: `layaway_id`, `status`, `customer_name`, `location_name`, `total`, `paid_total`, `balance`, `due_date`, `sale_id`

### Vista Pagos por Contrato

```sql
SELECT * FROM vw_layaway_payments
WHERE layaway_id = 'contrato-id'
ORDER BY paid_at DESC;
```

Columnas: `layaway_payment_id`, `paid_at`, `payment_method_name`, `amount`, `reference`, `cash_session_id`

### Vista Stock Disponible

```sql
SELECT * FROM vw_stock_available
WHERE tenant_id = 'tu-tenant-id'
  AND location_id = 'sede-id'
ORDER BY available ASC;
```

Columnas: `variant_id`, `on_hand`, `reserved`, `available`

---

## 7. Interfaz de Usuario

### Menú de Navegación

El módulo aparece en: **Ventas > Plan Separe**

### Permisos Requeridos

- Ver listado: `LAYAWAY.VIEW`
- Crear contrato: `LAYAWAY.CREATE`
- Registrar abonos: `LAYAWAY.PAYMENT.ADD`
- Completar: `LAYAWAY.COMPLETE`
- Cancelar: `LAYAWAY.CANCEL`

### Funcionalidades UI

1. **Listado de Contratos** (`/layaway`)
   - Filtros por estado (Todos, Activos, Completados, Cancelados, Expirados)
   - Búsqueda por cliente
   - Chips con estado financiero (Total, Pagado, Saldo)

2. **Crear Contrato** (Diálogo)
   - Selección de cliente (obligatorio)
   - Búsqueda y agregado de productos con stock disponible
   - Fecha límite opcional
   - Abono inicial opcional con método de pago

3. **Detalle de Contrato** (`/layaway/:id`)
   - Información del cliente y sede
   - Lista de productos con cantidades
   - Historial de abonos con fechas y métodos
   - Estado financiero visual
   - Acciones:
     - **Registrar Abono** (si activo)
     - **Completar y Facturar** (si balance = 0)
     - **Cancelar** (si activo)
     - **Marcar como Expirado** (si activo)

---

## 8. Casos de Uso

### Caso 1: Cliente aparta un producto

```
1. Usuario crea contrato con cliente, productos y abono inicial
2. Sistema valida stock disponible
3. Sistema reserva inventario y registra abono
4. Cliente ve su contrato en estado ACTIVE con saldo pendiente
```

### Caso 2: Cliente hace abonos parciales

```
1. Usuario abre detalle del contrato
2. Registra abono con método de pago (efectivo, tarjeta, etc.)
3. Sistema actualiza paid_total y balance
4. Si balance = 0, el botón "Completar" se habilita
```

### Caso 3: Cliente completa el pago

```
1. Usuario hace clic en "Completar y Facturar"
2. Sistema valida balance = 0
3. Sistema crea factura (sale)
4. Sistema libera reserva y descuenta stock físico
5. Contrato queda en estado COMPLETED con link a factura
```

### Caso 4: Cliente no completa (cancelación)

```
1. Usuario hace clic en "Cancelar Contrato"
2. Sistema libera todo el inventario reservado
3. Contrato queda en estado CANCELLED
4. Los abonos NO se reembolsan automáticamente (política)
```

---

## 9. Troubleshooting

### Error: "Insufficient AVAILABLE stock"

**Causa:** Stock disponible insuficiente (on_hand - reserved < qty)

**Solución:**
```sql
-- Verificar stock
SELECT * FROM vw_stock_available
WHERE variant_id = 'uuid-variante'
  AND location_id = 'uuid-sede';

-- Liberar reservas fantasma si aplica
SELECT * FROM stock_reservations_log
WHERE action = 'RESERVE'
  AND layaway_id IN (
    SELECT layaway_id FROM layaway_contracts
    WHERE status IN ('CANCELLED', 'EXPIRED')
  );
```

### Error: "Payment method not found/active: LAYAWAY"

**Causa:** No se creó el método de pago LAYAWAY

**Solución:**
```sql
-- Crear método LAYAWAY para todos los tenants
INSERT INTO payment_methods(tenant_id, code, name, is_active)
SELECT t.tenant_id, 'LAYAWAY', 'Liquidación Plan Separe', true
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM payment_methods pm 
  WHERE pm.tenant_id = t.tenant_id 
    AND pm.code='LAYAWAY'
);
```

### Error: "Layaway balance must be 0 to complete"

**Causa:** Intentando completar contrato con saldo pendiente

**Solución:**
```sql
-- Verificar balance del contrato
SELECT layaway_id, total, paid_total, balance
FROM layaway_contracts
WHERE layaway_id = 'uuid-contrato';

-- Registrar abono faltante desde la UI o SQL
```

---

## 10. Mantenimiento

### Limpieza de Contratos Expirados

```sql
-- Identificar contratos vencidos que siguen activos
SELECT layaway_id, customer_id, due_date, balance
FROM layaway_contracts
WHERE status = 'ACTIVE'
  AND due_date < CURRENT_DATE;

-- Marcarlos como expirados (ejecutar uno por uno)
SELECT sp_cancel_layaway(
  'tenant-id',
  'layaway-id',
  'admin-user-id',
  'EXPIRED',
  'Expirado automáticamente por fecha límite'
);
```

### Auditoria de Reservas

```sql
-- Ver reservas activas por producto
SELECT 
  v.sku,
  p.name,
  SUM(CASE WHEN lc.status = 'ACTIVE' THEN li.quantity ELSE 0 END) as qty_reserved,
  sb.reserved as reserved_in_balance
FROM layaway_items li
JOIN layaway_contracts lc USING (layaway_id, tenant_id)
JOIN product_variants v USING (variant_id)
JOIN products p USING (product_id)
LEFT JOIN stock_balances sb ON (
  sb.variant_id = li.variant_id 
  AND sb.tenant_id = li.tenant_id
)
WHERE li.tenant_id = 'tu-tenant-id'
GROUP BY v.sku, p.name, sb.reserved;
```

---

## 11. Próximas Mejoras (Versión 2)

- [ ] Cuotas automáticas con recordatorios
- [ ] Notificaciones por email/SMS para abonos y vencimientos
- [ ] Reembolsos parciales configurables al cancelar
- [ ] Dashboard de contratos próximos a vencer
- [ ] Reportes de conversión (completados vs cancelados)
- [ ] Integración con facturación electrónica
- [ ] Descarga de contratos en PDF

---

## Soporte

Para dudas o problemas con la implementación:
- Revisar logs de Supabase para errores SQL
- Verificar permisos RLS del usuario
- Consultar vistas `vw_layaway_*` para debugging
