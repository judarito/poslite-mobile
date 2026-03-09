const DEFAULT_VOSK_MODEL_PATH = String(
  process.env.EXPO_PUBLIC_VOSK_MODEL_PATH || 'vosk-model-small-es-0.42',
).trim();

let cachedVosk = null;
let activeSession = null;
let modelLoaded = false;
let loadingModelPromise = null;

function resolveClientCandidate(module) {
  const candidates = [module?.Vosk, module?.default, module];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === 'function') {
      try {
        return new candidate();
      } catch (_e) {
        continue;
      }
    }
    if (typeof candidate === 'object') {
      return candidate;
    }
  }

  return null;
}

function loadVoskApi() {
  if (cachedVosk) return cachedVosk;

  try {
    const module = require('react-native-vosk');
    cachedVosk = resolveClientCandidate(module);
  } catch (_e) {
    cachedVosk = null;
  }

  return cachedVosk;
}

function getEventText(event) {
  if (typeof event === 'string') {
    const direct = event.trim();
    if (!direct) return '';
    // Android/iOS pueden enviar texto plano o JSON serializado.
    if (direct.startsWith('{') && direct.endsWith('}')) {
      try {
        const parsed = JSON.parse(direct);
        const jsonText = String(parsed?.text || parsed?.partial || parsed?.result || '').trim();
        if (jsonText) return jsonText;
      } catch (_e) {
        // fallback a texto directo
      }
    }
    return direct;
  }

  const candidates = [
    event?.text,
    event?.value,
    event?.partial,
    event?.result,
    event?.result?.text,
    event?.payload?.text,
  ];
  const found = candidates.find((value) => typeof value === 'string' && value.trim().length > 0);
  return found ? String(found).trim() : '';
}

function getEventMessage(event) {
  if (typeof event === 'string') {
    const direct = event.trim();
    return direct || 'Error Vosk desconocido.';
  }

  const candidates = [
    event?.message,
    event?.error,
    event?.details,
    event?.code,
  ];
  const found = candidates.find((value) => value != null && String(value).trim().length > 0);
  return found ? String(found).trim() : 'Error Vosk desconocido.';
}

function isMissingUuidError(detail) {
  const normalized = String(detail || '').toLowerCase();
  return /[\\/](uuid)\b/.test(normalized) || normalized.includes(' uuid');
}

function mapVoskError(detail) {
  const normalized = String(detail || '').toLowerCase();
  if (isMissingUuidError(detail)) {
    return `Modelo Vosk no empaquetado correctamente (${DEFAULT_VOSK_MODEL_PATH}). Reinstala la app tras compilar para incluir assets del modelo.`;
  }
  if (normalized.includes('recognizer is already in use')) {
    return 'El microfono sigue ocupado por una captura anterior. Espera 1 segundo y vuelve a intentar.';
  }
  if (normalized.includes('model is not loaded yet')) {
    return `El modelo de voz aun no esta cargado (${DEFAULT_VOSK_MODEL_PATH}). Intenta nuevamente.`;
  }
  return String(detail || 'Error Vosk desconocido.');
}

async function safeStop(vosk) {
  try {
    if (typeof vosk?.stop === 'function') {
      await vosk.stop();
    }
  } catch (_e) {
    // no-op
  }
}

async function safeCancel(vosk) {
  try {
    if (typeof vosk?.cancel === 'function') {
      await vosk.cancel();
      return;
    }
    if (typeof vosk?.stop === 'function') {
      await vosk.stop();
    }
  } catch (_e) {
    // no-op
  }
}

function removeSubscriptions(subscriptions = []) {
  subscriptions.forEach((sub) => {
    try {
      if (typeof sub?.remove === 'function') {
        sub.remove();
      }
    } catch (_e) {
      // no-op
    }
  });
}

async function ensureModelLoaded(vosk) {
  if (modelLoaded) return { success: true };
  if (typeof vosk?.loadModel !== 'function') {
    modelLoaded = true;
    return { success: true, skipped: true };
  }

  if (loadingModelPromise) return loadingModelPromise;

  loadingModelPromise = (async () => {
    try {
      await vosk.loadModel(DEFAULT_VOSK_MODEL_PATH);
      modelLoaded = true;
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: mapVoskError(
          error?.message || `No se pudo cargar modelo Vosk (${DEFAULT_VOSK_MODEL_PATH}).`,
        ),
      };
    } finally {
      loadingModelPromise = null;
    }
  })();

  return loadingModelPromise;
}

