-- =====================================================
-- CORRECCIONES DE SEGURIDAD MULTI-TENANT - SQL
-- Aplicar estas correcciones ANTES de producción
-- =====================================================

-- =====================================================
-- CORRECCIÓN #1: sp_create_sale
-- Agregar validaciones de tenant en variant_id, payment_method_id y cash_session_id
-- =====================================================

-- Buscar esta función en SpVistasFN.sql y reemplazarla completamente

-- NOTA: Esta es una versión parcial mostrando las validaciones a agregar
-- La función completa debe incluir todo el código existente más estas validaciones

/*
AGREGAR después de la línea "if not exists (select 1 from tenants where tenant_id = p_tenant)"
y ANTES de "insert into sales":

  -- Validar que todas las variantes pertenecen al tenant
  if exists (
    select 1
    from jsonb_array_elements(p_lines) as l
    where not exists (
      select 1
      from product_variants pv
      where pv.variant_id = (l->>'variant_id')::uuid
        and pv.tenant_id = p_tenant
    )
  ) then
    raise exception 'SECURITY: Invalid variant_id belongs to different tenant';
  end if;

  -- Validar que payment_method_id pertenece al tenant
  if exists (
    select 1
    from jsonb_array_elements(p_payments) as pm
    where (pm->>'payment_method_id')::uuid is not null
      and not exists (
        select 1
        from payment_methods m
        where m.payment_method_id = (pm->>'payment_method_id')::uuid
          and m.tenant_id = p_tenant
      )
  ) then
    raise exception 'SECURITY: Invalid payment_method_id belongs to different tenant';
  end if;

  -- Validar cash_session si se proporciona
  if p_cash_session is not null then
    if not exists (
      select 1
      from cash_sessions cs
      where cs.cash_session_id = p_cash_session
        and cs.tenant_id = p_tenant
        and cs.status = 'OPEN'
    ) then
      raise exception 'SECURITY: Invalid or closed cash_session_id';
    end if;
  end if;
*/

-- =====================================================
-- CORRECCIÓN #2: sp_create_return
-- Agregar validación de tenant en sale_lines
-- =====================================================

-- Buscar en SpVistasFN.sql la línea que dice:
-- select sl.variant_id, sl.quantity, sl.unit_price
-- from sale_lines sl
-- where sl.sale_line_id = any(p_line_ids)

-- REEMPLAZAR con:

/*
  select sl.variant_id, sl.quantity, sl.unit_price
  from sale_lines sl
  join sales s on s.sale_id = sl.sale_id
  where sl.sale_line_id = any(p_line_ids)
    and s.tenant_id = p_tenant  -- ✅ Agregar esta línea
*/

-- =====================================================
-- CORRECCIÓN #3: sp_create_layaway
-- Agregar validaciones de tenant
-- =====================================================

-- Buscar en PlanSepare.sql y AGREGAR después de validar tenant:

/*
  -- Validar que payment_method_id pertenece al tenant
  if not exists (
    select 1
    from payment_methods pm
    where pm.payment_method_id = p_payment_method_id
      and pm.tenant_id = p_tenant
  ) then
    raise exception 'SECURITY: Invalid payment_method_id';
  end if;

  -- Validar que todas las variantes pertenecen al tenant
  if exists (
    select 1
    from jsonb_array_elements(p_items) as i
    where not exists (
      select 1
      from product_variants pv
      where pv.variant_id = (i->>'variant_id')::uuid
        and pv.tenant_id = p_tenant
    )
  ) then
    raise exception 'SECURITY: Invalid variant_id in items';
  end if;

  -- Validar cash_session si se proporciona
  if p_cash_session_id is not null then
    if not exists (
      select 1
      from cash_sessions cs
      where cs.cash_session_id = p_cash_session_id
        and cs.tenant_id = p_tenant
        and cs.status = 'OPEN'
    ) then
      raise exception 'SECURITY: Invalid or closed cash_session_id';
    end if;
  end if;
*/

-- =====================================================
-- CORRECCIÓN #4: sp_add_layaway_payment
-- Agregar validaciones de tenant
-- =====================================================

