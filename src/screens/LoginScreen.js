import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Image,
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
import { useThemeMode } from '../lib/themeMode';

export default function LoginScreen({
  email,
  password,
  error,
  loadingAuth,
  offlineAvailable,
  cachedAt,
  onEmailChange,
  onPasswordChange,
  onLogin,
  onUseOfflineMode,
  onClearOfflineCache,
}) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
  const cachedLabel = cachedAt ? new Date(cachedAt).toLocaleString() : 'Sin cache';

  return (
    <SafeAreaView style={isLightTheme ? styles.loginRootLight : styles.loginRootDark}>
      <View style={[styles.loginGlowTop, isLightTheme && styles.loginGlowTopLight]} />
      <View style={[styles.loginGlowBottom, isLightTheme && styles.loginGlowBottomLight]} />
      <KeyboardAvoidingView
        style={styles.loginWrapper}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.loginScroll} keyboardShouldPersistTaps="handled">
          <View style={[styles.loginCard, isLightTheme && styles.loginCardLight]}>
            <View style={styles.loginBrandRow}>
              <Image source={require('../../assets/logo-login.png')} style={styles.loginBrandLogo} resizeMode="contain" />
              <View style={styles.loginBrandTextWrap}>
                <Text style={[styles.loginTitle, isLightTheme && styles.loginTitleLight]}>
                  OfirOne
                </Text>
                <Text style={[styles.loginSubtitle, isLightTheme && styles.loginSubtitleLight]}>
                  Accede a tu punto de venta
                </Text>
              </View>
            </View>

            <Text style={[styles.loginSectionLabel, isLightTheme && styles.loginSectionLabelLight]}>
              Correo
            </Text>
            <TextInput
              value={email}
              onChangeText={onEmailChange}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="tu@empresa.com"
              placeholderTextColor="#64748b"
              style={[styles.loginInput, isLightTheme && styles.loginInputLight]}
            />

            <Text style={[styles.loginSectionLabel, isLightTheme && styles.loginSectionLabelLight]}>
              Contrasena
            </Text>
            <TextInput
              value={password}
              onChangeText={onPasswordChange}
              secureTextEntry
              placeholder="••••••••"
              placeholderTextColor="#64748b"
              style={[styles.loginInput, isLightTheme && styles.loginInputLight]}
              onSubmitEditing={onLogin}
            />

            {error ? <Text style={styles.loginErrorText}>{error}</Text> : null}

            <Pressable
              onPress={onLogin}
              disabled={loadingAuth}
              style={[styles.loginPrimaryButton, loadingAuth && styles.primaryButtonDisabled]}
            >
              <View style={styles.btnContentRow}>
                {loadingAuth ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Ionicons name="log-in-outline" size={16} color="#ffffff" />
                )}
                <Text style={styles.loginPrimaryButtonText}>
                  {loadingAuth ? 'Ingresando...' : 'Ingresar'}
                </Text>
              </View>
            </Pressable>

            {offlineAvailable ? (
              <View style={[styles.loginOfflineCard, isLightTheme && styles.loginOfflineCardLight]}>
                <Pressable onPress={onUseOfflineMode} style={styles.loginSecondaryButton}>
                  <Text style={styles.loginSecondaryButtonText}>Continuar sin conexion</Text>
                </Pressable>
                <Text style={[styles.loginOfflineMeta, isLightTheme && styles.loginOfflineMetaLight]}>
                  Ultimo cache: {cachedLabel}
                </Text>
                <Pressable onPress={onClearOfflineCache} style={styles.linkButton}>
                  <Text style={styles.linkButtonText}>Limpiar cache offline</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <StatusBar style={isLightTheme ? 'dark' : 'light'} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loginRootDark: {
    flex: 1,
    backgroundColor: '#020617',
  },
  loginRootLight: {
    flex: 1,
    backgroundColor: '#eff6ff',
  },
  loginGlowTop: {
    position: 'absolute',
    top: -90,
    right: -40,
    width: 260,
    height: 260,
    borderRadius: 999,
    backgroundColor: '#1d4ed8',
    opacity: 0.24,
  },
  loginGlowTopLight: {
    backgroundColor: '#60a5fa',
    opacity: 0.22,
  },
  loginGlowBottom: {
    position: 'absolute',
    bottom: -120,
    left: -70,
    width: 310,
    height: 310,
    borderRadius: 999,
    backgroundColor: '#0f766e',
    opacity: 0.22,
  },
  loginGlowBottomLight: {
    backgroundColor: '#2dd4bf',
    opacity: 0.18,
  },
  loginWrapper: {
    flex: 1,
  },
  loginScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  loginCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0b1220',
    padding: 16,
    shadowColor: '#020617',
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 7,
  },
  loginCardLight: {
    borderColor: '#dbeafe',
    backgroundColor: '#ffffff',
    shadowColor: '#1d4ed8',
    shadowOpacity: 0.13,
  },
  loginBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  loginBrandLogo: {
    width: 72,
    height: 72,
  },
  loginBrandTextWrap: {
    marginLeft: 10,
    flex: 1,
  },
  loginTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#f8fafc',
    letterSpacing: 0.2,
  },
  loginTitleLight: {
    color: '#0f172a',
  },
  loginSubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 2,
  },
  loginSubtitleLight: {
    color: '#475569',
  },
  loginSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: '#cbd5e1',
    marginBottom: 6,
  },
  loginSectionLabelLight: {
    color: '#334155',
  },
  loginInput: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
    color: '#f8fafc',
  },
  loginInputLight: {
    backgroundColor: '#ffffff',
    borderColor: '#cbd5e1',
    color: '#0f172a',
  },
  loginPrimaryButton: {
    backgroundColor: '#1d4ed8',
    paddingVertical: 13,
    borderRadius: 12,
    marginTop: 6,
  },
  btnContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  loginPrimaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    textAlign: 'center',
    fontSize: 15,
  },
  loginOfflineCard: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    backgroundColor: '#0f172a',
    padding: 10,
  },
  loginOfflineCardLight: {
    borderColor: '#dbeafe',
    backgroundColor: '#f8fafc',
  },
  loginSecondaryButton: {
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 10,
    paddingVertical: 11,
    backgroundColor: '#1f2937',
  },
  loginSecondaryButtonText: {
    textAlign: 'center',
    color: '#f8fafc',
    fontWeight: '700',
  },
  loginOfflineMeta: {
    marginTop: 8,
    color: '#94a3b8',
    fontSize: 12,
    textAlign: 'center',
  },
  loginOfflineMetaLight: {
    color: '#475569',
  },
  loginErrorText: {
    marginTop: 2,
    marginBottom: 4,
    color: '#f87171',
    fontSize: 13,
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  linkButton: {
    marginTop: 10,
    alignSelf: 'center',
    paddingVertical: 4,
  },
  linkButtonText: {
    color: '#93c5fd',
    textDecorationLine: 'underline',
    fontSize: 13,
  },
});
