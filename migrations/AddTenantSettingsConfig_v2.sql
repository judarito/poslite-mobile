-- ===================================================================
-- Migración: Agregar Configuraciones Avanzadas de Tenant (v2 - Sin Duplicados)
-- Fecha: 2026-02-13
-- Descripción: Expande tenant_settings SOLO con configuraciones nuevas
--              que no existen en otros maestros:
--              - UI: paginación, tema, formato fecha, locale, timeout sesión
--              - IA: días pronóstico, días sugerencias, habilitar features
--              - Inventario: días alerta vencimiento, reservar en separé
--              - Ventas: límite descuento cajeros, redondeo
--              - Facturación: prefijos, consecutivos, impresión, electrónica
--              - Notificaciones: email, alertas
-- ===================================================================

-- =========================
-- 1) CONFIGURACIÓN DE INTERFAZ (UI)
-- =========================
ALTER TABLE tenant_settings 
  ADD COLUMN IF NOT EXISTS default_page_size integer DEFAULT 20 CHECK (default_page_size > 0),
  ADD COLUMN IF NOT EXISTS theme text DEFAULT 'light' CHECK (theme IN ('light', 'dark', 'auto')),
  ADD COLUMN IF NOT EXISTS date_format text DEFAULT 'DD/MM/YYYY',
  ADD COLUMN IF NOT EXISTS locale text DEFAULT 'es-CO',
  ADD COLUMN IF NOT EXISTS session_timeout_minutes integer DEFAULT 60 CHECK (session_timeout_minutes >= 5 AND session_timeout_minutes <= 480);

-- =========================
-- 2) CONFIGURACIÓN DE INTELIGENCIA ARTIFICIAL
-- =========================
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS ai_forecast_days_back integer DEFAULT 90 CHECK (ai_forecast_days_back IN (30, 60, 90, 180)),
  ADD COLUMN IF NOT EXISTS ai_purchase_suggestion_days integer DEFAULT 14 CHECK (ai_purchase_suggestion_days IN (7, 14, 30)),
  ADD COLUMN IF NOT EXISTS ai_purchase_advisor_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS ai_sales_forecast_enabled boolean DEFAULT true;

-- =========================
-- 3) CONFIGURACIÓN DE INVENTARIO (Sin duplicados - min_stock y allow_backorder ya existen por producto)
-- =========================
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS expiry_alert_days integer DEFAULT 30 CHECK (expiry_alert_days > 0 AND expiry_alert_days <= 365),
  ADD COLUMN IF NOT EXISTS reserve_stock_on_layaway boolean DEFAULT true;

-- =========================
-- 4) CONFIGURACIÓN DE VENTAS Y PRECIOS
-- =========================
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS max_discount_without_auth numeric(5,2) DEFAULT 5.00 CHECK (max_discount_without_auth >= 0 AND max_discount_without_auth <= 100),
  ADD COLUMN IF NOT EXISTS rounding_method text DEFAULT 'normal' CHECK (rounding_method IN ('normal', 'up', 'down', 'none')),
  ADD COLUMN IF NOT EXISTS rounding_multiple integer DEFAULT 100 CHECK (rounding_multiple IN (1, 10, 100, 1000));

-- =========================
-- 5) CONFIGURACIÓN DE FACTURACIÓN
-- =========================
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS invoice_prefix text DEFAULT 'FAC',
  ADD COLUMN IF NOT EXISTS next_invoice_number integer DEFAULT 1 CHECK (next_invoice_number > 0),
  ADD COLUMN IF NOT EXISTS electronic_invoicing_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS print_format text DEFAULT 'thermal' CHECK (print_format IN ('thermal', 'letter', 'ticket')),
  ADD COLUMN IF NOT EXISTS thermal_paper_width integer DEFAULT 80 CHECK (thermal_paper_width IN (58, 80));

-- =========================
-- 6) CONFIGURACIÓN DE NOTIFICACIONES
-- =========================
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS email_alerts_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS alert_email text,
  ADD COLUMN IF NOT EXISTS notify_low_stock boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_expiring_products boolean DEFAULT true;

-- =========================
-- COMENTARIOS DE DOCUMENTACIÓN
-- =========================

