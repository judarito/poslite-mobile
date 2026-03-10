import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  BackHandler,
  AppState,
  Appearance,
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  StatusBar as RNStatusBar,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { supabase } from './src/lib/supabase';
import { ThemeModeProvider } from './src/lib/themeMode';
import { normalizeThemePreference, resolveThemeMode } from './src/lib/themePreferences';
import {
  clearAuthCache,
  clearOfflineOperationalData,
  clearMenuCache,
  getAuthCache,
  getMenuCache,
  getPendingOpsCount,
  initOfflineDatabase,
  saveMenuCache,
  saveAuthCache,
} from './src/storage/sqlite/database';
import {
  annotateMenuTreeWithSupport,
  canAccessPathByMenu,
  collectAllowedMenuRoutes,
  collectAllowedMobileScreens,
  collectMenuScreenRouteHints,
  normalizeMenuRoute,
} from './src/navigation/menuMapper';
import {
  getMobileAppBarTitle,
  isMobileScreenSupported,
  resolveReportsInitialTab,
} from './src/navigation/mobileScreenConfig';
import { APP_THEME_COLORS, HOME_BAR_THEME_COLORS, SCREEN_ACCENT_COLORS } from './src/theme/colors';
import { fetchUserMenus, isFreshCache } from './src/services/menu.service';
import { getDashboardSummary } from './src/services/reports.service';
import { syncPendingOperations } from './src/services/sync.service';
import {
  getCachedUserThemePreference,
  getTenantSettings,
  setCachedUserThemePreference,
} from './src/services/tenantSettings.service';
import { savePageCache } from './src/services/offlineCache.service';
import { listProducts } from './src/services/productsCatalog.service';
import { getSales } from './src/services/sales.service';
import { listCashSessions, listActiveCashRegisters } from './src/services/cashMenu.service';
import {
  getUnreadNotificationsCount,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeMyNotifications,
  unsubscribeNotifications,
} from './src/services/notifications.service';
import {
  configurePushNotifications,
  registerPushTokenForCurrentUser,
  subscribeToPushForeground,
  subscribeToPushResponses,
} from './src/services/pushNotifications.service';
import {
  getCurrentUserOpenSession,
  getPaymentMethodsForDropdown,
  warmCustomersCatalog,
  warmPosCatalog,
} from './src/services/pos.service';
import BulkImportsScreen from './src/screens/BulkImportsScreen';
import BOMsScreen from './src/screens/BOMsScreen';
import BatchesScreen from './src/screens/BatchesScreen';
import CarteraScreen from './src/screens/CarteraScreen';
import CashAssignmentsScreen from './src/screens/CashAssignmentsScreen';
import CashRegistersScreen from './src/screens/CashRegistersScreen';
import CashSessionsScreen from './src/screens/CashSessionsScreen';
import CategoriesScreen from './src/screens/CategoriesScreen';
import InventoryScreen from './src/screens/InventoryScreen';
import LayawayScreen from './src/screens/LayawayScreen';
import AboutScreen from './src/screens/AboutScreen';
import PaymentMethodsScreen from './src/screens/PaymentMethodsScreen';
import PointOfSaleScreen from './src/screens/PointOfSaleScreen';
import ProductionOrdersScreen from './src/screens/ProductionOrdersScreen';
import ProductsScreen from './src/screens/ProductsScreen';
import PurchasesScreen from './src/screens/PurchasesScreen';
import ReportsScreen from './src/screens/ReportsScreen';
import AIInsightsScreen from './src/screens/AIInsightsScreen';
import SalesHistoryScreen from './src/screens/SalesHistoryScreen';
import LoginScreen from './src/screens/LoginScreen';
import SetupScreen from './src/screens/SetupScreen';
import TaxRulesScreen from './src/screens/TaxRulesScreen';
import TaxesScreen from './src/screens/TaxesScreen';
import TenantConfigScreen from './src/screens/TenantConfigScreen';
import ThirdPartiesScreen from './src/screens/ThirdPartiesScreen';
import UnitsScreen from './src/screens/UnitsScreen';
import LocationsScreen from './src/screens/LocationsScreen';
import PricingRulesScreen from './src/screens/PricingRulesScreen';
import UsersScreen from './src/screens/UsersScreen';
import RolesMenusScreen from './src/screens/RolesMenusScreen';

function isJwtSessionError(error) {
  if (!error) return false;

  const status = Number(error?.status || error?.statusCode || 0);
  if (status === 401 || status === 403) return true;

  const message = String(error?.message || error?.error_description || error?.code || '').toLowerCase();
  return (
    message.includes('jwt') ||
    message.includes('token') ||
    message.includes('session') ||
    message.includes('expired') ||
    message.includes('refresh')
  );
}

const SCREEN_ICON_MAP = {
  Home: 'home-outline',
  PointOfSale: 'cart-outline',
  Sales: 'receipt-outline',
  Layaway: 'wallet-outline',
  ThirdParties: 'people-outline',
  Customers: 'people-outline',
  Suppliers: 'briefcase-outline',
  Cartera: 'card-outline',
  Products: 'cube-outline',
  Categories: 'grid-outline',
  Units: 'scale-outline',
  BulkImports: 'cloud-upload-outline',
  Inventory: 'layers-outline',
  Batches: 'albums-outline',
  Purchases: 'bag-handle-outline',
  ProductionOrders: 'construct-outline',
  BOMs: 'build-outline',
  CashSessions: 'cash-outline',
  CashRegisters: 'calculator-outline',
  CashAssignments: 'person-add-outline',
  PaymentMethods: 'wallet-outline',
  Reports: 'bar-chart-outline',
  AIInsights: 'sparkles-outline',
  Setup: 'settings-outline',
  TenantConfig: 'business-outline',
  TenantManagement: 'business-outline',
  Locations: 'location-outline',
  Taxes: 'pricetag-outline',
  TaxRules: 'document-text-outline',
  PricingRules: 'trending-up-outline',
  Users: 'person-outline',
  RolesMenus: 'shield-checkmark-outline',
  About: 'information-circle-outline',
};

const SCREEN_ACCENT_MAP = {
  PointOfSale: SCREEN_ACCENT_COLORS.PointOfSale,
  Sales: SCREEN_ACCENT_COLORS.Sales,
  Inventory: SCREEN_ACCENT_COLORS.Inventory,
  Reports: SCREEN_ACCENT_COLORS.Reports,
  AIInsights: SCREEN_ACCENT_COLORS.Reports,
  ThirdParties: SCREEN_ACCENT_COLORS.ThirdParties,
  Customers: SCREEN_ACCENT_COLORS.ThirdParties,
  Suppliers: SCREEN_ACCENT_COLORS.Products,
  Products: SCREEN_ACCENT_COLORS.Products,
  CashSessions: SCREEN_ACCENT_COLORS.CashSessions,
  Setup: SCREEN_ACCENT_COLORS.Setup,
  TenantManagement: SCREEN_ACCENT_COLORS.Setup,
};

function resolveMenuIcon(item) {
  const target = String(item?.targetScreen || '').trim();
  return SCREEN_ICON_MAP[target] || 'ellipse-outline';
}

function resolveMenuAccent(item) {
  const target = String(item?.targetScreen || '').trim();
  return SCREEN_ACCENT_MAP[target] || SCREEN_ACCENT_COLORS.fallback;
}

