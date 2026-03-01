-- Recomendado
create extension if not exists pgcrypto;

-- =========================
-- 1) MULTI-TENANT / SEDES
-- =========================
create table tenants (
  tenant_id uuid primary key default gen_random_uuid(),
  name text not null,
  tax_id text,
  currency_code char(3) not null default 'COP',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table locations (
  location_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  name text not null,
  type text not null default 'STORE', -- STORE | WAREHOUSE
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

-- =========================
-- 2) SEGURIDAD
-- =========================
create table users (
  user_id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique, -- ID del usuario de Supabase Auth
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  email text not null,
  full_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);

create table roles (
  role_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  name text not null,
  unique (tenant_id, name)
);

create table permissions (
  permission_id uuid primary key default gen_random_uuid(),
  code text not null unique, -- ej: SALES.CREATE, INVENTORY.ADJUST
  description text
);

create table role_permissions (
  role_id uuid not null references roles(role_id) on delete cascade,
  permission_id uuid not null references permissions(permission_id) on delete cascade,
  primary key (role_id, permission_id)
);

create table user_roles (
  user_id uuid not null references users(user_id) on delete cascade,
  role_id uuid not null references roles(role_id) on delete cascade,
  primary key (user_id, role_id)
);

-- =========================
-- 3) CATÁLOGO
-- =========================
create table categories (
  category_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  name text not null,
  parent_category_id uuid references categories(category_id),
  unique (tenant_id, name)
);

create table products (
  product_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  category_id uuid references categories(category_id),
  name text not null,
  description text,
  is_active boolean not null default true,
  track_inventory boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table product_variants (
  variant_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  product_id uuid not null references products(product_id) on delete cascade,
  sku text not null,
  variant_name text,            -- ej "Rojo / M"
  attrs jsonb,                  -- {"color":"rojo","talla":"M"}
  cost numeric(14,2) not null default 0,
  price numeric(14,2) not null default 0,
  is_active boolean not null default true,
  unique (tenant_id, sku),
  unique (tenant_id, product_id, variant_name)
);

create table product_barcodes (
  barcode_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  variant_id uuid not null references product_variants(variant_id) on delete cascade,
  barcode text not null,
  unique (tenant_id, barcode)
);

create table product_tags (
  tag_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  name text not null,
  unique (tenant_id, name)
);

create table product_tag_map (
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  product_id uuid not null references products(product_id) on delete cascade,
  tag_id uuid not null references product_tags(tag_id) on delete cascade,
  primary key (tenant_id, product_id, tag_id)
);

-- (Opcional) Listas de precios
create table price_lists (
  price_list_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  unique (tenant_id, name)
);

create table price_list_items (
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  price_list_id uuid not null references price_lists(price_list_id) on delete cascade,
  variant_id uuid not null references product_variants(variant_id) on delete cascade,
  price numeric(14,2) not null,
  primary key (tenant_id, price_list_id, variant_id)
);

-- =========================
-- 4) CLIENTES / CRÉDITO
-- =========================
create table customers (
  customer_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  document text,
  full_name text not null,
  phone text,
  email text,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, document)
);

create table customer_credit_accounts (
  credit_account_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  customer_id uuid not null references customers(customer_id) on delete cascade,
  credit_limit numeric(14,2) not null default 0,
  current_balance numeric(14,2) not null default 0,
  is_active boolean not null default true,
  unique (tenant_id, customer_id)
);

create table customer_credit_movements (
  movement_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  credit_account_id uuid not null references customer_credit_accounts(credit_account_id) on delete cascade,
  source text not null, -- SALE | PAYMENT | ADJUSTMENT
  source_id uuid,       -- id de venta/pago si aplica
  amount numeric(14,2) not null, -- +deuda, -abono
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references users(user_id)
);

-- =========================
-- 5) IMPUESTOS / CONFIG
-- =========================
create table taxes (
  tax_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  code text not null, -- IVA
  name text not null,
  rate numeric(7,4) not null, -- 0.1900
  is_active boolean not null default true,
  unique (tenant_id, code)
);

-- Reglas: por defecto tenant, o override por categoría/producto/variante
create table tax_rules (
  tax_rule_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  tax_id uuid not null references taxes(tax_id),
  scope text not null, -- TENANT | CATEGORY | PRODUCT | VARIANT
  category_id uuid references categories(category_id),
  product_id uuid references products(product_id),
  variant_id uuid references product_variants(variant_id),
  priority int not null default 0,
  is_active boolean not null default true,
  check (
    (scope='TENANT' and category_id is null and product_id is null and variant_id is null) or
    (scope='CATEGORY' and category_id is not null and product_id is null and variant_id is null) or
    (scope='PRODUCT' and product_id is not null and variant_id is null) or
    (scope='VARIANT' and variant_id is not null)
  )
);

create table tenant_settings (
  tenant_id uuid primary key references tenants(tenant_id) on delete cascade,
  business_name text,
  business_address text,
  business_phone text,
  logo_url text,
  receipt_footer text,
  default_tax_included boolean not null default false
);

