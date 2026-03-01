/* ============================================================================
   STOCK MÍNIMO - Sistema de Alertas de Inventario
   
   Agrega la funcionalidad de stock mínimo para:
   - Alertas cuando stock <= mínimo configurado
   - Vista de productos bajo stock mínimo
   - Historial de alertas
   
   NOTA: El stock mínimo se define por VARIANTE (product_variants), no por sede.
         Es una característica del producto que aplica globalmente.
   ============================================================================ */

-- =========================
-- 1) AGREGAR CAMPOS min_stock Y allow_backorder A VARIANTES
-- =========================
alter table product_variants
add column if not exists min_stock numeric(14,3) not null default 0,
add column if not exists allow_backorder boolean not null default false;

comment on column product_variants.min_stock is 'Stock mínimo para alerta. Si on_hand <= min_stock y min_stock > 0, se genera alerta LOW_STOCK.';
comment on column product_variants.allow_backorder is 'Permite sobreventa (stock negativo). Si es true, NO se valida stock disponible en ventas.';

-- =========================
-- 2) VISTA DE STOCK CON ALERTAS
-- =========================
-- Eliminar vista existente si hay conflicto de estructura
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
  pv.cost,
  pv.price,
  pv.min_stock,
  cat.name as category_name,
  -- Stock
  sb.on_hand,
  sb.reserved,
  (sb.on_hand - sb.reserved) as available,
  -- Alertas
  case
    when sb.on_hand <= 0 then 'OUT_OF_STOCK'
    when sb.on_hand <= pv.min_stock and pv.min_stock > 0 then 'LOW_STOCK'
    when (sb.on_hand - sb.reserved) <= 0 then 'NO_AVAILABLE'
    when (sb.on_hand - sb.reserved) <= pv.min_stock and pv.min_stock > 0 then 'LOW_AVAILABLE'
    else 'OK'
  end as alert_level,
  -- Fecha
  sb.updated_at
from stock_balances sb
join locations l on l.location_id = sb.location_id
join product_variants pv on pv.variant_id = sb.variant_id
join products p on p.product_id = pv.product_id
left join categories cat on cat.category_id = p.category_id
where p.is_active = true and pv.is_active = true;

comment on view vw_stock_alerts is 'Vista de stock con niveles de alerta basados en stock mínimo de la variante';

-- =========================
-- 3) TABLA DE HISTORIAL DE ALERTAS (OPCIONAL)
-- =========================
create table if not exists stock_alert_log (
  alert_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  location_id uuid not null references locations(location_id) on delete cascade,
  variant_id uuid not null references product_variants(variant_id) on delete cascade,
  alert_level text not null, -- OUT_OF_STOCK | LOW_STOCK | NO_AVAILABLE | LOW_AVAILABLE
  on_hand numeric(14,3) not null,
  reserved numeric(14,3) not null,
  min_stock numeric(14,3) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_stock_alert_log_tenant_created 
on stock_alert_log(tenant_id, created_at desc);

comment on table stock_alert_log is 'Historial de alertas de stock (opcional para auditoría)';

-- =========================
-- 4) FUNCIÓN PARA ACTUALIZAR MIN_STOCK
-- =========================
-- Eliminar función existente con firma antigua (si existe)
drop function if exists fn_update_min_stock(uuid, uuid, uuid, numeric);

create or replace function fn_update_min_stock(
  p_tenant uuid,
  p_variant uuid,
  p_min_stock numeric
) returns void
language plpgsql
security definer
as $$
begin
  update product_variants
  set min_stock = p_min_stock
  where tenant_id = p_tenant
    and variant_id = p_variant;
    
  if not found then
    raise exception 'Variant not found: %', p_variant;
  end if;
end;
$$;

comment on function fn_update_min_stock is 'Actualiza el stock mínimo de una variante (aplica a todas las sedes)';

