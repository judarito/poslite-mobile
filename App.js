import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
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
  getAuthCache,
  getPendingOpsCount,
  initOfflineDatabase,
  saveAuthCache,
} from './src/storage/sqlite/database';

export default function App() {
  const [session, setSession] = useState(null);
  const [loadingBoot, setLoadingBoot] = useState(true);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [offlineAvailable, setOfflineAvailable] = useState(false);
  const [cachedAt, setCachedAt] = useState('');
  const [pendingOpsCount, setPendingOpsCount] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [userProfile, setUserProfile] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      try {
        await initOfflineDatabase();

        const cached = await getAuthCache();
        const pendingCount = await getPendingOpsCount();
        if (mounted) {
          setPendingOpsCount(pendingCount);
        }
        if (cached && mounted) {
          setOfflineAvailable(true);
          setCachedAt(cached.cachedAt);
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
          setOfflineMode(true);
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
        setOfflineMode(false);
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

      await saveAuthCache({
        authUserId,
        userProfile: enriched,
        tenant: tenantData,
      });
      const pendingCount = await getPendingOpsCount();
      setPendingOpsCount(pendingCount);
      setOfflineAvailable(true);
      setCachedAt(new Date().toISOString());
    } catch (e) {
      setUserProfile(null);
      setTenant(null);
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

  const handleLogout = async () => {
    setError('');
    if (offlineMode) {
      setOfflineMode(false);
      setUserProfile(null);
      setTenant(null);
      return;
    }

    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError(signOutError.message);
      return;
    }

    setUserProfile(null);
    setTenant(null);
  };

  const handleUseOfflineMode = async () => {
    setError('');
    const cached = await getAuthCache();
    if (!cached) {
      setError('No hay cache local para modo offline.');
      return;
    }
    setUserProfile(cached.userProfile);
    setTenant(cached.tenant);
    setCachedAt(cached.cachedAt);
    setOfflineMode(true);
    const pendingCount = await getPendingOpsCount();
    setPendingOpsCount(pendingCount);
  };

  const handleClearOfflineCache = async () => {
    await clearAuthCache();
    setOfflineAvailable(false);
    setCachedAt('');
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

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.homeScroll}>
        <View style={styles.homeCard}>
          <Text style={styles.homeTitle}>Home</Text>
          <Text style={styles.homeText}>
            {offlineMode ? 'Modo offline activo (SQLite)' : 'Sesion activa en Supabase'}
          </Text>

          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Usuario</Text>
            <Text style={styles.badge}>{userProfile?.full_name || userEmail}</Text>
          </View>

          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Correo</Text>
            <Text style={styles.infoValue}>{userEmail}</Text>
          </View>

          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Tenant</Text>
            <Text style={styles.infoValue}>{tenant?.tenant_name || 'Sin tenant'}</Text>
          </View>

          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Moneda</Text>
            <Text style={styles.infoValue}>{tenant?.currency_code || '-'}</Text>
          </View>

          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Roles</Text>
            <Text style={styles.infoValue}>{rolesText}</Text>
          </View>

          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Permisos</Text>
            <Text style={styles.infoValue}>{userProfile?.permissionCodes?.length || 0}</Text>
          </View>

          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Pendientes Sync</Text>
            <Text style={styles.infoValue}>{pendingOpsCount}</Text>
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Pressable onPress={handleLogout} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>
              {offlineMode ? 'Salir de modo offline' : 'Cerrar sesion'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f1f5f9',
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
    fontSize: 24,
    fontWeight: '700',
    color: '#0f172a',
  },
  homeText: {
    fontSize: 15,
    color: '#334155',
    marginTop: 6,
    marginBottom: 10,
  },
  homeScroll: {
    paddingBottom: 24,
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
  errorText: {
    marginTop: 8,
    color: '#b91c1c',
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
