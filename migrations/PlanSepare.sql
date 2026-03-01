/* ============================================================================
   POS PYMES - PLAN SEPARE (LAYAWAY) + ABONOS PARCIALES  |  TODO EN UN SOLO SCRIPT
   Incluye:
   - ALTER stock_balances: reserved + view de disponibilidad
   - Tablas layaway_* (contrato, items, cuotas, abonos, log reservas)
   - Funciones: reservar/liberar, recalcular contrato
   - SPs:
       sp_create_layaway(...)              -- crea contrato + reserva + abono inicial + cuotas opcionales
       sp_add_layaway_payment(...)         -- registra abono parcial
       sp_complete_layaway_to_sale(...)    -- al pagar todo: convierte a FACTURA (venta)
       sp_cancel_layaway(...)              -- cancela/expira y libera reserva (sin reembolso automático)
   - Ajuste recomendado en sp_create_sale: validar STOCK DISPONIBLE (on_hand - reserved)

   REQUISITOS:
   - Ya existen las tablas base: tenants, locations, users, customers, payment_methods,
     sales, sale_lines, sale_payments, stock_balances, product_variants, products,
     inventory_moves, taxes, tax_rules, etc.
   - Ya existen (o crearás) tus funciones base:
       fn_get_tax_rate_for_variant(p_tenant, p_variant)
       fn_apply_stock_delta(p_tenant, p_location, p_variant, p_delta)  -- afecta on_hand
       fn_next_sale_number(p_tenant, p_location)
   ============================================================================ */

-- =========================
-- 1) INVENTARIO: RESERVADO
-- =========================
alter table stock_balances
add column if not exists reserved numeric(14,3) not null default 0;

-- Disponible = on_hand - reserved
create or replace view vw_stock_available as
select
  tenant_id,
  location_id,
  variant_id,
  on_hand,
  reserved,
  (on_hand - reserved) as available,
  updated_at
from stock_balances;

-- Helper: aplicar delta a reserved (reserva/liberación)
create or replace function fn_apply_stock_reservation_delta(
  p_tenant uuid,
  p_location uuid,
  p_variant uuid,
  p_delta numeric
) returns void
language plpgsql
as $$
declare
  v_reserved numeric(14,3);
begin
  -- Asegura fila y aplica delta
  insert into stock_balances(tenant_id, location_id, variant_id, on_hand, reserved, updated_at)
  values (p_tenant, p_location, p_variant, 0, p_delta, now())
  on conflict (tenant_id, location_id, variant_id)
  do update set
    reserved = stock_balances.reserved + excluded.reserved,
    updated_at = now();

  select reserved into v_reserved
  from stock_balances
  where tenant_id=p_tenant and location_id=p_location and variant_id=p_variant;

  if v_reserved < 0 then
    raise exception 'El stock reservado no puede ser negativo (tenant=%, location=%, variant=%)', p_tenant, p_location, p_variant;
  end if;
end;
$$;

-- Índice útil
create index if not exists ix_stock_balances_reserved on stock_balances(tenant_id, location_id, variant_id, reserved);

-- =========================================
-- 2) MÉTODO DE PAGO ESPECIAL PARA SEPARE
-- =========================================
-- Recomendación: crear un método "LAYAWAY" para registrar el pago "contable" al convertir en factura
-- (NO entra a caja, porque la caja ya se afectó con los abonos reales).
insert into payment_methods(tenant_id, code, name, is_active)
select t.tenant_id, 'LAYAWAY', 'Liquidación Plan Separe', true
from tenants t
where not exists (
  select 1 from payment_methods pm where pm.tenant_id = t.tenant_id and pm.code='LAYAWAY'
);

-- =========================
-- 3) TABLAS: PLAN SEPARE
-- =========================
create table if not exists layaway_contracts (
  layaway_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  location_id uuid not null references locations(location_id),
  customer_id uuid not null references customers(customer_id),
  created_by uuid not null references users(user_id),
  created_at timestamptz not null default now(),

  status text not null default 'ACTIVE', -- ACTIVE | COMPLETED | CANCELLED | EXPIRED

  currency_code char(3) not null default 'COP',

  subtotal numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,

  initial_deposit numeric(14,2) not null default 0,
  paid_total numeric(14,2) not null default 0,
  balance numeric(14,2) not null default 0,

  due_date date,
  note text,

  -- vínculo a la factura (venta) cuando se completa
  sale_id uuid references sales(sale_id),

  unique (tenant_id, layaway_id)
);

