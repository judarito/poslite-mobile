# 🔒 SOLUCIÓN COMPLETA: Restricciones para Cajeros

## Problema
1. ❌ Cajeros ven todos los datos en reportes
2. ❌ Cajeros ven módulos que no deben (Productos, Inventario, Compras)

## Solución

### 1. Scripts SQL a Ejecutar (EN ORDEN)

#### Paso 1: Aplicar FIX_RLS_CASHIER_PRIVACY.sql
```bash
-- Ejecutar en Supabase SQL Editor
\i migrations/FIX_RLS_CASHIER_PRIVACY.sql
```

Este script crea:
- ✅ Funciones helper (`is_user_admin`, `is_user_cashier`, `get_current_user_tenant_id`)
- ✅ Políticas RLS para `cash_sessions` (cajeros solo ven las suyas)
- ✅ Políticas RLS para `sales` (cajeros solo ven ventas de sus sesiones)

#### Paso 2: NO ES NECESARIO ejecutar CREATE_SALES_VIEWS_BY_ROLE.sql ni CREATE_ROLE_FILTER_FUNCTIONS.sql

Las políticas RLS ya aplican automáticamente a TODAS las consultas desde el cliente.

### 2. Frontend Actualizado

#### Home.vue
- ✅ Cajeros YA NO ven: Productos, Inventario, Compras
- ✅ Cajeros SÍ ven: POS, Ventas, Plan Separe, Reportes

#### reports.service.js
- ✅ Usa tablas directas (sales, sale_lines, etc.)
- ✅ Las políticas RLS filtran automáticamente por rol

#### PointOfSale.vue
- ✅ Solo carga la sesión del usuario actual (no de otros)

## Verificación

### ¿Por qué no estaba funcionando?

Posibles causas:
1. El script FIX_RLS_CASHIER_PRIVACY.sql no se ejecutó completamente
2. Las políticas tienen un error de sintaxis
3. Las funciones helper no retornan los valores correctos

### Test Rápido

**Como CAJERO**, ejecuta en la consola del navegador (en la vista Sales):
```javascript
// Debe mostrar:
✅ is_user_cashier(): true
✅ get_current_user_tenant_id(): <uuid del tenant>
✅ Ventas visibles: <solo las de SU sesión>
```

Si esto funciona pero los reportes no, entonces el problema está en que **las políticas RLS NO se están aplicando a las consultas complejas con JOINs**.

### Solución Definitiva Si Persiste el Problema

Si después de ejecutar FIX_RLS_CASHIER_PRIVACY.sql el cajero TODAVÍA ve todos los datos en reportes, necesitamos:

1. **Verificar que RLS está habilitado**:
```sql
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN ('sales', 'sale_lines', 'sale_payments', 'cash_sessions', 'cash_movements');
```

Todos deben tener `rowsecurity = true`

2. **Verificar políticas activas**:
```sql
SELECT schemaname, tablename, policyname, cmd, qual
FROM pg_policies
WHERE tablename IN ('sales', 'sale_lines', 'sale_payments')
ORDER BY tablename, policyname;
```

Debe haber:
- `sales`: 3 políticas (Users can view sales, Admins can manage all sales, Cashiers can create sales, Non-cashiers can create sales)
- `sale_lines`: Políticas que ya existen
- `sale_payments`: Políticas que ya existen

3. **Si RLS está habilitado pero no funciona**, es porque Supabase NO aplica RLS a consultas con JOINs complejos desde el cliente. En ese caso, DEBEMOS usar las funciones SQL (CREATE_ROLE_FILTER_FUNCTIONS.sql).

## Archivos Modificados

1. ✅ migrations/FIX_RLS_CASHIER_PRIVACY.sql - Políticas RLS
2. ✅ src/views/Home.vue - Filtrado de módulos por rol
3. ✅ src/views/PointOfSale.vue - Solo usar sesión propia
4. ✅ src/services/reports.service.js - Volver a usar tablas directas (RLS automático)

## Próximos Pasos

1. **Ejecuta FIX_RLS_CASHIER_PRIVACY.sql** en Supabase
2. **Prueba como CAJERO**: Ve a Reportes, verifica que solo ves TUS datos
3. **Prueba como CAJERO**: Ve a Home, verifica que NO ves Productos/Inventario/Compras
4. **Si TODAVÍA no funciona**, reporta qué consulta en específico muestra todos los datos (ej: "Resumen de ventas", "Por Día", etc.)
