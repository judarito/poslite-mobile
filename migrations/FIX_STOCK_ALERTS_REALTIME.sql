-- ===================================================================
-- Migración: Reparar Sistema de Alertas en Tiempo Real
-- Fecha: 2026-02-13
-- Descripción: Asegura que los triggers de alertas estén activos
--              y funcionen correctamente con Real-time
-- ===================================================================

-- 1) Verificar que la vista vw_stock_alerts existe
drop view if exists vw_stock_alerts;
create view vw_stock_alerts as
select
  sb.tenant_id,
  sb.location_id,
  l.name as location_name,
  sb.variant_id,
  pv.sku,
  p.product_id,
  p.name as product_name,
  pv.variant_name,
  sb.on_hand,
  sb.reserved,
  (sb.on_hand - sb.reserved) as available,
  coalesce(pv.min_stock, 0) as min_stock,
  case
    when sb.on_hand <= 0 then 'OUT_OF_STOCK'
    when (sb.on_hand - sb.reserved) <= 0 then 'NO_AVAILABLE'
    when sb.on_hand <= coalesce(pv.min_stock, 0) then 'LOW_STOCK'
    when (sb.on_hand - sb.reserved) <= coalesce(pv.min_stock, 0) then 'LOW_AVAILABLE'
  end as alert_level
from stock_balances sb
join locations l on l.location_id = sb.location_id
join product_variants pv on pv.variant_id = sb.variant_id
join products p on p.product_id = pv.product_id
where pv.is_active = true
  and (
    sb.on_hand <= 0 -- sin stock
    or (sb.on_hand - sb.reserved) <= 0 -- sin disponible
    or sb.on_hand <= coalesce(pv.min_stock, 0) -- stock bajo
    or (sb.on_hand - sb.reserved) <= coalesce(pv.min_stock, 0) -- disponible bajo
  );

-- 2) Verificar tabla system_alerts
create table if not exists system_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  alert_type text not null check (alert_type in ('STOCK', 'LAYAWAY')),
  alert_level text not null,
  reference_id uuid not null, -- variant_id para stock, layaway_id para separe
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, alert_type, reference_id)
);

create index if not exists ix_system_alerts_tenant on system_alerts(tenant_id, alert_type, created_at desc);
create index if not exists ix_system_alerts_reference on system_alerts(tenant_id, reference_id);

-- 3) Habilitar Real-time en system_alerts (CRÍTICO)
alter publication supabase_realtime add table system_alerts;

-- 4) Recrear función trigger para stock_balances
create or replace function trg_stock_balances_alert()
returns trigger
language plpgsql
security definer
as $$
declare
  v_tenant_id uuid;
begin
  -- Obtener tenant_id del registro afectado
  v_tenant_id := coalesce(new.tenant_id, old.tenant_id);
  
  -- Eliminar alertas de stock que ya no aplican
  delete from system_alerts sa
  where sa.alert_type = 'STOCK'
    and sa.tenant_id = v_tenant_id
    and sa.reference_id not in (
      select distinct v.variant_id
      from vw_stock_alerts v
      where v.tenant_id = v_tenant_id
    );

  -- Insertar o actualizar alertas vigentes
  insert into system_alerts (tenant_id, alert_type, alert_level, reference_id, data)
  select
    v.tenant_id,
    'STOCK' as alert_type,
    v.alert_level,
    v.variant_id as reference_id,
    jsonb_build_object(
      'location_id', v.location_id,
      'location_name', v.location_name,
      'variant_id', v.variant_id,
      'sku', v.sku,
      'product_name', v.product_name,
      'variant_name', v.variant_name,
      'on_hand', v.on_hand,
      'reserved', v.reserved,
      'available', v.available,
      'min_stock', v.min_stock,
      'alert_level', v.alert_level
    ) as data
  from vw_stock_alerts v
  where v.tenant_id = v_tenant_id
  on conflict (tenant_id, alert_type, reference_id)
  do update set
    alert_level = excluded.alert_level,
    data = excluded.data,
    updated_at = now();

  return coalesce(new, old);
exception
  when others then
    -- Registrar error pero no fallar la transacción principal
    raise warning 'Error actualizando alertas de stock: %', sqlerrm;
    return coalesce(new, old);
end;
$$;

-- 5) Recrear trigger en stock_balances
drop trigger if exists trg_stock_balances_alert_after on stock_balances;
create trigger trg_stock_balances_alert_after
after insert or update or delete on stock_balances
for each row
execute function trg_stock_balances_alert();

-- 6) Recrear función trigger para product_variants (cuando cambia min_stock)
create or replace function trg_product_variants_alert()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Solo refrescar si cambió min_stock
  if new.min_stock is distinct from old.min_stock then
    perform fn_refresh_stock_alerts();
  end if;
  return new;
exception
  when others then
    raise warning 'Error actualizando alertas por cambio en min_stock: %', sqlerrm;
    return new;
end;
$$;

-- 7) Recrear trigger en product_variants
drop trigger if exists trg_product_variants_alert_after on product_variants;
create trigger trg_product_variants_alert_after
after update on product_variants
for each row
execute function trg_product_variants_alert();

-- 8) Recrear funciones de refresh manual
create or replace function fn_refresh_stock_alerts()
returns void
language plpgsql
security definer
as $$
begin
  -- Eliminar alertas que ya no aplican
  delete from system_alerts
  where alert_type = 'STOCK'
    and reference_id not in (
      select distinct variant_id from vw_stock_alerts
    );

  -- Insertar o actualizar alertas vigentes
  insert into system_alerts (tenant_id, alert_type, alert_level, reference_id, data)
  select
    v.tenant_id,
    'STOCK' as alert_type,
    v.alert_level,
    v.variant_id as reference_id,
    jsonb_build_object(
      'location_id', v.location_id,
      'location_name', v.location_name,
      'variant_id', v.variant_id,
      'sku', v.sku,
      'product_name', v.product_name,
      'variant_name', v.variant_name,
      'on_hand', v.on_hand,
      'reserved', v.reserved,
      'available', v.available,
      'min_stock', v.min_stock,
      'alert_level', v.alert_level
    ) as data
  from vw_stock_alerts v
  on conflict (tenant_id, alert_type, reference_id)
  do update set
    alert_level = excluded.alert_level,
    data = excluded.data,
    updated_at = now();
exception
  when others then
    raise exception 'Error refrescando alertas de stock: %', sqlerrm;
end;
$$;

-- 9) Inicializar alertas con datos actuales
select fn_refresh_stock_alerts();

-- 10) Mensaje de confirmación
DO $$
BEGIN
  RAISE NOTICE '✅ Sistema de alertas en tiempo real reparado';
  RAISE NOTICE '📡 Real-time habilitado en system_alerts';
  RAISE NOTICE '🔔 Triggers recreados en stock_balances y product_variants';
  RAISE NOTICE '🔄 Alertas inicializadas con datos actuales';
END $$;