function extractInitials(name, fallback = 'U') {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return fallback;
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

const HOME_BAR_COLORS = HOME_BAR_THEME_COLORS;
const HOME_ACTION_LABELS = {
  Products: 'Productos',
  ThirdParties: 'Clientes',
  Inventory: 'Inventario',
  Reports: 'Reportes',
};
const ALWAYS_ALLOWED_SCREENS = new Set(['Home', 'About', 'AIInsights']);

export default function App() {
  const androidTopInset = Platform.OS === 'android' ? RNStatusBar.currentHeight || 0 : 0;

  const [session, setSession] = useState(null);
  const [loadingBoot, setLoadingBoot] = useState(true);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [offlineAvailable, setOfflineAvailable] = useState(false);
  const [cachedAt, setCachedAt] = useState('');
  const [pendingOpsCount, setPendingOpsCount] = useState(0);
  const [rawMenuTree, setRawMenuTree] = useState([]);
  const [menuTree, setMenuTree] = useState([]);
  const [menuCachedAt, setMenuCachedAt] = useState('');
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState({});
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [userProfile, setUserProfile] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [kpis, setKpis] = useState(null);
  const [dailySeries, setDailySeries] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [paymentMethodsSeries, setPaymentMethodsSeries] = useState([]);
  const [loadingKpis, setLoadingKpis] = useState(false);
  const [tenantSettings, setTenantSettings] = useState({});
  const [lastMenuAction, setLastMenuAction] = useState('');
  const [currentScreen, setCurrentScreen] = useState('Home');
  const [screenHistory, setScreenHistory] = useState([]);
  const [reportsInitialTab, setReportsInitialTab] = useState('sales');
  const [themePreference, setThemePreference] = useState('dark');
  const [themeMode, setThemeMode] = useState('dark');
  const [networkReachable, setNetworkReachable] = useState(true);
  const [error, setError] = useState('');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [loadingNotifications, setLoadingNotifications] = useState(false);

  const allowedMenuRoutes = useMemo(() => collectAllowedMenuRoutes(rawMenuTree), [rawMenuTree]);
  const allowedMenuScreens = useMemo(() => collectAllowedMobileScreens(rawMenuTree), [rawMenuTree]);
  const menuScreenRouteHints = useMemo(() => collectMenuScreenRouteHints(rawMenuTree), [rawMenuTree]);

  const canAccessScreenByMenu = useCallback((screenName, routeHint = '') => {
    const targetScreen = String(screenName || '').trim();
    if (!targetScreen) return false;
    if (ALWAYS_ALLOWED_SCREENS.has(targetScreen)) return true;

    if (allowedMenuRoutes.length > 0) {
      const normalizedHint = normalizeMenuRoute(routeHint);
      if (normalizedHint && canAccessPathByMenu(normalizedHint, allowedMenuRoutes)) {
        return true;
      }
      const screenRoutes = menuScreenRouteHints[targetScreen] || [];
      return screenRoutes.some((candidateRoute) => canAccessPathByMenu(candidateRoute, allowedMenuRoutes));
    }

    if (allowedMenuScreens.length > 0) {
      return allowedMenuScreens.includes(targetScreen);
    }

    return true;
  }, [allowedMenuRoutes, allowedMenuScreens, menuScreenRouteHints]);

  const navigateToScreen = useCallback((nextScreen, options = {}) => {
    const { reset = false, routeHint = '', denyMessage = '' } = options;
    const target = String(nextScreen || '').trim();
    if (!target) return false;

    if (!reset && !canAccessScreenByMenu(target, routeHint)) {
      setError(
        denyMessage ||
          `No tienes acceso al modulo "${getMobileAppBarTitle(target)}" con tu rol actual.`,
      );
      return false;
    }

    if (reset) {
      setScreenHistory([]);
      setCurrentScreen(target);
      return true;
    }

    setCurrentScreen((prevScreen) => {
      if (target === prevScreen) return prevScreen;
      setScreenHistory((prevHistory) => [...prevHistory, prevScreen].slice(-50));
      return target;
    });
    return true;
  }, [canAccessScreenByMenu]);

  const resetToHome = useCallback(() => {
    setScreenHistory([]);
    setCurrentScreen('Home');
  }, []);

  const goBack = useCallback(() => {
    setScreenHistory((prev) => {
      if (!prev.length) {
        setCurrentScreen('Home');
        return prev;
      }
      const next = [...prev];
      const previousScreen = next.pop() || 'Home';
      setCurrentScreen(previousScreen);
      return next;
    });
  }, []);

  const forceSessionToLogin = useCallback((reason = 'Tu sesion expiro. Inicia sesion nuevamente.') => {
    setError(reason);
    setOfflineMode(false);
    setSession(null);
    setUserProfile(null);
    setTenant(null);
    setKpis(null);
    setDailySeries([]);
    setTopProducts([]);
    setPaymentMethodsSeries([]);
    setTenantSettings({});
    setRawMenuTree([]);
    setMenuTree([]);
    setMenuCachedAt('');
    setExpandedSections({});
    setMenuOpen(false);
    setLastMenuAction('');
    setNotificationsOpen(false);
    setNotifications([]);
    setUnreadNotifications(0);
    resetToHome();
    setReportsInitialTab('sales');
  }, [resetToHome]);

  const applyThemeFromLocalCache = async (cachedAuth = null) => {
    const cached = cachedAuth || (await getAuthCache());
    const tenantId = cached?.tenant?.tenant_id || null;
    const userId = cached?.userProfile?.user_id || null;

    if (!tenantId || !userId) {
      setThemePreference('dark');
      setThemeMode('dark');
      return;
    }

    const cachedThemeResult = await getCachedUserThemePreference(tenantId, userId);
    const cachedTheme = cachedThemeResult?.data?.theme
      ? normalizeThemePreference(cachedThemeResult.data.theme)
      : null;

    if (cachedTheme) {
      setThemePreference(cachedTheme);
      setThemeMode(resolveThemeMode(cachedTheme));
      return;
    }

    const tenantSettingsResult = await getTenantSettings(tenantId, { offlineMode: true });
    const fallbackTenantTheme = normalizeThemePreference(tenantSettingsResult?.data?.theme || 'dark');
    setThemePreference(fallbackTenantTheme);
    setThemeMode(resolveThemeMode(fallbackTenantTheme));
    await setCachedUserThemePreference(tenantId, userId, fallbackTenantTheme);
  };

  useEffect(() => {
    configurePushNotifications();
    let mounted = true;

    const bootstrap = async () => {
      try {
        await initOfflineDatabase();

        const cached = await getAuthCache();
        const cachedMenu = await getMenuCache();
        const pendingCount = await getPendingOpsCount();
        if (mounted) {
          setPendingOpsCount(pendingCount);
        }
        if (cached && mounted) {
          setOfflineAvailable(true);
          setCachedAt(cached.cachedAt);
        }
        if (cachedMenu && mounted) {
          setRawMenuTree(Array.isArray(cachedMenu.menuTree) ? cachedMenu.menuTree : []);
          setMenuTree(annotateMenuTreeWithSupport(cachedMenu.menuTree));
          setMenuCachedAt(cachedMenu.cachedAt);
        }
        await applyThemeFromLocalCache(cached);

        const { data, error: sessionError } = await supabase.auth.getSession();
        if (!mounted) return;
        if (sessionError) {
          setError(sessionError.message);
          return;
        }

        const activeSession = data?.session ?? null;
        setSession(activeSession);
        if (activeSession?.user?.id) {
          await hydrateProfile(activeSession.user.id);
          return;
        }

        // No forzar modo offline automaticamente cuando no hay sesion activa.
        // El usuario puede elegir "Continuar sin conexion" desde Login si desea.
      } catch (e) {
        if (!mounted) return;
        setError(e?.message ?? 'Error inicializando modo offline.');
      } finally {
        if (mounted) setLoadingBoot(false);
      }
    };

    bootstrap();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        const reason = event === 'TOKEN_REFRESH_FAILED'
          ? 'Tu sesion expiro. Inicia sesion nuevamente.'
          : 'Sesion finalizada. Inicia sesion nuevamente.';
        forceSessionToLogin(reason);
        await applyThemeFromLocalCache();
      }
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, [forceSessionToLogin]);

  useEffect(() => {
    if (!session || offlineMode || !tenant?.tenant_id || !userProfile?.user_id) return undefined;

    let active = true;
    registerPushTokenForCurrentUser({
      tenantId: tenant.tenant_id,
      userId: userProfile.user_id,
    }).catch(() => null);

    const responseSub = subscribeToPushResponses((response) => {
      if (!active) return;
      const data = response?.notification?.request?.content?.data || {};
      const actionUrl = String(data?.action_url || '');
      if (actionUrl.includes('/reports')) {
        navigateToScreen('Reports', { routeHint: '/reports' });
      } else if (actionUrl.includes('/sales') || actionUrl.includes('/ventas')) {
        navigateToScreen('Sales', { routeHint: '/sales' });
      } else if (actionUrl.includes('/point-of-sale') || actionUrl.includes('/pos')) {
        navigateToScreen('PointOfSale', { routeHint: '/pos' });
      }
    });

    const foregroundSub = subscribeToPushForeground(() => {
      if (!active) return;
      refreshNotifications();
    });

    return () => {
      active = false;
      responseSub?.remove?.();
      foregroundSub?.remove?.();
    };
  }, [session, offlineMode, tenant?.tenant_id, userProfile?.user_id, navigateToScreen]);

  useEffect(() => {
    let active = true;
    let timer = null;

    const checkConnectivity = async () => {
      const baseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      if (!baseUrl) {
        if (active) setNetworkReachable(true);
        return;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      try {
        const response = await fetch(`${baseUrl}/rest/v1/`, {
          method: 'GET',
          headers: anonKey
            ? {
                apikey: anonKey,
                Authorization: `Bearer ${anonKey}`,
              }
            : undefined,
          signal: controller.signal,
        });
        if (active) {
          setNetworkReachable(response.status < 500);
        }
      } catch (_e) {
        if (active) setNetworkReachable(false);
      } finally {
        clearTimeout(timeout);
      }
    };

    checkConnectivity();
    timer = setInterval(checkConnectivity, 10000);

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        checkConnectivity();
      }
    });

    return () => {
      active = false;
      if (timer) clearInterval(timer);
      appStateSub.remove();
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    const shouldBeOffline = !networkReachable;
    setOfflineMode(shouldBeOffline);
  }, [session, networkReachable]);

  useEffect(() => {
    if (!session || offlineMode) return undefined;

    let active = true;
    let intervalId = null;
    let expiryTimer = null;

    const validateSession = async () => {
      if (!active) return;

      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (!active) return;

        if (sessionError && isJwtSessionError(sessionError)) {
          forceSessionToLogin('Tu sesion expiro. Inicia sesion nuevamente.');
          return;
        }

        const activeSession = sessionData?.session || null;
        if (!activeSession) {
          forceSessionToLogin('Tu sesion expiro. Inicia sesion nuevamente.');
          return;
        }

        const expiresAtSec = Number(activeSession?.expires_at || 0);
        if (Number.isFinite(expiresAtSec) && expiresAtSec > 0) {
          const expiresAtMs = expiresAtSec * 1000;
          if (expiresAtMs <= Date.now()) {
            forceSessionToLogin('Tu sesion expiro. Inicia sesion nuevamente.');
            return;
          }
        }

        const { error: userError } = await supabase.auth.getUser();
        if (!active) return;
        if (userError && isJwtSessionError(userError)) {
          forceSessionToLogin('Tu sesion expiro. Inicia sesion nuevamente.');
        }
      } catch (_e) {
        // Validacion best-effort para expiracion JWT.
      }
    };

    validateSession();
    intervalId = setInterval(validateSession, 60000);

    const expiresAtSec = Number(session?.expires_at || 0);
    if (Number.isFinite(expiresAtSec) && expiresAtSec > 0) {
      const msUntilExpiry = expiresAtSec * 1000 - Date.now();
      expiryTimer = setTimeout(
        validateSession,
        Math.max(1000, msUntilExpiry + 1500),
      );
    }

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        validateSession();
      }
    });

    return () => {
      active = false;
      if (intervalId) clearInterval(intervalId);
      if (expiryTimer) clearTimeout(expiryTimer);
      appStateSub.remove();
    };
  }, [session?.user?.id, session?.expires_at, offlineMode, forceSessionToLogin]);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    if (!session && !offlineMode) return undefined;

    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (menuOpen) {
        setMenuOpen(false);
        return true;
      }
      if (notificationsOpen) {
        setNotificationsOpen(false);
        return true;
      }
      if (currentScreen !== 'Home') {
        goBack();
        return true;
      }
      return false;
    });

    return () => sub.remove();
  }, [session, offlineMode, menuOpen, notificationsOpen, currentScreen, goBack]);

  useEffect(() => {
    if (ALWAYS_ALLOWED_SCREENS.has(currentScreen)) return;
    if (canAccessScreenByMenu(currentScreen)) return;
    setError(`Tu rol actual no tiene acceso a "${getMobileAppBarTitle(currentScreen)}".`);
    resetToHome();
    setMenuOpen(false);
  }, [currentScreen, canAccessScreenByMenu, resetToHome]);

  const userEmail = useMemo(() => session?.user?.email ?? '', [session]);
  const homeQuickActions = useMemo(() => {
    const flat = [];
    (menuTree || []).forEach((section) => {
      if (section.supportedOnMobile && section.targetScreen && section.targetScreen !== 'Home') {
        flat.push({
          code: section.code || section.targetScreen,
          label: section.label || section.title || section.targetScreen,
          targetScreen: section.targetScreen,
          route: section.route || '',
        });
      }
      (section.children || []).forEach((child) => {
        if (!child.supportedOnMobile || !child.targetScreen || child.targetScreen === 'Home') return;
        flat.push({
          code: child.code || child.targetScreen,
          label: child.label || child.title || child.targetScreen,
          targetScreen: child.targetScreen,
          route: child.route || '',
        });
      });
    });

    const unique = [];
    const seen = new Set();
    flat.forEach((item) => {
      const key = `${item.targetScreen}:${item.route}`;
      if (seen.has(key)) return;
      seen.add(key);
      unique.push(item);
    });
    return unique.slice(0, 12);
  }, [menuTree]);
  const homePrimaryActions = useMemo(() => {
    const preferredTargets = ['Products', 'ThirdParties', 'Inventory', 'Reports'];
    const byTarget = new Map();
    homeQuickActions.forEach((item) => {
      if (!item?.targetScreen || byTarget.has(item.targetScreen)) return;
      byTarget.set(item.targetScreen, item);
    });

    const prioritized = preferredTargets
      .map((target) => byTarget.get(target))
      .filter(Boolean);

    if (prioritized.length >= 4) return prioritized.slice(0, 4);

    const used = new Set(prioritized.map((item) => `${item.targetScreen}:${item.route || ''}`));
    homeQuickActions.forEach((item) => {
      const key = `${item.targetScreen}:${item.route || ''}`;
      if (used.has(key)) return;
      if (prioritized.length >= 4) return;
      used.add(key);
      prioritized.push(item);
    });

    return prioritized.slice(0, 4);
  }, [homeQuickActions]);
  const homeLast7Series = useMemo(() => (dailySeries || []).slice(-7), [dailySeries]);
  const homeMaxDaily = useMemo(() => {
    if (!homeLast7Series.length) return 1;
    return Math.max(...homeLast7Series.map((entry) => Number(entry?.total || 0)), 1);
  }, [homeLast7Series]);
  const monthVsPrev = Number(kpis?.month?.vs_prev || 0);
  const todayVsPrev = Number(kpis?.today?.vs_prev || 0);
  const profileInitials = useMemo(
    () => extractInitials(userProfile?.full_name || userEmail || 'U'),
    [userProfile?.full_name, userEmail],
  );
  const formatMoney = (value) => {
    const currency = tenant?.currency_code || 'COP';
    const amount = Number(value || 0);
    try {
      return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(amount);
    } catch (_e) {
      return `$ ${Math.round(amount).toLocaleString('es-CO')}`;
    }
  };
  const defaultPageSize = Number(tenantSettings?.default_page_size || 20);
  const formatDateTime = (value) => {
    if (!value) return '-';
    try {
      return new Date(value).toLocaleString();
    } catch (_e) {
      return String(value);
    }
  };
  const loadMenusForUser = async (authUserId, { preferFreshCache = true } = {}) => {
    if (!authUserId) return [];

    const cachedMenu = await getMenuCache();
    if (
      preferFreshCache &&
      cachedMenu?.authUserId === authUserId &&
      isFreshCache(cachedMenu.cachedAt)
    ) {
      const annotated = annotateMenuTreeWithSupport(cachedMenu.menuTree);
      setRawMenuTree(Array.isArray(cachedMenu.menuTree) ? cachedMenu.menuTree : []);
      setMenuTree(annotated);
      setMenuCachedAt(cachedMenu.cachedAt);
      return annotated;
    }

    setLoadingMenu(true);
    try {
      const { tree } = await fetchUserMenus(authUserId);
      const annotated = annotateMenuTreeWithSupport(tree);
      setRawMenuTree(Array.isArray(tree) ? tree : []);
      setMenuTree(annotated);
      const now = new Date().toISOString();
      setMenuCachedAt(now);
      await saveMenuCache({ authUserId, menuTree: tree });
      return annotated;
    } catch (menuError) {
      if (cachedMenu?.authUserId === authUserId && Array.isArray(cachedMenu.menuTree)) {
        const annotated = annotateMenuTreeWithSupport(cachedMenu.menuTree);
        setRawMenuTree(Array.isArray(cachedMenu.menuTree) ? cachedMenu.menuTree : []);
        setMenuTree(annotated);
        setMenuCachedAt(cachedMenu.cachedAt);
        return annotated;
      }
      throw menuError;
    } finally {
      setLoadingMenu(false);
    }
  };

  const loadDashboard = async (tenantId) => {
    if (!tenantId) {
      setKpis(null);
      setDailySeries([]);
      setTopProducts([]);
      setPaymentMethodsSeries([]);
      return;
    }
    setLoadingKpis(true);
    try {
      const result = await getDashboardSummary(tenantId);
      if (result.success) {
        setKpis(result.kpis);
        setDailySeries(result.dailySeries || []);
        setTopProducts(result.topProducts || []);
        setPaymentMethodsSeries(result.paymentMethods || []);
        return;
      }
      setKpis(null);
      setDailySeries([]);
      setTopProducts([]);
      setPaymentMethodsSeries([]);
    } catch (_e) {
      setKpis(null);
      setDailySeries([]);
      setTopProducts([]);
      setPaymentMethodsSeries([]);
    } finally {
      setLoadingKpis(false);
    }
  };

  const refreshPendingOpsCount = async ({
    tenantId = tenant?.tenant_id || null,
    userId = null,
  } = {}) => {
    const pendingCount = await getPendingOpsCount({ tenantId, userId });
    setPendingOpsCount(pendingCount);
  };

  const loadTenantConfig = async (tenantId, { forceOffline = false, userId = null } = {}) => {
    if (!tenantId) {
      setTenantSettings({});
      return;
    }

    const result = await getTenantSettings(tenantId, {
      offlineMode: forceOffline || offlineMode,
    });

    if (result.success) {
      const nextSettings = result.data || {};
      setTenantSettings(nextSettings);
      const tenantDefaultTheme = normalizeThemePreference(nextSettings.theme);
      let effectiveTheme = tenantDefaultTheme;

      if (userId) {
        const cachedThemeResult = await getCachedUserThemePreference(tenantId, userId);
        const cachedTheme = cachedThemeResult?.data?.theme
          ? normalizeThemePreference(cachedThemeResult.data.theme)
          : null;

        if (cachedTheme) {
          effectiveTheme = cachedTheme;
        } else {
          await setCachedUserThemePreference(tenantId, userId, tenantDefaultTheme);
        }
      }

      setThemePreference(effectiveTheme);
      setThemeMode(resolveThemeMode(effectiveTheme));
      return;
    }

    setTenantSettings({});
  };

  const warmCriticalOfflineCaches = async (tenantId, userId) => {
    if (!tenantId || !userId) return;
    try {
      const [sessionResult] = await Promise.all([
        getCurrentUserOpenSession(tenantId, userId, { offlineMode: false }),
        getPaymentMethodsForDropdown(tenantId, { offlineMode: false }),
        warmCustomersCatalog(tenantId),
        listActiveCashRegisters(tenantId),
      ]);

      const locationId = sessionResult?.success
        ? sessionResult?.data?.cash_register?.location_id || null
        : null;

      await Promise.all([
        warmPosCatalog(tenantId, locationId),
        warmPosCatalog(tenantId, null),
      ]);

      const [productsSale, productsComponents, cashSessions, salesHistory] = await Promise.all([
        listProducts({
          tenantId,
          search: '',
          limit: defaultPageSize,
          offset: 0,
          isComponent: false,
        }),
        listProducts({
          tenantId,
          search: '',
          limit: defaultPageSize,
          offset: 0,
          isComponent: true,
        }),
        listCashSessions({
          tenantId,
          status: null,
          limit: defaultPageSize,
          offset: 0,
        }),
        getSales(tenantId, 1, defaultPageSize, {
          status: null,
          location_id: null,
          from_date: null,
          to_date: null,
        }),
      ]);

      if (productsSale.success) {
        await savePageCache({
          namespace: 'catalog-products',
          tenantId,
          page: 1,
          pageSize: defaultPageSize,
          filters: { search: '', isComponent: false },
          items: productsSale.data || [],
          total: Number(productsSale.total || 0),
        });
      }
      if (productsComponents.success) {
        await savePageCache({
          namespace: 'catalog-products',
          tenantId,
          page: 1,
          pageSize: defaultPageSize,
          filters: { search: '', isComponent: true },
          items: productsComponents.data || [],
          total: Number(productsComponents.total || 0),
        });
      }
      if (cashSessions.success) {
        await savePageCache({
          namespace: 'cash-sessions',
          tenantId,
          page: 1,
          pageSize: defaultPageSize,
          filters: { status: '' },
          items: cashSessions.data || [],
          total: Number(cashSessions.total || 0),
        });
      }
      if (salesHistory.success) {
        await savePageCache({
          namespace: 'sales-history',
          tenantId,
          page: 1,
          pageSize: defaultPageSize,
          filters: { status: '', location_id: '', from_date: '', to_date: '' },
          items: salesHistory.data || [],
          total: Number(salesHistory.total || 0),
        });
      }
    } catch (_e) {
      // warming is best-effort; app flow must continue
    }
  };

  const handleLocalThemeChange = async (nextTheme) => {
    const normalizedPreference = normalizeThemePreference(nextTheme);
    setThemePreference(normalizedPreference);
    setThemeMode(resolveThemeMode(normalizedPreference));
    setTenantSettings((prev) => ({ ...(prev || {}), theme: normalizedPreference }));
    if (tenant?.tenant_id) {
      if (userProfile?.user_id) {
        await setCachedUserThemePreference(tenant.tenant_id, userProfile.user_id, normalizedPreference);
      }
    }
  };

  useEffect(() => {
    const sub = Appearance.addChangeListener(() => {
      if (themePreference === 'auto') {
        setThemeMode(resolveThemeMode('auto'));
      }
    });
    return () => sub.remove();
  }, [themePreference]);

  const toggleSection = (sectionCode) => {
    if (!sectionCode) return;
    setExpandedSections((prev) => ({
      ...prev,
      [sectionCode]: !prev[sectionCode],
    }));
  };

  const handleMenuAction = async (item) => {
    if (!item) return;
    setError('');

    if (item.route === '/' || item.targetScreen === 'Home') {
      resetToHome();
      setLastMenuAction('');
      setMenuOpen(false);
      return;
    }

    if (item.action === 'openManual') {
      setError('El manual de usuario esta disponible solo en la app web.');
      return;
    }

    if (isMobileScreenSupported(item.targetScreen)) {
      if (item.targetScreen === 'Reports') {
        setReportsInitialTab(resolveReportsInitialTab(item.route));
      }
      const didNavigate = navigateToScreen(item.targetScreen, {
        routeHint: item.route,
        denyMessage: `No tienes acceso a "${item.label || item.title}" con tu rol actual.`,
      });
      if (!didNavigate) return;
      setLastMenuAction('');
      setMenuOpen(false);
      return;
    }

    setError(`"${item.label || item.title}" no esta disponible en mobile todavia.`);
  };

  const hydrateProfile = async (authUserId) => {
    setLoadingProfile(true);
    setError('');
    try {
      const { data: profiles, error: profileError } = await supabase
        .from('users')
        .select(
          `
            user_id,
            auth_user_id,
            tenant_id,
            email,
            full_name,
            is_active,
            tenants (
              tenant_id,
              name,
              currency_code
            )
          `,
        )
        .eq('auth_user_id', authUserId);

      if (profileError) throw profileError;

      const profile = profiles?.[0] ?? null;
      if (!profile) {
        throw new Error('No se encontro perfil del usuario en OfirOne.');
      }
      if (!profile.is_active) {
        throw new Error('Tu usuario esta inactivo.');
      }

      const { data: userRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select(
          `
            role:role_id (
              role_id,
              name,
              role_permissions (
                permission:permission_id (
                  permission_id,
                  code,
                  description
                )
              )
            )
          `,
        )
        .eq('user_id', profile.user_id);

      if (rolesError) throw rolesError;

      const permissionsMap = new Map();
      (userRoles || []).forEach((ur) => {
        (ur.role?.role_permissions || []).forEach((rp) => {
          if (rp.permission?.code) {
            permissionsMap.set(rp.permission.code, rp.permission);
          }
        });
      });

      const enriched = {
        ...profile,
        roles: (userRoles || []).map((ur) => ur.role).filter(Boolean),
        permissions: Array.from(permissionsMap.values()),
        permissionCodes: Array.from(permissionsMap.keys()),
      };

      const tenantData = profile.tenants
        ? {
            tenant_id: profile.tenants.tenant_id,
            tenant_name: profile.tenants.name,
            currency_code: profile.tenants.currency_code,
          }
        : null;

      setUserProfile(enriched);
      setTenant(tenantData);
      setOfflineMode(false);

      await saveAuthCache({
        authUserId,
        userProfile: enriched,
        tenant: tenantData,
      });
      const pendingCount = await getPendingOpsCount({
        tenantId: tenantData?.tenant_id || null,
        userId: null,
      });
      setPendingOpsCount(pendingCount);
      setOfflineAvailable(true);
      setCachedAt(new Date().toISOString());
      setExpandedSections({});
      setLastMenuAction('');
      try {
        await loadMenusForUser(authUserId, { preferFreshCache: true });
      } catch (menuError) {
        setRawMenuTree([]);
        setMenuTree([]);
        setMenuCachedAt('');
        setError(
          menuError?.message ||
            'Sesion iniciada, pero no fue posible cargar el menu dinamico.',
        );
      }
      await loadTenantConfig(tenantData?.tenant_id, {
        forceOffline: false,
        userId: enriched?.user_id,
      });
      await loadDashboard(tenantData?.tenant_id);
      await warmCriticalOfflineCaches(tenantData?.tenant_id, enriched?.user_id);
    } catch (e) {
      setUserProfile(null);
      setTenant(null);
      setKpis(null);
      setTenantSettings({});
      setRawMenuTree([]);
      setMenuTree([]);
      setMenuCachedAt('');
      setError(e?.message ?? 'No fue posible cargar el perfil.');
    } finally {
      setLoadingProfile(false);
    }
  };

  const handleLogin = async () => {
    setError('');
    setLoadingAuth(true);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(signInError.message);
        return;
      }

      if (data?.user?.id) {
        await hydrateProfile(data.user.id);
      }
    } catch (e) {
      setError(e?.message ?? 'No fue posible iniciar sesion.');
    } finally {
      setLoadingAuth(false);
    }
  };

  useEffect(() => {
    let timer = null;
    let active = true;

    const runSync = async () => {
      if (!active || offlineMode || !session || !userProfile?.user_id || !tenant?.tenant_id) return;
      const syncResult = await syncPendingOperations({
        limit: 20,
        tenantId: tenant?.tenant_id || null,
        userId: null,
      });
      await refreshPendingOpsCount({
        tenantId: tenant?.tenant_id || null,
        userId: null,
      });
      if (syncResult?.processed > 0) {
        await loadDashboard(tenant.tenant_id);
        await warmCriticalOfflineCaches(tenant.tenant_id, userProfile.user_id);
      }
    };

    runSync();
    timer = setInterval(runSync, 20000);

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [offlineMode, session, userProfile?.user_id, tenant?.tenant_id]);

  useEffect(() => {
    if (!session || !networkReachable || !tenant?.tenant_id || !userProfile?.user_id) return;
    warmCriticalOfflineCaches(tenant.tenant_id, userProfile.user_id);
  }, [session, networkReachable, tenant?.tenant_id, userProfile?.user_id, defaultPageSize]);

  const refreshNotifications = async () => {
    if (!session || offlineMode) return;
    const [listResult, unreadResult] = await Promise.all([
      listMyNotifications({ limit: 40, offset: 0, onlyUnread: false }),
      getUnreadNotificationsCount(),
    ]);
    if (listResult.success) setNotifications(listResult.data || []);
    if (unreadResult.success) setUnreadNotifications(Number(unreadResult.data || 0));
  };

  const handleOpenNotifications = async () => {
    setNotificationsOpen(true);
    setLoadingNotifications(true);
    try {
      await refreshNotifications();
    } finally {
      setLoadingNotifications(false);
    }
  };

  const handleMarkNotificationRead = async (notificationId) => {
    if (!notificationId) return;
    const result = await markNotificationRead(notificationId);
    if (!result.success) return;
    setNotifications((prev) =>
      prev.map((item) =>
        item.notification_id === notificationId
          ? { ...item, is_read: true, read_at: item.read_at || new Date().toISOString() }
          : item,
      ),
    );
    setUnreadNotifications((prev) => Math.max(0, prev - 1));
  };

  const handleMarkAllNotificationsRead = async () => {
    const result = await markAllNotificationsRead();
    if (!result.success) return;
    const nowIso = new Date().toISOString();
    setNotifications((prev) => prev.map((item) => ({ ...item, is_read: true, read_at: item.read_at || nowIso })));
    setUnreadNotifications(0);
  };

  useEffect(() => {
    if (!session || offlineMode || !tenant?.tenant_id || !userProfile?.user_id) return undefined;
    let active = true;

    refreshNotifications();

    const channel = subscribeMyNotifications({
      tenantId: tenant.tenant_id,
      userId: userProfile.user_id,
      onInsert: (row) => {
        if (!active) return;
        setNotifications((prev) => [row, ...prev.filter((x) => x.notification_id !== row.notification_id)].slice(0, 80));
        if (!row?.is_read) setUnreadNotifications((prev) => prev + 1);
      },
      onUpdate: (nextRow) => {
        if (!active) return;
        setNotifications((prev) => {
          const prevRow = prev.find((x) => x.notification_id === nextRow.notification_id);
          if (prevRow) {
            if (!prevRow.is_read && nextRow.is_read) {
              setUnreadNotifications((count) => Math.max(0, count - 1));
            } else if (prevRow.is_read && !nextRow.is_read) {
              setUnreadNotifications((count) => count + 1);
            }
          }
          return prev.map((x) => (x.notification_id === nextRow.notification_id ? { ...x, ...nextRow } : x));
        });
      },
    });

    return () => {
      active = false;
      unsubscribeNotifications(channel);
    };
  }, [session, offlineMode, tenant?.tenant_id, userProfile?.user_id]);

  const handleLogout = async () => {
    setError('');
    if (offlineMode && !session) {
      setOfflineMode(false);
      setSession(null);
      setUserProfile(null);
      setTenant(null);
      setKpis(null);
      setDailySeries([]);
      setTopProducts([]);
      setPaymentMethodsSeries([]);
      setTenantSettings({});
      setRawMenuTree([]);
      resetToHome();
      setReportsInitialTab('sales');
      setMenuTree([]);
      setMenuCachedAt('');
      setExpandedSections({});
      setMenuOpen(false);
      setLastMenuAction('');
      setNotificationsOpen(false);
      setNotifications([]);
      setUnreadNotifications(0);
      await applyThemeFromLocalCache();
      return;
    }

    if (offlineMode && session) {
      await supabase.auth.signOut({ scope: 'local' });
    } else {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        setError(signOutError.message);
        return;
      }
    }

    setSession(null);
    setUserProfile(null);
    setTenant(null);
    setKpis(null);
    setDailySeries([]);
    setTopProducts([]);
    setPaymentMethodsSeries([]);
    setRawMenuTree([]);
    resetToHome();
    setReportsInitialTab('sales');
    setMenuTree([]);
    setMenuCachedAt('');
    setExpandedSections({});
    setMenuOpen(false);
    setLastMenuAction('');
    setNotificationsOpen(false);
    setNotifications([]);
    setUnreadNotifications(0);
    await applyThemeFromLocalCache();
  };

  const handleUseOfflineMode = async () => {
    setError('');
    const cached = await getAuthCache();
    const cachedMenu = await getMenuCache();
    if (!cached) {
      setError('No hay cache local para modo offline.');
      return;
    }
    setUserProfile(cached.userProfile);
    setTenant(cached.tenant);
    await loadTenantConfig(cached?.tenant?.tenant_id, {
      forceOffline: true,
      userId: cached?.userProfile?.user_id,
    });
    setKpis(null);
    setDailySeries([]);
    setTopProducts([]);
    setPaymentMethodsSeries([]);
    resetToHome();
    setCachedAt(cached.cachedAt);
    if (cachedMenu?.menuTree) {
      setRawMenuTree(Array.isArray(cachedMenu.menuTree) ? cachedMenu.menuTree : []);
      setMenuTree(annotateMenuTreeWithSupport(cachedMenu.menuTree));
      setMenuCachedAt(cachedMenu.cachedAt);
    } else {
      setRawMenuTree([]);
      setMenuTree([]);
      setMenuCachedAt('');
    }
    setExpandedSections({});
    setLastMenuAction('');
    setOfflineMode(true);
    setNotificationsOpen(false);
    setNotifications([]);
    setUnreadNotifications(0);
    const pendingCount = await getPendingOpsCount({
      tenantId: cached?.tenant?.tenant_id || null,
      userId: null,
    });
    setPendingOpsCount(pendingCount);
  };

  const handleClearOfflineCache = async () => {
    await clearAuthCache();
    await clearMenuCache();
    await clearOfflineOperationalData();
    setOfflineAvailable(false);
    setCachedAt('');
    setTenantSettings({});
    setRawMenuTree([]);
    setMenuTree([]);
    setMenuCachedAt('');
    resetToHome();
    setReportsInitialTab('sales');
    setThemePreference('dark');
    setThemeMode('dark');
    setExpandedSections({});
    setMenuOpen(false);
    setLastMenuAction('');
    setNotificationsOpen(false);
    setNotifications([]);
    setUnreadNotifications(0);
    setPendingOpsCount(0);
  };

  if (loadingBoot || loadingProfile) {
    return (
      <ThemeModeProvider mode={themeMode}>
        <SafeAreaView style={styles.centered}>
          <ActivityIndicator size="large" color={SCREEN_ACCENT_COLORS.Sales} />
          <Text style={styles.loadingText}>Inicializando app offline-first...</Text>
          <StatusBar style="auto" />
        </SafeAreaView>
      </ThemeModeProvider>
    );
  }

  const isLightTheme = themeMode === 'light';

  if (!session && !offlineMode) {
    return (
      <ThemeModeProvider mode={themeMode}>
        <LoginScreen
          email={email}
          password={password}
          error={error}
          loadingAuth={loadingAuth}
          offlineAvailable={offlineAvailable}
          cachedAt={cachedAt}
          onEmailChange={setEmail}
          onPasswordChange={setPassword}
          onLogin={handleLogin}
          onUseOfflineMode={handleUseOfflineMode}
          onClearOfflineCache={handleClearOfflineCache}
        />
      </ThemeModeProvider>
    );
  }

  return (
    <ThemeModeProvider mode={themeMode}>
      <SafeAreaView style={isLightTheme ? styles.root : styles.rootDark}>
      <View
        pointerEvents="none"
        style={[styles.brandGlowTop, isLightTheme ? styles.brandGlowTopLight : null]}
      />
      <View
        pointerEvents="none"
        style={[styles.brandGlowBottom, isLightTheme ? styles.brandGlowBottomLight : null]}
      />
      <View
        style={[
          styles.appBar,
          isLightTheme ? styles.appBarLight : null,
          {
            paddingTop: androidTopInset,
            height: 68 + androidTopInset,
          },
        ]}
      >
        <View style={styles.appBarLeft}>
          <Pressable onPress={() => setMenuOpen(true)} style={[styles.menuTrigger, isLightTheme ? styles.menuTriggerLight : null]}>
            <Ionicons name="menu" size={18} style={[styles.menuTriggerText, isLightTheme ? styles.menuTriggerTextLight : null]} />
          </Pressable>
          <View style={styles.appBrandLogoWrap}>
            <Image source={require('./assets/ofirone-mark-web.png')} style={styles.appBrandLogo} resizeMode="contain" />
          </View>
          <View style={styles.appBrandTextWrap}>
            <Text numberOfLines={1} style={styles.brandWordmark}>
              <Text style={[styles.brandWordmarkOfir, isLightTheme ? styles.brandWordmarkOfirLight : null]}>Ofir</Text>
              <Text style={[styles.brandWordmarkOne, isLightTheme ? styles.brandWordmarkOneLight : null]}>One</Text>
            </Text>
            <Text numberOfLines={1} style={[styles.appBarTitle, isLightTheme ? styles.appBarTitleLight : null]}>
              {getMobileAppBarTitle(currentScreen)}
            </Text>
          </View>
        </View>
        <View style={styles.appBarRight}>
          <Pressable
            onPress={handleOpenNotifications}
            style={[styles.notificationsBtn, isLightTheme ? styles.notificationsBtnLight : null]}
          >
            <Ionicons name="notifications-outline" size={17} style={[styles.notificationsBtnText, isLightTheme ? styles.notificationsBtnTextLight : null]} />
            {unreadNotifications > 0 ? (
              <View style={styles.notificationsBadge}>
                <Text style={styles.notificationsBadgeText}>
                  {unreadNotifications > 99 ? '99+' : unreadNotifications}
                </Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable
            onPress={() => handleLocalThemeChange(isLightTheme ? 'dark' : 'light')}
            style={[styles.themeToggleBtn, isLightTheme ? styles.themeToggleBtnLight : null]}
          >
            <Ionicons
              name={isLightTheme ? 'moon-outline' : 'sunny-outline'}
              size={16}
              style={[styles.themeToggleIcon, isLightTheme ? styles.themeToggleIconLight : null]}
            />
          </Pressable>
          <View style={[styles.connectionChip, offlineMode ? styles.connectionChipOffline : styles.connectionChipOnline]}>
            <Text style={[styles.connectionDot, offlineMode ? styles.connectionDotOffline : styles.connectionDotOnline]}>
              ●
            </Text>
            <Text style={[styles.connectionChipText, offlineMode ? styles.connectionChipTextOffline : styles.connectionChipTextOnline]}>
              {offlineMode ? `Offline · ${pendingOpsCount}` : 'Online'}
            </Text>
          </View>
          {currentScreen !== 'Home' ? (
            <Pressable
              onPress={goBack}
              hitSlop={8}
              style={[styles.appBarBackBtn, isLightTheme ? styles.appBarBackBtnLight : null]}
            >
              <Ionicons
                name="chevron-back"
                size={18}
                style={[styles.appBarBackIcon, isLightTheme ? styles.appBarBackIconLight : null]}
              />
            </Pressable>
          ) : null}
          <View style={[styles.appBarAvatar, isLightTheme ? styles.appBarAvatarLight : null]}>
            <Text style={[styles.appBarAvatarText, isLightTheme ? styles.appBarAvatarTextLight : null]}>
              {profileInitials}
            </Text>
          </View>
        </View>
      </View>

      <Modal visible={menuOpen} transparent animationType="slide" onRequestClose={() => setMenuOpen(false)}>
        <View style={styles.menuOverlay}>
          <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)} />
          <View style={[styles.menuDrawer, isLightTheme ? null : styles.menuDrawerDark]}>
            <View style={[styles.menuHeader, isLightTheme ? null : styles.menuHeaderDark]}>
              <View style={styles.menuHeaderBrand}>
                <Image source={require('./assets/ofirone-mark-web.png')} style={styles.menuHeaderLogo} resizeMode="contain" />
                <Text style={styles.menuHeaderWordmark}>
                  <Text style={[styles.brandWordmarkOfir, isLightTheme ? styles.brandWordmarkOfirLight : null]}>Ofir</Text>
                  <Text style={[styles.brandWordmarkOne, isLightTheme ? styles.brandWordmarkOneLight : null]}>One</Text>
                </Text>
              </View>
              <Pressable onPress={() => setMenuOpen(false)} style={[styles.menuCloseBtn, isLightTheme ? null : styles.menuCloseBtnDark]}>
                <Text style={[styles.menuCloseText, isLightTheme ? null : styles.menuCloseTextDark]}>Cerrar</Text>
              </Pressable>
            </View>
            <Text style={[styles.menuUser, isLightTheme ? null : styles.menuUserDark]}>{userProfile?.full_name || userEmail || 'Usuario'}</Text>
            <Text style={[styles.menuTenant, isLightTheme ? null : styles.menuTenantDark]}>{tenant?.tenant_name || 'Sin tenant'}</Text>

            <ScrollView contentContainerStyle={styles.menuContent}>
              {(menuTree || []).length === 0 ? (
                <Text style={[styles.menuEmptyText, isLightTheme ? null : styles.menuEmptyTextDark]}>No hay menu disponible para este usuario.</Text>
              ) : null}
              {(menuTree || []).map((section) => {
                const code = section.code || section.title;
                const hasChildren = Boolean(section.children?.length);
                const isExpanded = Boolean(expandedSections[code]);
                const sectionRoleAllowed = section.targetScreen
                  ? canAccessScreenByMenu(section.targetScreen, section.route)
                  : true;
                const hasEnabledChild = hasChildren
                  ? (section.children || []).some((child) => {
                      const childUnsupported = !child.supportedOnMobile && !child.action;
                      if (childUnsupported) return false;
                      if (!child.targetScreen) return true;
                      return canAccessScreenByMenu(child.targetScreen, child.route);
                    })
                  : false;
                const sectionDisabled = hasChildren
                  ? !sectionRoleAllowed && !hasEnabledChild
                  : !sectionRoleAllowed;

                return (
                  <View key={code} style={styles.menuSection}>
                    <Pressable
                      disabled={sectionDisabled}
                      style={[
                        styles.menuSectionBtn,
                        isLightTheme ? null : styles.menuSectionBtnDark,
                        sectionDisabled ? styles.menuSectionBtnDisabled : null,
                      ]}
                      onPress={() => {
                        if (hasChildren) {
                          toggleSection(code);
                          return;
                        }
                        handleMenuAction(section);
                      }}
                    >
                      <View style={styles.menuSectionLeft}>
                        <View
                          style={[
                            styles.menuIconBadge,
                            sectionDisabled ? styles.menuIconBadgeDisabled : null,
                            {
                              backgroundColor: `${resolveMenuAccent(section)}22`,
                              borderColor: `${resolveMenuAccent(section)}66`,
                            },
                          ]}
                        >
                          <Ionicons name={resolveMenuIcon(section)} size={14} color={resolveMenuAccent(section)} />
                        </View>
                        <Text
                          style={[
                            styles.menuSectionText,
                            isLightTheme ? null : styles.menuSectionTextDark,
                            sectionDisabled ? styles.menuSectionTextDisabled : null,
                          ]}
                        >
                          {section.label || section.title}
                        </Text>
                      </View>
                      {hasChildren && !sectionDisabled ? (
                        <Text style={[styles.menuChevron, isLightTheme ? null : styles.menuChevronDark]}>{isExpanded ? '−' : '+'}</Text>
                      ) : sectionDisabled ? (
                        <Ionicons name="lock-closed-outline" size={13} style={styles.menuLockedIcon} />
                      ) : null}
                    </Pressable>

                    {hasChildren && isExpanded ? (
                      <View style={styles.menuChildren}>
                        {section.children.map((child) => {
                          const childUnsupported = !child.supportedOnMobile && !child.action;
                          const childRoleBlocked = Boolean(child.targetScreen) &&
                            !canAccessScreenByMenu(child.targetScreen, child.route);
                          const childDisabled = childUnsupported || childRoleBlocked;

                          return (
                            <Pressable
                              key={child.code || child.title}
                              disabled={childDisabled}
                              onPress={() => handleMenuAction(child)}
                              style={[
                                styles.menuChildBtn,
                                isLightTheme ? null : styles.menuChildBtnDark,
                                childDisabled && styles.menuChildBtnDisabled,
                              ]}
                            >
                              <View
                                style={[
                                  styles.menuIconBadge,
                                  styles.menuChildIconBadge,
                                  childDisabled ? styles.menuIconBadgeDisabled : null,
                                  {
                                    backgroundColor: `${resolveMenuAccent(child)}20`,
                                    borderColor: `${resolveMenuAccent(child)}55`,
                                  },
                                ]}
                              >
                                <Ionicons name={resolveMenuIcon(child)} size={13} color={resolveMenuAccent(child)} />
                              </View>
                              <Text
                                style={[
                                  styles.menuChildText,
                                  isLightTheme ? null : styles.menuChildTextDark,
                                  childDisabled && styles.menuChildTextDisabled,
                                ]}
                              >
                                {child.label || child.title}
                              </Text>
                              {childDisabled ? (
                                <Ionicons name="lock-closed-outline" size={13} style={styles.menuLockedIcon} />
                              ) : (
                                <Ionicons
                                  name="chevron-forward"
                                  size={14}
                                  style={[styles.menuChildChevron, isLightTheme ? styles.menuChildChevronLight : null]}
                                />
                              )}
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
            <View style={[styles.menuFooter, isLightTheme ? null : styles.menuFooterDark]}>
              <Pressable onPress={handleLogout} style={[styles.menuLogoutBtn, isLightTheme ? null : styles.menuLogoutBtnDark]}>
                <Text style={styles.menuLogoutText}>Cerrar sesion</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={notificationsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setNotificationsOpen(false)}
      >
        <View style={styles.menuOverlay}>
          <Pressable style={styles.menuBackdrop} onPress={() => setNotificationsOpen(false)} />
          <View style={[styles.notificationsModal, isLightTheme ? styles.notificationsModalLight : null]}>
            <View style={styles.notificationsHeader}>
              <Text style={[styles.notificationsTitle, isLightTheme ? styles.notificationsTitleLight : null]}>
                Notificaciones
              </Text>
              <View style={styles.notificationsHeaderActions}>
                <Pressable onPress={handleMarkAllNotificationsRead} style={styles.notificationsMarkAllBtn}>
                  <Text style={styles.notificationsMarkAllText}>Marcar todas</Text>
                </Pressable>
                <Pressable
                  onPress={() => setNotificationsOpen(false)}
                  style={[styles.notificationsCloseBtn, isLightTheme ? styles.notificationsCloseBtnLight : null]}
                >
                  <Text style={[styles.notificationsCloseText, isLightTheme ? styles.notificationsCloseTextLight : null]}>
                    Cerrar
                  </Text>
                </Pressable>
              </View>
            </View>

            <ScrollView contentContainerStyle={styles.notificationsList}>
              {loadingNotifications ? (
                <Text style={[styles.notificationsEmpty, isLightTheme ? styles.notificationsEmptyLight : null]}>
                  Cargando...
                </Text>
              ) : notifications.length === 0 ? (
                <Text style={[styles.notificationsEmpty, isLightTheme ? styles.notificationsEmptyLight : null]}>
                  No tienes notificaciones.
                </Text>
              ) : (
                notifications.map((item) => (
                  <Pressable
                    key={item.notification_id}
                    onPress={() => handleMarkNotificationRead(item.notification_id)}
                    style={[
                      styles.notificationItem,
                      isLightTheme ? styles.notificationItemLight : null,
                      !item.is_read ? styles.notificationItemUnread : null,
                    ]}
                  >
                    <View style={styles.notificationTopRow}>
                      <Text style={[styles.notificationSeverity, isLightTheme ? styles.notificationSeverityLight : null]}>
                        {item.severity}
                      </Text>
                      <Text style={[styles.notificationDate, isLightTheme ? styles.notificationDateLight : null]}>
                        {formatDateTime(item.created_at)}
                      </Text>
                    </View>
                    <Text style={[styles.notificationTitle, isLightTheme ? styles.notificationTitleLight : null]}>
                      {item.title}
                    </Text>
                    <Text style={[styles.notificationMessage, isLightTheme ? styles.notificationMessageLight : null]}>
                      {item.message}
                    </Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {currentScreen === 'PointOfSale' ? (
        <PointOfSaleScreen
          tenant={tenant}
          userProfile={userProfile}
          tenantSettings={tenantSettings}
          themeMode={themeMode}
          offlineMode={offlineMode}
          onPendingOpsChange={setPendingOpsCount}
          onSaleCompleted={() => loadDashboard(tenant?.tenant_id)}
        />
      ) : currentScreen === 'Sales' ? (
        <SalesHistoryScreen
          tenant={tenant}
          userProfile={userProfile}
          formatMoney={formatMoney}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pendingOpsCount={pendingOpsCount}
          onPendingOpsChange={setPendingOpsCount}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'Layaway' ? (
        <LayawayScreen
          tenant={tenant}
          userProfile={userProfile}
          formatMoney={formatMoney}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'ThirdParties' ? (
        <ThirdPartiesScreen
          tenant={tenant}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'Customers' ? (
        <ThirdPartiesScreen
          tenant={tenant}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
          forcedType="customer"
          title="Clientes"
        />
      ) : currentScreen === 'Suppliers' ? (
        <ThirdPartiesScreen
          tenant={tenant}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
          forcedType="supplier"
          title="Proveedores"
        />
      ) : currentScreen === 'Cartera' ? (
        <CarteraScreen
          tenant={tenant}
          userProfile={userProfile}
          formatMoney={formatMoney}
          themeMode={themeMode}
          offlineMode={offlineMode}
        />
      ) : currentScreen === 'Products' ? (
        <ProductsScreen
          tenant={tenant}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'Categories' ? (
        <CategoriesScreen
          tenant={tenant}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'Units' ? (
        <UnitsScreen
          tenant={tenant}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'BulkImports' ? (
        <BulkImportsScreen tenant={tenant} themeMode={themeMode} offlineMode={offlineMode} />
      ) : currentScreen === 'Inventory' ? (
        <InventoryScreen
          tenant={tenant}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
          formatMoney={formatMoney}
        />
      ) : currentScreen === 'Batches' ? (
        <BatchesScreen
          tenant={tenant}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'Purchases' ? (
        <PurchasesScreen
          tenant={tenant}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
          formatMoney={formatMoney}
        />
      ) : currentScreen === 'ProductionOrders' ? (
        <ProductionOrdersScreen
          tenant={tenant}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'BOMs' ? (
        <BOMsScreen
          tenant={tenant}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'CashSessions' ? (
        <CashSessionsScreen
          tenant={tenant}
          userProfile={userProfile}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
          formatMoney={formatMoney}
        />
      ) : currentScreen === 'CashRegisters' ? (
        <CashRegistersScreen
          tenant={tenant}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'CashAssignments' ? (
        <CashAssignmentsScreen
          tenant={tenant}
          userProfile={userProfile}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'PaymentMethods' ? (
        <PaymentMethodsScreen
          tenant={tenant}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'Reports' ? (
        <ReportsScreen
          tenant={tenant}
          themeMode={themeMode}
          offlineMode={offlineMode}
          formatMoney={formatMoney}
          initialTab={reportsInitialTab}
        />
      ) : currentScreen === 'AIInsights' ? (
        <AIInsightsScreen
          tenant={tenant}
          themeMode={themeMode}
          offlineMode={offlineMode}
        />
      ) : currentScreen === 'Setup' ? (
        <SetupScreen onOpenScreen={navigateToScreen} themeMode={themeMode} />
      ) : currentScreen === 'TenantConfig' ? (
        <TenantConfigScreen
          tenant={tenant}
          offlineMode={offlineMode}
          themeMode={themeMode}
          onLocalThemeChange={handleLocalThemeChange}
        />
      ) : currentScreen === 'TenantManagement' ? (
        <TenantConfigScreen
          tenant={tenant}
          offlineMode={offlineMode}
          themeMode={themeMode}
          onLocalThemeChange={handleLocalThemeChange}
        />
      ) : currentScreen === 'Locations' ? (
        <LocationsScreen tenant={tenant} themeMode={themeMode} offlineMode={offlineMode} pageSize={defaultPageSize} />
      ) : currentScreen === 'Taxes' ? (
        <TaxesScreen tenant={tenant} themeMode={themeMode} offlineMode={offlineMode} pageSize={defaultPageSize} />
      ) : currentScreen === 'TaxRules' ? (
        <TaxRulesScreen
          tenant={tenant}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'PricingRules' ? (
        <PricingRulesScreen
          tenant={tenant}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'Users' ? (
        <UsersScreen
          tenant={tenant}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'RolesMenus' ? (
        <RolesMenusScreen
          tenant={tenant}
          userProfile={userProfile}
          themeMode={themeMode}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'About' ? (
        <AboutScreen tenant={tenant} userProfile={userProfile} themeMode={themeMode} offlineMode={offlineMode} />
      ) : (
        <View style={styles.homeScreenContainer}>
          <ScrollView contentContainerStyle={[styles.homeScrollDark, styles.homeScrollWithDock, isLightTheme && styles.homeScrollLight]}>
            <View style={styles.homeWrap}>
            <View style={[styles.mobileMetricMainCard, isLightTheme && styles.mobileMetricMainCardLight]}>
              <View style={styles.mobileMetricMainLeft}>
                <Image source={require('./assets/ofirone-mark-web.png')} style={styles.mobileMetricMainLogo} resizeMode="contain" />
                <View style={styles.mobileMetricMainTextWrap}>
                  <Text style={[styles.mobileMetricTitle, isLightTheme && styles.mobileMetricTitleLight]}>Ventas Hoy</Text>
                  <Text style={[styles.mobileMetricMainAmount, isLightTheme && styles.mobileMetricMainAmountLight]}>
                    {loadingKpis ? '...' : formatMoney(kpis?.today?.total || 0)}
                  </Text>
                </View>
              </View>
              <Text style={todayVsPrev >= 0 ? styles.mobileTrendUp : styles.mobileTrendDown}>
                {loadingKpis ? '...' : `${todayVsPrev >= 0 ? '↗' : '↘'} ${Math.abs(todayVsPrev || 0).toFixed(0)}%`}
              </Text>
            </View>

            <View style={[styles.mobileMetricCard, isLightTheme && styles.mobileMetricCardLight]}>
              <View style={styles.mobileMetricRow}>
                <View style={[styles.mobileMetricIconWrap, isLightTheme && styles.mobileMetricIconWrapLight]}>
                  <Ionicons name="briefcase-outline" size={18} style={styles.mobileMetricIconGold} />
                </View>
                <View style={styles.mobileMetricTextWrap}>
                  <Text style={[styles.mobileMetricTitle, isLightTheme && styles.mobileMetricTitleLight]}>Este Mes</Text>
                  <Text style={[styles.mobileMetricAmount, isLightTheme && styles.mobileMetricAmountLight]}>
                    {loadingKpis ? '...' : formatMoney(kpis?.month?.total || 0)}
                  </Text>
                </View>
                <Text style={monthVsPrev >= 0 ? styles.mobileTrendUp : styles.mobileTrendDown}>
                  {loadingKpis ? '...' : `${monthVsPrev >= 0 ? '↗' : '↘'} ${Math.abs(monthVsPrev || 0).toFixed(0)}%`}
                </Text>
              </View>
            </View>

            <View style={[styles.mobileMetricCard, styles.mobileMetricThinCard, isLightTheme && styles.mobileMetricCardLight]}>
              <View style={styles.mobileMetricRow}>
                <View style={[styles.mobileMetricIconWrap, isLightTheme && styles.mobileMetricIconWrapLight]}>
                  <Ionicons name="bar-chart-outline" size={18} style={styles.mobileMetricIconBlue} />
                </View>
                <Text style={[styles.mobileMetricTitle, isLightTheme && styles.mobileMetricTitleLight]}>Este Año</Text>
                <Text style={[styles.mobileMetricAmount, isLightTheme && styles.mobileMetricAmountLight]}>
                  {loadingKpis ? '...' : formatMoney(kpis?.year?.total || 0)}
                </Text>
              </View>
            </View>

            <Pressable
              onPress={() => navigateToScreen('PointOfSale', { routeHint: '/pos' })}
              style={[styles.quickSaleBtn, isLightTheme && styles.quickSaleBtnLight]}
            >
              <View style={styles.quickSaleContent}>
                <View style={[styles.quickSaleIconWrap, isLightTheme && styles.quickSaleIconWrapLight]}>
                  <Ionicons
                    name="storefront-outline"
                    size={20}
                    style={[styles.quickSaleIcon, isLightTheme && styles.quickSaleIconLight]}
                  />
                </View>
                <View style={styles.quickSaleTextWrap}>
                  <Text style={[styles.quickSaleBtnText, isLightTheme && styles.quickSaleBtnTextLight]}>
                    Nueva Venta
                  </Text>
                  <Text style={[styles.quickSaleHint, isLightTheme && styles.quickSaleHintLight]}>
                    Registrar pedido, pago y factura
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  style={[styles.quickSaleChevron, isLightTheme && styles.quickSaleChevronLight]}
                />
              </View>
            </Pressable>

            <View style={[styles.homeMiniChartCard, isLightTheme && styles.homeMiniChartCardLight]}>
              <Text style={[styles.homeMiniChartTitle, isLightTheme && styles.homeMiniChartTitleLight]}>
                Ventas últimos 7 días
              </Text>
              {loadingKpis ? (
                <Text style={[styles.homeMiniChartEmpty, isLightTheme && styles.homeMiniChartEmptyLight]}>Cargando...</Text>
              ) : homeLast7Series.length === 0 ? (
                <Text style={[styles.homeMiniChartEmpty, isLightTheme && styles.homeMiniChartEmptyLight]}>Sin datos</Text>
              ) : (
                <View style={styles.homeMiniBarsWrap}>
                  {homeLast7Series.map((entry, idx) => {
                    const dayDate = new Date(entry?.date || '');
                    const dayLabel = Number.isNaN(dayDate.getTime())
                      ? '-'
                      : ['D', 'L', 'M', 'M', 'J', 'V', 'S'][dayDate.getDay()];
                    const barHeight = Math.max(10, Math.round((Number(entry?.total || 0) / homeMaxDaily) * 100));
                    return (
                      <View key={`${entry?.date || idx}-${idx}`} style={styles.homeMiniBarCol}>
                        <View style={[styles.homeMiniBarTrack, isLightTheme && styles.homeMiniBarTrackLight]}>
                          <View
                            style={[
                              styles.homeMiniBarFill,
                              {
                                height: `${barHeight}%`,
                                backgroundColor: HOME_BAR_COLORS[idx % HOME_BAR_COLORS.length],
                              },
                            ]}
                          />
                        </View>
                        <Text style={[styles.homeMiniBarDay, isLightTheme && styles.homeMiniBarDayLight]}>{dayLabel}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
            {homePrimaryActions.length > 0 ? (
              <View style={[styles.mobileModulesCard, isLightTheme && styles.mobileModulesCardLight]}>
                {homePrimaryActions.map((item) => (
                  <Pressable
                    key={item.code}
                    onPress={() => navigateToScreen(item.targetScreen, { routeHint: item.route })}
                    style={[styles.mobileModuleItem, isLightTheme && styles.mobileModuleItemLight]}
                  >
                    <View
                      style={[
                        styles.mobileModuleIconWrap,
                        {
                          backgroundColor: `${resolveMenuAccent(item)}24`,
                          borderColor: `${resolveMenuAccent(item)}70`,
                        },
                      ]}
                    >
                      <Ionicons name={resolveMenuIcon(item)} size={20} color={resolveMenuAccent(item)} />
                    </View>
                    <Text numberOfLines={1} style={[styles.mobileModuleLabel, isLightTheme && styles.mobileModuleLabelLight]}>
                      {HOME_ACTION_LABELS[item.targetScreen] || item.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <Pressable
              onPress={() => navigateToScreen('AIInsights')}
              style={[styles.aiInsightsShortcut, isLightTheme && styles.aiInsightsShortcutLight]}
            >
              <View style={[styles.aiInsightsShortcutIconWrap, isLightTheme && styles.aiInsightsShortcutIconWrapLight]}>
                <Ionicons name="sparkles-outline" size={20} style={[styles.aiInsightsShortcutIcon, isLightTheme && styles.aiInsightsShortcutIconLight]} />
              </View>
              <View style={styles.aiInsightsShortcutTextWrap}>
                <Text style={[styles.aiInsightsShortcutTitle, isLightTheme && styles.aiInsightsShortcutTitleLight]}>
                  Centro IA
                </Text>
                <Text style={[styles.aiInsightsShortcutSub, isLightTheme && styles.aiInsightsShortcutSubLight]}>
                  8 analisis: inventario, compras, ventas, cajas, cartera, produccion, terceros y dashboard
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                style={[styles.aiInsightsShortcutChevron, isLightTheme && styles.aiInsightsShortcutChevronLight]}
              />
            </Pressable>

            {lastMenuAction ? <Text style={styles.successText}>{lastMenuAction}</Text> : null}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </View>
          </ScrollView>

          <View style={[styles.mobileBottomDock, styles.mobileBottomDockFixed, isLightTheme && styles.mobileBottomDockLight]}>
            <Pressable style={styles.mobileDockSideBtn} onPress={() => navigateToScreen('AIInsights', { routeHint: '/ai-insights' })}>
              <Ionicons name="sparkles" size={20} style={[styles.mobileDockSideIcon, isLightTheme && styles.mobileDockSideIconLight]} />
              <Text style={[styles.mobileDockSideText, isLightTheme && styles.mobileDockSideTextLight]}>IA</Text>
            </Pressable>

            <Pressable
              style={[styles.mobileDockMainBtn, isLightTheme && styles.mobileDockMainBtnLight]}
              onPress={() => navigateToScreen('PointOfSale', { routeHint: '/pos' })}
            >
              <Ionicons name="add" size={34} style={styles.mobileDockMainIcon} />
            </Pressable>

            <Pressable style={styles.mobileDockSideBtn} onPress={() => navigateToScreen('Sales', { routeHint: '/sales' })}>
              <Ionicons name="receipt" size={20} style={[styles.mobileDockSideIcon, isLightTheme && styles.mobileDockSideIconLight]} />
              <Text style={[styles.mobileDockSideText, isLightTheme && styles.mobileDockSideTextLight]}>Ventas</Text>
            </Pressable>
          </View>
        </View>
      )}
      <StatusBar
        style={isLightTheme ? 'dark' : 'light'}
        backgroundColor={isLightTheme ? APP_THEME_COLORS.light.statusBarBackground : APP_THEME_COLORS.dark.statusBarBackground}
        translucent={false}
      />
      </SafeAreaView>
    </ThemeModeProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: APP_THEME_COLORS.light.rootBackground,
  },
  rootDark: {
    flex: 1,
    backgroundColor: APP_THEME_COLORS.dark.rootBackground,
  },
  brandGlowTop: {
    position: 'absolute',
    top: -90,
    right: -60,
    width: 260,
    height: 260,
    borderRadius: 999,
    backgroundColor: APP_THEME_COLORS.shared.brandGlowTopDark,
    opacity: 0.22,
  },
  brandGlowTopLight: {
    backgroundColor: APP_THEME_COLORS.shared.brandGlowTopLight,
    opacity: 0.18,
  },
  brandGlowBottom: {
    position: 'absolute',
    bottom: -120,
    left: -80,
    width: 320,
    height: 320,
    borderRadius: 999,
    backgroundColor: APP_THEME_COLORS.shared.brandGlowBottomDark,
    opacity: 0.16,
  },
  brandGlowBottomLight: {
    backgroundColor: APP_THEME_COLORS.shared.brandGlowBottomLight,
    opacity: 0.12,
  },
  appBar: {
    height: 56,
    backgroundColor: APP_THEME_COLORS.dark.appBarBackground,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: APP_THEME_COLORS.dark.appBarBorder,
  },
  appBarLight: {
    backgroundColor: APP_THEME_COLORS.light.appBarBackground,
    borderBottomColor: APP_THEME_COLORS.light.appBarBorder,
  },
  appBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  appBrandLogoWrap: {
    width: 46,
    height: 46,
    marginLeft: 8,
    marginTop: -6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appBrandLogo: {
    width: 42,
    height: 42,
    transform: [{ translateY: -2 }],
  },
  appBrandTextWrap: {
    marginLeft: 8,
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  brandWordmark: {
    fontSize: 26,
    lineHeight: 26,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  brandWordmarkOfir: {
    color: APP_THEME_COLORS.dark.brandOfir,
  },
  brandWordmarkOfirLight: {
    color: APP_THEME_COLORS.light.brandOfir,
  },
  brandWordmarkOne: {
    color: APP_THEME_COLORS.dark.brandOne,
  },
  brandWordmarkOneLight: {
    color: APP_THEME_COLORS.light.brandOne,
  },
  appBarTitle: {
    color: APP_THEME_COLORS.dark.appBarTitle,
    fontWeight: '700',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 0,
  },
  appBarTitleLight: {
    color: APP_THEME_COLORS.light.appBarTitle,
  },
  appBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  notificationsBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: APP_THEME_COLORS.dark.iconButtonBorder,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: APP_THEME_COLORS.dark.iconButtonBackground,
    position: 'relative',
  },
  notificationsBtnLight: {
    backgroundColor: APP_THEME_COLORS.light.iconButtonBackground,
    borderColor: APP_THEME_COLORS.light.iconButtonBorder,
  },
  notificationsBtnText: {
    color: APP_THEME_COLORS.dark.iconButtonIcon,
  },
  notificationsBtnTextLight: {
    color: APP_THEME_COLORS.light.iconButtonIcon,
  },
  themeToggleBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: APP_THEME_COLORS.dark.iconButtonBorder,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: APP_THEME_COLORS.dark.iconButtonBackground,
  },
  themeToggleBtnLight: {
    backgroundColor: APP_THEME_COLORS.light.iconButtonBackground,
    borderColor: APP_THEME_COLORS.light.iconButtonBorder,
  },
  themeToggleIcon: {
    color: APP_THEME_COLORS.dark.themeToggleIcon,
  },
  themeToggleIconLight: {
    color: APP_THEME_COLORS.light.themeToggleIcon,
  },
  notificationsBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: APP_THEME_COLORS.shared.notificationBadgeBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationsBadgeText: {
    color: APP_THEME_COLORS.shared.notificationBadgeText,
    fontSize: 10,
    fontWeight: '700',
  },
  appBarBackBtn: {
    width: 34,
    height: 34,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: APP_THEME_COLORS.dark.backButtonBorder,
    backgroundColor: APP_THEME_COLORS.dark.backButtonBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appBarBackBtnLight: {
    borderColor: APP_THEME_COLORS.light.backButtonBorder,
    backgroundColor: APP_THEME_COLORS.light.backButtonBackground,
  },
  appBarBackIcon: {
    color: APP_THEME_COLORS.dark.backButtonIcon,
    marginLeft: -1,
  },
  appBarBackIconLight: {
    color: APP_THEME_COLORS.light.backButtonIcon,
  },
  appBarAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: APP_THEME_COLORS.dark.avatarBackground,
    borderWidth: 1,
    borderColor: APP_THEME_COLORS.dark.avatarBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appBarAvatarLight: {
    borderColor: APP_THEME_COLORS.light.avatarBorder,
    backgroundColor: APP_THEME_COLORS.light.avatarBackground,
  },
  appBarAvatarText: {
    color: APP_THEME_COLORS.dark.avatarText,
    fontSize: 12,
    fontWeight: '800',
  },
  appBarAvatarTextLight: {
    color: APP_THEME_COLORS.light.avatarText,
  },
  connectionChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  connectionChipOnline: {
    borderColor: APP_THEME_COLORS.shared.connectionOnlineBorder,
    backgroundColor: APP_THEME_COLORS.shared.connectionOnlineBackground,
  },
  connectionChipOffline: {
    borderColor: APP_THEME_COLORS.shared.connectionOfflineBorder,
    backgroundColor: APP_THEME_COLORS.shared.connectionOfflineBackground,
  },
  connectionChipText: {
    fontSize: 10,
    fontWeight: '700',
  },
  connectionChipTextOnline: { color: APP_THEME_COLORS.shared.connectionOnlineText },
  connectionChipTextOffline: { color: APP_THEME_COLORS.shared.connectionOfflineText },
  connectionDot: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
  connectionDotOnline: { color: APP_THEME_COLORS.shared.connectionOnlineDot },
  connectionDotOffline: { color: APP_THEME_COLORS.shared.connectionOfflineDot },
  menuTrigger: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: APP_THEME_COLORS.dark.menuTriggerBackground,
    borderWidth: 1,
    borderColor: APP_THEME_COLORS.dark.menuTriggerBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuTriggerLight: {
    backgroundColor: APP_THEME_COLORS.light.menuTriggerBackground,
    borderColor: APP_THEME_COLORS.light.menuTriggerBorder,
  },
  menuTriggerText: {
    color: APP_THEME_COLORS.dark.menuTriggerIcon,
  },
  menuTriggerTextLight: {
    color: APP_THEME_COLORS.light.menuTriggerIcon,
  },
  menuOverlay: {
    flex: 1,
    flexDirection: 'row',
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.5)',
  },
  menuDrawer: {
    width: '82%',
    maxWidth: 360,
    backgroundColor: '#f8fbff',
    borderLeftWidth: 1,
    borderLeftColor: '#cddcf1',
    paddingBottom: 14,
  },
  menuDrawerDark: {
    backgroundColor: '#0c1528',
    borderLeftColor: '#213755',
  },
  notificationsModal: {
    width: '92%',
    maxHeight: '78%',
    backgroundColor: '#0f172a',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 14,
    alignSelf: 'center',
    marginTop: 80,
    paddingBottom: 12,
  },
  notificationsModalLight: {
    backgroundColor: '#f8fafc',
    borderColor: '#cbd5e1',
  },
  notificationsHeader: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  notificationsHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  notificationsTitle: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '700',
  },
  notificationsTitleLight: {
    color: '#0f172a',
  },
  notificationsMarkAllBtn: {
    borderWidth: 1,
    borderColor: '#1d4ed8',
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  notificationsMarkAllText: {
    color: '#93c5fd',
    fontSize: 12,
    fontWeight: '700',
  },
  notificationsCloseBtn: {
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 8,
    backgroundColor: '#1e293b',
  },
  notificationsCloseBtnLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  notificationsCloseText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700',
  },
  notificationsCloseTextLight: {
    color: '#334155',
  },
  notificationsList: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  notificationsEmpty: {
    color: '#94a3b8',
    textAlign: 'center',
    paddingVertical: 16,
  },
  notificationsEmptyLight: {
    color: '#475569',
  },
  notificationItem: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    backgroundColor: '#111827',
    padding: 10,
    gap: 4,
  },
  notificationItemLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  notificationItemUnread: {
    borderColor: '#2563eb',
  },
  notificationTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  notificationSeverity: {
    color: '#93c5fd',
    fontSize: 11,
    fontWeight: '700',
  },
  notificationSeverityLight: {
    color: '#1d4ed8',
  },
  notificationDate: {
    color: '#94a3b8',
    fontSize: 11,
  },
  notificationDateLight: {
    color: '#64748b',
  },
  notificationTitle: {
    color: '#e2e8f0',
    fontWeight: '700',
    fontSize: 13,
  },
  notificationTitleLight: {
    color: '#0f172a',
  },
  notificationMessage: {
    color: '#cbd5e1',
    fontSize: 12,
    lineHeight: 16,
  },
  notificationMessageLight: {
    color: '#334155',
  },
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  menuHeaderDark: {
    borderBottomColor: '#1f2937',
  },
  menuHeaderTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
  },
  menuHeaderTitleDark: {
    color: '#f8fafc',
  },
  menuHeaderBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  menuHeaderLogo: {
    width: 42,
    height: 42,
  },
  menuHeaderWordmark: {
    fontSize: 28,
    lineHeight: 30,
    fontWeight: '900',
  },
  menuCloseBtn: {
    borderWidth: 1,
    borderColor: '#cfddf0',
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#ffffff',
  },
  menuCloseBtnDark: {
    borderColor: '#334d74',
    backgroundColor: '#11203a',
  },
  menuCloseText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '600',
  },
  menuCloseTextDark: {
    color: '#cbd5e1',
  },
  menuUser: {
    paddingHorizontal: 14,
    paddingTop: 10,
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '700',
  },
  menuUserDark: {
    color: '#e2e8f0',
  },
  menuTenant: {
    paddingHorizontal: 14,
    color: '#5d7394',
    fontSize: 11,
    marginBottom: 8,
  },
  menuTenantDark: {
    color: '#94a3b8',
  },
  menuContent: {
    paddingHorizontal: 10,
    paddingBottom: 30,
  },
  menuEmptyText: {
    color: '#64748b',
    fontSize: 13,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  menuEmptyTextDark: {
    color: '#94a3b8',
  },
  menuSection: {
    marginBottom: 6,
  },
  menuSectionBtn: {
    minHeight: 46,
    borderRadius: 12,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f5f8ff',
    borderWidth: 1,
    borderColor: '#d9e4f4',
  },
  menuSectionBtnDark: {
    backgroundColor: '#101a2e',
    borderColor: '#253957',
  },
  menuSectionBtnDisabled: {
    opacity: 0.52,
  },
  menuSectionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  menuIconBadge: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconBadgeDisabled: {
    opacity: 0.65,
  },
  menuSectionText: {
    color: '#0f172a',
    fontWeight: '700',
    fontSize: 13,
  },
  menuSectionTextDark: {
    color: '#e2e8f0',
  },
  menuSectionTextDisabled: {
    color: '#64748b',
  },
  menuChevron: {
    color: '#334155',
    fontSize: 18,
    fontWeight: '700',
  },
  menuChevronDark: {
    color: '#cbd5e1',
  },
  menuChildren: {
    marginTop: 4,
    marginLeft: 8,
  },
  menuChildBtn: {
    minHeight: 38,
    borderRadius: 9,
    paddingHorizontal: 10,
    backgroundColor: '#f0f5ff',
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#dbe7f7',
  },
  menuChildBtnDark: {
    backgroundColor: '#172236',
    borderColor: '#2a3f60',
  },
  menuChildIconBadge: {
    width: 22,
    height: 22,
    borderRadius: 7,
  },
  menuChildBtnDisabled: {
    opacity: 0.55,
  },
  menuChildText: {
    color: '#1e293b',
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
    marginLeft: 8,
  },
  menuChildTextDark: {
    color: '#e2e8f0',
  },
  menuChildTextDisabled: {
    color: '#64748b',
  },
  menuChildChevron: {
    color: '#4b5f84',
  },
  menuChildChevronLight: {
    color: '#607b9f',
  },
  menuLockedIcon: {
    color: '#7c8fae',
  },
  menuFooter: {
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  menuFooterDark: {
    borderTopColor: '#1f2937',
  },
  menuLogoutBtn: {
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuLogoutBtnDark: {
    backgroundColor: '#b91c1c',
  },
  menuLogoutText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  centered: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: '#334155',
  },
  homeWrap: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 30,
  },
  homeScreenContainer: {
    flex: 1,
  },
  homeScrollWithDock: {
    paddingBottom: 124,
  },
  mobileMetricMainCard: {
    marginBottom: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#223a5e',
    backgroundColor: '#111c33',
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mobileMetricMainCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  mobileMetricMainLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  mobileMetricMainLogo: {
    width: 58,
    height: 58,
    marginRight: 10,
  },
  mobileMetricMainTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  mobileMetricTitle: {
    color: '#e7efff',
    fontSize: 14,
    fontWeight: '700',
  },
  mobileMetricTitleLight: {
    color: '#223b64',
  },
  mobileMetricMainAmount: {
    marginTop: 4,
    color: '#f8fafc',
    fontSize: 42,
    lineHeight: 44,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  mobileMetricMainAmountLight: {
    color: '#1e2f4d',
  },
  mobileMetricCard: {
    marginBottom: 10,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#223a5e',
    backgroundColor: '#111c33',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  mobileMetricCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  mobileMetricThinCard: {
    paddingVertical: 10,
  },
  mobileMetricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mobileMetricIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a',
  },
  mobileMetricIconWrapLight: {
    backgroundColor: '#edf2fb',
  },
  mobileMetricIconGold: {
    color: '#f6c84a',
  },
  mobileMetricIconBlue: {
    color: '#5caeff',
  },
  mobileMetricTextWrap: {
    flex: 1,
  },
  mobileMetricAmount: {
    marginTop: 2,
    color: '#f8fafc',
    fontSize: 21,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  mobileMetricAmountLight: {
    color: '#1e2f4d',
  },
  mobileTrendUp: {
    color: '#65db72',
    fontWeight: '800',
    fontSize: 17,
  },
  mobileTrendDown: {
    color: '#f48a7d',
    fontWeight: '800',
    fontSize: 17,
  },
  homeMiniChartCard: {
    marginBottom: 10,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#223a5e',
    backgroundColor: '#101a2f',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  homeMiniChartCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  homeMiniChartTitle: {
    color: '#f0f4ff',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 10,
  },
  homeMiniChartTitleLight: {
    color: '#1f365c',
  },
  homeMiniChartEmpty: {
    color: '#8ca2c8',
    fontSize: 13,
  },
  homeMiniChartEmptyLight: {
    color: '#64748b',
  },
  homeMiniBarsWrap: {
    height: 116,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 8,
  },
  homeMiniBarCol: {
    flex: 1,
    alignItems: 'center',
  },
  homeMiniBarTrack: {
    width: '100%',
    height: 92,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2f456b',
    backgroundColor: '#0e1627',
    justifyContent: 'flex-end',
    padding: 4,
    overflow: 'hidden',
  },
  homeMiniBarTrackLight: {
    borderColor: '#dbe5f2',
    backgroundColor: '#eef3fb',
  },
  homeMiniBarFill: {
    width: '100%',
    borderRadius: 6,
    minHeight: 6,
  },
  homeMiniBarDay: {
    marginTop: 5,
    color: '#d4def3',
    fontSize: 10,
    fontWeight: '700',
  },
  homeMiniBarDayLight: {
    color: '#475569',
  },
  mobileModulesCard: {
    marginBottom: 12,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#223a5e',
    backgroundColor: '#0f1a2f',
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  mobileModulesCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  mobileModuleItem: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2d4264',
    backgroundColor: '#131f35',
    paddingHorizontal: 6,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobileModuleItemLight: {
    borderColor: '#dbe5f2',
    backgroundColor: '#f6f9ff',
  },
  mobileModuleIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 7,
  },
  mobileModuleLabel: {
    color: '#e0ebff',
    fontSize: 11,
    fontWeight: '700',
  },
  mobileModuleLabelLight: {
    color: '#2a466f',
  },
  aiInsightsShortcut: {
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2a4670',
    backgroundColor: '#111f37',
    borderRadius: 14,
    minHeight: 66,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiInsightsShortcutLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  aiInsightsShortcutIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#4f67a0',
    backgroundColor: '#162744',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiInsightsShortcutIconWrapLight: {
    borderColor: '#c9d8eb',
    backgroundColor: '#f1f6ff',
  },
  aiInsightsShortcutIcon: {
    color: '#8f7cff',
  },
  aiInsightsShortcutIconLight: {
    color: '#5d58d8',
  },
  aiInsightsShortcutTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  aiInsightsShortcutTitle: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '800',
  },
  aiInsightsShortcutTitleLight: {
    color: '#0f172a',
  },
  aiInsightsShortcutSub: {
    color: '#9fb7dc',
    fontSize: 11,
    marginTop: 2,
  },
  aiInsightsShortcutSubLight: {
    color: '#47638b',
  },
  aiInsightsShortcutChevron: {
    color: '#93c5fd',
  },
  aiInsightsShortcutChevronLight: {
    color: '#235ea9',
  },
  mobileBottomDock: {
    marginTop: 2,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#223a5e',
    backgroundColor: '#101b30',
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mobileBottomDockFixed: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 10,
    zIndex: 8,
  },
  mobileBottomDockLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  mobileDockSideBtn: {
    width: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  mobileDockSideIcon: {
    color: '#60adff',
  },
  mobileDockSideIconLight: {
    color: '#235ea9',
  },
  mobileDockSideText: {
    color: '#ccd9f3',
    fontSize: 11,
    fontWeight: '600',
  },
  mobileDockSideTextLight: {
    color: '#516a8f',
  },
  mobileDockMainBtn: {
    width: 152,
    height: 54,
    borderRadius: 27,
    borderWidth: 1,
    borderColor: '#8ce37f',
    backgroundColor: '#47be53',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#05280f',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 10,
    elevation: 6,
  },
  mobileDockMainBtnLight: {
    borderColor: '#83d77a',
    backgroundColor: '#4ec45b',
  },
  mobileDockMainIcon: {
    color: '#f2fff1',
    fontWeight: '700',
  },
  homeHeroCard: {
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f3e68',
    backgroundColor: '#0f1a30',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  homeHeroCardLight: {
    borderColor: '#cfddf0',
    backgroundColor: '#f8fbff',
  },
  quickGridCard: {
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#223a5e',
    backgroundColor: '#0f182b',
    padding: 10,
  },
  quickGridCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  quickGridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickGridItem: {
    width: '31%',
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#2d4264',
    backgroundColor: '#131f35',
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickGridItemLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#f8fbff',
  },
  quickGridIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  quickGridLabel: {
    color: '#dbeafe',
    fontSize: 11,
    fontWeight: '700',
  },
  quickGridLabelLight: {
    color: '#2a466f',
  },
  homeTitleDark: {
    fontSize: 30,
    fontWeight: '900',
    color: '#f4f8ff',
    letterSpacing: 0.2,
  },
  homeSubtitleDark: {
    fontSize: 12,
    color: '#9fb3d3',
    marginTop: 2,
    marginBottom: 2,
  },
  homeSubtitleLight: {
    color: '#475569',
  },
  homeScrollDark: {
    paddingBottom: 24,
  },
  homeScrollLight: {
    backgroundColor: '#f8fafc',
  },
  homeTitleLight: {
    color: '#0f172a',
  },
  statusRowDark: {
    marginBottom: 10,
  },
  statusTextDark: {
    color: '#bad0f1',
    fontSize: 12,
  },
  statusTextLight: {
    color: '#334155',
  },
  themeSwitchCard: {
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#223a5e',
    backgroundColor: '#0f1a30',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  themeSwitchCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  themeSwitchTextWrap: {
    flex: 1,
    paddingRight: 10,
  },
  themeSwitchTitle: {
    color: '#dbeafe',
    fontWeight: '700',
    fontSize: 13,
  },
  themeSwitchTitleLight: {
    color: '#0f172a',
  },
  themeSwitchSubtitle: {
    color: '#9fb3d3',
    marginTop: 2,
    fontSize: 11,
  },
  themeSwitchSubtitleLight: {
    color: '#64748b',
  },
  themeSwitchControlWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  themeSwitchMode: {
    color: '#e2e8f0',
    fontWeight: '700',
    fontSize: 12,
    minWidth: 50,
    textAlign: 'right',
  },
  themeSwitchModeLight: {
    color: '#334155',
  },
  quickSaleBtn: {
    marginBottom: 12,
    backgroundColor: '#3cae4d',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#7fe06e',
    shadowColor: '#020617',
    shadowOpacity: 0.28,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 10,
    elevation: 5,
  },
  quickSaleBtnLight: {
    backgroundColor: '#47b954',
    borderColor: '#92dc84',
    shadowColor: '#2f8a3a',
    shadowOpacity: 0.18,
  },
  quickSaleContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  quickSaleIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(2, 25, 8, 0.24)',
  },
  quickSaleIconWrapLight: {
    backgroundColor: 'rgba(235, 255, 234, 0.5)',
  },
  quickSaleIcon: {
    color: '#dbeafe',
  },
  quickSaleIconLight: {
    color: '#eff6ff',
  },
  quickSaleTextWrap: {
    flex: 1,
    marginLeft: 12,
  },
  quickSaleBtnText: {
    color: '#f8fafc',
    fontWeight: '800',
    fontSize: 15,
  },
  quickSaleBtnTextLight: {
    color: '#ffffff',
  },
  quickSaleHint: {
    color: '#e9ffe8',
    marginTop: 2,
    fontSize: 11,
    fontWeight: '600',
  },
  quickSaleHintLight: {
    color: '#efffef',
  },
  quickSaleChevron: {
    color: '#efffef',
  },
  quickSaleChevronLight: {
    color: '#ffffff',
  },
  kpiCardDark: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
    borderWidth: 1,
  },
  kpiBlue: {
    backgroundColor: '#13203a',
    borderColor: '#244a7a',
  },
  kpiBlueLight: {
    backgroundColor: '#f2f7ff',
    borderColor: '#d2e3fa',
  },
  kpiGreen: {
    backgroundColor: '#132b1d',
    borderColor: '#2f7045',
  },
  kpiGreenLight: {
    backgroundColor: '#effcf4',
    borderColor: '#bcebd0',
  },
  kpiPurple: {
    backgroundColor: '#1f1c3a',
    borderColor: '#4d4b95',
  },
  kpiPurpleLight: {
    backgroundColor: '#f2f2ff',
    borderColor: '#d5d5fb',
  },
  kpiTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  kpiLabelDark: {
    color: '#94a3b8',
    fontSize: 12,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  kpiLabelLight: {
    color: '#475569',
  },
  kpiIcon: {
    color: '#cbd5e1',
    fontSize: 14,
  },
  kpiAmountDark: {
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '800',
    marginTop: 8,
  },
  kpiBlueText: {
    color: '#38bdf8',
  },
  kpiGreenText: {
    color: '#4ade80',
  },
  kpiPurpleText: {
    color: '#d946ef',
  },
  kpiMetaDark: {
    marginTop: 6,
    color: '#cbd5e1',
    fontSize: 13,
  },
  kpiMetaLight: {
    color: '#334155',
  },
  sectionCardDark: {
    marginTop: 4,
    marginBottom: 10,
    borderRadius: 14,
    backgroundColor: '#101b30',
    borderWidth: 1,
    borderColor: '#223a5e',
    padding: 11,
  },
  sectionCardLight: {
    backgroundColor: '#ffffff',
    borderColor: '#d5e2f4',
  },
  sectionTitleDark: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
  },
  sectionTitleLight: {
    color: '#0f172a',
  },
  chartPlaceholder: {
    height: 170,
    borderRadius: 12,
    backgroundColor: '#1a2742',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  chartPlaceholderSmall: {
    height: 150,
    borderRadius: 12,
    backgroundColor: '#1a2742',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  chartPlaceholderLight: {
    backgroundColor: '#f1f5f9',
  },
  chartPlaceholderText: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 10,
  },
  chartPlaceholderTextLight: {
    color: '#64748b',
  },
  listLineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  chartBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    gap: 8,
  },
  chartTrack: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#334155',
    overflow: 'hidden',
  },
  chartTrackLight: {
    backgroundColor: '#dbe4ef',
  },
  chartFillBlue: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#38bdf8',
  },
  chartFillTeal: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#14b8a6',
  },
  chartFillOrange: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#fb923c',
  },
  listLineLabel: {
    color: '#cbd5e1',
    fontSize: 12,
    marginRight: 8,
  },
  listLineLabelLight: {
    color: '#475569',
  },
  listLineValue: {
    color: '#93c5fd',
    fontSize: 12,
    fontWeight: '700',
  },
  listLineValueLight: {
    color: '#1d4ed8',
  },
  panelDark: {
    marginTop: 4,
    borderRadius: 14,
    backgroundColor: '#0e182d',
    borderWidth: 1,
    borderColor: '#223a5e',
    padding: 12,
  },
  panelLight: {
    backgroundColor: '#ffffff',
    borderColor: '#d5e2f4',
  },
  panelTitleDark: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  panelTitleLight: {
    color: '#0f172a',
  },
  panelLineDark: {
    color: '#cbd5e1',
    fontSize: 13,
    marginBottom: 4,
  },
  panelLineLight: {
    color: '#334155',
  },
  panelLineMutedDark: {
    marginTop: 2,
    color: '#94a3b8',
    fontSize: 12,
  },
  panelLineMutedLight: {
    color: '#64748b',
  },
  homeCard: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  homeTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#0f172a',
  },
  homeSubtitle: {
    fontSize: 14,
    color: '#475569',
    marginTop: 4,
    marginBottom: 12,
  },
  homeScroll: {
    paddingBottom: 26,
  },
  statusRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusPillSuccess: {
    backgroundColor: '#dcfce7',
  },
  statusPillWarning: {
    backgroundColor: '#fef3c7',
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  statusPillSuccessText: {
    color: '#166534',
  },
  statusPillWarningText: {
    color: '#92400e',
  },
  statusPillNeutral: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#e2e8f0',
  },
  statusPillNeutralText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  kpiCard: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  kpiCardBlue: {
    backgroundColor: '#eff6ff',
    borderColor: '#eff6ff',
  },
  kpiCardGreen: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
  },
  kpiCardOrange: {
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
  },
  kpiCardPurple: {
    backgroundColor: '#f8fafc',
    borderColor: '#cbd5e1',
  },
  kpiLabel: {
    color: '#475569',
    fontSize: 11,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  kpiValue: {
    color: '#0f172a',
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 28,
  },
  panel: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  panelTitle: {
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  infoBlock: {
    marginTop: 8,
  },
  infoLabel: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  badge: {
    backgroundColor: '#e0e7ff',
    color: '#1e3a8a',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    overflow: 'hidden',
    fontWeight: '600',
  },
  infoValue: {
    color: '#0f172a',
    fontSize: 15,
  },
  offlineMetaInline: {
    marginTop: 8,
    color: '#64748b',
    fontSize: 12,
  },
  secondaryButtonDark: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#3a5e8d',
    borderRadius: 12,
    paddingVertical: 11,
    backgroundColor: '#13213a',
  },
  secondaryButtonTextDark: {
    textAlign: 'center',
    color: '#f8fafc',
    fontWeight: '700',
  },
  errorText: {
    marginTop: 8,
    color: '#f87171',
    fontSize: 13,
  },
  successText: {
    marginTop: 8,
    color: '#4ade80',
    fontSize: 13,
  },
});
