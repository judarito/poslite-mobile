import { supabase } from '../lib/supabase';

const CHAT_ORDER_EDGE_FUNCTION =
  process.env.EXPO_PUBLIC_CHAT_ORDER_EDGE_FUNCTION || 'chat-order-parser';
const DEFAULT_TEXT_MODEL = process.env.EXPO_PUBLIC_DEEPSEEK_TEXT_MODEL || 'deepseek-chat';

async function extractInvokeError(error) {
  const fragments = [];
  if (error?.message) fragments.push(String(error.message));

  const context = error?.context;
  if (!context) return fragments.join(' | ') || 'Error desconocido';

  try {
    const response = typeof context.clone === 'function' ? context.clone() : context;
    if (response?.status) fragments.push(`HTTP ${response.status}`);

    let bodyJson = null;
    if (typeof response?.json === 'function') {
      bodyJson = await response.json().catch(() => null);
    }

    if (bodyJson?.error) fragments.push(String(bodyJson.error));
    if (bodyJson?.details) fragments.push(String(bodyJson.details));

    if (!bodyJson && typeof response?.text === 'function') {
      const bodyText = await response.text().catch(() => '');
      if (bodyText?.trim()) fragments.push(bodyText.trim().slice(0, 280));
    }
  } catch (_e) {
    // No-op: keep original invoke message.
  }

  const unique = Array.from(new Set(fragments.filter(Boolean)));
  return unique.join(' | ') || 'Error desconocido';
}

export async function analyzeChatOrderText({ tenantId, chatText }) {
  if (!tenantId) {
    return { success: false, error: 'tenantId es requerido.' };
  }

  const text = String(chatText || '').trim();
  if (!text) {
    return { success: false, error: 'Escribe o pega un chat para convertir.' };
  }

  const { data, error } = await supabase.functions.invoke(CHAT_ORDER_EDGE_FUNCTION, {
    body: {
      tenant_id: tenantId,
      model: DEFAULT_TEXT_MODEL,
      temperature: 0.1,
      max_tokens: 1800,
      chat_text: text.slice(0, 10000),
    },
  });

  if (error) {
    const details = await extractInvokeError(error);
    return {
      success: false,
      error: `Error invocando Edge Function "${CHAT_ORDER_EDGE_FUNCTION}": ${details}.`,
    };
  }

  const lineItems = Array.isArray(data?.line_items) ? data.line_items : [];
  if (!lineItems.length) {
    return { success: false, error: 'La IA no devolvio items para convertir a venta.' };
  }

  const normalized = lineItems
    .map((item) => ({
      raw_name: String(item?.raw_name || '').trim(),
      sku: item?.sku ? String(item.sku).trim() : null,
      quantity: Math.max(1, Number(item?.quantity || 1)),
      unit_hint: item?.unit_hint ? String(item.unit_hint).trim() : null,
      unit_price: item?.unit_price == null ? null : Number(item.unit_price || 0),
    }))
    .filter((item) => item.raw_name);

  if (!normalized.length) {
    return { success: false, error: 'No se pudieron normalizar items validos del chat.' };
  }

  return {
    success: true,
    data: {
      order: data?.order || {},
      line_items: normalized,
      model: data?.model || null,
      usage: data?.usage || null,
      raw: data?.raw || null,
      cache_hit: Boolean(data?.cache_hit),
    },
  };
}
