# ANÁLISIS: Restricciones de Acceso para Rol CAJERO

## Estado Actual

### ✅ YA IMPLEMENTADO

1. **Ventas (sales)**: 
   - Archivo: `FIX_RLS_CASHIER_PRIVACY.sql`
   - ✅ Cajeros solo ven ventas de SUS sesiones de caja
   - ✅ Política: "Cashiers can view their own sales"
   ```sql
   CREATE POLICY "Cashiers can view their own sales"
   ON sales FOR SELECT
   USING (
     EXISTS (
       SELECT 1 FROM users u
       JOIN cash_sessions cs ON cs.cash_session_id = sales.cash_session_id
       WHERE u.auth_user_id = auth.uid()
         AND u.user_id = cs.opened_by
         AND u.tenant_id = sales.tenant_id
     )
   );
   ```

2. **Sesiones de Caja (cash_sessions)**:
   - ✅ Cajeros solo ven SUS propias sesiones
   - ✅ Política: "Cashiers can view their own sessions"
   
3. **Asignaciones de Cajas (cash_register_assignments)**:
   - ✅ Cajeros solo ven SUS asignaciones
   - ✅ Política: "Cashiers can access their own assignments"

### ❌ FALTANTES - Requieren Implementación

#### 1. **sale_lines** (Líneas de Venta)
- **Problema**: No tiene política RLS específica para cajeros
- **Impacto**: Cajeros podrían ver detalles de ventas de otros cajeros
- **Solución**: Filtrar por sale_id de sus propias ventas

#### 2. **sale_payments** (Pagos de Ventas)
- **Problema**: No tiene política RLS específica para cajeros
- **Impacto**: Cajeros podrían ver pagos de ventas de otros cajeros
- **Solución**: Filtrar por sale_id de sus propias ventas

#### 3. **sale_returns** (Devoluciones)
- **Problema**: No tiene política RLS específica para cajeros
- **Impacto**: Cajeros podrían ver devoluciones de otros cajeros
- **Solución**: Filtrar por sale_id de sus propias ventas

#### 4. **stock_balances** (Inventario)
- **Problema**: Cajeros ven TODO el inventario del tenant
- **Impacto**: No respeta restricción por sede
- **Solución**: Filtrar por location_id de las cajas asignadas al cajero

#### 5. **inventory_moves** (Movimientos de Inventario)
- **Problema**: Cajeros ven TODOS los movimientos del tenant
- **Impacto**: No respeta restricción por sede
- **Solución**: Filtrar por location_id de las cajas asignadas al cajero

#### 6. **layaway_contracts** (Contratos Plan Separe)
- **Problema**: No tiene política RLS específica para cajeros
- **Impacto**: Cajeros podrían ver contratos de otras sedes
- **Solución**: Filtrar por location_id de las cajas asignadas al cajero

#### 7. **layaway_payments** (Pagos Plan Separe)
- **Problema**: No tiene política RLS específica para cajeros
- **Impacto**: Cajeros podrían ver pagos de otras sedes
- **Solución**: Filtrar por session de caja del cajero

#### 8. **customers** (Clientes)
- **Problema**: Cajeros ven TODOS los clientes del tenant
- **Impacto**: Posible filtración de información
- **Consideración**: Determinar si es necesario restringir o dejar acceso global

## Estructura de Relaciones

```
Usuario (CAJERO)
  └─> cash_register_assignments
       └─> cash_registers
            └─> locations (location_id)
                 └─> stock_balances (filtrar por location_id)
                 └─> inventory_moves (filtrar por location_id)
                 └─> layaway_contracts (filtrar por location_id)
  
  └─> cash_sessions (opened_by = user_id)
       └─> sales (cash_session_id)
            └─> sale_lines
            └─> sale_payments
            └─> sale_returns
       └─> layaway_payments (cash_session_id)
```

## Prioridad de Implementación

### 🔴 CRÍTICO (Privacidad de Ventas)
1. **sale_lines** - Líneas de venta
2. **sale_payments** - Pagos de venta
3. **sale_returns** - Devoluciones

### 🟡 ALTO (Restricción por Sede)
4. **stock_balances** - Inventario por sede
5. **inventory_moves** - Movimientos por sede
6. **layaway_contracts** - Contratos por sede
7. **layaway_payments** - Pagos por sesión

### 🟢 MEDIO (Evaluar Necesidad)
8. **customers** - Decidir si restringir o no

## Función Helper Recomendada

Para simplificar las políticas RLS, crear función que retorne las location_id asignadas al cajero:

```sql
CREATE OR REPLACE FUNCTION get_user_assigned_locations()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT DISTINCT cr.location_id
  FROM users u
  JOIN cash_register_assignments a ON a.user_id = u.user_id AND a.is_active = true
  JOIN cash_registers cr ON cr.cash_register_id = a.cash_register_id
  WHERE u.auth_user_id = auth.uid()
    AND u.tenant_id = a.tenant_id;
$$;
```

## Tiempo Estimado de Implementación

- Función helper: 0.5 hora
- Políticas RLS críticas (1-3): 2 horas
- Políticas RLS altas (4-7): 3 horas
- Testing y validación: 1.5 horas
- **Total: 7 horas**