-- =========================
-- 5) FUNCIÓN PARA REGISTRAR ALERTAS (OPCIONAL)
-- =========================
create or replace function fn_log_stock_alert(
  p_tenant uuid,
  p_location uuid,
  p_variant uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_on_hand numeric;
  v_reserved numeric;
  v_min_stock numeric;
  v_alert_level text;
begin
  -- Obtener estado actual del stock y min_stock de la variante
  select sb.on_hand, sb.reserved, pv.min_stock
  into v_on_hand, v_reserved, v_min_stock
  from stock_balances sb
  join product_variants pv on pv.variant_id = sb.variant_id
  where sb.tenant_id = p_tenant
    and sb.location_id = p_location
    and sb.variant_id = p_variant;
    
  if not found then
    return;
  end if;
  
  -- Determinar nivel de alerta
  -- NOTA: Si min_stock = 0, significa que NO hay control de stock mínimo para esta variante
  --       Solo se generan alertas OUT_OF_STOCK y NO_AVAILABLE
  if v_on_hand <= 0 then
    v_alert_level := 'OUT_OF_STOCK';
  elsif v_on_hand <= v_min_stock and v_min_stock > 0 then
    v_alert_level := 'LOW_STOCK';
  elsif (v_on_hand - v_reserved) <= 0 then
    v_alert_level := 'NO_AVAILABLE';
  elsif (v_on_hand - v_reserved) <= v_min_stock and v_min_stock > 0 then
    v_alert_level := 'LOW_AVAILABLE';
  else
    return; -- No hay alerta
  end if;
  
  -- Registrar alerta (evitar duplicados en mismo día)
  insert into stock_alert_log (tenant_id, location_id, variant_id, alert_level, on_hand, reserved, min_stock)
  select p_tenant, p_location, p_variant, v_alert_level, v_on_hand, v_reserved, v_min_stock
  where not exists (
    select 1 from stock_alert_log
    where tenant_id = p_tenant
      and location_id = p_location
      and variant_id = p_variant
      and alert_level = v_alert_level
      and created_at > now() - interval '1 day'
  );
end;
$$;

comment on function fn_log_stock_alert is 'Registra una alerta de stock en el log si aplica (una vez por día). Si min_stock=0, solo alerta OUT_OF_STOCK/NO_AVAILABLE.';

-- =========================
-- 6) EJEMPLOS DE USO
-- =========================
/*
-- Actualizar stock mínimo de una variante
select fn_update_min_stock('tenant-uuid', 'variant-uuid', 10);

-- Permitir sobreventa para una variante específica
update product_variants
set allow_backorder = true
where tenant_id = 'tenant-uuid'
  and sku = 'SKU-BACKORDER';

-- Consultar productos bajo stock mínimo (en cualquier sede)
select * from vw_stock_alerts
where tenant_id = 'tenant-uuid'
  and alert_level in ('OUT_OF_STOCK', 'LOW_STOCK', 'NO_AVAILABLE', 'LOW_AVAILABLE')
order by alert_level, on_hand;

-- Ver historial de alertas
select * from stock_alert_log
where tenant_id = 'tenant-uuid'
order by created_at desc
limit 100;

-- Configurar producto con min_stock Y sobreventa permitida
update product_variants
set min_stock = 15,
    allow_backorder = true
where tenant_id = 'tenant-uuid'
  and sku = 'SKU-123';
-- Esto genera alertas cuando stock <= 15, pero permite vender con stock negativo

-- NOTA IMPORTANTE: Para que allow_backorder funcione, se debe modificar sp_create_sale:
/*
  -- En lugar de:
  if v_on_hand < v_qty then
    raise exception 'Stock insuficiente';
  end if;

  -- Usar:
  select allow_backorder into v_allow_backorder
    from product_variants
   where variant_id = v_variant;
   
  if NOT v_allow_backorder and v_on_hand < v_qty then
    raise exception 'Stock insuficiente';
  end if;
*/
*/
