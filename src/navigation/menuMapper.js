const ROUTE_SCREEN_MAP = {
  '/': 'Home',
  '/about': 'About',
  '/pos': 'PointOfSale',
  '/sales': 'Sales',
  '/third-parties': 'ThirdParties',
  '/third_parties': 'ThirdParties',
  '/terceros': 'ThirdParties',
  '/customers': 'Customers',
  '/clientes': 'Customers',
  '/suppliers': 'Suppliers',
  '/proveedores': 'Suppliers',
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
  '/ai-insights': 'AIInsights',
  '/setup': 'Setup',
  '/settings': 'Setup',
  '/tenant-config': 'TenantConfig',
  '/tenant-management': 'TenantManagement',
  '/tenant_management': 'TenantManagement',
  '/locations': 'Locations',
  '/taxes': 'Taxes',
  '/tax-rules': 'TaxRules',
  '/pricing-rules': 'PricingRules',
  '/superadmin/roles-menus': 'RolesMenus',
  '/roles': 'RolesMenus',
  '/auth': 'Users',
  '/cartera': 'Cartera',
};

const CORE_MENU_SECTIONS = [
  {
    code: 'INVENTARIO',
    label: 'Inventario',
    route: null,
    sort_order: 40,
    children: [
      { code: 'INV.STOCK', label: 'Stock y Kardex', route: '/inventory', sort_order: 41 },
      { code: 'INV.LOTES', label: 'Lotes y Vencimientos', route: '/batches', sort_order: 42 },
      { code: 'INV.COMPRAS', label: 'Compras', route: '/purchases', sort_order: 43 },
      { code: 'INV.PRODUCCION', label: 'Ordenes de Produccion', route: '/production-orders', sort_order: 44 },
      { code: 'INV.BOM', label: 'Listas de Materiales', route: '/boms', sort_order: 45 },
    ],
  },
  {
    code: 'CAJA',
    label: 'Caja',
    route: null,
    sort_order: 50,
    children: [
      { code: 'CAJA.SESIONES', label: 'Sesiones de Caja', route: '/cash-sessions', sort_order: 51 },
      { code: 'CAJA.REGISTROS', label: 'Cajas Registradoras', route: '/cash-registers', sort_order: 52 },
      { code: 'CAJA.ASIGNACION', label: 'Asignacion de Cajas', route: '/cash-assignments', sort_order: 53 },
      { code: 'CAJA.PAGOS', label: 'Metodos de Pago', route: '/payment-methods', sort_order: 54 },
    ],
  },
  {
    code: 'CONFIG',
    label: 'Configuracion',
    route: null,
    sort_order: 70,
    children: [
      { code: 'CONFIG.SETUP', label: 'Asistente de Configuracion', route: '/setup', sort_order: 71 },
      { code: 'CONFIG.EMPRESA', label: 'Empresa', route: '/tenant-config', sort_order: 72 },
      { code: 'CONFIG.SEDES', label: 'Sedes', route: '/locations', sort_order: 74 },
      { code: 'CONFIG.IMPUESTOS', label: 'Impuestos', route: '/taxes', sort_order: 75 },
      { code: 'CONFIG.REGIMP', label: 'Reglas de Impuesto', route: '/tax-rules', sort_order: 76 },
      { code: 'CONFIG.PRECIOS', label: 'Politicas de Precio', route: '/pricing-rules', sort_order: 77 },
      { code: 'CONFIG.USUARIOS', label: 'Usuarios', route: '/auth', sort_order: 79 },
    ],
  },
];

function normalizeRoute(route) {
  const text = String(route || '').trim().toLowerCase();
  if (!text) return '';
  if (text.length > 1 && text.endsWith('/')) return text.slice(0, -1);
  return text;
}

function flattenMenuItems(menuTree) {
  const source = Array.isArray(menuTree) ? menuTree : [];
  return source.flatMap((section) => [section, ...(Array.isArray(section?.children) ? section.children : [])]);
}

function mergeCoreMenuSections(menuTree) {
  const source = Array.isArray(menuTree) ? menuTree : [];
  const merged = source.map((section) => ({
    ...section,
    children: Array.isArray(section.children) ? [...section.children] : [],
  }));

  CORE_MENU_SECTIONS.forEach((requiredSection) => {
    const sectionIndex = merged.findIndex((item) => item?.code === requiredSection.code);
    if (sectionIndex === -1) {
      merged.push({ ...requiredSection, children: [...requiredSection.children] });
      return;
    }

    const existing = merged[sectionIndex];
    const childMap = new Map((existing.children || []).map((child) => [child.code, child]));
    requiredSection.children.forEach((requiredChild) => {
      if (!childMap.has(requiredChild.code)) {
        existing.children.push(requiredChild);
      }
    });

    existing.children.sort((a, b) => (a?.sort_order || 0) - (b?.sort_order || 0));
  });

  return merged.sort((a, b) => (a?.sort_order || 0) - (b?.sort_order || 0));
}

export function mapMenuItemToScreen(route) {
  const normalizedRoute = normalizeRoute(route);
  return ROUTE_SCREEN_MAP[normalizedRoute] || null;
}

export function normalizeMenuRoute(route) {
  return normalizeRoute(route);
}

export function collectAllowedMenuRoutes(menuTree) {
  const unique = new Set();
  flattenMenuItems(menuTree).forEach((item) => {
    const normalized = normalizeRoute(item?.route);
    if (normalized) unique.add(normalized);
  });
  return Array.from(unique);
}

export function collectAllowedMobileScreens(menuTree) {
  const unique = new Set();
  flattenMenuItems(menuTree).forEach((item) => {
    const targetScreen = String(item?.targetScreen || mapMenuItemToScreen(item?.route) || '').trim();
    if (targetScreen) unique.add(targetScreen);
  });
  return Array.from(unique);
}

export function collectMenuScreenRouteHints(menuTree) {
  const map = {};
  flattenMenuItems(menuTree).forEach((item) => {
    const targetScreen = String(item?.targetScreen || mapMenuItemToScreen(item?.route) || '').trim();
    const normalizedRoute = normalizeRoute(item?.route);
    if (!targetScreen || !normalizedRoute) return;
    if (!Array.isArray(map[targetScreen])) {
      map[targetScreen] = [];
    }
    if (!map[targetScreen].includes(normalizedRoute)) {
      map[targetScreen].push(normalizedRoute);
    }
  });
  return map;
}

export function canAccessPathByMenu(path, allowedRoutes) {
  if (!Array.isArray(allowedRoutes) || allowedRoutes.length === 0) return true;
  const normalizedPath = normalizeRoute(path);
  if (!normalizedPath) return false;
  if (normalizedPath === '/' || normalizedPath === '/about') return true;
  return allowedRoutes.some((menuRoute) => (
    normalizedPath === menuRoute || normalizedPath.startsWith(`${menuRoute}/`)
  ));
}

export function annotateMenuTreeWithSupport(menuTree) {
  const mergedTree = mergeCoreMenuSections(menuTree);
  return mergedTree.map((section) => ({
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
