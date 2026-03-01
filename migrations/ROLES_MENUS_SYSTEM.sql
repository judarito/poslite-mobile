-- ===================================================================
-- Migración: Sistema de Menús, Roles y Permisos gestionado por Superadmin
-- Fecha: 2026-02-20
-- Descripción:
--   1. Crea tabla global menu_items (sin tenant_id) - solo Superadmin gestiona
--   2. Crea tabla menu_permissions (menú ↔ permiso requerido)
--   3. Crea tabla role_menus (rol de tenant ↔ menú visible)
--   4. Poblar menu_items con los menús actuales del sistema
--   5. Poblar role_menus por defecto (basado en roles estándar)
--   6. Función fn_superadmin_create_role_for_all_tenants
--   7. Función fn_superadmin_sync_role_menus_to_tenant
--   8. RLS: Superadmin puede escribir, tenant-users solo leer
-- ===================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '🔧 IMPLEMENTANDO SISTEMA DE MENÚS Y ROLES SUPERADMIN';
  RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;

-- ===================================================================
-- 1. TABLA GLOBAL: menu_items
-- ===================================================================
CREATE TABLE IF NOT EXISTS menu_items (
  menu_item_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT        UNIQUE NOT NULL,   -- ej: 'POS', 'SALES.HISTORY'
  label         TEXT        NOT NULL,          -- ej: 'Punto de Venta'
  icon          TEXT,                          -- ej: 'mdi-cash-register'
  route         TEXT,                          -- ej: '/pos' (NULL si es grupo)
  action        TEXT,                          -- ej: 'openManual' (NULL si es ruta)
  parent_code   TEXT        REFERENCES menu_items(code) ON DELETE SET NULL,
  sort_order    INT         DEFAULT 0,
  is_superadmin_only BOOLEAN DEFAULT FALSE,    -- true = solo Superadmin ve este ítem
  is_active     BOOLEAN     DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE menu_items IS 'Catálogo global de ítems de menú. Solo Superadmin puede modificar.';
COMMENT ON COLUMN menu_items.code IS 'Identificador único del menú, ej: POS, SALES.HISTORY, CATALOG';
COMMENT ON COLUMN menu_items.parent_code IS 'NULL = ítem raíz/grupo; código del padre = submenú';
COMMENT ON COLUMN menu_items.is_superadmin_only IS 'TRUE = solo visible para Superadmin, no se asigna a roles de tenant';

-- ===================================================================
-- 2. TABLA: menu_permissions (menú ↔ permisos requeridos)
--    Un menú puede requerir UNO O MÁS permisos (lógica OR: basta tener uno)
-- ===================================================================
CREATE TABLE IF NOT EXISTS menu_permissions (
  menu_item_id  UUID REFERENCES menu_items(menu_item_id) ON DELETE CASCADE,
  permission_id UUID REFERENCES permissions(permission_id) ON DELETE CASCADE,
  PRIMARY KEY (menu_item_id, permission_id)
);

COMMENT ON TABLE menu_permissions IS 'Permisos requeridos para acceder a un menú (OR: basta tener uno).';

-- ===================================================================
-- 3. TABLA: role_menus (rol de tenant ↔ menús visibles)
--    Superadmin define qué menús ve cada rol
-- ===================================================================
CREATE TABLE IF NOT EXISTS role_menus (
  role_id       UUID REFERENCES roles(role_id) ON DELETE CASCADE,
  menu_item_id  UUID REFERENCES menu_items(menu_item_id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, menu_item_id)
);

COMMENT ON TABLE role_menus IS 'Menús asignados a cada rol de tenant. Superadmin define el estándar.';

-- ===================================================================
-- 4. TABLA: role_menu_templates (plantillas globales por nombre de rol)
--    Superadmin define plantillas que se aplican automáticamente
--    cuando se crea un nuevo tenant
-- ===================================================================
CREATE TABLE IF NOT EXISTS role_menu_templates (
  template_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  role_name     TEXT        NOT NULL,          -- ej: 'ADMINISTRADOR', 'CAJERO'
  menu_item_id  UUID REFERENCES menu_items(menu_item_id) ON DELETE CASCADE,
  UNIQUE (role_name, menu_item_id)
);

COMMENT ON TABLE role_menu_templates IS 'Plantillas de menú por nombre de rol. Se aplican al crear nuevos tenants.';

-- ===================================================================
-- 4.5. IDEMPOTENCIA: agregar columnas que podrían faltar si la tabla ya existía
-- ===================================================================
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS action            TEXT;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS parent_code       TEXT;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS sort_order        INT         DEFAULT 0;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS is_superadmin_only BOOLEAN    DEFAULT FALSE;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS is_active         BOOLEAN     DEFAULT TRUE;

-- Asegurar FK de parent_code si no existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'menu_items_parent_code_fkey'
      AND conrelid = 'menu_items'::regclass
  ) THEN
    ALTER TABLE menu_items
      ADD CONSTRAINT menu_items_parent_code_fkey
      FOREIGN KEY (parent_code) REFERENCES menu_items(code) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE '✓ Columnas de menu_items verificadas (idempotente)'; END $$;