create table if not exists layaway_items (
  layaway_item_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  layaway_id uuid not null references layaway_contracts(layaway_id) on delete cascade,
  variant_id uuid not null references product_variants(variant_id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  discount_amount numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  line_total numeric(14,2) not null,
  tax_detail jsonb
);

create table if not exists layaway_installments (
  installment_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  layaway_id uuid not null references layaway_contracts(layaway_id) on delete cascade,
  due_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  status text not null default 'PENDING' -- PENDING | PAID | LATE
);

create table if not exists layaway_payments (
  layaway_payment_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  layaway_id uuid not null references layaway_contracts(layaway_id) on delete cascade,
  payment_method_id uuid not null references payment_methods(payment_method_id),
  cash_session_id uuid references cash_sessions(cash_session_id),
  amount numeric(14,2) not null check (amount > 0),
  reference text,
  paid_at timestamptz not null default now(),
  paid_by uuid references users(user_id)
);

create table if not exists stock_reservations_log (
  reservation_log_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  layaway_id uuid not null references layaway_contracts(layaway_id) on delete cascade,
  location_id uuid not null references locations(location_id),
  variant_id uuid not null references product_variants(variant_id),
  quantity numeric(14,3) not null check (quantity > 0),
  action text not null, -- RESERVE | RELEASE
  created_at timestamptz not null default now(),
  created_by uuid references users(user_id)
);

create index if not exists ix_layaway_contracts_status on layaway_contracts(tenant_id, status, created_at desc);
create index if not exists ix_layaway_payments_layaway on layaway_payments(tenant_id, layaway_id, paid_at desc);

-- =========================================
-- 4) FUNCIÓN: RECALCULAR TOTALES DEL CONTRATO
-- =========================================
create or replace function fn_recalc_layaway_totals(p_tenant uuid, p_layaway uuid)
returns void
language plpgsql
as $$
declare
  v_subtotal numeric(14,2);
  v_discount numeric(14,2);
  v_tax numeric(14,2);
  v_total numeric(14,2);
  v_paid numeric(14,2);
begin
  select
    coalesce(sum(li.quantity * li.unit_price),0),
    coalesce(sum(li.discount_amount),0),
    coalesce(sum(li.tax_amount),0),
    coalesce(sum(li.line_total),0)
  into v_subtotal, v_discount, v_tax, v_total
  from layaway_items li
  where li.tenant_id = p_tenant and li.layaway_id = p_layaway;

  select coalesce(sum(lp.amount),0)
  into v_paid
  from layaway_payments lp
  where lp.tenant_id = p_tenant and lp.layaway_id = p_layaway;

  update layaway_contracts
     set subtotal = round(v_subtotal,2),
         discount_total = round(v_discount,2),
         tax_total = round(v_tax,2),
         total = round(v_total,2),
         paid_total = round(v_paid,2),
         balance = round(v_total - v_paid,2)
   where tenant_id = p_tenant and layaway_id = p_layaway;
end;
$$;

-- =========================================
-- 5) SP: CREAR PLAN SEPARE (RESERVA + ABONO INICIAL + CUOTAS)
-- =========================================
/*
p_items jsonb ejemplo:
[
  {"variant_id":"...","qty":1,"unit_price":30000,"discount":0},
  {"variant_id":"...","qty":2,"unit_price":15000,"discount":500}
]

p_installments jsonb (opcional) ejemplo:
[
  {"due_date":"2026-03-10","amount":10000},
  {"due_date":"2026-04-10","amount":10000}
]

p_initial_payment jsonb (obligatorio si initial_deposit > 0) ejemplo:
{"payment_method_code":"CASH","amount":10000,"reference":null,"cash_session_id":"..."}
*/
create or replace function sp_create_layaway(
  p_tenant uuid,
  p_location uuid,
  p_customer uuid,          -- OBLIGATORIO (según tu regla)
  p_created_by uuid,
  p_items jsonb,
  p_due_date date,
  p_note text default null,
  p_initial_payment jsonb default null,    -- abono inicial
  p_installments jsonb default null        -- cuotas pactadas
) returns uuid
language plpgsql
as $$
declare
  v_layaway uuid;
  v_item jsonb;
  v_variant uuid;
  v_qty numeric(14,3);
  v_unit_price numeric(14,2);
  v_discount numeric(14,2);
  v_tax_rate numeric;
  v_line_base numeric(14,2);
  v_tax_amount numeric(14,2);
  v_line_total numeric(14,2);

  v_available numeric(14,3);

  v_pm_code text;
  v_pm_id uuid;
  v_pay_amount numeric(14,2);
  v_pay_ref text;
  v_cash_session uuid;

  v_inst jsonb;
  v_inst_due date;
  v_inst_amount numeric(14,2);