-- Buscar en PlanSepare.sql y AGREGAR después de validar tenant:

/*
  -- Validar que payment_method_id pertenece al tenant
  if not exists (
    select 1
    from payment_methods pm
    where pm.payment_method_id = p_payment_method_id
      and pm.tenant_id = p_tenant
  ) then
    raise exception 'SECURITY: Invalid payment_method_id';
  end if;

  -- Validar cash_session si se proporciona
  if p_cash_session_id is not null then
    if not exists (
      select 1
      from cash_sessions cs
      where cs.cash_session_id = p_cash_session_id
        and cs.tenant_id = p_tenant
        and cs.status = 'OPEN'
    ) then
      raise exception 'SECURITY: Invalid or closed cash_session_id';
    end if;
  end if;
*/

-- =====================================================
-- CORRECCIÓN #5: sp_complete_layaway_to_sale
-- Agregar validaciones de tenant
-- =====================================================

-- Buscar en PlanSepare.sql y AGREGAR después de validar tenant:

/*
  -- Validar que payment_method_id pertenece al tenant
  if p_payment_method_id is not null then
    if not exists (
      select 1
      from payment_methods pm
      where pm.payment_method_id = p_payment_method_id
        and pm.tenant_id = p_tenant
    ) then
      raise exception 'SECURITY: Invalid payment_method_id';
    end if;
  end if;
*/

-- =====================================================
-- CORRECCIÓN #6: Habilitar RLS en tablas layaway
-- =====================================================

-- Habilitar RLS
alter table layaway_contracts enable row level security;
alter table layaway_items enable row level security;
alter table layaway_installments enable row level security;
alter table layaway_payments enable row level security;