-- ===================================================================
-- 5. POBLAR menu_items CON LOS MENÚS ACTUALES DEL SISTEMA
-- ===================================================================

-- Grupos (sin route)
INSERT INTO menu_items (code, label, icon, route, sort_order) VALUES
  ('HOME',         'Inicio',                     'mdi-home',              '/',      1),
  ('POS',          'Punto de Venta',             'mdi-point-of-sale',     '/pos',  10),
  ('VENTAS',       'Ventas',                     'mdi-cart',              NULL,    20),
  ('CATALOGO',     'Catálogo',                   'mdi-tag-multiple',      NULL,    30),
  ('INVENTARIO',   'Inventario',                 'mdi-warehouse',         NULL,    40),
  ('CAJA',         'Caja',                       'mdi-cash-register',     NULL,    50),
  ('REPORTES',     'Reportes',                   'mdi-chart-bar',         '/reports', 60),
  ('CONFIG',       'Configuración',              'mdi-cog',               NULL,    70),
  ('MANUAL',       'Manual de Usuario',          'mdi-book-open-page-variant', NULL, 80),
  ('ACERCA',       'Acerca de',                  'mdi-information',       '/about', 90)
ON CONFLICT (code) DO UPDATE SET
  label      = EXCLUDED.label,
  icon       = EXCLUDED.icon,
  route      = EXCLUDED.route,
  sort_order = EXCLUDED.sort_order;

-- Submenús de VENTAS
INSERT INTO menu_items (code, label, icon, route, parent_code, sort_order) VALUES
  ('VENTAS.HISTORIAL', 'Historial Ventas',  'mdi-receipt-text',       '/sales',     'VENTAS', 21),
  ('VENTAS.CLIENTES',  'Clientes',          'mdi-account-group',      '/customers', 'VENTAS', 22),
  ('VENTAS.LAYAWAY',   'Plan Separe',       'mdi-calendar-clock',     '/layaway',   'VENTAS', 23)
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, route = EXCLUDED.route, parent_code = EXCLUDED.parent_code, sort_order = EXCLUDED.sort_order;

-- Submenús de CATALOGO
INSERT INTO menu_items (code, label, icon, route, parent_code, sort_order) VALUES
  ('CATALOGO.PRODUCTOS',   'Productos',           'mdi-package-variant-closed', '/products',   'CATALOGO', 31),
  ('CATALOGO.CATEGORIAS',  'Categorías',          'mdi-shape',                  '/categories', 'CATALOGO', 32),
  ('CATALOGO.UNIDADES',    'Unidades de Medida',  'mdi-ruler',                  '/units',      'CATALOGO', 33),
  ('CATALOGO.CARGA_MASIVA','Carga masiva de productos','mdi-file-import','/bulk-imports','CATALOGO',34)
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, route = EXCLUDED.route, parent_code = EXCLUDED.parent_code, sort_order = EXCLUDED.sort_order;

