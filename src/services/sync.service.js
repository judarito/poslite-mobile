import {
  getPendingOps,
  markPendingOpDone,
  markPendingOpFailed,
  markPendingOpProcessing,
  resetStuckProcessingOps,
} from '../storage/sqlite/database';
import { createSale } from './pos.service';

const MAX_RETRIES = 5;

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
    if ((op.retryCount || 0) >= MAX_RETRIES) {
      continue;
    }

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
      await markPendingOpFailed(op.opId, error?.message || 'Error de sincronizacion');
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
