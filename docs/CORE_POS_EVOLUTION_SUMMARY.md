# POSLite Core Evolution Summary

## Objetivo
Este documento resume los cambios de core implementados en web para que la app mobile reutilice reglas de negocio, estados y contratos RPC sin re-diseno.

## 1) Compras y Ordenes de Compra

### 1.1 Orden de compra en borrador y recepcion
- Migracion: `migrations/ADD_PURCHASE_ORDERS_CORE.sql`
- Tablas:
  - `purchase_orders`
  - `purchase_order_lines`
- RPC:
  - `sp_create_purchase_order(...)`
  - `sp_receive_purchase_order(...)`
- Estados iniciales: `DRAFT`, `RECEIVED`, `CANCELLED`.
- UI:
  - Boton `Guardar como OC` en compras.
  - Dialogo `OC Pendientes`.

### 1.2 Recepcion parcial de OC
- Migracion: `migrations/ADD_PURCHASE_ORDERS_PARTIAL_RECEIPT.sql`
- Cambios:
  - Estado adicional `PARTIAL`.
  - Campo `purchase_order_lines.qty_received`.
- RPC:
  - `sp_receive_purchase_order_partial(...)`.
  - `sp_receive_purchase_order(...)` adaptada para recibir saldo.
- UI:
  - Confirmacion por linea con `qty_to_receive`.
  - Validacion de no exceder pendiente.

## 2) Devolucion a Proveedor
- Migracion: `migrations/ADD_PURCHASE_RETURNS_CORE.sql`
- Tablas:
  - `purchase_returns`
  - `purchase_return_lines`
- RPC:
  - `sp_create_purchase_return(...)`
- Reglas:
  - No devolver mas de lo comprado por linea.
  - No devolver si no hay stock disponible en sede.
  - Se crea `inventory_moves.move_type = 'PURCHASE_RETURN_OUT'`.
- UI:
  - En detalle de compra: dialogo para devolucion parcial/total por linea.
  - Historial de devoluciones en el detalle.

## 3) Cuentas por Pagar (AP) de Proveedores
- Migracion: `migrations/ADD_SUPPLIER_PAYABLES_CORE.sql`
- Tablas:
  - `supplier_payables`
  - `supplier_payable_payments`
- RPC:
  - `sp_create_supplier_payable(...)`
  - `sp_register_supplier_payment(...)`
- Estados AP:
  - `OPEN`, `PARTIAL`, `PAID`, `CANCELLED`.
- UI:
  - Seccion de cuenta por pagar dentro de detalle de compra.
  - Crear cuenta por pagar desde compra.
  - Registrar abonos y ver ultimos pagos.

## 4) Inventario - Traslados en Transito
- Migracion: `migrations/ADD_TRANSFER_IN_TRANSIT_CORE.sql`
- Tabla:
  - `transfer_requests`
- RPC:
  - `sp_create_transfer_request(...)` (solo salida origen, estado `IN_TRANSIT`).
  - `sp_receive_transfer_request(...)` (entrada destino, estado `RECEIVED`).
- Estados traslado:
  - `IN_TRANSIT`, `RECEIVED`, `CANCELLED`.
- UI Inventario:
  - En operaciones, traslado ahora crea solicitud en transito.
  - Dialogo de pendientes para confirmar recepcion en sede destino.

## 5) Convenciones operativas para Mobile

### 5.1 Identidad de usuario
- `auth_user_id` y `user_id` tienen semantica distinta.
- RPC operativas usan `users.user_id` en `created_by`/`received_by`.

### 5.2 Contratos de backend a reutilizar
- Compras/OC:
  - `sp_create_purchase`, `sp_create_purchase_order`, `sp_receive_purchase_order`, `sp_receive_purchase_order_partial`.
- Devoluciones proveedor:
  - `sp_create_purchase_return`.
- AP proveedor:
  - `sp_create_supplier_payable`, `sp_register_supplier_payment`.
- Traslados:
  - `sp_create_transfer_request`, `sp_receive_transfer_request`.

### 5.3 Reglas de integridad que mobile debe respetar
- No permitir recepcion/devolucion con cantidades negativas.
- No permitir recepcion/devolucion por encima de saldo pendiente.
- No permitir pagos AP por encima del saldo.
- No asumir acceso a menu por fallback estatico; siempre validar permisos reales.

## 6) Orden sugerido de implementacion Mobile
1. Autenticacion + resolucion `user_id`.
2. Flujos de compra/OC (crear, listar pendientes, recibir parcial).
3. Devolucion a proveedor.
4. Cuentas por pagar (crear AP y abonar).
5. Traslados en transito (crear + confirmar recepcion).
6. Integraciones dispositivo (scanner, impresora BT, modo offline con cola).

## 7) Notas tecnicas
- Todas las migraciones anteriores incluyen RLS por tenant y grants para `authenticated`.
- Se uso `NOTIFY pgrst, 'reload schema'` donde fue necesario por cache de PostgREST.
- Antes de release mobile, ejecutar una bateria E2E sobre:
  - OC parcial + recepcion final.
  - Devolucion parcial y total.
  - AP parcial y pago total.
  - Traslado IN_TRANSIT -> RECEIVED.

## 8) Seguridad por rol/sede (nuevo)
- Migracion: `migrations/ADD_CORE_ROLE_LOCATION_RESTRICTIONS.sql`.
- Alcance:
  - `purchase_orders`, `purchase_order_lines`
  - `purchase_returns`, `purchase_return_lines`
  - `supplier_payables`, `supplier_payable_payments`
  - `transfer_requests`