-- Submenús de INVENTARIO
INSERT INTO menu_items (code, label, icon, route, parent_code, sort_order) VALUES
  ('INV.STOCK',       'Stock y Kardex',           'mdi-clipboard-list',    '/inventory',         'INVENTARIO', 41),
  ('INV.LOTES',       'Lotes y Vencimientos',     'mdi-barcode',           '/batches',           'INVENTARIO', 42),
  ('INV.COMPRAS',     'Compras',                  'mdi-cart-plus',         '/purchases',         'INVENTARIO', 43),
  ('INV.PRODUCCION',  'Órdenes de Producción',    'mdi-factory',           '/production-orders', 'INVENTARIO', 44),
  ('INV.BOM',         'Listas de Materiales',     'mdi-file-tree',         '/boms',              'INVENTARIO', 45)
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, route = EXCLUDED.route, parent_code = EXCLUDED.parent_code, sort_order = EXCLUDED.sort_order;

-- Submenús de CAJA
INSERT INTO menu_items (code, label, icon, route, parent_code, sort_order) VALUES
  ('CAJA.SESIONES',    'Sesiones de Caja',     'mdi-cash-register',   '/cash-sessions',    'CAJA', 51),
  ('CAJA.REGISTROS',   'Cajas Registradoras',  'mdi-desktop-classic', '/cash-registers',   'CAJA', 52),
  ('CAJA.ASIGNACION',  'Asignación de Cajas',  'mdi-account-cash',    '/cash-assignments', 'CAJA', 53),
  ('CAJA.PAGOS',       'Métodos de Pago',      'mdi-credit-card',     '/payment-methods',  'CAJA', 54)
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, route = EXCLUDED.route, parent_code = EXCLUDED.parent_code, sort_order = EXCLUDED.sort_order;

-- Submenús de CONFIG
INSERT INTO menu_items (code, label, icon, route, parent_code, sort_order, is_superadmin_only) VALUES
  ('CONFIG.SETUP',    'Asistente de Configuración', 'mdi-rocket-launch',       '/setup',              'CONFIG', 71, FALSE),
  ('CONFIG.EMPRESA',  'Empresa',                    'mdi-domain',              '/tenant-config',      'CONFIG', 72, FALSE),
  ('CONFIG.TENANTS',  'Gestión de Tenants',         'mdi-office-building-plus','/tenant-management',  'CONFIG', 73, TRUE),  -- Solo Superadmin
  ('CONFIG.SEDES',    'Sedes',                      'mdi-store',               '/locations',          'CONFIG', 74, FALSE),
  ('CONFIG.IMPUESTOS','Impuestos',                  'mdi-percent',             '/taxes',              'CONFIG', 75, FALSE),
  ('CONFIG.REGIMP',   'Reglas de Impuestos',        'mdi-file-tree',           '/tax-rules',          'CONFIG', 76, FALSE),
  ('CONFIG.PRECIOS',  'Políticas de Precio',        'mdi-tag-multiple',        '/pricing-rules',      'CONFIG', 77, FALSE),
  ('CONFIG.ROLES',    'Roles y Permisos',           'mdi-shield-account',      '/superadmin/roles-menus', 'CONFIG', 78, TRUE),  -- Solo Superadmin
  ('CONFIG.USUARIOS', 'Usuarios',                   'mdi-account-cog',         '/auth',               'CONFIG', 79, FALSE)
ON CONFLICT (code) DO UPDATE SET
  label              = EXCLUDED.label,
  icon               = EXCLUDED.icon,
  route              = EXCLUDED.route,
  parent_code        = EXCLUDED.parent_code,
  sort_order         = EXCLUDED.sort_order,
  is_superadmin_only = EXCLUDED.is_superadmin_only;

-- MANUAL: acción especial
UPDATE menu_items SET action = 'openManual' WHERE code = 'MANUAL';

DO $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM menu_items;
  RAISE NOTICE '✓ menu_items poblados (% ítems)', v_count;
END $$;

-- ===================================================================
-- 6. POBLAR menu_permissions
--    Asignar permisos requeridos por cada menú (via código de permiso)
-- ===================================================================

-- Helper: insert menu_permissions por código
INSERT INTO menu_permissions (menu_item_id, permission_id)
SELECT 
  mi.menu_item_id,
  p.permission_id
