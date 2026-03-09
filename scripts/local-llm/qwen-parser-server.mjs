import http from 'node:http';

const PORT = Number(process.env.LOCAL_LLM_PORT || 8080);
const HOST = process.env.LOCAL_LLM_HOST || '0.0.0.0';
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:1.5b';
const REQUEST_TIMEOUT_MS = Number(process.env.LOCAL_LLM_REQUEST_TIMEOUT_MS || 4000);

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function normalizeItem(item) {
  return {
    raw_name: String(item?.raw_name || '').trim(),
    sku: item?.sku ? String(item.sku).trim() : null,
    quantity: Math.max(1, Math.round(Number(item?.quantity || 1))),
    unit_hint: item?.unit_hint ? String(item.unit_hint).trim() : null,
    unit_price: item?.unit_price == null ? null : Number(item.unit_price || 0),
  };
}

function normalizeOrder(order) {
  const confidence = Number(order?.confidence || 0);
  return {
    customer_name: order?.customer_name ? String(order.customer_name).trim() : null,
    notes: order?.notes ? String(order.notes).trim() : null,
    confidence: Number.isFinite(confidence)
      ? Number(Math.max(0, Math.min(1, confidence)).toFixed(3))
      : 0,
  };
}

function parseJsonSafe(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  const text = String(value || '').trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (_e) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (_err) {
      return null;
    }
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('Payload demasiado grande (max 1MB).'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function buildMessages(inputText) {
  return [
    {
      role: 'system',
      content:
        'Eres un parser de comandos para POS. Debes responder SOLO JSON valido, sin markdown y sin texto adicional.',
    },
    {
      role: 'user',
      content: `Convierte este texto en un borrador de venta con JSON EXACTO:\n\n{\n  "order": {\n    "customer_name": "string|null",\n    "notes": "string|null",\n    "confidence": number\n  },\n  "line_items": [\n    {\n      "raw_name": "string",\n      "sku": "string|null",\n      "quantity": number,\n      "unit_hint": "string|null",\n      "unit_price": number|null\n    }\n  ]\n}\n\nReglas:\n- No inventes productos no presentes en el texto.\n- quantity siempre > 0, si falta usa 1.\n- confidence entre 0 y 1.\n- Si no hay customer_name o notes, usa null.\n- Si no hay sku, usa null.\n- Conserva atributos de variante en raw_name (talla, color, presentacion, capacidad).\n- Responde SOLO JSON.\n\nTexto:\n\"\"\"${String(inputText || '').slice(0, 10000)}\"\"\"`,
    },
  ];
}

async function callOllama({ text }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: 'json',
        options: {
          temperature: 0.1,
        },
        messages: buildMessages(text),
      }),
      signal: controller.signal,
    });

    const rawText = await response.text();
    const rawJson = parseJsonSafe(rawText);
    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        error: rawJson?.error || rawText.slice(0, 500) || `Ollama HTTP ${response.status}`,
      };
    }

    const contentText = rawJson?.message?.content || '';
    const parsed = parseJsonSafe(contentText);
    if (!parsed) {
      return {
        success: false,
        status: 502,
        error: 'No se pudo parsear JSON desde respuesta de Qwen/Ollama.',
      };
    }

    const lineItems = (Array.isArray(parsed?.line_items) ? parsed.line_items : [])
      .map(normalizeItem)
      .filter((item) => item.raw_name);

    if (!lineItems.length) {
      return {
        success: false,
        status: 422,
        error: 'Qwen no devolvio line_items validos.',
      };
    }

    return {
      success: true,
      status: 200,
      data: {
        order: normalizeOrder(parsed?.order || {}),
        line_items: lineItems,
        model: rawJson?.model || OLLAMA_MODEL,
        usage: {
          prompt_eval_count: rawJson?.prompt_eval_count || 0,
          eval_count: rawJson?.eval_count || 0,
          total_duration: rawJson?.total_duration || 0,
        },
      },
    };
  } catch (error) {
    const isAbort = String(error?.name || '').toLowerCase() === 'aborterror';
    return {
      success: false,
      status: 504,
      error: isAbort
        ? `Timeout llamando a Ollama (${REQUEST_TIMEOUT_MS}ms).`
        : String(error?.message || 'Error inesperado llamando a Ollama.'),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    writeJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    writeJson(res, 200, {
      ok: true,
      model: OLLAMA_MODEL,
      ollama_url: OLLAMA_URL,
    });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/parse-sale-command') {
    writeJson(res, 404, { error: 'Not found' });
    return;
  }

  let payload = null;
  try {
    const raw = await readBody(req);
    payload = parseJsonSafe(raw);
  } catch (error) {
    writeJson(res, 400, { error: String(error?.message || 'Body invalido.') });
    return;
  }

  const tenantId = String(payload?.tenant_id || '').trim();
  const text = String(payload?.text || '').trim();

  if (!tenantId) {
    writeJson(res, 400, { error: 'tenant_id es requerido.' });
    return;
  }
  if (!text) {
    writeJson(res, 400, { error: 'text es requerido.' });
    return;
  }

  const result = await callOllama({ text });
  if (!result.success) {
    writeJson(res, result.status || 500, {
      error: result.error,
      model: OLLAMA_MODEL,
    });
    return;
  }

  writeJson(res, 200, result.data);
});

server.listen(PORT, HOST, () => {
  console.log(`[qwen-parser] listening on http://${HOST}:${PORT}`);
  console.log(`[qwen-parser] model=${OLLAMA_MODEL}`);
  console.log(`[qwen-parser] ollama=${OLLAMA_URL}`);
});