begin
  if p_customer is null then
    raise exception 'Customer is required for layaway';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Layaway must have at least one item';
  end if;

  insert into layaway_contracts(
    tenant_id, location_id, customer_id, created_by, created_at,
    status, currency_code, due_date, note,
    initial_deposit, paid_total, balance, subtotal, discount_total, tax_total, total
  )
  values(
    p_tenant, p_location, p_customer, p_created_by, now(),
    'ACTIVE', 'COP', p_due_date, p_note,
    0, 0, 0, 0, 0, 0, 0
  )
  returning layaway_id into v_layaway;

  -- Insertar items + reservar stock
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_variant := (v_item->>'variant_id')::uuid;
    v_qty := (v_item->>'qty')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_discount := coalesce((v_item->>'discount')::numeric, 0);

    if v_qty <= 0 then raise exception 'Invalid qty for variant %', v_variant; end if;
    if v_unit_price < 0 then raise exception 'Invalid unit_price for variant %', v_variant; end if;
    if v_discount < 0 then raise exception 'Invalid discount for variant %', v_variant; end if;

    -- validar stock disponible = on_hand - reserved
    select (sb.on_hand - sb.reserved)
      into v_available
      from stock_balances sb
     where sb.tenant_id=p_tenant and sb.location_id=p_location and sb.variant_id=v_variant;

    if v_available is null then
      -- si no existe fila, se asume 0 disponible
      raise exception 'No existe registro de stock para la variante % (tenant=% location=%)', v_variant, p_tenant, p_location;
    end if;

    if v_available < v_qty then
      raise exception 'Stock disponible insuficiente para la variante % (disponible=%, requerido=%)', v_variant, v_available, v_qty;
    end if;

    v_tax_rate := fn_get_tax_rate_for_variant(p_tenant, v_variant);
    v_line_base := round((v_qty * v_unit_price) - v_discount, 2);
    if v_line_base < 0 then v_line_base := 0; end if;
    v_tax_amount := round(v_line_base * v_tax_rate, 2);
    v_line_total := v_line_base + v_tax_amount;

    insert into layaway_items(
      tenant_id, layaway_id, variant_id, quantity, unit_price,
      discount_amount, tax_amount, line_total, tax_detail
    )
    values(
      p_tenant, v_layaway, v_variant, v_qty, v_unit_price,
      v_discount, v_tax_amount, v_line_total, jsonb_build_object('rate', v_tax_rate)
    );

    -- reservar stock (no es salida física)
    perform fn_apply_stock_reservation_delta(p_tenant, p_location, v_variant, v_qty);

    insert into stock_reservations_log(
      tenant_id, layaway_id, location_id, variant_id, quantity, action, created_at, created_by
    )
    values(
      p_tenant, v_layaway, p_location, v_variant, v_qty, 'RESERVE', now(), p_created_by
    );
  end loop;

  -- Cuotas opcionales
  if p_installments is not null and jsonb_typeof(p_installments)='array' and jsonb_array_length(p_installments)>0 then
    for v_inst in select * from jsonb_array_elements(p_installments)
    loop
      v_inst_due := (v_inst->>'due_date')::date;
      v_inst_amount := (v_inst->>'amount')::numeric;
      if v_inst_amount <= 0 then raise exception 'Invalid installment amount'; end if;

      insert into layaway_installments(tenant_id, layaway_id, due_date, amount, status)
      values (p_tenant, v_layaway, v_inst_due, v_inst_amount, 'PENDING');
    end loop;
  end if;

  -- Abono inicial opcional (si viene)
  if p_initial_payment is not null then
    v_pm_code := upper(p_initial_payment->>'payment_method_code');
    v_pay_amount := (p_initial_payment->>'amount')::numeric;
    v_pay_ref := p_initial_payment->>'reference';
    v_cash_session := nullif(p_initial_payment->>'cash_session_id','')::uuid;

    if v_pay_amount <= 0 then
      raise exception 'Initial payment amount must be > 0';
    end if;

    select pm.payment_method_id into v_pm_id
    from payment_methods pm
    where pm.tenant_id=p_tenant and pm.code=v_pm_code and pm.is_active=true;

    if not found then
      raise exception 'Payment method not found/active: %', v_pm_code;
    end if;

    -- si se pasa caja, debe estar OPEN
    if v_cash_session is not null then
      perform 1 from cash_sessions cs
      where cs.tenant_id=p_tenant and cs.cash_session_id=v_cash_session and cs.status='OPEN';
      if not found then
        raise exception 'Cash session is not OPEN or not found';
      end if;
    end if;

    insert into layaway_payments(
      tenant_id, layaway_id, payment_method_id, cash_session_id,
      amount, reference, paid_at, paid_by
    )
    values(
      p_tenant, v_layaway, v_pm_id, v_cash_session,
      v_pay_amount, v_pay_ref, now(), p_created_by
    );

    update layaway_contracts
       set initial_deposit = round(v_pay_amount,2)
     where tenant_id=p_tenant and layaway_id=v_layaway;
  end if;

  perform fn_recalc_layaway_totals(p_tenant, v_layaway);

  return v_layaway;