FROM (VALUES
  -- (menu_code, permission_code)
  ('POS',              'SALES.CREATE'),
  ('VENTAS.HISTORIAL', 'SALES.VIEW'),
  ('VENTAS.CLIENTES',  'CUSTOMERS.VIEW'),
  ('VENTAS.LAYAWAY',   'LAYAWAY.VIEW'),
  ('CATALOGO.PRODUCTOS',  'CATALOG.PRODUCT.CREATE'),
  ('CATALOGO.PRODUCTOS',  'CATALOG.PRODUCT.UPDATE'),
  ('CATALOGO.CATEGORIAS', 'CATALOG.CATEGORY.MANAGE'),
  ('CATALOGO.UNIDADES',   'CATALOG.PRODUCT.CREATE'),
  ('CATALOGO.CARGA_MASIVA','CATALOG.BULK_IMPORT'),
  ('INV.STOCK',        'INVENTORY.VIEW'),
  ('INV.STOCK',        'INVENTORY.ADJUST'),
  ('INV.LOTES',        'INVENTORY.VIEW'),
  ('INV.COMPRAS',      'INVENTORY.VIEW'),
  ('INV.COMPRAS',      'INVENTORY.ADJUST'),
  ('INV.PRODUCCION',   'INVENTORY.VIEW'),
  ('INV.BOM',          'INVENTORY.VIEW'),
  ('CAJA.SESIONES',    'CASH.SESSION.OPEN'),
  ('CAJA.SESIONES',    'CASH.SESSION.CLOSE'),
  ('CAJA.REGISTROS',   'CASH.REGISTER.MANAGE'),
  ('CAJA.ASIGNACION',  'CASH.ASSIGN'),
  ('CAJA.ASIGNACION',  'SECURITY.USERS.MANAGE'),
  ('CAJA.PAGOS',       'SETTINGS.PAYMENT_METHODS.MANAGE'),
  ('REPORTES',         'REPORTS.SALES.VIEW'),
  ('REPORTES',         'REPORTS.INVENTORY.VIEW'),
  ('REPORTES',         'REPORTS.CASH.VIEW'),
  ('CONFIG.EMPRESA',   'SETTINGS.TENANT.MANAGE'),
  ('CONFIG.SEDES',     'SETTINGS.LOCATIONS.MANAGE'),
  ('CONFIG.IMPUESTOS', 'SETTINGS.TAXES.MANAGE'),
  ('CONFIG.REGIMP',    'SETTINGS.TAXES.MANAGE'),
  ('CONFIG.PRECIOS',   'SETTINGS.TAXES.MANAGE'),
  ('CONFIG.USUARIOS',  'SECURITY.USERS.MANAGE')
) AS mapping(menu_code, perm_code)
JOIN menu_items mi ON mi.code = mapping.menu_code
JOIN permissions p  ON p.code = mapping.perm_code
ON CONFLICT DO NOTHING;

DO $$ BEGIN RAISE NOTICE '✓ menu_permissions configurados'; END $$;

-- ===================================================================
-- 7. PLANTILLAS DE MENÚ POR ROL (role_menu_templates)
--    IMPORTANTE: Solo se almacenan ítems HOJA (con ruta o acción).
--    Los grupos padre (CATALOGO, VENTAS, etc.) son inferidos
--    automáticamente por fn_get_user_menus vía CTE recursivo.
--    Esto evita mantener la jerarquía manualmente en las plantillas.
-- ===================================================================

-- ADMINISTRADOR: todos los ítems hoja excepto los superadmin_only
INSERT INTO role_menu_templates (role_name, menu_item_id)
SELECT 'ADMINISTRADOR', menu_item_id
FROM menu_items
WHERE is_superadmin_only = FALSE
  AND is_active = TRUE
  AND (route IS NOT NULL OR action IS NOT NULL)  -- solo hojas con destino real
ON CONFLICT DO NOTHING;

