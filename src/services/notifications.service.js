import { supabase } from '../lib/supabase';

const TABLE = 'notifications';

export async function listMyNotifications({ limit = 50, offset = 0, onlyUnread = false } = {}) {
  try {
    const { data, error } = await supabase.rpc('fn_list_my_notifications', {
      p_limit: limit,
      p_offset: offset,
      p_only_unread: onlyUnread,
    });
    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function getUnreadNotificationsCount() {
  try {
    const { count, error } = await supabase
      .from(TABLE)
      .select('notification_id', { count: 'exact', head: true })
      .eq('is_read', false);

    if (error) throw error;
    return { success: true, data: count || 0 };
  } catch (error) {
    return { success: false, error: error.message, data: 0 };
  }
}

export async function markNotificationRead(notificationId) {
  if (!notificationId) return { success: false, error: 'notificationId es requerido' };
  try {
    const { data, error } = await supabase.rpc('fn_mark_notification_read', {
      p_notification_id: notificationId,
    });
    if (error) throw error;
    return { success: true, data: Boolean(data) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function markAllNotificationsRead() {
  try {
    const { data, error } = await supabase.rpc('fn_mark_all_notifications_read');
    if (error) throw error;
    return { success: true, data: Number(data || 0) };
  } catch (error) {
    return { success: false, error: error.message, data: 0 };
  }
}

export async function setMyNotificationPreference({ eventType, enabled = true, minSeverity = 'INFO', muteUntil = null }) {
  if (!eventType) return { success: false, error: 'eventType es requerido' };
  try {
    const { error } = await supabase.rpc('fn_set_my_notification_pref', {
      p_event_type: eventType,
      p_enabled: enabled,
      p_min_severity: minSeverity,
      p_mute_until: muteUntil,
    });
    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function emitInAppNotification({
  tenantId,
  eventType,
  severity = 'INFO',
  title,
  message,
  payload = {},
  dedupeKey = null,
  targetUserId = null,
  targetRole = null,
  locationId = null,
  cashRegisterId = null,
  actionUrl = null,
  entityType = null,
  entityId = null,
  dedupeWindowMinutes = 10,
}) {
  if (!tenantId) return { success: false, error: 'tenantId es requerido' };
  if (!eventType) return { success: false, error: 'eventType es requerido' };
  if (!title) return { success: false, error: 'title es requerido' };
  if (!message) return { success: false, error: 'message es requerido' };

  try {
    const { data, error } = await supabase.rpc('fn_emit_notification_event', {
      p_tenant: tenantId,
      p_event_type: eventType,
      p_severity: severity,
      p_title: title,
      p_message: message,
      p_payload: payload,
      p_dedupe_key: dedupeKey,
      p_target_user_id: targetUserId,
      p_target_role: targetRole,
      p_location_id: locationId,
      p_cash_register_id: cashRegisterId,
      p_action_url: actionUrl,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_dedupe_window_minutes: dedupeWindowMinutes,
    });

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export function subscribeMyNotifications({ tenantId, userId, onInsert, onUpdate }) {
  if (!tenantId || !userId) return null;

  const channel = supabase
    .channel(`notifications:${tenantId}:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: TABLE,
        filter: `tenant_id=eq.${tenantId}`,
      },
      (payload) => {
        if (payload?.new?.user_id === userId && typeof onInsert === 'function') {
          onInsert(payload.new);
        }
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: TABLE,
        filter: `tenant_id=eq.${tenantId}`,
      },
      (payload) => {
        if (payload?.new?.user_id === userId && typeof onUpdate === 'function') {
          onUpdate(payload.new, payload.old);
        }
      },
    )
    .subscribe();

  return channel;
}

export async function unsubscribeNotifications(channel) {
  if (!channel) return;
  await supabase.removeChannel(channel);
}