end;
$$;

-- =========================================
-- 6) SP: REGISTRAR ABONO PARCIAL
-- =========================================
create or replace function sp_add_layaway_payment(
  p_tenant uuid,
  p_layaway uuid,
  p_payment_method_code text,
  p_amount numeric(14,2),
  p_paid_by uuid,
  p_cash_session uuid default null,
  p_reference text default null
) returns void
language plpgsql
as $$
declare
  v_status text;
  v_pm_id uuid;
begin
  if p_amount <= 0 then
    raise exception 'Payment amount must be > 0';
  end if;

  select status into v_status
  from layaway_contracts
  where tenant_id=p_tenant and layaway_id=p_layaway
  for update;

  if not found then
    raise exception 'Layaway contract not found';
  end if;

  if v_status <> 'ACTIVE' then
    raise exception 'Layaway contract must be ACTIVE to accept payments (status=%)', v_status;
  end if;

  select pm.payment_method_id into v_pm_id
  from payment_methods pm
  where pm.tenant_id=p_tenant and pm.code=upper(p_payment_method_code) and pm.is_active=true;

  if not found then
    raise exception 'Payment method not found/active: %', p_payment_method_code;
  end if;

  if p_cash_session is not null then
    perform 1 from cash_sessions cs
    where cs.tenant_id=p_tenant and cs.cash_session_id=p_cash_session and cs.status='OPEN';
    if not found then
      raise exception 'Cash session is not OPEN or not found';
    end if;
  end if;

  insert into layaway_payments(
    tenant_id, layaway_id, payment_method_id, cash_session_id,
    amount, reference, paid_at, paid_by
  )
  values(
    p_tenant, p_layaway, v_pm_id, p_cash_session,
    p_amount, p_reference, now(), p_paid_by
  );

  perform fn_recalc_layaway_totals(p_tenant, p_layaway);

  -- marcar cuotas pagadas (regla simple: si paid_total >= suma cuotas vencidas, etc.)
  -- Aquí lo dejamos como opcional: tu lógica puede ser más fina por cuotas.
end;
$$;

