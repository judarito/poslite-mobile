export const MOBILE_APP_BAR_TITLES = {
  Home: 'POSLite Mobile',
  PointOfSale: 'Punto de Venta',
  Sales: 'Historial Ventas',
  Layaway: 'Plan Separe',
  ThirdParties: 'Terceros',
  Cartera: 'Cartera',
  Products: 'Productos',
  Categories: 'Categorias',
  Units: 'Unidades de Medida',
  BulkImports: 'Carga Masiva',
  Inventory: 'Inventario',
  Batches: 'Lotes y Vencimientos',
  Purchases: 'Compras',
  ProductionOrders: 'Ordenes de Produccion',
  BOMs: 'Listas de Materiales',
  CashSessions: 'Sesiones de Caja',
  CashRegisters: 'Cajas Registradoras',
  CashAssignments: 'Asignacion de Cajas',
  PaymentMethods: 'Metodos de Pago',
  Reports: 'Reportes',
  Setup: 'Configuracion',
  TenantConfig: 'Config Empresa',
  Locations: 'Sedes',
  Taxes: 'Impuestos',
  TaxRules: 'Reglas de Impuesto',
  PricingRules: 'Reglas de Precio',
  Users: 'Usuarios',
  RolesMenus: 'Roles y Menus',
  About: 'Acerca de',
};

const MOBILE_SUPPORTED_SCREENS = new Set([
  'PointOfSale',
  'Sales',
  'Layaway',
  'ThirdParties',
  'Cartera',
  'Products',
  'Categories',
  'Units',
  'BulkImports',
  'Inventory',
  'Batches',
  'Purchases',
  'ProductionOrders',
  'BOMs',
  'CashSessions',
  'CashRegisters',
  'CashAssignments',
  'PaymentMethods',
  'Reports',
  'Setup',
  'TenantConfig',
  'Locations',
  'Taxes',
  'TaxRules',
  'PricingRules',
  'Users',
  'RolesMenus',
  'About',
]);

export function getMobileAppBarTitle(screen) {
  return MOBILE_APP_BAR_TITLES[screen] || 'POSLite Mobile';
}

export function isMobileScreenSupported(screen) {
  return MOBILE_SUPPORTED_SCREENS.has(screen);
}

export function resolveReportsInitialTab(route) {
  const normalized = String(route || '').toLowerCase();
  if (normalized.includes('/reports/cajas')) return 'cash';
  if (normalized.includes('/reports/inventario')) return 'inventory';
  if (normalized.includes('/reports/financiero')) return 'financial';
  if (normalized.includes('/reports/produccion')) return 'production';
  return 'sales';
}
