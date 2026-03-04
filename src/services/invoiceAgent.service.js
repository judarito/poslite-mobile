import { supabase } from '../lib/supabase';

const OCR_EDGE_FUNCTION = process.env.EXPO_PUBLIC_DEEPSEEK_OCR_EDGE_FUNCTION || 'deepseek-ocr-proxy';
const TEXT_EDGE_FUNCTION = process.env.EXPO_PUBLIC_DEEPSEEK_TEXT_EDGE_FUNCTION || 'deepseek-proxy';
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

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSku(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function tokenize(value) {
  return normalizeText(value).split(' ').filter((t) => t.length >= 2);
}

function parseAiJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (_e) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (_err) {
      return null;
    }
  }
}

function scoreByTokens(lineText, candidate) {
  const lineTokens = tokenize(lineText);
  if (lineTokens.length === 0) return 0;

  const candidateText = `${candidate?.product?.name || ''} ${candidate?.variant_name || ''} ${candidate?.sku || ''}`;
  const candidateTokens = tokenize(candidateText);
  if (candidateTokens.length === 0) return 0;

  const candidateSet = new Set(candidateTokens);
  const intersection = lineTokens.filter((token) => candidateSet.has(token)).length;
  const containmentBonus =
    normalizeText(candidateText).includes(normalizeText(lineText)) ||
    normalizeText(lineText).includes(normalizeText(candidateText))
      ? 0.15
      : 0;

  return Math.min(1, intersection / lineTokens.length + containmentBonus);
}

function findBestVariantMatch(line, catalog) {
  const lineSku = normalizeSku(line?.sku);
  const rawName = String(line?.raw_name || line?.name || '').trim();
  const normalizedName = normalizeText(rawName);

  if (lineSku) {
    const bySku = catalog.find((item) => normalizeSku(item?.sku) === lineSku);
    if (bySku) {
      return { variant: bySku, confidence: 1, matchReason: 'sku_exact' };
    }
  }

  if (normalizedName) {
    const exactName = catalog.find((item) => {
      const candidate = normalizeText(`${item?.product?.name || ''} ${item?.variant_name || ''}`);
      return candidate === normalizedName;
    });
    if (exactName) {
      return { variant: exactName, confidence: 0.94, matchReason: 'name_exact' };
    }
  }

  let best = null;
  for (const candidate of catalog) {
    const score = scoreByTokens(rawName, candidate);
    if (!best || score > best.score) {
      best = { candidate, score };
    }
  }

  if (best && best.score >= 0.42) {
    return {
      variant: best.candidate,
      confidence: Number(best.score.toFixed(3)),
      matchReason: 'name_tokens',
    };
  }

  return null;
}

export async function analyzeInvoiceWithText({ tenantId, ocrText }) {
  if (!tenantId) {
    return { success: false, error: 'tenantId es requerido.' };
  }
  const extractedText = String(ocrText || '').trim();
  if (!extractedText) {
    return { success: false, error: 'No hay texto OCR para analizar.' };
  }
  const clippedText = extractedText.slice(0, 12000);

  const systemPrompt =
    'Eres un agente estructurador de facturas para POS. A partir de texto OCR, extrae productos y cantidades con alta precision. Responde SOLO JSON valido.';

  const userPrompt = `Analiza este texto OCR de una factura y responde JSON con:
{
  "invoice": {
    "vendor_name": "string|null",
    "invoice_number": "string|null",
    "date": "YYYY-MM-DD|null",
    "currency": "string|null",
    "subtotal": number|null,
    "tax": number|null,
    "total": number|null
  },
  "line_items": [
    {
      "raw_name": "string",
      "sku": "string|null",
      "quantity": number,
      "unit_price": number|null,
      "line_total": number|null
    }
  ]
}

Reglas:
- quantity debe ser > 0 (si no existe, usa 1).
- Si no puedes inferir un campo, usa null.
- No agregues texto fuera del JSON.
- No inventes lineas o precios no presentes.

Texto OCR:
"""${clippedText}"""`;

  const { data, error } = await supabase.functions.invoke(TEXT_EDGE_FUNCTION, {
    body: {
      model: DEFAULT_TEXT_MODEL,
      temperature: 0.1,
      max_tokens: 2400,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    },
  });

  if (error) {
    const details = await extractInvokeError(error);
    return {
      success: false,
      error: `Error invocando Edge Function "${TEXT_EDGE_FUNCTION}": ${details}.`,
    };
  }

  const content = data?.content;
  const parsed = parseAiJson(content);
  if (!parsed || !Array.isArray(parsed.line_items)) {
    return { success: false, error: 'No se pudo parsear la respuesta de IA para la factura.' };
  }

  const normalized = parsed.line_items
    .map((item) => ({
      raw_name: String(item?.raw_name || '').trim(),
      sku: item?.sku ? String(item.sku).trim() : null,
      quantity: Math.max(1, Number(item?.quantity || 1)),
      unit_price: item?.unit_price == null ? null : Number(item.unit_price || 0),
      line_total: item?.line_total == null ? null : Number(item.line_total || 0),
    }))
    .filter((item) => item.raw_name);

  return {
    success: true,
    data: {
      invoice: parsed.invoice || {},
      line_items: normalized,
      raw: parsed,
    },
  };
}

