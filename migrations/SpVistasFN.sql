/* ============================================================
   POS PYMES - SCRIPT ÚNICO (solo: FUNCTIONS + SP + VIEWS + ÍNDICES AUX)
   Requiere que YA existan las tablas del modelo:
   tenants, locations, users, categories, products, product_variants,
   payment_methods, sales, sale_lines, sale_payments, sale_returns,
   sale_return_lines, cash_sessions, cash_movements, inventory_moves,
   stock_balances, taxes, tax_rules, tenant_settings, etc.
   ============================================================ */

-- =========================
-- 0) CONSECUTIVOS DE VENTA
-- =========================
create table if not exists sale_counters (
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  location_id uuid not null references locations(location_id) on delete cascade,
  next_sale_number bigint not null default 1,
  primary key (tenant_id, location_id)
);

create or replace function fn_next_sale_number(p_tenant uuid, p_location uuid)
returns bigint
language plpgsql
as $$
declare
  v_number bigint;
begin
  insert into sale_counters(tenant_id, location_id, next_sale_number)
  values (p_tenant, p_location, 1)
  on conflict (tenant_id, location_id) do nothing;

  update sale_counters
     set next_sale_number = next_sale_number + 1
   where tenant_id = p_tenant
     and location_id = p_location
  returning next_sale_number - 1 into v_number;

  return v_number;
end;
$$;

-- ==========================================
-- 1) STOCK MATERIALIZADO (APLICAR DELTAS)
-- ==========================================
create or replace function fn_apply_stock_delta(
  p_tenant uuid,
  p_location uuid,
  p_variant uuid,
  p_delta numeric
) returns void
language plpgsql
as $$
begin
  insert into stock_balances(tenant_id, location_id, variant_id, on_hand, updated_at)
  values (p_tenant, p_location, p_variant, p_delta, now())
  on conflict (tenant_id, location_id, variant_id)
  do update set
    on_hand = stock_balances.on_hand + excluded.on_hand,
    updated_at = now();
end;
$$;

-- ==================================
-- 2) IMPUESTOS: RATE POR VARIANTE
-- ==================================
create or replace function fn_get_tax_rate_for_variant(
  p_tenant uuid,
  p_variant uuid
) returns numeric
language sql
as $$
  with v as (
    select pv.variant_id, pv.product_id, p.category_id
    from product_variants pv
    join products p on p.product_id = pv.product_id
    where pv.tenant_id = p_tenant and pv.variant_id = p_variant
  ),
  rules as (
    select tr.*, t.rate,
           case tr.scope
             when 'VARIANT' then 4
             when 'PRODUCT' then 3
             when 'CATEGORY' then 2
             when 'TENANT' then 1
             else 0
           end as scope_weight
    from tax_rules tr
    join taxes t on t.tax_id = tr.tax_id
    join v on true
    where tr.tenant_id = p_tenant
      and tr.is_active = true
      and t.is_active = true
      and (
        (tr.scope='VARIANT' and tr.variant_id = v.variant_id) or
        (tr.scope='PRODUCT' and tr.product_id = v.product_id) or
        (tr.scope='CATEGORY' and tr.category_id = v.category_id) or
        (tr.scope='TENANT')
      )
  )
  select coalesce(
    (select rate
       from rules
      order by scope_weight desc, priority desc
      limit 1),
    0
  );
$$;

-- =========================
-- 3) SP: CREAR VENTA (ATÓMICA)
-- =========================
/*
p_lines jsonb ejemplo:
[
  {"variant_id":"...","qty":2,"unit_price":15000,"discount":0},
  {"variant_id":"...","qty":1,"unit_price":5000,"discount":500}
]

p_payments jsonb ejemplo:
[
  {"payment_method_code":"CASH","amount":20000,"reference":null},
  {"payment_method_code":"CARD","amount":5000,"reference":"VOUCHER123"}
]
*/
create or replace function sp_create_sale(
  p_tenant uuid,
  p_location uuid,
  p_cash_session uuid,
  p_customer uuid,
  p_sold_by uuid,
  p_lines jsonb,
  p_payments jsonb,
  p_note text default null
) returns uuid
language plpgsql
as $$
declare
  v_sale_id uuid;
  v_sale_number bigint;

  v_subtotal numeric(14,2) := 0;
  v_discount_total numeric(14,2) := 0;
  v_tax_total numeric(14,2) := 0;
  v_total numeric(14,2) := 0;

  v_line jsonb;
  v_variant uuid;
  v_qty numeric(14,3);
  v_unit_price numeric(14,2);
  v_discount numeric(14,2);
  v_cost numeric(14,2);
  v_tax_rate numeric;
  v_tax_amount numeric(14,2);
  v_line_base numeric(14,2);
  v_line_total numeric(14,2);

  v_payment jsonb;
  v_payment_method_id uuid;
  v_payment_code text;
  v_payment_amount numeric(14,2);
  v_payment_ref text;
  v_paid_total numeric(14,2) := 0;

  v_on_hand numeric(14,3);
  v_allow_backorder boolean;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Sale must have at least one line';
  end if;

  if p_payments is null or jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 then
    raise exception 'Sale must have at least one payment';
  end if;

  -- Validar sesión de caja si viene
  if p_cash_session is not null then
    perform 1
      from cash_sessions cs
     where cs.tenant_id = p_tenant
       and cs.cash_session_id = p_cash_session
       and cs.status = 'OPEN';
    if not found then
      raise exception 'Cash session is not OPEN or not found';
    end if;
  end if;

  v_sale_number := fn_next_sale_number(p_tenant, p_location);

  insert into sales(
    tenant_id, location_id, cash_session_id, sale_number,
    status, sold_at, customer_id, sold_by,
    subtotal, discount_total, tax_total, total, note
  )
  values (
    p_tenant, p_location, p_cash_session, v_sale_number,
    'COMPLETED', now(), p_customer, p_sold_by,
    0, 0, 0, 0, p_note
  )
  returning sale_id into v_sale_id;

  -- Líneas + inventario
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_variant := (v_line->>'variant_id')::uuid;
    v_qty := (v_line->>'qty')::numeric;
    v_unit_price := (v_line->>'unit_price')::numeric;
    v_discount := coalesce((v_line->>'discount')::numeric, 0);

    if v_qty <= 0 then
      raise exception 'Invalid qty for variant %', v_variant;
    end if;
    if v_unit_price < 0 then
      raise exception 'Invalid unit_price for variant %', v_variant;
    end if;
    if v_discount < 0 then
      raise exception 'Invalid discount for variant %', v_variant;
    end if;

    select pv.cost
      into v_cost
      from product_variants pv
     where pv.tenant_id = p_tenant and pv.variant_id = v_variant and pv.is_active = true;

    if not found then
      raise exception 'Variant not found/active: %', v_variant;
    end if;

    -- Obtener allow_backorder de la variante
    select pv.allow_backorder
      into v_allow_backorder
      from product_variants pv
     where pv.tenant_id = p_tenant and pv.variant_id = v_variant;

    -- Obtener stock disponible (puede no existir registro)
    select (sb.on_hand - sb.reserved)
      into v_on_hand
      from stock_balances sb
     where sb.tenant_id = p_tenant and sb.location_id = p_location and sb.variant_id = v_variant;

    -- Si no existe registro en stock_balances, considerar stock = 0
    if v_on_hand is null then
      v_on_hand := 0;
    end if;

    -- Si NO permite sobreventa (allow_backorder = false o NULL), validar stock disponible
    if coalesce(v_allow_backorder, false) = false and v_on_hand < v_qty then
      raise exception 'Stock insuficiente para la variante % (disponible=%, requerido=%)', v_variant, v_on_hand, v_qty;
    end if;

    v_tax_rate := fn_get_tax_rate_for_variant(p_tenant, v_variant);

    v_line_base := round((v_qty * v_unit_price) - v_discount, 2);
    if v_line_base < 0 then v_line_base := 0; end if;

    v_tax_amount := round(v_line_base * v_tax_rate, 2);
    v_line_total := v_line_base + v_tax_amount;

    insert into sale_lines(
      tenant_id, sale_id, variant_id, quantity,
      unit_price, unit_cost, discount_amount,
      tax_amount, line_total, tax_detail
    )
    values (
      p_tenant, v_sale_id, v_variant, v_qty,
      v_unit_price, v_cost, v_discount,
      v_tax_amount, v_line_total,
      jsonb_build_object('rate', v_tax_rate)
    );

    insert into inventory_moves(
      tenant_id, move_type, location_id, variant_id, quantity, unit_cost,
      source, source_id, note, created_at, created_by
    )
    values(
      p_tenant, 'SALE_OUT', p_location, v_variant, v_qty, v_cost,
      'SALE', v_sale_id, null, now(), p_sold_by
    );

    perform fn_apply_stock_delta(p_tenant, p_location, v_variant, -v_qty);

    v_subtotal := v_subtotal + round(v_qty * v_unit_price, 2);
    v_discount_total := v_discount_total + v_discount;
    v_tax_total := v_tax_total + v_tax_amount;
  end loop;

  v_total := round((v_subtotal - v_discount_total) + v_tax_total, 2);

  -- Pagos
  for v_payment in select * from jsonb_array_elements(p_payments)
  loop
    v_payment_code := upper(v_payment->>'payment_method_code');
    v_payment_amount := (v_payment->>'amount')::numeric;
    v_payment_ref := v_payment->>'reference';

    if v_payment_amount <= 0 then
      raise exception 'Invalid payment amount';
    end if;

    select pm.payment_method_id
      into v_payment_method_id
      from payment_methods pm
     where pm.tenant_id = p_tenant
       and pm.code = v_payment_code
       and pm.is_active = true;

    if not found then
      raise exception 'Payment method not found/active: %', v_payment_code;
    end if;

    insert into sale_payments(
      tenant_id, sale_id, payment_method_id, cash_session_id, amount, reference, paid_at
    )
    values(
      p_tenant, v_sale_id, v_payment_method_id, p_cash_session, v_payment_amount, v_payment_ref, now()
    );

    v_paid_total := v_paid_total + v_payment_amount;
  end loop;

  if round(v_paid_total,2) <> round(v_total,2) then
    raise exception 'Payments total (%) must equal sale total (%)', v_paid_total, v_total;
  end if;

  update sales
     set subtotal = round(v_subtotal,2),
         discount_total = round(v_discount_total,2),
         tax_total = round(v_tax_total,2),
         total = v_total
   where sale_id = v_sale_id;

  return v_sale_id;
