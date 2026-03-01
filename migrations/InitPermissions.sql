-- Script para inicializar permisos y roles base
-- Ejecutar después de InitDB.sql

-- 1) Permisos (catálogo global)
insert into permissions(code, description) values
  -- Ventas
  ('SALES.CREATE','Crear venta'),
  ('SALES.HOLD','Venta en espera / recuperar'),
  ('SALES.DISCOUNT.LINE','Descuento por línea'),
  ('SALES.DISCOUNT.TOTAL','Descuento total'),
  ('SALES.VOID','Anular venta'),
  ('SALES.RETURN','Registrar devolución'),
  ('SALES.VIEW','Ver ventas'),
  ('SALES.PRINT_RECEIPT','Imprimir/enviar comprobante'),

  -- Pagos
  ('PAYMENTS.APPLY','Registrar pagos'),
  ('PAYMENTS.REFUND','Registrar reembolso'),
  ('PAYMENTS.VIEW','Ver pagos'),

  -- Caja
  ('CASH.SESSION.OPEN','Abrir caja'),
  ('CASH.SESSION.CLOSE','Cerrar caja'),
  ('CASH.MOVEMENT.INCOME','Registrar ingreso manual'),
  ('CASH.MOVEMENT.EXPENSE','Registrar gasto'),
  ('CASH.VIEW','Ver caja'),
  ('CASH.ADJUST','Ajustes/arqueo avanzado'),
  ('CASH.REGISTER.MANAGE','Gestionar cajas registradoras'),
  ('CASH.ASSIGN','Asignar cajas a cajeros'),

  -- Clientes / Crédito
  ('CUSTOMERS.CREATE','Crear cliente'),
  ('CUSTOMERS.UPDATE','Editar cliente'),
  ('CUSTOMERS.VIEW','Ver clientes'),
  ('CUSTOMERS.DELETE','Eliminar cliente'),

  -- Plan Separe / Layaway
  ('LAYAWAY.CREATE','Crear contrato plan separe'),
  ('LAYAWAY.VIEW','Ver contratos plan separe'),
  ('LAYAWAY.PAYMENT.ADD','Registrar abonos'),
  ('LAYAWAY.COMPLETE','Completar contrato (convertir a factura)'),
  ('LAYAWAY.CANCEL','Cancelar o expirar contrato'),

  -- Inventario
  ('INVENTORY.VIEW','Ver stock/kardex'),
  ('INVENTORY.ADJUST','Ajuste inventario'),
  ('INVENTORY.TRANSFER','Traslado inventario'),
  ('INVENTORY.PURCHASE','Ingreso por compra'),

  -- Catálogo / Precios
  ('CATALOG.PRODUCT.CREATE','Crear producto'),
  ('CATALOG.PRODUCT.UPDATE','Editar producto'),
  ('CATALOG.PRODUCT.DELETE','Eliminar producto'),
  ('CATALOG.CATEGORY.MANAGE','Gestionar categorías'),
  ('CATALOG.BULK_IMPORT','Importar productos desde Excel'),

  -- Reportes
  ('REPORTS.SALES.VIEW','Ver reportes de ventas'),
  ('REPORTS.INVENTORY.VIEW','Ver reportes de inventario'),
  ('REPORTS.CASH.VIEW','Ver reportes de caja'),
  ('REPORTS.EXPORT','Exportar reportes'),

  -- Config / Seguridad / Auditoría
  ('SETTINGS.TENANT.MANAGE','Gestionar configuración empresa'),
  ('SETTINGS.LOCATIONS.MANAGE','Gestionar sedes'),
  ('SETTINGS.TAXES.MANAGE','Gestionar impuestos'),
  ('SETTINGS.PAYMENT_METHODS.MANAGE','Gestionar métodos de pago'),
  ('SECURITY.USERS.MANAGE','Gestionar usuarios'),
  ('SECURITY.ROLES.MANAGE','Gestionar roles/permisos')
on conflict (code) do nothing;

-- 2) Función auxiliar para crear roles con permisos para un tenant
create or replace function fn_init_tenant_roles(p_tenant_id uuid)
returns void
language plpgsql
as $$
declare
  r_admin uuid;
  r_cashier uuid;
  r_inventory uuid;
begin
  -- Crear roles base
  insert into roles(tenant_id, name)
  values (p_tenant_id, 'ADMINISTRADOR')
  on conflict (tenant_id, name) do nothing;

  insert into roles(tenant_id, name)
  values (p_tenant_id, 'CAJERO')
  on conflict (tenant_id, name) do nothing;

  insert into roles(tenant_id, name)
  values (p_tenant_id, 'INVENTARIO')
  on conflict (tenant_id, name) do nothing;

  select role_id into r_admin from roles where tenant_id = p_tenant_id and name='ADMINISTRADOR';
  select role_id into r_cashier from roles where tenant_id = p_tenant_id and name='CAJERO';
  select role_id into r_inventory from roles where tenant_id = p_tenant_id and name='INVENTARIO';

  -- Eliminar permisos existentes para reconfigurar
  delete from role_permissions where role_id in (r_admin, r_cashier, r_inventory);

  -- ADMINISTRADOR: todos los permisos
  insert into role_permissions(role_id, permission_id)
  select r_admin, p.permission_id
  from permissions p;

  -- CAJERO: ventas + pagos + caja + clientes básicos + reportes + plan separe
  insert into role_permissions(role_id, permission_id)
  select r_cashier, p.permission_id
  from permissions p
  where p.code in (
    'SALES.CREATE','SALES.HOLD','SALES.VIEW','SALES.PRINT_RECEIPT',
    'SALES.VOID','SALES.RETURN','SALES.DISCOUNT.LINE',
    'PAYMENTS.APPLY','PAYMENTS.VIEW','PAYMENTS.REFUND',
    'CASH.SESSION.OPEN','CASH.SESSION.CLOSE','CASH.VIEW',
    'CASH.MOVEMENT.INCOME','CASH.MOVEMENT.EXPENSE',
    'CUSTOMERS.CREATE','CUSTOMERS.VIEW','CUSTOMERS.UPDATE',
    'LAYAWAY.CREATE','LAYAWAY.VIEW','LAYAWAY.PAYMENT.ADD','LAYAWAY.COMPLETE',
    'REPORTS.SALES.VIEW','REPORTS.CASH.VIEW'
  );

  -- INVENTARIO: inventario + catálogo + reportes inventario
  insert into role_permissions(role_id, permission_id)
  select r_inventory, p.permission_id
  from permissions p
  where p.code in (
    'INVENTORY.VIEW','INVENTORY.ADJUST','INVENTORY.TRANSFER','INVENTORY.PURCHASE',
    'CATALOG.PRODUCT.CREATE','CATALOG.PRODUCT.UPDATE','CATALOG.CATEGORY.MANAGE',
    'CATALOG.BULK_IMPORT',
    'REPORTS.INVENTORY.VIEW'
  );

end;
$$;

-- Nota: Para inicializar roles en un tenant específico, ejecutar:
-- select fn_init_tenant_roles('tu-tenant-id-aqui');
