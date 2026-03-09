let cachedVosk = null;
let activeSession = null;

function loadVoskApi() {
  if (cachedVosk) return cachedVosk;

  try {
    const module = require('react-native-vosk');
    cachedVosk = module?.Vosk || module?.default || module || null;
  } catch (_e) {
    cachedVosk = null;
  }

  return cachedVosk;
}

function getEventText(event) {
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
  const candidates = [
    event?.message,
    event?.error,
    event?.details,
    event?.code,
  ];
  const found = candidates.find((value) => value != null && String(value).trim().length > 0);
  return found ? String(found).trim() : 'Error Vosk desconocido.';
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
    }
  } catch (_e) {
    // no-op
  }
}

export function isVoskSttAvailable() {
  const vosk = loadVoskApi();
  return Boolean(vosk && typeof vosk.start === 'function' && typeof vosk.stop === 'function');
}

export async function cancelVoskTranscription() {
  const session = activeSession;
  if (!session) return;
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

    const finish = async (payload) => {
      if (completed) return;
      completed = true;
      if (timer) clearTimeout(timer);
      activeSession = null;
      resolve(payload);
    };

    activeSession = { vosk, finish };

    try {
      if (typeof onStatusChange === 'function') onStatusChange('starting');

      if (typeof vosk.onPartialResult === 'function') {
        vosk.onPartialResult((event) => {
          const text = getEventText(event);
          if (!text) return;
          lastPartial = text;
          if (typeof onPartialText === 'function') onPartialText(text);
        });
      }

      if (typeof vosk.onResult === 'function') {
        vosk.onResult(async (event) => {
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
      }

      if (typeof vosk.onError === 'function') {
        vosk.onError(async (event) => {
          const message = getEventMessage(event);
          await safeCancel(vosk);
          await finish({ success: false, error: message });
        });
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
        error: String(error?.message || 'No fue posible iniciar Vosk.'),
      });
    }
  });
}
