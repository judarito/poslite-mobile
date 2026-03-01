-- ===================================================================
-- Migración: Agregar Configuraciones Avanzadas de Tenant
-- Fecha: 2026-02-13
-- Descripción: Expande tenant_settings con configuraciones de UI,
--              IA, inventario, ventas, y facturación
-- ===================================================================

-- Agregar columnas de configuración de interfaz
ALTER TABLE tenant_settings 
  ADD COLUMN IF NOT EXISTS default_page_size integer DEFAULT 10 CHECK (default_page_size IN (10, 20, 50, 100)),
  ADD COLUMN IF NOT EXISTS theme text DEFAULT 'light' CHECK (theme IN ('light', 'dark', 'auto')),
  ADD COLUMN IF NOT EXISTS date_format text DEFAULT 'DD/MM/YYYY' CHECK (date_format IN ('DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD')),
  ADD COLUMN IF NOT EXISTS locale text DEFAULT 'es-CO',
  ADD COLUMN IF NOT EXISTS session_timeout_minutes integer DEFAULT 60 CHECK (session_timeout_minutes > 0);

-- Agregar columnas de configuración de IA
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS ai_forecast_days_back integer DEFAULT 90 CHECK (ai_forecast_days_back IN (30, 60, 90, 180)),
  ADD COLUMN IF NOT EXISTS ai_purchase_suggestion_days integer DEFAULT 14 CHECK (ai_purchase_suggestion_days IN (7, 14, 30)),
  ADD COLUMN IF NOT EXISTS ai_purchase_advisor_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS ai_sales_forecast_enabled boolean DEFAULT true;

-- Agregar columnas de configuración de inventario
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS allow_negative_stock boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_min_stock numeric(14,3) DEFAULT 10,
  ADD COLUMN IF NOT EXISTS expiry_alert_days integer DEFAULT 30 CHECK (expiry_alert_days > 0),
  ADD COLUMN IF NOT EXISTS reserve_stock_on_layaway boolean DEFAULT true;

-- Agregar columnas de configuración de ventas y precios
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS currency_decimals integer DEFAULT 0 CHECK (currency_decimals IN (0, 2, 4)),
  ADD COLUMN IF NOT EXISTS allow_discounts boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_discount_without_auth numeric(5,2) DEFAULT 10.00 CHECK (max_discount_without_auth >= 0 AND max_discount_without_auth <= 100),
  ADD COLUMN IF NOT EXISTS rounding_method text DEFAULT 'NONE' CHECK (rounding_method IN ('NONE', 'UP', 'DOWN', 'NEAREST')),
  ADD COLUMN IF NOT EXISTS rounding_multiple integer DEFAULT 1 CHECK (rounding_multiple IN (1, 10, 100, 1000));

-- Agregar columnas de configuración de facturación
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS invoice_prefix text DEFAULT 'FAC',
  ADD COLUMN IF NOT EXISTS next_invoice_number bigint DEFAULT 1,
  ADD COLUMN IF NOT EXISTS electronic_invoicing_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS print_format text DEFAULT 'thermal' CHECK (print_format IN ('thermal', 'a4', 'ticket')),
  ADD COLUMN IF NOT EXISTS thermal_paper_width integer DEFAULT 80 CHECK (thermal_paper_width IN (58, 80));

-- Agregar columnas de configuración de notificaciones
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS email_alerts_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS alert_email text,
  ADD COLUMN IF NOT EXISTS notify_low_stock boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_expiring_products boolean DEFAULT true;

-- Comentarios de documentación
COMMENT ON COLUMN tenant_settings.default_page_size IS 'Número de registros por página en listados (10, 20, 50, 100)';
COMMENT ON COLUMN tenant_settings.theme IS 'Tema de la interfaz: light, dark, auto';
COMMENT ON COLUMN tenant_settings.date_format IS 'Formato de fecha preferido: DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD';
COMMENT ON COLUMN tenant_settings.locale IS 'Configuración regional (idioma y país)';
COMMENT ON COLUMN tenant_settings.session_timeout_minutes IS 'Minutos de inactividad antes de cerrar sesión automáticamente';

COMMENT ON COLUMN tenant_settings.ai_forecast_days_back IS 'Días de historial para pronóstico de ventas IA (30, 60, 90, 180)';
COMMENT ON COLUMN tenant_settings.ai_purchase_suggestion_days IS 'Días hacia adelante para sugerencias de compra (7, 14, 30)';
COMMENT ON COLUMN tenant_settings.ai_purchase_advisor_enabled IS 'Habilitar asesor inteligente de compras con IA';
COMMENT ON COLUMN tenant_settings.ai_sales_forecast_enabled IS 'Habilitar pronóstico de ventas con IA';

COMMENT ON COLUMN tenant_settings.allow_negative_stock IS 'Permitir ventas cuando el stock es negativo (sobreventa global)';
COMMENT ON COLUMN tenant_settings.default_min_stock IS 'Stock mínimo predeterminado al crear productos';
COMMENT ON COLUMN tenant_settings.expiry_alert_days IS 'Días de anticipación para alertar productos próximos a vencer';
COMMENT ON COLUMN tenant_settings.reserve_stock_on_layaway IS 'Reservar inventario cuando se crea plan separé';

COMMENT ON COLUMN tenant_settings.currency_decimals IS 'Decimales para mostrar moneda (0, 2, 4)';
COMMENT ON COLUMN tenant_settings.allow_discounts IS 'Permitir aplicar descuentos en ventas';
COMMENT ON COLUMN tenant_settings.max_discount_without_auth IS 'Porcentaje máximo de descuento sin autorización de supervisor';
COMMENT ON COLUMN tenant_settings.rounding_method IS 'Método de redondeo de totales: NONE, UP, DOWN, NEAREST';
COMMENT ON COLUMN tenant_settings.rounding_multiple IS 'Múltiplo para redondeo (1, 10, 100, 1000)';

COMMENT ON COLUMN tenant_settings.invoice_prefix IS 'Prefijo para numeración de facturas';
COMMENT ON COLUMN tenant_settings.next_invoice_number IS 'Siguiente número de factura consecutivo';
COMMENT ON COLUMN tenant_settings.electronic_invoicing_enabled IS 'Facturación electrónica habilitada';
COMMENT ON COLUMN tenant_settings.print_format IS 'Formato de impresión: thermal (térmico), a4 (carta), ticket';
COMMENT ON COLUMN tenant_settings.thermal_paper_width IS 'Ancho de papel térmico en mm (58, 80)';

COMMENT ON COLUMN tenant_settings.email_alerts_enabled IS 'Enviar alertas por correo electrónico';
COMMENT ON COLUMN tenant_settings.alert_email IS 'Email para recibir alertas del sistema';
COMMENT ON COLUMN tenant_settings.notify_low_stock IS 'Notificar cuando productos tengan stock bajo';
COMMENT ON COLUMN tenant_settings.notify_expiring_products IS 'Notificar cuando productos estén próximos a vencer';

-- Mensaje de confirmación
DO $$
BEGIN
  RAISE NOTICE '✅ Configuraciones avanzadas de tenant agregadas exitosamente';
  RAISE NOTICE '📊 Total nuevos campos: 29';
  RAISE NOTICE '🎨 Categorías: UI (5), IA (4), Inventario (4), Ventas (5), Facturación (5), Notificaciones (4)';
END $$;