end;
$$;

-- =========================
-- 4) SP: CREAR DEVOLUCIÓN
-- =========================
/*
p_lines jsonb ejemplo:
[
  {"sale_line_id":"...","qty":1,"reason":"Defectuoso"},
  {"sale_line_id":"...","qty":2}
]
*/
create or replace function sp_create_return(
  p_tenant uuid,
  p_sale_id uuid,
  p_created_by uuid,
  p_lines jsonb,
  p_reason text default null
) returns uuid
language plpgsql
as $$
declare
  v_return_id uuid;
  v_location uuid;

  v_line jsonb;
  v_sale_line_id uuid;
  v_variant uuid;
  v_qty numeric(14,3);
  v_unit_price numeric(14,2);
  v_tax_rate numeric;
  v_tax_amount numeric(14,2);
  v_line_base numeric(14,2);
  v_line_total numeric(14,2);

  v_refund_total numeric(14,2) := 0;

  v_total_returned_qty numeric(14,3);
  v_total_sold_qty numeric(14,3);
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines)=0 then
    raise exception 'Return must have at least one line';
  end if;

  -- Obtener venta y validar
  select s.location_id into v_location
    from sales s
   where s.tenant_id = p_tenant
     and s.sale_id = p_sale_id
     and s.status <> 'VOIDED';

  if not found then
    raise exception 'Sale not found or voided';
  end if;

  insert into sale_returns(
    tenant_id, sale_id, location_id, created_at, created_by, reason, status, refund_total
  )
  values(
    p_tenant, p_sale_id, v_location, now(), p_created_by, coalesce(p_reason,''), 'COMPLETED', 0
  )
  returning return_id into v_return_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_sale_line_id := (v_line->>'sale_line_id')::uuid;
    v_qty := (v_line->>'qty')::numeric;

    if v_qty <= 0 then
      raise exception 'Invalid return qty';
    end if;

    select sl.variant_id, sl.unit_price
      into v_variant, v_unit_price
      from sale_lines sl
     where sl.tenant_id = p_tenant
       and sl.sale_line_id = v_sale_line_id
       and sl.sale_id = p_sale_id;

    if not found then
      raise exception 'Sale line not found: %', v_sale_line_id;
    end if;

    -- Evitar devolver más de lo vendido (considerando devoluciones previas)
    select coalesce(sum(rl.quantity),0)
      into v_total_returned_qty
      from sale_return_lines rl
      join sale_returns r on r.return_id = rl.return_id
     where r.tenant_id = p_tenant
       and r.sale_id = p_sale_id
       and rl.sale_line_id = v_sale_line_id;

    select coalesce(sl.quantity,0)
      into v_total_sold_qty
      from sale_lines sl
     where sl.tenant_id = p_tenant
       and sl.sale_line_id = v_sale_line_id;

    if (v_total_returned_qty + v_qty) > v_total_sold_qty then
      raise exception 'Return qty exceeds sold qty for sale_line % (sold=%, returned=%, requested=%)',
        v_sale_line_id, v_total_sold_qty, v_total_returned_qty, v_qty;
    end if;

    v_tax_rate := fn_get_tax_rate_for_variant(p_tenant, v_variant);
    v_line_base := round(v_qty * v_unit_price, 2);
    v_tax_amount := round(v_line_base * v_tax_rate, 2);
    v_line_total := v_line_base + v_tax_amount;

    insert into sale_return_lines(
      tenant_id, return_id, sale_line_id, variant_id, quantity, unit_price, tax_amount, line_total
    )
    values(
      p_tenant, v_return_id, v_sale_line_id, v_variant, v_qty, v_unit_price, v_tax_amount, v_line_total
    );

    insert into inventory_moves(
      tenant_id, move_type, location_id, variant_id, quantity, unit_cost,
      source, source_id, note, created_at, created_by
    )
    values(
      p_tenant, 'RETURN_IN', v_location, v_variant, v_qty, 0,
      'RETURN', v_return_id, null, now(), p_created_by
    );

    perform fn_apply_stock_delta(p_tenant, v_location, v_variant, v_qty);

    v_refund_total := v_refund_total + v_line_total;
  end loop;

  update sale_returns
     set refund_total = round(v_refund_total, 2)
   where return_id = v_return_id;

  -- Actualizar status de la venta: RETURNED o PARTIAL_RETURN
  select coalesce(sum(rl.quantity),0)
    into v_total_returned_qty
    from sale_return_lines rl
    join sale_returns r on r.return_id = rl.return_id
   where r.tenant_id = p_tenant
     and r.sale_id = p_sale_id;

  select coalesce(sum(sl.quantity),0)
    into v_total_sold_qty
    from sale_lines sl
   where sl.tenant_id = p_tenant
     and sl.sale_id = p_sale_id;

  update sales
     set status = case
       when v_total_returned_qty >= v_total_sold_qty then 'RETURNED'
       else 'PARTIAL_RETURN'
     end
   where sale_id = p_sale_id;

  return v_return_id;
