-- ===================================================================
-- Migración: Añadir ítem de menú para Terceros (Clientes/Proveedores)
-- Fecha: 2026-02-21
-- Idempotente: inserta el menú y lo incorpora a plantillas de rol existentes
-- ===================================================================

DO $$ BEGIN RAISE NOTICE '✅ Añadiendo menú Terceros'; END $$;

-- Insertar ítem bajo VENTAS
INSERT INTO menu_items (code, label, icon, route, parent_code, sort_order)
VALUES ('VENTAS.TERCEROS', 'Terceros', 'mdi-account-multiple', '/third-parties', 'VENTAS', 24)
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon, route = EXCLUDED.route, parent_code = EXCLUDED.parent_code, sort_order = EXCLUDED.sort_order;

-- Asignar permiso requerido al menú (crear permiso si falta)
INSERT INTO permissions (permission_id, code, description)
SELECT gen_random_uuid(), 'THIRD_PARTIES.VIEW', 'Ver terceros (clientes/proveedores)'
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code = 'THIRD_PARTIES.VIEW');

-- Relacionar permiso con el menú
INSERT INTO menu_permissions (menu_item_id, permission_id)
SELECT mi.menu_item_id, p.permission_id
FROM menu_items mi JOIN permissions p ON p.code = 'THIRD_PARTIES.VIEW'
WHERE mi.code = 'VENTAS.TERCEROS'
ON CONFLICT DO NOTHING;

-- Agregar a plantillas de rol (ADMINISTRADOR y GERENTE)
INSERT INTO role_menu_templates (role_name, menu_item_id)
SELECT 'ADMINISTRADOR', menu_item_id FROM menu_items WHERE code = 'VENTAS.TERCEROS'
ON CONFLICT DO NOTHING;

INSERT INTO role_menu_templates (role_name, menu_item_id)
SELECT 'GERENTE', menu_item_id FROM menu_items WHERE code = 'VENTAS.TERCEROS'
ON CONFLICT DO NOTHING;

DO $$ BEGIN RAISE NOTICE '✓ Menu Terceros creado y añadido a plantillas'; END $$;