-- GERENTE: ventas, catálogo, inventario, caja, reportes, config empresa
INSERT INTO role_menu_templates (role_name, menu_item_id)
SELECT 'GERENTE', mi.menu_item_id
FROM menu_items mi
WHERE mi.code IN (
  -- Ítems raíz con ruta propia
  'HOME', 'POS', 'REPORTES', 'ACERCA',
  -- Hojas de VENTAS
  'VENTAS.HISTORIAL', 'VENTAS.CLIENTES', 'VENTAS.LAYAWAY',
  -- Hojas de CATÁLOGO
  'CATALOGO.PRODUCTOS', 'CATALOGO.CATEGORIAS', 'CATALOGO.UNIDADES',
  'CATALOGO.CARGA_MASIVA',
  -- Hojas de INVENTARIO
  'INV.STOCK', 'INV.LOTES', 'INV.COMPRAS', 'INV.PRODUCCION', 'INV.BOM',
  -- Hojas de CAJA
  'CAJA.SESIONES', 'CAJA.REGISTROS', 'CAJA.ASIGNACION',
  -- Hojas de CONFIG
  'CONFIG.EMPRESA',
  -- Acción especial
  'MANUAL'
)
AND mi.is_active = TRUE
ON CONFLICT DO NOTHING;

-- CAJERO: POS, historial propio, clientes, plan separe, sesión de caja
INSERT INTO role_menu_templates (role_name, menu_item_id)
SELECT 'CAJERO', mi.menu_item_id
FROM menu_items mi
WHERE mi.code IN (
  'HOME', 'POS',
  'VENTAS.HISTORIAL', 'VENTAS.CLIENTES', 'VENTAS.LAYAWAY',
  'CAJA.SESIONES',
  'MANUAL', 'ACERCA'
)
AND mi.is_active = TRUE
ON CONFLICT DO NOTHING;

-- BODEGUERO: catálogo completo, inventario, compras
INSERT INTO role_menu_templates (role_name, menu_item_id)
SELECT 'BODEGUERO', mi.menu_item_id
FROM menu_items mi
WHERE mi.code IN (
  'HOME',
  'CATALOGO.PRODUCTOS', 'CATALOGO.CATEGORIAS', 'CATALOGO.UNIDADES',
  'CATALOGO.CARGA_MASIVA',
  'INV.STOCK', 'INV.LOTES', 'INV.COMPRAS', 'INV.PRODUCCION', 'INV.BOM',
  'MANUAL', 'ACERCA'
)
AND mi.is_active = TRUE
ON CONFLICT DO NOTHING;

DO $$ BEGIN RAISE NOTICE '✓ role_menu_templates definidas para 4 roles (solo hojas, padres inferidos por fn_get_user_menus)'; END $$;

-- ===================================================================
-- 8. APLICAR PLANTILLAS A TENANTS EXISTENTES
--    Poblar role_menus para todos los roles ya creados
-- ===================================================================
INSERT INTO role_menus (role_id, menu_item_id)
SELECT r.role_id, rmt.menu_item_id
FROM roles r
JOIN role_menu_templates rmt ON rmt.role_name = r.name
ON CONFLICT DO NOTHING;

DO $$ BEGIN RAISE NOTICE '✓ role_menus aplicados a todos los tenants existentes'; END $$;

