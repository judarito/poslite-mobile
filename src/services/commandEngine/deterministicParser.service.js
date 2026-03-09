import { normalizeCommandText, normalizeCustomerName } from './normalize.service';

const CONNECTOR_SPLIT_REGEX = /\s+(?:y|e)\s+/i;
const NOISE_PREFIX_REGEX = /^(?:hola|buenas|buenos dias|buenas tardes|pedido|por favor|favor|agrega(?:r)?|anade|añade|quiero|necesito|llevo)\s+/i;
const NON_ITEM_PREFIX_REGEX = /^(?:nota|observacion|observación|obs|entrega|cliente|a nombre de)\b/i;
const QUANTITY_FIRST_REGEX = /^(\d+(?:[.,]\d+)?)\s*(?:x|und?|unidades?|uds?|u|kg|g|gr|grs|lb|l|lt|lts|ml|caja|cajas|paq|paquete|paquetes)?\s+(.+)$/i;
const QUANTITY_WORD_FIRST_REGEX = /^([a-záéíóúñ]+)\s+(.+)$/i;
const QUANTITY_LAST_REGEX = /^(.+?)\s*(?:x|\*)\s*(\d+(?:[.,]\d+)?)$/i;
const SINGLE_ARTICLE_REGEX = /^(?:un|una)\s+(.+)$/i;
const NUMBER_WORD_MAP = {
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  dieciséis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
};

function toPositiveNumber(value, fallback = 1) {
  const parsed = Number(String(value || '').replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function extractCustomerName(inputText) {
  const text = String(inputText || '');
  const patterns = [
    /(?:^|\n)\s*para\s+([^\n:;,.]{2,80})/i,
    /(?:^|\n)\s*cliente\s*[:\-]\s*([^\n]{2,80})/i,
    /a\s+nombre\s+de\s+([^\n:;,.]{2,80})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const name = normalizeCustomerName(match[1]);
    if (name.length >= 2) return name;
  }

  return null;
}

function extractNotes(inputText) {
  const text = String(inputText || '');
  const explicit = text.match(/(?:nota|observacion|observación|obs|entrega)\s*[:\-]\s*([^\n]{2,180})/i);
  if (explicit?.[1]) {
    return explicit[1].replace(/\s+/g, ' ').trim();
  }

  const sentence = text.match(/(entrega[^\n.]{2,120})/i);
  if (sentence?.[1]) {
    return sentence[1].replace(/\s+/g, ' ').trim();
  }

  return null;
}

function detectUnitHint(sourceText) {
  const text = normalizeCommandText(sourceText);
  if (!text) return null;

  const hints = ['kg', 'g', 'gr', 'lb', 'ml', 'l', 'lt', 'lts', 'caja', 'paq', 'paquete', 'unidad'];
  return hints.find((hint) => text.includes(` ${hint} `) || text.endsWith(` ${hint}`)) || null;
}

function detectSku(rawName) {
  const tokens = String(rawName || '').split(/\s+/).filter(Boolean);
  const found = tokens.find((token) => /[a-z]/i.test(token) && /\d/.test(token) && token.length >= 4);
  return found || null;
}

function splitCandidateSegments(inputText) {
  const lines = String(inputText || '')
    .replace(/\r/g, '\n')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines
    .flatMap((line) => line.split(/[;,]+/))
    .flatMap((part) => part.split(CONNECTOR_SPLIT_REGEX))
    .map((part) => part.trim())
    .filter(Boolean);
}

function cleanSegment(segment) {
  let text = String(segment || '').trim();
  text = text.replace(NOISE_PREFIX_REGEX, '');
  text = text.replace(/^para\s+[^\d:;,.]{2,80}[:\-]?\s*/i, '');
  return text.trim();
}

function parseQuantityWord(token) {
  const key = String(token || '').trim().toLowerCase();
  const value = NUMBER_WORD_MAP[key];
  if (!value) return null;
  return Math.max(1, Number(value || 1));
}

function parseSegment(segment) {
  const original = cleanSegment(segment);
  if (!original) return null;
  if (NON_ITEM_PREFIX_REGEX.test(original)) return null;

  let quantity = null;
  let rawName = null;

  const q1 = original.match(QUANTITY_FIRST_REGEX);
  if (q1?.[1] && q1?.[2]) {
    quantity = toPositiveNumber(q1[1], 1);
    rawName = q1[2].trim();
  }

  if (!rawName) {
    const q2 = original.match(QUANTITY_LAST_REGEX);
    if (q2?.[1] && q2?.[2]) {
      quantity = toPositiveNumber(q2[2], 1);
      rawName = q2[1].trim();
    }
  }

  if (!rawName) {
    const qWord = original.match(QUANTITY_WORD_FIRST_REGEX);
    const parsedWordQty = parseQuantityWord(qWord?.[1]);
    if (parsedWordQty && qWord?.[2]) {
      quantity = parsedWordQty;
      rawName = qWord[2].trim();
    }
  }

  if (!rawName) {
    const single = original.match(SINGLE_ARTICLE_REGEX);
    if (single?.[1]) {
      quantity = 1;
      rawName = single[1].trim();
    }
  }

  if (!rawName) {
    // Fallback para voz: "coca cola", "arroz integral", etc.
    rawName = original;
    quantity = 1;
  }

  const cleanedName = rawName
    .replace(/^(de\s+)/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleanedName.length < 2) return null;

  return {
    raw_name: cleanedName,
    sku: detectSku(cleanedName),
    quantity: Math.max(1, Math.round(quantity || 1)),
    unit_hint: detectUnitHint(original),
    unit_price: null,
  };
}

function mergeDuplicateLines(lines) {
  const map = new Map();

  lines.forEach((line) => {
    const key = `${normalizeCommandText(line.raw_name)}::${line.sku || ''}`;
    if (!map.has(key)) {
      map.set(key, { ...line });
      return;
    }
    const existing = map.get(key);
    existing.quantity = Math.max(1, Number(existing.quantity || 0) + Number(line.quantity || 0));
    map.set(key, existing);
  });

  return Array.from(map.values());
}

export function parseDeterministicSaleCommand(inputText) {
  const sourceText = String(inputText || '').trim();
  if (!sourceText) {
    return { success: false, error: 'Comando vacio para parser deterministico.' };
  }

  const candidateSegments = splitCandidateSegments(sourceText);
  const parsedLines = candidateSegments
    .map((segment) => parseSegment(segment))
    .filter(Boolean);

  const lineItems = mergeDuplicateLines(parsedLines);
  if (!lineItems.length) {
    return {
      success: false,
      error: 'Parser deterministico sin coincidencias.',
      data: {
        order: {
          customer_name: extractCustomerName(sourceText),
          notes: extractNotes(sourceText),
          confidence: 0,
        },
        line_items: [],
      },
    };
  }

  const customerName = extractCustomerName(sourceText);
  const notes = extractNotes(sourceText);
  const confidenceRaw = 0.58 + (lineItems.length * 0.08) + (customerName ? 0.06 : 0);
  const confidence = Number(Math.min(0.93, confidenceRaw).toFixed(3));

  return {
    success: true,
    data: {
      order: {
        customer_name: customerName,
        notes,
        confidence,
      },
      line_items: lineItems,
      model: 'deterministic-parser-v1',
      usage: null,
      raw: {
        candidate_segments: candidateSegments,
      },
      cache_hit: false,
    },
  };
}