end;
$$;

-- =========================
-- 5) SP: CIERRE DE CAJA
-- =========================
create or replace function sp_close_cash_session(
  p_tenant uuid,
  p_cash_session uuid,
  p_closed_by uuid,
  p_counted_amount numeric(14,2)
) returns void
language plpgsql
as $$
declare
  v_opening numeric(14,2);
  v_expected numeric(14,2);
  v_sales_cash numeric(14,2);
  v_layaway_cash numeric(14,2);
  v_incomes numeric(14,2);
  v_expenses numeric(14,2);
begin
  select cs.opening_amount
    into v_opening
    from cash_sessions cs
   where cs.tenant_id = p_tenant
     and cs.cash_session_id = p_cash_session
     and cs.status = 'OPEN'
   for update;

  if not found then
    raise exception 'Cash session not found or not OPEN';
  end if;

  -- Ventas en efectivo
  select coalesce(sum(sp.amount),0)
    into v_sales_cash
    from sale_payments sp
    join payment_methods pm on pm.payment_method_id = sp.payment_method_id
   where sp.tenant_id = p_tenant
     and sp.cash_session_id = p_cash_session
     and pm.code = 'CASH';

  -- Abonos de plan separe en efectivo
  select coalesce(sum(lp.amount),0)
    into v_layaway_cash
    from layaway_payments lp
    join payment_methods pm on pm.payment_method_id = lp.payment_method_id
   where lp.tenant_id = p_tenant
     and lp.cash_session_id = p_cash_session
     and pm.code = 'CASH';

  -- Ingresos manuales
  select coalesce(sum(cm.amount),0)
    into v_incomes
    from cash_movements cm
   where cm.tenant_id = p_tenant
     and cm.cash_session_id = p_cash_session
     and cm.type = 'INCOME';

  -- Gastos
  select coalesce(sum(cm.amount),0)
    into v_expenses
    from cash_movements cm
   where cm.tenant_id = p_tenant
     and cm.cash_session_id = p_cash_session
     and cm.type = 'EXPENSE';

  -- Efectivo esperado = apertura + ventas + abonos separe + ingresos - gastos
  v_expected := round(v_opening + v_sales_cash + v_layaway_cash + v_incomes - v_expenses, 2);

  update cash_sessions
     set closed_by = p_closed_by,
         closed_at = now(),
         closing_amount_counted = round(p_counted_amount,2),
         closing_amount_expected = v_expected,
         difference = round(p_counted_amount,2) - v_expected,
         status = 'CLOSED'
   where cash_session_id = p_cash_session;
end;
$$;

-- =========================
-- 6) VISTAS: STOCK Y KARDEX
-- =========================

-- 6.1 Stock actual (si usas stock_balances, es la más rápida)
create or replace view vw_stock_current as
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
  sb.updated_at
from stock_balances sb
join locations l on l.location_id = sb.location_id
join product_variants pv on pv.variant_id = sb.variant_id
join products p on p.product_id = pv.product_id;

-- 6.2 Stock calculado (si NO materializas, calcula desde inventory_moves)
create or replace view vw_stock_calculated as
select
  im.tenant_id,
  im.location_id,
  l.name as location_name,
  im.variant_id,
  pv.sku,
  p.product_id,
  p.name as product_name,
  pv.variant_name,
  sum(
    case
      when im.move_type in ('PURCHASE_IN','RETURN_IN','ADJUSTMENT','TRANSFER_IN') then im.quantity
      when im.move_type in ('SALE_OUT','TRANSFER_OUT') then -im.quantity
      else 0
    end
  ) as on_hand
from inventory_moves im
join locations l on l.location_id = im.location_id
join product_variants pv on pv.variant_id = im.variant_id
join products p on p.product_id = pv.product_id
group by im.tenant_id, im.location_id, l.name, im.variant_id, pv.sku, p.product_id, p.name, pv.variant_name;

-- 6.3 Kardex (ledger) con signo (entradas positivas, salidas negativas)
create or replace view vw_kardex as
select
  im.tenant_id,
  im.location_id,
  l.name as location_name,
  im.variant_id,
  pv.sku,
  p.name as product_name,
  pv.variant_name,
  im.created_at,
  im.move_type,
  im.source,
  im.source_id,
  case
    when im.move_type in ('PURCHASE_IN','RETURN_IN','ADJUSTMENT','TRANSFER_IN') then im.quantity
    when im.move_type in ('SALE_OUT','TRANSFER_OUT') then -im.quantity
    else 0
  end as signed_qty,
  im.quantity as abs_qty,
  im.unit_cost,
  im.note,
  im.created_by
from inventory_moves im
join locations l on l.location_id = im.location_id
join product_variants pv on pv.variant_id = im.variant_id
join products p on p.product_id = pv.product_id;

-- 6.4 Ventas para reportes (header + totales)
create or replace view vw_sales_summary as
select
  s.tenant_id,
  s.location_id,
  l.name as location_name,
  s.sale_id,
  s.sale_number,
  s.status,
  s.sold_at,
  s.customer_id,
  c.full_name as customer_name,
  s.sold_by,
  u.full_name as sold_by_name,
  s.subtotal,
  s.discount_total,
  s.tax_total,
  s.total
from sales s
join locations l on l.location_id = s.location_id
join users u on u.user_id = s.sold_by
left join customers c on c.customer_id = s.customer_id;

-- 6.5 Plan Separe para reportes (resumen de contratos)
create or replace view vw_layaway_report as
select
  lc.tenant_id,
  lc.location_id,
  l.name as location_name,
  lc.layaway_id,
  lc.status,
  lc.created_at,
  lc.created_by,
  u.full_name as created_by_name,
  lc.customer_id,
  c.full_name as customer_name,
  c.document as customer_document,
  c.phone as customer_phone,
  lc.due_date,
  lc.subtotal,
  lc.discount_total,
  lc.tax_total,
  lc.total,
  lc.initial_deposit,
  lc.paid_total,
  lc.balance,
  lc.sale_id,
  s.sale_number as converted_sale_number,
  -- Métricas útiles
  case 
    when lc.balance = 0 and lc.status = 'COMPLETED' then 'Completado'
    when lc.balance > 0 and lc.status = 'ACTIVE' then 'Pendiente'
    when lc.status = 'CANCELLED' then 'Cancelado'
    when lc.status = 'EXPIRED' then 'Expirado'
    else lc.status
  end as status_label,
  case 
    when lc.total > 0 then round((lc.paid_total / lc.total) * 100, 2)
    else 0
  end as payment_percentage,
  case
    when lc.due_date is not null and lc.status = 'ACTIVE' then
      case
        when lc.due_date < current_date then 'Vencido'
        when lc.due_date <= current_date + interval '7 days' then 'Por vencer'
        else 'Vigente'
      end
    else null
  end as due_status
from layaway_contracts lc
join locations l on l.location_id = lc.location_id
join users u on u.user_id = lc.created_by
join customers c on c.customer_id = lc.customer_id
left join sales s on s.sale_id = lc.sale_id;

