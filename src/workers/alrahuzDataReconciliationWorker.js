const logger = require('../utils/logger');
const AlrahuzDataReconciliationService = require('../services/alrahuzDataReconciliationService');

let intervalHandle = null;
let isRunning = false;

async function runReconciliationCycle() {
  if (isRunning) {
    return;
  }

  isRunning = true;
  try {
    const result = await AlrahuzDataReconciliationService.reconcilePendingTransactions();
    if (result.checked > 0 || result.errors > 0) {
      logger.info(
        `Alrahuz data reconciliation: checked=${result.checked}, updated=${result.updated}, successful=${result.successful}, failed=${result.failed}, pending=${result.pending}, errors=${result.errors}`
      );
    }
  } catch (error) {
    logger.error(`Alrahuz data reconciliation worker error: ${error.message}`);
  } finally {
    isRunning = false;
  }
}

function startAlrahuzDataReconciliationWorker() {
  if (intervalHandle) {
    return intervalHandle;
  }

  if (String(process.env.ALRAHUZ_RECON_ENABLED || 'true').toLowerCase() === 'false') {
    logger.info('Alrahuz data reconciliation worker is disabled');
    return null;
  }

  const intervalMs = Number(process.env.ALRAHUZ_RECON_INTERVAL_MS || 120000);

  runReconciliationCycle().catch((error) => {
    logger.error(`Alrahuz initial reconciliation failed: ${error.message}`);
  });

  intervalHandle = setInterval(runReconciliationCycle, intervalMs);
  logger.info(`Alrahuz data reconciliation worker started (every ${Math.floor(intervalMs / 1000)}s)`);
  return intervalHandle;
}

function stopAlrahuzDataReconciliationWorker() {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
}

module.exports = {
  startAlrahuzDataReconciliationWorker,
  stopAlrahuzDataReconciliationWorker,
};

