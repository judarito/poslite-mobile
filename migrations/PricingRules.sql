-- =====================================================
-- POLÍTICAS DE PRECIO (PRICING RULES)
-- Sistema de configuración de precios centralizado
-- Similar al sistema de tax_rules pero para precios
-- =====================================================

-- Crear tabla de políticas de precio
create table if not exists pricing_rules (
  pricing_rule_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  
  -- Alcance de la regla
  scope text not null check (scope in ('TENANT', 'LOCATION', 'CATEGORY', 'PRODUCT', 'VARIANT')),
  
  -- Referencias según el alcance
  location_id uuid references locations(location_id),
  category_id uuid references categories(category_id),
  product_id uuid references products(product_id),
  variant_id uuid references product_variants(variant_id),
  
  -- Configuración de precio
  pricing_method text not null default 'MARKUP' check (pricing_method in ('MARKUP', 'FIXED')),
  markup_percentage numeric(10,2) not null default 20,
  price_rounding text not null default 'NONE' check (price_rounding in ('NONE', 'UP', 'DOWN', 'NEAREST')),
  rounding_to numeric(10,2) not null default 1,
  
  -- Prioridad (mayor número = mayor prioridad)
  priority int not null default 0,
  
  -- Estado
  is_active boolean not null default true,
  
  -- Auditoría
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  -- Validación: Solo un nivel puede estar activo
  check (
    (scope='TENANT' and location_id is null and category_id is null and product_id is null and variant_id is null) or
    (scope='LOCATION' and location_id is not null and category_id is null and product_id is null and variant_id is null) or
    (scope='CATEGORY' and category_id is not null and product_id is null and variant_id is null) or
    (scope='PRODUCT' and product_id is not null and variant_id is null) or
    (scope='VARIANT' and variant_id is not null)
  )
);

-- Índices para mejorar rendimiento
create index if not exists idx_pricing_rules_tenant on pricing_rules(tenant_id);
create index if not exists idx_pricing_rules_location on pricing_rules(location_id) where location_id is not null;
create index if not exists idx_pricing_rules_category on pricing_rules(category_id) where category_id is not null;
create index if not exists idx_pricing_rules_product on pricing_rules(product_id) where product_id is not null;
create index if not exists idx_pricing_rules_variant on pricing_rules(variant_id) where variant_id is not null;
create index if not exists idx_pricing_rules_active on pricing_rules(tenant_id, is_active);

-- Trigger para actualizar updated_at
create or replace function trg_pricing_rules_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists pricing_rules_updated_at on pricing_rules;

create trigger pricing_rules_updated_at
  before update on pricing_rules
  for each row
  execute function trg_pricing_rules_updated_at();

-- Comentarios
comment on table pricing_rules is 'Políticas de precio centralizadas por tenant, sede, categoría, producto o variante';
comment on column pricing_rules.scope is 'Alcance: TENANT (global), LOCATION (sede), CATEGORY, PRODUCT, VARIANT';
comment on column pricing_rules.pricing_method is 'MARKUP (automático con margen) o FIXED (manual)';
comment on column pricing_rules.markup_percentage is 'Porcentaje de ganancia sobre el costo';
comment on column pricing_rules.price_rounding is 'Tipo de redondeo: NONE, UP, DOWN, NEAREST';
comment on column pricing_rules.rounding_to is 'Múltiplo al que redondear (ej: 1, 10, 100)';
comment on column pricing_rules.priority is 'Mayor número = mayor prioridad cuando hay conflictos';

-- =====================================================
-- FUNCIÓN: Obtener política de precio para una variante
-- =====================================================
create or replace function fn_get_pricing_policy(
  p_tenant uuid,
  p_variant uuid,
  p_location uuid default null
)
returns table (
  pricing_method text,
  markup_percentage numeric,
  price_rounding text,
  rounding_to numeric,
  source text -- VARIANT, PRODUCT, CATEGORY, LOCATION, TENANT
)
language plpgsql
stable
as $$
declare
  v_product_id uuid;
  v_category_id uuid;