- Reglas:
  - `CAJERO` solo accede a datos de sedes asignadas (por asignacion de caja/sede).
  - En traslados:
    - Crear: `CAJERO` solo desde su sede asignada.
    - Recibir: `CAJERO` solo en sede destino asignada.
  - `ADMINISTRADOR` y `GERENTE` mantienen acceso completo dentro de su tenant.

## 9) CxP Proveedores - Bandeja Global
- Migracion: `migrations/ADD_SUPPLIER_PAYABLES_DASHBOARD_RPC.sql`.
- RPC:
  - `sp_get_supplier_payables_dashboard(...)`
- Objetivo:
  - Listar CxP de forma global (no solo desde el detalle de compra).
  - Priorizar vencimientos y sobre-vencidos.
- UI:
  - Boton `CxP Proveedores` en Compras.
  - Filtro por estado y vencimiento.
  - Acceso rapido a `Ver compra` para crear/abonar cuenta si aplica.

## 10) Alertas CxP en Home
- Fuente de datos:
  - `system_alerts` con `alert_type = 'PAYABLE'`.
- Comportamiento:
  - Muestra alerta en Home para `ADMINISTRADOR` y `GERENTE`.
  - Separa:
    - CxP vencidas.
    - CxP por vencer (ventana 7 dias).
  - Incluye monto agregado por grupo.
- Accion:
  - Boton directo a `Compras` para gestionar pago/seguimiento.

## 11) Integracion PAYABLE en Alertas Realtime
- Migracion: `migrations/ADD_SUPPLIER_PAYABLES_ALERTS_REALTIME.sql`.
- Cambios:
  - `system_alerts.alert_type` ahora incluye `PAYABLE`.
  - Nueva funcion `fn_refresh_supplier_payable_alerts()`.
  - Trigger en `supplier_payables` para refresco automatico.
  - `fn_refresh_all_alerts()` actualizado para incluir CxP.
  - Indice `ix_system_alerts_payable`.
- Frontend:
  - Campana global (`App.vue`) agrega tab `CxP`.
  - Composable `useAppAlerts` incorpora `payableAlerts` + filtros + contadores.

## 12) Scheduler de Alertas (pg_cron)
- Migracion: `migrations/ADD_ALERTS_CRON_SCHEDULE.sql`.
- Job:
  - `poslite_refresh_all_alerts_hourly`
  - Cron: `0 * * * *` (cada hora)
- Comportamiento:
  - Ejecuta `fn_refresh_all_alerts()` si existe.
  - Fallback a `fn_refresh_supplier_payable_alerts()` si la funcion global no existe.
- Verificacion sugerida:
  - `select * from cron.job where jobname = 'poslite_refresh_all_alerts_hourly';`

## 13) Pago Masivo CxP
- UI: `Compras` -> dialogo `CxP Proveedores`.
- Flujo:
  - Seleccion multiple de cuentas `OPEN/PARTIAL` con saldo.
  - Accion `Pagar seleccionadas`.
  - Registro de abonos por saldo total de cada cuenta en lote (cliente web).
- Validaciones:
  - Requiere usuario autenticado con `user_id`.
  - Ignora cuentas no pagables (saldo 0 o estado final).

## 14) Alertas Realtime de Cartera (CxC)
- Migracion: `migrations/ADD_CUSTOMER_RECEIVABLE_ALERTS_REALTIME.sql`.
- Cambios:
  - `system_alerts.alert_type` incluye `RECEIVABLE`.
  - Nueva funcion `fn_refresh_customer_receivable_alerts(p_tenant)` para:
    - clientes con saldo (`WITH_DEBT`)
    - clientes sobre cupo (`OVER_LIMIT`)
  - Trigger en `customer_credit_accounts` para refresco automatico.
  - `fn_refresh_all_alerts()` ahora contempla CxC (y es tolerante a fallos por modulo).
  - Indice `ix_system_alerts_receivable`.
- Frontend:
  - Campana global (`App.vue`) agrega tab `Cartera`.
  - `useAppAlerts` agrega filtros, contadores y helpers para `RECEIVABLE`.
  - `alerts.service` agrega `refreshCustomerReceivableAlerts()`.

## 15) Devoluciones de Venta Robustas (Punto 3)
- Migracion: `migrations/ADD_SALE_RETURNS_REFUNDS_V2.sql`.
- Cambios DB:
  - Nueva tabla `sale_return_refunds` para registrar desglose de reembolso por metodo.
  - Nueva RPC `sp_create_return_v2(...)`:
    - crea devolucion usando `sp_create_return(...)`
    - valida metodos de pago activos del tenant
    - valida que suma de reembolsos = `refund_total`
    - persiste detalle en `sale_return_refunds`
- Frontend:
  - `Sales.vue`: dialogo de devolucion ahora captura metodos de reembolso (multiple), referencia y validacion de cuadre.
  - `sales.service`: soporte `createReturnV2` y enrutamiento automatico cuando llegan `refunds`.

## 16) IA Comercial: Compras + Precios
- Compras (ya existente):
  - Servicio: `src/services/ai-purchase-advisor.service.js`.
  - Integracion: `src/services/purchases.service.js` + `src/views/Purchases.vue`.
  - Valor: prioriza reabastecimiento con base en rotacion, tendencia y stock; permite pasar de sugerencia a flujo de compra.
- Precios (nuevo):
  - Servicio: `src/services/ai-pricing-advisor.service.js`.
  - Integracion UI: `src/views/PricingRules.vue` (dialogo `Sugerencias IA de Precio`).
  - Enfoque:
    - Motor hibrido (reglas + IA opcional por DeepSeek).
    - Sugerencias por variante con accion (`INCREASE`/`DECREASE`), delta porcentual, razon e impacto.
    - Resumen ejecutivo (`subir`, `bajar`, `delta promedio`) e insights para decision comercial.
