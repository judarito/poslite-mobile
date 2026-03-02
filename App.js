import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StatusBar as RNStatusBar,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { supabase } from './src/lib/supabase';
import {
  clearAuthCache,
  clearMenuCache,
  getAuthCache,
  getMenuCache,
  getPendingOpsCount,
  initOfflineDatabase,
  saveMenuCache,
  saveAuthCache,
} from './src/storage/sqlite/database';
import { annotateMenuTreeWithSupport } from './src/navigation/menuMapper';
import { fetchUserMenus, isFreshCache } from './src/services/menu.service';
import { getDashboardSummary } from './src/services/reports.service';
import { syncPendingOperations } from './src/services/sync.service';
import { getTenantSettings, setCachedTenantTheme } from './src/services/tenantSettings.service';
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
import SalesHistoryScreen from './src/screens/SalesHistoryScreen';
import SetupPlaceholderScreen from './src/screens/SetupPlaceholderScreen';
import SetupScreen from './src/screens/SetupScreen';
import TaxesScreen from './src/screens/TaxesScreen';
import TenantConfigScreen from './src/screens/TenantConfigScreen';
import ThirdPartiesScreen from './src/screens/ThirdPartiesScreen';
import UnitsScreen from './src/screens/UnitsScreen';
import LocationsScreen from './src/screens/LocationsScreen';

