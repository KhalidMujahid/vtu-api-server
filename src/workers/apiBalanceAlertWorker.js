const ApiBalanceAlertService = require('../services/apiBalanceAlertService');
const logger = require('../utils/logger');

let intervalHandle = null;

function startApiBalanceAlertWorker(intervalMs = 15 * 60 * 1000) {
  if (intervalHandle) return intervalHandle;

  intervalHandle = setInterval(async () => {
    try {
      await ApiBalanceAlertService.checkAndSendAlerts('system_worker');
    } catch (error) {
      logger.error('API balance alert worker error:', error.message);
    }
  }, intervalMs);

  logger.info(`API balance alert worker started (every ${Math.floor(intervalMs / 1000)}s)`);
  return intervalHandle;
}

function stopApiBalanceAlertWorker() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = {
  startApiBalanceAlertWorker,
  stopApiBalanceAlertWorker,
};