-- UI
COMMENT ON COLUMN tenant_settings.default_page_size IS 'Cantidad de registros por página en listados';
COMMENT ON COLUMN tenant_settings.theme IS 'Tema visual de la aplicación (light, dark, auto)';
COMMENT ON COLUMN tenant_settings.date_format IS 'Formato de fecha para mostrar (DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD)';
COMMENT ON COLUMN tenant_settings.locale IS 'Configuración regional (es-CO, es-MX, es-ES, en-US)';
COMMENT ON COLUMN tenant_settings.session_timeout_minutes IS 'Minutos de inactividad antes de cerrar sesión';

-- IA
COMMENT ON COLUMN tenant_settings.ai_forecast_days_back IS 'Días hacia atrás para análisis de tendencias en pronósticos IA';
COMMENT ON COLUMN tenant_settings.ai_purchase_suggestion_days IS 'Días hacia adelante para proyección de sugerencias de compra IA';
COMMENT ON COLUMN tenant_settings.ai_purchase_advisor_enabled IS 'Habilitar asesor de compras con IA';
COMMENT ON COLUMN tenant_settings.ai_sales_forecast_enabled IS 'Habilitar pronóstico de ventas con IA';

-- Inventario
COMMENT ON COLUMN tenant_settings.expiry_alert_days IS 'Cantidad de días antes del vencimiento para generar alertas';
COMMENT ON COLUMN tenant_settings.reserve_stock_on_layaway IS 'Reservar stock automáticamente al crear plan separé';

-- Ventas
COMMENT ON COLUMN tenant_settings.max_discount_without_auth IS 'Porcentaje máximo de descuento que puede aplicar un cajero sin autorización';
COMMENT ON COLUMN tenant_settings.rounding_method IS 'Método para redondear totales (normal, up, down, none)';
COMMENT ON COLUMN tenant_settings.rounding_multiple IS 'Múltiplo al cual redondear (1, 10, 100, 1000)';

-- Facturación
COMMENT ON COLUMN tenant_settings.invoice_prefix IS 'Prefijo para número de factura (ej: FAC, INV)';
COMMENT ON COLUMN tenant_settings.next_invoice_number IS 'Siguiente número consecutivo de factura';
COMMENT ON COLUMN tenant_settings.electronic_invoicing_enabled IS 'Habilitar integración con facturación electrónica';
COMMENT ON COLUMN tenant_settings.print_format IS 'Formato de impresión (thermal, letter, ticket)';
COMMENT ON COLUMN tenant_settings.thermal_paper_width IS 'Ancho del papel térmico en mm (58, 80)';

-- Notificaciones
COMMENT ON COLUMN tenant_settings.email_alerts_enabled IS 'Habilitar envío de alertas por email';
COMMENT ON COLUMN tenant_settings.alert_email IS 'Email donde se envían las alertas';
COMMENT ON COLUMN tenant_settings.notify_low_stock IS 'Notificar cuando productos tengan stock bajo';
COMMENT ON COLUMN tenant_settings.notify_expiring_products IS 'Notificar cuando productos estén próximos a vencer';

-- Mensaje de confirmación
DO $$
BEGIN
  RAISE NOTICE '✅ Configuraciones avanzadas de tenant agregadas exitosamente (v2 - sin duplicados)';
  RAISE NOTICE '📊 Total nuevos campos: 23 (eliminados 6 duplicados)';
  RAISE NOTICE '🎨 Categorías:';
  RAISE NOTICE '   - UI (5): paginación, tema, formato fecha, locale, timeout';
  RAISE NOTICE '   - IA (4): días pronóstico, días sugerencias, habilitar features';
  RAISE NOTICE '   - Inventario (2): días alerta vencimiento, reservar en separé';
  RAISE NOTICE '   - Ventas (3): límite descuento cajeros, método redondeo, múltiplo redondeo';
  RAISE NOTICE '   - Facturación (5): prefijo, consecutivo, electrónica, formato impresión, ancho papel';
  RAISE NOTICE '   - Notificaciones (4): email alertas, email destino, notificar stock bajo, notificar vencimientos';
  RAISE NOTICE '';
  RAISE NOTICE '❌ Eliminados (ya existen en otros maestros):';
  RAISE NOTICE '   - default_min_stock → Existe min_stock por producto en product_variants';
  RAISE NOTICE '   - allow_negative_stock → Existe allow_backorder por producto en product_variants';
  RAISE NOTICE '   - currency_decimals → Moneda ya definida en tenant.currency_code';
  RAISE NOTICE '   - allow_discounts → Descuentos ya implementados en POS para ADMINISTRADOR';
END $$;
