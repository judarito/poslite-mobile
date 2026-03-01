# 🔒 FIX: Restricción de Reportes para Cajeros

## Problema Identificado

El rol CAJERO veía toda la información en los reportes cuando solo debería ver:
- Sus propias ventas (de sus sesiones de caja)
- Sus propios movimientos de caja
- Sus propias sesiones

## Causa Raíz

El servicio `reports.service.js` consultaba directamente las tablas `sales`, `sale_lines`, `sale_payments`, etc., sin aplicar el filtrado por rol de usuario que implementamos en las políticas RLS.

## Solución Implementada

### 1. Vistas SQL con Filtrado Automático por Rol

Creadas 6 vistas en [CREATE_SALES_VIEWS_BY_ROLE.sql](CREATE_SALES_VIEWS_BY_ROLE.sql):

| Vista | Tabla Original | Descripción |
|-------|---------------|-------------|
| `v_sales_by_role` | `sales` | Ventas filtradas por rol |
| `v_sale_lines_by_role` | `sale_lines` | Líneas de venta filtradas |
| `v_sale_payments_by_role` | `sale_payments` | Pagos filtrados |
| `v_sale_returns_by_role` | `sale_returns` | Devoluciones filtradas |
| `v_cash_sessions_by_role` | `cash_sessions` | Sesiones filtradas |
| `v_cash_movements_by_role` | `cash_movements` | Movimientos filtrados |

**Lógica de Filtrado en las Vistas:**
```sql
-- ADMINISTRADOR: Ve todo el tenant
-- CAJERO: Solo ve datos de SUS sesiones de caja
-- OTROS ROLES: Ven todo el tenant
```

### 2. Actualización del Servicio de Reportes

Modificado [reports.service.js](../src/services/reports.service.js) para usar vistas en lugar de tablas:

```javascript
// ANTES
this.salesTable = 'sales'
this.saleLinesTable = 'sale_lines'

// DESPUÉS
this.salesTable = 'v_sales_by_role'
this.saleLinesTable = 'v_sale_lines_by_role'
this.salePaymentsTable = 'v_sale_payments_by_role'
this.saleReturnsTable = 'v_sale_returns_by_role'
this.cashSessionsTable = 'v_cash_sessions_by_role'
this.cashMovementsTable = 'v_cash_movements_by_role'
```

## Reportes Afectados

Todos los reportes ahora respetan el rol del usuario:

1. ✅ **Resumen de Ventas** (`getSalesSummary`)
2. ✅ **Ventas por Día** (`getSalesByDay`)
3. ✅ **Top Productos** (`getTopProducts`)
4. ✅ **Ventas por Vendedor** (`getSalesBySeller`)
5. ✅ **Ventas por Método de Pago** (`getSalesByPaymentMethod`)
6. ✅ **Movimientos de Caja** (`getCashMovements`)
7. ✅ **Movimientos por Categoría** (`getCashMovementsByCategory`)
8. ✅ **Plan Separe** (`getLayawaySummary`, `getLayawayPayments`)

## Comportamiento Esperado

### Como CAJERO:
- **Resumen**: Solo muestra totales de SUS ventas
- **Por Día**: Solo agrupa SUS ventas por fecha
- **Top Productos**: Solo productos que ÉL vendió
- **Por Vendedor**: Solo aparece ÉL mismo en la lista
- **Métodos de Pago**: Solo pagos de SUS ventas
- **Movimientos de Caja**: Solo movimientos de SUS sesiones
- **Plan Separe**: Solo contratos de SUS sesiones

### Como ADMINISTRADOR:
- Ve TODOS los datos del tenant
- Puede filtrar por ubicación/fechas
- Incluye ventas de todos los cajeros

### Como OTROS ROLES:
- Ven TODOS los datos del tenant
- Similar comportamiento al administrador

## Instalación

### 1. Ejecutar Script SQL en Supabase:
```bash
-- Copiar y pegar el contenido de:
migrations/CREATE_SALES_VIEWS_BY_ROLE.sql
```

### 2. Reiniciar la Aplicación Vue:
```bash
npm run dev
```

No se requieren cambios adicionales en el frontend, todo es transparente para el código existente.

## Verificación

### Test como CAJERO:

1. Inicia sesión como cajero
2. Abre una sesión de caja
3. Realiza 2-3 ventas
4. Ve a **Reportes**
5. **Verifica**:
   - El resumen muestra solo TUS ventas
   - Por Día: Solo aparecen TUS ventas
   - Top Productos: Solo productos que vendiste
   - Por Vendedor: Solo apareces TÚ
   - Movimientos de Caja: Solo TUS movimientos

### Test como ADMINISTRADOR:

1. Inicia sesión como admin
2. Ve a **Reportes**
3. **Verifica**:
   - El resumen muestra TODAS las ventas del tenant
   - Incluye ventas de todos los cajeros
   - Por Vendedor: Lista TODOS los vendedores

### Test con Múltiples Cajeros:

1. Cajero A: Realiza 3 ventas
2. Cajero B: Realiza 2 ventas
3. **Verificar**:
   - Cajero A solo ve sus 3 ventas
   - Cajero B solo ve sus 2 ventas
   - Admin ve las 5 ventas totales

## Archivos Modificados

1. ✅ `migrations/CREATE_SALES_VIEWS_BY_ROLE.sql` - Vistas con filtrado por rol
2. ✅ `src/services/reports.service.js` - Uso de vistas en lugar de tablas

## Beneficios

1. **Separación de Responsabilidades**: Cada cajero solo ve su desempeño
2. **Seguridad**: No se pueden manipular consultas para ver datos de otros
3. **Transparente**: No requiere cambios en componentes Vue
4. **Mantenible**: Un solo lugar para la lógica de filtrado (SQL)
5. **Performance**: PostgreSQL optimiza las vistas automáticamente

## Notas Técnicas

- Las vistas NO son materializadas, se calculan en tiempo real
- Usan las funciones helper: `is_user_admin()`, `is_user_cashier()`, `get_current_user_tenant_id()`
- Compatible con todas las políticas RLS existentes
- No afecta el performance significativamente (mismo plan de ejecución)

## Mejoras Futuras (Opcional)

1. **Comparativa de Performance**: Dashboard comparando su performance vs otros cajeros (sin revelar datos individuales)
2. **Metas Personales**: Cada cajero puede ver sus metas y avance
3. **Rankings Anónimos**: Mostrar posición sin revelar nombres de otros