-- =========================
-- 6) CAJA
-- =========================
create table cash_registers (
  cash_register_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  location_id uuid not null references locations(location_id) on delete restrict,
  name text not null,
  is_active boolean not null default true,
  unique (tenant_id, location_id, name)
);

create table cash_sessions (
  cash_session_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  cash_register_id uuid not null references cash_registers(cash_register_id),
  opened_by uuid not null references users(user_id),
  opened_at timestamptz not null default now(),
  opening_amount numeric(14,2) not null default 0,
  closed_by uuid references users(user_id),
  closed_at timestamptz,
  closing_amount_counted numeric(14,2),
  closing_amount_expected numeric(14,2),
  difference numeric(14,2),
  status text not null default 'OPEN' -- OPEN | CLOSED
);

create table cash_movements (
  cash_movement_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  cash_session_id uuid not null references cash_sessions(cash_session_id) on delete cascade,
  type text not null, -- INCOME | EXPENSE
  category text,      -- ej: "Gasto operativo"
  amount numeric(14,2) not null check (amount > 0),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references users(user_id)
);

-- =========================
-- 7) VENTAS / PAGOS / DEVOLUCIONES
-- =========================
create table payment_methods (
  payment_method_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  code text not null, -- CASH, CARD, TRANSFER, QR, CREDIT
  name text not null,
  is_active boolean not null default true,
  unique (tenant_id, code)
);

create table sales (
  sale_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  location_id uuid not null references locations(location_id),
  cash_session_id uuid references cash_sessions(cash_session_id), -- venta asociada a caja
  sale_number bigint not null, -- consecutivo por sede/tenant (manejar con secuencias)
  status text not null default 'COMPLETED', -- COMPLETED | VOIDED | RETURNED | PARTIAL_RETURN
  sold_at timestamptz not null default now(),
  customer_id uuid references customers(customer_id),
  sold_by uuid not null references users(user_id),
  subtotal numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  note text,
  unique (tenant_id, location_id, sale_number)
);

create table sale_lines (
  sale_line_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  sale_id uuid not null references sales(sale_id) on delete cascade,
  variant_id uuid not null references product_variants(variant_id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  unit_cost numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  line_total numeric(14,2) not null,
  tax_detail jsonb -- desglose de impuestos aplicados
);

create table sale_payments (
  sale_payment_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  sale_id uuid not null references sales(sale_id) on delete cascade,
  payment_method_id uuid not null references payment_methods(payment_method_id),
  cash_session_id uuid references cash_sessions(cash_session_id),
  amount numeric(14,2) not null check (amount > 0),
  reference text, -- voucher, transacción, etc.
  paid_at timestamptz not null default now()
);

-- Devoluciones
create table sale_returns (
  return_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  sale_id uuid not null references sales(sale_id) on delete restrict,
  location_id uuid not null references locations(location_id),
  created_at timestamptz not null default now(),
  created_by uuid not null references users(user_id),
  reason text,
  status text not null default 'COMPLETED', -- COMPLETED | VOIDED
  refund_total numeric(14,2) not null default 0
);

create table sale_return_lines (
  return_line_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  return_id uuid not null references sale_returns(return_id) on delete cascade,
  sale_line_id uuid references sale_lines(sale_line_id),
  variant_id uuid not null references product_variants(variant_id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  tax_amount numeric(14,2) not null default 0,
  line_total numeric(14,2) not null
);

-- =========================
-- 8) INVENTARIO / KARDEX
-- =========================
create table inventory_moves (
  inventory_move_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  move_type text not null, -- PURCHASE_IN | SALE_OUT | RETURN_IN | ADJUSTMENT | TRANSFER_OUT | TRANSFER_IN
  location_id uuid not null references locations(location_id),
  to_location_id uuid references locations(location_id), -- para traslados
  variant_id uuid not null references product_variants(variant_id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,2) not null default 0,
  source text not null, -- SALE | RETURN | PURCHASE | MANUAL | TRANSFER
  source_id uuid,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references users(user_id)
);

-- Materialización opcional para performance
create table stock_balances (
  tenant_id uuid not null references tenants(tenant_id) on delete cascade,
  location_id uuid not null references locations(location_id) on delete cascade,
  variant_id uuid not null references product_variants(variant_id) on delete cascade,
  on_hand numeric(14,3) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, location_id, variant_id)
);

-- =========================
-- 9) AUDITORÍA
-- =========================
create table audit_log (
  audit_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid,
  action text not null,      -- CREATE/UPDATE/DELETE/LOGIN/VOID/RETURN
  entity text not null,      -- SALE, PRODUCT, CASH_SESSION, etc.
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

-- =========================
-- 10) ÍNDICES CLAVE
-- =========================
create index ix_sales_tenant_date on sales(tenant_id, sold_at desc);
create index ix_sale_lines_sale on sale_lines(sale_id);
create index ix_payments_sale on sale_payments(sale_id);
create index ix_inventory_moves_variant_loc_date on inventory_moves(tenant_id, variant_id, location_id, created_at desc);
create index ix_stock_balances_lookup on stock_balances(tenant_id, location_id, variant_id);
create index ix_customers_search on customers(tenant_id, full_name);
