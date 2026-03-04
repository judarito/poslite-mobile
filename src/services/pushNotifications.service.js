import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';

let Notifications = null;
let Device = null;
let Constants = null;

function ensureModules() {
  if (!Notifications) {
    try {
      Notifications = require('expo-notifications');
      Notifications = Notifications?.default || Notifications;
    } catch (_e) {
      Notifications = null;
    }
  }
  if (!Device) {
    try {
      Device = require('expo-device');
      Device = Device?.default || Device;
    } catch (_e) {
      Device = null;
    }
  }
  if (!Constants) {
    try {
      Constants = require('expo-constants');
      Constants = Constants?.default || Constants;
    } catch (_e) {
      Constants = null;
    }
  }
}

export function configurePushNotifications() {
  ensureModules();
  if (!Notifications?.setNotificationHandler) return;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

async function ensureAndroidChannel() {
  ensureModules();
  if (!Notifications || Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('default', {
    name: 'General',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#2563eb',
    sound: 'default',
  });
}

export async function registerPushTokenForCurrentUser({ tenantId, userId }) {
  if (!tenantId || !userId) {
    return { success: false, error: 'tenantId y userId son requeridos para push.' };
  }

  ensureModules();
  if (!Notifications || !Device) {
    return { success: false, error: 'Faltan modulos expo-notifications o expo-device.' };
  }

  if (!Device.isDevice) {
    return { success: false, error: 'Push requiere dispositivo fisico.' };
  }

  try {
    await ensureAndroidChannel();

    const perms = await Notifications.getPermissionsAsync();
    let finalStatus = perms?.status;
    if (finalStatus !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      finalStatus = requested?.status;
    }

    if (finalStatus !== 'granted') {
      return { success: false, error: 'Permiso de notificaciones denegado.' };
    }

    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ||
      Constants?.easConfig?.projectId ||
      undefined;
    const appVersion = String(Constants?.expoConfig?.version || '');
    const appOwnership = String(Constants?.appOwnership || Constants?.executionEnvironment || 'unknown');
    const deviceUid = String(Device?.osBuildId || Device?.modelId || '');

    const tokenResult = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );

    const expoPushToken = String(tokenResult?.data || '').trim();
    if (!expoPushToken) {
      return { success: false, error: 'No se obtuvo Expo push token.' };
    }

    const { data, error } = await supabase.rpc('fn_upsert_my_push_device', {
      p_expo_push_token: expoPushToken,
      p_platform: Platform.OS || 'unknown',
      p_device_name: Device?.deviceName || null,
      p_app_version: appVersion ? `${appVersion} (${appOwnership})` : appOwnership,
      p_device_uid: deviceUid,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    // Mantiene solo el token activo mas reciente por dispositivo para reducir duplicados.
    if (deviceUid) {
      await supabase
        .from('user_push_devices')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .eq('user_id', userId)
        .eq('platform', Platform.OS || 'unknown')
        .eq('device_uid', deviceUid)
        .neq('expo_push_token', expoPushToken)
        .eq('is_active', true);
    }

    return {
      success: true,
      data: {
        push_device_id: data,
        expo_push_token: expoPushToken,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error?.message || 'No fue posible registrar push token.',
    };
  }
}

export function subscribeToPushResponses(onResponse) {
  ensureModules();
  if (!Notifications?.addNotificationResponseReceivedListener) return null;

  return Notifications.addNotificationResponseReceivedListener((response) => {
    if (typeof onResponse === 'function') {
      onResponse(response);
    }
  });
}

export function subscribeToPushForeground(onNotification) {
  ensureModules();
  if (!Notifications?.addNotificationReceivedListener) return null;

  return Notifications.addNotificationReceivedListener((notification) => {
    if (typeof onNotification === 'function') {
      onNotification(notification);
    }
  });
}
