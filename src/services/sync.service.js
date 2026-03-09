import {
  getPendingOps,
  markPendingOpDone,
  markPendingOpFailed,
  markPendingOpProcessing,
  resetStuckProcessingOps,
} from '../storage/sqlite/database';
import { createSale } from './pos.service';

const MAX_RETRIES = 8;
const RETRY_BASE_MS = 15000;
const RETRY_MAX_MS = 15 * 60 * 1000;

function toLowerText(value) {
  return String(value || '').toLowerCase();
}

function isTaggedNoRetry(message) {
  return String(message || '').startsWith('NO_RETRY:');
}

function isNonRetriableSyncError(message) {
  const text = toLowerText(message);
  return (
    text.includes('stock insuficiente') ||
    text.includes('insufficient stock') ||
    (text.includes('disponible:') && text.includes('requerido:')) ||
    text.includes('tipo de operacion no soportado') ||
    text.includes('sp_create_sale_idempotent') ||
    text.includes('does not exist')
  );
}

function computeRetryDelayMs(retryCount) {
  const count = Math.max(1, Number(retryCount || 1));
  const multiplier = 2 ** Math.max(0, count - 1);
  return Math.min(RETRY_BASE_MS * multiplier, RETRY_MAX_MS);
}

function parseIsoDateMs(value) {
  const parsed = new Date(value || '').getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function shouldDeferRetry(op, nowMs) {
  if (op?.status !== 'FAILED') return false;
  const retries = Number(op?.retryCount || 0);
  if (retries <= 0) return false;
  const referenceMs = parseIsoDateMs(op?.updatedAt) || parseIsoDateMs(op?.createdAt);
  if (!referenceMs) return false;
  return nowMs - referenceMs < computeRetryDelayMs(retries);
}

async function processCreateSale(op) {
  const payload = op.payload || {};
  const result = await createSale(op.tenantId, {
    ...payload,
    operation_id: op.opId,
  });

  if (!result.success) {
    throw new Error(result.error || 'No fue posible sincronizar venta offline');
  }
}

export async function syncPendingOperations({ limit = 20, tenantId = null, userId = null } = {}) {
  await resetStuckProcessingOps();

  const pending = await getPendingOps({ limit, tenantId, userId });
  let processed = 0;
  let failed = 0;
  let skipped = 0;
  const nowMs = Date.now();

  for (const op of pending) {
    if (Number(op?.retryCount || 0) >= MAX_RETRIES && !isTaggedNoRetry(op?.lastError)) {
      await markPendingOpFailed(
        op.opId,
        `NO_RETRY:Se alcanzo el maximo de reintentos (${MAX_RETRIES}). Error previo: ${op.lastError || 'sin detalle'}`,
      );
      failed += 1;
      continue;
    }

    if (shouldDeferRetry(op, nowMs)) {
      skipped += 1;
      continue;
    }

    try {
      await markPendingOpProcessing(op.opId);

      if (op.opType === 'CREATE_SALE') {
        await processCreateSale(op);
        await markPendingOpDone(op.opId);
      } else {
        await markPendingOpFailed(op.opId, `NO_RETRY:Tipo de operacion no soportado: ${op.opType}`);
        failed += 1;
        continue;
      }

      processed += 1;
    } catch (error) {
      const baseMessage = error?.message || 'Error de sincronizacion';
      const nextRetryCount = Number(op?.retryCount || 0) + 1;
      const shouldStopRetrying = isNonRetriableSyncError(baseMessage) || nextRetryCount >= MAX_RETRIES;
      const taggedMessage = shouldStopRetrying
        ? `NO_RETRY:${baseMessage}`
        : baseMessage;
      await markPendingOpFailed(op.opId, taggedMessage);
      failed += 1;
    }
  }

  return {
    success: true,
    processed,
    failed,
    skipped,
    total: pending.length,
  };
}