-- 6.6 Abonos de Plan Separe para reportes
create or replace view vw_layaway_payments_report as
select
  lp.tenant_id,
  lp.layaway_id,
  lc.status as contract_status,
  lp.layaway_payment_id,
  lp.paid_at,
  lp.paid_by,
  u.full_name as paid_by_name,
  lp.payment_method_id,
  pm.code as payment_method_code,
  pm.name as payment_method_name,
  lp.amount,
  lp.reference,
  lp.cash_session_id,
  cs.cash_register_id,
  cr.name as cash_register_name,
  -- Datos del contrato
  lc.location_id,
  l.name as location_name,
  lc.customer_id,
  c.full_name as customer_name,
  lc.total as contract_total,
  lc.balance as contract_balance
from layaway_payments lp
join layaway_contracts lc on lc.layaway_id = lp.layaway_id and lc.tenant_id = lp.tenant_id
join payment_methods pm on pm.payment_method_id = lp.payment_method_id
join locations l on l.location_id = lc.location_id
join customers c on c.customer_id = lc.customer_id
left join users u on u.user_id = lp.paid_by
left join cash_sessions cs on cs.cash_session_id = lp.cash_session_id
left join cash_registers cr on cr.cash_register_id = cs.cash_register_id;

-- 6.7 Productos en Plan Separe (inventario reservado)
create or replace view vw_layaway_inventory as
select
  li.tenant_id,
  lc.location_id,
  l.name as location_name,
  li.layaway_id,
  lc.status as contract_status,
  lc.customer_id,
  c.full_name as customer_name,
  li.variant_id,
  pv.sku,
  p.product_id,
  p.name as product_name,
  pv.variant_name,
  li.quantity,
  li.unit_price,
  li.discount_amount,
  li.line_total,
  -- Stock disponible
  sb.on_hand,
  sb.reserved,
  (sb.on_hand - sb.reserved) as available,
  -- Fechas
  lc.created_at as contract_created_at,
  lc.due_date
from layaway_items li
join layaway_contracts lc on lc.layaway_id = li.layaway_id and lc.tenant_id = li.tenant_id
join locations l on l.location_id = lc.location_id
join customers c on c.customer_id = lc.customer_id
join product_variants pv on pv.variant_id = li.variant_id
join products p on p.product_id = pv.product_id
left join stock_balances sb on sb.tenant_id = li.tenant_id 
  and sb.location_id = lc.location_id 
  and sb.variant_id = li.variant_id;

-- 6.8 Consolidado de ingresos (ventas + abonos plan separe)
create or replace view vw_income_consolidated as
-- Ventas
select
  s.tenant_id,
  s.location_id,
  l.name as location_name,
  'VENTA' as income_type,
  s.sale_id as source_id,
  s.sale_number::text as source_number,
  s.sold_at as income_date,
  s.customer_id,
  c.full_name as customer_name,
  sp.payment_method_id,
  pm.code as payment_method_code,
  pm.name as payment_method_name,
  sp.amount,
  sp.cash_session_id,
  s.sold_by as handled_by,
  u.full_name as handled_by_name
from sales s
join sale_payments sp on sp.sale_id = s.sale_id and sp.tenant_id = s.tenant_id
join locations l on l.location_id = s.location_id
join payment_methods pm on pm.payment_method_id = sp.payment_method_id
join users u on u.user_id = s.sold_by
left join customers c on c.customer_id = s.customer_id
where s.status in ('COMPLETED', 'PARTIAL_RETURN', 'RETURNED')

union all

-- Abonos Plan Separe
select
  lc.tenant_id,
  lc.location_id,
  l.name as location_name,
  'ABONO_SEPARE' as income_type,
  lp.layaway_payment_id as source_id,
  lc.layaway_id::text as source_number,
  lp.paid_at as income_date,
  lc.customer_id,
  c.full_name as customer_name,
  lp.payment_method_id,
  pm.code as payment_method_code,
  pm.name as payment_method_name,
  lp.amount,
  lp.cash_session_id,
  lp.paid_by as handled_by,
  u.full_name as handled_by_name
from layaway_payments lp
join layaway_contracts lc on lc.layaway_id = lp.layaway_id and lc.tenant_id = lp.tenant_id
join locations l on l.location_id = lc.location_id
join payment_methods pm on pm.payment_method_id = lp.payment_method_id
join customers c on c.customer_id = lc.customer_id
left join users u on u.user_id = lp.paid_by;

-- =========================
-- 7) ÍNDICES AUXILIARES (opcional)
-- =========================
create index if not exists ix_sale_counters_tenant_loc on sale_counters(tenant_id, location_id);
create index if not exists ix_stock_balances_lookup on stock_balances(tenant_id, location_id, variant_id);
create index if not exists ix_inventory_moves_lookup on inventory_moves(tenant_id, location_id, variant_id, created_at desc);
create index if not exists ix_sales_tenant_date on sales(tenant_id, sold_at desc);
create index if not exists ix_sale_payments_session on sale_payments(tenant_id, cash_session_id);

-- =========================
-- 7.5) SISTEMA DE ALERTAS EN TIEMPO REAL
-- =========================

-- Vista de alertas de stock (solo productos con problemas)
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

-- Tabla de alertas del sistema
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

-- Función para refrescar alertas de stock
create or replace function fn_refresh_stock_alerts()
returns void
language plpgsql
as $$
begin
  -- Eliminar alertas de stock que ya no aplican
  delete from system_alerts
  where alert_type = 'STOCK'
    and reference_id not in (
      select distinct variant_id
      from vw_stock_alerts
    );

  -- Insertar o actualizar alertas de stock actuales
  insert into system_alerts (tenant_id, alert_type, alert_level, reference_id, data)
  select
    tenant_id,
    'STOCK' as alert_type,
    alert_level,
    variant_id as reference_id,
    jsonb_build_object(
      'location_id', location_id,
      'location_name', location_name,
      'variant_id', variant_id,
      'sku', sku,
      'product_name', product_name,
      'variant_name', variant_name,
      'on_hand', on_hand,
      'reserved', reserved,
      'available', available,
      'min_stock', min_stock,
      'alert_level', alert_level
    ) as data
  from vw_stock_alerts
  on conflict (tenant_id, alert_type, reference_id)
  do update set
    alert_level = excluded.alert_level,
    data = excluded.data,
    updated_at = now();
end;
$$;

-- Función para refrescar alertas de layaway
create or replace function fn_refresh_layaway_alerts()
returns void
language plpgsql
as $$
begin
  -- Eliminar alertas de layaway que ya no aplican (completados, cancelados o sin vencer pronto)
  delete from system_alerts
  where alert_type = 'LAYAWAY'
    and reference_id not in (
      select layaway_id
      from layaway_contracts
      where status = 'ACTIVE'
        and due_date is not null
        and due_date <= current_date + interval '7 days'
    );

  -- Insertar o actualizar alertas de layaway actuales
  insert into system_alerts (tenant_id, alert_type, alert_level, reference_id, data)
  select
    lc.tenant_id,
    'LAYAWAY' as alert_type,
    case
      when lc.due_date < current_date then 'EXPIRED'
      when lc.due_date <= current_date + interval '7 days' then 'DUE_SOON'
      else 'UPCOMING'
    end as alert_level,
    lc.layaway_id as reference_id,
    jsonb_build_object(
      'layaway_id', lc.layaway_id,
      'location_id', lc.location_id,
      'location_name', l.name,
      'customer_id', lc.customer_id,
      'customer_name', c.full_name,
      'customer_document', c.document,
      'customer_phone', c.phone,
      'due_date', lc.due_date,
      'total', lc.total,
      'paid_total', lc.paid_total,
      'balance', lc.balance,
      'days_until_due', (lc.due_date - current_date),
      'alert_level', case
        when lc.due_date < current_date then 'EXPIRED'
        when lc.due_date <= current_date + interval '7 days' then 'DUE_SOON'
        else 'UPCOMING'
      end
    ) as data
  from layaway_contracts lc
  join locations l on l.location_id = lc.location_id
  join customers c on c.customer_id = lc.customer_id
  where lc.status = 'ACTIVE'
    and lc.due_date is not null
    and lc.due_date <= current_date + interval '7 days'
  on conflict (tenant_id, alert_type, reference_id)
  do update set
    alert_level = excluded.alert_level,
    data = excluded.data,
    updated_at = now();
