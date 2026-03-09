function stripDiacritics(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeCommandText(value) {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hashNormalizedText(value) {
  const text = String(value || '');
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) + text.charCodeAt(i);
    hash |= 0;
  }
  const asUint = hash >>> 0;
  return asUint.toString(16).padStart(8, '0');
}

export function normalizeCustomerName(value) {
  return String(value || '')
    .replace(/[,:;]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