export function isVoskSttAvailable() {
  const vosk = loadVoskApi();
  return Boolean(vosk && typeof vosk.start === 'function' && typeof vosk.stop === 'function');
}

export function getVoskSttStatus() {
  const vosk = loadVoskApi();
  if (!vosk) {
    return {
      available: false,
      reason: 'module_unavailable',
      modelLoaded: false,
      modelPath: DEFAULT_VOSK_MODEL_PATH,
    };
  }

  const available = typeof vosk.start === 'function' && typeof vosk.stop === 'function';
  return {
    available,
    reason: available ? 'ok' : 'invalid_api',
    modelLoaded,
    modelPath: DEFAULT_VOSK_MODEL_PATH,
  };
}

export async function cancelVoskTranscription() {
  const session = activeSession;
  if (!session) return;
  await safeStop(session.vosk);
  await safeCancel(session.vosk);
  session.finish({
    success: false,
    error: 'Captura de voz cancelada por usuario.',
  });
}

export async function transcribeWithVosk({
  timeoutMs = 7000,
  minTextLength = 2,
  autoStopOnFinal = true,
  onPartialText = null,
  onStatusChange = null,
} = {}) {
  const vosk = loadVoskApi();
  if (!vosk) {
    return {
      success: false,
      error: 'Vosk no disponible. Instala react-native-vosk y usa dev build nativo.',
    };
  }
  if (activeSession) {
    return { success: false, error: 'Ya hay una captura de voz activa.' };
  }

  const timeout = Number.isFinite(Number(timeoutMs)) ? Math.max(1000, Number(timeoutMs)) : 7000;
  const minChars = Number.isFinite(Number(minTextLength)) ? Math.max(1, Number(minTextLength)) : 2;

  return new Promise(async (resolve) => {
    let completed = false;
    let lastPartial = '';
    let lastFinal = '';
    let timer = null;
    const subscriptions = [];

    const finish = async (payload) => {
      if (completed) return;
      completed = true;
      if (timer) clearTimeout(timer);
      removeSubscriptions(subscriptions);
      activeSession = null;
      resolve(payload);
    };

    activeSession = { vosk, finish };

    try {
      if (typeof onStatusChange === 'function') onStatusChange('starting');
      await safeStop(vosk);

      if (typeof vosk.onPartialResult === 'function') {
        const sub = vosk.onPartialResult((event) => {
          const text = getEventText(event);
          if (!text) return;
          lastPartial = text;
          if (typeof onPartialText === 'function') onPartialText(text);
        });
        subscriptions.push(sub);
      }

      if (typeof vosk.onResult === 'function') {
        const sub = vosk.onResult(async (event) => {
          const text = getEventText(event);
          if (!text) return;
          lastFinal = text;
          if (typeof onPartialText === 'function') onPartialText(text);
          if (!autoStopOnFinal) return;
          await safeStop(vosk);
          await finish({
            success: true,
            data: {
              text,
              source: 'vosk',
            },
          });
        });
        subscriptions.push(sub);
      }

      if (typeof vosk.onFinalResult === 'function') {
        const sub = vosk.onFinalResult(async (event) => {
          const text = getEventText(event);
          if (!text) return;
          lastFinal = text;
          if (typeof onPartialText === 'function') onPartialText(text);
          await finish({
            success: true,
            data: {
              text,
              source: 'vosk',
            },
          });
        });
        subscriptions.push(sub);
      }

      if (typeof vosk.onError === 'function') {
        const sub = vosk.onError(async (event) => {
          const message = mapVoskError(getEventMessage(event));
          await safeCancel(vosk);
          await finish({ success: false, error: message });
        });
        subscriptions.push(sub);
      }

      if (typeof onStatusChange === 'function') onStatusChange('loading_model');
      const modelResult = await ensureModelLoaded(vosk);
      if (!modelResult.success) {
        await finish({
          success: false,
          error: modelResult.error || 'No se pudo cargar modelo Vosk.',
        });
        return;
      }

      await vosk.start();
      if (typeof onStatusChange === 'function') onStatusChange('listening');

      timer = setTimeout(async () => {
        await safeStop(vosk);
        const text = String(lastFinal || lastPartial || '').trim();
        if (text.length >= minChars) {
          await finish({
            success: true,
            data: {
              text,
              source: 'vosk',
            },
          });
          return;
        }
        await finish({
          success: false,
          error: 'No se detecto un comando de voz valido.',
        });
      }, timeout);
    } catch (error) {
      await safeCancel(vosk);
      await finish({
        success: false,
        error: mapVoskError(error?.message || 'No fue posible iniciar Vosk.'),
      });
    }
  });
}