-- =========================================
-- 7) SP: COMPLETAR (CONVERTIR A FACTURA / VENTA)
--     Cuando balance = 0 -> crea SALE (factura) y libera reserva,
--     luego descuenta inventario físico con tu lógica de venta.
-- =========================================
/*
Estrategia contable (recomendada):
- Los abonos ya afectaron caja en layaway_payments (cash_session_id real).
- Al convertir a factura, NO debemos volver a afectar caja.
- Creamos la venta con un pago "LAYAWAY" (sin caja) por el total.
- Inventario:
    * reserved -= qty (liberar)
    * salida física: SALE_OUT + on_hand -= qty (igual que una venta normal)
*/
create or replace function sp_complete_layaway_to_sale(
  p_tenant uuid,
  p_layaway uuid,
  p_sold_by uuid,
  p_note text default null
) returns uuid
language plpgsql
as $$
declare
  v_status text;
  v_balance numeric(14,2);
  v_location uuid;
  v_customer uuid;

  v_sale_id uuid;
  v_sale_number bigint;

  v_subtotal numeric(14,2);
  v_discount numeric(14,2);
  v_tax numeric(14,2);
  v_total numeric(14,2);

  v_item record;

  v_pm_layaway uuid;
begin
  select status, balance, location_id, customer_id, subtotal, discount_total, tax_total, total
    into v_status, v_balance, v_location, v_customer, v_subtotal, v_discount, v_tax, v_total
  from layaway_contracts
  where tenant_id=p_tenant and layaway_id=p_layaway
  for update;

  if not found then
    raise exception 'Layaway contract not found';
  end if;

  if v_status <> 'ACTIVE' then
    raise exception 'Layaway contract must be ACTIVE to complete (status=%)', v_status;
  end if;

  if round(v_balance,2) <> 0 then
    raise exception 'Layaway balance must be 0 to complete (balance=%)', v_balance;
  end if;

  select payment_method_id into v_pm_layaway
  from payment_methods
  where tenant_id=p_tenant and code='LAYAWAY' and is_active=true;

  if not found then
    raise exception 'Payment method LAYAWAY missing for tenant';
  end if;

  v_sale_number := fn_next_sale_number(p_tenant, v_location);

  insert into sales(
    tenant_id, location_id, cash_session_id, sale_number,
    status, sold_at, customer_id, sold_by,
    subtotal, discount_total, tax_total, total, note
  )
  values (
    p_tenant, v_location, null, v_sale_number,
    'COMPLETED', now(), v_customer, p_sold_by,
    round(v_subtotal,2), round(v_discount,2), round(v_tax,2), round(v_total,2),
    coalesce(p_note,'') || ' | FACTURA GENERADA DESDE PLAN SEPARE'
  )
  returning sale_id into v_sale_id;

  -- líneas: copiar de layaway_items
  for v_item in
    select li.variant_id, li.quantity, li.unit_price, li.discount_amount, li.tax_amount, li.line_total
    from layaway_items li
    where li.tenant_id=p_tenant and li.layaway_id=p_layaway
  loop
    insert into sale_lines(
      tenant_id, sale_id, variant_id, quantity,
      unit_price, unit_cost, discount_amount,
      tax_amount, line_total, tax_detail
    )
    values (
      p_tenant, v_sale_id, v_item.variant_id, v_item.quantity,
      v_item.unit_price, 0, v_item.discount_amount,
      v_item.tax_amount, v_item.line_total, null
    );

    -- Inventario:
    -- 1) liberar reserva
    perform fn_apply_stock_reservation_delta(p_tenant, v_location, v_item.variant_id, -v_item.quantity);

    insert into stock_reservations_log(
      tenant_id, layaway_id, location_id, variant_id, quantity, action, created_at, created_by
    )
    values(
      p_tenant, p_layaway, v_location, v_item.variant_id, v_item.quantity, 'RELEASE', now(), p_sold_by
    );

    -- 2) salida física: SALE_OUT (y on_hand delta)
    insert into inventory_moves(
      tenant_id, move_type, location_id, variant_id, quantity, unit_cost,
      source, source_id, note, created_at, created_by
    )
    values(
      p_tenant, 'SALE_OUT', v_location, v_item.variant_id, v_item.quantity, 0,
      'SALE', v_sale_id, 'Salida por factura de Plan Separe', now(), p_sold_by
    );

    perform fn_apply_stock_delta(p_tenant, v_location, v_item.variant_id, -v_item.quantity);
  end loop;

  -- pago contable "LAYAWAY" (sin caja)
  insert into sale_payments(
    tenant_id, sale_id, payment_method_id, cash_session_id, amount, reference, paid_at
  )
  values(
    p_tenant, v_sale_id, v_pm_layaway, null, round(v_total,2),
    concat('LAYAWAY:', p_layaway::text), now()
  );

  update layaway_contracts
     set status='COMPLETED',
         sale_id = v_sale_id
   where tenant_id=p_tenant and layaway_id=p_layaway;

  return v_sale_id;
