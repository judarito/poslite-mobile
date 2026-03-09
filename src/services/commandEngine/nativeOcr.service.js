function normalizeOcrText(value) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function collectNestedText(node, output) {
  if (!node) return;
  if (typeof node === 'string') {
    const cleaned = normalizeOcrText(node);
    if (cleaned) output.push(cleaned);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item) => collectNestedText(item, output));
    return;
  }
  if (typeof node !== 'object') return;

  if (typeof node.text === 'string') {
    const cleaned = normalizeOcrText(node.text);
    if (cleaned) output.push(cleaned);
    return;
  }

  Object.values(node).forEach((value) => collectNestedText(value, output));
}

function dedupeLines(lines) {
  const seen = new Set();
  const ordered = [];
  lines.forEach((line) => {
    const key = line.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push(line);
  });
  return ordered;
}

function loadExpoTextExtractorAdapter() {
  try {
    const moduleRef = require('expo-text-extractor');
    const extractTextFromImage = moduleRef?.extractTextFromImage || moduleRef?.default?.extractTextFromImage;
    const isSupported = moduleRef?.isSupported || moduleRef?.default?.isSupported;
    if (typeof extractTextFromImage !== 'function') return null;

    return {
      id: 'expo_text_extractor',
      async isAvailable() {
        if (typeof isSupported !== 'function') return true;
        return Boolean(await isSupported());
      },
      async extract(imageUri) {
        const raw = await extractTextFromImage(imageUri);
        const chunks = [];
        if (Array.isArray(raw)) {
          raw.forEach((line) => {
            const cleaned = normalizeOcrText(line);
            if (cleaned) chunks.push(cleaned);
          });
        } else if (typeof raw === 'string') {
          const cleaned = normalizeOcrText(raw);
          if (cleaned) chunks.push(cleaned);
        } else {
          collectNestedText(raw, chunks);
        }
        const lines = dedupeLines(chunks);
        return lines.join('\n').trim();
      },
    };
  } catch (_e) {
    return null;
  }
}

function loadMlkitAdapter() {
  try {
    const moduleRef = require('react-native-mlkit-ocr');
    const detectFromUri =
      moduleRef?.detectFromUri ||
      moduleRef?.detectFromFile ||
      moduleRef?.default?.detectFromUri ||
      moduleRef?.default?.detectFromFile;
    if (typeof detectFromUri !== 'function') return null;

    return {
      id: 'react_native_mlkit_ocr',
      async isAvailable() {
        return true;
      },
      async extract(imageUri) {
        const raw = await detectFromUri(imageUri);
        const chunks = [];
        collectNestedText(raw, chunks);
        const lines = dedupeLines(chunks);
        return lines.join('\n').trim();
      },
    };
  } catch (_e) {
    return null;
  }
}

async function resolveNativeOcrAdapter() {
  const adapters = [loadExpoTextExtractorAdapter(), loadMlkitAdapter()].filter(Boolean);
  const tried = [];

  for (const adapter of adapters) {
    let available = false;
    try {
      available = Boolean(await adapter.isAvailable());
    } catch (_e) {
      available = false;
    }
    tried.push({ id: adapter.id, available });
    if (available) {
      return { adapter, tried };
    }
  }

  return { adapter: null, tried };
}

export async function getNativeOcrStatus() {
  const { adapter, tried } = await resolveNativeOcrAdapter();
  return {
    success: true,
    available: Boolean(adapter),
    engine: adapter?.id || null,
    tried,
  };
}

export async function extractTextWithNativeOcr({ imageUri }) {
  const uri = String(imageUri || '').trim();
  if (!uri) {
    return { success: false, error: 'imageUri es requerido para OCR nativo.' };
  }

  const { adapter, tried } = await resolveNativeOcrAdapter();
  if (!adapter) {
    return {
      success: false,
      error:
        'OCR nativo no disponible. Instala expo-text-extractor (recomendado) y recompila el APK/dev-client.',
      data: { engine: null, tried },
    };
  }

  try {
    const text = normalizeOcrText(await adapter.extract(uri));
    if (!text) {
      return {
        success: false,
        error: 'No se detecto texto en la imagen con OCR nativo.',
        data: { engine: adapter.id, tried },
      };
    }

    return {
      success: true,
      data: {
        engine: adapter.id,
        text,
        lines: text.split('\n').filter(Boolean).length,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error?.message || 'Fallo OCR nativo al procesar imagen.',
      data: { engine: adapter.id, tried },
    };
  }
}
