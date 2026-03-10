import { normalizeCommandText } from './normalize.service';

const TAB_RULES = [
  { tab: 'sales', keywords: ['ventas', 'venta', 'historial ventas'] },
  { tab: 'cash', keywords: ['caja', 'cajas', 'sesiones', 'cajero', 'arqueo'] },
  { tab: 'inventory', keywords: ['inventario', 'stock', 'existencias', 'kardex'] },
  { tab: 'financial', keywords: ['financiero', 'finanzas', 'margen', 'rentabilidad', 'utilidad', 'gastos'] },
  { tab: 'production', keywords: ['produccion', 'manufactura', 'bom', 'ordenes produccion'] },
];

const DATE_RANGE_REGEX =
  /(?:del|desde)\s+([0-9]{1,4}[\/-][0-9]{1,2}[\/-][0-9]{1,4})\s+(?:al|hasta)\s+([0-9]{1,4}[\/-][0-9]{1,2}[\/-][0-9]{1,4})/i;

function formatIso(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function parseDateToken(token) {
  const text = String(token || '').trim();
  if (!text) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parsed = new Date(`${text}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
  if (year < 100) year += 2000;

  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  return parsed;
}

function getStartOfWeek(now) {
  const date = new Date(now);
  const day = (date.getDay() + 6) % 7;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - day);
  return date;
}

function getEndOfMonth(year, month) {
  return new Date(year, month + 1, 0);
}

function detectTab(normalizedText) {
  let best = null;
  TAB_RULES.forEach((rule) => {
    const score = rule.keywords.reduce((acc, key) => (normalizedText.includes(key) ? acc + 1 : acc), 0);
    if (!score) return;
    if (!best || score > best.score) {
      best = { tab: rule.tab, score };
    }
  });
  return best?.tab || null;
}

function detectPresetRange(normalizedText, now) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  if (normalizedText.includes('ayer')) {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    return { from_date: formatIso(y), to_date: formatIso(y) };
  }

  if (normalizedText.includes('hoy')) {
    return { from_date: formatIso(today), to_date: formatIso(today) };
  }

  if (normalizedText.includes('mes pasado')) {
    const year = today.getFullYear();
    const month = today.getMonth();
    const from = new Date(year, month - 1, 1);
    const to = getEndOfMonth(year, month - 1);
    return { from_date: formatIso(from), to_date: formatIso(to) };
  }

  if (normalizedText.includes('este mes')) {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from_date: formatIso(from), to_date: formatIso(today) };
  }

  if (normalizedText.includes('esta semana')) {
    const from = getStartOfWeek(today);
    return { from_date: formatIso(from), to_date: formatIso(today) };
  }

  if (/\b7\s*dias\b|\b7\s*dias\b|ultimos\s+7\s*dias|ultimas\s+7\s*dias/i.test(normalizedText)) {
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    return { from_date: formatIso(from), to_date: formatIso(today) };
  }

  if (/\b30\s*dias\b|ultimos\s+30\s*dias|ultimas\s+30\s*dias/i.test(normalizedText)) {
    const from = new Date(today);
    from.setDate(from.getDate() - 29);
    return { from_date: formatIso(from), to_date: formatIso(today) };
  }

  return null;
}

function detectExplicitRange(rawText) {
  const match = String(rawText || '').match(DATE_RANGE_REGEX);
  if (!match?.[1] || !match?.[2]) return null;

  const first = parseDateToken(match[1]);
  const second = parseDateToken(match[2]);
  if (!first || !second) return null;

  const from = first <= second ? first : second;
  const to = second >= first ? second : first;
  return { from_date: formatIso(from), to_date: formatIso(to) };
}

function detectLocation(normalizedText, locationOptions) {
  const options = Array.isArray(locationOptions) ? locationOptions : [];
  const candidates = options
    .map((entry) => ({
      location_id: entry.location_id,
      location_name: entry.name,
      normalized: normalizeCommandText(entry.name),
    }))
    .filter((entry) => entry.normalized);

  let best = null;
  candidates.forEach((entry) => {
    if (!normalizedText.includes(entry.normalized)) return;
    const score = entry.normalized.length;
    if (!best || score > best.score) {
      best = { ...entry, score };
    }
  });

  if (!best) return null;
  return {
    location_id: best.location_id,
    location_name: best.location_name,
    location_text: best.location_name,
  };
}

export function parseDeterministicReportQuery(inputText, { locationOptions = [], now = new Date() } = {}) {
  const sourceText = String(inputText || '').trim();
  if (!sourceText) {
    return { success: false, error: 'Consulta vacia para parser deterministico de reportes.' };
  }

  const normalized = normalizeCommandText(sourceText);
  if (!normalized) {
    return { success: false, error: 'Consulta vacia para parser deterministico de reportes.' };
  }

  const intent = {
    tab: null,
    from_date: null,
    to_date: null,
    location_id: null,
    location_name: null,
    location_text: null,
    notes: null,
    confidence: 0,
  };

  let recognized = 0;

  const tab = detectTab(normalized);
  if (tab) {
    intent.tab = tab;
    recognized += 1;
  }

  const explicitRange = detectExplicitRange(sourceText);
  const presetRange = explicitRange ? null : detectPresetRange(normalized, now);
  const finalRange = explicitRange || presetRange;
  if (finalRange?.from_date && finalRange?.to_date) {
    intent.from_date = finalRange.from_date;
    intent.to_date = finalRange.to_date;
    recognized += 1;
  }

  const location = detectLocation(normalized, locationOptions);
  if (location?.location_id) {
    intent.location_id = location.location_id;
    intent.location_name = location.location_name;
    intent.location_text = location.location_text;
    recognized += 1;
  }

  if (!recognized) {
    return {
      success: false,
      error: 'Parser deterministico de reportes sin coincidencias.',
      data: {
        intent,
        model: 'deterministic-report-parser-v1',
        usage: null,
        raw: { normalized },
        cache_hit: false,
      },
    };
  }

  const confidence = Math.min(0.92, 0.45 + recognized * 0.16);
  intent.confidence = Number(confidence.toFixed(3));

  return {
    success: true,
    data: {
      intent,
      model: 'deterministic-report-parser-v1',
      usage: null,
      raw: { normalized },
      cache_hit: false,
    },
  };
}