-- ===================================================================
-- 9. FUNCIÓN: fn_superadmin_create_role_for_all_tenants
--    Crear un rol (con permisos y menús) en TODOS los tenants
-- ===================================================================
CREATE OR REPLACE FUNCTION fn_superadmin_create_role_for_all_tenants(
  p_role_name      TEXT,
  p_permission_ids UUID[] DEFAULT '{}',
  p_menu_codes     TEXT[] DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant RECORD;
  v_role_id UUID;
  v_count_tenants INT := 0;
  v_count_created INT := 0;
  v_menu_item_ids UUID[];
BEGIN
  IF p_role_name IS NULL OR trim(p_role_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Nombre de rol requerido');
  END IF;

  -- Resolver menu codes a IDs
  SELECT ARRAY_AGG(menu_item_id) INTO v_menu_item_ids
  FROM menu_items
  WHERE code = ANY(p_menu_codes) AND is_active = TRUE;

  -- Iterar sobre todos los tenants activos
  FOR v_tenant IN SELECT tenant_id FROM tenants WHERE is_active = TRUE LOOP
    v_count_tenants := v_count_tenants + 1;

    -- Crear rol solo si no existe en ese tenant
    SELECT role_id INTO v_role_id
    FROM roles
    WHERE tenant_id = v_tenant.tenant_id AND name = p_role_name;

    IF v_role_id IS NULL THEN
      INSERT INTO roles (tenant_id, name)
      VALUES (v_tenant.tenant_id, p_role_name)
      RETURNING role_id INTO v_role_id;
      v_count_created := v_count_created + 1;
    END IF;

    -- Asignar permisos (sin duplicados)
    IF array_length(p_permission_ids, 1) > 0 THEN
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT v_role_id, unnest(p_permission_ids)
      ON CONFLICT DO NOTHING;
    END IF;

    -- Asignar menús (sin duplicados)
    IF v_menu_item_ids IS NOT NULL AND array_length(v_menu_item_ids, 1) > 0 THEN
      INSERT INTO role_menus (role_id, menu_item_id)
      SELECT v_role_id, unnest(v_menu_item_ids)
      ON CONFLICT DO NOTHING;
    END IF;

  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'role_name', p_role_name,
    'tenants_processed', v_count_tenants,
    'roles_created', v_count_created,
    'message', format('Rol "%s" procesado en %s tenants (%s nuevos)', p_role_name, v_count_tenants, v_count_created)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', 'Error: ' || SQLERRM);
END;
$$;

COMMENT ON FUNCTION fn_superadmin_create_role_for_all_tenants IS
  'Superadmin: Crea/actualiza un rol con permisos y menús en TODOS los tenants.';

-- ===================================================================
-- 10. FUNCIÓN: fn_superadmin_sync_menus_to_role_all_tenants
--     Actualizar los menús de un rol en TODOS los tenants (reemplaza)
-- ===================================================================
CREATE OR REPLACE FUNCTION fn_superadmin_sync_menus_to_role_all_tenants(
  p_role_name  TEXT,
  p_menu_codes TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role RECORD;
  v_count INT := 0;
  v_menu_item_ids UUID[];
BEGIN
  -- Resolver menu codes a IDs
  SELECT ARRAY_AGG(menu_item_id) INTO v_menu_item_ids
  FROM menu_items
  WHERE code = ANY(p_menu_codes) AND is_active = TRUE;

  FOR v_role IN
    SELECT r.role_id
    FROM roles r
    JOIN tenants t ON t.tenant_id = r.tenant_id
    WHERE r.name = p_role_name AND t.is_active = TRUE
  LOOP
    -- Eliminar asignaciones actuales
    DELETE FROM role_menus WHERE role_id = v_role.role_id;

    -- Insertar nuevas
    IF v_menu_item_ids IS NOT NULL AND array_length(v_menu_item_ids, 1) > 0 THEN
      INSERT INTO role_menus (role_id, menu_item_id)
      SELECT v_role.role_id, unnest(v_menu_item_ids)
      ON CONFLICT DO NOTHING;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  -- Actualizar también la plantilla
  DELETE FROM role_menu_templates WHERE role_name = p_role_name;
  IF v_menu_item_ids IS NOT NULL AND array_length(v_menu_item_ids, 1) > 0 THEN
    INSERT INTO role_menu_templates (role_name, menu_item_id)
    SELECT p_role_name, unnest(v_menu_item_ids)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'role_name', p_role_name,
    'roles_updated', v_count,
    'message', format('Menús del rol "%s" sincronizados en %s instancias', p_role_name, v_count)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'message', 'Error: ' || SQLERRM);
END;
$$;

COMMENT ON FUNCTION fn_superadmin_sync_menus_to_role_all_tenants IS
  'Superadmin: Reemplaza los menús de un rol en TODOS los tenants y actualiza la plantilla.';

-- ===================================================================
-- 11. FUNCIÓN: fn_get_user_menus
--     Retorna los menús accesibles para un usuario dado su auth_user_id.
--
--     JERARQUÍA:
--     Los menús en role_menus son los ítems HOJA (con ruta real).
--     Esta función sube automáticamente la cadena parent_code para
--     incluir todos los grupos padre necesarios para mostrar el árbol
--     en el sidebar. Ejemplo:
--       Asignado: CATALOGO.PRODUCTOS  →  retorna también: CATALOGO
--       Asignado: INV.STOCK, INV.LOTES → retorna también: INVENTARIO
--
--     Resultado ordenado por sort_order, listo para construir árbol
--     en el frontend filtrando por parent_code IS NULL (raíces) y
--     luego hijos de cada raíz.
-- ===================================================================
CREATE OR REPLACE FUNCTION fn_get_user_menus(p_auth_user_id UUID)
RETURNS TABLE (
  menu_item_id  UUID,
  code          TEXT,
  label         TEXT,
  icon          TEXT,
  route         TEXT,
  action        TEXT,
  parent_code   TEXT,
  sort_order    INT,
  is_group      BOOLEAN   -- TRUE = grupo/padre sin ruta propia, FALSE = ítem hoja
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE
  -- PASO 1: ítems directamente asignados al usuario vía roles
  assigned AS (
    SELECT DISTINCT mi.menu_item_id, mi.code, mi.parent_code
    FROM menu_items mi
    JOIN role_menus rm ON rm.menu_item_id = mi.menu_item_id
    JOIN roles r       ON r.role_id  = rm.role_id
    JOIN user_roles ur ON ur.role_id = r.role_id
    JOIN users u       ON u.user_id  = ur.user_id
    WHERE u.auth_user_id   = p_auth_user_id
      AND mi.is_active      = TRUE
      AND mi.is_superadmin_only = FALSE
  ),

  -- PASO 2: subir la cadena de padres (CTE recursivo)
  -- Parte de los ítems asignados y agrega cada ancestro hasta llegar
  -- a un nodo raíz (parent_code IS NULL)
  hierarchy AS (
    -- Ancla: los propios ítems asignados
    SELECT a.menu_item_id, a.code, a.parent_code
    FROM assigned a

    UNION

    -- Recursión: el padre del nodo actual
    SELECT parent_mi.menu_item_id, parent_mi.code, parent_mi.parent_code
    FROM menu_items parent_mi
    JOIN hierarchy h ON h.parent_code = parent_mi.code
    WHERE parent_mi.is_active = TRUE
      AND parent_mi.is_superadmin_only = FALSE
  )

  -- PASO 3: retornar todos los nodos únicos con sus datos completos
  SELECT DISTINCT
    mi.menu_item_id,
    mi.code,
    mi.label,
    mi.icon,
    mi.route,
    mi.action,
    mi.parent_code,
    mi.sort_order,
    -- Es grupo si no tiene ruta propia Y tiene hijos en el resultado
    (mi.route IS NULL AND mi.action IS NULL) AS is_group
  FROM menu_items mi
  JOIN hierarchy h ON h.menu_item_id = mi.menu_item_id
  ORDER BY mi.sort_order, mi.code;
END;
$$;

COMMENT ON FUNCTION fn_get_user_menus IS
  'Retorna los menús accesibles para el usuario autenticado según sus roles.'
  'Incluye automáticamente los grupos padre de cualquier ítem asignado (jerarquía completa).'
  'Frontend: filtrar parent_code IS NULL para raíces, luego hijos de cada raíz.';

-- ===================================================================
-- 12. RLS (Row Level Security) para menu_items y role_menu_templates
-- ===================================================================

-- menu_items: cualquiera puede leer, nadie puede escribir via RLS
-- (Las funciones SECURITY DEFINER manejan escritura para Superadmin)
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "menu_items_read_all" ON menu_items;
CREATE POLICY "menu_items_read_all" ON menu_items
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "menu_items_write_superadmin" ON menu_items;
CREATE POLICY "menu_items_write_superadmin" ON menu_items
  FOR ALL
  USING (
    -- Solo usuarios que NO tienen registro en tabla users (= Superadmin)
    NOT EXISTS (
      SELECT 1 FROM users u WHERE u.auth_user_id = auth.uid()
    )
  );

-- menu_permissions: lectura libre, escritura solo Superadmin
ALTER TABLE menu_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "menu_permissions_read" ON menu_permissions;
CREATE POLICY "menu_permissions_read" ON menu_permissions
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "menu_permissions_write_superadmin" ON menu_permissions;
CREATE POLICY "menu_permissions_write_superadmin" ON menu_permissions
  FOR ALL
  USING (
    NOT EXISTS (SELECT 1 FROM users u WHERE u.auth_user_id = auth.uid())
  );

-- role_menus: usuarios pueden leer los de su tenant, Superadmin puede escribir todo
ALTER TABLE role_menus ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "role_menus_read_tenant" ON role_menus;
CREATE POLICY "role_menus_read_tenant" ON role_menus
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM roles r
      JOIN users u ON u.tenant_id = r.tenant_id
      WHERE r.role_id = role_menus.role_id
        AND u.auth_user_id = auth.uid()
    )
    OR
    NOT EXISTS (SELECT 1 FROM users u WHERE u.auth_user_id = auth.uid()) -- Superadmin
  );

DROP POLICY IF EXISTS "role_menus_write_superadmin" ON role_menus;
CREATE POLICY "role_menus_write_superadmin" ON role_menus
  FOR ALL
  USING (
    NOT EXISTS (SELECT 1 FROM users u WHERE u.auth_user_id = auth.uid())
  );

-- role_menu_templates: lectura libre, escritura Superadmin
ALTER TABLE role_menu_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "role_menu_templates_read" ON role_menu_templates;
CREATE POLICY "role_menu_templates_read" ON role_menu_templates
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "role_menu_templates_write_superadmin" ON role_menu_templates;
CREATE POLICY "role_menu_templates_write_superadmin" ON role_menu_templates
  FOR ALL
  USING (
    NOT EXISTS (SELECT 1 FROM users u WHERE u.auth_user_id = auth.uid())
  );

DO $$ BEGIN RAISE NOTICE '✓ RLS configurado para menu_items, menu_permissions, role_menus, role_menu_templates'; END $$;

-- ===================================================================
-- 13. ACTUALIZAR fn_create_tenant para aplicar plantillas al crear tenant
-- ===================================================================
-- Agregar al final del fn_create_tenant (step 8.5 entre roles y usuario)
-- Se recomienda re-ejecutar UPDATE_CREATE_TENANT_DEFAULTS.sql con el paso adicional.
-- Por ahora dejamos una función helper que se puede llamar desde fn_create_tenant:

CREATE OR REPLACE FUNCTION fn_apply_role_menu_templates(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO role_menus (role_id, menu_item_id)
  SELECT r.role_id, rmt.menu_item_id
  FROM roles r
  JOIN role_menu_templates rmt ON rmt.role_name = r.name
  WHERE r.tenant_id = p_tenant_id
  ON CONFLICT DO NOTHING;
END;
$$;

COMMENT ON FUNCTION fn_apply_role_menu_templates IS
  'Aplica las plantillas de menú por rol a un tenant específico al momento de su creación.';

-- ===================================================================
-- VERIFICACIÓN FINAL
-- ===================================================================
DO $$
DECLARE
  v_menus INT;
  v_templates INT;
  v_role_menus INT;
BEGIN
  SELECT COUNT(*) INTO v_menus FROM menu_items;
  SELECT COUNT(*) INTO v_templates FROM role_menu_templates;
  SELECT COUNT(*) INTO v_role_menus FROM role_menus;

  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ SISTEMA DE MENÚS IMPLEMENTADO EXITOSAMENTE';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Tablas creadas:';
  RAISE NOTICE '  ✓ menu_items            (% ítems)', v_menus;
  RAISE NOTICE '  ✓ menu_permissions';
  RAISE NOTICE '  ✓ role_menus            (% asignaciones)', v_role_menus;
  RAISE NOTICE '  ✓ role_menu_templates   (% plantillas)', v_templates;
  RAISE NOTICE '';
  RAISE NOTICE 'Funciones creadas:';
  RAISE NOTICE '  ✓ fn_superadmin_create_role_for_all_tenants(name, perm_ids, menu_codes)';
  RAISE NOTICE '  ✓ fn_superadmin_sync_menus_to_role_all_tenants(name, menu_codes)';
  RAISE NOTICE '  ✓ fn_get_user_menus(auth_user_id)';
  RAISE NOTICE '  ✓ fn_apply_role_menu_templates(tenant_id)';
  RAISE NOTICE '';
  RAISE NOTICE 'RLS configurado en:';
  RAISE NOTICE '  ✓ menu_items, menu_permissions, role_menus, role_menu_templates';
  RAISE NOTICE '';
  RAISE NOTICE '⚠ SIGUIENTE PASO: Actualizar fn_create_tenant para llamar a';
  RAISE NOTICE '  fn_apply_role_menu_templates(v_tenant_id) al final del paso 7';
END $$;
