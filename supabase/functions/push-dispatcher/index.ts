import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

function getBackoffMinutes(attempt: number): number {
  if (attempt <= 1) return 1;
  if (attempt === 2) return 3;
  if (attempt === 3) return 10;
  if (attempt === 4) return 30;
  return 120;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const dispatcherSecret = Deno.env.get('PUSH_DISPATCHER_SECRET');
  if (!dispatcherSecret) {
    return jsonResponse({ error: 'Missing PUSH_DISPATCHER_SECRET' }, 500);
  }

  const auth = req.headers.get('Authorization') || '';
  if (auth !== `Bearer ${dispatcherSecret}`) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }

  const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN') || null;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch (_e) {
    body = {};
  }

  const limit = Math.min(Math.max(Number(body.limit || 50), 1), 200);

  const { data: rows, error: fetchError } = await supabase
    .from('notification_push_queue')
    .select(
      'push_queue_id, push_device_id, expo_push_token, title, message, payload, attempts, status, next_attempt_at, device:user_push_devices(is_active, app_version)',
    )
    .in('status', ['PENDING', 'RETRY'])
    .lte('next_attempt_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(limit);

  if (fetchError) {
    return jsonResponse({ error: 'Failed to fetch queue', details: fetchError.message }, 500);
  }

  const queue = Array.isArray(rows) ? rows : [];
  if (!queue.length) {
    return jsonResponse({ success: true, processed: 0, sent: 0, failed: 0, retried: 0, skipped: 0 });
  }

  let sent = 0;
  let failed = 0;
  let retried = 0;
  let skipped = 0;

  for (const row of queue) {
    const attempts = Number(row.attempts || 0);
    const nowIso = new Date().toISOString();
    const claimUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // Claim atomico para evitar duplicados cuando hay ejecuciones concurrentes del dispatcher.
    const { data: claimed, error: claimError } = await supabase
      .from('notification_push_queue')
      .update({ next_attempt_at: claimUntil })
      .eq('push_queue_id', row.push_queue_id)
      .eq('attempts', attempts)
      .in('status', ['PENDING', 'RETRY'])
      .lte('next_attempt_at', nowIso)
      .select('push_queue_id')
      .maybeSingle();

    if (claimError || !claimed) {
      skipped += 1;
      continue;
    }

    const device = (row?.device || {}) as { is_active?: boolean; app_version?: string };
    const appVersion = String(device?.app_version || '').toLowerCase();
    const isDeviceInactive = device.is_active === false;
    const isExpoGoDevice = appVersion.includes('(expo)');
    if (isDeviceInactive) {
      await supabase
        .from('notification_push_queue')
        .update({
          status: 'FAILED',
          attempts: attempts + 1,
          last_error: 'Push device inactive',
        })
        .eq('push_queue_id', row.push_queue_id);
      failed += 1;
      continue;
    }
    if (isExpoGoDevice) {
      if (row.push_device_id) {
        await supabase
          .from('user_push_devices')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('push_device_id', row.push_device_id);
      }
      await supabase
        .from('notification_push_queue')
        .update({
          status: 'FAILED',
          attempts: attempts + 1,
          last_error: 'Expo Go token disabled. Re-register from native build.',
        })
        .eq('push_queue_id', row.push_queue_id);
      failed += 1;
      continue;
    }

    const expoPayload = {
      to: row.expo_push_token,
      title: row.title,
      body: row.message,
      data: row.payload || {},
      sound: 'default',
      channelId: 'default',
    };

    let responseText = '';
    let responseJson: Record<string, unknown> | null = null;

    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(expoAccessToken ? { Authorization: `Bearer ${expoAccessToken}` } : {}),
        },
        body: JSON.stringify(expoPayload),
      });

      responseText = await response.text();
      try {
        responseJson = responseText ? (JSON.parse(responseText) as Record<string, unknown>) : null;
      } catch (_e) {
        responseJson = null;
      }

      const data = responseJson?.data as Record<string, unknown> | undefined;
      const status = String(data?.status || '');
      const details = data?.details as Record<string, unknown> | undefined;
      const errorCode = String(details?.error || '');
      const errorMessage = String(data?.message || responseText || '').slice(0, 500);

      if (response.ok && status === 'ok') {
        await supabase
          .from('notification_push_queue')
          .update({
            status: 'SENT',
            attempts: attempts + 1,
            sent_at: new Date().toISOString(),
            last_error: null,
          })
          .eq('push_queue_id', row.push_queue_id);
        sent += 1;
        continue;
      }

      if (errorCode === 'DeviceNotRegistered' && row.push_device_id) {
        await supabase
          .from('user_push_devices')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('push_device_id', row.push_device_id);
      }

      const nextAttempts = attempts + 1;
      if (nextAttempts >= 5 || errorCode === 'DeviceNotRegistered') {
        await supabase
          .from('notification_push_queue')
          .update({
            status: 'FAILED',
            attempts: nextAttempts,
            last_error: errorMessage || 'Push failed',
          })
          .eq('push_queue_id', row.push_queue_id);
        failed += 1;
      } else {
        const nextAt = new Date(Date.now() + getBackoffMinutes(nextAttempts) * 60 * 1000).toISOString();
        await supabase
          .from('notification_push_queue')
          .update({
            status: 'RETRY',
            attempts: nextAttempts,
            last_error: errorMessage || 'Push retry',
            next_attempt_at: nextAt,
          })
          .eq('push_queue_id', row.push_queue_id);
        retried += 1;
      }
    } catch (error) {
      const nextAttempts = attempts + 1;
      const errText = String((error as { message?: unknown })?.message || 'Push dispatch error').slice(0, 500);
      const nextAt = new Date(Date.now() + getBackoffMinutes(nextAttempts) * 60 * 1000).toISOString();

      await supabase
        .from('notification_push_queue')
        .update({
          status: nextAttempts >= 5 ? 'FAILED' : 'RETRY',
          attempts: nextAttempts,
          last_error: errText,
          next_attempt_at: nextAt,
        })
        .eq('push_queue_id', row.push_queue_id);

      if (nextAttempts >= 5) failed += 1;
      else retried += 1;
    }
  }

  return jsonResponse({
    success: true,
    processed: queue.length,
    sent,
    failed,
    retried,
    skipped,
  });
});
