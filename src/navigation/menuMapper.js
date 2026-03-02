const ROUTE_SCREEN_MAP = {
  '/': 'Home',
  '/about': 'About',
  '/pos': 'PointOfSale',
  '/sales': 'Sales',
  '/third-parties': 'ThirdParties',
  '/third_parties': 'ThirdParties',
  '/terceros': 'ThirdParties',
  '/customers': 'Customers',
  '/layaway': 'Layaway',
  '/products': 'Products',
  '/categories': 'Categories',
  '/units': 'Units',
  '/bulk-imports': 'BulkImports',
  '/inventory': 'Inventory',
  '/batches': 'Batches',
  '/purchases': 'Purchases',
  '/production-orders': 'ProductionOrders',
  '/boms': 'BOMs',
  '/cash-sessions': 'CashSessions',
  '/cash-registers': 'CashRegisters',
  '/cash-assignments': 'CashAssignments',
  '/payment-methods': 'PaymentMethods',
  '/reports': 'Reports',
  '/reports/ventas': 'Reports',
  '/reports/cajas': 'Reports',
  '/reports/inventario': 'Reports',
  '/reports/financiero': 'Reports',
  '/reports/produccion': 'Reports',
  '/setup': 'Setup',
  '/tenant-config': 'TenantConfig',
  '/tenant-management': 'TenantManagement',
  '/locations': 'Locations',
  '/taxes': 'Taxes',
  '/tax-rules': 'TaxRules',
  '/pricing-rules': 'PricingRules',
  '/superadmin/roles-menus': 'RolesMenus',
  '/auth': 'Users',
  '/cartera': 'Cartera',
};

export function mapMenuItemToScreen(route) {
  return ROUTE_SCREEN_MAP[route] || null;
}

export function annotateMenuTreeWithSupport(menuTree) {
  return (menuTree || []).map((section) => ({
    ...section,
    targetScreen: mapMenuItemToScreen(section.route),
    supportedOnMobile: Boolean(section.action || mapMenuItemToScreen(section.route)),
    children: (section.children || []).map((child) => ({
      ...child,
      targetScreen: mapMenuItemToScreen(child.route),
      supportedOnMobile: Boolean(child.action || mapMenuItemToScreen(child.route)),
    })),
  }));
}