end;
$$;

-- Trigger para actualizar alertas de stock cuando cambie stock_balances
create or replace function trg_stock_balances_alert()
returns trigger
language plpgsql
as $$
begin
  -- Refrescar solo las alertas del tenant afectado
  delete from system_alerts sa
  where sa.alert_type = 'STOCK'
    and sa.tenant_id = coalesce(new.tenant_id, old.tenant_id)
    and sa.reference_id not in (
      select distinct v.variant_id
      from vw_stock_alerts v
      where v.tenant_id = coalesce(new.tenant_id, old.tenant_id)
    );

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
  where v.tenant_id = coalesce(new.tenant_id, old.tenant_id)
  on conflict (tenant_id, alert_type, reference_id)
  do update set
    alert_level = excluded.alert_level,
    data = excluded.data,
    updated_at = now();

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_stock_balances_alert_after on stock_balances;
create trigger trg_stock_balances_alert_after
after insert or update or delete on stock_balances
for each row
execute function trg_stock_balances_alert();

-- Trigger para actualizar alertas de stock cuando cambie product_variants (min_stock)
create or replace function trg_product_variants_alert()
returns trigger
language plpgsql
as $$
begin
  if new.min_stock is distinct from old.min_stock then
    perform fn_refresh_stock_alerts();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_product_variants_alert_after on product_variants;
create trigger trg_product_variants_alert_after
after update on product_variants
for each row
execute function trg_product_variants_alert();

-- Trigger para actualizar alertas de layaway cuando cambie layaway_contracts
create or replace function trg_layaway_contracts_alert()
returns trigger
language plpgsql
as $$
begin
  perform fn_refresh_layaway_alerts();
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_layaway_contracts_alert_after on layaway_contracts;
create trigger trg_layaway_contracts_alert_after
after insert or update or delete on layaway_contracts
for each row
execute function trg_layaway_contracts_alert();

-- Inicializar alertas existentes (ejecutar una vez al desplegar)
-- select fn_refresh_stock_alerts();
-- select fn_refresh_layaway_alerts();

-- =========================
-- 8) ASIGNACIÓN CAJERO→CAJA + SESIÓN ÚNICA
-- =========================

-- 8.1 Tabla de asignaciones cajero-caja
create table if not exists cash_register_assignments (
  assignment_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  cash_register_id uuid not null references cash_registers(cash_register_id) on delete cascade,
  user_id uuid not null references users(user_id) on delete cascade,
  is_active boolean not null default true,
  assigned_at timestamptz not null default now(),
  assigned_by uuid not null references users(user_id),
  note text,
  unique (tenant_id, cash_register_id, user_id)
);

create index if not exists ix_cash_register_assignments_lookup
on cash_register_assignments(tenant_id, user_id, cash_register_id, is_active);

-- 8.2 Restricciones: un usuario solo puede tener 1 sesión OPEN, y una caja solo 1 sesión OPEN
create unique index if not exists ux_cash_sessions_one_open_per_user
on cash_sessions(tenant_id, opened_by)
where status = 'OPEN';

create unique index if not exists ux_cash_sessions_one_open_per_register
on cash_sessions(tenant_id, cash_register_id)
where status = 'OPEN';

-- 8.3 Validar si usuario puede usar una caja
create or replace function fn_user_can_use_cash_register(
  p_tenant uuid,
  p_user uuid,
  p_cash_register uuid
) returns boolean
language sql
as $$
  select exists (
    select 1
    from cash_register_assignments a
    where a.tenant_id = p_tenant
      and a.user_id = p_user
      and a.cash_register_id = p_cash_register
      and a.is_active = true
  );
$$;

-- 8.4 Obtener sesión abierta del usuario
create or replace function fn_get_open_cash_session_for_user(
  p_tenant uuid,
  p_user uuid
) returns uuid
language sql
as $$
  select cs.cash_session_id
  from cash_sessions cs
  where cs.tenant_id = p_tenant
    and cs.opened_by = p_user
    and cs.status = 'OPEN'
  order by cs.opened_at desc
  limit 1;
$$;

-- 8.5 Vista de cajas asignadas al usuario
create or replace view vw_user_cash_registers as
select
  a.tenant_id,
  a.user_id,
  u.full_name as user_name,
  a.cash_register_id,
  cr.name as cash_register_name,
  cr.location_id,
  l.name as location_name,
  a.is_active,
  a.assigned_at,
  a.assigned_by
from cash_register_assignments a
join users u on u.user_id = a.user_id
join cash_registers cr on cr.cash_register_id = a.cash_register_id
join locations l on l.location_id = cr.location_id;

-- 8.6 SP: Asignar caja a cajero (solo Admin)
create or replace function sp_assign_cash_register_to_user(
  p_tenant uuid,
  p_cash_register uuid,
  p_user uuid,
  p_assigned_by uuid,
  p_is_active boolean default true,
  p_note text default null
) returns void
language plpgsql
as $$
begin
  insert into cash_register_assignments(
    tenant_id, cash_register_id, user_id, is_active, assigned_at, assigned_by, note
  )
  values(
    p_tenant, p_cash_register, p_user, p_is_active, now(), p_assigned_by, p_note
  )
  on conflict (tenant_id, cash_register_id, user_id)
  do update set
    is_active = excluded.is_active,
    assigned_at = now(),
    assigned_by = excluded.assigned_by,
    note = excluded.note;
end;
$$;

-- 8.7 SP: Abrir sesión con validación de asignación
create or replace function sp_open_cash_session(
  p_tenant uuid,
  p_cash_register uuid,
  p_opened_by uuid,
  p_opening_amount numeric(14,2)
) returns uuid
language plpgsql
as $$
declare
  v_session uuid;
  v_existing uuid;
begin
  if not fn_user_can_use_cash_register(p_tenant, p_opened_by, p_cash_register) then
    raise exception 'User is not assigned to this cash register';
  end if;

  v_existing := fn_get_open_cash_session_for_user(p_tenant, p_opened_by);
  if v_existing is not null then
    return v_existing;
  end if;

  insert into cash_sessions(
    tenant_id, cash_register_id, opened_by, opened_at, opening_amount, status
  )
  values(
    p_tenant, p_cash_register, p_opened_by, now(), coalesce(p_opening_amount,0), 'OPEN'
  )
  returning cash_session_id into v_session;

  return v_session;
exception
  when unique_violation then
    v_existing := fn_get_open_cash_session_for_user(p_tenant, p_opened_by);
    if v_existing is not null then
      return v_existing;
    end if;
    raise;
end;
$$;

