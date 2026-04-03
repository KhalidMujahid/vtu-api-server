const AirtimeReconciliationService = require('../services/airtimeReconciliationService');
const logger = require('../utils/logger');

let intervalHandle = null;
let running = false;

async function runReconciliationCycle() {
  if (running) return;
  running = true;

  try {
    const summary = await AirtimeReconciliationService.reconcilePendingTransactions();
    logger.info('Scheduled provider reconciliation cycle completed', summary);
  } catch (error) {
    logger.error('Airtime reconciliation worker error:', error.message);
  } finally {
    running = false;
  }
}

function startAirtimeReconciliationWorker(intervalMs = Number(process.env.AIRTIME_RECONCILE_INTERVAL_MS || 5 * 60 * 1000)) {
  if (process.env.AIRTIME_RECONCILE_ENABLED === 'false') {
    return null;
  }

  if (intervalHandle) return intervalHandle;

  intervalHandle = setInterval(runReconciliationCycle, intervalMs);
  setTimeout(runReconciliationCycle, 10 * 1000);

  logger.info(`Airtime reconciliation worker started (every ${Math.floor(intervalMs / 1000)}s)`);
  return intervalHandle;
}

function stopAirtimeReconciliationWorker() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = {
  startAirtimeReconciliationWorker,
  stopAirtimeReconciliationWorker,
};