begin
  -- Obtener información del producto y categoría
  select pv.product_id, p.category_id
    into v_product_id, v_category_id
    from product_variants pv
    join products p on p.product_id = pv.product_id
   where pv.tenant_id = p_tenant
     and pv.variant_id = p_variant;

  -- Buscar política en orden de prioridad (más específica primero)
  
  -- 1. VARIANT (más específica)
  return query
  select pr.pricing_method, pr.markup_percentage, pr.price_rounding, pr.rounding_to, 'VARIANT'::text as source
    from pricing_rules pr
   where pr.tenant_id = p_tenant
     and pr.scope = 'VARIANT'
     and pr.variant_id = p_variant
     and pr.is_active = true
   order by pr.priority desc
   limit 1;
  
  if found then
    return;
  end if;

  -- 2. PRODUCT
  return query
  select pr.pricing_method, pr.markup_percentage, pr.price_rounding, pr.rounding_to, 'PRODUCT'::text as source
    from pricing_rules pr
   where pr.tenant_id = p_tenant
     and pr.scope = 'PRODUCT'
     and pr.product_id = v_product_id
     and pr.is_active = true
   order by pr.priority desc
   limit 1;
  
  if found then
    return;
  end if;

  -- 3. CATEGORY
  if v_category_id is not null then
    return query
    select pr.pricing_method, pr.markup_percentage, pr.price_rounding, pr.rounding_to, 'CATEGORY'::text as source
      from pricing_rules pr
     where pr.tenant_id = p_tenant
       and pr.scope = 'CATEGORY'
       and pr.category_id = v_category_id
       and pr.is_active = true
     order by pr.priority desc
     limit 1;
    
    if found then
      return;
    end if;
  end if;

  -- 4. LOCATION (si se proporciona)
  if p_location is not null then
    return query
    select pr.pricing_method, pr.markup_percentage, pr.price_rounding, pr.rounding_to, 'LOCATION'::text as source
      from pricing_rules pr
     where pr.tenant_id = p_tenant
       and pr.scope = 'LOCATION'
       and pr.location_id = p_location
       and pr.is_active = true
     order by pr.priority desc
     limit 1;
    
    if found then
      return;
    end if;
  end if;

  -- 5. TENANT (global, por defecto)
  return query
  select pr.pricing_method, pr.markup_percentage, pr.price_rounding, pr.rounding_to, 'TENANT'::text as source
    from pricing_rules pr
   where pr.tenant_id = p_tenant
     and pr.scope = 'TENANT'
     and pr.is_active = true
   order by pr.priority desc
   limit 1;
  
  if found then
    return;
  end if;

  -- Si no hay ninguna política, devolver valores por defecto
  return query
  select 'MARKUP'::text, 20::numeric, 'NONE'::text, 1::numeric, 'DEFAULT'::text;
end;
$$;

comment on function fn_get_pricing_policy is 'Obtiene la política de precio aplicable a una variante según jerarquía: VARIANT > PRODUCT > CATEGORY > LOCATION > TENANT > DEFAULT';

-- =====================================================
-- FUNCIÓN: Calcular precio según política
-- =====================================================
create or replace function fn_calculate_price(
  p_tenant uuid,
  p_variant uuid,
  p_cost numeric,
  p_location uuid default null
)
returns numeric
language plpgsql
stable
as $$
declare
  v_policy record;
  v_price numeric;
  v_markup_amount numeric;
begin
  -- Obtener política aplicable
  select * into v_policy
    from fn_get_pricing_policy(p_tenant, p_variant, p_location)
   limit 1;

  -- Si el método es FIXED, mantener el precio actual de la variante
  if v_policy.pricing_method = 'FIXED' then
    select price into v_price
      from product_variants
     where tenant_id = p_tenant
       and variant_id = p_variant;
    return v_price;
  end if;

  -- Método MARKUP: calcular precio con margen
  v_markup_amount := p_cost * (v_policy.markup_percentage / 100.0);
  v_price := p_cost + v_markup_amount;

  -- Aplicar redondeo
  case v_policy.price_rounding
    when 'UP' then
      v_price := ceil(v_price / v_policy.rounding_to) * v_policy.rounding_to;
    when 'DOWN' then
      v_price := floor(v_price / v_policy.rounding_to) * v_policy.rounding_to;
    when 'NEAREST' then
      v_price := round(v_price / v_policy.rounding_to) * v_policy.rounding_to;
    else
      -- NONE: sin redondeo
      v_price := v_price;
  end case;

  return v_price;
end;
$$;

comment on function fn_calculate_price is 'Calcula el precio de venta según la política de precio aplicable y el costo dado';

-- =====================================================
-- RLS (Row Level Security)
-- =====================================================
alter table pricing_rules enable row level security;

-- Eliminar política anterior si existe
drop policy if exists pricing_rules_tenant_isolation on pricing_rules;

-- Política SELECT: Ver políticas de su tenant
create policy pricing_rules_select_policy on pricing_rules
  for select
  using (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

-- Política INSERT: Insertar políticas en su tenant
create policy pricing_rules_insert_policy on pricing_rules
  for insert
  with check (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

-- Política UPDATE: Actualizar políticas de su tenant
create policy pricing_rules_update_policy on pricing_rules
  for update
  using (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1))
  with check (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

-- Política DELETE: Eliminar políticas de su tenant
create policy pricing_rules_delete_policy on pricing_rules
  for delete
  using (tenant_id = (select tenant_id from users where auth_user_id = auth.uid() limit 1));

-- =====================================================
-- DATOS INICIALES
-- =====================================================
-- Ejemplo: Crear política global por defecto para cada tenant existente
-- (Descomenta y ejecuta si quieres crear políticas por defecto)

/*
insert into pricing_rules (tenant_id, scope, pricing_method, markup_percentage, price_rounding, rounding_to, priority)
select 
  t.tenant_id,
  'TENANT',
  'MARKUP',
  20,
  'NONE',
  1,
  0
from tenants t
where not exists (
  select 1 from pricing_rules pr 
  where pr.tenant_id = t.tenant_id 
  and pr.scope = 'TENANT'
);
*/