-- 8.8 SP: Cerrar sesión con validación de dueño
create or replace function sp_close_cash_session_secure(
  p_tenant uuid,
  p_cash_session uuid,
  p_closed_by uuid,
  p_counted_amount numeric(14,2)
) returns void
language plpgsql
as $$
begin
  perform 1
  from cash_sessions cs
  where cs.tenant_id = p_tenant
    and cs.cash_session_id = p_cash_session
    and cs.status = 'OPEN'
    and cs.opened_by = p_closed_by
  for update;

  if not found then
    raise exception 'Cash session not found/OPEN or not owned by user';
  end if;

  perform sp_close_cash_session(p_tenant, p_cash_session, p_closed_by, p_counted_amount);
end;
$$;

-- 8.9 Función: Contexto POS para Home (qué mostrar al login)
create or replace function fn_pos_home_context(
  p_tenant uuid,
  p_user uuid
) returns table(
  open_cash_session_id uuid,
  assigned_registers_count int,
  single_cash_register_id uuid
)
language sql
as $$
  with open_s as (
    select fn_get_open_cash_session_for_user(p_tenant, p_user) as sid
  ),
  regs as (
    select a.cash_register_id
    from cash_register_assignments a
    where a.tenant_id=p_tenant and a.user_id=p_user and a.is_active=true
  )
  select
    (select sid from open_s) as open_cash_session_id,
    (select count(*)::int from regs) as assigned_registers_count,
    (case when (select count(*) from regs)=1 then (select cash_register_id from regs limit 1) else null end) as single_cash_register_id;
$$;

-- =========================
-- 9) COSTO PROMEDIO PONDERADO
-- =========================

-- 9.0 Agregar columnas de configuración de precios a product_variants
alter table product_variants
  add column if not exists pricing_method text default 'MARKUP' check (pricing_method in ('MARKUP', 'FIXED')),
  add column if not exists markup_percentage numeric(10,2) default 20,
  add column if not exists price_rounding text default 'NONE' check (price_rounding in ('NONE', 'UP', 'DOWN', 'NEAREST')),
  add column if not exists rounding_to numeric(14,2) default 1;

comment on column product_variants.pricing_method is 'Método de cálculo de precio: MARKUP (automático con margen) o FIXED (manual)';
comment on column product_variants.markup_percentage is 'Porcentaje de ganancia sobre el costo (usado solo en modo MARKUP)';
comment on column product_variants.price_rounding is 'Tipo de redondeo del precio calculado';
comment on column product_variants.rounding_to is 'Múltiplo para redondeo (ej: 100 para redondear a centenas)';

-- 9.1 Función para calcular y actualizar costo promedio
create or replace function fn_update_average_cost(
  p_tenant uuid,
  p_location uuid,
  p_variant uuid,
  p_qty_incoming numeric(14,3),
  p_unit_cost_incoming numeric(14,2)
) returns numeric(14,2)
language plpgsql
as $$
declare
  v_current_qty numeric(14,3);
  v_current_cost numeric(14,2);
  v_current_value numeric(14,2);
  v_incoming_value numeric(14,2);
  v_new_qty numeric(14,3);
  v_new_avg_cost numeric(14,2);
begin
  -- Obtener stock y costo actual
  select sb.on_hand, pv.cost
    into v_current_qty, v_current_cost
    from stock_balances sb
    join product_variants pv on pv.variant_id = sb.variant_id and pv.tenant_id = sb.tenant_id
   where sb.tenant_id = p_tenant
     and sb.location_id = p_location
     and sb.variant_id = p_variant;

  -- Si no existe stock, usar el costo de entrada directamente
  if v_current_qty is null or v_current_qty <= 0 then
    v_new_avg_cost := p_unit_cost_incoming;
  else
    -- Calcular promedio ponderado
    v_current_value := v_current_qty * v_current_cost;
    v_incoming_value := p_qty_incoming * p_unit_cost_incoming;
    v_new_qty := v_current_qty + p_qty_incoming;
    
    v_new_avg_cost := round((v_current_value + v_incoming_value) / v_new_qty, 2);
  end if;

  -- Actualizar el costo en product_variants
  update product_variants
     set cost = v_new_avg_cost
   where tenant_id = p_tenant
     and variant_id = p_variant;

  return v_new_avg_cost;
end;
$$;

-- 9.2 Función para calcular precio de venta según configuración
create or replace function fn_calculate_sale_price(
  p_tenant uuid,
  p_variant uuid,
  p_cost numeric(14,2)
) returns numeric(14,2)
language plpgsql
as $$
declare
  v_pricing_method text;
  v_markup_percentage numeric(10,2);
  v_price_rounding text;
  v_rounding_to numeric(14,2);
  v_calculated_price numeric(14,2);
begin
  -- Obtener configuración de precio de la variante
  select 
    coalesce(pv.pricing_method, 'MARKUP') as pricing_method,
    coalesce(pv.markup_percentage, 0) as markup_percentage,
    coalesce(pv.price_rounding, 'NONE') as price_rounding,
    coalesce(pv.rounding_to, 1) as rounding_to
    into v_pricing_method, v_markup_percentage, v_price_rounding, v_rounding_to
    from product_variants pv
   where pv.tenant_id = p_tenant and pv.variant_id = p_variant;

  -- Si el método es FIXED, mantener el precio actual
  if v_pricing_method = 'FIXED' then
    select pv.price into v_calculated_price
      from product_variants pv
     where pv.tenant_id = p_tenant and pv.variant_id = p_variant;
    
    return v_calculated_price;
  end if;

  -- Calcular precio con markup
  v_calculated_price := p_cost * (1 + (v_markup_percentage / 100));

  -- Aplicar redondeo
  if v_price_rounding = 'UP' then
    v_calculated_price := ceil(v_calculated_price / v_rounding_to) * v_rounding_to;
  elsif v_price_rounding = 'DOWN' then
    v_calculated_price := floor(v_calculated_price / v_rounding_to) * v_rounding_to;
  elsif v_price_rounding = 'NEAREST' then
    v_calculated_price := round(v_calculated_price / v_rounding_to) * v_rounding_to;
  end if;

  return round(v_calculated_price, 2);
end;
$$;

-- 9.3 Trigger para actualizar costo promedio automáticamente
create or replace function trg_update_average_cost()
returns trigger
language plpgsql
as $$
declare
  v_new_cost numeric(14,2);
  v_new_price numeric(14,2);
begin
  -- Solo actualizar en entradas de inventario con costo
  if new.move_type in ('PURCHASE_IN', 'ADJUSTMENT', 'TRANSFER_IN') and new.unit_cost > 0 then
    -- Calcular y actualizar costo promedio
    v_new_cost := fn_update_average_cost(
      new.tenant_id,
      new.location_id,
      new.variant_id,
      new.quantity,
      new.unit_cost
    );

    -- Recalcular precio de venta si aplica
    v_new_price := fn_calculate_sale_price(new.tenant_id, new.variant_id, v_new_cost);

    -- Actualizar precio en la variante
    update product_variants
       set price = v_new_price
     where tenant_id = new.tenant_id
       and variant_id = new.variant_id
       and pricing_method = 'MARKUP'; -- Solo si usa markup automático
  end if;

  return new;
end;
$$;

drop trigger if exists trg_update_average_cost_after on inventory_moves;
create trigger trg_update_average_cost_after
after insert on inventory_moves
for each row
execute function trg_update_average_cost();