export async function analyzeInvoiceWithImage({ tenantId, imageBase64, mimeType = 'image/jpeg' }) {
  if (!tenantId) {
    return { success: false, error: 'tenantId es requerido.' };
  }
  if (!imageBase64) {
    return { success: false, error: 'No hay imagen en base64 para analizar.' };
  }
  if (String(imageBase64).length > 5_500_000) {
    return {
      success: false,
      error: 'La foto es demasiado grande para IA/OCR. Toma la foto mas cerca o reduce resolucion.',
    };
  }

  const prompt = `Analiza el texto OCR de una factura y responde JSON con:
{
  "invoice": {
    "vendor_name": "string|null",
    "invoice_number": "string|null",
    "date": "YYYY-MM-DD|null",
    "currency": "string|null",
    "subtotal": number|null,
    "tax": number|null,
    "total": number|null
  },
  "line_items": [
    {
      "raw_name": "string",
      "sku": "string|null",
      "quantity": number,
      "unit_price": number|null,
      "line_total": number|null
    }
  ]
}

Reglas:
- quantity > 0 (si no existe, usa 1).
- Si no puedes inferir un campo, usa null.
- No agregues texto fuera del JSON.
- No inventes lineas o precios no presentes.`;

  const { data, error } = await supabase.functions.invoke(OCR_EDGE_FUNCTION, {
    body: {
      model: DEFAULT_TEXT_MODEL,
      temperature: 0.1,
      max_tokens: 2400,
      image: imageBase64,
      mime_type: mimeType,
      prompt,
    },
  });

  if (error) {
    const details = await extractInvokeError(error);
    const sizeHint = String(details || '').toLowerCase().includes('maximum size limit 1024 kb')
      ? ' OCR.Space (plan actual) solo acepta imagenes <= 1MB. La app intenta comprimir automaticamente; si persiste, toma la foto mas cerca y con menos fondo.'
      : '';
    return {
      success: false,
      error: `Error invocando Edge Function "${OCR_EDGE_FUNCTION}": ${details}.${sizeHint}`,
    };
  }

  const content = data?.content;
  const parsed = parseAiJson(content);
  if (!parsed || !Array.isArray(parsed.line_items)) {
    return { success: false, error: 'No se pudo parsear la respuesta OCR+IA para la factura.' };
  }

  const normalized = parsed.line_items
    .map((item) => ({
      raw_name: String(item?.raw_name || '').trim(),
      sku: item?.sku ? String(item.sku).trim() : null,
      quantity: Math.max(1, Number(item?.quantity || 1)),
      unit_price: item?.unit_price == null ? null : Number(item.unit_price || 0),
      line_total: item?.line_total == null ? null : Number(item.line_total || 0),
    }))
    .filter((item) => item.raw_name);

  return {
    success: true,
    data: {
      invoice: parsed.invoice || {},
      line_items: normalized,
      raw: parsed,
      ocr_text: data?.ocr_text || null,
    },
  };
}

export function matchInvoiceLinesToCatalog(lineItems, catalog) {
  const lines = Array.isArray(lineItems) ? lineItems : [];
  const list = Array.isArray(catalog) ? catalog : [];

  const matched = [];
  const unmatched = [];

  for (const line of lines) {
    const best = findBestVariantMatch(line, list);
    if (best?.variant) {
      matched.push({
        line,
        variant: best.variant,
        confidence: best.confidence,
        matchReason: best.matchReason,
      });
    } else {
      unmatched.push(line);
    }
  }

  return { matched, unmatched };
}
