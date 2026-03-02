import {
  getPendingOps,
  markPendingOpDone,
  markPendingOpFailed,
  markPendingOpProcessing,
  resetStuckProcessingOps,
} from '../storage/sqlite/database';
import { createSale } from './pos.service';

function isNonRetriableSyncError(message) {
  const text = String(message || '').toLowerCase();
  return (
    text.includes('stock insuficiente') ||
    text.includes('insufficient stock') ||
    text.includes('disponible:') && text.includes('requerido:')
  );
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

export async function syncPendingOperations({ limit = 20 } = {}) {
  await resetStuckProcessingOps();

  const pending = await getPendingOps(limit);
  let processed = 0;
  let failed = 0;

  for (const op of pending) {
    try {
      await markPendingOpProcessing(op.opId);

      if (op.opType === 'CREATE_SALE') {
        await processCreateSale(op);
        await markPendingOpDone(op.opId);
      } else {
        await markPendingOpFailed(op.opId, `Tipo de operacion no soportado: ${op.opType}`);
        failed += 1;
        continue;
      }

      processed += 1;
    } catch (error) {
      const baseMessage = error?.message || 'Error de sincronizacion';
      const taggedMessage = isNonRetriableSyncError(baseMessage)
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
    total: pending.length,
  };
}