-- Políticas para layaway_contracts
drop policy if exists layaway_contracts_select on layaway_contracts;
create policy layaway_contracts_select on layaway_contracts
  for select
  using (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

drop policy if exists layaway_contracts_insert on layaway_contracts;
create policy layaway_contracts_insert on layaway_contracts
  for insert
  with check (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

drop policy if exists layaway_contracts_update on layaway_contracts;
create policy layaway_contracts_update on layaway_contracts
  for update
  using (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1))
  with check (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

drop policy if exists layaway_contracts_delete on layaway_contracts;
create policy layaway_contracts_delete on layaway_contracts
  for delete
  using (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

-- Políticas para layaway_items
drop policy if exists layaway_items_select on layaway_items;
create policy layaway_items_select on layaway_items
  for select
  using (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

drop policy if exists layaway_items_insert on layaway_items;
create policy layaway_items_insert on layaway_items
  for insert
  with check (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

drop policy if exists layaway_items_update on layaway_items;
create policy layaway_items_update on layaway_items
  for update
  using (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1))
  with check (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

drop policy if exists layaway_items_delete on layaway_items;
create policy layaway_items_delete on layaway_items
  for delete
  using (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

-- Políticas para layaway_installments
drop policy if exists layaway_installments_select on layaway_installments;
create policy layaway_installments_select on layaway_installments
  for select
  using (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

drop policy if exists layaway_installments_insert on layaway_installments;
create policy layaway_installments_insert on layaway_installments
  for insert
  with check (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

drop policy if exists layaway_installments_update on layaway_installments;
create policy layaway_installments_update on layaway_installments
  for update
  using (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1))
  with check (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

drop policy if exists layaway_installments_delete on layaway_installments;
create policy layaway_installments_delete on layaway_installments
  for delete
  using (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

-- Políticas para layaway_payments
drop policy if exists layaway_payments_select on layaway_payments;
create policy layaway_payments_select on layaway_payments
  for select
  using (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

drop policy if exists layaway_payments_insert on layaway_payments;
create policy layaway_payments_insert on layaway_payments
  for insert
  with check (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

drop policy if exists layaway_payments_update on layaway_payments;
create policy layaway_payments_update on layaway_payments
  for update
  using (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1))
  with check (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

drop policy if exists layaway_payments_delete on layaway_payments;
create policy layaway_payments_delete on layaway_payments
  for delete
  using (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

-- =====================================================
-- CORRECCIÓN #7: Habilitar RLS en tablas auxiliares
-- =====================================================

-- stock_alert_log
alter table stock_alert_log enable row level security;

drop policy if exists stock_alert_log_select on stock_alert_log;
create policy stock_alert_log_select on stock_alert_log
  for select
  using (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

drop policy if exists stock_alert_log_insert on stock_alert_log;
create policy stock_alert_log_insert on stock_alert_log
  for insert
  with check (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

-- system_alerts
alter table system_alerts enable row level security;

drop policy if exists system_alerts_select on system_alerts;
create policy system_alerts_select on system_alerts
  for select
  using (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

drop policy if exists system_alerts_insert on system_alerts;
create policy system_alerts_insert on system_alerts
  for insert
  with check (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

drop policy if exists system_alerts_update on system_alerts;
create policy system_alerts_update on system_alerts
  for update
  using (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1))
  with check (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

drop policy if exists system_alerts_delete on system_alerts;
create policy system_alerts_delete on system_alerts
  for delete
  using (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

-- customer_credit_movements
alter table customer_credit_movements enable row level security;

drop policy if exists customer_credit_movements_select on customer_credit_movements;
create policy customer_credit_movements_select on customer_credit_movements
  for select
  using (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

drop policy if exists customer_credit_movements_insert on customer_credit_movements;
create policy customer_credit_movements_insert on customer_credit_movements
  for insert
  with check (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

-- =====================================================
-- CORRECCIÓN #8: change_user_password
-- Agregar validación de tenant
-- =====================================================

-- Buscar en UserFunctions.sql y AGREGAR al inicio de la función:

/*
  -- Validar que el usuario a modificar pertenece al mismo tenant
  if not exists (
    select 1
    from users u1
    join users u2 on u2.tenant_id = u1.tenant_id
    where u1.auth_user_id = auth.uid()
      and u2.auth_user_id = p_auth_user_id
  ) then
    raise exception 'SECURITY: Unauthorized - user belongs to different tenant';
  end if;
*/

-- =====================================================
-- VERIFICACIÓN POST-APLICACIÓN
-- =====================================================

-- Ejecutar estos queries para verificar que todo está correcto:

-- 1. Verificar que todas las tablas layaway tienen RLS
select tablename, rowsecurity 
from pg_tables 
where schemaname = 'public' 
  and tablename like 'layaway%';
-- Resultado esperado: todas con rowsecurity = true

-- 2. Verificar políticas RLS en layaway
select schemaname, tablename, policyname, cmd
from pg_policies
where tablename like 'layaway%'
order by tablename, cmd;
-- Resultado esperado: 4 políticas por tabla (SELECT, INSERT, UPDATE, DELETE)

-- 3. Verificar tablas auxiliares
select tablename, rowsecurity 
from pg_tables 
where schemaname = 'public' 
  and tablename in ('stock_alert_log', 'system_alerts', 'customer_credit_movements');
-- Resultado esperado: todas con rowsecurity = true

-- =====================================================
-- NOTAS IMPORTANTES
-- =====================================================

/*
ANTES DE APLICAR EN PRODUCCIÓN:

1. Hacer backup completo de la base de datos
2. Aplicar en ambiente de desarrollo primero
3. Ejecutar tests de seguridad multi-tenant
4. Verificar que no rompa funcionalidad existente
5. Aplicar en horario de bajo tráfico
6. Tener plan de rollback preparado

ORDEN DE APLICACIÓN RECOMENDADO:

1. Correcciones #6 y #7 (RLS) - Bajo riesgo
2. Corrección #8 (change_user_password) - Bajo riesgo
3. Correcciones #2 (sp_create_return) - Riesgo medio
4. Corrección #1 (sp_create_sale) - Riesgo alto
5. Correcciones #3, #4, #5 (layaway) - Riesgo alto

TIEMPO ESTIMADO TOTAL: 2-3 horas

ROLLBACK:
- Si algo falla, restaurar backup
- Las políticas RLS se pueden desactivar temporalmente con:
  alter table [nombre_tabla] disable row level security;
*/