end;
$$;

-- =========================================
-- 8) SP: CANCELAR / EXPIRAR (LIBERA RESERVA)
--     No hace reembolsos (política negocio). Si quieres reembolso, se implementa aparte.
-- =========================================
create or replace function sp_cancel_layaway(
  p_tenant uuid,
  p_layaway uuid,
  p_cancelled_by uuid,
  p_status text,            -- 'CANCELLED' o 'EXPIRED'
  p_note text default null
) returns void
language plpgsql
as $$
declare
  v_status text;
  v_location uuid;
  v_item record;
begin
  if p_status not in ('CANCELLED','EXPIRED') then
    raise exception 'Invalid status for cancel: %', p_status;
  end if;

  select status, location_id
    into v_status, v_location
  from layaway_contracts
  where tenant_id=p_tenant and layaway_id=p_layaway
  for update;

  if not found then
    raise exception 'Layaway contract not found';
  end if;

  if v_status in ('COMPLETED') then
    raise exception 'Cannot cancel a COMPLETED layaway';
  end if;

  if v_status in ('CANCELLED','EXPIRED') then
    return; -- idempotente
  end if;

  -- liberar reservas por items
  for v_item in
    select variant_id, quantity
    from layaway_items
    where tenant_id=p_tenant and layaway_id=p_layaway
  loop
    perform fn_apply_stock_reservation_delta(p_tenant, v_location, v_item.variant_id, -v_item.quantity);

    insert into stock_reservations_log(
      tenant_id, layaway_id, location_id, variant_id, quantity, action, created_at, created_by
    )
    values(
      p_tenant, p_layaway, v_location, v_item.variant_id, v_item.quantity, 'RELEASE', now(), p_cancelled_by
    );
  end loop;

  update layaway_contracts
     set status = p_status,
         note = trim(both from coalesce(note,'') || ' | ' || coalesce(p_note,''))
   where tenant_id=p_tenant and layaway_id=p_layaway;
end;
$$;

-- =========================================
-- 9) VISTAS ÚTILES PARA REPORTES DE SEPARE
-- =========================================
create or replace view vw_layaway_summary as
select
  lc.tenant_id,
  lc.location_id,
  l.name as location_name,
  lc.layaway_id,
  lc.status,
  lc.created_at,
  lc.due_date,
  lc.customer_id,
  c.full_name as customer_name,
  lc.subtotal,
  lc.discount_total,
  lc.tax_total,
  lc.total,
  lc.paid_total,
  lc.balance,
  lc.sale_id
from layaway_contracts lc
join locations l on l.location_id = lc.location_id
join customers c on c.customer_id = lc.customer_id;

create or replace view vw_layaway_payments as
select
  lp.tenant_id,
  lp.layaway_id,
  lp.layaway_payment_id,
  lp.paid_at,
  pm.code as payment_method_code,
  pm.name as payment_method_name,
  lp.amount,
  lp.cash_session_id,
  lp.reference,
  lp.paid_by
from layaway_payments lp
join payment_methods pm on pm.payment_method_id = lp.payment_method_id;

-- =========================================
-- 10) AJUSTE RECOMENDADO EN TU sp_create_sale
--     (NO lo redefinimos aquí para no pisar tu código)
--     Donde validas stock, usa:
--       available = on_hand - reserved
-- =========================================
-- Ejemplo de lógica:
-- select (sb.on_hand - sb.reserved) into v_available
-- from stock_balances sb
-- where sb.tenant_id=p_tenant and sb.location_id=p_location and sb.variant_id=v_variant;
-- if v_available < v_qty then raise exception ...; end if;

-- =========================================
-- 11) ÍNDICES EXTRA
-- =========================================
create index if not exists ix_layaway_items_lookup on layaway_items(tenant_id, layaway_id, variant_id);
create index if not exists ix_stock_res_log_layaway on stock_reservations_log(tenant_id, layaway_id, created_at desc);