-- 9.4 SP: Registrar Compra con actualización automática de costos
create or replace function sp_create_purchase(
  p_tenant uuid,
  p_location uuid,
  p_supplier_id uuid,
  p_created_by uuid,
  p_lines jsonb,
  p_note text default null
) returns uuid
language plpgsql
as $$
declare
  v_purchase_id uuid;
  v_total numeric(14,2) := 0;

  v_line jsonb;
  v_variant uuid;
  v_qty numeric(14,3);
  v_unit_cost numeric(14,2);
  v_line_total numeric(14,2);
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Purchase must have at least one line';
  end if;

  -- Crear registro de compra
  v_purchase_id := gen_random_uuid();

  -- Procesar líneas
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_variant := (v_line->>'variant_id')::uuid;
    v_qty := (v_line->>'qty')::numeric;
    v_unit_cost := (v_line->>'unit_cost')::numeric;

    if v_qty <= 0 then
      raise exception 'Invalid qty for variant %', v_variant;
    end if;
    if v_unit_cost < 0 then
      raise exception 'Invalid unit_cost for variant %', v_variant;
    end if;

    -- Validar que la variante existe
    perform 1
      from product_variants pv
     where pv.tenant_id = p_tenant 
       and pv.variant_id = v_variant 
       and pv.is_active = true;

    if not found then
      raise exception 'Variant not found/active: %', v_variant;
    end if;

    v_line_total := round(v_qty * v_unit_cost, 2);

    -- Registrar movimiento de inventario (el trigger actualizará el costo promedio)
    insert into inventory_moves(
      tenant_id, move_type, location_id, variant_id, quantity, unit_cost,
      source, source_id, note, created_at, created_by
    )
    values(
      p_tenant, 'PURCHASE_IN', p_location, v_variant, v_qty, v_unit_cost,
      'PURCHASE', v_purchase_id, p_note, now(), p_created_by
    );

    -- Actualizar stock
    perform fn_apply_stock_delta(p_tenant, p_location, v_variant, v_qty);

    v_total := v_total + v_line_total;
  end loop;

  return v_purchase_id;
end;
$$;

-- 9.5 Vista de compras para reportes
create or replace view vw_purchases_summary as
select
  im.tenant_id,
  im.location_id,
  l.name as location_name,
  im.source_id as purchase_id,
  im.created_at as purchased_at,
  im.created_by,
  u.full_name as purchased_by_name,
  im.variant_id,
  pv.sku,
  p.product_id,
  p.name as product_name,
  pv.variant_name,
  im.quantity,
  im.unit_cost,
  round(im.quantity * im.unit_cost, 2) as line_total,
  pv.cost as current_avg_cost,
  pv.price as current_price,
  im.note
from inventory_moves im
join locations l on l.location_id = im.location_id
join product_variants pv on pv.variant_id = im.variant_id
join products p on p.product_id = pv.product_id
join users u on u.user_id = im.created_by
where im.move_type = 'PURCHASE_IN'
order by im.created_at desc;

-- ==========================================
-- SISTEMA DE SUGERENCIAS INTELIGENTES DE COMPRA
-- ==========================================

-- Vista: Análisis de rotación de inventario y demanda
create or replace view vw_inventory_rotation_analysis as
with sales_last_30_days as (
  select 
    sl.variant_id,
    count(distinct s.sale_id) as sales_count,
    sum(sl.quantity) as total_sold,
    avg(sl.quantity) as avg_qty_per_sale,
    max(s.sold_at) as last_sale_date,
    min(s.sold_at) as first_sale_date
  from sale_lines sl
  join sales s on s.sale_id = sl.sale_id
  where s.sold_at >= current_date - interval '30 days'
    and s.status = 'COMPLETED'
  group by sl.variant_id
),
sales_last_90_days as (
  select 
    sl.variant_id,
    sum(sl.quantity) as total_sold_90d
  from sale_lines sl
  join sales s on s.sale_id = sl.sale_id
  where s.sold_at >= current_date - interval '90 days'
    and s.status = 'COMPLETED'
  group by sl.variant_id
),
current_stock as (
  select 
    sb.tenant_id,
    sb.variant_id,
    sum(sb.on_hand) as total_stock,
    array_agg(distinct sb.location_id) as locations,
    count(distinct sb.location_id) as num_locations
  from stock_balances sb
  group by sb.tenant_id, sb.variant_id
)
select 
  cs.tenant_id,
  pv.variant_id,
  p.product_id,
  p.name as product_name,
  pv.variant_name,
  pv.sku,
  coalesce(cs.total_stock, 0) as current_stock,
  coalesce(s30.total_sold, 0) as sold_last_30d,
  coalesce(s90.total_sold_90d, 0) as sold_last_90d,
  coalesce(s30.sales_count, 0) as transactions_30d,
  coalesce(s30.avg_qty_per_sale, 0) as avg_qty_per_sale,
  s30.last_sale_date,
  -- Calcular días desde última venta
  case 
    when s30.last_sale_date is not null then 
      current_date - s30.last_sale_date::date
    else null
  end as days_since_last_sale,
  -- Calcular velocidad de rotación (días promedio entre ventas)
  case 
    when s30.sales_count > 1 and s30.first_sale_date is not null then
      (s30.last_sale_date::date - s30.first_sale_date::date) / nullif(s30.sales_count - 1, 0)
    else null
  end as avg_days_between_sales,
  -- Demanda diaria promedio (últimos 30 días)
  round(coalesce(s30.total_sold, 0) / 30.0, 2) as avg_daily_demand,
  -- Días de inventario restante (stock / demanda diaria)
  case 
    when coalesce(s30.total_sold, 0) > 0 then
      round((coalesce(cs.total_stock, 0) * 30.0) / s30.total_sold, 1)
    else null
  end as days_of_stock_remaining,
  -- Tendencia (comparar 30d vs 90d)
  case 
    when s90.total_sold_90d > 0 then
      round(((s30.total_sold * 3.0) / s90.total_sold_90d - 1) * 100, 1)
    else null
  end as trend_percentage,
  pv.cost as unit_cost,
  pv.price as unit_price,
  pv.min_stock,
  pv.allow_backorder,
  cs.locations,
  cs.num_locations,
  p.is_active
from product_variants pv
join products p on p.product_id = pv.product_id
left join current_stock cs on cs.variant_id = pv.variant_id
left join sales_last_30_days s30 on s30.variant_id = pv.variant_id
left join sales_last_90_days s90 on s90.variant_id = pv.variant_id
where p.is_active = true
  and pv.is_active = true;