export default function App() {
  const androidTopInset = Platform.OS === 'android' ? RNStatusBar.currentHeight || 0 : 0;

  const [session, setSession] = useState(null);
  const [loadingBoot, setLoadingBoot] = useState(true);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [offlineAvailable, setOfflineAvailable] = useState(false);
  const [cachedAt, setCachedAt] = useState('');
  const [pendingOpsCount, setPendingOpsCount] = useState(0);
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
  const [reportsInitialTab, setReportsInitialTab] = useState('sales');
  const [themeMode, setThemeMode] = useState('dark');
  const [error, setError] = useState('');

  useEffect(() => {
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
          setMenuTree(annotateMenuTreeWithSupport(cachedMenu.menuTree));
          setMenuCachedAt(cachedMenu.cachedAt);
        }

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

        if (cached) {
          setUserProfile(cached.userProfile);
          setTenant(cached.tenant);
          await loadTenantConfig(cached?.tenant?.tenant_id, { forceOffline: true });
          setOfflineMode(true);
          if (cachedMenu?.menuTree) {
            setMenuTree(annotateMenuTreeWithSupport(cachedMenu.menuTree));
            setMenuCachedAt(cachedMenu.cachedAt);
          }
        }
      } catch (e) {
        if (!mounted) return;
        setError(e?.message ?? 'Error inicializando modo offline.');
      } finally {
        if (mounted) setLoadingBoot(false);
      }
    };

    bootstrap();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setUserProfile(null);
        setTenant(null);
        setKpis(null);
        setDailySeries([]);
        setTopProducts([]);
        setPaymentMethodsSeries([]);
        setTenantSettings({});
        setCurrentScreen('Home');
        setReportsInitialTab('sales');
        setThemeMode('dark');
        setOfflineMode(false);
        setMenuTree([]);
        setMenuCachedAt('');
        setExpandedSections({});
        setMenuOpen(false);
      }
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const userEmail = useMemo(() => session?.user?.email ?? '', [session]);
  const rolesText = useMemo(() => {
    const names = (userProfile?.roles || []).map((r) => r.name).filter(Boolean);
    return names.length ? names.join(', ') : 'Sin roles';
  }, [userProfile]);
  const menuItemsCount = useMemo(() => {
    return (menuTree || []).reduce((acc, section) => acc + 1 + (section.children?.length || 0), 0);
  }, [menuTree]);
  const supportedMenuItemsCount = useMemo(() => {
    return (menuTree || []).reduce((acc, section) => {
      const selfSupported = section.supportedOnMobile ? 1 : 0;
      const childrenSupported = (section.children || []).filter((child) => child.supportedOnMobile).length;
      return acc + selfSupported + childrenSupported;
    }, 0);
  }, [menuTree]);
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
  const normalizeThemeMode = (value) => {
    const raw = String(value || '').toLowerCase();
    if (raw === 'light') return 'light';
    return 'dark';
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
      setMenuTree(annotated);
      setMenuCachedAt(cachedMenu.cachedAt);
      return annotated;
    }

    setLoadingMenu(true);
    try {
      const { tree } = await fetchUserMenus(authUserId);
      const annotated = annotateMenuTreeWithSupport(tree);
      setMenuTree(annotated);
      const now = new Date().toISOString();
      setMenuCachedAt(now);
      await saveMenuCache({ authUserId, menuTree: tree });
      return annotated;
    } catch (menuError) {
      if (cachedMenu?.authUserId === authUserId && Array.isArray(cachedMenu.menuTree)) {
        const annotated = annotateMenuTreeWithSupport(cachedMenu.menuTree);
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

  const refreshPendingOpsCount = async () => {
    const pendingCount = await getPendingOpsCount();
    setPendingOpsCount(pendingCount);
  };

  const loadTenantConfig = async (tenantId, { forceOffline = false } = {}) => {
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
      setThemeMode(normalizeThemeMode(nextSettings.theme));
      return;
    }

    setTenantSettings({});
  };

  const handleLocalThemeChange = async (nextTheme) => {
    const normalized = normalizeThemeMode(nextTheme);
    setThemeMode(normalized);
    setTenantSettings((prev) => ({ ...(prev || {}), theme: normalized }));
    if (tenant?.tenant_id) {
      await setCachedTenantTheme(tenant.tenant_id, normalized);
    }
  };

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
      setCurrentScreen('Home');
      setLastMenuAction('');
      setMenuOpen(false);
      return;
    }

    if (item.action === 'openManual') {
      setError('El manual de usuario esta disponible solo en la app web.');
      return;
    }

    if (
      [
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
      ].includes(item.targetScreen)
    ) {
      if (item.targetScreen === 'Reports') {
        const route = String(item.route || '').toLowerCase();
        if (route.includes('/reports/cajas')) setReportsInitialTab('cash');
        else if (route.includes('/reports/inventario')) setReportsInitialTab('inventory');
        else if (route.includes('/reports/financiero')) setReportsInitialTab('financial');
        else if (route.includes('/reports/produccion')) setReportsInitialTab('production');
        else setReportsInitialTab('sales');
      }
      setCurrentScreen(item.targetScreen);
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
        throw new Error('No se encontro perfil del usuario en POSLite.');
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
      setThemeMode('dark');

      await saveAuthCache({
        authUserId,
        userProfile: enriched,
        tenant: tenantData,
      });
      const pendingCount = await getPendingOpsCount();
      setPendingOpsCount(pendingCount);
      setOfflineAvailable(true);
      setCachedAt(new Date().toISOString());
      setExpandedSections({});
      setLastMenuAction('');
      try {
        await loadMenusForUser(authUserId, { preferFreshCache: true });
      } catch (menuError) {
        setMenuTree([]);
        setMenuCachedAt('');
        setError(
          menuError?.message ||
            'Sesion iniciada, pero no fue posible cargar el menu dinamico.',
        );
      }
      await loadTenantConfig(tenantData?.tenant_id, { forceOffline: false });
      await loadDashboard(tenantData?.tenant_id);
    } catch (e) {
      setUserProfile(null);
      setTenant(null);
      setKpis(null);
      setTenantSettings({});
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
      const syncResult = await syncPendingOperations({ limit: 20 });
      await refreshPendingOpsCount();
      if (syncResult?.processed > 0) {
        await loadDashboard(tenant.tenant_id);
      }
    };

    runSync();
    timer = setInterval(runSync, 20000);

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [offlineMode, session, userProfile?.user_id, tenant?.tenant_id]);

  const handleLogout = async () => {
    setError('');
    if (offlineMode) {
      setOfflineMode(false);
      setUserProfile(null);
      setTenant(null);
      setKpis(null);
      setDailySeries([]);
      setTopProducts([]);
      setPaymentMethodsSeries([]);
      setTenantSettings({});
      setCurrentScreen('Home');
      setReportsInitialTab('sales');
      setThemeMode('dark');
      setMenuTree([]);
      setMenuCachedAt('');
      setExpandedSections({});
      setMenuOpen(false);
      setLastMenuAction('');
      return;
    }

    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError(signOutError.message);
      return;
    }

    setUserProfile(null);
    setTenant(null);
    setKpis(null);
    setDailySeries([]);
    setTopProducts([]);
    setPaymentMethodsSeries([]);
    setCurrentScreen('Home');
    setReportsInitialTab('sales');
    setThemeMode('dark');
    setMenuTree([]);
    setMenuCachedAt('');
    setExpandedSections({});
    setMenuOpen(false);
    setLastMenuAction('');
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
    await loadTenantConfig(cached?.tenant?.tenant_id, { forceOffline: true });
    setKpis(null);
    setDailySeries([]);
    setTopProducts([]);
    setPaymentMethodsSeries([]);
    setCurrentScreen('Home');
    setCachedAt(cached.cachedAt);
    if (cachedMenu?.menuTree) {
      setMenuTree(annotateMenuTreeWithSupport(cachedMenu.menuTree));
      setMenuCachedAt(cachedMenu.cachedAt);
    } else {
      setMenuTree([]);
      setMenuCachedAt('');
    }
    setExpandedSections({});
    setLastMenuAction('');
    setOfflineMode(true);
    const pendingCount = await getPendingOpsCount();
    setPendingOpsCount(pendingCount);
  };

  const handleClearOfflineCache = async () => {
    await clearAuthCache();
    await clearMenuCache();
    setOfflineAvailable(false);
    setCachedAt('');
    setTenantSettings({});
    setMenuTree([]);
    setMenuCachedAt('');
    setCurrentScreen('Home');
    setReportsInitialTab('sales');
    setThemeMode('dark');
    setExpandedSections({});
    setMenuOpen(false);
    setLastMenuAction('');
  };

  if (loadingBoot || loadingProfile) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loadingText}>Inicializando app offline-first...</Text>
        <StatusBar style="auto" />
      </SafeAreaView>
    );
  }

  if (!session && !offlineMode) {
    return (
      <SafeAreaView style={styles.root}>
        <KeyboardAvoidingView
          style={styles.loginWrapper}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Text style={styles.title}>POSLite Mobile</Text>
          <Text style={styles.subtitle}>Inicia sesion para continuar</Text>

          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="Correo"
            placeholderTextColor="#64748b"
            style={styles.input}
          />

          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Contrasena"
            placeholderTextColor="#64748b"
            style={styles.input}
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Pressable
            onPress={handleLogin}
            disabled={loadingAuth}
            style={[styles.primaryButton, loadingAuth && styles.primaryButtonDisabled]}
          >
            <Text style={styles.primaryButtonText}>
              {loadingAuth ? 'Ingresando...' : 'Ingresar'}
            </Text>
          </Pressable>

          {offlineAvailable ? (
            <>
              <Pressable onPress={handleUseOfflineMode} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Continuar sin conexion</Text>
              </Pressable>
              <Text style={styles.offlineMeta}>
                Ultimo cache: {new Date(cachedAt).toLocaleString()}
              </Text>
            </>
          ) : null}

          {offlineAvailable ? (
            <Pressable onPress={handleClearOfflineCache} style={styles.linkButton}>
              <Text style={styles.linkButtonText}>Limpiar cache offline</Text>
            </Pressable>
          ) : null}
        </KeyboardAvoidingView>
        <StatusBar style="auto" />
      </SafeAreaView>
    );
  }

  const appBarTitleByScreen = {
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
  const isLightTheme = themeMode === 'light';

  return (
    <SafeAreaView style={isLightTheme ? styles.root : styles.rootDark}>
      <View
        style={[
          styles.appBar,
          isLightTheme ? styles.appBarLight : null,
          {
            paddingTop: androidTopInset,
            height: 56 + androidTopInset,
          },
        ]}
      >
        <Pressable onPress={() => setMenuOpen(true)} style={styles.menuTrigger}>
          <Text style={styles.menuTriggerText}>☰</Text>
        </Pressable>
        <Text style={[styles.appBarTitle, isLightTheme ? styles.appBarTitleLight : null]}>
          {appBarTitleByScreen[currentScreen] || 'POSLite Mobile'}
        </Text>
        <View style={styles.appBarRight}>
          <View style={[styles.connectionChip, offlineMode ? styles.connectionChipOffline : styles.connectionChipOnline]}>
            <Text style={[styles.connectionDot, offlineMode ? styles.connectionDotOffline : styles.connectionDotOnline]}>
              ●
            </Text>
            <Text style={styles.connectionChipText}>
              {offlineMode ? `Offline · ${pendingOpsCount}` : 'Online'}
            </Text>
          </View>
          {currentScreen !== 'Home' ? (
            <Pressable onPress={() => setCurrentScreen('Home')} style={[styles.appBarBackBtn, isLightTheme ? styles.appBarBackBtnLight : null]}>
              <Text style={[styles.appBarBackText, isLightTheme ? styles.appBarBackTextLight : null]}>Inicio</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <Modal visible={menuOpen} transparent animationType="slide" onRequestClose={() => setMenuOpen(false)}>
        <View style={styles.menuOverlay}>
          <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)} />
          <View style={styles.menuDrawer}>
            <View style={styles.menuHeader}>
              <Text style={styles.menuHeaderTitle}>Menu</Text>
              <Pressable onPress={() => setMenuOpen(false)} style={styles.menuCloseBtn}>
                <Text style={styles.menuCloseText}>Cerrar</Text>
              </Pressable>
            </View>
            <Text style={styles.menuUser}>{userProfile?.full_name || userEmail || 'Usuario'}</Text>
            <Text style={styles.menuTenant}>{tenant?.tenant_name || 'Sin tenant'}</Text>

            <ScrollView contentContainerStyle={styles.menuContent}>
              {(menuTree || []).length === 0 ? (
                <Text style={styles.menuEmptyText}>No hay menu disponible para este usuario.</Text>
              ) : null}
              {(menuTree || []).map((section) => {
                const code = section.code || section.title;
                const hasChildren = Boolean(section.children?.length);
                const isExpanded = Boolean(expandedSections[code]);

                return (
                  <View key={code} style={styles.menuSection}>
                    <Pressable
                      style={styles.menuSectionBtn}
                      onPress={() => {
                        if (hasChildren) {
                          toggleSection(code);
                          return;
                        }
                        handleMenuAction(section);
                      }}
                    >
                      <Text style={styles.menuSectionText}>{section.label || section.title}</Text>
                      {hasChildren ? (
                        <Text style={styles.menuChevron}>{isExpanded ? '−' : '+'}</Text>
                      ) : null}
                    </Pressable>

                    {hasChildren && isExpanded ? (
                      <View style={styles.menuChildren}>
                        {section.children.map((child) => (
                          <Pressable
                            key={child.code || child.title}
                            onPress={() => handleMenuAction(child)}
                            style={[
                              styles.menuChildBtn,
                              !child.supportedOnMobile && !child.action && styles.menuChildBtnDisabled,
                            ]}
                          >
                            <Text
                              style={[
                                styles.menuChildText,
                                !child.supportedOnMobile && !child.action && styles.menuChildTextDisabled,
                              ]}
                            >
                              {child.label || child.title}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {currentScreen === 'PointOfSale' ? (
        <PointOfSaleScreen
          tenant={tenant}
          userProfile={userProfile}
          tenantSettings={tenantSettings}
          offlineMode={offlineMode}
          onPendingOpsChange={setPendingOpsCount}
          onSaleCompleted={() => loadDashboard(tenant?.tenant_id)}
        />
      ) : currentScreen === 'Sales' ? (
        <SalesHistoryScreen
          tenant={tenant}
          userProfile={userProfile}
          formatMoney={formatMoney}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'Layaway' ? (
        <LayawayScreen
          tenant={tenant}
          userProfile={userProfile}
          formatMoney={formatMoney}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'ThirdParties' ? (
        <ThirdPartiesScreen
          tenant={tenant}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'Cartera' ? (
        <CarteraScreen
          tenant={tenant}
          userProfile={userProfile}
          formatMoney={formatMoney}
          offlineMode={offlineMode}
        />
      ) : currentScreen === 'Products' ? (
        <ProductsScreen
          tenant={tenant}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'Categories' ? (
        <CategoriesScreen
          tenant={tenant}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'Units' ? (
        <UnitsScreen
          tenant={tenant}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'BulkImports' ? (
        <BulkImportsScreen tenant={tenant} offlineMode={offlineMode} />
      ) : currentScreen === 'Inventory' ? (
        <InventoryScreen
          tenant={tenant}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
          formatMoney={formatMoney}
        />
      ) : currentScreen === 'Batches' ? (
        <BatchesScreen
          tenant={tenant}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'Purchases' ? (
        <PurchasesScreen
          tenant={tenant}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
          formatMoney={formatMoney}
        />
      ) : currentScreen === 'ProductionOrders' ? (
        <ProductionOrdersScreen
          tenant={tenant}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'BOMs' ? (
        <BOMsScreen
          tenant={tenant}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'CashSessions' ? (
        <CashSessionsScreen
          tenant={tenant}
          userProfile={userProfile}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
          formatMoney={formatMoney}
        />
      ) : currentScreen === 'CashRegisters' ? (
        <CashRegistersScreen
          tenant={tenant}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'CashAssignments' ? (
        <CashAssignmentsScreen
          tenant={tenant}
          userProfile={userProfile}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'PaymentMethods' ? (
        <PaymentMethodsScreen
          tenant={tenant}
          offlineMode={offlineMode}
          pageSize={defaultPageSize}
        />
      ) : currentScreen === 'Reports' ? (
        <ReportsScreen
          tenant={tenant}
          offlineMode={offlineMode}
          formatMoney={formatMoney}
          initialTab={reportsInitialTab}
        />
      ) : currentScreen === 'Setup' ? (
        <SetupScreen onOpenScreen={setCurrentScreen} />
      ) : currentScreen === 'TenantConfig' ? (
        <TenantConfigScreen
          tenant={tenant}
          offlineMode={offlineMode}
          themeMode={themeMode}
          onLocalThemeChange={handleLocalThemeChange}
        />
      ) : currentScreen === 'Locations' ? (
        <LocationsScreen tenant={tenant} offlineMode={offlineMode} pageSize={defaultPageSize} />
      ) : currentScreen === 'Taxes' ? (
        <TaxesScreen tenant={tenant} offlineMode={offlineMode} pageSize={defaultPageSize} />
      ) : currentScreen === 'TaxRules' ? (
        <SetupPlaceholderScreen
          title="Reglas de Impuesto"
          message="Pendiente de portar en mobile: reglas por categoria/producto/variante como en la web."
        />
      ) : currentScreen === 'PricingRules' ? (
        <SetupPlaceholderScreen
          title="Reglas de Precio"
          message="Pendiente de portar en mobile: reglas por sede, prioridad y vigencia."
        />
      ) : currentScreen === 'Users' ? (
        <SetupPlaceholderScreen
          title="Usuarios"
          message="Pendiente de portar en mobile: gestion de usuarios y asignacion de roles."
        />
      ) : currentScreen === 'RolesMenus' ? (
        <SetupPlaceholderScreen
          title="Roles y Menus"
          message="Este modulo es administrado por superadmin en la web. En mobile queda de solo consulta futura."
        />
      ) : currentScreen === 'About' ? (
        <AboutScreen tenant={tenant} userProfile={userProfile} offlineMode={offlineMode} />
      ) : (
        <ScrollView contentContainerStyle={styles.homeScrollDark}>
          <View style={styles.homeWrap}>
          <Text style={styles.homeTitleDark}>Inicio</Text>
          <Text style={styles.homeSubtitleDark}>
            {tenant?.tenant_name || 'Sin tenant'} · {tenant?.currency_code || '-'}
          </Text>

          <View style={styles.statusRowDark}>
            <Text style={styles.statusTextDark}>
              {offlineMode ? 'Offline activo' : 'Online'} · {loadingMenu ? 'Menu cargando' : 'Menu listo'}
            </Text>
          </View>

          <View style={[styles.kpiCardDark, styles.kpiBlue]}>
            <View style={styles.kpiTopRow}>
              <Text style={styles.kpiLabelDark}>Ventas Hoy</Text>
              <Text style={styles.kpiIcon}>◔</Text>
            </View>
            <Text style={[styles.kpiAmountDark, styles.kpiBlueText]}>
              {loadingKpis ? '...' : formatMoney(kpis?.today?.total || 0)}
            </Text>
            <Text style={styles.kpiMetaDark}>
              {loadingKpis ? 'Cargando...' : `${kpis?.today?.count || 0} transacciones`}
            </Text>
          </View>

          <View style={[styles.kpiCardDark, styles.kpiGreen]}>
            <View style={styles.kpiTopRow}>
              <Text style={styles.kpiLabelDark}>Este Mes</Text>
              <Text style={styles.kpiIcon}>◔</Text>
            </View>
            <Text style={[styles.kpiAmountDark, styles.kpiGreenText]}>
              {loadingKpis ? '...' : formatMoney(kpis?.month?.total || 0)}
            </Text>
            <Text style={styles.kpiMetaDark}>
              {loadingKpis
                ? 'Cargando...'
                : `${kpis?.month?.count || 0} transacciones${
                    kpis?.month?.vs_prev ? ` · ${kpis.month.vs_prev}% vs mes ant.` : ''
                  }`}
            </Text>
          </View>

          <View style={[styles.kpiCardDark, styles.kpiPurple]}>
            <View style={styles.kpiTopRow}>
              <Text style={styles.kpiLabelDark}>Este Ano</Text>
              <Text style={styles.kpiIcon}>◔</Text>
            </View>
            <Text style={[styles.kpiAmountDark, styles.kpiPurpleText]}>
              {loadingKpis ? '...' : formatMoney(kpis?.year?.total || 0)}
            </Text>
            <Text style={styles.kpiMetaDark}>
              {loadingKpis
                ? 'Cargando...'
                : `${kpis?.year?.count || 0} transacciones totales`}
            </Text>
          </View>

          <View style={styles.sectionCardDark}>
            <Text style={styles.sectionTitleDark}>Ventas diarias - ultimos 30 dias</Text>
            <View style={styles.chartPlaceholder}>
              {loadingKpis ? (
                <Text style={styles.chartPlaceholderText}>Cargando...</Text>
              ) : dailySeries.length === 0 ? (
                <Text style={styles.chartPlaceholderText}>Sin datos</Text>
              ) : (
                dailySeries.slice(-7).map((d) => {
                  const maxDaily = Math.max(...dailySeries.slice(-7).map((x) => Number(x.total || 0)), 1);
                  const widthPct = Math.max(4, Math.round((Number(d.total || 0) / maxDaily) * 100));
                  return (
                    <View key={d.date} style={styles.chartBarRow}>
                      <Text style={styles.listLineLabel}>{d.date.slice(5)}</Text>
                      <View style={styles.chartTrack}>
                        <View style={[styles.chartFillBlue, { width: `${widthPct}%` }]} />
                      </View>
                      <Text style={styles.listLineValue}>{formatMoney(d.total || 0)}</Text>
                    </View>
                  );
                })
              )}
            </View>
          </View>

          <View style={styles.sectionCardDark}>
            <Text style={styles.sectionTitleDark}>Metodos de pago (mes)</Text>
            <View style={styles.chartPlaceholderSmall}>
              {loadingKpis ? (
                <Text style={styles.chartPlaceholderText}>Cargando...</Text>
              ) : paymentMethodsSeries.length === 0 ? (
                <Text style={styles.chartPlaceholderText}>Sin datos</Text>
              ) : (
                paymentMethodsSeries.slice(0, 5).map((p) => {
                  const maxPay = Math.max(
                    ...paymentMethodsSeries.slice(0, 5).map((x) => Number(x.total || 0)),
                    1,
                  );
                  const widthPct = Math.max(6, Math.round((Number(p.total || 0) / maxPay) * 100));
                  return (
                    <View key={p.method} style={styles.chartBarRow}>
                      <Text numberOfLines={1} style={[styles.listLineLabel, { width: 90 }]}>
                        {p.method}
                      </Text>
                      <View style={styles.chartTrack}>
                        <View style={[styles.chartFillTeal, { width: `${widthPct}%` }]} />
                      </View>
                      <Text style={styles.listLineValue}>{formatMoney(p.total || 0)}</Text>
                    </View>
                  );
                })
              )}
            </View>
          </View>

          <View style={styles.sectionCardDark}>
            <Text style={styles.sectionTitleDark}>Top productos del mes</Text>
            <View style={styles.chartPlaceholderSmall}>
              {loadingKpis ? (
                <Text style={styles.chartPlaceholderText}>Cargando...</Text>
              ) : topProducts.length === 0 ? (
                <Text style={styles.chartPlaceholderText}>Sin datos</Text>
              ) : (
                topProducts.slice(0, 5).map((p, idx) => {
                  const maxRevenue = Math.max(
                    ...topProducts.slice(0, 5).map((x) => Number(x.revenue || 0)),
                    1,
                  );
                  const widthPct = Math.max(6, Math.round((Number(p.revenue || 0) / maxRevenue) * 100));
                  return (
                    <View key={`${p.name}-${idx}`} style={styles.chartBarRow}>
                      <Text numberOfLines={1} style={[styles.listLineLabel, { width: 110 }]}>
                        {p.name}
                      </Text>
                      <View style={styles.chartTrack}>
                        <View style={[styles.chartFillOrange, { width: `${widthPct}%` }]} />
                      </View>
                      <Text style={styles.listLineValue}>{formatMoney(p.revenue || 0)}</Text>
                    </View>
                  );
                })
              )}
            </View>
          </View>

          <View style={styles.panelDark}>
            <Text style={styles.panelTitleDark}>Contexto</Text>
            <Text style={styles.panelLineDark}>Usuario: {userProfile?.full_name || userEmail || 'Usuario'}</Text>
            <Text style={styles.panelLineDark}>Roles: {rolesText}</Text>
            <Text style={styles.panelLineDark}>Page size listados: {defaultPageSize}</Text>
            <Text style={styles.panelLineDark}>Pendientes sync: {pendingOpsCount}</Text>
            <Text style={styles.panelLineDark}>
              Menu mobile: {supportedMenuItemsCount}/{menuItemsCount}
            </Text>
            <Text style={styles.panelLineMutedDark}>
              {menuCachedAt
                ? `Cache menu: ${new Date(menuCachedAt).toLocaleString()}`
                : 'Sin cache de menu local'}
            </Text>
          </View>

          {lastMenuAction ? <Text style={styles.successText}>{lastMenuAction}</Text> : null}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Pressable onPress={handleLogout} style={styles.secondaryButtonDark}>
            <Text style={styles.secondaryButtonTextDark}>
              {offlineMode ? 'Salir de modo offline' : 'Cerrar sesion'}
            </Text>
          </Pressable>
          </View>
        </ScrollView>
      )}
      <StatusBar
        style={isLightTheme ? 'dark' : 'light'}
        backgroundColor={isLightTheme ? '#f8fafc' : '#111827'}
        translucent={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f1f5f9',
  },
  rootDark: {
    flex: 1,
    backgroundColor: '#0b0f14',
  },
  appBar: {
    height: 56,
    backgroundColor: '#111827',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  appBarLight: {
    backgroundColor: '#f8fafc',
    borderBottomColor: '#e2e8f0',
  },
  appBarTitle: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 17,
    marginLeft: 10,
    flex: 1,
  },
  appBarTitleLight: {
    color: '#0f172a',
  },
  appBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  appBarBackBtn: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  appBarBackBtnLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  appBarBackText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700',
  },
  appBarBackTextLight: {
    color: '#334155',
  },
  connectionChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  connectionChipOnline: {
    borderColor: '#14532d',
    backgroundColor: '#052e16',
  },
  connectionChipOffline: {
    borderColor: '#7f1d1d',
    backgroundColor: '#450a0a',
  },
  connectionChipText: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '700',
  },
  connectionDot: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
  connectionDotOnline: { color: '#22c55e' },
  connectionDotOffline: { color: '#ef4444' },
  menuTrigger: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#1e40af',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuTriggerText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
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
    backgroundColor: '#ffffff',
    paddingBottom: 14,
  },
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  menuHeaderTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
  },
  menuCloseBtn: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  menuCloseText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '600',
  },
  menuUser: {
    paddingHorizontal: 14,
    paddingTop: 10,
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '700',
  },
  menuTenant: {
    paddingHorizontal: 14,
    color: '#64748b',
    fontSize: 12,
    marginBottom: 8,
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
  menuSection: {
    marginBottom: 6,
  },
  menuSectionBtn: {
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
  },
  menuSectionText: {
    color: '#0f172a',
    fontWeight: '700',
    fontSize: 14,
  },
  menuChevron: {
    color: '#334155',
    fontSize: 18,
    fontWeight: '700',
  },
  menuChildren: {
    marginTop: 4,
    marginLeft: 10,
  },
  menuChildBtn: {
    minHeight: 38,
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: '#f1f5f9',
    marginBottom: 4,
  },
  menuChildBtnDisabled: {
    opacity: 0.55,
  },
  menuChildText: {
    color: '#1e293b',
    fontSize: 13,
    fontWeight: '500',
  },
  menuChildTextDisabled: {
    color: '#64748b',
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
  loginWrapper: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: '#334155',
    marginBottom: 18,
  },
  input: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
    color: '#0f172a',
  },
  primaryButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 13,
    borderRadius: 10,
    marginTop: 6,
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    textAlign: 'center',
    fontSize: 15,
  },
  homeWrap: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 26,
  },
  homeTitleDark: {
    fontSize: 24,
    fontWeight: '700',
    color: '#f8fafc',
  },
  homeSubtitleDark: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 4,
    marginBottom: 10,
  },
  homeScrollDark: {
    paddingBottom: 24,
  },
  statusRowDark: {
    marginBottom: 10,
  },
  statusTextDark: {
    color: '#cbd5e1',
    fontSize: 12,
  },
  kpiCardDark: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
    borderWidth: 1,
  },
  kpiBlue: {
    backgroundColor: '#0f2434',
    borderColor: '#1d4f7a',
  },
  kpiGreen: {
    backgroundColor: '#0f2a1b',
    borderColor: '#245d3b',
  },
  kpiPurple: {
    backgroundColor: '#261133',
    borderColor: '#54316e',
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
  sectionCardDark: {
    marginTop: 4,
    marginBottom: 10,
    borderRadius: 12,
    backgroundColor: '#171b23',
    borderWidth: 1,
    borderColor: '#2a3240',
    padding: 10,
  },
  sectionTitleDark: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
  },
  chartPlaceholder: {
    height: 170,
    borderRadius: 10,
    backgroundColor: '#252d39',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  chartPlaceholderSmall: {
    height: 150,
    borderRadius: 10,
    backgroundColor: '#252d39',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  chartPlaceholderText: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 10,
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
  listLineValue: {
    color: '#93c5fd',
    fontSize: 12,
    fontWeight: '700',
  },
  panelDark: {
    marginTop: 4,
    borderRadius: 12,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#263243',
    padding: 12,
  },
  panelTitleDark: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  panelLineDark: {
    color: '#cbd5e1',
    fontSize: 13,
    marginBottom: 4,
  },
  panelLineMutedDark: {
    marginTop: 2,
    color: '#94a3b8',
    fontSize: 12,
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
    borderColor: '#bfdbfe',
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
  secondaryButton: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingVertical: 11,
  },
  secondaryButtonText: {
    textAlign: 'center',
    color: '#0f172a',
    fontWeight: '600',
  },
  secondaryButtonDark: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 10,
    paddingVertical: 11,
    backgroundColor: '#1f2937',
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
  offlineMeta: {
    marginTop: 8,
    color: '#475569',
    fontSize: 12,
    textAlign: 'center',
  },
  linkButton: {
    marginTop: 10,
    alignSelf: 'center',
    paddingVertical: 4,
  },
  linkButtonText: {
    color: '#475569',
    textDecorationLine: 'underline',
    fontSize: 13,
  },
});