-- Función: Generar sugerencias inteligentes de compra
create or replace function fn_get_purchase_suggestions(
  p_tenant_id uuid,
  p_min_priority integer default 1, -- 1=Crítico, 2=Alto, 3=Medio
  p_limit integer default 50
)
returns table(
  variant_id uuid,
  product_name text,
  variant_name text,
  sku text,
  current_stock numeric,
  min_stock numeric,
  suggested_order_qty numeric,
  priority integer,
  priority_label text,
  reason text,
  days_of_stock numeric,
  avg_daily_demand numeric,
  sold_last_30d numeric,
  unit_cost numeric,
  estimated_cost numeric,
  last_sale_date timestamp with time zone
)
language plpgsql
as $$
begin
  return query
  with suggestions as (
    select 
      ira.variant_id,
      ira.product_name,
      ira.variant_name,
      ira.sku,
      ira.current_stock,
      ira.min_stock,
      -- Calcular cantidad sugerida de pedido
      case
        -- Si está agotado y tiene ventas, pedir para 30 días
        when ira.current_stock <= 0 and ira.avg_daily_demand > 0 then
          ceil(ira.avg_daily_demand * 30)
        -- Si está bajo mínimo, completar hasta 30 días de stock
        when ira.current_stock < coalesce(ira.min_stock, 0) and ira.avg_daily_demand > 0 then
          greatest(
            coalesce(ira.min_stock, 0) - ira.current_stock,
            ceil(ira.avg_daily_demand * 30 - ira.current_stock)
          )
        -- Si tiene menos de 7 días de stock, pedir para 30 días
        when ira.days_of_stock_remaining < 7 and ira.avg_daily_demand > 0 then
          ceil(ira.avg_daily_demand * 30 - ira.current_stock)
        -- Si tiene entre 7 y 15 días, pedir para 20 días
        when ira.days_of_stock_remaining < 15 and ira.avg_daily_demand > 0 then
          ceil(ira.avg_daily_demand * 20)
        else 0
      end as suggested_qty,
      -- Determinar prioridad
      case
        -- CRÍTICO: Agotado con ventas recientes (últimos 7 días)
        when ira.current_stock <= 0 
          and ira.sold_last_30d > 0 
          and ira.days_since_last_sale <= 7 then 1
        -- ALTO: Bajo mínimo o menos de 7 días de stock
        when ira.current_stock < coalesce(ira.min_stock, 0)
          or (ira.days_of_stock_remaining < 7 and ira.avg_daily_demand > 0) then 2
        -- MEDIO: Menos de 15 días de stock con demanda creciente
        when ira.days_of_stock_remaining < 15 
          and ira.trend_percentage > 10 then 3
        else 4
      end as priority_level,
      -- Razón de la sugerencia
      case
        when ira.current_stock <= 0 and ira.sold_last_30d > 0 then
          'AGOTADO con demanda activa (última venta hace ' || ira.days_since_last_sale || ' días)'
        when ira.current_stock < coalesce(ira.min_stock, 0) then
          'Stock bajo mínimo (' || coalesce(ira.min_stock, 0) || ' unidades)'
        when ira.days_of_stock_remaining < 7 then
          'Quedan solo ' || round(ira.days_of_stock_remaining, 1) || ' días de stock'
        when ira.days_of_stock_remaining < 15 and ira.trend_percentage > 10 then
          'Demanda creciente (+' || ira.trend_percentage || '%), ' || round(ira.days_of_stock_remaining, 1) || ' días de stock'
        else 'Stock preventivo'
      end as reason_text,
      ira.days_of_stock_remaining,
      ira.avg_daily_demand,
      ira.sold_last_30d,
      ira.unit_cost,
      ira.last_sale_date
    from vw_inventory_rotation_analysis ira
    where ira.tenant_id = p_tenant_id
      and ira.is_active = true
      -- Solo productos con ventas o bajo mínimo
      and (
        ira.sold_last_30d > 0 
        or ira.current_stock < coalesce(ira.min_stock, 0)
      )
  )
  select 
    s.variant_id,
    s.product_name,
    s.variant_name,
    s.sku,
    s.current_stock,
    s.min_stock,
    s.suggested_qty,
    s.priority_level,
    case s.priority_level
      when 1 then 'CRÍTICO'
      when 2 then 'ALTO'
      when 3 then 'MEDIO'
      else 'BAJO'
    end,
    s.reason_text,
    s.days_of_stock_remaining,
    s.avg_daily_demand,
    s.sold_last_30d,
    s.unit_cost,
    round(s.suggested_qty * s.unit_cost, 2),
    s.last_sale_date
  from suggestions s
  where s.priority_level <= p_min_priority
    and s.suggested_qty > 0
  order by 
    s.priority_level asc,
    s.days_of_stock_remaining asc nulls last,
    s.sold_last_30d desc
  limit p_limit;
end;
$$;

-- ==========================================
-- SISTEMA DE PRONÓSTICO INTELIGENTE DE VENTAS
-- ==========================================

-- Vista: Histórico de ventas diarias (para análisis de IA)
create or replace view vw_sales_daily_history as
with daily_sales as (
  select
    s.tenant_id,
    s.location_id,
    l.name as location_name,
    s.sold_at::date as sale_date,
    extract(dow from s.sold_at) as day_of_week, -- 0=domingo, 6=sábado
    extract(day from s.sold_at) as day_of_month,
    extract(month from s.sold_at) as month,
    extract(year from s.sold_at) as year,
    to_char(s.sold_at, 'Day') as day_name,
    to_char(s.sold_at, 'Month') as month_name,
    count(distinct s.sale_id) as transactions_count,
    sum(s.total) as total_sales,
    avg(s.total) as avg_ticket_size,
    sum(s.subtotal) as total_subtotal,
    sum(s.tax_total) as total_tax,
    sum(s.discount_total) as total_discounts
  from sales s
  join locations l on l.location_id = s.location_id
  where s.status in ('COMPLETED', 'PARTIAL_RETURN')
  group by 
    s.tenant_id,
    s.location_id,
    l.name,
    s.sold_at::date,
    extract(dow from s.sold_at),
    extract(day from s.sold_at),
    extract(month from s.sold_at),
    extract(year from s.sold_at),
    to_char(s.sold_at, 'Day'),
    to_char(s.sold_at, 'Month')
)
select
  ds.*,
  -- Calcular promedio móvil 7 días
  avg(ds.total_sales) over (
    partition by ds.tenant_id, ds.location_id
    order by ds.sale_date
    rows between 6 preceding and current row
  ) as moving_avg_7d,
  -- Calcular promedio móvil 30 días
  avg(ds.total_sales) over (
    partition by ds.tenant_id, ds.location_id
    order by ds.sale_date
    rows between 29 preceding and current row
  ) as moving_avg_30d,
  -- Calcular venta del mismo día semana anterior
  lag(ds.total_sales, 7) over (
    partition by ds.tenant_id, ds.location_id
    order by ds.sale_date
  ) as same_day_last_week,
  -- Calcular tendencia (diferencia con semana anterior)
  ds.total_sales - lag(ds.total_sales, 7) over (
    partition by ds.tenant_id, ds.location_id
    order by ds.sale_date
  ) as week_over_week_diff
from daily_sales ds
order by ds.tenant_id, ds.location_id, ds.sale_date desc;

-- Función: Obtener resumen de ventas para pronóstico
create or replace function fn_get_sales_forecast_data(
  p_tenant_id uuid,
  p_location_id uuid default null,
  p_days_back integer default 90
)
returns table(
  sale_date date,
  day_of_week integer,
  day_name text,
  transactions_count bigint,
  total_sales numeric,
  avg_ticket_size numeric,
  moving_avg_7d numeric,
  moving_avg_30d numeric,
  same_day_last_week numeric
)
language plpgsql
as $$
begin
  return query
  select
    sdh.sale_date,
    sdh.day_of_week::integer,
    trim(sdh.day_name),
    sdh.transactions_count,
    sdh.total_sales,
    sdh.avg_ticket_size,
    round(sdh.moving_avg_7d, 2) as moving_avg_7d,
    round(sdh.moving_avg_30d, 2) as moving_avg_30d,
    sdh.same_day_last_week
  from vw_sales_daily_history sdh
  where sdh.tenant_id = p_tenant_id
    and (p_location_id is null or sdh.location_id = p_location_id)
    and sdh.sale_date >= current_date - (p_days_back || ' days')::interval
  order by sdh.sale_date desc;
end;
$$;
